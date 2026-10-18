// Operational checkpoints are observations, never approvals or lifecycle transitions.
import { existsSync, lstatSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { contentDigest, refuse, inside, writeOnce } from '../shared/index.mjs';
import { Store } from './store.mjs';

export function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) {
    refuse('E_WORK_ID', 'Use a nonempty identifier of at most 128 letters, digits, dots, underscores or hyphens.');
  }
  return value;
}
export function bounded(value, label, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) refuse('E_WORK_FIELD', `${label} must contain 1..${max} characters.`);
  return value;
}

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function references(root, paths = []) {
  if (!Array.isArray(paths) || paths.length > 12) refuse('E_WORK_REFS', 'At most 12 focused references per checkpoint.');
  return paths.map((p) => {
    const file = inside(root, p);
    if (!existsSync(file) || !lstatSync(file).isFile()) refuse('E_WORK_REFS', `Reference is not a regular file: ${p}`);
    return { path: p, sha256: sha(readFileSync(file)) };
  });
}
export function snapshot(root) {
  const d = contentDigest(root);
  return { revision: d.revision, content_digest: d.digest,
    branch: execFileSync('git', ['--no-optional-locks', 'branch', '--show-current'], { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim() };
}
function eventDir(root, changeId, operationId) {
  return inside(root, `.spectree/work/${identifier(changeId)}/${identifier(operationId)}`);
}
function readEvent(dir, name) {
  const f = join(dir, `${name}.json`);
  if (!existsSync(f)) return null;
  if (!lstatSync(f).isFile() || lstatSync(f).isSymbolicLink()) refuse('E_WORK_CORRUPT', `Invalid event: ${f}`);
  let doc;
  try { doc = JSON.parse(readFileSync(f, 'utf8')); } catch { refuse('E_WORK_CORRUPT', `Incomplete event: ${f}. Reconcile its effects; never replay blindly.`); }
  const validText = (v) => typeof v === 'string' && v.trim().length > 0;
  const validHash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  if (!doc || doc.version !== 1 || doc.event !== name || !/^sha256:[a-f0-9]{64}$/.test(doc.snapshot?.content_digest ?? '') ||
      !validText(doc.snapshot?.revision) || !validText(doc.at) || !validText(doc.next) ||
      !Array.isArray(doc.refs) || doc.refs.length > 12 || doc.refs.some((r) => !r || !validText(r.path) || !validHash(r.sha256)) ||
      doc.change_id !== dir.split(/[\\/]/).at(-2) || doc.operation_id !== dir.split(/[\\/]/).at(-1) ||
      (name === 'started' && (!validText(doc.phase) || !validText(doc.task))) ||
      (name === 'finished' && !['reported_success', 'failed', 'interrupted', 'unknown'].includes(doc.status)) ||
      (name === 'reconciled' && (!validText(doc.note) || !doc.refs.length))) refuse('E_WORK_CORRUPT', `Unsupported or incomplete event: ${f}`);
  return doc;
}
function writeEvent(dir, name, payload) {
  mkdirSync(dir, { recursive: true });
  const doc = { version: 1, event: name, at: new Date().toISOString(), advisory: true, authorizes_execution: false, ...payload };
  // Exclusive creation refuses concurrent replacement. A crash while writing is detectable on read.
  try { writeOnce(join(dir, `${name}.json`), JSON.stringify(doc, null, 2) + '\n'); }
  catch (e) { if (e.code === 'EEXIST') refuse('E_WORK_CONFLICT', `${name} already recorded; use a new operation ID after reconciliation.`); throw e; }
  return doc;
}

/** A completed tool envelope can contain a failed or interrupted agent turn. */
export function outcome(result) {
  if (!result || typeof result !== 'object') return 'unknown';
  const parts = [result, result.message, result.toolUseResult].filter(Boolean);
  const text = parts.flatMap((p) => typeof p.content === 'string' ? [p.content]
    : Array.isArray(p.content) ? p.content.filter((c) => c.type === 'text').map((c) => c.text ?? '') : []).join('\n');
  if (parts.some((p) => ['rate_limit', 'timeout', 'cancelled', 'interrupted'].includes(p.error) ||
      ['rate_limit', 'timed_out', 'cancelled', 'interrupted'].includes(p.status) || p.apiErrorStatus === 429 || p.quotaLimits?.status === 'rejected') ||
      /you(?:'|’)ve hit your session limit|session limit.*resets/i.test(text)) return 'interrupted';
  if (parts.some((p) => p.is_error || p.isError || p.error || ['failed', 'error'].includes(p.status))) return 'failed';
  // Success here is still only a report. The state machine requires its own observed evidence.
  if (parts.some((p) => ['completed', 'succeeded'].includes(p.status))) return 'reported_success';
  return 'unknown';
}

export function startWork(root, changeId, operationId, { phase, task, next, refs = [] }) {
  const dir = eventDir(root, changeId, operationId);
  return writeEvent(dir, 'started', { change_id: changeId, operation_id: operationId,
    phase: bounded(phase, 'phase', 80), task: bounded(task, 'task', 300), next: bounded(next, 'next'),
    refs: references(root, refs), snapshot: snapshot(root) });
}
export function finishWork(root, changeId, operationId, { result, next, refs = [] }) {
  const dir = eventDir(root, changeId, operationId);
  if (!readEvent(dir, 'started')) refuse('E_WORK_MISSING', 'Record the operation before performing it.');
  if (readEvent(dir, 'reconciled')) refuse('E_WORK_CONFLICT', 'Operation already reconciled; start a new operation.');
  return writeEvent(dir, 'finished', { change_id: changeId, operation_id: operationId,
    status: outcome(result), next: bounded(next, 'next'), refs: references(root, refs), snapshot: snapshot(root) });
}
export function reconcileWork(root, changeId, operationId, { note, next, refs = [] }) {
  const dir = eventDir(root, changeId, operationId);
  if (!readEvent(dir, 'started')) refuse('E_WORK_MISSING', 'No operation to reconcile.');
  if (!refs.length) refuse('E_WORK_REFS', 'Reconciliation needs at least one inspected artifact reference.');
  return writeEvent(dir, 'reconciled', { change_id: changeId, operation_id: operationId,
    note: bounded(note, 'observed effects'), next: bounded(next, 'next'), refs: references(root, refs), snapshot: snapshot(root) });
}
export function workRecords(root, changeId) {
  const dir = inside(root, `.spectree/work/${identifier(changeId)}`);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().map((id) => {
    const op = eventDir(root, changeId, id);
    const started = readEvent(op, 'started');
    if (!started) refuse('E_WORK_CORRUPT', `Operation ${id} has no start record.`);
    const finished = readEvent(op, 'finished'); const reconciled = readEvent(op, 'reconciled');
    return { operation_id: id, started, finished, reconciled,
      requires_reconciliation: !reconciled && finished?.status !== 'reported_success' };
  });
}
export function pendingWork(root, changeId) {
  const pending = workRecords(root, changeId).filter((r) => r.requires_reconciliation);
  return pending.length ? { kind: 'work_checkpoint', operation_id: pending[0].operation_id, phase: pending[0].started.phase,
    operation_ids: pending.map((r) => r.operation_id), uncertain: true,
    recovery: 'Inspect current files and command outcomes, then work.mjs reconcile each pending operation. Do not repeat a side effect from the checkpoint alone.' } : null;
}
export function workPacket(root, changeId) {
  const current = snapshot(root); const records = workRecords(root, changeId);
  const recent = new Set([...records].sort((a, b) => b.started.at.localeCompare(a.started.at)).slice(0, 10));
  const selected = records.filter((r) => r.requires_reconciliation || recent.has(r));
  return { version: 1, advisory: true, authorizes_execution: false, change_id: changeId, current,
    operation_count: records.length, omitted_completed: records.length - selected.length,
    pending: pendingWork(root, changeId), operations: selected.map((r) => {
      const latest = r.reconciled ?? r.finished ?? r.started;
      return { operation_id: r.operation_id, phase: r.started.phase, task: r.started.task,
        status: r.reconciled ? 'reconciled' : r.finished?.status ?? 'unfinished', next: latest.next,
        content_changed: latest.snapshot.content_digest !== current.content_digest,
        refs: latest.refs.map((ref) => {
          let fresh = false;
          try { fresh = references(root, [ref.path])[0].sha256 === ref.sha256; } catch { /* stale or inaccessible */ }
          return { ...ref, fresh };
        }) };
    }) };
}
export function doctor(root) {
  const store = new Store(root);
  inside(root, '.spectree'); // Reject linked operational stores before following them.
  for (const p of ['.spectree/changes', '.spectree/project.json']) inside(root, p);
  const registered = store.changes();
  const artifactRoot = inside(root, 'docs/changes');
  const open = existsSync(artifactRoot) ? readdirSync(artifactRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'archive' && existsSync(inside(root, `docs/changes/${d.name}/proposal.md`)))
    .map((d) => d.name) : [];
  const archive = inside(root, 'docs/changes/archive');
  const archived = existsSync(archive) ? readdirSync(archive, { withFileTypes: true }).filter((d) => d.isDirectory()).length : 0;
  const missing = open.filter((id) => !registered.some((c) => c.change_id === id));
  return { version: 1, advisory: true, authorizes_execution: false, project: store.project(),
    mode: registered.length ? 'structured' : open.length || archived ? 'legacy_artifacts' : 'uninitialized',
    registered_changes: registered.length, open_artifacts: open, archived_artifact_directories: archived,
    unregistered_changes: missing, adoption_required: !!missing.length || (!registered.length && archived > 0),
    archived_means: 'Artifact location only; integration and closure need independent evidence.',
    next: missing.length || (!registered.length && archived > 0)
      ? 'Reconcile artifacts with the owner; explicitly register the next change. Never infer historical approvals or receipts.'
      : 'Read state.mjs resume and work.mjs resume for the explicit change before dispatch.' };
}
