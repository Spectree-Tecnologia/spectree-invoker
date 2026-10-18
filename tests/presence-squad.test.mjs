import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPresenceSession } from '../presence/server/session.mjs';
import { createPresenceSquad } from '../presence/server/squad.mjs';
import { PRESENCE_ROLES, presenceRoleIds } from '../presence/server/roles.mjs';
import { startPresence } from '../presence/server/server.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const result = role => ({ recommendation: `Consultation by ${role}.`, assumptions: ['Synthetic context only.'],
  openQuestions: [], publicUtterance: `Invoker, esta é a recomendação de ${role}.` });
const input = (role = 'solutions_architect', requestId = crypto.randomUUID()) => ({
  sessionId: 'owner-session', requestId, role, context: { question: 'Evaluate a fictional local canary.' } });
async function until(predicate) {
  const deadline = performance.now() + 2000;
  while (!predicate() && performance.now() < deadline) await sleep(5);
  assert.ok(predicate(), 'expected state did not arrive');
}
function harness(options = {}) {
  const actors = []; let serial = 0;
  const factory = ({ role, ...settings }) => {
    const actor = { role, calls: [], interrupts: 0, closes: 0 };
    actor.session = createPresenceSession({ ...settings, role, rpcFactory: hooks => {
      const threadId = `private-thread-${++serial}`, turnId = `private-turn-${serial}`;
      actor.threadId = threadId; actor.turnId = turnId;
      actor.emit = (method, params = {}) => hooks.onNotification(method, { threadId, turnId, ...params });
      actor.complete = (text = JSON.stringify(result(role)), status = 'completed') => {
        actor.emit('item/reasoning/textDelta', { delta: 'PRIVATE REASONING' });
        actor.emit('item/agentMessage/delta', { itemId: 'answer', delta: text });
        actor.emit('item/completed', { item: { id: 'answer', type: 'agentMessage', text } });
        actor.emit('turn/completed', { turn: { id: turnId, status } });
      };
      return { notify() {}, close() { actor.closes++; }, async request(method, params) {
        actor.calls.push({ method, params });
        if (method === 'account/read') return { account: { type: 'chatgpt', accessToken: 'PRIVATE_TOKEN' } };
        if (method === 'config/read') return { config: { features: { shell_tool: false, apps: false, plugins: false, multi_agent: false }, mcp_servers: { private: {} } } };
        if (method === 'thread/start') {
          if (options.deferConnect) await new Promise(resolve => { actor.releaseConnect = resolve; });
          return { thread: { id: threadId, ephemeral: true, environments: [] }, cwd: params.cwd,
            approvalPolicy: 'never', approvalsReviewer: 'user', model: 'fixture-model', modelProvider: 'openai', sandbox: { type: 'readOnly', networkAccess: false } };
        }
        if (method === 'turn/start') {
          if (options.deferStart) await new Promise(resolve => { actor.releaseStart = resolve; });
          actor.emit('turn/started', { turn: { id: turnId } });
          if (options.autoComplete !== false) actor.complete(options.answer);
          return { turn: { id: turnId } };
        }
        if (method === 'turn/interrupt') {
          actor.interrupts++;
          if (options.confirmInterrupt !== false) actor.emit('turn/completed', { turn: { id: turnId, status: 'interrupted' } });
        }
        return {};
      } };
    } });
    actors.push(actor); return actor.session;
  };
  return { actors, factory };
}
function fixture(t, options = {}) {
  const value = { sessionId: 'owner-session', status: 'ready', messages: [] };
  let sends = 0;
  const parent = { snapshot: () => structuredClone(value), touch() {}, close() { value.status = 'disconnected'; },
    async connect() { value.sessionId = crypto.randomUUID(); value.status = 'ready'; },
    async send() { sends++; value.status = 'running'; }, async interrupt() { value.status = 'interrupted'; },
    disconnect() { value.status = 'disconnected'; } };
  const rpc = harness(options);
  const service = createPresenceSquad({ session: parent, sessionFactory: rpc.factory, pollMs: 5,
    timeoutMs: 1500, cancelTimeoutMs: 60, ...options.service });
  t.after(async () => { await service.close(); for (const actor of rpc.actors) actor.session.close(); });
  return { service, parent, value, ...rpc, get sends() { return sends; } };
}

