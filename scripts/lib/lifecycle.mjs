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

/** Phases that mean the operation is still open, with what a resume must do about each. */
export const RECOVERY = {
  [PHASE.INTENT]: 'nothing was started; re-run the command',
  [PHASE.STARTED]: 'an external command was started and its result was never observed; decide explicitly whether it ran',
  [PHASE.OBSERVED]: 'the result was observed and not yet persisted; re-run to persist it',
  [PHASE.PERSISTING]: 'persistence was interrupted part way; re-run to finish it',
};

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
  for (let i = 0; i < attempts; i++) {
    let fd;
    try { fd = openSync(file, 'wx'); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
      continue;
    }
    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid, at: stamp() }));
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
 * Read-modify-write of the control, under the lock, with an optional expected revision.
 * `mutate` receives the document and returns the next one; it must not perform effects.
 */
export function updateLifecycle(root, changeId, mutate, { expectedRevision, projectId } = {}) {
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
    return next;
  });
}

// --- operations ---------------------------------------------------------------------------------

/** Open an operation. Recorded BEFORE any effect, so an interrupted run is identifiable. */
export function beginOperation(root, changeId, { kind, operationId, detail, expectedRevision, projectId }) {
  const id = operationId ?? newOperationId(kind);
  const doc = updateLifecycle(root, changeId, (cur) => {
    if (cur.operation && cur.operation.phase !== PHASE.DONE && cur.operation.operation_id !== id) {
      const e = new Error(
        `${changeId} has an unfinished ${cur.operation.kind} operation (${cur.operation.operation_id}) at phase "${cur.operation.phase}": ` +
        `${RECOVERY[cur.operation.phase] ?? 'resolve it explicitly'}`);
      e.code = 'E_OPERATION_PENDING';
      throw e;
    }
    return { ...cur, operation: { operation_id: id, kind, phase: PHASE.INTENT, at: stamp(), detail: detail ?? null } };
  }, { expectedRevision, projectId });
  return { operationId: id, lifecycle: doc };
}

export function advanceOperation(root, changeId, operationId, phase, detail) {
  return updateLifecycle(root, changeId, (cur) => {
    if (!cur.operation || cur.operation.operation_id !== operationId) {
      const e = new Error(`no open operation ${operationId} on ${changeId}`);
      e.code = 'E_OPERATION_UNKNOWN';
      throw e;
    }
    return { ...cur, operation: { ...cur.operation, phase, at: stamp(), ...(detail ? { detail } : {}) } };
  });
}

/** Close the operation and commit whatever it decided, in the same locked section. */
export function completeOperation(root, changeId, operationId, mutate = (x) => x) {
  return updateLifecycle(root, changeId, (cur) => {
    const next = mutate(cur);
    return { ...next, operation: { ...(cur.operation ?? { operation_id: operationId, kind: 'unknown' }), phase: PHASE.DONE, at: stamp() } };
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
  return {
    ok: true,
    inForce: approvals.filter((a) => !retiredIds.has(a.approval_id)),
    retired: approvals.filter((a) => retiredIds.has(a.approval_id)),
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

export function readReceipt(root, changeId) {
  const f = join(root, receiptPath(changeId));
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return { corrupt: true }; }
}

export function writeReceipt(root, changeId, receipt) {
  writeAtomic(join(root, receiptPath(changeId)), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

/**
 * Does the receipt on record actually describe the integration being claimed?
 *
 * Used by the state machine, so that `state transition … integrated` cannot walk past the
 * confirmation. A receipt for another PR, another merge or an older generation is a receipt
 * about something else.
 */
export function receiptCovers(receipt, { changeId, mergeCommit, generation, preparationId, approvalId } = {}) {
  if (!receipt) {
    return refuse('E_INTEGRATION_NOT_OBSERVED',
      'no integration receipt is on record; `integrated` is reached by confirming a merge with post-merge.mjs, not by asserting it');
  }
  if (receipt.corrupt) return refuse('E_INTEGRATION_NOT_OBSERVED', 'the integration receipt is corrupt, which is not the same as absent');
  if (receipt.receipt_version !== '1.0.0') {
    return refuse('E_INTEGRATION_NOT_OBSERVED', `the receipt follows version ${receipt.receipt_version ?? '(none)'} and this build speaks 1.0.0`);
  }
  if (changeId && receipt.change_id !== changeId) {
    return refuse('E_INTEGRATION_NOT_OBSERVED', `that receipt belongs to "${receipt.change_id}", not to "${changeId}"`);
  }
  if (mergeCommit && receipt.merge_commit !== mergeCommit) {
    return refuse('E_INTEGRATION_NOT_OBSERVED', `the receipt observed merge ${String(receipt.merge_commit).slice(0, 8)}, and this is about ${String(mergeCommit).slice(0, 8)}`);
  }
  if (generation !== undefined && generation !== null && Number(receipt.generation) !== Number(generation)) {
    return refuse('E_INTEGRATION_NOT_OBSERVED',
      `the receipt observed generation ${receipt.generation} and this change is at generation ${generation}; a reopening after the confirmation needs a new one`);
  }
  if (preparationId && receipt.preparation_id !== preparationId) {
    return refuse('E_INTEGRATION_NOT_OBSERVED', `the receipt observed preparation ${receipt.preparation_id}, and the current one is ${preparationId}`);
  }
  if (approvalId && receipt.approval_id !== approvalId) {
    return refuse('E_INTEGRATION_NOT_OBSERVED', `the receipt names approval ${receipt.approval_id}, not ${approvalId}`);
  }
  return { ok: true };
}
