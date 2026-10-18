import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPresenceRealtime, realtimeSessionConfig } from '../presence/server/realtime.mjs';
import { createRealtimeConversation } from '../presence/realtime.mjs';
import { startPresence } from '../presence/server/server.mjs';

const startInput = () => ({ action: 'start', sessionId: 'session', requestId: crypto.randomUUID(), sdp: 'v=0\r\nsynthetic' });
const settle = () => new Promise(resolve => setTimeout(resolve, 5));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function until(check) {
  const deadline = Date.now() + 1500;
  while (!check() && Date.now() < deadline) await settle();
  assert.ok(check(), 'expected state did not arrive');
}
function fixture(t, options = {}) {
  let socket, sends = 0, interrupts = 0, disconnects = 0;
  const outbound = [], calls = [], value = { sessionId: 'session', status: 'ready', messages: [] };
  const session = { snapshot: () => structuredClone(value), touch() {}, async send(_id, text) {
    sends++; if (options.send) return options.send(value, text);
    value.status = 'completed'; value.messages.push({ id: 'codex-answer', role: 'assistant', text: 'Análise pública confirmada.' });
  }, async interrupt() { interrupts++; if (options.interrupt) return options.interrupt(value); value.status = 'interrupted'; },
    disconnect(id) { assert.equal(id, value.sessionId); disconnects++; value.status = 'disconnected'; options.disconnect?.(); } };
  const service = createPresenceRealtime({ session, key: 'synthetic-secret', budgetUsd: 1,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      if (options.fetcher) return options.fetcher(url, init);
      return url.endsWith('hangup') ? new Response(null, { status: 200 }) : new Response('v=0\r\nanswer', { headers: { location: '/v1/realtime/calls/rtc_test' } });
    }, socketFactory: (url, init) => {
      socket = new EventEmitter(); socket.readyState = 1; socket.send = data => outbound.push(JSON.parse(data));
      socket.close = () => socket.emit('close'); socket.terminate = () => {};
      calls.push({ url, init }); queueMicrotask(() => socket.emit('open')); return socket;
    }, ...options.service });
  t.after(() => service.close());
  return { service, session, calls, outbound, value, get sends() { return sends; }, get interrupts() { return interrupts; }, get disconnects() { return disconnects; },
    emit(event) { socket.emit('message', Buffer.from(JSON.stringify(event))); } };
}

test('native session uses fixed model and semantic interruption; key and provider call ID never enter public state', async t => {
  const f = fixture(t); const result = await f.service.start(startInput());
  assert.equal(result.sdp, 'v=0\r\nanswer'); assert.equal(result.reservedUsd, 1);
  assert.equal(f.calls[0].url, 'https://api.openai.com/v1/realtime/calls');
  const config = JSON.parse(f.calls[0].init.body.get('session'));
  assert.equal(config.model, 'gpt-realtime-2.1'); assert.equal(config.max_output_tokens, 512);
  assert.equal(config.audio.input.turn_detection.interrupt_response, true);
  assert.deepEqual(config.tools.map(t => t.name), ['consultar_codex']);
  assert.doesNotMatch(JSON.stringify(f.service.snapshot()), /synthetic-secret|rtc_test/);
  await f.service.end(); assert.equal(f.service.snapshot().hangup, 'confirmed');
  assert.equal(f.calls.at(-1).url, 'https://api.openai.com/v1/realtime/calls/rtc_test/hangup');
});

test('Realtime refuses duplicate, stale and excess sessions; a stop preceding a start prevents a late paid operation', async t => {
  const f = fixture(t), input = startInput();
  await f.service.stop(input.requestId); await assert.rejects(f.service.start(input), { code: 'E_VOICE_DUPLICATE' }); assert.equal(f.calls.length, 0);
  await assert.rejects(f.service.start({ ...startInput(), sessionId: 'old' }), { code: 'E_STALE_SESSION' });
  const valid = startInput(); await f.service.start(valid);
  await assert.rejects(f.service.start(startInput()), { code: 'E_VOICE_BUSY' });
  await f.service.stop('different-request'); assert.equal(f.service.snapshot().status, 'listening');
  await f.service.stop(valid.requestId); await assert.rejects(f.service.start(startInput()), { code: 'E_VOICE_BUDGET' });
  assert.equal(f.service.snapshot().reservedUsd, 1);
});

