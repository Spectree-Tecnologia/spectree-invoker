import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createPresenceSession } from '../scripts/lib/presence-session.mjs';
import { createCodexRpc } from '../scripts/lib/presence-rpc.mjs';
import { startPresence } from '../scripts/lib/presence-server.mjs';
import { createPresenceClient } from '../presence/client.mjs';

function fixture(overrides = {}) {
  let hooks, n = 0, closed = 0; const calls = [];
  const rpc = { notify() {}, close() { closed++; }, async request(method, params) {
    calls.push({ method, params });
    if (overrides[method]) return overrides[method](params, hooks);
    if (method === 'account/read') return { account: { type: 'chatgpt', email: 'private@example.com', accessToken: 'PRIVATE' } };
    if (method === 'config/read') return { config: { features: { shell_tool: false, apps: false, plugins: false, multi_agent: false }, mcp_servers: { private: {} } } };
    if (method === 'thread/start') return { thread: { id: 'thread-1', ephemeral: true, environments: [] }, cwd: params.cwd,
      approvalPolicy: 'never', approvalsReviewer: 'user', model: 'model-from-codex', modelProvider: 'openai', sandbox: { type: 'readOnly', networkAccess: false } };
    if (method === 'turn/start') {
      const turn = { id: `turn-${++n}` }; hooks.onNotification('turn/started', { threadId: 'thread-1', turn }); return { turn };
    }
    return {};
  } };
  const session = createPresenceSession({ rpcFactory: options => { hooks = options; return rpc; }, ...overrides.options });
  return { session, calls, get closed() { return closed; },
    emit(method, params) { hooks.onNotification(method, { threadId: 'thread-1', turnId: `turn-${n}`, ...params }); },
    fail(code) { hooks.onFailure(code); } };
}

