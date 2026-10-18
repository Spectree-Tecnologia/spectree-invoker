import WebSocket from 'ws';

const fail = code => Object.assign(new Error(code), { code });
const MODEL = 'gpt-realtime-2.1';
export const realtimeSessionConfig = () => ({ type: 'realtime', model: MODEL,
  output_modalities: ['audio'], max_output_tokens: 512, reasoning: { effort: 'minimal' },
  truncation: { type: 'retention_ratio', retention_ratio: .8, token_limits: { post_instructions: 4000 } },
  instructions: `Você é o Invoker do Spectree. Converse em português brasileiro de forma natural, calorosa e breve.
Você conduz a conversa por voz. Para analisar problemas de engenharia, planejar especificações ou quando o usuário pedir ao Codex, use consultar_codex.
O Codex usa a assinatura local do usuário. Nesta etapa ele só conversa num canário isolado: não abre projetos, não escreve arquivos, não executa tarefas e não delega especialistas.
Nunca afirme ter feito trabalho, aprovado gates ou consultado o Codex sem retorno confirmado da ferramenta. Fala não concede autorização de execução.
Quando a análise demorar, reconheça brevemente que está consultando o Codex. Não exponha raciocínio interno. Responda em até três frases, salvo pedido de detalhes.
Se for interrompido, escute a nova fala e não retome automaticamente a resposta anterior.`,
  audio: { input: { noise_reduction: { type: 'far_field' },
    transcription: { model: 'gpt-4o-mini-transcribe', language: 'pt' },
    turn_detection: { type: 'semantic_vad', eagerness: 'medium', create_response: true, interrupt_response: true } },
  output: { voice: 'marin' } },
  tools: [{ type: 'function', name: 'consultar_codex', description: 'Solicita análise e planejamento ao Codex local; não executa trabalho em projetos.',
    parameters: { type: 'object', properties: { pedido: { type: 'string', description: 'Pergunta completa com o contexto necessário, até 4000 caracteres.' } }, required: ['pedido'], additionalProperties: false } }], tool_choice: 'auto' });