test('Codex bridge executes a correlated analysis once and returns only its public completed reply', async t => {
  const f = fixture(t); await f.service.start(startInput());
  const event = { type: 'response.done', response: { id: 'response-1', status: 'completed', usage: { input_tokens: 12, output_tokens: 8 }, output: [
    { type: 'function_call', name: 'consultar_codex', call_id: 'tool-1', arguments: JSON.stringify({ pedido: 'Planeje uma especificação.' }) } ] } };
  f.emit(event); f.emit(event); await settle();
  assert.equal(f.sends, 1); assert.equal(f.outbound.length, 2);
  assert.equal(JSON.parse(f.outbound[0].item.output).text, 'Análise pública confirmada.');
  assert.equal(f.outbound[1].type, 'response.create'); assert.deepEqual(f.service.snapshot().usage, { inputTokens: 12, outputTokens: 8 });
});

test('speech interruption invalidates late Codex results without starting an unsolicited reply', async t => {
  let complete;
  const f = fixture(t, { send: value => { value.status = 'running'; value.canInterrupt = true; return new Promise(resolve => { complete = resolve; }); } });
  await f.service.start(startInput());
  f.emit({ type: 'response.done', response: { status: 'completed', output: [{ type: 'function_call', name: 'consultar_codex', call_id: 'tool-1', arguments: '{"pedido":"Analise"}' }] } });
  await settle(); f.emit({ type: 'input_audio_buffer.speech_started' }); complete(); await settle();
  assert.equal(f.interrupts, 1); assert.equal(f.outbound.length, 1);
  assert.equal(JSON.parse(f.outbound[0].item.output).code, 'E_ANALYSIS_INTERRUPTED');
});

const analysisEvent = id => ({ type: 'response.done', response: { status: 'completed', output: [
  { type: 'function_call', name: 'consultar_codex', call_id: id, arguments: '{"pedido":"Analise a especificacao"}' } ] } });

test('speech before the Codex start acknowledgement still cancels once and waits for terminal confirmation', async t => {
  const acknowledgement = deferred();
  const f = fixture(t, { send: value => { value.status = 'running'; value.canInterrupt = false; return acknowledgement.promise; },
    interrupt: value => { value.status = 'interrupting'; } });
  await f.service.start(startInput()); f.emit(analysisEvent('late-start')); await until(() => f.sends === 1);
  f.emit({ type: 'input_audio_buffer.speech_started' });
  assert.equal(f.interrupts, 0);
  f.value.canInterrupt = true; acknowledgement.resolve(); await until(() => f.interrupts === 1);
  assert.equal(f.service.snapshot().work, 'cancelling');
  assert.equal(f.outbound.length, 0, 'an interrupt acknowledgement is not terminal confirmation');
  f.value.status = 'interrupted'; await until(() => f.service.snapshot().work === 'error');
  assert.equal(f.interrupts, 1); assert.equal(f.disconnects, 0);
  assert.equal(f.outbound.length, 1); assert.equal(JSON.parse(f.outbound[0].item.output).code, 'E_ANALYSIS_INTERRUPTED');
});

test('analysis deadline cancels the owned Codex turn before releasing the bridge', async t => {
  let now = 0;
  const f = fixture(t, { service: { now: () => now }, send: value => { value.status = 'running'; value.canInterrupt = true; } });
  await f.service.start(startInput()); f.emit(analysisEvent('analysis-deadline')); await until(() => f.sends === 1); await settle();
  now = 41000; await until(() => f.service.snapshot().work === 'error');
  assert.equal(f.interrupts, 1); assert.equal(f.value.status, 'interrupted');
  await f.service.end(); assert.equal(f.interrupts, 1); assert.equal(f.disconnects, 0);
});

