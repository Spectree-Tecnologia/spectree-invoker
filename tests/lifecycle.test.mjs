// The closure lifecycle: identity, durable authority, and the write boundary.
//
// These exist because the same defect kept coming back one level up. Retirement lived in the
// current manifest, so restoring that manifest restored the authority. Then it lived in a filter
// each command wrote for itself, so one command honoured it and the next did not. The rule now
// belongs to the RECORD and to one shared decision, and these are the questions that asks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../scripts/lib/change/store.mjs';
import {
  approvalsInForce, approvalCoversPreparation, approvalCoversTarget,
  buildReceipt, receiptCovers, receiptDigest, preparationDigest, emptyLifecycle,
  readLifecycle, updateLifecycle, beginOperation, advanceOperation, pendingOperation,
  lifecyclePath, currentPath, snapshotPath, receiptPath, PHASE, LIFECYCLE_VERSION,
} from '../scripts/lib/change/lifecycle.mjs';
import { buildManifest, validArchivePath, preparationCovers, compareArtifacts, resolveCommand } from '../scripts/lib/closure/closure-prep.mjs';
import { resolveCi, aggregate, TREATMENT } from '../scripts/lib/evidence/ci-policy.mjs';
import { latestRun } from '../scripts/lib/shared/gh.mjs';
import { contentDigest } from '../scripts/lib/shared/digest.mjs';
import { gitRepo, cleanup, now, REPO, integrationApproval, recordIntegrationApproval } from './helpers.mjs';

