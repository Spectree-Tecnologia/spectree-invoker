import { createPresenceClient } from './client.mjs';
import { freshSurface, startPageLifecycle } from './lifecycle.mjs';
import { createVoiceController, voiceErrorMessage } from './voice.mjs';
import { createRealtimeConversation } from './realtime.mjs';

const labels = { offline: 'Sem conexão', disconnected: 'Desconectado', connecting: 'Conectando', ready: 'Disponível', running: 'Elaborando resposta',
  interrupting: 'Interrompendo', completed: 'Resposta concluída', interrupted: 'Interrompido', error: 'Sessão com erro' };
const errors = { E_CHATGPT_LOGIN: 'Entre no Codex com sua conta ChatGPT pelo terminal e tente conectar novamente.',
  E_INPUT: 'Revise sua mensagem: use de 1 a 8.000 caracteres. O texto foi preservado.',
  E_CODEX_UNAVAILABLE: 'Não foi possível iniciar o Codex. Confira o PATH ou configure SPECTREE_CODEX_EXECUTABLE no .env com o caminho do CLI e reinicie o servidor usando --env-file=.env.',
  E_APPROVAL_UNSUPPORTED: 'O Codex pediu uma ação que esta etapa ainda não suporta. A sessão foi encerrada.',
  E_HOOKS_UNSUPPORTED: 'Há hooks ativos na configuração do Codex. Esta sessão de canário exige uma configuração sem hooks.',
  E_CONFIGURATION: 'A configuração do Codex não é compatível com a sessão restrita desta etapa.',
  E_CONTACT_LOST: 'Perdemos contato com a sessão. Verifique a conexão; mensagens não serão reenviadas automaticamente.',
  E_ACTION_UNKNOWN: 'Não recebemos a confirmação. Verifique a conexão e a conversa antes de enviar novamente.',
  E_HISTORY_LIMIT: 'Esta conversa atingiu o limite local. Encerre a sessão e conecte novamente.',
  E_SESSION: 'Abra o endereço completo impresso no terminal para acessar esta sessão.',
  E_TURN_FAILED: 'O Codex não concluiu a resposta. Confira seu acesso e limite de uso antes de tentar novamente.' };

