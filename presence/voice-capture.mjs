import { encodeWav, MAX_SECONDS } from './voice-format.mjs';
import { audioEnergy } from './audio.mjs';

export function createVoiceCapture({ onState, onComplete, onError, onDevices = () => {}, onLevel = () => {}, environment = globalThis }) {
  let generation = 0, stream, context, source, node, timer, chunks = [], length = 0, recording = false;
  let level = { energy: 0, rms: 0 };
  let lastLevelAt = 0;
  function cleanup() {
    clearTimeout(timer); recording = false; level = { energy: 0, rms: 0 };
    if (node) { node.port.onmessage = null; node.disconnect(); node.port.close(); }
    source?.disconnect(); stream?.getTracks().forEach(track => track.stop());
    void context?.close().catch(() => {}); stream = context = source = node = undefined;
  }
  function cancel() { generation++; cleanup(); chunks = []; length = 0; }
  async function listDevices(selected, epoch = generation) {
    const media = environment.navigator?.mediaDevices;
    if (!media?.enumerateDevices) return [];
    try {
      const devices = (await media.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId)
        .map(d => ({ id: d.deviceId, label: d.label }));
      if (epoch !== generation) return [];
      onDevices(devices, selected); return devices;
    } catch { return []; }
  }
  function finish() {
    if (!recording) return;
    const rate = context.sampleRate, samples = new Float32Array(length); let offset = 0;
    for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
    cancel();
    if (samples.length < rate / 2) { onError('E_AUDIO_SHORT'); return; }
    let peak = 0;
    for (const value of samples) if (Number.isFinite(value)) peak = Math.max(peak, Math.abs(value));
    if (peak < .0001) { onError('E_MIC_SILENT'); return; }
    let bytes;
    try { bytes = encodeWav(samples, rate); }
    catch (e) { onError(['E_AUDIO_LIMIT', 'E_AUDIO_FORMAT'].includes(e.message) ? e.message : 'E_AUDIO_FORMAT'); return; }
    onComplete(bytes);
  }
  return {
    listDevices,
    async prepare() {
      cancel(); const epoch = generation; onState('requesting');
      timer = setTimeout(() => { if (epoch === generation) { cancel(); onError('E_MIC_TIMEOUT'); } }, 15000);
      const devices = await listDevices(undefined, epoch);
      if (epoch !== generation) return;
      // Existing permission lets the operator select an input without opening the default.
      if (devices.some(d => d.label)) { clearTimeout(timer); onState('idle'); return; }
      const media = environment.navigator?.mediaDevices;
      if (!media?.getUserMedia) { clearTimeout(timer); onError('E_MIC_UNAVAILABLE'); return; }
      let failure;
      try {
        const obtained = await media.getUserMedia({ audio: true });
        // Permission probe only: never create an AudioContext, recording or API call.
        obtained.getTracks().forEach(track => track.stop());
      } catch (e) { failure = e.name === 'NotAllowedError' ? 'E_MIC_PERMISSION' : 'E_MIC_UNAVAILABLE'; }
      if (epoch !== generation) return;
      // Some drivers fail to open the default USB input even after permission is granted.
      // Enumeration must still run so the integrated microphone remains selectable.
      await listDevices(undefined, epoch);
      if (epoch !== generation) return;
      clearTimeout(timer); if (failure) onError(failure); else onState('idle');
    },
    async start({ deviceId = '' } = {}) {
      cancel(); const epoch = generation; onState('requesting');
      if (!environment.navigator?.mediaDevices?.getUserMedia || !environment.AudioWorkletNode) { onError('E_MIC_UNAVAILABLE'); return; }
      timer = setTimeout(() => { if (epoch === generation) { cancel(); onError('E_MIC_TIMEOUT'); } }, 15000);
      try {
        const media = environment.navigator.mediaDevices;
        const obtained = await media.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } });
        if (epoch !== generation) { obtained.getTracks().forEach(track => track.stop()); return; }
        stream = obtained; context = new environment.AudioContext(); const current = context;
        // Device labels become available after the operator grants microphone access.
        // Only the local UI receives these identifiers; they never enter an API request.
        void listDevices(obtained.getAudioTracks?.()[0]?.getSettings?.().deviceId ?? deviceId, epoch);
        await current.audioWorklet.addModule('./voice-worklet.mjs');
        if (epoch !== generation) return;
        source = current.createMediaStreamSource(obtained);
        node = new environment.AudioWorkletNode(current, 'presence-capture');
        node.port.onmessage = event => {
          if (epoch !== generation) return;
          if (event.data.samples) {
            const remaining = MAX_SECONDS * current.sampleRate - length;
            const chunk = event.data.samples.subarray(0, remaining); chunks.push(chunk); length += chunk.length;
            level = audioEnergy(chunk);
            if (Date.now() - lastLevelAt >= 100) { lastLevelAt = Date.now(); onLevel({ ...level }); }
          }
          if (event.data.complete) finish();
        };
        source.connect(node); node.connect(current.destination); await current.resume();
        if (epoch !== generation) return;
        recording = true; clearTimeout(timer); timer = setTimeout(finish, MAX_SECONDS * 1000);
        obtained.getTracks().forEach(track => track.addEventListener('ended', () => {
          if (epoch === generation) { cancel(); onError('E_MIC_LOST'); }
        }, { once: true }));
        onState('recording');
      } catch (e) { if (epoch === generation) { cancel(); void listDevices(); onError(e.name === 'NotAllowedError' ? 'E_MIC_PERMISSION' : 'E_MIC_UNAVAILABLE'); } }
    }, finish, cancel, sample: () => ({ ...level }), dispose: cancel,
  };
}
