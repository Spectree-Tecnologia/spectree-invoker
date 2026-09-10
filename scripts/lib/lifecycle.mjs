// Durable authority over a change's closure, and the write boundary that keeps it true.
//
// Three things live here, and they are separated on purpose:
//
//   1. IDENTITY   — an immutable preparation snapshot, named by `preparation_id` and pinned by
//                   `preparation_digest`. Approving one binds the approval to that snapshot.
//   2. AUTHORITY  — which approvals are in force RIGHT NOW. Durable, and never derived from a
//                   file a later run may overwrite.
//   3. OPERATIONS — the phases of a write, recorded before the effects, so an interrupted run
//                   is recoverable instead of ambiguous.
//
// The defect that produced this file: retirement lived in the current manifest's
// `supersedes_approval`. Restore an older manifest and the retired approval came back to life,
// because the only record that it had ever been retired was the document being replaced. A
// projection is a convenience; authority has to outlive the thing it is a projection of.
//
// Layout, inside the consumer project:
//
//   .spectree/closure/<id>.lifecycle.json          the durable control (authority + operation)
//   .spectree/closure/<id>.json                    the CURRENT preparation (a projection)
//   .spectree/closure/<id>/<preparation_id>.json   immutable snapshots, one per preparation
//   .spectree/closure/<id>.receipt.json            what was observed about the integration

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, closeSync, unlinkSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { hostname } from 'node:os';

export const LIFECYCLE_VERSION = '1.0.0';
export const PREP_CONTRACT_VERSION = '2.0.0';

const posix = (s) => String(s).split('\\').join('/');
const stamp = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const refuse = (code, message, extra) => ({ ok: false, code, message, ...(extra ?? {}) });

export const closureDir = () => join('.spectree', 'closure');
export const lifecyclePath = (changeId) => join(closureDir(), `${changeId}.lifecycle.json`);
export const currentPath = (changeId) => join(closureDir(), `${changeId}.json`);
export const snapshotPath = (changeId, preparationId) => join(closureDir(), changeId, `${preparationId}.json`);
export const receiptPath = (changeId) => join(closureDir(), `${changeId}.receipt.json`);
const lockPath = (changeId) => join(closureDir(), `${changeId}.lifecycle.lock`);

/** Every phase a write passes through. An intent is not a success, and neither is a start. */
export const PHASE = {
  INTENT: 'intent',
  STARTED: 'started',
  OBSERVED: 'observed',
  PERSISTING: 'persisting',
  DONE: 'done',
};

/** Phases go forward. A phase that could move backwards is a phase that proves nothing. */
export const PHASE_ORDER = [PHASE.INTENT, PHASE.STARTED, PHASE.OBSERVED, PHASE.PERSISTING, PHASE.DONE];

/**
 * What a resume must do about each phase, and — the part that was missing — the command that
 * actually does it. A message telling the operator to "re-run to persist it" beside a re-run that
 * refuses is worse than no message: it names a recovery the tool does not implement.
 */
export const RECOVERY = {
  [PHASE.INTENT]: 'nothing was started; re-run the command',
  [PHASE.STARTED]: 'an external command was started and its result was never observed; decide explicitly whether it ran',
  [PHASE.OBSERVED]: 'the result was observed and not yet persisted; re-run with --resume to persist it, without running the command again',
  [PHASE.PERSISTING]: 'persistence was interrupted part way; re-run with --resume to finish only the steps that are missing',
};

/** Phases a `--resume` can carry forward on its own, because nothing about them is uncertain. */
export const RESUMABLE = new Set([PHASE.OBSERVED, PHASE.PERSISTING]);

// --- identity ---------------------------------------------------------------------------------

/**
 * The canonical bytes a `preparation_digest` is taken over.
 *
 * Timestamps and display text are excluded on purpose: two preparations of the same tree, run a
 * minute apart, are the same preparation, and an identity that moved with the clock could never
 * be compared across a resume.
 */
export function canonicalPreparation(snapshot) {
  const artifacts = [...(snapshot.artifacts ?? [])]
    .map((a) => [posix(a.path), a.type ?? 'blob', a.mode ?? '', a.digest])
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  return JSON.stringify({
    manifest_version: snapshot.manifest_version,
    project_id: snapshot.project_id ?? null,
    change_id: snapshot.change_id,
    generation: snapshot.generation,
    preparation_id: snapshot.preparation_id,
    base_revision: snapshot.base_revision,
    contract_digest: snapshot.contract_digest,
    candidate_digest: snapshot.candidate_digest,
    archive_path: snapshot.archive_path ?? null,
    archive_absent_reason: snapshot.archive_absent_reason ?? null,
    artifacts,
  });
}

export function preparationDigest(snapshot) {
  return `sha256:${createHash('sha256').update(canonicalPreparation(snapshot), 'utf8').digest('hex')}`;
}

