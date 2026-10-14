import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { readFileSync } from 'node:fs';
import { createSession, applyEvent } from '../presence/state.mjs';
import { audioEnergy, createAudioPlayer } from '../presence/audio.mjs';
import { startConsole } from '../scripts/lib/console-server.mjs';

function session() {
  let state = createSession('test-session');
  return { get state() { return state; }, send(type, extras = {}) {
    state = applyEvent(state, { version: 1, sessionId: state.sessionId, origin: 'demo', sequence: state.sequence + 1,
      participantId: 'invoker', type, ...extras }); return state;
  } };
}
test('Presence attributes audible turns to admitted participants and resets all projected state', () => {
  const s = session(); s.send('think'); s.send('speak');
  assert.equal(s.state.speaker, 'invoker'); s.send('end');
  s.send('delegate', { targetId: 'architect' }); s.send('think', { participantId: 'architect' });
  assert.equal(s.state.focus, 'architect'); assert.equal(s.state.speaker, null);
  s.send('speak', { participantId: 'architect' });
  assert.equal(s.state.speaker, 'architect'); assert.deepEqual(s.state.participants, ['invoker', 'architect']);
  s.send('pause'); assert.equal(s.state.speaker, null);
  s.send('reset'); assert.deepEqual(s.state.participants, ['invoker']); assert.equal(s.state.status, 'available');
  assert.equal(Object.isFrozen(s.state.participants), true);
  assert.equal('authorizes_execution' in s.state, false);
});
test('Presence rejects malformed, stale, foreign and impersonated events without changing its state', () => {
  const s = session(); s.send('think'); const before = s.state;
  for (const extras of [{ sequence: 1 }, { sequence: 0 }, { sequence: NaN }, { version: 2 },
    { sessionId: 'foreign' }, { origin: 'session' }, { participantId: '__proto__' }, { reason: {} }]) {
    assert.throws(() => s.send('speak', extras)); assert.equal(s.state, before);
  }
  assert.throws(() => s.send('execute'));
  assert.throws(() => s.send('delegate', { targetId: '__proto__' }));
  assert.throws(() => s.send('speak', { participantId: 'architect' }), { code: 'E_PARTICIPANT' });
});
test('Presence sequence gaps silence the projection until trusted session resynchronization', () => {
  const s = session(); s.send('speak'); s.send('end', { sequence: 4 });
  assert.equal(s.state.sync, 'required'); assert.equal(s.state.speaker, null);
  assert.throws(() => s.send('reset'), { code: 'E_RESYNC_REQUIRED' });
  assert.equal(createSession('replacement').sync, 'ready');
});
test('Presence does not replace an active speaker or continue a failed turn implicitly', () => {
  const s = session(); s.send('delegate', { targetId: 'architect' }); s.send('speak');
  assert.throws(() => s.send('speak', { participantId: 'architect' }), { code: 'E_SPEAKER' });
  assert.throws(() => s.send('end', { participantId: 'architect' }), { code: 'E_SPEAKER' });
  for (const type of ['cancel', 'error']) {
    s.send(type); assert.equal(s.state.speaker, null);
    assert.throws(() => s.send('speak'), { code: 'E_TRANSITION' }); s.send('ready');
  }
});
test('Presence measures a real waveform with silence and amplitude controls', () => {
  assert.deepEqual(audioEnergy(new Float32Array(1024)), { rms: 0, energy: 0 });
  const quiet = Float32Array.from({ length: 1024 }, (_, i) => .015 * Math.sin(i));
  const loud = Float32Array.from(quiet, value => value * 8);
  assert.ok(audioEnergy(loud).energy > audioEnergy(quiet).energy * 5);
  assert.equal(audioEnergy(new Float32Array()).energy, 0);
});

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
class Media extends EventTarget {
  paused = true; ended = false; src = ''; playCalls = 0;
  play = async () => { this.playCalls++; this.paused = false; this.ended = false; this.dispatchEvent(new Event('playing')); };
  pause() { this.paused = true; }
  load() { this.ended = false; }
  removeAttribute() { this.src = ''; }
  finish() { this.ended = true; this.paused = true; this.dispatchEvent(new Event('ended')); }
}
function audioFixture(resume = async () => {}) {
  const media = new Media(), events = [], timers = new Map(); let counter = 0, closed = 0, disconnected = 0;
  const analyser = { fftSize: 1024, connect() {}, disconnect() { disconnected++; }, getFloatTimeDomainData(wave) { wave.fill(.04); } };
  const context = { destination: {}, resume, createAnalyser: () => analyser,
    createMediaElementSource: () => ({ connect() {}, disconnect() { disconnected++; } }), close: async () => { closed++; } };
  const player = createAudioPlayer(media, { onEvent: event => events.push(event), createContext: () => context,
    schedule: fn => { const id = ++counter; timers.set(id, fn); return id; }, unschedule: id => timers.delete(id) });
  return { media, events, player, timers, get closed() { return closed; }, get disconnected() { return disconnected; },
    tick() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); } };
}
test('audio cancellation while context resumes never starts playback afterward', async () => {
  const gate = deferred(), f = audioFixture(() => gate.promise); const pending = f.player.play();
  f.player.pause(); gate.resolve(); await pending;
  assert.equal(f.media.playCalls, 0); assert.equal(f.player.sample().energy, 0); f.player.dispose();
});
test('audio only animates an audible track; pause, buffering and end clear its envelope', async () => {
  const f = audioFixture(); await f.player.play(); assert.ok(f.player.sample().energy > 0);
  f.media.dispatchEvent(new Event('waiting')); assert.equal(f.player.sample().energy, 0);
  f.media.dispatchEvent(new Event('playing')); assert.ok(f.player.sample().energy > 0);
  f.player.pause(); assert.equal(f.player.sample().energy, 0);
  await f.player.play(); f.media.finish(); assert.equal(f.player.sample().energy, 0);
  f.player.dispose();
});
test('audio resumes the next speaker after pausing in the inter-turn gap', async () => {
  const f = audioFixture(); await f.player.play(); f.media.finish();
  f.player.pause(); f.tick(); assert.equal(f.media.playCalls, 1);
  await f.player.play(); assert.match(f.media.src, /architect\.mp3$/);
  assert.equal(f.events.filter(e => e.type === 'speaking').at(-1).track.speaker, 'architect'); f.player.dispose();
});
test('audio cancels a queued specialist on reset and retains correct turn attribution on replay', async () => {
  const f = audioFixture(); await f.player.play(); f.media.finish(); f.player.reset(); f.tick();
  assert.equal(f.media.playCalls, 1); await f.player.play();
  assert.match(f.media.src, /invoker-intro\.mp3$/);
  f.media.finish(); f.tick(); await Promise.resolve();
  f.media.finish(); f.tick(); await Promise.resolve();
  f.media.finish(); assert.equal(f.player.completed, true);
  assert.equal(f.player.running, false); assert.equal(f.player.sample().energy, 0);
  await f.player.play(); assert.match(f.media.src, /invoker-intro\.mp3$/); f.player.dispose();
});
test('a rejected or late play request cannot claim success or stop a newer turn', async () => {
  const f = audioFixture(), gate = deferred();
  f.media.play = () => gate.promise; const pending = f.player.play(); await Promise.resolve();
  f.player.reset();
  f.media.play = async () => { f.media.paused = false; f.media.dispatchEvent(new Event('playing')); };
  await f.player.play(); gate.reject(new Error('obsolete')); await pending;
  assert.equal(f.player.running, true); assert.equal(f.events.filter(e => e.type === 'error').length, 0);
  f.player.pause(); f.media.play = async () => { throw new Error('blocked'); }; await f.player.play();
  assert.equal(f.player.running, false); assert.equal(f.events.at(-1).type, 'error'); f.player.dispose();
});
test('audio disposal releases resources exactly once and ignores late events', async () => {
  const f = audioFixture(); await f.player.play(); f.player.dispose(); const count = f.events.length;
  f.player.dispose(); f.media.dispatchEvent(new Event('playing')); f.tick(); await f.player.play();
  assert.equal(f.events.length, count); assert.equal(f.closed, 1); assert.equal(f.disconnected, 2);
  assert.equal(f.media.src, ''); assert.equal(f.media.paused, true);
});

