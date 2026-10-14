export const TRACKS = Object.freeze([
  { speaker: 'invoker', url: './audio/invoker-intro.mp3', text: 'Olá, Gilson. Eu sou o Invoker. Para planejar sua próxima ideia, vou chamar o Architect.' },
  { speaker: 'architect', url: './audio/architect.mp3', text: 'Sou o Architect. Vamos transformar essa ideia em uma estrutura clara.' },
  { speaker: 'invoker', url: './audio/invoker-return.mp3', text: 'E juntos, vamos dar forma ao que você imagina.' },
]);
export function audioEnergy(samples) {
  if (!samples.length) return { rms: 0, energy: 0 };
  let sum = 0;
  for (const value of samples) sum += value * value;
  const rms = Math.sqrt(sum / samples.length);
  return { rms, energy: Math.min(1, Math.max(0, (rms - .004) * 8)) };
}

// Lifecycle is injectable so interruption races are exercised without a browser microphone.
export function createAudioPlayer(audio, { onEvent, createContext = () => new AudioContext(),
  schedule = setTimeout, unschedule = clearTimeout } = {}) {
  let context, source, analyser, samples, timer, generation = 0, index = 0, loaded = -1;
  let running = false, disposed = false, completed = false, audible = false;
  const listeners = new AbortController();
  const notify = (type, extra = {}) => onEvent?.({ type, index, track: TRACKS[index], ...extra });
  function stop(type = 'pause') {
    generation++; running = false; audible = false; unschedule(timer); timer = null;
    audio.pause(); notify(type);
  }
  async function playTrack(id) {
    if (disposed || !running || id !== generation) return;
    notify('loading');
    if (loaded !== index) { audio.src = TRACKS[index].url; loaded = index; }
    try {
      await audio.play();
      // A superseded play promise must not stop a newer, explicitly started turn.
      if ((disposed || !running) && id !== generation) audio.pause();
    } catch {
      if (!disposed && running && id === generation) stop('error');
    }
  }
  audio.addEventListener('playing', () => {
    if (disposed || !running) { audio.pause(); return; }
    audible = true; notify('speaking');
  }, { signal: listeners.signal });
  audio.addEventListener('waiting', () => { if (running) { audible = false; notify('loading'); } }, { signal: listeners.signal });
  audio.addEventListener('ended', () => {
    if (!running || disposed) return;
    audible = false; notify('ended');
    if (index === TRACKS.length - 1) { completed = true; stop('complete'); return; }
    index++; const id = generation;
    notify('between'); timer = schedule(() => { timer = null; void playTrack(id); }, 550);
  }, { signal: listeners.signal });
  audio.addEventListener('error', () => { if (running && !disposed) stop('error'); }, { signal: listeners.signal });
  return {
    get running() { return running; },
    get completed() { return completed; },
    async play() {
      if (disposed || running) return;
      if (completed) { index = 0; loaded = -1; completed = false; }
      running = true; const id = ++generation; notify('loading');
      try {
        if (!context) {
          context = createContext(); analyser = context.createAnalyser(); analyser.fftSize = 1024;
          samples = new Float32Array(analyser.fftSize);
          source = context.createMediaElementSource(audio); source.connect(analyser); analyser.connect(context.destination);
        }
        await context.resume();
        if (disposed || !running || id !== generation) return;
        await playTrack(id);
      } catch { if (!disposed && running && id === generation) stop('error'); }
    },
    pause() { if (!disposed) stop(); },
    reset() {
      if (disposed) return;
      stop('reset'); index = 0; loaded = -1; completed = false;
      audio.removeAttribute('src'); audio.load();
    },
    sample() {
      if (!running || !audible || audio.paused || audio.ended || !analyser) return { rms: 0, energy: 0 };
      analyser.getFloatTimeDomainData(samples); return audioEnergy(samples);
    },
    dispose() {
      if (disposed) return;
      stop(); disposed = true; listeners.abort(); audio.removeAttribute('src'); audio.load();
      source?.disconnect(); analyser?.disconnect(); void context?.close().catch(() => {});
    },
  };
}
