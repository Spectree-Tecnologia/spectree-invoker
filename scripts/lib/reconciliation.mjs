// Correct configuration, never historical gates. Persistence is recoverable under the lifecycle lock.
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, linkSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { Store } from './store.mjs';
import { inside, identifier, bounded, references, snapshot, pendingWork, workRecords, refuse } from './work.mjs';
import { inspectProcesses } from './process-supervisor.mjs';
import { hash } from './context.mjs';
import { contractDigest } from './digest.mjs';
import { diagnoseProject, selectClosureMode, correctionStage } from './project-diagnostics.mjs';
import { readLifecycle, pendingOperation, updateLifecycle, withAuthority, completeOperation, currentPath, receiptPath, PHASE } from './lifecycle.mjs';

const same = (a, b) => hash(a) === hash(b);
const historyPath = id => `.spectree/history/${id}.jsonl`;
function bytes(root, path) {
  const file = inside(root, path);
  if (!existsSync(file)) return Buffer.alloc(0);
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) refuse('E_RECONCILIATION_LIMIT', `Unsupported record: ${path}`);
  return readFileSync(file);
}
function guardDigest(root, id) {
  const ignored = new Set([`.spectree/changes/${id}.json`, historyPath(id), `.spectree/closure/${id}.lifecycle.json`]);
  let budget = 12000, totalBytes = 0; const files = [];
  function walk(rel, depth = 0) {
    if (--budget < 0 || depth > 32) refuse('E_RECONCILIATION_LIMIT', 'Operational inventory exceeds limits.');
    const file = inside(root, rel); if (!existsSync(file)) return;
    if (ignored.has(rel) || rel.endsWith('.lock')) return;
    const stat = lstatSync(file);
    if (stat.isDirectory()) for (const name of readdirSync(file).sort()) walk(`${rel}/${name}`, depth + 1);
    else {
      const content = bytes(root, rel); totalBytes += content.length;
      if (totalBytes > 64 * 1024 * 1024) refuse('E_RECONCILIATION_LIMIT', 'Operational inventory exceeds 64 MiB.');
      files.push([rel, hash(content)]);
    }
  }
  for (const dir of ['docs/changes', ...['changes', 'history', 'approvals', 'evidence', 'closure', 'dispatches', 'tasks', 'work', 'adoptions', 'runs', 'processes'].map(d => `.spectree/${d}`), '.spectree/project.json', '.spectree/deferred.json']) walk(dir);
  return hash(files);
}
function assertIdle(root, id) {
  if (existsSync(inside(root, '.spectree/tasks/executor.lock'))) refuse('E_TASK_BUSY', 'An executor lock exists; inspect and recover it before reconciliation.');
  if (pendingWork(root, id)) refuse('E_OPERATION_PENDING', 'Reconcile uncertain work before changing configuration.');
  for (const work of workRecords(root, id)) {
    const path = `.spectree/processes/${work.operation_id}`;
    if (existsSync(inside(root, path))) inspectProcesses(root, path);
  }
}
function binding(root, id, change) {
  const history = bytes(root, historyPath(id));
  // Invalid existing history must not become the prefix of a trusted recovery.
  for (const line of history.toString('utf8').split('\n').filter(s => s.trim())) JSON.parse(line);
  return { candidate: snapshot(root), contract_digest: contractDigest(root, change).digest, guard_digest: guardDigest(root, id),
    history_bytes: history.length, history_sha256: hash(history) };
}
export function planReconciliation(root, request) {
  if (!request || request.version !== 1) refuse('E_RECONCILIATION_REQUEST', 'Expected a version 1 request.');
  const id = identifier(request.change_id);
  bounded(request.reason, 'observed reason', 4000);
  if (request.actor?.kind !== 'human_in_session') refuse('E_RECONCILIATION_DECISION', 'Record the human session decision; agent approval is not accepted.');
  bounded(request.actor.identity, 'human identity', 200);
  const reading = references(root, request.refs);
  if (!reading.length) refuse('E_RECONCILIATION_REQUEST', 'Reference the inspected project contract or closure mechanism.');
  const diagnostic = diagnoseProject(root, id), store = new Store(root), before = store.change(id);
  if (!store.project() || before.project_id !== store.project().project_id) refuse('E_RECONCILIATION_IDENTITY', 'Change and project identity do not match.');
  if (!correctionStage(before)) refuse('E_RECONCILIATION_STAGE', 'Mode correction is limited to pre-integration work through implemented; later stages require reopening through the existing lifecycle.');
  const mode = selectClosureMode(store.project(), request.closure_mode);
  if (!request.closure_mode || mode === (before.closure_mode ?? 'prepared')) refuse('E_RECONCILIATION_NO_CHANGE', 'Select an explicit, different closure mode.');
  for (const path of [currentPath(id), receiptPath(id)]) if (existsSync(inside(root, path.replaceAll('\\', '/'))))
    refuse('E_RECONCILIATION_PREPARED', 'A preparation or receipt already exists; use its existing reopen/recovery workflow first.');
  const control = readLifecycle(root, id);
  if (control.present && !control.doc) refuse(control.code, control.message);
  if (pendingOperation(control.doc)) refuse('E_OPERATION_PENDING', 'Recover the pending closure operation first.');
  if (control.doc?.current_preparation || control.doc?.receipt) refuse('E_RECONCILIATION_PREPARED', 'Prepared/integrated authority cannot be reinterpreted by mode correction.');
  if (diagnostic.changes[0].issues.some(i => i.code === 'E_ARTIFACT_AMBIGUOUS')) refuse('E_ARTIFACT_AMBIGUOUS', 'Resolve the artifact identity before changing configuration.');
  assertIdle(root, id);
  const plan = { version: 1, kind: 'closure_mode', request, before, after: { ...before, closure_mode: mode }, reading,
    binding: binding(root, id, before), control_revision: control.doc?.revision ?? 0,
    retire_integration_approvals: store.approvals(id).filter(a => a.gate === 'integration').map(a => a.approval_id).sort(),
    diagnostic, effects: ['Correct closure_mode only; preserve lifecycle state and scope.', 'Retire prior integration approval authority, preserving its documents.', 'Append one auditable correction event; create no evidence or approval.'],
    next: ['state.mjs', 'plan', id, '--json'], authorizes_execution: false };
  return { ...plan, plan_digest: hash(plan) };
}
const operationId = plan => `reconcile-${plan.plan_digest}`;
function checkedPlan(plan) {
  if (!plan || plan.version !== 1 || plan.kind !== 'closure_mode') refuse('E_RECONCILIATION_PLAN', 'Invalid reconciliation plan.');
  const { plan_digest, ...body } = plan;
  if (hash(body) !== plan_digest) refuse('E_RECONCILIATION_PLAN', 'Reviewed plan was modified.');
  identifier(plan.before.change_id); return plan;
}
function writeOnce(root, path, value) {
  const file = inside(root, path), text = JSON.stringify(value, null, 2) + '\n';
  if (existsSync(file)) { if (bytes(root, path).toString('utf8') !== text) refuse('E_RECONCILIATION_COLLISION', 'Audit record identity conflict.'); return; }
  mkdirSync(dirname(file), { recursive: true });
  // Publish a complete immutable file atomically, without replacing an existing audit record.
  // An interrupted temp write never becomes the record a subsequent resume must trust.
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, text, { flag: 'wx' });
    linkSync(temporary, file);
  } finally { try { unlinkSync(temporary); } catch { /* orphan temp is not authority */ } }
}
function persist(root, plan) {
  const id = plan.before.change_id, op = operationId(plan), store = new Store(root);
  assertIdle(root, id);
  if (!same(references(root, plan.request.refs), plan.reading)) refuse('E_RECONCILIATION_STALE', 'Inspected references changed during persistence.');
  if (!same(snapshot(root), plan.binding.candidate) || contractDigest(root, plan.before).digest !== plan.binding.contract_digest || guardDigest(root, id) !== plan.binding.guard_digest)
    refuse('E_RECONCILIATION_STALE', 'Candidate or operational records changed during persistence; inspect before recovery.');
  const history = bytes(root, historyPath(id));
  if (history.length < plan.binding.history_bytes || hash(history.subarray(0, plan.binding.history_bytes)) !== plan.binding.history_sha256)
    refuse('E_RECONCILIATION_HISTORY', 'The original history prefix changed.');
  const suffix = history.subarray(plan.binding.history_bytes).toString('utf8').split('\n').filter(s => s.trim()).map(s => JSON.parse(s));
  const eventId = `closure_mode_reconciled:${op}`;
  const event = { type: 'closure_mode_reconciled', event_id: eventId, operation_id: op, plan_digest: plan.plan_digest,
    from_mode: plan.before.closure_mode ?? 'prepared', to_mode: plan.after.closure_mode, actor: plan.request.actor,
    reason: plan.request.reason, refs: plan.reading, state_unchanged: plan.before.state };
  if (suffix.length > 1 || suffix.some(({ at, ...record }) => typeof at !== 'string' || !same(record, { ...event, state_revision: (plan.before.state_revision ?? 0) + 1 })))
    refuse('E_RECONCILIATION_HISTORY', 'Another event was appended during reconciliation.');
  const current = store.change(id);
  const { updated_at: _at, ...actual } = current ?? {};
  const { updated_at: _old, ...expected } = plan.after;
  const alreadyApplied = same(actual, { ...expected, state_revision: (plan.before.state_revision ?? 0) + 1 });
  if (!same(current, plan.before) && !alreadyApplied) refuse('E_CONCURRENT_UPDATE', 'Change differs from both the reviewed original and the exact correction.');
  if (alreadyApplied && suffix.length !== 1) refuse('E_RECONCILIATION_HISTORY', 'Corrected state has no matching history event.');
  const base = `.spectree/reconciliations/${id}/${op}`;
  writeOnce(root, `${base}/plan.json`, plan);
  if (!alreadyApplied) store.putChange(plan.after, { expected: plan.before.state_revision ?? 0, event });
  writeOnce(root, `${base}/receipt.json`, { version: 1, operation_id: op, plan_digest: plan.plan_digest,
    change_id: id, closure_mode: plan.after.closure_mode, state: plan.before.state, authorizes_execution: false });
}
export function applyReconciliation(root, reviewed) {
  checkedPlan(reviewed);
  const id = reviewed.before.change_id, op = operationId(reviewed);
  updateLifecycle(root, id, cur => {
    const fresh = planReconciliation(root, reviewed.request);
    if (!same(fresh, reviewed)) refuse('E_RECONCILIATION_STALE', 'Plan or candidate changed; generate and review a new plan.');
    const at = new Date().toISOString();
    return { ...cur, retired_approvals: [...cur.retired_approvals,
      ...reviewed.retire_integration_approvals.filter(id => !cur.retired_approvals.some(a => a.approval_id === id))
        .map(approval_id => ({ approval_id, generation: cur.generation, at, reason: `Closure mode correction ${op}` }))],
      operation: { operation_id: op, kind: 'reconcile_closure', phase: PHASE.PERSISTING, at, owner_pid: process.pid, plan: reviewed } };
  }, { expectedRevision: reviewed.control_revision, projectId: reviewed.before.project_id, after: () => persist(root, reviewed) });
  completeOperation(root, id, op);
  return { applied: true, change_id: id, operation_id: op, state: reviewed.before.state, closure_mode: reviewed.after.closure_mode, next: reviewed.next, authorizes_execution: false };
}
export function resumeReconciliation(root, id, op) {
  identifier(id); identifier(op);
  let plan;
  withAuthority(root, id, { requireIdle: false }, control => {
    if (control?.operation?.kind !== 'reconcile_closure' || control.operation.operation_id !== op || ![PHASE.PERSISTING, PHASE.DONE].includes(control.operation.phase))
      refuse('E_OPERATION_UNKNOWN', 'No matching reconciliation operation can be resumed.');
    plan = checkedPlan(control.operation.plan);
    if (operationId(plan) !== op || plan.before.change_id !== id) refuse('E_RECONCILIATION_PLAN', 'Operation and plan identity differ.');
    if (!plan.retire_integration_approvals.every(id => control.retired_approvals.some(a => a.approval_id === id))) refuse('E_RECONCILIATION_AUTHORITY', 'Expected approval retirements are missing.');
    persist(root, plan);
  });
  if (readLifecycle(root, id).doc.operation.phase !== PHASE.DONE) completeOperation(root, id, op);
  return { resumed: true, change_id: id, operation_id: op, state: plan.before.state, closure_mode: plan.after.closure_mode, next: plan.next, authorizes_execution: false };
}
