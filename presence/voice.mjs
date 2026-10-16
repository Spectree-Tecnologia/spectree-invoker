import { createVoiceCapture } from './voice-capture.mjs';
import { createVoicePlayer } from './voice-player.mjs';
import { speechParts } from './voice-format.mjs';

const safeCode = (error, fallback) => /^E_[A-Z_]{1,60}$/.test(error?.message ?? '') ? error.message : fallback;
const explanations = {
  E_AUDIO_KEY: 'Configure OPENAI_API_KEY no terminal que inicia a Presence.',
  E_VOICE_BUDGET: 'Limite local de chamadas atingido ou orçamento não configurado.',
  E_AUDIO_CONFIG: 'Não foi possível consultar a configuração de voz.',
  E_MIC_PERMISSION: 'Permita o microfone nas permissões desta página e clique em Escolher microfone para listar as entradas.',
  E_MIC_UNAVAILABLE: 'Não foi possível abrir essa entrada de áudio. Use Escolher microfone e selecione outro dispositivo na lista.',
  E_MIC_TIMEOUT: 'A permissão do microfone demorou. Tente novamente quando estiver pronto.',
  E_MIC_LOST: 'O microfone foi desconectado.',
  E_AUDIO_SHORT: 'Grave ao menos meio segundo de áudio.',
  E_MIC_SILENT: 'A gravação ficou silenciosa. Confira o microfone selecionado e se ele está silenciado antes de gravar novamente. Nenhum áudio foi enviado.',
  E_TRANSCRIPT: 'Não foi possível reconhecer fala nesta gravação. Ouça a gravação local abaixo e confira o microfone selecionado antes de gravar novamente.',
  E_TRANSCRIPT_RESPONSE: 'O serviço retornou uma transcrição em formato inesperado. A gravação local continua disponível para conferência.',
  E_TRANSCRIPT_LIMIT: 'A transcrição excedeu o limite de texto. Grave uma mensagem mais curta.',
  E_AUDIO_FORMAT: 'O formato de áudio foi recusado. Faça uma nova gravação; se persistir, confira o dispositivo de áudio.',
  E_AUDIO_LIMIT: 'O áudio excedeu o limite permitido. Grave uma mensagem mais curta.',
  E_AUDIO_PLAYBACK: 'Não foi possível reproduzir o áudio. Desative e ative Ouvir respostas novamente.',
  E_AUDIO_NETWORK: 'A conexão de áudio falhou. Verifique a conexão antes de tentar uma nova gravação. O pedido anterior não será reenviado.',
  E_AUDIO_TIMEOUT: 'O áudio demorou além do limite. O pedido não será repetido automaticamente.',
  E_AUDIO_RESPONSE: 'A resposta do serviço de áudio não pôde ser lida. O pedido não será repetido automaticamente.',
  E_VOICE_DUPLICATE: 'Este áudio já foi solicitado. Ele não será cobrado novamente automaticamente.',
  E_AUDIO_CANCELLED: 'Áudio interrompido. Nenhuma operação será repetida automaticamente.',
  E_VOICE_BUSY: 'O áudio anterior ainda está sendo encerrado. Tente novamente.',
  E_NOT_READY: 'Aguarde a conclusão da resposta antes de gravar novamente.',
  E_STALE_SESSION: 'A sessão mudou durante o áudio. Confira a conexão antes de gravar novamente.',
  E_SPEECH_SOURCE: 'Essa resposta não está mais disponível para síntese. Continue com uma nova mensagem.',
  E_AUDIO_PROVIDER: 'O serviço de áudio falhou. Confira a chave e o saldo; o texto continua disponível.',
};
export function voiceErrorMessage(code) {
  const safe = safeCode({ message: code }, 'E_AUDIO_UNKNOWN');
  return `${explanations[safe] ?? 'Não foi possível concluir o áudio. Continue por texto.'} (${safe})`;
}

export function toBase64(bytes) {
  let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(text);
}
export function fromBase64(text) { return Uint8Array.from(atob(text), c => c.charCodeAt(0)); }