test('P41/A13 registry contains all six canonical roles and TypeSafe remains conditional', t => {
  const roles = JSON.parse(readFileSync(new URL('../schemas/common.json', import.meta.url))).definitions.role.enum.filter(x => x !== 'invoker');
  assert.deepEqual(presenceRoleIds, roles);
  for (const profile of Object.values(PRESENCE_ROLES)) assert.ok(existsSync(new URL(`../${profile.canonicalProfile}`, import.meta.url)));
  const f = fixture(t), config = f.service.config();
  assert.equal(config.roles.length, 6); assert.equal(config.roles.find(r => r.role === 'typesafe_engineer').eligible, false);
  assert.equal(config.tool.name, 'delegar_subagente'); assert.equal(config.tool.parameters.properties.role.enum.length, 5);
  assert.throws(() => f.service.delegate(input('typesafe_engineer')), { code: 'E_SQUAD_INELIGIBLE' });
  assert.equal(f.actors.length, 0);
});

for (const role of presenceRoleIds) test(`P41/A1,A13 ${role} dispatches a separate restricted Codex profile and publishes only its validated result`, async t => {
  const f = fixture(t, { service: { typesafeEnabled: true } });
  const admitted = f.service.delegate(input(role)); assert.equal(admitted.status, 'admitted'); assert.equal(admitted.result, null);
  await until(() => !f.service.busy());
  const view = f.service.snapshot(), record = view.delegations[0], actor = f.actors[0];
  assert.equal(record.status, 'completed'); assert.equal(record.role, role); assert.deepEqual(record.result, result(role));
  const thread = actor.calls.find(c => c.method === 'thread/start').params;
  assert.ok(thread.developerInstructions.includes(`(${role})`)); assert.equal(thread.sandbox, 'read-only');
  assert.equal(thread.approvalPolicy, 'never'); assert.deepEqual(thread.environments, []);
  assert.deepEqual(thread.selectedCapabilityRoots, []); assert.equal(thread.config['mcp_servers.private.enabled'], false);
  assert.equal(thread.ephemeral, true); assert.notEqual(thread.cwd, process.cwd());
  const turn = actor.calls.find(c => c.method === 'turn/start').params;
  assert.deepEqual(Object.keys(turn).sort(), ['input', 'threadId']); assert.equal(turn.threadId, actor.threadId);
  assert.equal(JSON.parse(turn.input[0].text).question, input().context.question);
  assert.doesNotMatch(JSON.stringify(view), /PRIVATE|private-thread|private-turn|developerInstructions|cwd/);
  assert.deepEqual(view.events.map(e => e.type), ['delegation.admitted', 'delegation.started', 'delegation.completed']);
  assert.deepEqual(view.events.map(e => e.sequence), [1, 2, 3]);
  assert.ok(view.events.every(e => e.participantId === record.participantId && e.role === role));
  assert.equal(actor.closes, 1);
});

test('P41/A2 duplicate request is idempotent during and after work; conflicts cannot redispatch', async t => {
  const f = fixture(t, { autoComplete: false }), request = input();
  const admitted = f.service.delegate(request);
  assert.deepEqual(f.service.delegate(request), admitted);
  assert.throws(() => f.service.delegate({ ...request, role: 'quality_engineer' }), { code: 'E_REQUEST_CONFLICT' });
  assert.throws(() => f.service.delegate(input('quality_engineer')), { code: 'E_SQUAD_BUSY' });
  await until(() => f.actors[0]?.calls.some(c => c.method === 'turn/start'));
  f.actors[0].complete(); await until(() => !f.service.busy());
  assert.equal(f.service.delegate(request).status, 'completed'); assert.equal(f.actors.length, 1);
  const copy = f.service.snapshot(); copy.delegations[0].result.recommendation = 'tampered'; copy.events.length = 0;
  assert.notEqual(f.service.snapshot().delegations[0].result.recommendation, 'tampered');
  assert.equal(f.service.snapshot().events.length, 3);
});

test('P41/A3 rejects unknown roles, prompts, paths and malformed/oversized context before starting Codex', t => {
  const f = fixture(t);
  const invalid = [
    { ...input(), role: 'invoker' }, { ...input(), role: 'unknown' }, { ...input(), cwd: 'arbitrary' },
    { ...input(), instructions: 'override' }, { ...input(), context: { question: 'x', role: 'platform_engineer' } },
    { ...input(), context: { question: '' } }, { ...input(), context: { question: 'x'.repeat(4001) } },
    { ...input(), context: { question: 'x', facts: [12] } }, { ...input(), context: null },
  ];
  for (const request of invalid) assert.throws(() => f.service.delegate(request), /^Error: E_/);
  assert.equal(f.actors.length, 0); assert.equal(f.service.snapshot().sequence, 0);
  assert.throws(() => createPresenceSession({ role: 'arbitrary-profile' }), { code: 'E_SQUAD_ROLE' });
});