test('Codex session uses authenticated ephemeral thread, only public text and confirmed completion', async t => {
  const f = fixture(); t.after(() => f.session.close());
  const ready = await f.session.connect(); assert.equal(ready.status, 'ready');
  const start = f.calls.find(c => c.method === 'thread/start').params;
  assert.deepEqual(start.environments, []); assert.equal(start.ephemeral, true); assert.equal(start.sandbox, 'read-only');
  assert.equal(start.config['mcp_servers.private.enabled'], false);
  await f.session.send(ready.sessionId, 'Olá');
  f.emit('item/reasoning/textDelta', { delta: 'SECRET THOUGHTS' });
  f.emit('item/agentMessage/delta', { threadId: 'other', itemId: 'x', delta: 'FOREIGN' });
  f.emit('item/agentMessage/delta', { turnId: 'other', itemId: 'x', delta: 'FOREIGN' });
  f.emit('item/agentMessage/delta', { itemId: 'answer', delta: 'Olá, ' });
  f.emit('item/agentMessage/delta', { itemId: 'answer', delta: 'Gilson.' });
  assert.equal(f.session.snapshot().messages[1].text, 'Olá, Gilson.');
  assert.equal(f.session.snapshot().status, 'running'); assert.equal(f.session.snapshot().speaker, null);
  f.emit('item/completed', { item: { id: 'answer', type: 'agentMessage', text: 'Olá, Gilson.' } });
  f.emit('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
  const value = f.session.snapshot(); assert.equal(value.status, 'completed'); assert.equal(value.messages.length, 2);
  assert.doesNotMatch(JSON.stringify(value), /PRIVATE|private@example|SECRET|FOREIGN/);
  await f.session.send(value.sessionId, 'Continue');
  f.emit('item/agentMessage/delta', { turnId: 'turn-1', itemId: 'answer', delta: 'STALE' });
  assert.equal(f.session.snapshot().messages.length, 3);
});

test('interrupt is a request, not completion; stale sessions and overlapping sends are refused', async t => {
  const f = fixture(); t.after(() => f.session.close()); const ready = await f.session.connect();
  await f.session.send(ready.sessionId, 'Olá');
  await assert.rejects(f.session.send(ready.sessionId, 'Duplicado'), { code: 'E_NOT_READY' });
  await assert.rejects(f.session.interrupt('stale'), { code: 'E_STALE_SESSION' });
  await f.session.interrupt(ready.sessionId); assert.equal(f.session.snapshot().status, 'interrupting');
  f.emit('turn/completed', { turn: { id: 'turn-1', status: 'interrupted' } });
  assert.equal(f.session.snapshot().status, 'interrupted');
  f.session.disconnect(ready.sessionId); f.emit('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
  assert.equal(f.session.snapshot().status, 'disconnected');
});

test('failed turns, transport loss and tool attempts never project success or tool arguments', async t => {
  for (const event of ['failed', 'exit', 'tool']) {
    const f = fixture(); t.after(() => f.session.close()); const s = await f.session.connect(); await f.session.send(s.sessionId, 'Teste');
    if (event === 'failed') f.emit('turn/completed', { turn: { id: 'turn-1', status: 'failed', error: { message: 'PRIVATE' } } });
    if (event === 'exit') f.fail('E_CODEX_EXIT');
    if (event === 'tool') f.emit('item/started', { item: { type: 'commandExecution', command: 'PRIVATE' } });
    assert.equal(f.session.snapshot().status, 'error'); assert.doesNotMatch(JSON.stringify(f.session.snapshot()), /PRIVATE/);
  }
});

test('API-key accounts, active hooks and permissive sandboxes are rejected before conversation', async t => {
  const cases = [
    ['account/read', () => ({ account: { type: 'apiKey' } }), 'E_CHATGPT_LOGIN'],
    ['config/read', () => ({ config: { hooks: { SessionStart: [{}] } } }), 'E_HOOKS_UNSUPPORTED'],
    ['thread/start', () => ({ thread: { id: 'x' }, sandbox: { type: 'dangerFullAccess' } }), 'E_CONFIGURATION'],
  ];
  for (const [method, handler, code] of cases) {
    const f = fixture({ [method]: handler }); t.after(() => f.session.close());
    await assert.rejects(f.session.connect(), { code }); assert.equal(f.session.snapshot().status, 'error'); assert.equal(f.closed, 1);
  }
});

test('absence of heartbeat and turn deadline close the process; old async connect cannot revive a session', async t => {
  let now = 0; const f = fixture({ options: { now: () => now, leaseMs: 15 } }); t.after(() => f.session.close());
  await f.session.connect(); now = 100;
  await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(f.session.snapshot().error, 'E_CONTACT_LOST');
  const timeout = fixture({ options: { turnTimeoutMs: 10 } }); t.after(() => timeout.session.close());
  const ready = await timeout.session.connect(); await timeout.session.send(ready.sessionId, 'Teste');
  await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(timeout.session.snapshot().error, 'E_TURN_TIMEOUT');
  let resolveThread;
  const old = fixture({ 'thread/start': () => new Promise(resolve => { resolveThread = resolve; }) }); t.after(() => old.session.close());
  const connecting = old.session.connect(); await new Promise(resolve => setImmediate(resolve));
  old.session.disconnect(old.session.snapshot().sessionId);
  resolveThread({ thread: { id: 'late' }, sandbox: { type: 'readOnly' }, modelProvider: 'openai' });
  await assert.rejects(connecting, { code: 'E_STALE_SESSION' }); assert.equal(old.session.snapshot().status, 'disconnected');
});

function rpcFixture(options = {}) {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { child.killed = true; }; const outgoing = []; child.stdin.on('data', chunk => outgoing.push(JSON.parse(chunk.toString())));
  const failures = [], events = [];
  const rpc = createCodexRpc({ cwd: process.cwd(), spawnProcess: () => child, onFailure: code => failures.push(code), onNotification: (...e) => events.push(e), ...options });
  return { rpc, child, outgoing, failures, events, emit: message => child.stdout.write(JSON.stringify(message) + '\n') };
}

test('Codex executable override works without PATH, preserves spaces and remains server-side', () => {
  const configured = join(process.cwd(), 'Codex local', 'codex.exe');
  const explicit = join(process.cwd(), 'Other Codex', 'codex.exe');
  for (const [executable, expected] of [[undefined, configured], [explicit, explicit]]) {
    let launched;
    const f = rpcFixture({ executable,
      environment: { PATH: '', SPECTREE_CODEX_EXECUTABLE: configured, OPENAI_API_KEY: 'synthetic-secret' },
      spawnProcess: (file, args, options) => {
        launched = { file, args, options };
        const child = new EventEmitter();
        child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
        return child;
      } });
    assert.equal(launched.file, expected);
    assert.deepEqual(launched.args.slice(0, 3), ['app-server', '--listen', 'stdio://']);
    assert.equal(launched.options.shell, false);
    assert.equal(launched.options.env.OPENAI_API_KEY, undefined);
    f.rpc.close();
  }
});

test('audio API credential is removed from the Codex child environment', () => {
  let childEnvironment;
  const f = rpcFixture({ environment: { PATH: process.env.PATH, OPENAI_API_KEY: 'synthetic-secret', openai_api_key: 'synthetic-lowercase', KEEP: 'yes' },
    spawnProcess: (_file, _args, options) => {
      childEnvironment = options.env;
      const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
      return child;
    } });
  assert.equal(childEnvironment.KEEP, 'yes'); assert.equal(childEnvironment.OPENAI_API_KEY, undefined); assert.equal(childEnvironment.openai_api_key, undefined);
  f.rpc.close();
});

test('stdio parser handles fragmented Unicode, correlation and refuses unsolicited approval requests', async () => {
  const f = rpcFixture(); const first = f.rpc.request('initialize'); const id = f.outgoing[0].id;
  const bytes = Buffer.from(JSON.stringify({ id, result: { text: 'ação' } }) + '\n');
  for (const byte of bytes) f.child.stdout.write(Buffer.from([byte]));
  assert.equal((await first).text, 'ação');
  f.emit({ method: 'item/commandExecution/requestApproval', id: 99, params: { command: 'PRIVATE' } });
  assert.deepEqual(f.failures, ['E_APPROVAL_UNSUPPORTED']); assert.equal(f.child.killed, true);
  assert.equal(f.outgoing[1].error.code, -32601); assert.deepEqual(f.events, []);
});

test('RPC timeout, exit, malformed response and stderr cannot leak or leave a pending request', async () => {
  for (const reason of ['timeout', 'exit', 'malformed']) {
    const f = rpcFixture({ timeoutMs: 10 }); const request = f.rpc.request('initialize');
    f.child.stderr.write('SECRET TOKEN');
    if (reason === 'exit') f.child.emit('exit', 1);
    if (reason === 'malformed') f.emit({ id: 1 });
    await assert.rejects(request, /^Error: E_/); assert.equal(f.failures.length, 1); assert.equal(f.child.killed, true);
    assert.doesNotMatch(JSON.stringify(f.failures), /SECRET/);
  }
});

function request(server, path, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(server.origin + path, { method, headers }, res => {
      let data = ''; res.on('data', c => { data += c; }); res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
    }); req.on('error', reject); req.end(body);
  });
}