async function boundedText(response, limit) {
  const reader = response.body?.getReader(); if (!reader) throw fail('E_REALTIME_PROVIDER');
  let size = 0; const chunks = [];
  try { while (true) { const { done, value } = await reader.read(); if (done) break;
    size += value.length; if (size > limit) throw fail('E_REALTIME_PROTOCOL'); chunks.push(Buffer.from(value)); }
    return Buffer.concat(chunks).toString('utf8');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function createPresenceRealtime({ session, key = process.env.OPENAI_API_KEY, budgetUsd = 0,
  fetcher = fetch, socketFactory = (url, options) => new WebSocket(url, options), now = Date.now,
  maxSessionMs = 60000, leaseMs = 10000, cancelTimeoutMs = 10000 } = {}) {
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0 || budgetUsd > 2) throw fail('E_VOICE_BUDGET');
  if (!Number.isFinite(maxSessionMs) || maxSessionMs <= 0 || maxSessionMs > 60000) throw fail('E_REALTIME_TIME');
  if (!Number.isFinite(cancelTimeoutMs) || cancelTimeoutMs <= 0 || cancelTimeoutMs > 10000) throw fail('E_REALTIME_TIME');
  const reserveUsd = maxSessionMs <= 15000 ? .3 : 1, responseLimit = maxSessionMs <= 15000 ? 3 : 6;
  let active, closing, revision = 0, status = 'idle', error = null, reservedUsd = 0, closed = false, epoch = 0;
  let messages = [], work = 'idle', usage = { inputTokens: 0, outputTokens: 0 }, hangup = 'none';
  const used = new Set();
  const config = () => ({ enabled: !closed && !!key?.trim(), reason: !key?.trim() ? 'E_AUDIO_KEY' : null,
    provider: 'OpenAI Realtime', mode: 'realtime', model: MODEL, budgetUsd, reservedUsd, reservePerSessionUsd: reserveUsd,
    maxSessionSeconds: maxSessionMs / 1000, synthetic: true });
  const snapshot = () => ({ revision, status, error, work, model: MODEL, messages: messages.map(m => ({ ...m })),
    reservedUsd, budgetUsd, usage: { ...usage }, hangup, remainingSeconds: active ? Math.max(0, Math.ceil((active.deadline - now()) / 1000)) : 0 });
  const publish = () => { revision++; };
  const live = call => !closed && active === call && !call.controller.signal.aborted;
  const send = (call, value) => { if (live(call) && call.socket?.readyState === 1) call.socket.send(JSON.stringify(value)); };
  function message(call, id, role, text, append = false) {
    if (!live(call) || typeof id !== 'string' || typeof text !== 'string') return;
    let item = messages.find(m => m.id === id);
    const next = append ? (item?.text ?? '') + text : text;
    if (next.length > 6000 || messages.length >= 80 || messages.reduce((n, m) => n + m.text.length, 0) + text.length > 48000) return void end('E_REALTIME_LIMIT');
    if (!item) { item = { id, role, text: '' }; messages.push(item); }
    item.text = next; publish();
  }
  async function remoteHangup(callId) {
    try {
      const response = await fetcher(`https://api.openai.com/v1/realtime/calls/${callId}/hangup`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000), redirect: 'error' });
      await response.body?.cancel(); return response.ok ? 'confirmed' : [404, 410].includes(response.status) ? 'already-ended' : 'unconfirmed';
    } catch { return 'unconfirmed'; }
  }
  async function cancelAnalysis(call) {
    const analysis = call.analysis;
    if (!analysis) return;
    analysis.cancelRequested = true;
    if (live(call)) { work = 'cancelling'; publish(); }
    if (!analysis.dispatched) return;
    if (!analysis.cancellation) analysis.cancellation = (async () => {
      // An interrupt RPC acknowledgement is not a terminal turn notification.
      // Wait for the turn ID if start is pending; otherwise close this harness
      // session after a bounded wait, without touching a replacement session.
      const deadline = performance.now() + cancelTimeoutMs;
      while (performance.now() < deadline) {
        const value = session.snapshot();
        if (value.sessionId !== analysis.sessionId || ['completed', 'interrupted', 'disconnected', 'error'].includes(value.status)) return;
        if (!analysis.interruptRequested && value.canInterrupt) {
          analysis.interruptRequested = true;
          try { void Promise.resolve(session.interrupt(analysis.sessionId)).catch(() => {}); } catch {}
          continue;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (session.snapshot().sessionId === analysis.sessionId) {
        try { session.disconnect(analysis.sessionId); }
        catch { if (session.snapshot().sessionId === analysis.sessionId) session.close(); }
      }
    })();
    return analysis.cancellation;
  }
  function end(code = null) {
    if (!active) return closing?.promise ?? Promise.resolve(snapshot());
    const old = active; active = undefined;
    const ending = { call: old, epoch: ++epoch }; closing = ending;
    old.controller.abort();
    status = code ? 'error' : 'ended'; error = code; work = old.analysis ? 'cancelling' : 'idle';
    hangup = old.callId ? 'pending' : 'none'; publish();
    ending.promise = (async () => {
      // Retain control and exclude a new paid start until both boundaries close.
      const [, result] = await Promise.all([cancelAnalysis(old), old.callId ? remoteHangup(old.callId) : 'none']);
      old.socket?.close(); old.socket?.terminate?.();
      if (closing === ending && epoch === ending.epoch) {
        hangup = result; work = 'idle'; closing = undefined; publish();
      }
      return snapshot();
    })();
    return ending.promise;
  }
  async function consult(call, item) {
    if (!live(call) || call.tools.has(item.call_id)) return;
    call.tools.add(item.call_id); const generation = call.speechEpoch;
    let output, analysis;
    try {
      if (item.name !== 'consultar_codex' || typeof item.call_id !== 'string' || item.call_id.length > 200 || call.tools.size > 2 || call.analysis) throw fail('E_CODEX_BUSY');
      const args = JSON.parse(item.arguments);
      if (!args || Object.keys(args).some(k => k !== 'pedido') || typeof args.pedido !== 'string' || !args.pedido.trim() || args.pedido.length > 4000) throw fail('E_INPUT');
      const value = session.snapshot();
      if (value.sessionId !== call.sessionId || !['ready', 'completed', 'interrupted'].includes(value.status)) throw fail('E_CODEX_BUSY');
      if (!live(call) || generation !== call.speechEpoch) throw fail('E_ANALYSIS_INTERRUPTED');
      analysis = { sessionId: value.sessionId, dispatched: true }; call.analysis = analysis; work = 'consulting'; publish();
      session.touch(); await session.send(value.sessionId, args.pedido);
      const deadline = now() + 40000;
      while (live(call) && generation === call.speechEpoch && now() < deadline) {
        session.touch(); const next = session.snapshot();
        if (next.status === 'completed') {
          const answer = next.messages.at(-1);
          if (answer?.role !== 'assistant') throw fail('E_CODEX_RESULT');
          output = { status: 'completed', source: 'Codex', text: answer.text.slice(0, 6000), execution: 'conversation-only' }; break;
        }
        if (['error', 'disconnected', 'interrupted'].includes(next.status)) throw fail('E_CODEX_RESULT');
        await new Promise(resolve => setTimeout(resolve, 75));
      }
      if (!output) throw fail('E_ANALYSIS_INTERRUPTED');
    } catch (e) { output = { status: 'error', code: /^E_[A-Z_]+$/.test(e.code ?? '') ? e.code : 'E_CODEX_RESULT' }; }
    finally {
      if (analysis) {
        if (output?.status !== 'completed' || analysis.cancelRequested) await cancelAnalysis(call);
        if (call.analysis === analysis) call.analysis = undefined;
        if (live(call)) { work = output?.status === 'completed' && !analysis.cancelRequested ? 'completed' : 'error'; publish(); }
      }
    }
    if (!live(call)) return;
    const stale = generation !== call.speechEpoch;
    send(call, { type: 'conversation.item.create', item: { type: 'function_call_output', call_id: item.call_id,
      output: JSON.stringify(stale ? { status: 'error', code: 'E_ANALYSIS_INTERRUPTED' } : output) } });
    if (!stale) send(call, { type: 'response.create' });
  }
  function event(call, value) {
    if (!live(call) || !value || typeof value.type !== 'string') return;
    if (value.type === 'input_audio_buffer.speech_started') {
      call.speechEpoch++; status = 'listening'; publish();
      void cancelAnalysis(call);
    } else if (value.type === 'input_audio_buffer.speech_stopped') { status = 'thinking'; publish(); }
    else if (value.type === 'output_audio_buffer.started') { status = 'speaking'; publish(); }
    else if (['output_audio_buffer.stopped', 'output_audio_buffer.cleared'].includes(value.type)) { status = 'listening'; publish(); }
    else if (value.type === 'conversation.item.input_audio_transcription.completed') message(call, value.item_id, 'user', value.transcript);
    else if (value.type === 'response.output_audio_transcript.delta') message(call, value.item_id, 'assistant', value.delta, true);
    else if (value.type === 'response.output_audio_transcript.done') message(call, value.item_id, 'assistant', value.transcript);
    else if (value.type === 'response.created') {
      if (!call.responses.has(value.response?.id)) { call.responses.add(value.response?.id); if (call.responses.size > responseLimit) return void end('E_REALTIME_LIMIT'); }
    } else if (value.type === 'response.done') {
      if (value.response?.usage && !call.billed.has(value.response.id)) {
        call.billed.add(value.response.id);
        usage.inputTokens += Number(value.response.usage.input_tokens) || 0; usage.outputTokens += Number(value.response.usage.output_tokens) || 0; publish();
      }
      if (value.response?.status === 'completed') for (const item of value.response.output ?? []) if (item.type === 'function_call') void consult(call, item);
      if (value.response?.status === 'failed') void end('E_REALTIME_PROVIDER');
    } else if (value.type === 'error') void end('E_REALTIME_PROVIDER');
  }
  const monitor = setInterval(() => {
    if (!active) return;
    if (now() > active.deadline) void end('E_REALTIME_TIME');
    else if (status !== 'connecting' && now() - active.seen > leaseMs) void end('E_CONTACT_LOST');
    else if (session.snapshot().sessionId !== active.sessionId) void end('E_STALE_SESSION');
  }, 250); monitor.unref();
  return { config, snapshot, touch() { if (active) active.seen = now(); }, end,
    stop(targetRequestId) { used.add(targetRequestId); return active?.requestId === targetRequestId || closing?.call.requestId === targetRequestId ? end() : Promise.resolve(snapshot()); },
    async start(input) {
      if (closed || !key?.trim()) throw fail('E_AUDIO_KEY');
      if (!input || Object.keys(input).some(k => !['action', 'requestId', 'sessionId', 'sdp'].includes(k)) || input.action !== 'start' ||
        typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(input.requestId) || typeof input.sdp !== 'string' || input.sdp.length > 64000 || !input.sdp.startsWith('v=0')) throw fail('E_INPUT');
      if (input.sessionId !== session.snapshot().sessionId) throw fail('E_STALE_SESSION');
      if (used.has(input.requestId)) throw fail('E_VOICE_DUPLICATE');
      if (active || closing) throw fail('E_VOICE_BUSY');
      if (!['ready', 'completed', 'interrupted'].includes(session.snapshot().status)) throw fail('E_NOT_READY');
      if (Math.round((reservedUsd + reserveUsd) * 100) > Math.round(budgetUsd * 100)) throw fail('E_VOICE_BUDGET');
      used.add(input.requestId); reservedUsd = Math.round((reservedUsd + reserveUsd) * 100) / 100;
      const call = { controller: new AbortController(), requestId: input.requestId, sessionId: input.sessionId, epoch: ++epoch, deadline: now() + maxSessionMs,
        seen: now(), speechEpoch: 0, tools: new Set(), responses: new Set(), billed: new Set() };
      active = call; status = 'connecting'; error = null; messages = []; work = 'idle'; hangup = 'none'; usage = { inputTokens: 0, outputTokens: 0 }; publish();
      const timer = setTimeout(() => { if (live(call)) void end('E_REALTIME_TIMEOUT'); }, 15000);
      try {
        const form = new FormData(); form.set('sdp', input.sdp); form.set('session', JSON.stringify(realtimeSessionConfig()));
        const response = await fetcher('https://api.openai.com/v1/realtime/calls', {
          method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: call.controller.signal, redirect: 'error' });
        const location = response.headers.get('location');
        const callId = location?.match(/\/(rtc_[a-zA-Z0-9_-]+)$/)?.[1];
        if (callId) call.callId = callId;
        if (!response.ok) { await response.body?.cancel(); throw fail('E_REALTIME_PROVIDER'); }
        if (!callId) throw fail('E_REALTIME_PROTOCOL');
        const sdp = await boundedText(response, 64000);
        if (!live(call)) { await remoteHangup(callId); throw fail('E_AUDIO_CANCELLED'); }
        call.socket = socketFactory(`wss://api.openai.com/v1/realtime?call_id=${callId}`, { headers: { Authorization: `Bearer ${key}` }, maxPayload: 1024 * 1024 });
        await new Promise((resolve, reject) => {
          call.socket.on('message', data => { try { event(call, JSON.parse(data.toString())); } catch { void end('E_REALTIME_PROTOCOL'); } });
          call.socket.on('error', () => { reject(fail('E_REALTIME_PROVIDER')); if (live(call)) void end('E_REALTIME_PROVIDER'); });
          call.socket.on('close', () => { reject(fail('E_REALTIME_CLOSED')); if (live(call)) void end('E_REALTIME_CLOSED'); });
          call.controller.signal.addEventListener('abort', () => reject(fail('E_AUDIO_CANCELLED')), { once: true });
          call.socket.once('open', resolve);
        });
        if (!live(call)) throw fail('E_AUDIO_CANCELLED');
        status = 'listening'; call.seen = now(); publish(); return { sdp, reservedUsd, maxSessionSeconds: maxSessionMs / 1000 };
      } catch (e) { if (active === call) await end(/^E_[A-Z_]+$/.test(e.code ?? '') ? e.code : 'E_REALTIME_PROVIDER'); throw fail(error ?? 'E_AUDIO_CANCELLED'); }
      finally { clearTimeout(timer); }
    },
    close() { closed = true; clearInterval(monitor); return end(); },
  };
}
