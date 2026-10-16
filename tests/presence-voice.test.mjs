import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, wavDuration, speechParts } from '../presence/voice-format.mjs';
import { createPresenceVoice, createOpenAiAudio } from '../scripts/lib/presence-voice.mjs';
import { createVoiceController } from '../presence/voice.mjs';
import { createVoicePlayer } from '../presence/voice-player.mjs';
import { createVoiceCapture } from '../presence/voice-capture.mjs';
import { startPresence } from '../scripts/lib/presence-server.mjs';
import { request as httpRequest } from 'node:http';

const wav = () => Buffer.from(encodeWav(new Float32Array(16000).fill(.2), 16000));
const snapshot = () => ({ version: 1, origin: 'codex', sessionId: 'session', revision: 1, status: 'completed', speaker: null,
  messages: [{ id: 'question', role: 'user', text: 'Olá' }, { id: 'answer', role: 'assistant', turnId: 'turn', text: 'Uma resposta pública.' }] });
const input = (action, extra = {}) => ({ action, sessionId: 'session', requestId: crypto.randomUUID(), ...extra });
function fixture(t, options = {}) {
  let value = snapshot(), calls = 0;
  const provider = { ready: true, name: 'fake', transcribe: async () => { calls++; return 'Olá'; }, speak: async () => { calls++; return Buffer.alloc(4800); }, ...options.provider };
  const session = { snapshot: () => structuredClone(value) };
  const voice = createPresenceVoice({ session, provider, budgetUsd: options.budgetUsd ?? .2 }); t.after(() => voice.close());
  return { voice, get calls() { return calls; }, value, session };
}

test('capture WAV duration is derived from bytes; corrupt headers, oversize and partial data fail', () => {
  const bytes = wav(); assert.equal(wavDuration(bytes), 1);
  assert.equal(wavDuration(encodeWav(new Float32Array(48000).fill(-.2), 48000)), 1);
  for (const offset of [0, 4, 8, 12, 16, 20, 22, 24, 28, 32, 34, 36, 40]) {
    const copy = Buffer.from(bytes); copy[offset] ^= 255; assert.throws(() => wavDuration(copy), /E_AUDIO_FORMAT/);
  }
  assert.throws(() => wavDuration(bytes.subarray(0, 200)), /E_AUDIO_FORMAT/);
  assert.throws(() => encodeWav(new Float32Array(16000 * 46), 16000), /E_AUDIO_LIMIT/);
  const parts = speechParts('á'.repeat(1199) + '😀' + 'b'.repeat(1300));
  assert.ok(parts.every(p => p.length <= 1200 && !/[\uD800-\uDBFF]$/.test(p)));
  assert.equal(parts.join(''), 'á'.repeat(1199) + '😀' + 'b'.repeat(1300));
});

test('voice charges its quota once, refuses duplicate IDs and rejects arbitrary speech before provider calls', async t => {
  const f = fixture(t), request = input('transcribe', { audio: wav().toString('base64') });
  assert.equal((await f.voice.action(request)).text, 'Olá'); assert.equal(f.calls, 1);
  await assert.rejects(f.voice.action(request), { code: 'E_VOICE_DUPLICATE' });
  await assert.rejects(f.voice.action(input('speak', { messageId: 'question', part: 0 })), { code: 'E_SPEECH_SOURCE' });
  await assert.rejects(f.voice.action(input('speak', { messageId: 'answer', part: 0, text: 'injetado' })), { code: 'E_INPUT' });
  const reply = await f.voice.action(input('speak', { messageId: 'answer', part: 0 }));
  assert.equal(reply.sampleRate, 24000); assert.equal(f.calls, 2);
  await assert.rejects(f.voice.action(input('speak', { messageId: 'answer', part: 0 })), { code: 'E_VOICE_DUPLICATE' });
  await assert.rejects(f.voice.action(input('transcribe', { audio: wav().toString('base64') })), { code: 'E_VOICE_BUDGET' });
  assert.equal(f.voice.config().reservedUsd, .2); assert.equal(f.calls, 2);
});

test('unconfigured audio, stale sessions and invalid capture never consume quota', async t => {
  const f = fixture(t);
  await assert.rejects(f.voice.action(input('transcribe', { audio: 'AAAA' })), { code: 'E_AUDIO_FORMAT' });
  await assert.rejects(f.voice.action(input('transcribe', { sessionId: 'old', audio: wav().toString('base64') })), { code: 'E_STALE_SESSION' });
  f.value.status = 'running'; await assert.rejects(f.voice.action(input('speak', { messageId: 'answer', part: 0 })), { code: 'E_NOT_READY' });
  assert.equal(f.calls, 0); assert.equal(f.voice.config().reservedUsd, 0);
  const absent = fixture(t, { provider: { ready: false } });
  await assert.rejects(absent.voice.action(input('speak', { messageId: 'answer', part: 0 })), { code: 'E_AUDIO_KEY' });
  assert.throws(() => createPresenceVoice({ session: f.session, budgetUsd: 3 }), /E_VOICE_BUDGET/);
});