/** A fresh preparation id. Collision-resistant, so two preparations in the same second differ. */
export const newPreparationId = () => `prep-${randomUUID()}`;
export const newOperationId = (kind) => `op-${kind}-${randomUUID()}`;

// --- the durable control ------------------------------------------------------------------------

export function emptyLifecycle(changeId, projectId) {
  return {
    schema_version: '1.0.0',
    lifecycle_version: LIFECYCLE_VERSION,
    project_id: projectId ?? null,
    change_id: changeId,
    revision: 0,
    generation: 1,
    current_preparation: null,
    approved: [],
    retired_approvals: [],
    receipt: null,
    operation: null,
    updated_at: stamp(),
  };
}

/**
 * Read the control. A missing file and an unreadable one are different answers, and neither of
 * them is "no retirements" — reading a corrupt control as an empty list is how a retired
 * approval would come back with nobody deciding that it should.
 *
 * @returns {{ present: boolean, doc: object|null, code?: string, message?: string }}
 */
export function readLifecycle(root, changeId) {
  const f = join(root, lifecyclePath(changeId));
  if (!existsSync(f)) return { present: false, doc: null };
  let raw;
  try { raw = readFileSync(f, 'utf8'); }
  catch (e) { return { present: true, doc: null, code: 'E_LIFECYCLE_UNREADABLE', message: `the closure control cannot be read (${e.code ?? e.message})` }; }
  let doc;
  try { doc = JSON.parse(raw); }
  catch { return { present: true, doc: null, code: 'E_LIFECYCLE_CORRUPT', message: 'the closure control is not valid JSON; it is corrupt, which is not the same as absent' }; }
  if (doc?.lifecycle_version !== LIFECYCLE_VERSION) {
    return {
      present: true, doc: null, code: 'E_LIFECYCLE_VERSION',
      message: `the closure control follows lifecycle ${doc?.lifecycle_version ?? '(none)'} and this build speaks ${LIFECYCLE_VERSION}`,
    };
  }
  if (doc.change_id !== changeId) {
    return { present: true, doc: null, code: 'E_LIFECYCLE_COLLISION', message: `that closure control belongs to "${doc.change_id}"` };
  }
  for (const [field, kind] of [['revision', 'number'], ['generation', 'number']]) {
    if (typeof doc[field] !== kind) {
      return { present: true, doc: null, code: 'E_LIFECYCLE_CORRUPT', message: `the closure control records no usable ${field}` };
    }
  }
  for (const field of ['approved', 'retired_approvals']) {
    if (!Array.isArray(doc[field])) {
      return { present: true, doc: null, code: 'E_LIFECYCLE_CORRUPT', message: `the closure control's ${field} is not a list` };
    }
  }
  return { present: true, doc };
}

const writeAtomic = (file, text) => {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
};

/**
 * The write boundary. Exclusive-create lock, expected revision re-read INSIDE it, and the whole
 * decision made there — not just the final rename, which was never the part that raced.
 *
 * A lock is not abandoned because it is old. Where the owner can be identified and is gone the
 * caller may break it deliberately; otherwise this waits a bounded time and then refuses, which
 * is a state a human can act on. An infinite wait is not one.
 */
export function withLifecycleLock(root, changeId, fn, { attempts = 150, waitMs = 20 } = {}) {
  const file = join(root, lockPath(changeId));
  mkdirSync(dirname(file), { recursive: true });
  let brokenOnce = false;
  for (let i = 0; i < attempts; i++) {
    let fd;
    try { fd = openSync(file, 'wx'); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // A lock is never broken for being OLD — a slow consolidation is not an abandoned one.
      // It is broken only when its owner can be identified and is demonstrably gone, and the
      // breaking is announced. A process that died holding it would otherwise wedge the change
      // permanently, which is not safety, it is a different failure.
      if (!brokenOnce && ownerIsGone(file)) {
        brokenOnce = true;
        process.emitWarning(
          `the closure lock for ${changeId} was held by a process that is no longer running; breaking it once. ` +
          'Any operation it left open is still recorded, and is recovered explicitly.',
          'SpectreeLock');
        try { unlinkSync(file); } catch { /* somebody else got there first */ }
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
      continue;
    }
    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid, host: hostname(), at: stamp() }));
      return fn();
    } finally {
      closeSync(fd);
      try { unlinkSync(file); } catch { /* already released */ }
    }
  }
  const e = new Error(
    `could not acquire the closure lock for ${changeId}: another process is writing it. ` +
    `If nothing is running, remove ${posix(lockPath(changeId))} deliberately — it is not removed automatically for being old.`);
  e.code = 'E_CONCURRENT_UPDATE';
  throw e;
}