const snapshot = (over = {}) => buildManifest({
  changeId: 'c1', projectId: 'proj', generation: 1, baseRevision: 'a'.repeat(40),
  contractDigest: 'sha256:contract', candidateDigest: 'sha256:candidate',
  archivePath: 'docs/changes/archive/2026-01-01-c1',
  artifacts: [{ path: 'docs/changes/archive/2026-01-01-c1/proposal.md', type: 'blob', mode: '100644', op: 'archived', digest: 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391' }],
  preparedAt: now(), ...over,
});

// --- identity ---------------------------------------------------------------------------------

test('a preparation digest covers the record and ignores the clock', () => {
  const a = snapshot({ preparedAt: '2026-01-01T00:00:00Z' });
  const b = snapshot({ preparationId: a.preparation_id, preparedAt: '2026-06-06T12:00:00Z' });
  assert.equal(a.preparation_digest, b.preparation_digest,
    'the same preparation run a minute later is the same preparation');

  // The artifact record IS part of the identity: that is the half content and contract never had.
  const moved = snapshot({
    preparationId: a.preparation_id,
    artifacts: [{ path: 'docs/changes/archive/2026-01-01-c1/proposal.md', type: 'blob', mode: '100644', op: 'archived', digest: 'aa9de29bb2d1d6434b8b29ae775ad8c2e48c5391' }],
  });
  assert.notEqual(a.preparation_digest, moved.preparation_digest);

  // And a generation is part of it, so a reopening cannot produce the same identity twice.
  assert.notEqual(a.preparation_digest, snapshot({ preparationId: a.preparation_id, generation: 2 }).preparation_digest);
});

test('a snapshot edited by hand no longer digests to what it records', () => {
  const s = snapshot();
  assert.equal(preparationCovers(s, {
    contractDigest: 'sha256:contract', candidateDigest: 'sha256:candidate', changeId: 'c1', generation: 1,
  }).ok, true);

  const tampered = { ...s, artifacts: [...s.artifacts, { path: 'x', type: 'blob', mode: '100644', op: 'archived', digest: 'bb9de29bb2d1d6434b8b29ae775ad8c2e48c5391' }] };
  const v = preparationCovers(tampered, {
    contractDigest: 'sha256:contract', candidateDigest: 'sha256:candidate', changeId: 'c1', generation: 1,
  });
  assert.equal(v.code, 'E_PREP_TAMPERED');
});

test('a generation that moved makes a preparation stale, not merely different', () => {
  const s = snapshot();
  const v = preparationCovers(s, {
    contractDigest: 'sha256:contract', candidateDigest: 'sha256:candidate', changeId: 'c1', generation: 2,
  });
  assert.equal(v.code, 'E_PREP_STALE');
  assert.match(v.message, /generation 1 and this change is at generation 2/);
});

test('an archive slot is repo-relative, inside archive/, and belongs to this change', () => {
  assert.equal(validArchivePath('docs/changes/archive/2026-01-01-c1', 'c1').ok, true);
  assert.equal(validArchivePath('/etc/passwd', 'c1').code, 'E_PREP_PATH');
  assert.equal(validArchivePath('C:/Windows', 'c1').code, 'E_PREP_PATH');
  assert.equal(validArchivePath('docs/changes/archive/../../../etc', 'c1').code, 'E_PREP_PATH');
  assert.equal(validArchivePath('docs/specs/account', 'c1').code, 'E_PREP_PATH');
  assert.equal(validArchivePath('docs/changes/archive/2026-01-01-c2', 'c1').code, 'E_PREP_PATH',
    'a change may not point its record at another change\'s folder');
});

test('an absent archive is an assertion somebody made, never a read that failed', () => {
  const declared = buildManifest({
    changeId: 'c1', generation: 1, baseRevision: 'a'.repeat(40),
    contractDigest: 'K', candidateDigest: 'C', preparedAt: now(),
    archiveAbsentReason: 'nothing was on disk to archive',
  });
  assert.equal(preparationCovers(declared, { contractDigest: 'K', candidateDigest: 'C', changeId: 'c1' }).ok, true);

  const silent = { ...declared, archive_absent_reason: null };
  const v = preparationCovers({ ...silent, preparation_digest: preparationDigest(silent) },
    { contractDigest: 'K', candidateDigest: 'C', changeId: 'c1' });
  assert.equal(v.code, 'E_PREP_MALFORMED');
  assert.match(v.message, /an absence that nobody asserted/);
});

// --- authority --------------------------------------------------------------------------------

test('retirement is durable: restoring the old manifest restores nothing', () => {
  const manifest = snapshot();
  const approvals = [
    integrationApproval({ approvalId: 'ap2', changeId: 'c1', scopeDigest: 'g', revision: 'r', manifest }),
  ];
  const lifecycle = {
    ...emptyLifecycle('c1', 'proj'),
    generation: 2,
    retired_approvals: [{ approval_id: 'ap2', generation: 1, at: now(), reason: 'reopened' }],
  };

  // The projection still says nothing about the retirement — that is exactly the document a
  // restore replaces — and the answer is the same anyway.
  const a = approvalsInForce(approvals, manifest, { lifecycle });
  assert.equal(a.ok, true);
  assert.deepEqual(a.inForce, []);
  assert.deepEqual(a.retired.map((x) => x.approval_id), ['ap2']);
});

test('a control that cannot be read blocks; it is not an empty list of retirements', () => {
  const manifest = snapshot();
  const approvals = [integrationApproval({ approvalId: 'ap2', changeId: 'c1', scopeDigest: 'g', revision: 'r', manifest })];

  const corrupt = approvalsInForce(approvals, manifest, {
    lifecycleError: { code: 'E_LIFECYCLE_CORRUPT', message: 'not valid JSON' },
  });
  assert.equal(corrupt.ok, false);
  assert.equal(corrupt.blocked, true);
  assert.deepEqual(corrupt.inForce, [], 'a blocked answer authorises nothing');

  // A preparation with no durable control behind it cannot answer either.
  const orphan = approvalsInForce(approvals, manifest, { lifecycle: null });
  assert.equal(orphan.ok, false);
  assert.equal(orphan.code, 'E_LIFECYCLE_MISSING');

  // A change with no closure at all is not BLOCKED by any of this — but an integration approval
  // with no durable record behind it is still not authority. Half an approval, written when the
  // control update never landed, must never read as a whole one.
  const fresh = approvalsInForce(approvals, null, { lifecycle: null });
  assert.equal(fresh.ok, true);
  assert.deepEqual(fresh.inForce, []);
  assert.deepEqual(fresh.unrecorded.map((a) => a.approval_id), ['ap2']);

  // With the control recording it, it is authority.
  const recorded = approvalsInForce(approvals, null, {
    lifecycle: { ...emptyLifecycle('c1', 'proj'), approved: [{ approval_id: 'ap2' }] },
  });
  assert.deepEqual(recorded.inForce.map((a) => a.approval_id), ['ap2']);
});

test('an integration approval names the preparation and the integration it authorises', () => {
  const manifest = snapshot();
  const ap = integrationApproval({
    approvalId: 'ap', changeId: 'c1', scopeDigest: 'g', revision: 'r', manifest,
    target: { repository: 'o/r', pr: 21, headSha: 'h'.repeat(40), baseBranch: 'main' },
  });
  assert.equal(approvalCoversPreparation(ap, manifest).ok, true);
  assert.equal(approvalCoversPreparation({ approval_id: 'x' }, manifest).code, 'E_APPROVAL_NO_PREPARATION');
  assert.equal(approvalCoversPreparation(ap, snapshot()).code, 'E_APPROVAL_OTHER_PREPARATION');
  assert.equal(
    approvalCoversPreparation(ap, snapshot({ preparationId: manifest.preparation_id, generation: 2 })).code,
    'E_APPROVAL_OTHER_GENERATION');

  const target = { repository: 'o/r', pr: 21, headSha: 'h'.repeat(40), baseBranch: 'main' };
  assert.equal(approvalCoversTarget(ap, target).ok, true);
  assert.equal(approvalCoversTarget(ap, { ...target, pr: 22 }).code, 'E_APPROVAL_OTHER_TARGET');
  assert.equal(approvalCoversTarget(ap, { ...target, repository: 'o/other' }).code, 'E_APPROVAL_OTHER_TARGET');
  assert.equal(approvalCoversTarget(ap, { ...target, headSha: 'f'.repeat(40) }).code, 'E_APPROVAL_OTHER_TARGET');
  assert.equal(approvalCoversTarget({ approval_id: 'x' }, target).code, 'E_APPROVAL_NO_TARGET');
});

// --- receipts ---------------------------------------------------------------------------------

const whole = (over = {}) => buildReceipt({
  changeId: 'c1', repository: 'o/r', pr: 21, headSha: 'h'.repeat(40), mergeCommit: 'm'.repeat(40),
  baseBranch: 'main', preparationId: 'prep-1', generation: 1, preparationDigest: 'sha256:p',
  approvalId: 'ap', contractDigest: 'sha256:k', candidateDigest: 'sha256:c',
  runs: [{ workflow: 'check', run_id: 1, attempt: 1, conclusion: 'success' }],
  operationId: 'op-1', ...over,
});

test('a receipt is about one merge of one preparation under one approval', () => {
  const r = whole();
  assert.equal(receiptCovers(r, { changeId: 'c1', mergeCommit: 'm'.repeat(40), generation: 1, preparationId: 'prep-1' }).ok, true);
  assert.equal(receiptCovers(null, { changeId: 'c1' }).code, 'E_INTEGRATION_NOT_OBSERVED');
  assert.equal(receiptCovers({ corrupt: true }, { changeId: 'c1' }).code, 'E_INTEGRATION_NOT_OBSERVED');
  assert.equal(receiptCovers(r, { changeId: 'c2' }).code, 'E_INTEGRATION_NOT_OBSERVED');
  assert.equal(receiptCovers(r, { changeId: 'c1', mergeCommit: 'other' }).code, 'E_INTEGRATION_NOT_OBSERVED');
  // A reopening after the confirmation moves the generation, and the old receipt stops covering.
  const later = receiptCovers(r, { changeId: 'c1', mergeCommit: 'm'.repeat(40), generation: 2 });
  assert.equal(later.code, 'E_INTEGRATION_NOT_OBSERVED');
  assert.match(later.message, /generation 1 and this change is at generation 2/);
});

test('an incomplete receipt is not a receipt, whatever it happens to name correctly', () => {
  // The record that reached `integrated` with no merge, no PR, no run and no approval anywhere:
  // four keys, every one of them true, and every comparison the caller happened to ask for
  // passing. Structure is checked BEFORE comparison now, so what it names is beside the point.
  const stub = { receipt_version: '1.0.0', change_id: 'c1', generation: 1, preparation_id: 'prep-1' };
  const v = receiptCovers(stub, { changeId: 'c1', generation: 1, preparationId: 'prep-1' });
  assert.equal(v.code, 'E_RECEIPT_INCOMPLETE');
  for (const field of ['repository', 'pr', 'head_sha', 'merge_commit', 'approval_id', 'observed_at']) {
    assert.match(v.message, new RegExp(field), `${field} is named as missing`);
  }

  // Each identity removed on its own is refused on its own.
  for (const field of ['repository', 'pr', 'head_sha', 'merge_commit', 'base_branch',
    'preparation_id', 'generation', 'preparation_digest', 'approval_id',
    'contract_digest', 'candidate_digest', 'operation_id']) {
    const missing = { ...whole(), [field]: null };
    assert.equal(receiptCovers(missing, { changeId: 'c1' }).code, 'E_RECEIPT_INCOMPLETE', `${field} is required`);
  }
  // A receipt that observed no run observed no CI.
  assert.equal(receiptCovers({ ...whole(), runs: [] }, { changeId: 'c1' }).code, 'E_RECEIPT_INCOMPLETE');

  // A legacy closure legitimately carries fewer — and says so on the change. An ABSENCE of the
  // v2 fields is never read as a declaration of legacy.
  assert.equal(receiptCovers(stub, { changeId: 'c1', legacy: true }).ok, false, 'legacy still needs a merge commit');
  assert.equal(receiptCovers({ ...stub, merge_commit: 'm'.repeat(40), operation_id: 'op-1', observed_at: now() },
    { changeId: 'c1', legacy: true }).ok, true);
});

test('a receipt the confirmation never wrote is a file, not an observation', () => {
  const r = whole();
  // The control is what says this squad observed it. Without the pointer, a JSON dropped where a
  // receipt goes would gain authority by naming a preparation that really exists.
  assert.equal(receiptCovers(r, { changeId: 'c1', lifecycle: emptyLifecycle('c1', 'p') }).code, 'E_RECEIPT_UNRECORDED');

  // The pointer names the WHOLE document. Naming it by merge commit and generation named two
  // fields out of fifteen, and every other binding could be rewritten underneath the pointer.
  const pointed = { ...emptyLifecycle('c1', 'p'), receipt: { receipt_digest: receiptDigest(r) } };
  assert.equal(receiptCovers(r, { changeId: 'c1', lifecycle: pointed }).ok, true);
  assert.equal(
    receiptCovers({ ...r, repository: 'somebody/else' }, { changeId: 'c1', lifecycle: pointed }).code,
    'E_RECEIPT_UNRECORDED', 'a field the old pointer never looked at');
  assert.equal(
    receiptCovers(r, { changeId: 'c1', lifecycle: { ...emptyLifecycle('c1', 'p'), receipt: { merge_commit: 'm'.repeat(40), generation: 1 } } }).code,
    'E_RECEIPT_UNRECORDED', 'a pointer with no digest cannot say which document it observed');

  // And the approval it names has to still be authority.
  assert.equal(receiptCovers(r, {
    changeId: 'c1', lifecycle: pointed, inForceIds: new Set(['someone-else']),
  }).code, 'E_INTEGRATION_NOT_OBSERVED');
});

// --- artifacts --------------------------------------------------------------------------------

test('an artifact is its path, its content, its mode and its type — and nothing may join it', () => {
  const m = snapshot();
  const under = 'docs/changes/archive/2026-01-01-c1';
  const blob = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
  const present = () => ({ mode: '100644', type: 'blob', blob });

  assert.equal(compareArtifacts(m, present, [`${under}/proposal.md`]).ok, true);
  assert.deepEqual(compareArtifacts(m, () => null, [`${under}/proposal.md`]).missing, [`${under}/proposal.md`]);
  assert.deepEqual(
    compareArtifacts(m, () => ({ mode: '100644', type: 'blob', blob: 'other' }), [`${under}/proposal.md`]).altered,
    [`${under}/proposal.md`]);

  // The mode with the SAME blob. An archived file is outside the code digest and outside the
  // contract digest, so nothing else in the system could have seen this.
  const remoded = compareArtifacts(m, () => ({ mode: '100755', type: 'blob', blob }), [`${under}/proposal.md`]);
  assert.equal(remoded.ok, false);
  assert.match(remoded.message, /100644 -> 100755/);

  // A record with no mode cannot answer the question, and silence is not agreement.
  const old = { ...m, artifacts: m.artifacts.map(({ mode, ...rest }) => rest) };
  assert.match(compareArtifacts(old, present, [`${under}/proposal.md`]).message, /carries no mode/);

  // The half that walking only the record could never see.
  assert.deepEqual(
    compareArtifacts(m, present, [`${under}/proposal.md`, `${under}/snuck-in.md`]).added,
    [`${under}/snuck-in.md`]);

  // A tree that could not be listed is UNKNOWN. Comparing it as an empty one would report that
  // nothing was added, which is a claim nobody made.
  const unlisted = compareArtifacts(m, present, null);
  assert.equal(unlisted.ok, false);
  assert.equal(unlisted.unknownAdditions, true);
  assert.match(unlisted.message, /unknown is not empty/);
});

// --- the write boundary -------------------------------------------------------------------------

function controlled() {
  const repo = gitRepo({ 'a.txt': 'a\n', '.gitignore': '.spectree/\n' });
  mkdirSync(join(repo.root, '.spectree/closure'), { recursive: true });
  return repo;
}

test('an operation records its phase before its effects, and an interruption is named', () => {
  const repo = controlled();
  try {
    const { operationId } = beginOperation(repo.root, 'c1', { kind: 'prepare', detail: { x: 1 } });
    let lc = readLifecycle(repo.root, 'c1');
    assert.equal(pendingOperation(lc.doc).phase, PHASE.INTENT);
    assert.equal(pendingOperation(lc.doc).uncertain, false);

    advanceOperation(repo.root, 'c1', operationId, PHASE.STARTED);
    lc = readLifecycle(repo.root, 'c1');
    const open = pendingOperation(lc.doc);
    // Started and never observed is the one phase nobody may resolve automatically: the command
    // may or may not have run, and running it again "for convenience" is a decision.
    assert.equal(open.uncertain, true);
    assert.match(open.recovery, /never observed/);

    // A second operation cannot open over it.
    assert.throws(() => beginOperation(repo.root, 'c1', { kind: 'reopen' }), (e) => e.code === 'E_OPERATION_PENDING');
  } finally { cleanup(repo.root); }
});

test('the control refuses a write that was computed against an older revision', () => {
  const repo = controlled();
  try {
    const first = updateLifecycle(repo.root, 'c1', (cur) => ({ ...cur, generation: 1 }));
    updateLifecycle(repo.root, 'c1', (cur) => ({ ...cur, generation: 2 }));
    assert.throws(
      () => updateLifecycle(repo.root, 'c1', (cur) => cur, { expectedRevision: first.revision }),
      (e) => e.code === 'E_CONCURRENT_UPDATE');
  } finally { cleanup(repo.root); }
});

test('a corrupt control is refused rather than replaced', () => {
  const repo = controlled();
  try {
    writeFileSync(join(repo.root, lifecyclePath('c1')), '{ not json');
    const lc = readLifecycle(repo.root, 'c1');
    assert.equal(lc.present, true);
    assert.equal(lc.doc, null);
    assert.equal(lc.code, 'E_LIFECYCLE_CORRUPT');
    assert.throws(() => updateLifecycle(repo.root, 'c1', (c) => c), (e) => e.code === 'E_LIFECYCLE_CORRUPT');
    assert.equal(readFileSync(join(repo.root, lifecyclePath('c1')), 'utf8'), '{ not json', 'and left where it was');

    writeFileSync(join(repo.root, lifecyclePath('c1')), JSON.stringify({ ...emptyLifecycle('c1'), lifecycle_version: '99.0.0' }));
    assert.equal(readLifecycle(repo.root, 'c1').code, 'E_LIFECYCLE_VERSION');

    writeFileSync(join(repo.root, lifecyclePath('c1')), JSON.stringify(emptyLifecycle('other')));
    assert.equal(readLifecycle(repo.root, 'c1').code, 'E_LIFECYCLE_COLLISION');
  } finally { cleanup(repo.root); }
});

test('an approval id names one document: the same bytes twice, never a different one', () => {
  const repo = controlled();
  try {
    const store = new Store(repo.root);
    store.init({ project_id: 'p', protocol_version: '1.0.0' });
    const doc = integrationApproval({
      approvalId: 'ap', changeId: 'c1', scopeDigest: 'sha256:gated-digest', revision: 'r'.repeat(40), manifest: snapshot(),
    });
    store.putApproval(doc);
    store.putApproval({ ...doc });
    assert.throws(() => store.putApproval({ ...doc, scope_digest: 'sha256:something-else' }), (e) => e.code === 'E_DOCUMENT_CONFLICT');
    assert.equal(JSON.parse(readFileSync(join(repo.root, '.spectree/approvals/ap.json'), 'utf8')).scope_digest, 'sha256:gated-digest',
      'the stored authorisation is untouched');
  } finally { cleanup(repo.root); }
});

// --- git representation --------------------------------------------------------------------------

test('a symlink and an unmerged index are refused, not hashed as if they were files', () => {
  const repo = gitRepo({ 'a.txt': 'a\n', '.gitignore': '.spectree/\n' });
  try {
    let made = true;
    try { symlinkSync(join(repo.root, 'a.txt'), join(repo.root, 'link.txt')); }
    catch { made = false; }
    if (made) {
      // git stores a symlink as its TARGET STRING; hashing one silently compares a pointer with
      // a file, and a junction on Windows has no honest reading at all.
      assert.throws(() => contentDigest(repo.root), /symbolic link/);
      rmSync(join(repo.root, 'link.txt'));
    }
    assert.ok(contentDigest(repo.root).digest.startsWith('sha256:'), 'and it works again once it is gone');
  } finally { cleanup(repo.root); }
});

// --- the CI declaration ---------------------------------------------------------------------------

test('a CI declaration is a workflow and its jobs, and a bare list must be unambiguous', () => {
  const v2 = { ci: { version: 2, required_runs: { full: { workflow: 'check', jobs: ['classify', 'plugin'], event: 'push', branch: 'main' } } } };
  const r = resolveCi(v2, TREATMENT.FULL);
  assert.equal(r.ok, true);
  assert.deepEqual(r.jobs, ['classify', 'plugin']);
  assert.equal(r.event, 'push');

  assert.equal(resolveCi({}, TREATMENT.FULL).code, 'E_CI_MAP_MISSING');
  assert.equal(resolveCi({ ci: { version: 2, required_runs: {} } }, TREATMENT.FULL).code, 'E_CI_MAP_MISSING');
  assert.equal(resolveCi({ ci: { version: 2, required_runs: { full: { workflow: 'check', jobs: [] } } } }, TREATMENT.FULL).code,
    'E_CI_MAP_MISSING', 'an empty required set is not a green one');

  // A legacy list of names carries no workflow identity. One name resolves; two do not, and the
  // refusal asks for migration instead of guessing which name is which kind of thing.
  assert.equal(resolveCi({ ci: { required_runs: ['check'] } }, TREATMENT.FULL).ok, true);
  const ambiguous = resolveCi({ ci: { required_runs: ['check', 'lint'] } }, TREATMENT.FULL);
  assert.equal(ambiguous.code, 'E_CI_MAP_AMBIGUOUS');
  assert.match(ambiguous.message, /Migrate to/);
});

test('the run that speaks is the latest of that workflow, not the first in the response', () => {
  const mk = (id, attempt, createdAt) => ({
    databaseId: id, workflowName: 'check', workflowDatabaseId: 77, attempt, createdAt,
  });
  const runs = [
    mk(1, 1, '2026-01-01T00:00:00Z'),
    mk(2, 2, '2026-01-02T00:00:00Z'),
    { databaseId: 3, workflowName: 'other', workflowDatabaseId: 88, attempt: 9, createdAt: '2026-02-01T00:00:00Z' },
  ];
  assert.equal(latestRun(runs, { workflowName: 'check' }).databaseId, 2);
  assert.equal(latestRun(runs, { workflowId: 77 }).databaseId, 2);
  assert.equal(latestRun([...runs].reverse(), { workflowName: 'check' }).databaseId, 2,
    'the order of a response is not a decision');
  assert.equal(latestRun(runs, { workflowName: 'nobody' }), null);
});

test('an aggregate tells a job that is still running from one that never reported', () => {
  assert.equal(aggregate(TREATMENT.FULL, { classify: 'success', plugin: 'success' }).ok, true);
  assert.equal(aggregate(TREATMENT.FULL, { classify: 'success', plugin: 'in_progress' }).code, 'E_CHECK_NOT_GREEN');
  assert.equal(aggregate(TREATMENT.FULL, { classify: 'success', plugin: undefined }).code, 'E_CHECK_MISSING');
  assert.equal(aggregate(TREATMENT.FULL, { classify: 'success' }).code, 'E_CHECK_MISSING');
  assert.equal(aggregate(TREATMENT.FULL, { classify: 'success', plugin: 'skipped' }).code, 'E_CHECK_NOT_GREEN',
    'a REQUIRED job that was skipped is a refusal');
});

// --- the consolidation command ---------------------------------------------------------------------

test('a consolidation command is substituted per argument, literally, or not at all', () => {
  assert.deepEqual(
    resolveCommand(['node', 'consolidate.mjs', '{change_dir}', '--id', '{change_id}'], { changeId: 'c1', changeDir: 'docs/changes/archive/2026-01-01-c1' }),
    ['node', 'consolidate.mjs', 'docs/changes/archive/2026-01-01-c1', '--id', 'c1']);
  // A command with no placeholder is passed through untouched: that is every existing project.
  assert.deepEqual(resolveCommand(['node', 'x.mjs'], { changeId: 'c1', changeDir: 'd' }), ['node', 'x.mjs']);
  // No shell, no concatenation: an argument stays one argument whatever is inside it.
  assert.deepEqual(
    resolveCommand(['sh', '-c', 'echo {change_id}; rm -rf /'], { changeId: 'c1', changeDir: 'd' }),
    ['sh', '-c', 'echo c1; rm -rf /']);
});

// --- migration ----------------------------------------------------------------------------------------

function migrated(repo, ...args) {
  const r = spawnSync(process.execPath, [join(REPO, 'scripts/migrate-closure.mjs'), ...args],
    { cwd: repo.root, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

test('a v1 record becomes history, never authority, and the migration is idempotent', () => {
  const repo = controlled();
  try {
    const store = new Store(repo.root);
    store.init({ project_id: 'p', protocol_version: '1.0.0' });
    store.putChange({
      schema_version: '1.0.0', project_id: 'p', change_id: 'c1', change_type: 'feature',
      protocol_version: '1.0.0', adapter: 'codex', base_revision: repo.base, scope: 's',
      allowed_paths: ['a.txt'], deltaless: true, state: 'implemented',
    }, { event: { type: 'opened' } });
    const v1 = JSON.stringify({
      manifest_version: '1.0.0', change_id: 'c1', base_revision: repo.base,
      contract_digest: 'K', candidate_digest: 'C', artifacts: [], commands: [], blocking: [],
      deferred: [], prepared_at: now(), supersedes_approval: ['ap-old'],
    }, null, 2);
    writeFileSync(join(repo.root, currentPath('c1')), v1);

    const dry = migrated(repo, '--json');
    assert.equal(dry.code, 0);
    const plan = JSON.parse(dry.out);
    assert.deepEqual(plan.plan.map((p) => p.action), ['retire_v1']);
    assert.deepEqual(plan.needs_reapproval, ['c1']);
    assert.equal(existsSync(join(repo.root, lifecyclePath('c1'))), false, 'a dry run writes nothing');

    assert.equal(migrated(repo, '--apply').code, 0);
    const lc = readLifecycle(repo.root, 'c1');
    assert.equal(lc.doc.lifecycle_version, LIFECYCLE_VERSION);
    assert.equal(lc.doc.current_preparation, null, 'a v1 record does not become the current preparation');
    assert.deepEqual(lc.doc.retired_approvals.map((r) => r.approval_id), ['ap-old'],
      'what it did record about retirement is carried forward');
    // Byte for byte: what a record WAS is the document, not a re-serialisation of its meaning.
    const kept = join(repo.root, snapshotPath('c1', 'v1-1.0.0'));
    assert.equal(readFileSync(kept, 'utf8'), v1);

    const again = migrated(repo, '--apply', '--json');
    assert.equal(again.code, 0);
    assert.equal(readFileSync(kept, 'utf8'), v1, 'running it twice changes nothing');
  } finally { cleanup(repo.root); }
});

test('a corrupt record stops the migration instead of being migrated by guessing', () => {
  const repo = controlled();
  try {
    new Store(repo.root).init({ project_id: 'p', protocol_version: '1.0.0' });
    writeFileSync(join(repo.root, currentPath('c1')), '{ truncated');
    const r = migrated(repo, '--apply', '--json');
    assert.equal(r.code, 1);
    assert.equal(JSON.parse(r.out).refusals[0].code, 'E_PREP_CORRUPT');
    assert.equal(existsSync(join(repo.root, lifecyclePath('c1'))), false, 'and nothing was written');
  } finally { cleanup(repo.root); }
});

test('the installer transports the migration and never runs it', () => {
  const src = readFileSync(join(REPO, 'scripts/install-codex.mjs'), 'utf8');
  assert.match(src, /migrate-closure\.mjs/, 'it travels with the scripts');
  assert.doesNotMatch(src, /migrate-closure\.mjs['"]\s*\]\s*,\s*\{\s*cwd/, 'and the installer does not execute it');
  assert.doesNotMatch(src, /spawnSync|execFileSync/, 'installing code and rewriting records are different acts');
});

// --- concurrency and crash, through the CLIs ------------------------------------------------------

/** A change ready to prepare, with a consolidation that leaves a mark and can be made slow. */
function preparable({ slowMs = 0 } = {}) {
  const repo = gitRepo({ 'src/app.js': 'export const x = 1;\n', '.gitignore': '.spectree/\n' });
  const store = new Store(repo.root);
  store.init({
    project_id: 'fixture', protocol_version: '1.0.0',
    closure: {
      consolidate: [process.execPath, '-e',
        `const fs=require('fs');fs.appendFileSync('.spectree/ran','x');${slowMs ? `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${slowMs});` : ''}`],
    },
  });
  store.putChange({
    schema_version: '1.0.0', project_id: 'fixture', change_id: 'c1', change_type: 'feature',
    protocol_version: '1.0.0', adapter: 'codex', base_revision: repo.base, scope: 'fixture',
    allowed_paths: ['src', 'docs'], deltaless: true, state: 'implemented',
  }, { event: { type: 'opened' } });
  mkdirSync(join(repo.root, 'docs/changes/c1'), { recursive: true });
  writeFileSync(join(repo.root, 'docs/changes/c1/proposal.md'), '# proposal\n');
  repo.git(['add', '-A']); repo.git(['commit', '-qm', 'the proposal']);
  return {
    ...repo, store,
    prep: (...args) => {
      const r = spawnSync(process.execPath, [join(REPO, 'scripts/prepare-closure.mjs'), 'c1', ...args],
        { cwd: repo.root, encoding: 'utf8' });
      return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
    },
    ranTimes: () => (existsSync(join(repo.root, '.spectree/ran')) ? readFileSync(join(repo.root, '.spectree/ran'), 'utf8').length : 0),
    manifest: () => { try { return JSON.parse(readFileSync(join(repo.root, currentPath('c1')), 'utf8')); } catch { return null; } },
    drop: () => cleanup(repo.root),
  };
}

test('two preparations at once produce one preparation, not a mixed state', async () => {
  const f = preparable({ slowMs: 400 });
  try {
    // Both processes really run at the same time: they are started together and neither is
    // waited on before the other begins. A sequential "concurrency" test proves nothing.
    const start = () => new Promise((resolve) => {
      const child = spawn(process.execPath, [join(REPO, 'scripts/prepare-closure.mjs'), 'c1', '--apply', '--json'],
        { cwd: f.root });
      let out = '', err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('close', (code) => resolve({ code, out, err }));
    });
    const results = await Promise.all([start(), start()]);
    const ok = results.filter((r) => r.code === 0);

    assert.ok(ok.length >= 1, `at least one must succeed: ${JSON.stringify(results.map((r) => r.err.slice(0, 200)))}`);
    // Whatever the interleaving, the record on disk is ONE coherent preparation.
    const m = f.manifest();
    assert.ok(m, 'a preparation was written');
    assert.equal(m.preparation_digest, preparationDigest(m), 'and it is internally consistent');
    const lc = readLifecycle(f.root, 'c1');
    assert.equal(lc.doc.current_preparation, m.preparation_id, 'the pointer names the document that exists');
    assert.equal(pendingOperation(lc.doc), null, 'and no operation was left half open');
  } finally { f.drop(); }
});

test('an interrupted write is recovered explicitly, and an uncertain command is not re-run', () => {
  const f = preparable();
  try {
    // A crash between starting the consolidation and observing its result: exactly the phase
    // nobody may resolve automatically, because the command may or may not have run.
    beginOperation(f.root, 'c1', { kind: 'prepare', operationId: 'op-prepare-crashed', detail: {} });
    advanceOperation(f.root, 'c1', 'op-prepare-crashed', PHASE.STARTED);

    const r = f.prep('--apply', '--json');
    assert.equal(r.code, 1, 'a half-finished write is not something to authorise over');
    const doc = JSON.parse(r.out);
    assert.equal(doc.code, 'E_OPERATION_PENDING');
    assert.equal(doc.pending_operation.uncertain, true);
    assert.equal(f.ranTimes(), 0, 'and the uncertain command was NOT run again for convenience');
    assert.equal(f.manifest(), null);

    // `resume` says the same thing, with the recovery, rather than presenting a clean state.
    const resumed = spawnSync(process.execPath, [join(REPO, 'scripts/state.mjs'), 'resume', 'c1', '--json'],
      { cwd: f.root, encoding: 'utf8' });
    const res = JSON.parse(resumed.stdout);
    assert.equal(res.pending_operation.phase, 'started');
    assert.match(res.pending_operation.recovery, /never observed/);

    // And so does a gate: authorising over a set nobody finished applying is authorising over
    // half of two different states.
    const can = spawnSync(process.execPath, [join(REPO, 'scripts/state.mjs'), 'can', 'c1', 'pass2_complete'],
      { cwd: f.root, encoding: 'utf8' });
    assert.equal(can.status, 1);
    assert.match(can.stderr, /E_OPERATION_PENDING/);
  } finally { f.drop(); }
});

test('the same preparation twice runs the consolidation once', () => {
  const f = preparable();
  try {
    assert.equal(f.prep('--apply').code, 0);
    assert.equal(f.ranTimes(), 1);
    const first = readFileSync(join(f.root, currentPath('c1')), 'utf8');
    assert.match(f.prep('--apply').out, /unchanged/);
    assert.equal(f.ranTimes(), 1, 'idempotent means the command does not run a second time');
    assert.equal(readFileSync(join(f.root, currentPath('c1')), 'utf8'), first);
  } finally { f.drop(); }
});

test('a reopening is refused once the change has integrated', () => {
  const f = preparable();
  try {
    assert.equal(f.prep('--apply').code, 0);
    recordIntegrationApproval(f.root, 'c1', integrationApproval({
      approvalId: 'ap-integration', changeId: 'c1', manifest: f.manifest(),
      scopeDigest: 'sha256:whatever-the-gate-said', revision: f.git(['rev-parse', 'HEAD']).trim(),
    }));
    // The terminal state a confirmation would have left behind.
    const c = f.store.change('c1');
    f.store.putChange({ ...c, state: 'integrated' }, { expected: c.state_revision, event: { type: 'fixture' } });

    const r = f.prep('--apply', '--reopen', '--reason', 'too late', '--json');
    assert.equal(r.code, 1);
    assert.equal(JSON.parse(r.out).code, 'E_REOPEN_TERMINAL');
    assert.equal(f.ranTimes(), 1, 'and nothing ran');
    assert.equal(readLifecycle(f.root, 'c1').doc.retired_approvals.length, 0);
  } finally { f.drop(); }
});

test('a reason that is another flag is a missing reason', () => {
  const f = preparable();
  try {
    assert.equal(f.prep('--apply').code, 0);
    recordIntegrationApproval(f.root, 'c1', integrationApproval({
      approvalId: 'ap-integration', changeId: 'c1', manifest: f.manifest(),
      scopeDigest: 'sha256:whatever', revision: f.git(['rev-parse', 'HEAD']).trim(),
    }));
    for (const args of [['--apply', '--reopen'], ['--apply', '--reopen', '--reason', '--json'], ['--apply', '--reopen', '--reason', '   ']]) {
      const r = f.prep(...args);
      assert.equal(r.code, 2, `${args.join(' ')} must not retire an approval`);
      assert.match(r.err, /--reason|not retired anonymously/);
    }
    assert.equal(readLifecycle(f.root, 'c1').doc.retired_approvals.length, 0, 'nothing was retired');
  } finally { f.drop(); }
});

test('state validate covers the closure documents, not only the change store', () => {
  const repo = controlled();
  try {
    const store = new Store(repo.root);
    store.init({ project_id: 'p', protocol_version: '1.0.0' });
    writeFileSync(join(repo.root, currentPath('c1')), JSON.stringify(snapshot(), null, 2));
    writeFileSync(join(repo.root, receiptPath('c1')), JSON.stringify(buildReceipt({
      changeId: 'c1', mergeCommit: 'm'.repeat(40), pr: 1, operationId: 'op-1',
    }), null, 2));
    const ok = spawnSync(process.execPath, [join(REPO, 'scripts/state.mjs'), 'validate'],
      { cwd: repo.root, encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /document\(s\)/);

    // A field nobody declared is a document this build cannot read, not a document to fix up.
    writeFileSync(join(repo.root, receiptPath('c1')), JSON.stringify({ ...buildReceipt({
      changeId: 'c1', mergeCommit: 'm'.repeat(40), pr: 1, operationId: 'op-1',
    }), invented_field: true }, null, 2));
    const bad = spawnSync(process.execPath, [join(REPO, 'scripts/state.mjs'), 'validate'],
      { cwd: repo.root, encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /receipt/);
  } finally { cleanup(repo.root); }
});

test('the installer carries the schemas the closure documents are read against', () => {
  const src = readFileSync(join(REPO, 'scripts/install-codex.mjs'), 'utf8');
  assert.match(src, /readdirSync\(join\(pkg, 'schemas'\)\)/, 'every schema travels, not a hand-kept list');
  for (const s of ['preparation.schema.json', 'receipt.schema.json']) {
    assert.ok(existsSync(join(REPO, 'schemas', s)), `${s} exists to be carried`);
  }
});