test('cancellation and session changes discard late audio; provider failure does not refund uncertain cost', async t => {
  let resolve, signal;
  const f = fixture(t, { provider: { speak: (_, s) => { signal = s; return new Promise(r => { resolve = r; }); } } });
  const pending = f.voice.action(input('speak', { messageId: 'answer', part: 0 }));
  await assert.rejects(f.voice.action(input('transcribe', { audio: wav().toString('base64') })), { code: 'E_VOICE_BUSY' });
  f.voice.cancel(); assert.equal(signal.aborted, true); resolve(Buffer.alloc(20));
  await assert.rejects(pending, { code: 'E_AUDIO_CANCELLED' }); assert.equal(f.voice.config().reservedUsd, .1);
  const late = f.voice.action(input('transcribe', { audio: wav().toString('base64') })); f.value.revision++;
  await assert.rejects(late, { code: 'E_AUDIO_CANCELLED' });
  const bad = fixture(t, { provider: { speak: () => { throw new Error('SECRET credential and raw error'); } } });
  await assert.rejects(bad.voice.action(input('speak', { messageId: 'answer', part: 0 })), { code: 'E_AUDIO_PROVIDER', message: 'E_AUDIO_PROVIDER' });
  assert.equal(bad.voice.config().reservedUsd, .1);
});

test('OpenAI adapter uses fixed official endpoints, JSON transcription and PCM without exposing key/errors', async () => {
  const calls = [];
  const provider = createOpenAiAudio({ key: 'secret', fetcher: async (url, options) => {
    calls.push({ url, options }); return url.endsWith('transcriptions') ? Response.json({ text: ' Olá! ' }) : new Response(new Uint8Array(40));
  } });
  assert.equal(await provider.transcribe(wav(), new AbortController().signal), 'Olá!');
  assert.equal((await provider.speak('Resposta', new AbortController().signal)).length, 40);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(calls[0].options.body.get('language'), 'pt'); assert.equal(calls[0].options.body.get('model'), 'gpt-4o-mini-transcribe');
  assert.equal(calls[1].options.redirect, 'error'); assert.equal(JSON.parse(calls[1].options.body).response_format, 'pcm');
  const bad = createOpenAiAudio({ key: 'secret', fetcher: async () => new Response('secret raw diagnostics', { status: 401 }) });
  await assert.rejects(bad.speak('texto'), { message: 'E_AUDIO_PROVIDER' });
  const oversized = createOpenAiAudio({ key: 'secret', fetcher: async () => new Response(new Uint8Array(5760002)) });
  await assert.rejects(oversized.speak('texto'), { code: 'E_AUDIO_LIMIT' });
});

function wire(server, path, { headers = {}, method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(server.origin + path, { method, headers }, response => {
      let data = ''; response.on('data', c => { data += c; }); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, data }));
    }); req.on('error', reject); req.end(body);
  });
}
test('voice HTTP requires bearer and origin; P2 keeps microphone disabled and audio never grants runtime actions', async t => {
  let calls = 0; const value = snapshot(), session = { snapshot: () => value, close() {}, touch() {} };
  const provider = { ready: true, name: 'fake', speak: async () => { calls++; return Buffer.alloc(40); } };
  const server = await startPresence({ session, voice: true, budgetUsd: .1, audioProvider: provider });
  t.after(() => { server.server.closeAllConnections(); server.server.close(); });
  const headers = { Authorization: `Bearer ${server.token}`, Origin: server.origin, 'Content-Type': 'application/json' };
  assert.equal((await wire(server, '/presence/api/voice/config')).status, 401);
  const body = JSON.stringify(input('speak', { messageId: 'answer', part: 0 }));
  assert.equal((await wire(server, '/presence/api/voice/action', { method: 'POST', body, headers: { ...headers, Origin: 'https://evil.test' } })).status, 403);
  const reply = await wire(server, '/presence/api/voice/action', { method: 'POST', body, headers }); assert.equal(reply.status, 200); assert.equal(calls, 1);
  assert.match(reply.headers['permissions-policy'], /microphone=\(self\)/);
  assert.equal((await wire(server, '/presence/api/voice/action', { method: 'POST', body, headers })).status, 409); assert.equal(calls, 1);
  const textOnly = await startPresence({ session }); t.after(() => { textOnly.server.closeAllConnections(); textOnly.server.close(); });
  assert.match((await wire(textOnly, '/presence/')).headers['permissions-policy'], /microphone=\(\)/);
});