export function createVoiceController({ token, onState, onTranscript, onRecording = () => {}, fetcher = fetch,
  captureFactory = createVoiceCapture, playerFactory = createVoicePlayer, now = () => performance.now() }) {
  let config = { enabled: false }, snapshot, online = false, disposed = false, generation = 0, automatic = false;
  let state = 'idle', error = null, metrics = {}, controller, operationId, previousSession, awaitingAt, audioStartedAt;
  let microphones = [], microphoneId = '', inputLevel = { energy: 0, rms: 0 };
  const seen = new Set();
  const emit = () => onState({ config, state, error, automatic, metrics, microphones, microphoneId, inputLevel });
  const player = playerFactory({ onState(type) {
    state = type === 'speaking' ? 'speaking' : type === 'interrupted' ? 'error' : 'synthesizing';
    if (type === 'speaking' && audioStartedAt !== undefined) { metrics = { ...metrics, responseToAudioMs: now() - audioStartedAt }; audioStartedAt = undefined; }
    if (type === 'interrupted') error = 'E_AUDIO_PLAYBACK'; emit();
  } });
  async function request(path, body, signal) {
    let response;
    try { response = await fetcher(`/presence/api/voice/${path}`, { method: body ? 'POST' : 'GET', signal,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch { throw new Error(signal?.aborted ? 'E_AUDIO_TIMEOUT' : 'E_AUDIO_NETWORK'); }
    let value;
    try { value = await response.json(); }
    catch { throw new Error(signal?.aborted ? 'E_AUDIO_TIMEOUT' : 'E_AUDIO_RESPONSE'); }
    if (!value || typeof value !== 'object') throw new Error('E_AUDIO_RESPONSE');
    if (!response.ok) throw Object.assign(new Error(safeCode({ message: value.error }, 'E_AUDIO_PROVIDER')), { reservedUsd: value.reservedUsd }); return value;
  }
  function serverCancel(targetRequestId) {
    if (!snapshot || !config.enabled || !targetRequestId) return;
    void request('action', { action: 'cancel', targetRequestId, sessionId: snapshot.sessionId, requestId: crypto.randomUUID() }, AbortSignal.timeout(10000)).catch(() => {});
  }
  function stop(notifyServer = true) {
    generation++; const target = operationId; operationId = undefined;
    controller?.abort(); controller = undefined; capture.cancel(); player.stop();
    state = 'idle'; error = null; audioStartedAt = undefined; inputLevel = { energy: 0, rms: 0 }; if (notifyServer) serverCancel(target); if (!disposed) emit();
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
    onDevices(devices, selected) {
      if (disposed) return; microphones = devices;
      if (selected !== undefined) microphoneId = selected;
      if (microphoneId && !devices.some(d => d.id === microphoneId)) microphoneId = '';
      emit();
    },
    onLevel(value) { if (disposed) return; inputLevel = value; emit(); },
    async onComplete(bytes) {
      const epoch = generation; state = 'transcribing'; error = null; emit();
      onRecording(bytes);
      try { const value = await operation({ action: 'transcribe', audio: toBase64(bytes) }, epoch);
        metrics = { ...metrics, transcriptionMs: value.elapsedMs }; state = 'idle'; onTranscript(value.text); emit();
      } catch (e) { if (!disposed && epoch === generation) { state = 'error'; error = safeCode(e, 'E_AUDIO_RESPONSE'); emit(); } }
    },
  });
  async function speak(message) {
    const epoch = ++generation; audioStartedAt = now(); let playing = false;
    try {
      const parts = speechParts(message.text);
      for (let part = 0; part < parts.length; part++) {
        if (disposed || epoch !== generation) return;
        state = 'synthesizing'; emit();
        const value = await operation({ action: 'speak', messageId: message.id, part }, epoch);
        metrics = { ...metrics, synthesisMs: value.elapsedMs };
        playing = true;
        if (!await player.play(fromBase64(value.audio), value.sampleRate) || epoch !== generation) return;
        playing = false;
      }
      state = 'idle'; emit();
    } catch (e) { if (!disposed && epoch === generation) { player.stop(); state = 'error'; error = safeCode(e, playing ? 'E_AUDIO_PLAYBACK' : 'E_AUDIO_RESPONSE'); emit(); } }
  }
  return {
    async init() {
      try { const value = await request('config', undefined, AbortSignal.timeout(10000)); if (!disposed) { config = value; emit(); if (config.enabled) await capture.listDevices?.(); } }
      catch { if (!disposed) { error = 'E_AUDIO_CONFIG'; emit(); } }
    },
    sync(value, connected) {
      if (disposed) return;
      const changedSession = value && previousSession && value.sessionId !== previousSession;
      snapshot = value; online = connected;
      if (changedSession) { automatic = false; stop(false); seen.clear(); awaitingAt = undefined; onRecording(null); }
      previousSession = value?.sessionId;
      if (!online || !value || ['error', 'disconnected', 'connecting', 'interrupting', 'interrupted'].includes(value.status)) {
        onRecording(null);
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
      stop(false); onRecording(null); await capture.start({ deviceId: microphoneId });
    },
    async prepareMicrophone() {
      if (disposed || !config.enabled || !online || !['ready', 'completed', 'interrupted'].includes(snapshot?.status)) return;
      stop(false); onRecording(null); await capture.prepare?.();
    },
    selectMicrophone(id) { if (microphones.some(d => d.id === id) || id === '') { stop(); microphoneId = id; onRecording(null); emit(); } },
    beforeSend() { stop(false); onRecording(null); awaitingAt = now(); }, stop,
    sample: () => state === 'recording' ? capture.sample?.() ?? { energy: 0, rms: 0 } : player.sample(),
    dispose() { if (disposed) return; stop(); disposed = true; capture.dispose(); player.dispose(); onRecording(null); },
  };
}
