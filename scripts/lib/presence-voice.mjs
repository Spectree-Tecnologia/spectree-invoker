import { createHash } from 'node:crypto';
import { wavDuration, speechParts } from '../../presence/voice-format.mjs';

const fail = code => Object.assign(new Error(code), { code });
async function readBounded(response, max) {
  const reader = response.body?.getReader(); if (!reader) throw fail('E_AUDIO_PROVIDER');
  const chunks = []; let total = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break;
      total += value.length; if (total > max) throw fail('E_AUDIO_LIMIT'); chunks.push(Buffer.from(value)); }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function createOpenAiAudio({ key = process.env.OPENAI_API_KEY, fetcher = fetch } = {}) {
  return { ready: !!key?.trim(), name: 'OpenAI',
    async transcribe(bytes, signal) {
      const form = new FormData(); form.set('model', 'gpt-4o-mini-transcribe'); form.set('language', 'pt');
      form.set('response_format', 'json'); form.set('file', new Blob([bytes], { type: 'audio/wav' }), 'capture.wav');
      const response = await fetcher('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal, redirect: 'error' });
      if (!response.ok) { await response.body?.cancel(); throw fail('E_AUDIO_PROVIDER'); }
      const value = JSON.parse((await readBounded(response, 64000)).toString('utf8'));
      if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 8000) throw fail('E_TRANSCRIPT');
      return value.text.trim();
    },
    async speak(text, signal) {
      const response = await fetcher('https://api.openai.com/v1/audio/speech', { method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal, redirect: 'error',
        body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'marin', input: text, response_format: 'pcm',
          instructions: 'Fale em português brasileiro, com clareza, naturalidade e serenidade. Leia o texto fornecido, sem acrescentar conteúdo.' }) });
      if (!response.ok) { await response.body?.cancel(); throw fail('E_AUDIO_PROVIDER'); }
      const bytes = await readBounded(response, 24000 * 2 * 120);
      if (!bytes.length || bytes.length % 2) throw fail('E_AUDIO_FORMAT'); return bytes;
    },
  };
}

export function createPresenceVoice({ session, provider, budgetUsd = 0, now = Date.now }) {
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0 || budgetUsd > 2) throw fail('E_VOICE_BUDGET');
  let active, closed = false, reservedCents = 0;
  const requests = new Set(), spoken = new Set();
  const config = () => ({ enabled: !closed && !!provider?.ready && budgetUsd >= .1, provider: provider?.name ?? null,
    reason: !provider?.ready ? 'E_AUDIO_KEY' : budgetUsd < .1 ? 'E_VOICE_BUDGET' : null,
    budgetUsd, reservedUsd: reservedCents / 100, maxSeconds: 45, voice: 'marin', synthetic: true });
  const cancel = requestId => {
    if (requestId !== undefined && active?.requestId !== requestId) return;
    const previous = active; active = undefined; previous?.controller.abort();
  };
  const monitor = setInterval(() => {
    if (active && (session.snapshot().sessionId !== active.sessionId || session.snapshot().revision !== active.revision)) cancel();
  }, 500); monitor.unref();
  async function action(input) {
    if (!input || !['transcribe', 'speak', 'cancel'].includes(input.action) ||
      Object.keys(input).some(k => !['action', 'sessionId', 'requestId', 'audio', 'messageId', 'part', 'targetRequestId'].includes(k)) ||
      typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(input.requestId)) throw fail('E_INPUT');
    const snapshot = session.snapshot();
    if (input.sessionId !== snapshot.sessionId) throw fail('E_STALE_SESSION');
    if (input.action === 'cancel') {
      if (typeof input.targetRequestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(input.targetRequestId)) throw fail('E_INPUT');
      cancel(input.targetRequestId); return { cancelled: true };
    }
    if (input.targetRequestId !== undefined) throw fail('E_INPUT');
    if (!config().enabled) throw fail(config().reason ?? 'E_VOICE_DISABLED');
    if (!['ready', 'completed', 'interrupted'].includes(snapshot.status)) throw fail('E_NOT_READY');
    if (requests.has(input.requestId)) throw fail('E_VOICE_DUPLICATE');
    if (active) throw fail('E_VOICE_BUSY');
    let bytes, text, speechKey;
    if (input.action === 'transcribe') {
      if (typeof input.audio !== 'string' || input.audio.length > 1920060 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.audio) ||
        input.messageId !== undefined || input.part !== undefined) throw fail('E_AUDIO_FORMAT');
      bytes = Buffer.from(input.audio, 'base64');
      if (bytes.toString('base64') !== input.audio) throw fail('E_AUDIO_FORMAT');
      try { wavDuration(bytes); } catch { throw fail('E_AUDIO_FORMAT'); }
    } else {
      const last = snapshot.messages.at(-1);
      if (snapshot.status !== 'completed' || last?.role !== 'assistant' || last.id !== input.messageId ||
        input.audio !== undefined || !Number.isInteger(input.part) || input.part < 0) throw fail('E_SPEECH_SOURCE');
      text = speechParts(last.text)[input.part]; if (!text) throw fail('E_SPEECH_SOURCE');
      speechKey = createHash('sha256').update(`${snapshot.sessionId}\0${last.turnId}\0${last.id}\0${input.part}`).digest('hex');
      if (spoken.has(speechKey)) throw fail('E_VOICE_DUPLICATE');
    }
    // Reserve before issuing a potentially billed request, including failures and cancellation.
    if (reservedCents + 10 > Math.floor(budgetUsd * 100)) throw fail('E_VOICE_BUDGET');
    reservedCents += 10; requests.add(input.requestId); if (speechKey) spoken.add(speechKey);
    const operation = { controller: new AbortController(), requestId: input.requestId, sessionId: snapshot.sessionId, revision: snapshot.revision };
    active = operation; const started = now();
    const timer = setTimeout(() => operation.controller.abort(), 30000);
    try {
      const value = input.action === 'transcribe' ? await provider.transcribe(bytes, operation.controller.signal) : await provider.speak(text, operation.controller.signal);
      if (closed || active !== operation || operation.controller.signal.aborted || session.snapshot().sessionId !== operation.sessionId ||
        session.snapshot().revision !== operation.revision) throw fail('E_AUDIO_CANCELLED');
      return { ...(input.action === 'transcribe' ? { text: value } : { audio: value.toString('base64'), sampleRate: 24000, messageId: input.messageId, part: input.part }),
        elapsedMs: now() - started, reservedUsd: reservedCents / 100 };
    } catch (e) { throw fail(operation.controller.signal.aborted ? 'E_AUDIO_CANCELLED' :
      ['E_AUDIO_LIMIT', 'E_AUDIO_FORMAT', 'E_TRANSCRIPT', 'E_AUDIO_CANCELLED'].includes(e.code) ? e.code : 'E_AUDIO_PROVIDER'); }
    finally { clearTimeout(timer); if (active === operation) active = undefined; }
  }
  return { config, action, cancel, close() { closed = true; clearInterval(monitor); cancel(); } };
}