test('browser voice only speaks new completed answers once and drops late synthesis after stop', async () => {
  const states = []; let calls = 0, played = 0, resolveSpeech;
  const value = snapshot(), voice = createVoiceController({ token: 'opaque', onState: v => states.push(v), onTranscript() {},
    captureFactory: () => ({ cancel() {}, dispose() {} }),
    playerFactory: () => ({ unlock: async () => {}, play: async () => { played++; return true; }, stop() {}, dispose() {}, sample: () => ({ energy: 0, rms: 0 }) }),
    fetcher: async (url, options) => {
      if (url.endsWith('config')) return Response.json({ enabled: true, provider: 'fake' });
      const body = JSON.parse(options.body); if (body.action === 'cancel') return Response.json({ cancelled: true });
      calls++; return new Promise(r => { resolveSpeech = r; });
    } });
  await voice.init(); voice.sync(value, true); await voice.toggle(); voice.sync(value, true); assert.equal(calls, 0);
  value.status = 'running'; voice.sync(value, true); value.status = 'completed'; value.messages.at(-1).id = 'new'; voice.sync(value, true);
  assert.equal(calls, 1); voice.sync(value, true); assert.equal(calls, 1);
  voice.stop(); resolveSpeech(Response.json({ audio: Buffer.alloc(40).toString('base64'), sampleRate: 24000 }));
  await new Promise(r => setTimeout(r, 0)); assert.equal(played, 0); assert.equal(states.at(-1).state, 'idle'); voice.dispose();
});

test('player measures actual PCM output and cancellation resolves pending playback without stale speaking', async () => {
  let source; const channel = new Float32Array(24), context = { state: 'running', resume: async () => {}, close: async () => {},
    createAnalyser: () => ({ fftSize: 1024, connect() {}, disconnect() {}, getFloatTimeDomainData: values => values.fill(.1) }),
    createBuffer: () => ({ getChannelData: () => channel }),
    createBufferSource: () => (source = { connect() {}, disconnect() {}, start() {}, stop() {} }) };
  const events = [], player = createVoicePlayer({ createContext: () => context, onState: s => events.push(s) });
  const playing = player.play(new Uint8Array(48)); await new Promise(r => setTimeout(r, 0));
  assert.equal(events.at(-1), 'speaking'); assert.ok(player.sample().energy > 0);
  player.stop(); assert.equal(await playing, false); assert.deepEqual(player.sample(), { rms: 0, energy: 0 });
  assert.equal(source.onended, null); player.dispose();
});

test('microphone resolved after cancellation is stopped without starting capture', async () => {
  let resolve, stops = 0; const states = [];
  const capture = createVoiceCapture({ onState: s => states.push(s), onComplete: () => assert.fail('unexpected capture'), onError: () => assert.fail('unexpected error'),
    environment: { navigator: { mediaDevices: { getUserMedia: () => new Promise(r => { resolve = r; }) } }, AudioWorkletNode: class {} } });
  const starting = capture.start(); capture.cancel(); resolve({ getTracks: () => [{ stop() { stops++; } }] }); await starting;
  assert.equal(stops, 1); assert.deepEqual(states, ['requesting']); capture.dispose();
});

test('late cancellation for an old request cannot abort a newer paid operation', async t => {
  const waiting = []; const f = fixture(t, { provider: { transcribe: (_, signal) => new Promise(resolve => waiting.push({ resolve, signal })) } });
  const first = input('transcribe', { audio: wav().toString('base64') });
  const a = f.voice.action(first); f.voice.cancel(first.requestId);
  const b = f.voice.action(input('transcribe', { audio: wav().toString('base64') }));
  await f.voice.action(input('cancel', { targetRequestId: first.requestId }));
  assert.equal(waiting[1].signal.aborted, false);
  waiting[0].resolve('old'); waiting[1].resolve('new');
  await assert.rejects(a, { code: 'E_AUDIO_CANCELLED' }); assert.equal((await b).text, 'new');
});

test('transcription stays a draft and a lost response is never automatically retried', async () => {
  let captureCallbacks, calls = 0, draft = '', fail = false;
  const states = [], value = snapshot();
  const voice = createVoiceController({ token: 'opaque', onState: v => states.push(v), onTranscript: v => { draft = v; },
    captureFactory: callbacks => { captureCallbacks = callbacks; return { cancel() {}, dispose() {}, start() { callbacks.onState('recording'); }, finish() {} }; },
    playerFactory: () => ({ stop() {}, dispose() {}, sample() {} }), fetcher: async (url, options) => {
      if (url.endsWith('config')) return Response.json({ enabled: true, provider: 'fake' });
      assert.equal(JSON.parse(options.body).action, 'transcribe'); calls++;
      if (fail) throw new Error('network'); return Response.json({ text: 'Revisar antes de enviar', elapsedMs: 25, reservedUsd: .1 });
    } });
  await voice.init(); voice.sync(value, true); await voice.record(); await captureCallbacks.onComplete(wav());
  assert.equal(draft, 'Revisar antes de enviar'); assert.equal(calls, 1);
  fail = true; await voice.record(); await captureCallbacks.onComplete(wav());
  assert.equal(calls, 2); assert.equal(draft, 'Revisar antes de enviar'); assert.equal(states.at(-1).state, 'error'); voice.dispose();
});

test('microphone permission failure is explicit and releases pending state', async () => {
  const errors = [];
  const capture = createVoiceCapture({ onState() {}, onComplete: () => assert.fail('no audio expected'), onError: v => errors.push(v),
    environment: { navigator: { mediaDevices: { getUserMedia: async () => { throw Object.assign(new Error(), { name: 'NotAllowedError' }); } } }, AudioWorkletNode: class {} } });
  await capture.start(); assert.deepEqual(errors, ['E_MIC_PERMISSION']); capture.dispose();
});