/**
 * Is the process that holds this lock gone?
 *
 * Only answerable on the machine that took it, and only for a pid this process may signal.
 * Anything else — another host, an unreadable lock, a pid that still answers — is "unknown", and
 * unknown leaves the lock alone. Signal 0 tests for existence without delivering anything.
 */
function ownerIsGone(file) {
  let owner;
  try { owner = JSON.parse(readFileSync(file, 'utf8')); } catch { return false; }
  if (!owner || typeof owner.pid !== 'number') return false;
  if (owner.host && owner.host !== hostname()) return false;
  if (owner.pid === process.pid) return false;
  try { process.kill(owner.pid, 0); return false; }
  catch (e) { return e.code === 'ESRCH'; }
}

/**
 * Do something under the closure's authority boundary, without changing the control.
 *
 * For a write that lands in ANOTHER store — a state transition, which writes `changes/<id>.json`
 * — the decision and the write have to sit inside the same critical section as the authority they
 * rest on. Re-reading close to the write narrows the window; it does not close it, and a reopening
 * that returns a change to the state it was already in does not move `state_revision`, so the
 * change store's own optimistic check sees nothing.
 *
 * LOCK ORDER, and it is the only one used anywhere: closure lifecycle lock, then the change lock.
 * Nothing takes the lifecycle lock while holding a change lock, so the two cannot cycle.
 *
 * @param {object} opts
 * @param {number} [opts.expectedRevision]  the control revision the DECISION was computed at
 * @param {boolean} [opts.requireIdle]      refuse while an operation is open
 */
export function withAuthority(root, changeId, { expectedRevision, requireIdle = true } = {}, fn) {
  return withLifecycleLock(root, changeId, () => {
    const read = readLifecycle(root, changeId);
    if (read.present && !read.doc) {
      const e = new Error(read.message);
      e.code = read.code;
      throw e;
    }
    const current = read.doc;
    if (expectedRevision !== undefined && expectedRevision !== (current?.revision ?? null)) {
      const e = new Error(
        `the closure moved between this decision and this write: control revision ${expectedRevision} -> ${current?.revision ?? 'none'}`);
      e.code = 'E_CONCURRENT_UPDATE';
      throw e;
    }
    if (requireIdle) {
      const open = pendingOperation(current);
      if (open) {
        const e = new Error(
          `an unfinished ${open.kind} operation (${open.operation_id}) is open at phase "${open.phase}": ${open.recovery}`);
        e.code = 'E_OPERATION_PENDING';
        throw e;
      }
    }
    return fn(current);
  });
}

/**
 * Read-modify-write of the control, under the lock, with an optional expected revision.
 * `mutate` receives the document and returns the next one; it must not perform effects.
 */
export function updateLifecycle(root, changeId, mutate, { expectedRevision, projectId, after } = {}) {
  return withLifecycleLock(root, changeId, () => {
    const read = readLifecycle(root, changeId);
    if (read.present && !read.doc) {
      const e = new Error(read.message);
      e.code = read.code;
      throw e;
    }
    const current = read.doc ?? emptyLifecycle(changeId, projectId);
    if (expectedRevision !== undefined && expectedRevision !== current.revision) {
      const e = new Error(`the closure control moved underneath this write: expected revision ${expectedRevision}, found ${current.revision}`);
      e.code = 'E_CONCURRENT_UPDATE';
      throw e;
    }
    const next = { ...mutate(current), revision: current.revision + 1, updated_at: stamp() };
    writeAtomic(join(root, lifecyclePath(changeId)), `${JSON.stringify(next, null, 2)}\n`);
    // A document that must be atomic with the control is written HERE, inside the same critical
    // section, and after it. The order matters and is deliberate: an approval file with no control
    // entry is not authority, while a control entry naming a file that is not there authorises
    // nothing either — so a crash between them fails closed in both directions.
    if (after) after(next);
    return next;
  });
}

// --- operations ---------------------------------------------------------------------------------

/**
 * Open an operation. Recorded BEFORE any effect, so an interrupted run is identifiable — and
 * reserved against the control revision the caller's DECISION was computed on, which is what
 * makes this a compare-and-set rather than a lock taken after the fact.
 *
 * The defect: a refresh took its lock after its preflight, an approval landed in between, and
 * the refresh then applied a decision computed before that approval existed. A lock on each write
 * does not make a stale decision fresh.
 */
export function beginOperation(root, changeId, { kind, operationId, detail, plan, expectedRevision, projectId }) {
  const id = operationId ?? newOperationId(kind);
  const doc = updateLifecycle(root, changeId, (cur) => {
    if (cur.operation && cur.operation.phase !== PHASE.DONE && cur.operation.operation_id !== id) {
      const e = new Error(
        `${changeId} has an unfinished ${cur.operation.kind} operation (${cur.operation.operation_id}) at phase "${cur.operation.phase}": ` +
        `${RECOVERY[cur.operation.phase] ?? 'resolve it explicitly'}`);
      e.code = 'E_OPERATION_PENDING';
      throw e;
    }
    return {
      ...cur,
      operation: {
        operation_id: id, kind, phase: PHASE.INTENT, at: stamp(), owner_pid: process.pid,
        detail: detail ?? null,
        // The plan is written before the first effect and never replaced, so a recovery can
        // finish the operation instead of guessing at what it was going to do.
        plan: plan ?? null,
      },
    };
  }, { expectedRevision, projectId });
  return { operationId: id, lifecycle: doc };
}

