import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, wavDuration, speechParts } from '../presence/voice-format.mjs';
import { createPresenceVoice, createOpenAiAudio } from '../presence/server/voice.mjs';
import { createVoiceController, voiceErrorMessage } from '../presence/voice.mjs';
import { createVoicePlayer } from '../presence/voice-player.mjs';
import { createVoiceCapture } from '../presence/voice-capture.mjs';
import { startPresence } from '../presence/server/server.mjs';
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
  assert.match(reply.headers['content-security-policy'], /media-src 'self' blob:/);
  assert.equal((await wire(server, '/presence/api/voice/action', { method: 'POST', body, headers })).status, 409); assert.equal(calls, 1);
  const textOnly = await startPresence({ session }); t.after(() => { textOnly.server.closeAllConnections(); textOnly.server.close(); });
  assert.match((await wire(textOnly, '/presence/')).headers['permissions-policy'], /microphone=\(\)/);
  assert.doesNotMatch((await wire(textOnly, '/presence/')).headers['content-security-policy'], /blob:/);
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

function microphoneFixture(rate = 48000) {
  let node, stopped = 0, closed = 0;
  const context = { sampleRate: rate, audioWorklet: { addModule: async () => {} },
    createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
    resume: async () => {}, close: async () => { closed++; } };
  return { environment: {
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped++; }, addEventListener() {} }] }) } },
    AudioContext: class { constructor() { return context; } },
    AudioWorkletNode: class { constructor() { node = this; this.port = { close() {} }; } connect() {} disconnect() {} },
  }, samples(values) { node.port.onmessage({ data: { samples: values } }); },
  get stopped() { return stopped; }, get closed() { return closed; } };
}

test('silent microphone never sends audio; a fresh capture at common device rates remains transcribable', async () => {
  for (const rate of [44100, 48000]) {
    const mic = microphoneFixture(rate), errors = [], completed = [];
    const capture = createVoiceCapture({ environment: mic.environment, onState() {}, onError: code => errors.push(code), onComplete: bytes => completed.push(bytes) });
    await capture.start(); mic.samples(new Float32Array(rate)); capture.finish();
    assert.deepEqual(errors, ['E_MIC_SILENT']); assert.equal(completed.length, 0);
    assert.equal(mic.stopped, 1); assert.equal(mic.closed, 1);
    await capture.start(); mic.samples(new Float32Array(rate).fill(.02));
    assert.ok(capture.sample().energy > 0); capture.finish();
    assert.equal(wavDuration(completed[0]), 1); assert.equal(mic.stopped, 2);
    assert.deepEqual(capture.sample(), { energy: 0, rms: 0 }); capture.dispose();
  }
});