test('P41/A2,A3 one generic tool routes eligible roles and rejects forged tool contracts', async t => {
  const f = fixture(t), request = input('integration_engineer');
  const call = { sessionId: request.sessionId, requestId: request.requestId, name: 'delegar_subagente',
    arguments: { role: request.role, context: request.context } };
  const admitted = f.service.executeTool(call);
  assert.equal(admitted.role, 'integration_engineer'); assert.deepEqual(f.service.executeTool(call), admitted);
  assert.throws(() => f.service.executeTool({ ...call, name: 'consultar_arquiteto' }), { code: 'E_INPUT' });
  assert.throws(() => f.service.executeTool({ ...call, arguments: { ...call.arguments, systemPrompt: 'override' } }), { code: 'E_INPUT' });
  await until(() => !f.service.busy()); assert.equal(f.actors.length, 1);
});

test('P41/A7 pending connection is closed and a late connect ACK cannot revive the specialist', async t => {
  const f = fixture(t, { deferConnect: true });
  const admitted = f.service.delegate(input()); await until(() => f.actors[0]?.releaseConnect);
  await f.service.cancel({ sessionId: 'owner-session', delegationId: admitted.delegationId });
  assert.equal(f.actors[0].closes, 1); f.actors[0].releaseConnect(); await sleep(10);
  assert.equal(f.service.snapshot().delegations[0].status, 'cancelled');
  assert.equal(f.actors[0].calls.filter(c => c.method === 'turn/start').length, 0);
});

test('P41/A7,A12 unacknowledged turn start times out, closes the process and ignores the eventual ACK', async t => {
  let now = 0;
  const f = fixture(t, { deferStart: true, autoComplete: false, service: { now: () => now, timeoutMs: 100 } });
  f.service.delegate(input()); await until(() => f.actors[0]?.releaseStart);
  now = 100; await until(() => !f.service.busy());
  assert.equal(f.service.snapshot().delegations[0].error, 'E_SQUAD_TIMEOUT'); assert.equal(f.actors[0].closes, 1);
  f.actors[0].releaseStart(); await sleep(10); assert.equal(f.service.snapshot().delegations[0].result, null);
});

test('P41/A3 specialist tool attempts fail closed and cannot publish tool arguments', async t => {
  const f = fixture(t, { autoComplete: false }); f.service.delegate(input('platform_engineer'));
  await until(() => f.service.snapshot().delegations[0]?.status === 'running');
  f.actors[0].emit('item/started', { item: { type: 'commandExecution', command: 'PRIVATE TOOL ARGUMENT' } });
  await until(() => !f.service.busy()); assert.equal(f.service.snapshot().delegations[0].status, 'failed');
  assert.equal(f.service.snapshot().delegations[0].result, null); assert.doesNotMatch(JSON.stringify(f.service.snapshot()), /PRIVATE TOOL/);
});

test('P41/A4 cancellation before turn/start ACK waits for an interruptible ID and terminal notification', async t => {
  const f = fixture(t, { autoComplete: false, deferStart: true, confirmInterrupt: false });
  const admitted = f.service.delegate(input()); await until(() => f.actors[0]?.releaseStart);
  const cancelling = f.service.cancel({ sessionId: 'owner-session', delegationId: admitted.delegationId });
  assert.equal(f.service.snapshot().delegations[0].status, 'cancelling');
  assert.equal(f.actors[0].interrupts, 0); f.actors[0].releaseStart();
  await until(() => f.actors[0].interrupts === 1);
  assert.equal(f.service.busy(), true); // RPC acknowledgement does not mean completion.
  f.actors[0].emit('turn/completed', { turn: { id: f.actors[0].turnId, status: 'interrupted' } });
  assert.equal((await cancelling).status, 'cancelled'); assert.equal(f.service.busy(), false);
  f.actors[0].complete(); assert.equal(f.service.snapshot().delegations[0].result, null);
});

test('P41/A4 immediate cancellation never opens a specialist session', async t => {
  const f = fixture(t), admitted = f.service.delegate(input());
  await f.service.cancel({ sessionId: 'owner-session', delegationId: admitted.delegationId });
  assert.equal(f.actors.length, 0); assert.equal(f.service.snapshot().delegations[0].status, 'cancelled');
});