/**
 * Move an operation forward. Ownership and direction are both checked: one process may not
 * advance another's operation, and a phase never moves backwards — either would let two runs
 * describe one write as if it were theirs.
 */
export function advanceOperation(root, changeId, operationId, phase, detail) {
  return updateLifecycle(root, changeId, (cur) => {
    if (!cur.operation || cur.operation.operation_id !== operationId) {
      const e = new Error(
        `no open operation ${operationId} on ${changeId}` +
        (cur.operation ? ` — the open one is ${cur.operation.operation_id} (${cur.operation.kind}, ${cur.operation.phase})` : ''));
      e.code = 'E_OPERATION_UNKNOWN';
      throw e;
    }
    const from = PHASE_ORDER.indexOf(cur.operation.phase);
    const to = PHASE_ORDER.indexOf(phase);
    if (to < 0 || to < from) {
      const e = new Error(`${changeId}: an operation does not go from "${cur.operation.phase}" to "${phase}"`);
      e.code = 'E_OPERATION_PHASE';
      throw e;
    }
    return {
      ...cur,
      operation: {
        ...cur.operation,
        phase, at: stamp(),
        // Merged, never replaced: `observed` used to overwrite the detail with an exit code, and
        // what the operation had planned was gone by the time anyone came to finish it.
        detail: { ...(cur.operation.detail ?? {}), ...(detail ?? {}) },
      },
    };
  });
}

/** Close the operation and commit whatever it decided, in the same locked section. */
export function completeOperation(root, changeId, operationId, mutate = (x) => x) {
  return updateLifecycle(root, changeId, (cur) => {
    if (cur.operation && cur.operation.operation_id !== operationId && cur.operation.phase !== PHASE.DONE) {
      const e = new Error(`${changeId}: ${operationId} may not complete the operation reserved by ${cur.operation.operation_id}`);
      e.code = 'E_OPERATION_UNKNOWN';
      throw e;
    }
    const next = mutate(cur);
    return { ...next, operation: { ...(cur.operation ?? { operation_id: operationId, kind: 'unknown' }), phase: PHASE.DONE, at: stamp() } };
  });
}

/**
 * Abandon an open operation deliberately, leaving whatever it wrote where it is.
 *
 * The escape from the one phase nothing resolves on its own — `started`, where the command may
 * or may not have run. It is not a repair: it records that a person looked and decided, and the
 * files the command produced are untouched.
 */
export function abandonOperation(root, changeId, operationId, reason) {
  return updateLifecycle(root, changeId, (cur) => {
    if (!cur.operation || cur.operation.operation_id !== operationId) {
      const e = new Error(`no open operation ${operationId} on ${changeId}`);
      e.code = 'E_OPERATION_UNKNOWN';
      throw e;
    }
    return {
      ...cur,
      abandoned: [...(cur.abandoned ?? []), { ...cur.operation, abandoned_at: stamp(), reason }],
      operation: null,
    };
  });
}

/** Is there work left over from a previous run? */
export function pendingOperation(lifecycle) {
  const op = lifecycle?.operation;
  if (!op || op.phase === PHASE.DONE) return null;
  return {
    ...op,
    uncertain: op.phase === PHASE.STARTED,
    recovery: RECOVERY[op.phase] ?? 'resolve it explicitly',
  };
}

// --- authority ------------------------------------------------------------------------------------

/**
 * Which approvals are in force, decided once for every consumer.
 *
 * The preparation's freeze, the state machine's gates, `resume` and the confirmation after the
 * merge all call this. Written as a local filter it held in one command and nowhere else, and
 * the change walked to `integrated` on an approval that another command had already refused.
 *
 * A retired approval is not deleted and does not stop being history. It stops being AUTHORITY:
 * it was granted over a record that no longer exists, and nothing granted over a replaced record
 * can authorise the record replacing it.
 *
 * @param {object[]} approvals
 * @param {object|null} manifest    the current preparation, a projection
 * @param {object} opts
 * @param {object|null} opts.lifecycle   the durable control; its absence when a preparation
 *                                       exists is a refusal, never an empty list
 * @param {boolean} opts.requireControl  false only for a change with no closure at all
 */