test('ending during an unacknowledged Codex start disconnects the harness if cancellation cannot be confirmed', async t => {
  const acknowledgement = deferred();
  const f = fixture(t, { service: { cancelTimeoutMs: 30 },
    send: value => { value.status = 'running'; value.canInterrupt = false; return acknowledgement.promise; },
    disconnect: () => acknowledgement.reject(Object.assign(new Error('closed'), { code: 'E_STALE_SESSION' })) });
  await f.service.start(startInput()); f.emit(analysisEvent('never-acknowledged')); await until(() => f.sends === 1);
  await f.service.end();
  assert.equal(f.disconnects, 1); assert.equal(f.value.status, 'disconnected');
  assert.equal(f.interrupts, 0); assert.equal(f.service.snapshot().hangup, 'confirmed'); assert.equal(f.outbound.length, 0);
});

test('an unconfirmed Codex interrupt cannot release the bridge while its turn is still running', async t => {
  const f = fixture(t, { service: { cancelTimeoutMs: 30 }, send: value => { value.status = 'running'; value.canInterrupt = true; },
    interrupt: value => { value.status = 'interrupting'; } });
  await f.service.start(startInput()); f.emit(analysisEvent('never-interrupted')); await until(() => f.sends === 1);
  f.emit({ type: 'input_audio_buffer.speech_started' });
  await until(() => f.service.snapshot().work === 'error');
  assert.equal(f.interrupts, 1); assert.equal(f.disconnects, 1); assert.equal(f.value.status, 'disconnected');
});

test('late cancellation never interrupts or disconnects a replacement Codex session', async t => {
  const acknowledgement = deferred();
  const f = fixture(t, { send: value => { value.status = 'running'; value.canInterrupt = false; return acknowledgement.promise; } });
  await f.service.start(startInput()); f.emit(analysisEvent('replaced-session')); await until(() => f.sends === 1);
  f.emit({ type: 'input_audio_buffer.speech_started' });
  f.value.sessionId = 'replacement'; f.value.canInterrupt = true; acknowledgement.resolve();
  await until(() => f.service.snapshot().work === 'error');
  assert.equal(f.interrupts, 0); assert.equal(f.disconnects, 0); assert.equal(f.value.status, 'running');
  await f.service.end(); assert.equal(f.interrupts, 0); assert.equal(f.disconnects, 0);
});

test('pending hangup blocks another paid call and duplicate ends cannot overwrite a later call result', async t => {
  const oldHangup = deferred(); let created = 0;
  const f = fixture(t, { service: { budgetUsd: 2 }, fetcher: async url => {
    if (url.endsWith('/rtc_first/hangup')) return oldHangup.promise;
    if (url.endsWith('/hangup')) return new Response(null, { status: 500 });
    return new Response('v=0\r\nanswer', { headers: { location: `/v1/realtime/calls/${++created === 1 ? 'rtc_first' : 'rtc_second'}` } });
  } });
  const first = startInput(); await f.service.start(first);
  const ending = f.service.end(), duplicate = f.service.end(), duplicateStop = f.service.stop(first.requestId);
  assert.equal(f.service.snapshot().hangup, 'pending');
  await assert.rejects(f.service.start(startInput()), { code: 'E_VOICE_BUSY' });
  assert.equal(created, 1); assert.equal(f.service.snapshot().reservedUsd, 1);
  oldHangup.resolve(new Response(null, { status: 200 }));
  const endings = await Promise.all([ending, duplicate, duplicateStop]);
  assert.ok(endings.every(value => value.hangup === 'confirmed'));
  assert.equal(f.service.snapshot().hangup, 'confirmed');
  await f.service.start(startInput()); await f.service.end();
  await f.service.stop(first.requestId);
  assert.equal(f.service.snapshot().hangup, 'unconfirmed'); assert.equal(f.service.snapshot().reservedUsd, 2);
  assert.equal(f.calls.filter(call => call.url.endsWith('/rtc_first/hangup')).length, 1);
});

