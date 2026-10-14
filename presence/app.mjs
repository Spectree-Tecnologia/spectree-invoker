import { AGENTS, createSession, applyEvent } from './state.mjs';
import { createAudioPlayer } from './audio.mjs';
import { freshSurface, startPageLifecycle } from './lifecycle.mjs';

function mount() {
  const root = document.querySelector('#presence'), $ = selector => root.querySelector(selector);
  const surface = freshSurface(root);
  for (const key of Object.keys(root.dataset)) delete root.dataset[key];
  $('[data-title]').textContent = 'Invoker.';
  $('[data-caption]').textContent = 'Uma presença para a nossa conversa.';
  $('#transcript').hidden = true;
  $('[data-transcript]').setAttribute('aria-expanded', 'false');
  const events = new AbortController(), options = { signal: events.signal };
  $('.fallback').hidden = true;
  $('[data-motion]').disabled = false;
  let state = createSession(crypto.randomUUID()), selected = 'invoker', scene, disposed = false, visible = true;
  let motion = true, started = false;
  const names = { available: 'Disponível', listening: 'Escutando · simulação', processing: 'Processando · demonstração',
    speaking: 'Falando · áudio gravado', delegating: 'Delegando · simulação', interrupted: 'Interrompido', error: 'Erro de demonstração' };
  function paint() {
    $('[data-state]').textContent = `${names[state.status]} · ${AGENTS[state.focus].name}`;
    $('[data-play]').textContent = player.running ? 'Pausar voz' : player.completed ? 'Ouvir novamente' : started ? 'Continuar' : 'Ouvir Invoker';
    $('[data-play]').setAttribute('aria-pressed', String(player.running));
    $('[data-motion]').textContent = motion ? 'Pausar movimento' : 'Ativar movimento';
    $('[data-motion]').setAttribute('aria-pressed', String(motion));
    root.querySelectorAll('[data-agent]').forEach(button => button.setAttribute('aria-pressed', String(selected === button.dataset.agent)));
    $('[data-participants]').textContent = [...new Set([...state.participants, selected])].map(id =>
      `${AGENTS[id].name} · ${state.speaker === id ? 'falando' : id === selected && !state.participants.includes(id) ? 'prévia visual' : id === state.focus ? names[state.status].toLowerCase() : 'disponível'}`).join(' / ');
    $('[data-note]').textContent = state.reason || 'Vozes gravadas · microfone desligado · nenhum comando executado';
    root.dataset.status = state.status; root.dataset.speaker = state.speaker ?? 'none'; root.dataset.origin = state.origin;
    scene?.invalidate();
  }
  function send(type, participantId = 'invoker', extra = {}) {
    state = applyEvent(state, { version: 1, sessionId: state.sessionId, origin: 'demo',
      sequence: state.sequence + 1, participantId, type, ...extra });
    paint();
  }
  function admitArchitect() {
    if (!state.participants.includes('architect')) send('delegate', 'invoker', { targetId: 'architect' });
    selected = 'architect';
  }
  const player = createAudioPlayer(surface.audio, { onEvent(event) {
    if (disposed) return;
    const { type, track } = event;
    if (type === 'loading') {
      if (['error', 'interrupted'].includes(state.status)) send('ready');
      if (track.speaker === 'architect') admitArchitect();
      send('think', track.speaker);
    } else if (type === 'speaking') {
      send('speak', track.speaker);
      $('[data-title]').textContent = `${AGENTS[track.speaker].name}.`;
      $('[data-caption]').textContent = track.text;
    } else if (type === 'ended') {
      if (state.speaker) send('end', state.speaker);
    } else if (type === 'between') {
      if (track.speaker === 'architect') admitArchitect();
    } else if (type === 'error') send('error');
    else if (type === 'pause') send('pause', state.participants.includes(track.speaker) ? track.speaker : 'invoker');
    else if (type === 'complete') {
      send('ready'); $('[data-title]').textContent = 'Uma conversa. Muitas perspectivas.';
      $('[data-caption]').textContent = 'Demonstração concluída. Vamos imaginar o próximo passo.';
    }
    paint();
  } });
  function reset() {
    player.reset(); state = createSession(crypto.randomUUID()); selected = 'invoker'; started = false;
    $('[data-title]').textContent = 'Invoker.'; $('[data-caption]').textContent = 'Uma presença para a nossa conversa.'; paint();
  }
  $('[data-play]').addEventListener('click', () => {
    if (player.running) player.pause();
    else { if (!started || player.completed) reset(); started = true; void player.play(); }
  }, options);
  $('[data-stop]').addEventListener('click', reset, options);
  $('[data-motion]').addEventListener('click', () => { motion = !motion; paint(); }, options);
  $('[data-transcript]').addEventListener('click', () => {
    $('#transcript').hidden = !$('#transcript').hidden;
    $('[data-transcript]').setAttribute('aria-expanded', String(!$('#transcript').hidden));
  }, options);
  root.querySelectorAll('[data-agent]').forEach(button => button.addEventListener('click', () => {
    reset(); selected = button.dataset.agent;
    $('[data-title]').textContent = selected === 'invoker' ? 'Invoker.' : `Invoker + ${AGENTS[selected].name}.`;
    $('[data-caption]').textContent = selected === 'invoker' ? 'Uma presença para a nossa conversa.' : `${AGENTS[selected].label} · prévia visual`;
    paint();
  }, options));
  root.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => {
    reset(); const type = button.dataset.scenario;
    if (type === 'delegate') { selected = 'architect'; send(type, 'invoker', { targetId: 'architect' }); }
    else send(type);
    $('[data-caption]').textContent = 'Estado simulado. Microfone e agentes permanecem desligados.';
  }, options));
  const visibility = () => {
    if (document.hidden) { if (player.running) player.pause(); }
    else scene?.invalidate();
  };
  document.addEventListener('visibilitychange', visibility, options);
  const observer = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (!visible && player.running) player.pause();
    scene?.invalidate();
  });
  observer.observe($('.world'));
  const unavailable = () => {
    if (disposed) return;
    scene?.dispose(); scene = undefined;
    surface.canvas.hidden = true;
    delete root.dataset.metrics;
    $('.fallback').hidden = false; root.dataset.engine = 'fallback';
    $('[data-motion]').disabled = true;
  };
  import('./renderer.mjs').then(({ createPresenceRenderer }) => {
    if (disposed) return;
    scene = createPresenceRenderer({ canvas: surface.canvas, world: $('.world'), onUnavailable: unavailable,
      read() { const sample = player.sample(); root.dataset.rms = sample.rms.toFixed(4);
        return { ...sample, status: state.status, focus: state.focus, speaker: state.speaker, specialist: selected === 'invoker' ? null : selected, visible, motion }; } });
    root.dataset.engine = 'three-webgl2'; scene.invalidate();
  }).catch(unavailable);
  // Bounded diagnostic measurements for the repeatable browser acceptance, not runtime evidence.
  const metrics = setInterval(() => {
    if (disposed || !visible || document.hidden || !scene) return;
    const stats = scene.stats(), sorted = stats.frameIntervalsMs.sort((a, b) => a - b);
    root.dataset.metrics = JSON.stringify({ ...stats, frameIntervalsMs: undefined, samples: sorted.length,
      p95FrameMs: sorted[Math.floor(sorted.length * .95)] ?? null });
  }, 2000);
  paint();
  return { dispose() {
    if (disposed) return; disposed = true; events.abort(); observer.disconnect(); clearInterval(metrics); player.dispose(); scene?.dispose();
  } };
}
startPageLifecycle(window, mount);