test('P41/A7 unconfirmed cancellation closes only the owned session; repeated cancellation is terminal once', async t => {
  const f = fixture(t, { autoComplete: false, confirmInterrupt: false });
  const admitted = f.service.delegate(input()); await until(() => f.service.snapshot().delegations[0]?.status === 'running');
  const target = { sessionId: 'owner-session', delegationId: admitted.delegationId };
  const [a, b] = await Promise.all([f.service.cancel(target), f.service.cancel(target)]);
  assert.equal(a.status, 'cancelled'); assert.deepEqual(a, b); assert.equal(f.actors[0].interrupts, 1);
  assert.equal(f.actors[0].closes, 1);
  assert.equal(f.service.snapshot().events.filter(e => e.type === 'delegation.cancelled').length, 1);
});

test('P41/A7,A9 owner session replacement drops old results and does not project the previous context', async t => {
  const f = fixture(t, { autoComplete: false });
  f.service.delegate(input()); await until(() => f.service.snapshot().delegations[0]?.status === 'running');
  f.value.sessionId = 'replacement-owner';
  assert.equal(f.service.snapshot().delegations.length, 0);
  await until(() => !f.service.busy());
  f.actors[0].complete(); assert.equal(f.service.snapshot().sequence, 0);
  assert.throws(() => f.service.delegate(input()), { code: 'E_STALE_SESSION' });
  f.service.delegate({ ...input('quality_engineer'), sessionId: 'replacement-owner' });
  await until(() => f.actors.length === 2); assert.equal(f.actors[1].role, 'quality_engineer');
});

test('P41/A7 a specialist session replacement is not closed by cancellation of the old identity', async t => {
  const f = fixture(t, { autoComplete: false });
  const admitted = f.service.delegate(input()); await until(() => f.service.snapshot().delegations[0]?.status === 'running');
  const actor = f.actors[0]; actor.session.disconnect(actor.session.snapshot().sessionId);
  await actor.session.connect(); const replacement = actor.session.snapshot().sessionId, closes = actor.closes;
  await f.service.cancel({ sessionId: 'owner-session', delegationId: admitted.delegationId });
  assert.equal(actor.session.snapshot().sessionId, replacement); assert.equal(actor.session.snapshot().status, 'ready');
  assert.equal(actor.closes, closes);
});

for (const answer of ['not JSON', '{}', JSON.stringify({ ...result('quality_engineer'), privateReasoning: 'hidden' }),
  JSON.stringify({ ...result('quality_engineer'), publicUtterance: 'x'.repeat(1201) })]) {
  test(`P41/A8 invalid specialist return is never published or retried (${answer.length} chars)`, async t => {
    const f = fixture(t, { answer }); f.service.delegate(input('quality_engineer')); await until(() => !f.service.busy());
    const record = f.service.snapshot().delegations[0]; assert.equal(record.status, 'failed');
    assert.equal(record.error, 'E_SQUAD_RESULT'); assert.equal(record.result, null); assert.equal(f.actors.length, 1);
  });
}

test('P41/A12 deadline and contact loss cancel pending work without accepting a late result', async t => {
  for (const reason of ['timeout', 'lease']) {
    let now = 0;
    const f = fixture(t, { autoComplete: false, service: { now: () => now, timeoutMs: 100, leaseMs: 50 } });
    f.service.delegate(input()); await until(() => f.service.snapshot().delegations[0]?.status === 'running');
    now = reason === 'timeout' ? 100 : 60;
    await until(() => !f.service.busy());
    const record = f.service.snapshot().delegations[0]; assert.equal(record.status, 'failed');
    assert.equal(record.error, reason === 'timeout' ? 'E_SQUAD_TIMEOUT' : 'E_CONTACT_LOST');
    f.actors[0].complete(); assert.equal(f.service.snapshot().delegations[0].result, null);
  }
});

test('P41/A14,A15 sequential roles and repeated Developer instances never share context or cancellation', async t => {
  const f = fixture(t, { autoComplete: false }); const identities = [];
  for (const role of ['full_stack_developer', 'quality_engineer', 'full_stack_developer']) {
    const admitted = f.service.delegate({ ...input(role), context: { question: `Only context number ${identities.length}.` } });
    identities.push(admitted.participantId);
    await until(() => f.actors.length === identities.length && f.actors.at(-1).calls.some(c => c.method === 'turn/start'));
    if (f.actors.length > 1) f.actors[0].complete('late foreign result');
    f.actors.at(-1).complete(); await until(() => !f.service.busy());
  }
  assert.equal(new Set(identities).size, 3);
  for (const [index, actor] of f.actors.entries()) {
    assert.equal(actor.calls.filter(c => c.method === 'turn/start').length, 1);
    assert.equal(JSON.parse(actor.calls.find(c => c.method === 'turn/start').params.input[0].text).question, `Only context number ${index}.`);
  }
  assert.ok(f.service.snapshot().delegations.every(r => r.status === 'completed'));
  assert.deepEqual(f.service.snapshot().events.map(e => e.sequence), Array.from({ length: 9 }, (_, i) => i + 1));
});