test('device capture goes through authenticated HTTP transcription into a draft without sending a Codex turn', async t => {
  const value = snapshot(), mic = microphoneFixture(), states = [];
  let providerCalls = 0, transcript = '', posted = 0;
  const server = await startPresence({ voice: true, budgetUsd: .1,
    session: { snapshot: () => value, touch() {}, close() {}, send() { assert.fail('must not send a turn'); } },
    audioProvider: { ready: true, name: 'fake', async transcribe(bytes) {
      providerCalls++; assert.equal(wavDuration(bytes), 2); return 'Quero definir uma especificação.';
    } } });
  t.after(() => { server.server.closeAllConnections(); server.server.close(); });
  const voice = createVoiceController({ token: server.token, onState: v => states.push(v), onTranscript: text => { transcript = text; },
    captureFactory: callbacks => createVoiceCapture({ ...callbacks, environment: mic.environment }),
    playerFactory: () => ({ stop() {}, dispose() {}, sample: () => ({ energy: 0, rms: 0 }) }),
    fetcher: async (url, options) => {
      const headers = { ...options.headers, ...(options.method === 'POST' ? { Origin: server.origin } : {}) };
      if (options.method === 'POST') posted++;
      return fetch(server.origin + url, { ...options, headers });
    } });
  t.after(() => voice.dispose());
  await voice.init(); voice.sync(value, true); await voice.record();
  mic.samples(new Float32Array(48000 * 2).fill(.02)); assert.ok(voice.sample().energy > 0);
  await voice.record();
  for (let i = 0; i < 100 && !transcript; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(transcript, 'Quero definir uma especificação.'); assert.equal(posted, 1); assert.equal(providerCalls, 1);
  assert.equal(states.at(-1).state, 'idle'); assert.equal(states.at(-1).config.reservedUsd, .1);
});

test('empty transcription and transport failures have safe actionable codes and no automatic retry', async () => {
  for (const kind of ['empty', 'network', 'invalid-json']) {
    let callbacks, calls = 0; const states = [];
    const voice = createVoiceController({ token: 'opaque', onState: v => states.push(v), onTranscript: () => assert.fail('no draft on failure'),
      captureFactory: value => { callbacks = value; return { start() {}, cancel() {}, dispose() {} }; },
      playerFactory: () => ({ stop() {}, dispose() {} }),
      fetcher: async url => {
        if (url.endsWith('config')) return Response.json({ enabled: true, provider: 'fake' });
        calls++;
        if (kind === 'network') throw new Error('private transport details');
        if (kind === 'invalid-json') return new Response('private raw response');
        return Response.json({ error: 'E_TRANSCRIPT', reservedUsd: .1 }, { status: 409 });
      } });
    await voice.init(); voice.sync(snapshot(), true); await callbacks.onComplete(wav());
    const code = { empty: 'E_TRANSCRIPT', network: 'E_AUDIO_NETWORK', 'invalid-json': 'E_AUDIO_RESPONSE' }[kind];
    assert.equal(states.at(-1).error, code); assert.equal(calls, 1);
    assert.match(voiceErrorMessage(code), new RegExp(code)); assert.doesNotMatch(JSON.stringify(states), /private/);
    if (kind === 'empty') assert.match(voiceErrorMessage(code), /microfone/);
    voice.dispose();
  }
  const provider = createOpenAiAudio({ key: 'synthetic', fetcher: async () => Response.json({ text: '' }) });
  await assert.rejects(provider.transcribe(wav()), { code: 'E_TRANSCRIPT' });
  assert.doesNotMatch(voiceErrorMessage('private raw response'), /private/);
});

test('transcription response distinguishes no speech, incompatible shape and excessive text', async () => {
  for (const [value, code] of [[{ text: '' }, 'E_TRANSCRIPT'], [{ text: '  ' }, 'E_TRANSCRIPT'],
    [null, 'E_TRANSCRIPT_RESPONSE'], [{ transcript: 'unexpected field' }, 'E_TRANSCRIPT_RESPONSE'],
    [{ text: 'a'.repeat(8001) }, 'E_TRANSCRIPT_LIMIT']]) {
    const provider = createOpenAiAudio({ key: 'synthetic', fetcher: async () => Response.json(value) });
    await assert.rejects(provider.transcribe(wav()), { code });
    assert.match(voiceErrorMessage(code), new RegExp(code));
  }
});

test('microphone choice and local recording remain private and preview clears across sessions', async () => {
  let callbacks, chosen, posted; const states = [], recordings = [];
  const voice = createVoiceController({ token: 'opaque', onState: value => states.push(value), onTranscript() {}, onRecording: value => recordings.push(value),
    captureFactory: value => { callbacks = value; return { cancel() {}, dispose() {}, start(options) { chosen = options.deviceId; } }; },
    playerFactory: () => ({ stop() {}, dispose() {} }),
    fetcher: async (url, options) => {
      if (url.endsWith('config')) return Response.json({ enabled: true, provider: 'fake' });
      posted = JSON.parse(options.body); return Response.json({ error: 'E_TRANSCRIPT', reservedUsd: .1 }, { status: 409 });
    } });
  await voice.init(); voice.sync(snapshot(), true);
  callbacks.onDevices([{ id: 'local-device', label: 'Private microphone name' }], 'local-device');
  voice.selectMicrophone('injected-device');
  assert.equal(states.at(-1).microphoneId, 'local-device');
  await voice.record(); assert.equal(chosen, 'local-device');
  const bytes = wav(); await callbacks.onComplete(bytes);
  assert.equal(recordings.at(-1), bytes); assert.equal(states.at(-1).error, 'E_TRANSCRIPT');
  assert.doesNotMatch(JSON.stringify(posted), /local-device|Private microphone/);
  voice.sync({ ...snapshot(), sessionId: 'different-session' }, true); assert.equal(recordings.at(-1), null);
  voice.dispose(); assert.equal(recordings.at(-1), null);
});

test('microphone configuration can list the notebook input even when opening the default USB fails', async () => {
  const mic = microphoneFixture(), states = [], errors = [], lists = [];
  const originalGet = mic.environment.navigator.mediaDevices.getUserMedia;
  let authorized = false, opened = [];
  mic.environment.navigator.mediaDevices.enumerateDevices = async () => [
    { kind: 'audioinput', deviceId: 'usb', label: authorized ? 'USB headset' : '' },
    { kind: 'audioinput', deviceId: 'notebook', label: authorized ? 'Notebook microphone' : '' },
    { kind: 'audiooutput', deviceId: 'speakers', label: 'Speakers' },
  ];
  mic.environment.navigator.mediaDevices.getUserMedia = async options => {
    opened.push(options); authorized = true;
    if (options.audio?.deviceId?.exact !== 'notebook') throw Object.assign(new Error('broken default input'), { name: 'NotReadableError' });
    return originalGet(options);
  };
  const capture = createVoiceCapture({ environment: mic.environment, onState: value => states.push(value), onError: code => errors.push(code),
    onDevices: devices => lists.push(devices), onComplete: () => assert.fail('configuration must not create a recording') });
  await capture.prepare();
  assert.deepEqual(errors, ['E_MIC_UNAVAILABLE']); assert.equal(lists.at(-1).length, 2);
  assert.equal(lists.at(-1)[1].label, 'Notebook microphone'); assert.equal(mic.closed, 0);
  await capture.prepare(); assert.equal(opened.length, 1); assert.equal(states.at(-1), 'idle');
  await capture.prepare({ deviceId: 'notebook' });
  assert.equal(opened.at(-1).audio.deviceId.exact, 'notebook');
  assert.equal(mic.stopped, 1); assert.equal(mic.closed, 0); assert.equal(states.at(-1), 'idle');
  await capture.start({ deviceId: 'notebook' });
  assert.equal(opened.at(-1).audio.deviceId.exact, 'notebook'); assert.equal(states.at(-1), 'recording');
  capture.dispose(); assert.equal(mic.stopped, 2);
});

test('permission-only preparation stops its probe immediately and drops a late grant after cancellation', async () => {
  for (const cancelled of [false, true]) {
    let grant, stops = 0; const states = [], lists = [];
    const capture = createVoiceCapture({ onState: state => states.push(state), onError: () => assert.fail('unexpected failure'),
      onDevices: devices => lists.push(devices), onComplete: () => assert.fail('no recording during setup'),
      environment: { navigator: { mediaDevices: {
        enumerateDevices: async () => [],
        getUserMedia: () => new Promise(resolve => { grant = resolve; }),
      } }, AudioContext: class { constructor() { assert.fail('no AudioContext during setup'); } } } });
    const preparing = capture.prepare();
    await new Promise(resolve => setImmediate(resolve)); if (cancelled) capture.cancel();
    grant({ getTracks: () => [{ stop() { stops++; } }] }); await preparing;
    assert.equal(stops, 1); assert.equal(states.at(-1), cancelled ? 'requesting' : 'idle');
    assert.equal(lists.length, cancelled ? 1 : 2); capture.dispose();
  }
});

test('configuring or refreshing microphones never issues a voice request and preserves an explicit selection', async () => {
  let callbacks, prepares = 0, reads = 0; const states = [];
  const devices = [{ id: 'notebook', label: 'Notebook microphone' }];
  const voice = createVoiceController({ token: 'opaque', onState: value => states.push(value), onTranscript() {},
    captureFactory: value => { callbacks = value; return { cancel() {}, dispose() {}, listDevices: async () => { callbacks.onDevices(devices); },
      prepare: async value => { assert.equal(value.deviceId, 'notebook'); prepares++; callbacks.onDevices(devices); callbacks.onState('idle'); } }; },
    playerFactory: () => ({ stop() {}, dispose() {} }),
    fetcher: async url => { assert.ok(url.endsWith('config')); reads++; return Response.json({ enabled: true, provider: 'fake' }); } });
  await voice.init(); voice.sync(snapshot(), true); voice.selectMicrophone('notebook');
  await voice.prepareMicrophone(); assert.equal(prepares, 1); assert.equal(reads, 1);
  assert.equal(states.at(-1).microphoneId, 'notebook'); assert.equal(states.at(-1).state, 'idle'); voice.dispose();
});