export function approvalsInForce(approvals = [], manifest = null, { lifecycle = null, lifecycleError = null } = {}) {
  // A control that exists and cannot be read is a closed failure. Reading it as "nothing was
  // ever retired" is the exact substitution this whole mechanism exists to refuse.
  if (lifecycleError) {
    return {
      ok: false, code: lifecycleError.code, message: lifecycleError.message,
      inForce: [], retired: [], blocked: true,
    };
  }
  // A preparation with no durable control behind it cannot answer the question either: the
  // projection alone is exactly the record a restore can rewrite.
  if (manifest && !lifecycle) {
    return {
      ok: false, code: 'E_LIFECYCLE_MISSING', blocked: true, inForce: [], retired: [],
      message: 'this change has a closure preparation and no durable closure control; ' +
        'retirement cannot be established from the preparation alone, because that is the document a restore replaces. ' +
        'Run the closure migration explicitly.',
    };
  }

  const retiredIds = new Set([
    ...(lifecycle?.retired_approvals ?? []).map((r) => r.approval_id),
    // The projection is honoured too, and only ever to ADD: a retirement recorded in one place
    // and not the other is still a retirement.
    ...(manifest?.supersedes_approval ?? []),
  ]);
  // An INTEGRATION approval is authority only where the durable control also records it. A file
  // dropped into `.spectree/approvals/` is a document; authority is the pair, and half an
  // approval — written when the control update did not land — must never read as a whole one.
  const recorded = new Set((lifecycle?.approved ?? []).map((r) => r.approval_id));
  const unrecorded = approvals.filter((a) => a.gate === 'integration' && !retiredIds.has(a.approval_id) && !recorded.has(a.approval_id));
  const live = approvals.filter((a) => !retiredIds.has(a.approval_id))
    .filter((a) => a.gate !== 'integration' || recorded.has(a.approval_id));
  return {
    ok: true,
    inForce: live,
    retired: approvals.filter((a) => retiredIds.has(a.approval_id)),
    // Reported rather than silently dropped: "no approval on record" and "an approval the durable
    // control never recorded" are different problems with different repairs.
    unrecorded,
    generation: lifecycle?.generation ?? null,
    blocked: false,
  };
}

/**
 * Does this integration approval name the preparation that is actually current?
 *
 * Content and contract were always checked. The artifact record was not part of any digest, so
 * an approval kept matching across a reopening that replaced exactly that record — which is why
 * a v2 approval names `preparation_id`, `generation` and `preparation_digest`.
 */
export function approvalCoversPreparation(approval, snapshot) {
  const ref = approval?.preparation;
  if (!ref) {
    return refuse('E_APPROVAL_NO_PREPARATION',
      `approval ${approval?.approval_id} names no preparation; an integration approval under this contract must name the snapshot it was granted over`);
  }
  if (!snapshot) return refuse('E_PREP_MISSING', 'there is no preparation for that approval to cover');
  if (ref.preparation_id !== snapshot.preparation_id) {
    return refuse('E_APPROVAL_OTHER_PREPARATION',
      `approval ${approval.approval_id} was granted over preparation ${ref.preparation_id}, and the current one is ${snapshot.preparation_id}`);
  }
  if (Number(ref.generation) !== Number(snapshot.generation)) {
    return refuse('E_APPROVAL_OTHER_GENERATION',
      `approval ${approval.approval_id} names generation ${ref.generation}; this change is at generation ${snapshot.generation}`);
  }
  if (ref.preparation_digest !== snapshot.preparation_digest) {
    return refuse('E_APPROVAL_PREPARATION_CHANGED',
      `approval ${approval.approval_id} names preparation digest ${String(ref.preparation_digest).slice(0, 18)}…, and that snapshot now digests ${String(snapshot.preparation_digest).slice(0, 18)}…`);
  }
  return { ok: true };
}

/** Does the approval name the integration that actually happened? */
export function approvalCoversTarget(approval, { repository, pr, headSha, baseBranch }) {
  const t = approval?.integration_target;
  if (!t) {
    return refuse('E_APPROVAL_NO_TARGET',
      `approval ${approval?.approval_id} names no integration target; a merge is confirmed against the PR that was approved, not against any PR whose tree happens to match`);
  }
  const mismatch = [];
  if (repository && t.repository && t.repository !== repository) mismatch.push(`repository ${t.repository} != ${repository}`);
  if (pr !== undefined && Number(t.pr) !== Number(pr)) mismatch.push(`PR ${t.pr} != ${pr}`);
  if (headSha && t.head_sha && t.head_sha !== headSha) mismatch.push(`head ${String(t.head_sha).slice(0, 8)} != ${String(headSha).slice(0, 8)}`);
  if (baseBranch && t.base_branch && t.base_branch !== baseBranch) mismatch.push(`base ${t.base_branch} != ${baseBranch}`);
  if (mismatch.length) {
    return refuse('E_APPROVAL_OTHER_TARGET', `approval ${approval.approval_id} authorised a different integration: ${mismatch.join('; ')}`);
  }
  return { ok: true };
}