test('live HTTP authenticates mutations, refuses arbitrary paths and sends once for identical request IDs', async t => {
  const f = fixture(), server = await startPresence({ session: f.session });
  t.after(() => { server.server.closeAllConnections(); server.server.close(); });
  const headers = { Authorization: `Bearer ${server.token}`, Origin: server.origin, 'Content-Type': 'application/json' };
  assert.equal((await request(server, '/presence/api/snapshot')).status, 401);
  assert.equal((await request(server, '/presence/api/snapshot', { headers: { ...headers, Host: 'evil.test' } })).status, 403);
  assert.equal((await request(server, '/presence/api/snapshot?x=1', { headers })).status, 404);
  assert.equal((await request(server, '/api/snapshot', { headers })).status, 404);
  const initial = JSON.parse((await request(server, '/presence/api/snapshot', { headers })).data);
  const connect = { action: 'connect', sessionId: initial.sessionId, requestId: 'request-connect' };
  assert.equal((await request(server, '/presence/api/action', { method: 'POST', headers: { ...headers, Origin: 'https://evil.test' }, body: JSON.stringify(connect) })).status, 403);
  const a = await request(server, '/presence/api/action', { method: 'POST', headers, body: JSON.stringify(connect) }); assert.equal(a.status, 200);
  const ready = JSON.parse(a.data), input = { action: 'send', sessionId: ready.sessionId, requestId: 'request-send', text: 'Olá' };
  const send = input => request(server, '/presence/api/action', { method: 'POST', headers, body: JSON.stringify(input) });
  const pair = await Promise.all([send(input), send(input)]); assert.ok(pair.every(r => r.status === 200));
  assert.equal(f.calls.filter(c => c.method === 'turn/start').length, 1);
  assert.equal((await send({ ...input, text: 'Outra' })).status, 409);
  assert.equal((await send({ ...input, requestId: 'request-evil', cwd: 'C:/private' })).status, 400);
  assert.equal((await send({ ...input, requestId: 'request-large', text: 'x'.repeat(45000) })).status, 413);
  await send({ action: 'disconnect', sessionId: ready.sessionId, requestId: 'request-disconnect' });
  const replay = await send(input);
  assert.deepEqual(JSON.parse(replay.data).messages, []); assert.equal(f.calls.filter(c => c.method === 'turn/start').length, 1);
  const page = await request(server, '/presence/'); assert.match(page.data, /live.mjs/); assert.doesNotMatch(page.data, new RegExp(server.token));
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
});

