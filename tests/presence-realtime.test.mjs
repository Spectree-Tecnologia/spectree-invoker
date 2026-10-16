import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPresenceRealtime, realtimeSessionConfig } from '../scripts/lib/presence-realtime.mjs';
import { createRealtimeConversation } from '../presence/realtime.mjs';
import { startPresence } from '../scripts/lib/presence-server.mjs';

const startInput = () => ({ action: 'start', sessionId: 'session', requestId: crypto.randomUUID(), sdp: 'v=0\r\nsynthetic' });
const settle = () => new Promise(resolve => setTimeout(resolve, 5));
function fixture(t, options = {}) {
  let socket, sends = 0, interrupts = 0;
  const outbound = [], calls = [], value = { sessionId: 'session', status: 'ready', messages: [] };
  const session = { snapshot: () => structuredClone(value), touch() {}, async send(_id, text) {
    sends++; if (options.send) return options.send(value, text);
    value.status = 'completed'; value.messages.push({ id: 'codex-answer', role: 'assistant', text: 'Análise pública confirmada.' });
  }, async interrupt() { interrupts++; value.status = 'interrupted'; } };
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
  return { service, session, calls, outbound, value, get sends() { return sends; }, get interrupts() { return interrupts; },
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
  const context = { state: 'running', resume: async () => {}, close: async () => {}, destination: {},
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