// --- receipts ---------------------------------------------------------------------------------------

/**
 * What was observed about an integration. It is evidence about one merge of one preparation
 * under one approval, and `integrated`/`closed` require it — a hand-written piece of evidence
 * saying "it merged" is a claim, and this is an observation with the identities to check it.
 */
export function buildReceipt({
  changeId, repository, pr, headSha, mergeCommit, baseBranch,
  preparationId, generation, preparationDigest: prepDigest, approvalId,
  contractDigest, candidateDigest, runs = [], operationId, observedAt,
}) {
  return {
    schema_version: '1.0.0',
    receipt_version: '1.0.0',
    change_id: changeId,
    repository: repository ?? null,
    pr: pr === undefined || pr === null ? null : Number(pr),
    head_sha: headSha ?? null,
    merge_commit: mergeCommit,
    base_branch: baseBranch ?? null,
    preparation_id: preparationId ?? null,
    generation: generation ?? null,
    preparation_digest: prepDigest ?? null,
    approval_id: approvalId ?? null,
    contract_digest: contractDigest ?? null,
    candidate_digest: candidateDigest ?? null,
    runs,
    operation_id: operationId ?? null,
    observed_at: observedAt ?? stamp(),
  };
}

/**
 * Every identity an integration receipt must carry under the v2 flow.
 *
 * The defect: `receiptCovers` compared only the fields the caller happened to pass an expectation
 * for, so a four-key JSON naming an existing preparation authorised `integrated` with no merge, no
 * PR, no run and no approval anywhere. A record that is structurally not a receipt does not become
 * one by being placed where a receipt goes.
 *
 * This is a check on a MALFORMED record, and that is all it claims. A local directory is not made
 * resistant to an agent that can rewrite every file in it, and nothing here should be read as
 * saying otherwise.
 */
const RECEIPT_REQUIRED = [
  'receipt_version', 'change_id', 'repository', 'pr', 'head_sha', 'merge_commit', 'base_branch',
  'preparation_id', 'generation', 'preparation_digest', 'approval_id',
  'contract_digest', 'candidate_digest', 'operation_id', 'observed_at',
];

/**
 * The receipt's canonical identity.
 *
 * The control used to point at a receipt by merge commit and generation, which is two fields out
 * of fifteen: every other binding could be rewritten and the pointer still agreed. A digest over
 * the whole document is the complete comparison, and it is one field.
 */
