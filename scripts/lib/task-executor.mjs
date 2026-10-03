// Sequential implementation executor. Task completion never advances lifecycle state.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync, readdirSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { Store } from './store.mjs';
import { withAuthority } from './lifecycle.mjs';
import { contractDigest } from './digest.mjs';
import { canDispatch } from './state-machine.mjs';
import { inside, identifier, bounded, refuse, references, snapshot, startWork, finishWork, reconcileWork, pendingWork, workRecords } from './work.mjs';
import { hash, contextPacket, packageRoot } from './context.mjs';
import { runAgent } from './agent-runner.mjs';
import { launch } from './launch.mjs';
import { parseTap, judgePassingRun } from './tap.mjs';

const file = (root, id) => inside(root, `.spectree/tasks/${identifier(id)}.json`);
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
function atomic(path, doc) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(doc, null, 2) + '\n', { flag: 'wx' });
  renameSync(temp, path);
}
function exclusive(root, id, fn) {
  const lock = inside(root, '.spectree/tasks/executor.lock');
  mkdirSync(dirname(lock), { recursive: true });
  try { writeFileSync(lock, JSON.stringify({ pid: process.pid, host: hostname(), change_id: id }), { flag: 'wx' }); }
  catch (e) { if (e.code === 'EEXIST') refuse('E_TASK_BUSY', 'An executor owns this checkout. Inspect its process and pending attempt before recovery.'); throw e; }
  try { return withAuthority(root, id, {}, fn); } finally { unlinkSync(lock); }
}
function save(root, doc) { atomic(file(root, doc.change_id), doc); }
function load(root, id) {
  let doc;
  try { doc = json(file(root, id)); } catch (e) { refuse('E_TASK_STORE', `Cannot read task plan: ${e.message}`); }
  if (doc.version !== 1 || doc.change_id !== id || hash(doc.plan) !== doc.plan_digest || !Array.isArray(doc.attempts) ||
      !doc.results || typeof doc.results !== 'object') refuse('E_TASK_STORE', 'Task store identity or plan digest is invalid.');
  validatePlan(root, doc.plan);
  if (doc.attempts.some((a) => !doc.plan.tasks.some((t) => t.id === a.task_id) || !['started', 'succeeded', 'failed', 'interrupted', 'unknown', 'reconciled'].includes(a.status))) refuse('E_TASK_STORE', 'Invalid attempt.');
  return doc;
}
const covers = (prefix, path) => path === prefix || (prefix.endsWith('/') && path.startsWith(prefix));
function pathScope(root, path) {
  bounded(path, 'allowed path');
  inside(root, path.endsWith('/') ? path.slice(0, -1) : path);
  if (/^(?:\.git|\.spectree|\.agents|\.codex|docs\/changes)(?:\/|$)/i.test(path) || /^(?:AGENTS|CLAUDE)\.md$/i.test(path)) refuse('E_TASK_SCOPE', 'Operational state, instructions and specs are not implementation paths.');
}
export function validatePlan(root, plan) {
  if (!plan || plan.version !== 1 || !Array.isArray(plan.tasks) || !plan.tasks.length || plan.tasks.length > 50) refuse('E_TASK_PLAN', 'Expected version 1 and 1..50 tasks.');
  const ids = new Set();
  for (const t of plan.tasks) {
    identifier(t.id); bounded(t.mission, 'mission', 2000);
    if (['constructor', 'prototype', '__proto__'].includes(t.id)) refuse('E_TASK_PLAN', 'Reserved task identifier.');
    if (ids.has(t.id)) refuse('E_TASK_PLAN', 'Duplicate task ID.'); ids.add(t.id);
    for (const k of ['depends_on', 'refs', 'scenarios', 'allowed_paths', 'checks']) {
      if (!Array.isArray(t[k]) || (k !== 'depends_on' && !t[k].length)) refuse('E_TASK_PLAN', `${k} must be an array${k === 'depends_on' ? '' : ' with entries'}.`);
    }
    if (!Number.isInteger(t.max_attempts) || t.max_attempts < 1 || t.max_attempts > 10) refuse('E_TASK_PLAN', 'max_attempts must be 1..10.');
    t.scenarios.forEach((s) => bounded(s, 'scenario', 300));
    t.allowed_paths.forEach((p) => pathScope(root, p));
    references(root, t.refs);
    for (const check of t.checks) {
      if (!t.scenarios.includes(check.scenario) || !Array.isArray(check.command) || !check.command.length ||
          !check.command.every((s) => typeof s === 'string' && s.length) || !Array.isArray(check.files) || !check.files.length ||
          !Number.isInteger(check.timeout_seconds) || check.timeout_seconds < 1 || check.timeout_seconds > 300) refuse('E_TASK_CHECK', 'Each check needs a declared scenario, argv, immutable files and timeout 1..300.');
      bounded(check.test_name, 'test name', 300); references(root, check.files);
    }
    if (t.scenarios.some((s) => !t.checks.some((c) => c.scenario === s))) refuse('E_TASK_CHECK', 'Every scenario needs an executable named test.');
    const protectedFiles = [...t.refs, ...t.checks.flatMap((c) => c.files)];
    if (protectedFiles.some((p) => t.allowed_paths.some((a) => covers(a, p)))) refuse('E_TASK_SCOPE', 'Implementation cannot modify its contract, reading or acceptance files.');
  }
  for (const t of plan.tasks) if (new Set(t.depends_on).size !== t.depends_on.length || t.depends_on.some((d) => !ids.has(d))) refuse('E_TASK_PLAN', 'Unknown or duplicate dependency.');
  const visited = new Set(); const visiting = new Set();
  function visit(id) {
    if (visiting.has(id)) refuse('E_TASK_CYCLE', 'Task dependencies contain a cycle.');
    if (visited.has(id)) return;
    visiting.add(id); plan.tasks.find((t) => t.id === id).depends_on.forEach(visit); visiting.delete(id); visited.add(id);
  }
  ids.forEach(visit);
  // No task may alter another task's acceptance oracle or contract.
  const protectedFiles = plan.tasks.flatMap((t) => [...t.refs, ...t.checks.flatMap((c) => c.files)]);
  if (plan.tasks.some((t) => protectedFiles.some((p) => t.allowed_paths.some((a) => covers(a, p))))) refuse('E_TASK_SCOPE', 'A task overlaps another task contract or acceptance file.');
  return plan;
}
function pins(root, plan) {
  const paths = [...new Set(plan.tasks.flatMap((t) => [...t.refs, ...t.checks.flatMap((c) => c.files)]))].sort();
  return paths.flatMap((p) => references(root, [p]));
}
function guard(root, doc) {
  const change = new Store(root).change(doc.change_id);
  if (!change || contractDigest(root, change).digest !== doc.contract_digest || hash(pins(root, doc.plan)) !== doc.pins_digest) refuse('E_TASK_STALE', 'Contract or acceptance inputs changed. Re-plan explicitly; never carry evidence forward.');
  if (doc.plan.tasks.some((t) => t.allowed_paths.some((p) => !(change.allowed_paths ?? []).some((a) => covers(a, p))))) refuse('E_TASK_SCOPE', 'Task paths exceed the registered change.');
  return change;
}
function implementationGate(root, id) {
  const result = launch([process.execPath, join(packageRoot, 'scripts/state.mjs'), 'plan', id, '--json'], {
    cwd: root, env: { ...process.env, SPECTREE_PROJECT_ROOT: root }, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  let plan;
  try { plan = JSON.parse(result.stdout); } catch { refuse('E_TASK_GATE', 'Cannot read lifecycle recommendation.'); }
  if (result.status !== 0 || plan.action !== 'implement_change' || plan.status !== 'ready' || !plan.gate?.ok) refuse('E_TASK_GATE', `${plan.code ?? plan.action}: ${plan.reason}`);
  const current = snapshot(root);
  if (!current.branch || /^(main|master)$/.test(current.branch)) refuse('E_TASK_BRANCH', 'A dedicated implementation branch is required.');
  let remoteDefault = '';
  try { remoteDefault = execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim().replace(/^origin\//, ''); } catch { /* no remote default */ }
  if (remoteDefault === current.branch) refuse('E_TASK_BRANCH', 'Cannot implement on the remote default branch.');
  return plan;
}
export function initTasks(root, id, plan) {
  identifier(id); validatePlan(root, plan);
  return exclusive(root, id, () => {
    if (existsSync(file(root, id))) refuse('E_TASK_EXISTS', 'Plan already exists. Task IDs and budgets cannot be reset by re-importing.');
    implementationGate(root, id);
    const change = new Store(root).change(id);
    const doc = { version: 1, change_id: id, plan, plan_digest: hash(plan), contract_digest: contractDigest(root, change).digest,
      pins_digest: hash(pins(root, plan)), attempts: [], results: {} };
    guard(root, doc); save(root, doc); return taskStatus(root, id);
  });
}
export function taskStatus(root, id) {
  const doc = load(root, id); guard(root, doc);
  const current = snapshot(root); const pending = doc.attempts.filter((a) => !['succeeded', 'reconciled'].includes(a.status));
  const tasks = doc.plan.tasks.map((t) => {
    const result = doc.results[t.id]; const count = doc.attempts.filter((a) => a.task_id === t.id).length;
    if (result) {
      let actual;
      try { actual = references(root, [result.evidence_ref])[0].sha256; } catch { /* missing evidence is not success */ }
      if (!actual || actual !== result.evidence_sha256) refuse('E_TASK_EVIDENCE', `Evidence for ${t.id} is missing or changed; reverify explicitly.`);
    }
    const status = result?.valid !== false && result?.content_digest === current.content_digest && result?.revision === current.revision ? 'verified'
      : result ? 'stale' : pending.some((a) => a.task_id === t.id) ? 'reconcile' : count >= t.max_attempts ? 'exhausted' : 'pending';
    return { id: t.id, status, attempts: count, depends_on: t.depends_on };
  });
  const blocked = pending.length > 0 || !!pendingWork(root, id) || tasks.some((t) => t.status === 'stale');
  const ready = blocked ? [] : tasks.filter((t) => t.status === 'pending' && t.depends_on.every((d) => tasks.find((x) => x.id === d).status === 'verified')).map((t) => t.id);
  return { version: 1, change_id: id, authorizes_execution: false, current, tasks, ready, complete: tasks.every((t) => t.status === 'verified'),
    pending: pending.map((a) => a.id), work_pending: pendingWork(root, id) };
}
export function requireTasksComplete(root, id) {
  if (!existsSync(file(root, id))) return; // Explicit adoption, never inferred for legacy projects.
  const status = taskStatus(root, id);
  if (!status.complete || status.pending.length || pendingWork(root, id)) refuse('E_TASK_INCOMPLETE', 'All registered tasks require current verified evidence before implemented.');
}
function inventory(root) {
  const names = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', stdio: 'pipe' }).split('\0').filter(Boolean);
  return Object.fromEntries([...new Set(names)].filter((p) => !p.startsWith('.spectree/')).sort().map((p) => {
    const f = inside(root, p); return [p, existsSync(f) ? hash(readFileSync(f)) : null];
  }));
}
function authorityStamp(root) {
  const result = [];
  function walk(rel) {
    const path = inside(root, rel); if (!existsSync(path)) return;
    const stat = lstatSync(path);
    if (stat.isDirectory()) readdirSync(path).sort().forEach((f) => walk(`${rel}/${f}`));
    else result.push([rel, hash(readFileSync(path))]);
  }
  for (const name of ['changes', 'approvals', 'evidence', 'closure', 'dispatches', 'project.json']) walk(`.spectree/${name}`);
  return hash(result);
}
function checks(root, tasks) {
  const before = snapshot(root); const output = [];
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  for (const task of tasks) for (const check of task.checks) {
    const began = performance.now();
    const run = launch(check.command, { cwd: root, env, encoding: 'utf8', timeout: check.timeout_seconds * 1000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    const verdict = run.error || run.signal ? { result: 'INCONCLUSIVE', reason: run.error?.code ?? run.signal }
      : judgePassingRun(parseTap(run.stdout), check.test_name, run.status);
    output.push({ task_id: task.id, scenario: check.scenario, test_name: check.test_name, command: check.command,
      ...verdict, stdout: run.stdout, stderr: run.stderr, elapsed_ms: Math.round(performance.now() - began) });
  }
  const after = snapshot(root);
  return { ok: output.every((r) => r.result === 'PASS') && before.content_digest === after.content_digest && before.revision === after.revision && before.branch === after.branch,
    candidate: after, checks: output };
}
function record(root, id, name, doc) {
  const path = inside(root, `.spectree/tasks/${id}/${name}.json`); mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(doc, null, 2) + '\n', { flag: 'wx' }); return `.spectree/tasks/${id}/${name}.json`;
}
export function runTask(root, id, taskId, config) {
  return exclusive(root, id, () => {
    const doc = load(root, id); guard(root, doc);
    if (!taskStatus(root, id).ready.includes(taskId)) refuse('E_TASK_NOT_READY', 'Task has unmet dependencies, stale evidence, pending work or exhausted attempts.');
    const gate = implementationGate(root, id); const task = doc.plan.tasks.find((t) => t.id === taskId);
    const previous = doc.attempts.filter((a) => a.task_id === taskId); const operation = `task-${randomUUID()}`;
    const dispatch = { schema_version: '1.0.0', dispatch_id: operation, change_id: id, role: 'full_stack_developer',
      mission: task.mission, exit_criteria: task.checks.map((c) => c.test_name), allowed_paths: task.allowed_paths,
      required_reading: task.refs, attempt: previous.length + 1, max_attempts: task.max_attempts,
      budget_key: `task:${id}:${taskId}`, input_revision: gate.preconditions.revision,
      ...(previous.length ? { previous_attempt: previous.at(-1).recovery } : {}) };
    const budget = canDispatch(dispatch, new Store(root).dispatches(id));
    if (!budget.ok) refuse(budget.code, budget.message);
    const packet = contextPacket(root, task, { change_id: id, preconditions: gate.preconditions, dispatch_id: operation },
      { adapter: config.context_adapter ?? 'codex' });
    const packetRef = record(root, id, `${operation}-packet`, packet);
    const before = inventory(root); const initial = snapshot(root);
    const attempt = { id: operation, task_id: taskId, status: 'started', input: initial, packet_ref: packetRef, adapter: config.kind };
    doc.attempts.push(attempt); save(root, doc);
    startWork(root, id, operation, { phase: 'implement', task: taskId, next: 'Inspect the agent outcome, then execute acceptance checks.', refs: [packetRef] });
    new Store(root).putDispatch(dispatch);
    const authority = authorityStamp(root);
    try {
      const agent = runAgent(root, packet, config);
      let verification = null;
      if (agent.status === 'reported_success') verification = checks(root, doc.plan.tasks.filter((t) => doc.results[t.id] || t.id === taskId));
      guard(root, doc);
      const after = inventory(root); const current = snapshot(root);
      const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((p) => before[p] !== after[p]);
      const scopeOk = changed.every((p) => task.allowed_paths.some((a) => covers(a, p)));
      const authorityOk = authorityStamp(root) === authority && current.revision === initial.revision && current.branch === initial.branch;
      const ok = agent.status === 'reported_success' && verification?.ok && scopeOk && authorityOk;
      const resultRef = record(root, id, `${operation}-result`, { agent, verification, changed, scope_ok: scopeOk, authority_ok: authorityOk });
      attempt.status = ok ? 'succeeded' : ['interrupted', 'unknown'].includes(agent.status) ? agent.status : 'failed';
      attempt.result_ref = resultRef;
      finishWork(root, id, operation, { result: { status: ok ? 'completed' : attempt.status === 'interrupted' ? 'interrupted' : 'failed' },
        next: ok ? 'Re-read the task frontier; lifecycle transitions remain separate.' : 'Inspect all effects and reconcile before retry.', refs: [resultRef] });
      if (ok) for (const t of doc.plan.tasks.filter((t) => doc.results[t.id] || t.id === taskId)) doc.results[t.id] = {
        revision: current.revision, content_digest: current.content_digest, evidence_ref: resultRef,
        evidence_sha256: references(root, [resultRef])[0].sha256, scenarios: t.scenarios };
      save(root, doc);
      return { ok, attempt, verification: verification ? { ok: verification.ok, checks: verification.checks.map(({ stdout, stderr, ...c }) => c) } : null,
        scope_ok: scopeOk, authority_ok: authorityOk, status: taskStatus(root, id) };
    } catch (e) {
      // A crashed/failed postcondition is uncertain work, not permission to replay.
      attempt.status = 'unknown'; attempt.error = e.code ?? e.message; save(root, doc); throw e;
    }
  });
}
export function verifyTasks(root, id) {
  return exclusive(root, id, () => {
    const doc = load(root, id); guard(root, doc); implementationGate(root, id);
    if (doc.attempts.some((a) => !['succeeded', 'reconciled'].includes(a.status))) refuse('E_TASK_PENDING', 'Reconcile unfinished work first.');
    const selected = doc.plan.tasks.filter((t) => doc.results[t.id]);
    if (!selected.length) refuse('E_TASK_CHECK', 'No completed task to reverify.');
    const op = `verify-${randomUUID()}`;
    startWork(root, id, op, { phase: 'verify', task: 'completed tasks', next: 'Verify the candidate has not changed.' });
    const authority = authorityStamp(root);
    const result = checks(root, selected); guard(root, doc);
    result.ok = result.ok && authorityStamp(root) === authority;
    const ref = record(root, id, op, result);
    finishWork(root, id, op, { result: { status: result.ok ? 'completed' : 'failed' }, next: result.ok ? 'Re-read frontier.' : 'Diagnose and reconcile verification.', refs: [ref] });
    if (result.ok) for (const t of selected) doc.results[t.id] = { revision: result.candidate.revision, content_digest: result.candidate.content_digest, evidence_ref: ref,
      evidence_sha256: references(root, [ref])[0].sha256, scenarios: t.scenarios };
    else for (const t of selected) doc.results[t.id] = { ...doc.results[t.id], valid: false };
    save(root, doc); return { ok: result.ok, evidence_ref: ref };
  });
}
export function recoverTask(root, id, operation, { cause, new_hypothesis, refs, processes_stopped }) {
  bounded(cause, 'observed cause'); bounded(new_hypothesis, 'new hypothesis'); references(root, refs);
  if (!processes_stopped || !refs?.length) refuse('E_TASK_RECOVERY', 'Inspect effects and confirm all attempt processes have stopped; provide evidence references.');
  const lock = inside(root, '.spectree/tasks/executor.lock');
  if (existsSync(lock)) {
    const owner = json(lock);
    if (owner.host !== hostname() || owner.change_id !== id || !Number.isInteger(owner.pid)) refuse('E_TASK_BUSY', 'Unknown lock owner.');
    let gone = false;
    try { process.kill(owner.pid, 0); } catch (e) { gone = e.code === 'ESRCH'; }
    if (!gone) refuse('E_TASK_BUSY', 'Executor is still running or cannot be inspected.');
    unlinkSync(lock);
  }
  return exclusive(root, id, () => {
    const doc = load(root, id); const attempt = doc.attempts.find((a) => a.id === operation);
    if (!attempt || ['succeeded', 'reconciled'].includes(attempt.status)) refuse('E_TASK_RECOVERY', 'No unresolved task attempt with this ID.');
    const work = workRecords(root, id).find((r) => r.operation_id === operation);
    if (work && !work.reconciled) reconcileWork(root, id, operation, { note: cause, next: new_hypothesis, refs });
    attempt.status = 'reconciled'; attempt.recovery = { cause, new_hypothesis };
    attempt.recovery_refs = references(root, refs); save(root, doc);
    return { recovered: operation, authorizes_execution: false };
  });
}