test('server deadline hangs up even without a cooperative browser; provider errors remain sanitized', async t => {
  let now = 0; const f = fixture(t, { service: { now: () => now, maxSessionMs: 10 } }); await f.service.start(startInput());
  now = 20; await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(f.service.snapshot().error, 'E_REALTIME_TIME'); assert.equal(f.service.snapshot().hangup, 'confirmed');
  const bad = fixture(t, { fetcher: async () => new Response('SECRET RAW PROVIDER ERROR', { status: 401 }) });
  await assert.rejects(bad.service.start(startInput()), { code: 'E_REALTIME_PROVIDER' });
  assert.doesNotMatch(JSON.stringify(bad.service.snapshot()), /SECRET/); assert.equal(bad.service.snapshot().reservedUsd, 1);
});

function browserFixture(overrides = {}) {
  const views = [], requests = []; let stopped = 0, peer, gain, audio;
  const track = { enabled: true, stop() { stopped++; }, addEventListener() {} }, stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  const context = { state: 'running', resume: overrides.resume ?? (async () => {}), close: async () => {}, destination: {},
    createAnalyser: () => ({ connect() {}, disconnect() {}, getFloatTimeDomainData: values => values.fill(.1) }),
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }), createGain: () => (gain = { gain: { value: 1 }, connect() {}, disconnect() {} }) };
  class Peer { constructor() { peer = this; } addTrack() {} close() {} createDataChannel() { return this.channel = { readyState: overrides.channelPending ? 'connecting' : 'open', close() {} }; }
    async createOffer() { return { sdp: 'v=0\r\nfixture' }; } async setLocalDescription() {} async setRemoteDescription() {} }
  const client = createRealtimeConversation({ token: 'opaque', onState: value => views.push(value),
    environment: { navigator: { mediaDevices: { getUserMedia: overrides.getUserMedia ?? (async () => stream) } }, AudioContext: class { constructor() { return context; } }, RTCPeerConnection: Peer,
      Audio: class { constructor() { audio = this; this.paused = false; } async play() {} pause() { this.paused = true; } } },
    fetcher: async (url, init) => {
      requests.push({ url, init });
      return Response.json(url.endsWith('snapshot') ? { status: 'listening', messages: [], reservedUsd: 1 } : { sdp: 'v=0\r\nanswer', reservedUsd: 1 });
    } });
  client.sync({ sessionId: 'session', status: 'ready' });
  return { client, views, requests, stream, track, get stopped() { return stopped; }, get gain() { return gain.gain.value; },
    get audio() { return audio; }, openChannel() { peer.channel.readyState = 'open'; peer.channel.onopen?.(); },
    emit(type) { peer.channel.onmessage({ data: JSON.stringify({ type }) }); } };
}

test('browser keeps microphone live during native speech, silences output on barge-in and stops every track on exit', async () => {
  const f = browserFixture(); await f.client.start({ deviceId: 'notebook' }); await settle();
  f.emit('output_audio_buffer.started'); assert.equal(f.views.at(-1).phase, 'speaking'); assert.ok(f.client.sample().energy > 0);
  assert.equal(f.track.enabled, true);
  f.emit('input_audio_buffer.speech_started'); assert.equal(f.gain, 0); assert.equal(f.views.at(-1).phase, 'listening');
  assert.equal(f.audio.muted, true);
  f.client.toggleMute(); assert.equal(f.track.enabled, false); assert.equal(f.client.sample().energy, 0);
  f.client.stop(); assert.equal(f.stopped, 1); assert.equal(f.views.at(-1).active, false);
  await settle(); assert.equal(f.requests.filter(r => r.init.body && JSON.parse(r.init.body).action === 'start').length, 1); f.client.dispose();
});