export function receiptDigest(receipt) {
  const canonical = JSON.stringify({
    receipt_version: receipt.receipt_version ?? null,
    change_id: receipt.change_id ?? null,
    repository: receipt.repository ?? null,
    pr: receipt.pr ?? null,
    head_sha: receipt.head_sha ?? null,
    merge_commit: receipt.merge_commit ?? null,
    base_branch: receipt.base_branch ?? null,
    preparation_id: receipt.preparation_id ?? null,
    generation: receipt.generation ?? null,
    preparation_digest: receipt.preparation_digest ?? null,
    approval_id: receipt.approval_id ?? null,
    contract_digest: receipt.contract_digest ?? null,
    candidate_digest: receipt.candidate_digest ?? null,
    operation_id: receipt.operation_id ?? null,
    observed_at: receipt.observed_at ?? null,
    runs: (receipt.runs ?? []).map((r) => [
      r.workflow ?? null, String(r.workflow_id ?? ''), String(r.run_id ?? ''),
      r.attempt ?? null, r.status ?? null, r.conclusion ?? null, r.head_sha ?? null, r.event ?? null,
    ]),
  });
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

/**
 * Every binding a v2 receipt must satisfy, built from the APPROVED reference and nothing else.
 *
 * The defect this replaces: `receiptCovers` compared only the fields whose expectation its caller
 * happened to assemble, so `state.mjs` — which knew the change, the generation and the preparation
 * — never asked about the repository, the PR, the head or the candidate digest. A receipt with all
 * four rewritten passed the final gate.
 *
 * It is built from the manifest, the exact approval in force over that manifest, and the control's
 * pointer. Deliberately NOT from the local checkout: which candidate was observed is a question the
 * approved reference answers, and the operator's disk is not that reference.
 */
export function integrationExpectation({
  changeId, manifest, authority, lifecycle, legacy = false, approval = null, receipt = null,
}) {
  if (legacy) return { changeId, legacy: true, lifecycle };
  const approvals = (authority?.inForce ?? []).filter((a) => a.gate === 'integration' && a.change_id === changeId);

  // WHICH approval, decided in one place and never by position in a list.
  //
  // Taking the first entry whose preparation matched was a false negative waiting to happen: with
  // two approvals in force over the same preparation, authorising different PRs, the confirmation
  // selected the one that satisfied everything and then checked the receipt against whichever came
  // first on disk. There was an exact answer, and the order of files decided against it.
  const covering = approvals.filter((a) => a.preparation?.preparation_id === manifest?.preparation_id);
  let chosen = null;
  let ambiguous = false;
  if (approval) {
    // The caller already selected it against every criterion, so that selection is the answer.
    chosen = approval;
  } else if (receipt?.approval_id) {
    // A receipt names the approval its integration was observed under. Resolving THAT one is the
    // only reading that cannot be decided by ordering.
    chosen = covering.find((a) => a.approval_id === receipt.approval_id) ?? null;
  } else if (covering.length === 1) {
    chosen = covering[0];
  } else if (covering.length > 1) {
    // Refused explicitly rather than resolved by guessing. Picking "the most recent" would be a
    // rule nobody stated, and picking the first is the defect this replaces.
    ambiguous = true;
  }

  const target = chosen?.integration_target ?? {};
  return {
    changeId,
    repository: target.repository ?? undefined,
    pr: target.pr ?? undefined,
    headSha: target.head_sha ?? undefined,
    baseBranch: target.base_branch ?? undefined,
    preparationId: manifest?.preparation_id ?? undefined,
    generation: manifest?.generation ?? undefined,
    preparationDigest: manifest?.preparation_digest ?? undefined,
    approvalId: chosen?.approval_id ?? undefined,
    contractDigest: manifest?.contract_digest ?? undefined,
    candidateDigest: manifest?.candidate_digest ?? undefined,
    lifecycle,
    inForceIds: new Set(approvals.map((a) => a.approval_id)),
    // Reported so a caller can say WHY there is no expectation to check, rather than checking
    // nothing and calling that agreement.
    approvalMissing: !chosen && !ambiguous,
    ambiguousApproval: ambiguous ? covering.map((a) => a.approval_id) : null,
  };
}

export function readReceipt(root, changeId) {
  const f = join(root, receiptPath(changeId));
  if (!existsSync(f)) return null;
  let text;
  try { text = readFileSync(f, 'utf8'); }
  catch (e) { return { unreadable: true, code: 'E_RECEIPT_UNREADABLE', message: `the integration receipt cannot be read (${e.code ?? e.message})` }; }
  try { return JSON.parse(text); }
  catch { return { corrupt: true, code: 'E_RECEIPT_CORRUPT', message: 'the integration receipt is not valid JSON; corrupt is not the same as absent' }; }
}

/**
 * Does the receipt on record actually describe the integration being claimed?
 *
 * Used by the state machine, so that `state transition … integrated` cannot walk past the
 * confirmation, and by the confirmation itself — one definition, so neither can omit a comparison
 * because its caller did not assemble the context.
 *
 * `legacy` drops only the v2 identity fields, and it is a DECLARED mode on the change: an absence
 * of those fields is never read as legacy.
 */
export function receiptCovers(receipt, {
  changeId, mergeCommit, generation, preparationId, preparationDigest: prepDigest,
  approvalId, repository, pr, headSha, baseBranch, contractDigest, candidateDigest,
  legacy = false, lifecycle = null, inForceIds = null, expectation = null,
} = {}) {
  if (!receipt) {
    return refuse('E_INTEGRATION_NOT_OBSERVED',
      'no integration receipt is on record; `integrated` is reached by confirming a merge with post-merge.mjs, not by asserting it');
  }
  if (receipt.unreadable || receipt.corrupt) {
    return refuse('E_INTEGRATION_NOT_OBSERVED', receipt.message ?? 'the integration receipt cannot be read, which is not the same as absent');
  }
  if (receipt.receipt_version !== '1.0.0') {
    return refuse('E_INTEGRATION_NOT_OBSERVED', `the receipt follows version ${receipt.receipt_version ?? '(none)'} and this build speaks 1.0.0`);
  }
  // Structure BEFORE comparison. Comparing only what the caller asked about is how an incomplete
  // record authorised an integration nobody observed.
  const required = legacy
    ? ['receipt_version', 'change_id', 'merge_commit', 'operation_id', 'observed_at']
    : RECEIPT_REQUIRED;
  const missing = required.filter((k) => receipt[k] === undefined || receipt[k] === null || receipt[k] === '');
  if (missing.length) {
    return refuse('E_RECEIPT_INCOMPLETE',
      `the integration receipt records no ${missing.join(', ')}; a receipt names the whole integration it observed, ` +
      'and a record missing any of it is not an observation');
  }
  if (!legacy) {
    if (!Array.isArray(receipt.runs) || receipt.runs.length === 0) {
      return refuse('E_RECEIPT_INCOMPLETE', 'the integration receipt records no observed run; the checks the policy required are part of what was observed');
    }
    // An empty object in that array satisfied "a non-empty list of runs" and said nothing about
    // any run. A run is identified or it is not a run.
    for (const [i, r] of receipt.runs.entries()) {
      const missing = ['workflow', 'run_id', 'attempt', 'conclusion'].filter((k) => r?.[k] === undefined || r?.[k] === null || r?.[k] === '');
      if (missing.length) {
        return refuse('E_RECEIPT_INCOMPLETE',
          `the receipt's run ${i + 1} records no ${missing.join(', ')}; a run is identified by its workflow, its id, its attempt and how it ended`);
      }
      if (!Number.isInteger(Number(r.attempt))) {
        return refuse('E_RECEIPT_INCOMPLETE', `the receipt's run ${i + 1} records attempt "${r.attempt}", which is not an attempt number`);
      }
    }
  }
  // An expectation this caller could not build is not an expectation that passed.
  if (!legacy && expectation?.ambiguousApproval) {
    return refuse('E_APPROVAL_AMBIGUOUS',
      `${expectation.ambiguousApproval.length} integration approvals in force name this preparation ` +
      `(${expectation.ambiguousApproval.join(', ')}) and nothing here says which one this integration was under. ` +
      'The order of files on disk is not the answer.');
  }
  if (!legacy && expectation?.approvalMissing) {
    return refuse('E_RECEIPT_UNVERIFIABLE',
      'no integration approval in force names the current preparation, so there is no approved reference to check this receipt against');
  }
  // And it has to be the receipt this squad wrote, not a document that named a real preparation.
  // Compared by the WHOLE document's digest: a pointer that agreed on the merge commit and the
  // generation agreed on two fields out of fifteen, and every other binding could be rewritten
  // underneath it.
  if (lifecycle) {
    const pointer = lifecycle.receipt;
    if (!pointer) {
      return refuse('E_RECEIPT_UNRECORDED',
        'the closure control records no integration receipt; a receipt that the confirmation never wrote is a file, not an observation');
    }
    if (!pointer.receipt_digest) {
      return refuse('E_RECEIPT_UNRECORDED',
        'the closure control names a receipt but records no digest for it, so which document it observed cannot be established; re-confirm the merge');
    }
    const here = receiptDigest(receipt);
    if (pointer.receipt_digest !== here) {
      return refuse('E_RECEIPT_UNRECORDED',
        `the receipt on disk is not the document the closure control observed (${String(pointer.receipt_digest).slice(0, 22)}… vs ${here.slice(0, 22)}…)`);
    }
  }

  const mismatch = (field, want, got) => refuse('E_INTEGRATION_NOT_OBSERVED',
    `the receipt's ${field} is ${String(got).slice(0, 12)} and this is about ${String(want).slice(0, 12)}`);
  if (changeId && receipt.change_id !== changeId) return mismatch('change', changeId, receipt.change_id);
  if (mergeCommit && receipt.merge_commit !== mergeCommit) return mismatch('merge commit', mergeCommit, receipt.merge_commit);
  if (generation !== undefined && generation !== null && Number(receipt.generation) !== Number(generation)) {
    return refuse('E_INTEGRATION_NOT_OBSERVED',
      `the receipt observed generation ${receipt.generation} and this change is at generation ${generation}; a reopening after the confirmation needs a new one`);
  }
  if (preparationId && receipt.preparation_id !== preparationId) return mismatch('preparation', preparationId, receipt.preparation_id);
  if (prepDigest && receipt.preparation_digest !== prepDigest) return mismatch('preparation digest', prepDigest, receipt.preparation_digest);
  if (approvalId && receipt.approval_id !== approvalId) return mismatch('approval', approvalId, receipt.approval_id);
  // The approval it names has to still BE authority. A receipt written before a reopening names an
  // approval that was retired by it, and a receipt is an observation, not a way to keep one alive.
  if (!legacy && inForceIds && !inForceIds.has(receipt.approval_id)) {
    return refuse('E_INTEGRATION_NOT_OBSERVED',
      `the receipt was observed under approval ${receipt.approval_id}, which is not in force`);
  }
  if (repository && receipt.repository !== repository) return mismatch('repository', repository, receipt.repository);
  if (pr !== undefined && pr !== null && Number(receipt.pr) !== Number(pr)) return mismatch('PR', pr, receipt.pr);
  if (headSha && receipt.head_sha !== headSha) return mismatch('head', headSha, receipt.head_sha);
  if (baseBranch && receipt.base_branch !== baseBranch) return mismatch('base branch', baseBranch, receipt.base_branch);
  if (contractDigest && receipt.contract_digest !== contractDigest) return mismatch('contract', contractDigest, receipt.contract_digest);
  if (candidateDigest && receipt.candidate_digest !== candidateDigest) return mismatch('candidate', candidateDigest, receipt.candidate_digest);
  return { ok: true };
}

export function writeReceipt(root, changeId, receipt) {
  writeAtomic(join(root, receiptPath(changeId)), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