test('unconfirmed environment isolation is refused and late failures cannot revive disconnected text', async t => {
  const f = fixture({ 'thread/start': params => ({ thread: { id: 't', ephemeral: true }, cwd: params.cwd,
    approvalPolicy: 'never', approvalsReviewer: 'user', modelProvider: 'openai', sandbox: { type: 'readOnly' } }) });
  t.after(() => f.session.close()); await assert.rejects(f.session.connect(), { code: 'E_CONFIGURATION' });
  assert.equal(f.calls.some(c => c.method === 'turn/start'), false);
  const live = fixture(); t.after(() => live.session.close()); const s = await live.session.connect();
  await live.session.send(s.sessionId, 'Teste'); live.session.disconnect(s.sessionId); live.fail('E_CODEX_EXIT');
  assert.equal(live.session.snapshot().status, 'disconnected'); assert.deepEqual(live.session.snapshot().messages, []);
});

test('oversized assistant content and malformed stdio fail closed with bounded public state', async t => {
  const f = fixture(); t.after(() => f.session.close()); const s = await f.session.connect(); await f.session.send(s.sessionId, 'Teste');
  f.emit('item/agentMessage/delta', { itemId: 'a', delta: 'x'.repeat(32001) }); assert.equal(f.session.snapshot().error, 'E_HISTORY_LIMIT');
  assert.equal(f.session.snapshot().messages.length, 1);
  const wire = rpcFixture(); const pending = wire.rpc.request('initialize'); wire.child.stdout.write('not-json\n');
  await assert.rejects(pending, { code: 'E_PROTOCOL' }); assert.equal(wire.child.killed, true);
});

test('browser client ignores late snapshots and never retries a mutation after a lost response', async t => {
  let calls = 0; const updates = [], snapshot = { version: 1, origin: 'codex', sessionId: 's', revision: 3, status: 'ready', speaker: null, messages: [] };
  const client = createPresenceClient({ token: 'opaque', intervalMs: 10000, onUpdate: v => updates.push(v), fetcher: async (url, options) => {
    if (options.method === 'POST') { calls++; throw new Error('network'); }
    return { ok: true, json: async () => structuredClone(snapshot) };
  } });
  t.after(() => client.dispose());
  await client.refresh(); await assert.rejects(client.action('send', 'texto')); assert.equal(calls, 1);
  assert.equal(updates.at(-1).online, false); assert.equal(updates.at(-1).error, 'E_ACTION_UNKNOWN');
  await assert.rejects(client.action('send', 'texto'), /E_NOT_READY/); assert.equal(calls, 1);
  snapshot.revision = 1; await client.refresh(); assert.equal(updates.length, 2);
  client.dispose();
});