function get(origin, route, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(origin + route, { method, headers }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }); req.on('error', reject); req.end();
  });
}
test('Presence serves only local allowlisted assets, blocks mutation/origins and exposes no consumer API', async t => {
  const instance = await startConsole({ presence: true });
  t.after(() => new Promise(resolve => { instance.server.close(resolve); instance.server.closeAllConnections(); }));
  assert.equal(instance.url, `${instance.origin}/presence/`);
  const page = await get(instance.origin, '/presence/'); assert.equal(page.status, 200);
  assert.match(page.headers['content-security-policy'], /media-src 'self'/);
  assert.doesNotMatch(page.headers['content-security-policy'], /unsafe-inline|unsafe-eval|https:/);
  assert.equal(page.headers['permissions-policy'], 'microphone=(), camera=()');
  for (const route of ['/presence/app.mjs', '/presence/renderer.mjs', '/presence/vendor/three.module.js', '/presence/vendor/three.core.js', '/presence/audio/architect.mp3']) {
    assert.equal((await get(instance.origin, route)).status, 200);
  }
  for (const route of ['/api/snapshot', '/api/observation?project=project-1', '/presence/../package.json', '/presence/vendor/../../package.json', '/presence/.env', '/presence/?project=C:/private']) {
    assert.equal((await get(instance.origin, route)).status, 404);
  }
  assert.equal((await get(instance.origin, '/presence/', { method: 'POST' })).status, 405);
  assert.equal((await get(instance.origin, '/presence/', { headers: { origin: 'https://foreign.invalid' } })).status, 403);
  assert.equal((await get(instance.origin, '/presence/', { headers: { host: 'foreign.invalid' } })).status, 403);
  assert.equal((await get(instance.origin, '/presence/', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  const audio = await get(instance.origin, '/presence/audio/architect.mp3'); assert.equal(audio.headers['content-type'], 'audio/mpeg'); assert.ok(audio.body.length > 10000);
});
test('Presence cannot open consumer roots or change the existing Console security boundary', async t => {
  await assert.rejects(startConsole({ presence: true, roots: ['unused'] }));
  await assert.rejects(startConsole({ presence: true, demo: true }));
  const instance = await startConsole({ demo: true });
  t.after(() => new Promise(resolve => { instance.server.close(resolve); instance.server.closeAllConnections(); }));
  assert.equal((await get(instance.origin, '/presence/')).status, 404);
  assert.equal((await get(instance.origin, '/api/snapshot')).status, 401);
  assert.equal((await get(instance.origin, '/api/snapshot', { headers: { authorization: `Bearer ${instance.token}` } })).status, 200);
  assert.equal((await get(instance.origin, '/')).headers['content-security-policy'].includes('media-src'), false);
});
test('Presence renderer package is pinned with a lockfile and local module dependencies', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)));
  assert.equal(pkg.dependencies.three, '0.180.0'); assert.equal(lock.packages['node_modules/three'].version, pkg.dependencies.three);
  assert.match(lock.packages['node_modules/three'].integrity, /^sha512-/);
});
