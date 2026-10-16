import { encodeWav, MAX_SECONDS } from './voice-format.mjs';

export function createVoiceCapture({ onState, onComplete, onError, environment = globalThis }) {
  let generation = 0, stream, context, source, node, timer, chunks = [], length = 0, recording = false;
  function cleanup() {
    clearTimeout(timer); recording = false;
    if (node) { node.port.onmessage = null; node.disconnect(); node.port.close(); }
    source?.disconnect(); stream?.getTracks().forEach(track => track.stop());
    void context?.close().catch(() => {}); stream = context = source = node = undefined;
  }
  function cancel() { generation++; cleanup(); chunks = []; length = 0; }
  function finish() {
    if (!recording) return;
    const rate = context.sampleRate, samples = new Float32Array(length); let offset = 0;
    for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
    cancel();
    if (samples.length < rate / 2) { onError('E_AUDIO_SHORT'); return; }
    onComplete(encodeWav(samples, rate));
  }
  return {
    async start() {
      cancel(); const epoch = generation; onState('requesting');
      if (!environment.navigator?.mediaDevices?.getUserMedia || !environment.AudioWorkletNode) { onError('E_MIC_UNAVAILABLE'); return; }
      timer = setTimeout(() => { if (epoch === generation) { cancel(); onError('E_MIC_TIMEOUT'); } }, 15000);
      try {
        const obtained = await environment.navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (epoch !== generation) { obtained.getTracks().forEach(track => track.stop()); return; }
        stream = obtained; context = new environment.AudioContext(); const current = context;
        await current.audioWorklet.addModule('./voice-worklet.mjs');
        if (epoch !== generation) return;
        source = current.createMediaStreamSource(obtained);
        node = new environment.AudioWorkletNode(current, 'presence-capture');
        node.port.onmessage = event => {
          if (epoch !== generation) return;
          if (event.data.samples) {
            const remaining = MAX_SECONDS * current.sampleRate - length;
            const chunk = event.data.samples.subarray(0, remaining); chunks.push(chunk); length += chunk.length;
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
      } catch (e) { if (epoch === generation) { cancel(); onError(e.name === 'NotAllowedError' ? 'E_MIC_PERMISSION' : 'E_MIC_UNAVAILABLE'); } }
    }, finish, cancel, dispose: cancel,
  };
}
