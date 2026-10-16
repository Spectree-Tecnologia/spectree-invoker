import { createVoiceCapture } from './voice-capture.mjs';
import { createVoicePlayer } from './voice-player.mjs';
import { speechParts } from './voice-format.mjs';

export function toBase64(bytes) {
  let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(text);
}
export function fromBase64(text) { return Uint8Array.from(atob(text), c => c.charCodeAt(0)); }

export function createVoiceController({ token, onState, onTranscript, fetcher = fetch,
  captureFactory = createVoiceCapture, playerFactory = createVoicePlayer, now = () => performance.now() }) {
  let config = { enabled: false }, snapshot, online = false, disposed = false, generation = 0, automatic = false;
  let state = 'idle', error = null, metrics = {}, controller, operationId, previousSession, awaitingAt, audioStartedAt;
  const seen = new Set();
  const emit = () => onState({ config, state, error, automatic, metrics });
  const player = playerFactory({ onState(type) {
    state = type === 'speaking' ? 'speaking' : type === 'interrupted' ? 'error' : 'synthesizing';
    if (type === 'speaking' && audioStartedAt !== undefined) { metrics = { ...metrics, responseToAudioMs: now() - audioStartedAt }; audioStartedAt = undefined; }
    if (type === 'interrupted') error = 'E_AUDIO_PLAYBACK'; emit();
  } });
  async function request(path, body, signal) {
    const response = await fetcher(`/presence/api/voice/${path}`, { method: body ? 'POST' : 'GET', signal,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.error ?? 'E_AUDIO_PROVIDER'), { reservedUsd: value.reservedUsd }); return value;
  }
  function serverCancel(targetRequestId) {
    if (!snapshot || !config.enabled || !targetRequestId) return;
    void request('action', { action: 'cancel', targetRequestId, sessionId: snapshot.sessionId, requestId: crypto.randomUUID() }, AbortSignal.timeout(10000)).catch(() => {});
  }
  function stop(notifyServer = true) {
    generation++; const target = operationId; operationId = undefined;
    controller?.abort(); controller = undefined; capture.cancel(); player.stop();
    state = 'idle'; error = null; audioStartedAt = undefined; if (notifyServer) serverCancel(target); if (!disposed) emit();
  }
  async function operation(input, epoch) {
    controller = new AbortController(); const current = controller;
    operationId = crypto.randomUUID(); const requestId = operationId;
    const timer = setTimeout(() => current.abort(), 35000);
    try {
      const value = await request('action', { ...input, sessionId: snapshot.sessionId, requestId }, current.signal);
      if (disposed || epoch !== generation) throw new Error('E_AUDIO_CANCELLED');
      if (value.reservedUsd !== undefined) config = { ...config, reservedUsd: value.reservedUsd };
      return value;
    } catch (e) {
      if (epoch === generation && Number.isFinite(e.reservedUsd)) config = { ...config, reservedUsd: e.reservedUsd };
      throw e;
    } finally { clearTimeout(timer); if (controller === current) { controller = undefined; operationId = undefined; } }
  }
  const capture = captureFactory({ onState(value) { state = value; emit(); }, onError(code) { state = 'error'; error = code; emit(); },
    async onComplete(bytes) {
      const epoch = generation; state = 'transcribing'; error = null; emit();
      try { const value = await operation({ action: 'transcribe', audio: toBase64(bytes) }, epoch);
        metrics = { ...metrics, transcriptionMs: value.elapsedMs }; state = 'idle'; onTranscript(value.text); emit();
      } catch (e) { if (!disposed && epoch === generation) { state = 'error'; error = e.message; emit(); } }
    },
  });
  async function speak(message) {
    const epoch = ++generation; audioStartedAt = now();
    try {
      const parts = speechParts(message.text);
      for (let part = 0; part < parts.length; part++) {
        if (disposed || epoch !== generation) return;
        state = 'synthesizing'; emit();
        const value = await operation({ action: 'speak', messageId: message.id, part }, epoch);
        metrics = { ...metrics, synthesisMs: value.elapsedMs };
        if (!await player.play(fromBase64(value.audio), value.sampleRate) || epoch !== generation) return;
      }
      state = 'idle'; emit();
    } catch (e) { if (!disposed && epoch === generation) { player.stop(); state = 'error'; error = e.message; emit(); } }
  }
  return {
    async init() {
      try { const value = await request('config', undefined, AbortSignal.timeout(10000)); if (!disposed) { config = value; emit(); } }
      catch { if (!disposed) { error = 'E_AUDIO_CONFIG'; emit(); } }
    },
    sync(value, connected) {
      if (disposed) return;
      const changedSession = value && previousSession && value.sessionId !== previousSession;
      snapshot = value; online = connected;
      if (changedSession) { automatic = false; stop(false); seen.clear(); awaitingAt = undefined; }
      previousSession = value?.sessionId;
      if (!online || !value || ['error', 'disconnected', 'connecting', 'interrupting', 'interrupted'].includes(value.status)) {
        if (state !== 'idle' && state !== 'error') stop(); return;
      }
      if (value.status === 'running') {
        if (!['idle', 'error'].includes(state)) stop(false);
        awaitingAt ??= now(); return;
      }
      if (value.status !== 'completed') return;
      const message = value.messages.at(-1); if (message?.role !== 'assistant') return;
      const id = `${value.sessionId}:${message.turnId}:${message.id}`;
      if (seen.has(id)) return;
      seen.add(id);
      if (awaitingAt !== undefined) { metrics = { ...metrics, codexMs: now() - awaitingAt }; awaitingAt = undefined; }
      if (automatic && config.enabled && ['idle', 'error'].includes(state)) { error = null; void speak(message); }
    },
    async toggle() {
      if (automatic) { automatic = false; stop(); return; }
      if (!config.enabled || !online) return;
      try { await player.unlock(); if (disposed) return; automatic = true; error = null; emit(); }
      catch { error = 'E_AUDIO_PLAYBACK'; emit(); }
    },
    async record() {
      if (!config.enabled || !online || !['ready', 'completed', 'interrupted'].includes(snapshot?.status)) return;
      if (state === 'recording') { capture.finish(); return; }
      // No cancellation request races the new operation: the prior request is aborted
      // and a busy provider must finish cancellation before a new billable call.
      stop(false); await capture.start();
    },
    beforeSend() { stop(false); awaitingAt = now(); }, stop,
    sample: () => player.sample(),
    dispose() { if (disposed) return; stop(); disposed = true; capture.dispose(); player.dispose(); },
  };
}
