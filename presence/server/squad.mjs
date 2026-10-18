import { createHash, randomUUID } from 'node:crypto';
import { createPresenceSession } from './session.mjs';
import { PRESENCE_ROLES, presenceRoleIds, presenceRole, validateSquadContext, validateSquadResult, squadTool } from './roles.mjs';

const fail = code => Object.assign(new Error(code), { code });
const id = value => typeof value === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(value);
const terminal = new Set(['completed', 'interrupted', 'disconnected', 'error']);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeCode = error => /^E_[A-Z_]+$/.test(error?.code ?? '') ? error.code : 'E_SQUAD_FAILED';

// Owns specialist sessions, not execution authority. No audio API is used here.
export function createPresenceSquad({ session, sessionFactory = options => createPresenceSession(options),
  typesafeEnabled = false, now = () => performance.now(), timeoutMs = 40000,
  cancelTimeoutMs = 10000, leaseMs = 45000, pollMs = 25, maxDelegations = 16 } = {}) {
  for (const [value, max] of [[timeoutMs, 40000], [cancelTimeoutMs, 10000], [leaseMs, 45000], [pollMs, 250], [maxDelegations, 32]]) {
    if (!Number.isInteger(value) || value <= 0 || value > max) throw fail('E_SQUAD_CONFIG');
  }
  if (!session?.snapshot || typeof typesafeEnabled !== 'boolean') throw fail('E_SQUAD_CONFIG');
  let owner = session.snapshot().sessionId, epoch = 0, sequence = 0, lastSeen = now(), closed = false, active;
  const requests = new Map(), records = new Map(); let events = [];
  const roles = presenceRoleIds.filter(role => role !== 'typesafe_engineer' || typesafeEnabled);
  const current = op => op.epoch === epoch && op.owner === owner;
  function publish(op, type) {
    if (current(op)) events.push({ version: 1, sessionId: owner, sequence: ++sequence, generation: op.generation,
      type: `delegation.${type}`, delegationId: op.record.delegationId,
      participantId: op.record.participantId, role: op.record.role, origin: 'codex' });
  }
  function syncOwner() {
    const next = session.snapshot().sessionId;
    if (next === owner) return;
    owner = next; epoch++; sequence = 0; lastSeen = now(); requests.clear(); records.clear(); events = [];
    if (active) void cancelOperation(active, 'E_STALE_SESSION', true);
  }
  function closeOwned(op) {
    if (op.actor && op.actor.snapshot().sessionId === op.actorId) op.actor.close();
  }
  function finish(op, status, error = null, result = null) {
    if (op.finished) return;
    op.finished = true; op.record.status = status; op.record.error = error; op.record.result = result;
    publish(op, status); closeOwned(op);
    if (active === op) active = undefined;
    op.resolveDone(structuredClone(op.record));
  }
  async function drain(op) {
    if (!op.actor) return;
    const deadline = performance.now() + cancelTimeoutMs;
    while (performance.now() < deadline) {
      const state = op.actor.snapshot();
      if (state.sessionId !== op.actorId || terminal.has(state.status)) return;
      if (state.status === 'ready') return;
      if (state.status === 'connecting') { op.actor.disconnect(op.actorId); return; }
      if (!op.interruptSent && state.canInterrupt) {
        op.interruptSent = true;
        try { void Promise.resolve(op.actor.interrupt(op.actorId)).catch(() => {}); } catch {}
      }
      await pause(pollMs);
    }
    if (op.actor.snapshot().sessionId === op.actorId) op.actor.disconnect(op.actorId);
  }
  function cancelOperation(op, code = 'E_SQUAD_CANCELLED', failed = false) {
    if (op.finished) return Promise.resolve(structuredClone(op.record));
    if (op.cancellation) return op.cancellation;
    op.cancelRequested = true; op.record.status = 'cancelling'; op.record.error = code;
    publish(op, 'cancelling'); op.stop();
    op.cancellation = (async () => {
      try { await drain(op); }
      catch { /* Cleanup still closes only this operation's owned session. */ }
      finally { finish(op, failed ? 'failed' : 'cancelled', code); }
      return structuredClone(op.record);
    })();
    return op.cancellation;
  }
  async function run(op) {
    const wait = async promise => {
      await Promise.race([promise, op.stopped]);
      if (op.cancelRequested) throw fail('E_SQUAD_CANCELLED');
    };
    try {
      if (op.cancelRequested) return;
      op.actor = sessionFactory({ role: op.record.role, turnTimeoutMs: timeoutMs });
      const connection = op.actor.connect(); op.actorId = op.actor.snapshot().sessionId;
      await wait(connection);
      if (!current(op) || op.actor.snapshot().sessionId !== op.actorId) throw fail('E_STALE_SESSION');
      op.threadId = op.actor.identity().threadId;
      if (typeof op.threadId !== 'string' || !op.threadId) throw fail('E_SQUAD_IDENTITY');
      await wait(op.actor.send(op.actorId, JSON.stringify(op.context)));
      const identity = op.actor.identity(); op.turnId = identity.turnId;
      if (identity.threadId !== op.threadId || typeof op.turnId !== 'string' || !op.turnId) throw fail('E_SQUAD_IDENTITY');
      op.record.status = 'running'; publish(op, 'started');
      while (!op.cancelRequested) {
        syncOwner(); if (op.cancelRequested) return;
        if (now() >= op.deadline) throw fail('E_SQUAD_TIMEOUT');
        if (!['ready', 'completed', 'interrupted'].includes(session.snapshot().status)) throw fail('E_SQUAD_OWNER');
        op.actor.touch(); const state = op.actor.snapshot(), identity = op.actor.identity();
        if (state.sessionId !== op.actorId || identity.threadId !== op.threadId || identity.turnId !== op.turnId) throw fail('E_SQUAD_IDENTITY');
        if (state.status === 'completed') {
          const answer = state.messages.filter(message => message.role === 'assistant' && message.turnId === op.turnId).at(-1);
          const result = validateSquadResult(answer?.text);
          finish(op, 'completed', null, result); return;
        }
        if (terminal.has(state.status)) throw fail(state.error ?? 'E_SQUAD_RESULT');
        await Promise.race([pause(pollMs), op.stopped]);
      }
    } catch (error) {
      if (!op.cancelRequested) await cancelOperation(op, safeCode(error), true);
    }
  }
  const monitor = setInterval(() => {
    syncOwner(); if (!active) return;
    if (now() >= active.deadline) void cancelOperation(active, 'E_SQUAD_TIMEOUT', true);
    else if (now() - lastSeen > leaseMs) void cancelOperation(active, 'E_CONTACT_LOST', true);
    else if (!['ready', 'completed', 'interrupted'].includes(session.snapshot().status)) void cancelOperation(active, 'E_SQUAD_OWNER', true);
  }, Math.min(pollMs, leaseMs)); monitor.unref();
  const service = {
    config() { return { enabled: !closed, mode: 'consultation-only', roles: presenceRoleIds.map(role => ({
      role, name: PRESENCE_ROLES[role].name, eligible: roles.includes(role), visualKey: PRESENCE_ROLES[role].visualKey,
    })), tool: squadTool([...roles]), maxActive: 1, maxDelegations, timeoutMs, audio: false }; },
    snapshot() {
      syncOwner(); return structuredClone({ version: 1, sessionId: owner, sequence,
        busy: !!active, delegations: [...records.values()], events });
    },
    busy() { syncOwner(); return !!active; },
    touch() { syncOwner(); lastSeen = now(); },
    executeTool(input) {
      if (!input || Array.isArray(input) || Object.keys(input).some(k => !['sessionId', 'requestId', 'name', 'arguments'].includes(k)) ||
        input.name !== 'delegar_subagente' || !input.arguments || Array.isArray(input.arguments) ||
        Object.keys(input.arguments).some(k => !['role', 'context'].includes(k))) throw fail('E_INPUT');
      return service.delegate({ sessionId: input.sessionId, requestId: input.requestId,
        role: input.arguments.role, context: input.arguments.context });
    },
    delegate(input) {
      syncOwner();
      if (closed) throw fail('E_CLOSED');
      if (!input || Array.isArray(input) || Object.keys(input).some(k => !['sessionId', 'requestId', 'role', 'context'].includes(k)) || !id(input.requestId)) throw fail('E_INPUT');
      if (input.sessionId !== owner) throw fail('E_STALE_SESSION');
      presenceRole(input.role);
      if (!roles.includes(input.role)) throw fail('E_SQUAD_INELIGIBLE');
      const context = validateSquadContext(input.context);
      const digest = createHash('sha256').update(JSON.stringify({ sessionId: owner, role: input.role, context })).digest('hex');
      const prior = requests.get(input.requestId);
      if (prior) {
        if (prior.digest !== digest) throw fail('E_REQUEST_CONFLICT');
        return structuredClone(prior.op.record);
      }
      if (active || !['ready', 'completed', 'interrupted'].includes(session.snapshot().status)) throw fail('E_SQUAD_BUSY');
      if (requests.size >= maxDelegations) throw fail('E_SQUAD_LIMIT');
      const record = { delegationId: randomUUID(), participantId: randomUUID(), role: input.role,
        name: PRESENCE_ROLES[input.role].name, status: 'admitted', error: null, result: null,
        source: 'codex', execution: 'conversation-only' };
      const op = { owner, epoch, generation: requests.size + 1, record, context, deadline: now() + timeoutMs };
      op.stopped = new Promise(resolve => { op.stop = resolve; });
      op.done = new Promise(resolve => { op.resolveDone = resolve; });
      requests.set(input.requestId, { digest, op }); records.set(record.delegationId, record);
      active = op; lastSeen = now(); publish(op, 'admitted'); queueMicrotask(() => void run(op));
      return structuredClone(record);
    },
    async cancel({ sessionId, delegationId } = {}) {
      syncOwner();
      if (sessionId !== owner) throw fail('E_STALE_SESSION');
      const record = records.get(delegationId); if (!record) throw fail('E_SQUAD_NOT_FOUND');
      if (active?.record === record) return cancelOperation(active);
      return structuredClone(record);
    },
    cancelActive() { return active ? cancelOperation(active) : Promise.resolve(); },
    close() { closed = true; clearInterval(monitor); return active ? cancelOperation(active, 'E_CLOSED') : Promise.resolve(); },
  };
  return service;
}