test('P41 bounded delegation inventory refuses new work but preserves duplicate outcomes', async t => {
  const f = fixture(t, { service: { maxDelegations: 1 } }), request = input();
  f.service.delegate(request); await until(() => !f.service.busy());
  assert.throws(() => f.service.delegate(input()), { code: 'E_SQUAD_LIMIT' });
  assert.equal(f.service.delegate(request).status, 'completed');
  await f.service.close(); assert.throws(() => f.service.delegate(input()), { code: 'E_CLOSED' });
});

async function httpFixture(t, options = {}) {
  const f = fixture(t, options), server = await startPresence({ session: f.parent, squad: true, specialistSessionFactory: f.factory });
  t.after(async () => { await server.specialists.close(); server.server.closeAllConnections(); await new Promise(resolve => server.server.close(resolve)); });
  async function request(path, body, extra = {}) {
    const response = await fetch(server.origin + path, { method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${server.token}`, Origin: server.origin, 'Content-Type': 'application/json', ...extra },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, value: await response.json() };
  }
  return { ...f, server, request };
}
test('P41 HTTP authenticates generic delegation, enforces origin and shares request IDs with the Invoker', async t => {
  const f = await httpFixture(t);
  const url = '/presence/api/squad/action', body = { action: 'delegate', ...input('platform_engineer') };
  assert.equal((await f.request(url, body, { Authorization: '' })).status, 401);
  assert.equal((await f.request(url, body, { Origin: 'https://foreign.test' })).status, 403);
  assert.equal((await f.request(url, { ...body, cwd: 'forbidden' })).status, 400);
  const first = await f.request(url, body); assert.equal(first.status, 200); assert.equal(first.value.status, 'admitted');
  const replay = await f.request(url, body); assert.deepEqual(replay, first);
  const duplicate = await f.request('/presence/api/action', { action: 'send', sessionId: 'owner-session', requestId: body.requestId, text: 'same work' });
  assert.equal(duplicate.value.error, 'E_REQUEST_CONFLICT'); assert.equal(f.sends, 0);
  await until(() => !f.server.specialists.busy());
  const view = await f.request('/presence/api/squad/snapshot'); assert.equal(view.value.config.roles.length, 6);
  assert.equal(view.value.delegations[0].role, 'platform_engineer'); assert.equal(f.actors.length, 1);
});

test('P41 HTTP blocks a competing Invoker turn and disconnect waits for specialist cancellation', async t => {
  const f = await httpFixture(t, { autoComplete: false });
  const first = await f.request('/presence/api/squad/action', { action: 'delegate', ...input('integration_engineer') });
  assert.equal(first.status, 200);
  await until(() => f.server.specialists.snapshot().delegations[0]?.status === 'running');
  const send = await f.request('/presence/api/action', { action: 'send', sessionId: 'owner-session', requestId: crypto.randomUUID(), text: 'competing' });
  assert.equal(send.value.error, 'E_SQUAD_BUSY'); assert.equal(f.sends, 0);
  const disconnected = await f.request('/presence/api/action', { action: 'disconnect', sessionId: 'owner-session', requestId: crypto.randomUUID() });
  assert.equal(disconnected.status, 200); assert.equal(f.server.specialists.busy(), false); assert.equal(f.actors[0].interrupts, 1);
});

test('P41 existing text server has no squad API and audio mode cannot accidentally enable delegation', async t => {
  const f = fixture(t), server = await startPresence({ session: f.parent });
  t.after(() => { server.server.closeAllConnections(); server.server.close(); });
  const response = await fetch(server.origin + '/presence/api/squad/snapshot', { headers: { Authorization: `Bearer ${server.token}` } });
  assert.equal(response.status, 404);
  await assert.rejects(startPresence({ squad: true, realtime: true }), { code: 'E_SQUAD_MODE' });
});

test('P41 CLI refuses squad without Codex or mixed with paid audio before starting a server', () => {
  const entry = fileURLToPath(new URL('../scripts/presence.mjs', import.meta.url));
  for (const args of [['--squad'], ['--codex', '--squad', '--voice', '--budget-usd', '1'],
    ['--codex', '--squad', '--realtime', '--budget-usd', '1']]) {
    const child = spawnSync(process.execPath, [entry, ...args], { encoding: 'utf8', windowsHide: true, timeout: 3000 });
    assert.equal(child.status, 1); assert.match(child.stderr, /P4.1/); assert.doesNotMatch(child.stdout, /127\.0\.0\.1/);
  }
});