function mount() {
  const root = document.querySelector('#presence'), $ = s => root.querySelector(s), surface = freshSurface(root);
  const token = new URLSearchParams(location.hash.slice(1)).get('session');
  const events = new AbortController(), options = { signal: events.signal };
  let scene, snapshot, disposed = false, visible = true, motion = true, online = false, pending = false;
  let notice = '', shownMessages = '';
  let recordingUrl, microphoneSignature = '';
  let realtime, realtimeView = { phase: 'idle', messages: [], active: false }, realtimeMode = false;
  function setRecording(bytes) {
    surface.audio.pause(); surface.audio.removeAttribute('src'); surface.audio.load();
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    recordingUrl = bytes ? URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })) : undefined;
    if (recordingUrl) surface.audio.src = recordingUrl;
    if (!disposed) paintVoice();
  }
  let voice, voiceView = { config: { enabled: false }, state: 'idle', automatic: false, metrics: {} };
  $('.messages').replaceChildren(); $('.brand').href = `./${location.hash}`;
  $('.fallback').hidden = true; $('[data-motion]').disabled = false;
  function paint() {
    const status = online ? snapshot.status : 'offline', working = ['connecting', 'running', 'interrupting'].includes(status);
    $('[data-state]').textContent = `${labels[status] ?? 'Indisponível'} · Invoker`;
    $('[data-caption]').textContent = status === 'running' ? 'Estou elaborando sua resposta.' :
      status === 'offline' ? 'Verifique a conexão para consultar o estado da sessão.' :
      status === 'connecting' ? 'Preparando nossa sessão local.' :
      status === 'interrupting' ? 'Aguardando a confirmação de interrupção do Codex.' :
      status === 'error' ? 'Não foi possível concluir esta sessão.' :
      status === 'interrupted' ? 'Podemos retomar a conversa quando você quiser.' :
      ['ready', 'completed'].includes(status) ? 'Estou aqui. O que vamos explorar?' : 'Conecte o Codex para conversar com o Invoker.';
    $('[data-model]').textContent = snapshot?.model ? `Codex · ${snapshot.model}` : 'Login ChatGPT pelo Codex local';
    $('[data-connect]').disabled = pending || !online || !['disconnected', 'error'].includes(status);
    $('[data-disconnect]').disabled = !online || status === 'disconnected';
    $('[data-refresh]').hidden = online || !token;
    $('[data-send]').disabled = pending || !online || working || !['ready', 'completed', 'interrupted'].includes(status);
    $('#message').disabled = $('[data-send]').disabled;
    const audioBusy = ['requesting', 'recording', 'transcribing'].includes(voiceView.state);
    $('[data-send]').disabled ||= audioBusy || $('#message').value.length > 8000;
    $('[data-interrupt]').disabled = !online || !snapshot?.canInterrupt;
    $('[data-motion]').textContent = motion ? 'Pausar movimento' : 'Ativar movimento';
    $('[data-motion]').setAttribute('aria-pressed', String(motion));
    const error = notice || snapshot?.error;
    $('[data-notice]').textContent = error ? `${errors[error] ?? 'Não foi possível concluir. Encerre a sessão e conecte novamente.'} (${error})` :
      voiceView.config.enabled ? 'Canário isolado · sem acesso a projetos · voz opcional' : 'Canário isolado · sem acesso a projetos · conversa por texto';
    $('[data-notice]').dataset.error = String(!!error);
    const visibleMessages = realtimeMode ? realtimeView.messages : snapshot?.messages;
    const signature = JSON.stringify(visibleMessages ?? []);
    if (signature !== shownMessages) {
      const log = $('.messages'), atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;
      const fragment = document.createDocumentFragment();
      for (const message of visibleMessages ?? []) {
        const article = document.createElement('article'), author = document.createElement('strong'), text = document.createElement('p');
        article.className = 'message'; article.dataset.role = message.role;
        author.textContent = message.role === 'user' ? 'VOCÊ' : 'INVOKER'; text.textContent = message.text;
        article.append(author, text); fragment.append(article);
      }
      log.replaceChildren(fragment); if (atEnd) log.scrollTop = log.scrollHeight; shownMessages = signature;
    }
    paintVoice();
    root.dataset.origin = realtimeMode ? 'realtime' : 'codex'; root.dataset.status = status; root.dataset.speaker = (realtimeMode ? realtimeView.speaker : voiceView.state === 'speaking') ? 'invoker' : 'none'; scene?.invalidate();
  }
  function paintVoice() {
    const v = voiceView, panel = $('[data-voice-panel]');
    panel.hidden = v.config.reason === 'E_VOICE_DISABLED' || (!v.config.provider && !v.error);
    panel.dataset.state = v.error ? 'error' : v.state;
    const states = { idle: v.automatic ? 'Voz ativa para novas respostas' : 'Pronto quando você quiser falar', requesting: 'Aguardando microfone…',
      recording: 'Ouvindo você · até 45 segundos', transcribing: 'Transcrevendo sua mensagem…', synthesizing: 'Preparando a voz do Invoker…', speaking: 'Invoker falando', error: 'Não foi possível concluir o áudio.' };
    const code = v.error || v.config.reason;
    $('[data-voice-status]').textContent = code ? voiceErrorMessage(code) : states[v.state];
    $('[data-record]').textContent = v.state === 'recording' ? 'Concluir gravação' : 'Gravar mensagem';
    $('[data-record]').disabled = !v.config.enabled || !online || !['ready', 'completed', 'interrupted'].includes(snapshot?.status) || ['requesting', 'transcribing', 'synthesizing'].includes(v.state);
    $('[data-auto-voice]').disabled = !v.config.enabled || !online;
    $('[data-auto-voice]').textContent = v.automatic ? 'Silenciar respostas' : 'Ouvir respostas';
    $('[data-auto-voice]').setAttribute('aria-pressed', String(v.automatic));
    const microphones = v.microphones ?? [], selected = $('[data-microphone]');
    const signature = JSON.stringify(microphones);
    if (signature !== microphoneSignature) {
      const fragment = document.createDocumentFragment(), option = document.createElement('option');
      option.value = ''; option.textContent = microphones.length ? 'Padrão do navegador' : 'Clique em Escolher microfone para listar as entradas'; fragment.append(option);
      for (const [i, device] of microphones.entries()) {
        if (!device.id) continue;
        const entry = document.createElement('option'); entry.value = device.id; entry.textContent = device.label || `Microfone ${i + 1}`; fragment.append(entry);
      }
      selected.replaceChildren(fragment); microphoneSignature = signature;
    }
    selected.value = v.microphoneId ?? '';
    selected.disabled = !v.config.enabled || !microphones.length || ['requesting', 'transcribing', 'synthesizing'].includes(v.state);
    $('[data-prepare-microphone]').disabled = !v.config.enabled || !online || !['ready', 'completed', 'interrupted'].includes(snapshot?.status) || ['requesting', 'recording', 'transcribing', 'synthesizing'].includes(v.state);
    $('[data-input-meter]').hidden = v.state !== 'recording';
    const rms = v.inputLevel?.rms ?? 0, db = rms > 0 ? 20 * Math.log10(rms) : -100;
    $('[data-input-meter] meter').value = Math.max(0, Math.min(1, (db + 80) / 80));
    $('[data-input-label]').textContent = db < -70 ? 'Sem sinal ou sinal muito baixo' : `Sinal recebido · ${Math.round(db)} dBFS`;
    $('[data-recording]').hidden = !recordingUrl || ['requesting', 'recording', 'transcribing'].includes(v.state);
    $('[data-stop-voice]').disabled = ['idle', 'error'].includes(v.state);
    const times = [['transcriptionMs', 'transcrição'], ['codexMs', 'Codex'], ['responseToAudioMs', 'resposta → áudio']]
      .filter(([key]) => Number.isFinite(v.metrics[key])).map(([key, label]) => `${label}: ${(v.metrics[key] / 1000).toFixed(1)} s`);
    $('[data-voice-metrics]').textContent = v.config.provider ? `Reserva local: US$ ${(v.config.reservedUsd ?? 0).toFixed(2)} / ${(v.config.budgetUsd ?? 0).toFixed(2)} · não é o extrato do provedor${times.length ? ' · ' + times.join(' · ') : ''}` : '';
    if (v.config.provider) { $('.demo').textContent = 'CODEX LOCAL · VOZ OPCIONAL'; $('footer span').textContent = 'SESSÃO LOCAL · P3'; }
    if (v.state === 'speaking') { $('[data-state]').textContent = 'FALANDO · INVOKER'; $('[data-caption]').textContent = 'Minha resposta, em voz.'; }
    else if (v.state === 'recording') { $('[data-state]').textContent = 'OUVINDO · INVOKER'; $('[data-caption]').textContent = 'Estou ouvindo. Conclua a gravação quando terminar.'; }
    realtimeMode = v.config.mode === 'realtime';
    $('[data-realtime-controls]').hidden = !realtimeMode;
    if (realtimeMode) {
      $('[data-record]').parentElement.hidden = true; $('[data-recording]').hidden = true; $('[data-composer]').hidden = true;
      selected.disabled ||= realtimeView.active || realtimeView.phase === 'connecting';
      $('[data-prepare-microphone]').disabled ||= realtimeView.active || realtimeView.phase === 'connecting';
      $('[data-realtime-start]').disabled = !v.config.enabled || !online || !['ready', 'completed', 'interrupted'].includes(snapshot?.status) || realtimeView.active || realtimeView.phase === 'connecting' || v.config.budgetUsd - (realtimeView.reservedUsd ?? 0) < v.config.reservePerSessionUsd;
      $('[data-realtime-mute]').disabled = !realtimeView.active;
      $('[data-realtime-stop]').disabled = !realtimeView.active && realtimeView.phase !== 'connecting';
      $('[data-realtime-mute]').textContent = realtimeView.muted ? 'Ativar microfone' : 'Silenciar microfone';
      const phases = { idle: 'Escolha o microfone e inicie nossa conversa.', connecting: 'Conectando áudio em tempo real…', listening: realtimeView.muted ? 'Microfone silenciado' : 'Estou ouvindo · pode falar naturalmente', thinking: 'Preparando minha resposta…', speaking: 'Invoker falando · você pode interromper pela voz', ended: 'Conversa encerrada', error: 'Não foi possível continuar a conversa.' };
      const rtErrors = { E_REALTIME_TIME: 'O ensaio de 60 segundos terminou.', E_REALTIME_LIMIT: 'Limite de turnos do ensaio atingido.',
        E_REALTIME_NETWORK: 'A conexão de áudio foi perdida. A conversa não será reiniciada automaticamente.', E_REALTIME_PROVIDER: 'O serviço Realtime não concluiu a conexão. Confira acesso ao modelo e saldo.',
        E_REALTIME_TIMEOUT: 'A conexão Realtime demorou além do limite.', E_REALTIME_PROTOCOL: 'Resposta Realtime incompatível.', E_REALTIME_CLOSED: 'O canal de controle foi encerrado.' };
      const rtError = realtimeView.error || v.error || v.config.reason;
      $('[data-voice-status]').textContent = rtError ? rtErrors[rtError] ? `${rtErrors[rtError]} (${rtError})` : voiceErrorMessage(rtError) : phases[realtimeView.phase];
      panel.dataset.state = rtError ? 'error' : realtimeView.phase;
      $('.demo').textContent = 'INVOKER · REALTIME';
      $('.note').textContent = 'Voz pela API OpenAI; análises pelo Codex local. Canário isolado, sem execução em projetos. Nenhuma aprovação de trabalho é concedida pela interface.';
      $('[data-model]').textContent = `Voz · ${v.config.model} | Codex · ${snapshot?.model ?? 'não conectado'}`;
      $('[data-voice-metrics]').textContent = `Reserva local: US$ ${(realtimeView.reservedUsd ?? v.config.reservedUsd ?? 0).toFixed(2)} / ${v.config.budgetUsd.toFixed(2)} · US$ 1 por ensaio · ${realtimeView.remainingSeconds ?? 60} s restantes${realtimeView.work === 'consulting' ? ' · Consultando Codex' : ''}${realtimeView.hangup === 'unconfirmed' ? ' · Encerramento remoto não confirmado' : ''}`;
      $('.voice-disclosure').textContent = 'Conversa por voz gerada por IA · OpenAI Realtime. Ao iniciar, o microfone transmite áudio continuamente à OpenAI. O Codex recebe consultas de análise pela assinatura local. Cobrança da voz por API separada. Ensaio limitado a 60 segundos; encerre quando quiser.';
      $('[data-notice]').textContent = 'Conversa Realtime · ponte Codex para análise · canário isolado, sem acesso a projetos';
      if (realtimeView.active) {
        $('[data-state]').textContent = `${({ speaking: 'FALANDO', thinking: 'PENSANDO' })[realtimeView.phase] ?? 'OUVINDO'} · INVOKER`;
        $('[data-caption]').textContent = phases[realtimeView.phase];
      }
    }
  }
  voice = createVoiceController({ token, onState(value) { if (!disposed) { voiceView = value; paint(); } }, onRecording: setRecording,
    onTranscript(text) { if (!disposed) { const draft = $('#message'); draft.value = [draft.value.trim(), text].filter(Boolean).join('\n');
      if (draft.value.length > 8000) notice = 'E_INPUT'; draft.focus(); } } });
  realtime = createRealtimeConversation({ token, onState(value) { if (!disposed) { realtimeView = value; paint(); } } });
  const client = createPresenceClient({ token, onUpdate(value) {
    if (disposed) return; snapshot = value.snapshot; online = value.online;
    if (value.error) notice = value.error; realtime.sync(snapshot); voice.sync(snapshot, online); paint();
  } });
  async function action(name, text) {
    if (realtimeMode) realtime.stop();
    if (name === 'send') voice.beforeSend(); else voice.stop();
    notice = ''; pending = true; paint();
    try { await client.action(name, text); if (name === 'send') $('#message').value = ''; }
    catch (e) { if (!disposed) notice = /^E_[A-Z_]+$/.test(e.message) ? e.message : 'E_ACTION_UNKNOWN'; }
    finally { if (!disposed) { pending = false; paint(); } }
  }
  $('[data-connect]').addEventListener('click', () => void action('connect'), options);
  $('[data-disconnect]').addEventListener('click', () => void action('disconnect'), options);
  $('[data-interrupt]').addEventListener('click', () => void action('interrupt'), options);
  $('[data-record]').addEventListener('click', () => void voice.record(), options);
  $('[data-microphone]').addEventListener('change', e => voice.selectMicrophone(e.target.value), options);
  $('[data-prepare-microphone]').addEventListener('click', () => { if (realtimeMode) realtime.stop(); void voice.prepareMicrophone(); }, options);
  $('[data-realtime-start]').addEventListener('click', () => { voice.stop(); void realtime.start({ deviceId: voiceView.microphoneId }); }, options);
  $('[data-realtime-stop]').addEventListener('click', () => realtime.stop(), options);
  $('[data-realtime-mute]').addEventListener('click', () => realtime.toggleMute(), options);
  surface.audio.addEventListener('play', () => voice.stop(), options);
  $('[data-auto-voice]').addEventListener('click', () => void voice.toggle(), options);
  $('[data-stop-voice]').addEventListener('click', () => voice.stop(), options);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { voice.stop(); realtime.stop(); setRecording(null); } }, options);
  $('[data-refresh]').addEventListener('click', () => { notice = ''; void client.refresh(); }, options);
  $('[data-composer]').addEventListener('submit', e => { e.preventDefault(); if (!$('[data-send]').disabled) void action('send', $('#message').value); }, options);
  $('#message').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!$('[data-send]').disabled) void action('send', $('#message').value); }
  }, options);
  $('#message').addEventListener('input', () => { if (notice === 'E_INPUT') notice = ''; paint(); }, options);
  $('[data-motion]').addEventListener('click', () => { motion = !motion; paint(); }, options);
  const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; scene?.invalidate(); }); observer.observe($('.world'));
  const unavailable = () => { if (disposed) return; scene?.dispose(); scene = undefined; surface.canvas.hidden = true;
    $('.fallback').hidden = false; root.dataset.engine = 'fallback'; $('[data-motion]').disabled = true; };
  import('./renderer.mjs').then(({ createPresenceRenderer }) => {
    if (disposed) return;
    scene = createPresenceRenderer({ canvas: surface.canvas, world: $('.world'), onUnavailable: unavailable,
      read: () => ({ ...(realtimeMode ? realtime.sample() : voice.sample()), status: realtimeMode && realtimeView.active ? realtimeView.phase === 'thinking' ? 'processing' : 'listening' : voiceView.state === 'recording' ? 'listening' : online && snapshot?.status === 'running' ? 'processing' : 'available',
        speaker: realtimeMode ? realtimeView.speaker : voiceView.state === 'speaking' ? 'invoker' : null, focus: 'invoker', specialist: null, visible, motion }) });
    root.dataset.engine = 'three-webgl2'; scene.invalidate();
  }).catch(unavailable);
  paint(); if (/^[a-f0-9]{64}$/.test(token ?? '')) { void client.refresh(); void voice.init(); } else { notice = 'E_SESSION'; paint(); }
  return { dispose() { disposed = true; events.abort(); observer.disconnect(); voice.dispose(); realtime.dispose(); client.dispose(); scene?.dispose(); } };
}
startPageLifecycle(window, mount);