test('browser only becomes ready after the RTC data channel opens', async () => {
  const f = browserFixture({ channelPending: true }); const connecting = f.client.start(); await settle();
  assert.equal(f.views.at(-1).phase, 'connecting'); f.openChannel(); await connecting;
  assert.equal(f.views.at(-1).phase, 'listening'); f.client.dispose();
});

test('permission granted after stopping a realtime start cannot create a paid session', async () => {
  let grant; const f = browserFixture({ getUserMedia: () => new Promise(resolve => { grant = resolve; }) });
  const starting = f.client.start(); await settle(); f.client.stop(); grant(f.stream); await starting;
  assert.equal(f.stopped, 1); assert.equal(f.requests.length, 0); f.client.dispose();
});

test('microphone request starts in the click gesture without waiting for playback readiness', async () => {
  let resume, constraints;
  const f = browserFixture({ resume: () => new Promise(resolve => { resume = resolve; }),
    getUserMedia: async value => { constraints = value; return f.stream; } });
  const starting = f.client.start({ deviceId: 'notebook-realtek' });
  assert.deepEqual(constraints.audio.deviceId, { exact: 'notebook-realtek' });
  await settle(); assert.equal(f.requests.length, 0);
  resume(); await starting; assert.equal(f.views.at(-1).phase, 'listening'); f.client.dispose();
});

test('blocked playback is not reported as a microphone denial and opens no paid session', async () => {
  const f = browserFixture({ resume: async () => { throw Object.assign(new Error('blocked'), { name: 'NotAllowedError' }); } });
  await f.client.start();
  assert.equal(f.views.at(-1).error, 'E_AUDIO_PLAYBACK'); assert.equal(f.requests.length, 0);
  assert.equal(f.stopped, 1); f.client.dispose();
});

test('microphone denial preserves zero paid calls and a later deliberate retry uses the selected input', async () => {
  let denied = true;
  const f = browserFixture({ getUserMedia: async () => {
    if (denied) throw Object.assign(new Error('permission denied'), { name: 'NotAllowedError' });
    return f.stream;
  } });
  await f.client.start({ deviceId: 'notebook-realtek' });
  assert.equal(f.views.at(-1).error, 'E_MIC_PERMISSION'); assert.equal(f.requests.length, 0);
  denied = false; await f.client.start({ deviceId: 'notebook-realtek' });
  assert.equal(f.views.at(-1).error, null); assert.equal(f.views.at(-1).phase, 'listening'); f.client.dispose();
});

test('Realtime HTTP requires local bearer and origin, rejects arbitrary options and never opens the manual audio endpoint', async t => {
  const f = fixture(t); f.session.close = () => {};
  const server = await startPresence({ session: f.session, realtime: true, voice: true, budgetUsd: 1, realtimeFactory: () => f.service });
  t.after(() => { server.server.closeAllConnections(); server.server.close(); });
  const headers = { Authorization: `Bearer ${server.token}`, Origin: server.origin, 'Content-Type': 'application/json' };
  const url = server.origin + '/presence/api/realtime/action', input = startInput();
  assert.equal((await fetch(server.origin + '/presence/api/realtime/snapshot')).status, 401);
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'https://other.test' }, body: JSON.stringify(input) })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ ...input, model: 'unapproved', project: 'private' }) })).status, 409);
  assert.equal(f.calls.length, 0);
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(input) }); assert.equal(response.status, 200);
  assert.doesNotMatch(await response.text(), /synthetic-secret|rtc_test/);
  const manual = await fetch(server.origin + '/presence/api/voice/action', { method: 'POST', headers, body: '{}' }); assert.equal(manual.status, 404);
  const status = await fetch(server.origin + '/presence/api/realtime/snapshot', { headers }); assert.equal((await status.json()).status, 'listening');
});
