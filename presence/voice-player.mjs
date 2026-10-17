import { audioEnergy } from './audio.mjs';
export function createVoicePlayer({ createContext = () => new AudioContext(), onState = () => {} } = {}) {
  let context, analyser, samples, source, resolvePlay, generation = 0, disposed = false, audible = false;
  async function unlock() {
    if (disposed) throw new Error('E_AUDIO_DISPOSED');
    if (!context) { context = createContext(); analyser = context.createAnalyser(); analyser.fftSize = 1024;
      samples = new Float32Array(analyser.fftSize); analyser.connect(context.destination); }
    context.onstatechange = () => { if (!disposed && audible && context.state !== 'running') { stop(); onState('interrupted'); } };
    await context.resume();
    if (context.state !== 'running') throw new Error('E_AUDIO_PLAYBACK');
  }
  function stop() {
    generation++; audible = false;
    if (source) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); source = undefined; }
    const done = resolvePlay; resolvePlay = undefined; done?.(false);
  }
  return { unlock, stop,
    async play(bytes, sampleRate = 24000) {
      stop(); const epoch = generation; await unlock();
      if (disposed || epoch !== generation) return false;
      if (sampleRate !== 24000 || !bytes.length || bytes.length % 2 || bytes.length > 5760000) throw new Error('E_AUDIO_FORMAT');
      const buffer = context.createBuffer(1, bytes.length / 2, sampleRate), channel = buffer.getChannelData(0);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = 0; i < channel.length; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
      source = context.createBufferSource(); source.buffer = buffer; source.connect(analyser);
      return new Promise((resolve, reject) => {
        resolvePlay = resolve;
        source.onended = () => { if (epoch !== generation) return; audible = false; source.disconnect(); source = undefined; resolvePlay = undefined; onState('ended'); resolve(true); };
        try { source.start(); audible = true; onState('speaking'); }
        catch { resolvePlay = undefined; stop(); reject(new Error('E_AUDIO_PLAYBACK')); }
      });
    },
    sample() {
      if (!audible || context?.state !== 'running') return { energy: 0, rms: 0 };
      analyser.getFloatTimeDomainData(samples); return audioEnergy(samples);
    },
    dispose() { if (disposed) return; stop(); disposed = true; if (context) context.onstatechange = null; analyser?.disconnect(); void context?.close().catch(() => {}); },
  };
}
