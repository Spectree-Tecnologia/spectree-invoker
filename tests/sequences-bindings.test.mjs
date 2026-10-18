// The composed sequences, each one a family of defects that reached acceptance.
//
// They are here as whole flows rather than unit questions because every one of them passed a
// single-step check and failed the sequence: refresh alone was correct, `stale` alone was
// correct, the confirmation alone was correct, and together they let a substituted record close
// a change. A rule that only holds one step at a time is a rule with a door next to it.
//
// Everything is real except the GitHub transport: real repositories, the installed CLIs, real
// digests, real transitions.
//
// This file: the receipt bindings, one identity per document, and the exact approval.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../scripts/lib/change/store.mjs';
import { currentPath, snapshotPath, readLifecycle, receiptPath, pendingOperation } from '../scripts/lib/change/lifecycle.mjs';
import { now, preparationOf } from './helpers.mjs';
import { project, consolidationRuns } from './sequences-fixture.mjs';

// --- the receipt's bindings, one field at a time ----------------------------------------------------

test('every binding of a receipt is compared, one removed field at a time', () => {
  const p = project();
  try {
    assert.equal(p.prep('--apply').code, 0);
    p.git(['add', '-A']); p.git(['commit', '-qm', 'prepared']);
    p.approve();
    p.merge();
    assert.equal(p.confirm('--pr', '999', '--apply').code, 0);
    assert.equal(p.stateNow(), 'closed');

    // Replayed to the final gate, so `closed` is the transition under test.
    const c = new Store(p.root).change('c1');
    new Store(p.root).putChange({ ...c, state: 'integrated' },
      { expected: c.state_revision, event: { type: 'fixture-replay-final-gate' } });

    const path = join(p.root, receiptPath('c1'));
    const pristine = readFileSync(path, 'utf8');
    assert.equal(p.state('can', 'c1', 'closed').code, 0, 'the pristine receipt is authority');

    // Rewritten, one field per case. Every one of these used to be invisible to this gate: the
    // expectation was assembled field by field at the call site, and this call site never built
    // the repository, the PR, the head or the candidate digest.
    for (const [field, value] of [
      ['repository', 'somebody/else'],
      ['pr', 12345],
      ['head_sha', 'b'.repeat(40)],
      ['base_branch', 'not-main'],
      ['merge_commit', 'c'.repeat(40)],
      ['preparation_id', 'prep-somebody-else'],
      ['generation', 9],
      ['preparation_digest', `sha256:${'d'.repeat(64)}`],
      ['approval_id', 'ap-somebody-else'],
      ['contract_digest', `sha256:${'e'.repeat(64)}`],
      ['candidate_digest', `sha256:${'f'.repeat(64)}`],
      ['operation_id', 'op-somebody-else'],
      ['observed_at', '2020-01-01T00:00:00Z'],
      ['runs', [{}]],
      ['runs', [{ workflow: 'check', run_id: 1, attempt: 1 }]],
    ]) {
      writeFileSync(path, JSON.stringify({ ...JSON.parse(pristine), [field]: value }));
      const can = p.state('can', 'c1', 'closed');
      const moved = p.state('transition', 'c1', 'closed');
      assert.equal(can.code, 1, `${field} rewritten must refuse`);
      assert.equal(moved.code, 1, `${field} rewritten must not move the state`);
      assert.match(can.err, /E_RECEIPT_|E_INTEGRATION_NOT_OBSERVED/, `${field}: ${can.err}`);
      assert.equal(new Store(p.root).change('c1').state, 'integrated', `${field}: the state did not move`);
    }

    writeFileSync(path, pristine);
    assert.equal(p.state('can', 'c1', 'closed').code, 0, 'and the pristine receipt still is');
  } finally { p.drop(); }
});

// --- the observation covers what the command PRODUCED, not only what it read --------------------

test('the result the command produced is bound too, not just the contract it read', () => {
  const p = project({ counting: true });
  try {
    assert.equal(p.prepCrashing('observed', '--apply').code, 86);
    assert.equal(consolidationRuns(p), 1);
    const living = join(p.root, 'docs/specs/account/spec.md');
    const produced = readFileSync(living, 'utf8');
    assert.match(produced, /Requirement: x/, 'the consolidation really did produce it');

    // The delta is left ALONE this time. Every contract comparison agrees; what changed during the
    // pause is the output that command had already been observed producing.
    writeFileSync(living, '## WRONG output substituted during pause\n');
    const contractBefore = p.state('digest', 'c1').out;

    const r = p.prep('--apply', '--resume', '--json');
    assert.equal(r.code, 1, 'an old PASS is not pinned to content that command never produced');
    const doc = JSON.parse(r.out);
    assert.equal(doc.code, 'E_RESUME_INPUTS_CHANGED');
    assert.match(JSON.stringify(doc.drift), /what the command produced/);
    assert.equal(consolidationRuns(p), 1, 'and it was not run again to paper over the difference');
    assert.equal(existsSync(join(p.root, currentPath('c1'))), false, 'no preparation was published');
    assert.equal(readFileSync(living, 'utf8'), '## WRONG output substituted during pause\n',
      'and nothing was reverted: what is on disk is left for a person to look at');
    assert.equal(p.state('digest', 'c1').out, contractBefore, 'the contract never moved — that is the point');

    // Putting the output back makes it resumable again.
    writeFileSync(living, produced);
    const again = p.prep('--apply', '--resume', '--json');
    assert.equal(again.code, 0, again.err);
    assert.equal(consolidationRuns(p), 1);
    assert.equal(pendingOperation(readLifecycle(p.root, 'c1').doc), null);
  } finally { p.drop(); }
});

test('a consolidation that rewrites its own output still prepares, first time through', () => {
  // The mirror of the case above, and the reason it compares the result AFTER the command rather
  // than before: a consolidation legitimately produces and then rewrites its own files.
  const p = project({ counting: true });
  try {
    const script = join(p.root, '.spectree/consolidate.mjs');
    writeFileSync(script, `${readFileSync(script, 'utf8')}
import { writeFileSync as w } from 'node:fs';
w('docs/specs/account/spec.md', '## ADDED Requirements\\n\\n### Requirement: x (rewritten by the command itself)\\n');
`);
    const r = p.prep('--apply', '--json');
    assert.equal(r.code, 0, r.err);
    assert.equal(consolidationRuns(p), 1);
    assert.match(readFileSync(join(p.root, 'docs/specs/account/spec.md'), 'utf8'), /rewritten by the command itself/);
  } finally { p.drop(); }
});

// --- one identity, one document ------------------------------------------------------------------

test('a stale re-preparation reserves a new identity and leaves the old snapshot alone', () => {
  const p = project({ counting: true });
  try {
    assert.equal(p.prep('--apply').code, 0);
    p.git(['add', '-A']); p.git(['commit', '-qm', 'prepared']);
    const first = preparationOf(p.root, 'c1');
    const firstSnapshot = readFileSync(join(p.root, snapshotPath('c1', first.preparation_id)), 'utf8');

    // Not a resume and not a reopening: an ordinary re-preparation because the code moved.
    writeFileSync(join(p.root, 'src/app.js'), 'export const x = 2;\n');
    const again = p.prep('--apply', '--json');
    assert.equal(again.code, 0, again.err);
    assert.equal(consolidationRuns(p), 2, 'it really did re-prepare');

    const now = preparationOf(p.root, 'c1');
    assert.notEqual(now.preparation_id, first.preparation_id, 'a new document gets a new identity');
    assert.equal(readFileSync(join(p.root, snapshotPath('c1', first.preparation_id)), 'utf8'), firstSnapshot,
      'and the previous snapshot is byte for byte what it was');

    // The reference and the document agree, whichever file the reader opens.
    const snapshot = JSON.parse(readFileSync(join(p.root, snapshotPath('c1', now.preparation_id)), 'utf8'));
    assert.equal(snapshot.preparation_digest, now.preparation_digest);
    assert.deepEqual(snapshot, now);
    assert.equal(JSON.parse(again.out).preparation_digest, now.preparation_digest, 'and so does what was reported');
    assert.equal(readLifecycle(p.root, 'c1').doc.current_preparation, now.preparation_id);
  } finally { p.drop(); }
});

test('an interrupted second preparation resumes under the identity IT reserved', () => {
  const p = project({ counting: true });
  try {
    assert.equal(p.prep('--apply').code, 0);
    p.git(['add', '-A']); p.git(['commit', '-qm', 'prepared']);
    const first = preparationOf(p.root, 'c1');

    writeFileSync(join(p.root, 'src/app.js'), 'export const x = 3;\n');
    assert.equal(p.prepCrashing('persisting', '--apply').code, 86);
    const reserved = pendingOperation(readLifecycle(p.root, 'c1').doc).plan.preparation_id;
    assert.notEqual(reserved, first.preparation_id, 'the second preparation reserved its own identity');

    const r = p.prep('--apply', '--resume', '--json');
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).preparation_id, reserved, 'and the resume finished THAT one');
    assert.equal(consolidationRuns(p), 2, 'twice in total: one preparation each, neither re-run');
    const now = preparationOf(p.root, 'c1');
    assert.equal(now.preparation_id, reserved);
    assert.deepEqual(JSON.parse(readFileSync(join(p.root, snapshotPath('c1', reserved)), 'utf8')), now);
    assert.equal(readLifecycle(p.root, 'c1').doc.current_preparation, reserved);
    // And the first one is still there, untouched.
    assert.ok(existsSync(join(p.root, snapshotPath('c1', first.preparation_id))));
  } finally { p.drop(); }
});

// --- the exact approval, never the first one on disk ----------------------------------------------

test('with two approvals over one preparation, the one that fits is the one used', () => {
  for (const order of [['aa-other-pr', 'zz-right-pr'], ['zz-right-pr', 'aa-other-pr']]) {
    const p = project();
    try {
      assert.equal(p.prep('--apply').code, 0);
      p.git(['add', '-A']); p.git(['commit', '-qm', 'prepared']);
      // Both in force, both over the same preparation and the same content, authorising different
      // PRs. Exactly one satisfies the integration that happened.
      for (const id of order) p.approve(id, { pr: id === 'zz-right-pr' ? 999 : 998 });
      p.merge({ pr: 999 });

      const r = p.confirm('--pr', '999', '--apply', '--json');
      assert.equal(r.code, 0, `${order.join(' then ')}: ${r.err}`);
      const summary = JSON.parse(r.out);
      assert.equal(summary.closed, true);
      assert.equal(summary.receipt.approval_id, 'zz-right-pr', 'the order of files does not decide it');
      assert.equal(p.stateNow(), 'closed');

      // And the other approval is untouched — not deleted, not retired, simply not the one.
      assert.equal(existsSync(join(p.root, '.spectree/approvals/aa-other-pr.json')), true);
    } finally { p.drop(); }
  }
});

test('with no approval that fits the integration, the confirmation refuses', () => {
  const p = project();
  try {
    assert.equal(p.prep('--apply').code, 0);
    p.git(['add', '-A']); p.git(['commit', '-qm', 'prepared']);
    p.approve('aa-other-pr', { pr: 998 });
    p.approve('bb-also-other', { pr: 997 });
    p.merge({ pr: 999 });

    const r = p.confirm('--pr', '999', '--apply', '--json');
    assert.equal(r.code, 1, 'two near misses do not add up to an authorisation');
    const failed = JSON.parse(r.out).steps.filter((s) => !s.ok).map((s) => s.name);
    assert.ok(failed.includes('what landed is what was authorised'), failed.join(', '));
    assert.equal(p.stateNow(), 'integration_approved');
    assert.equal(existsSync(join(p.root, receiptPath('c1'))), false, 'and no receipt was written');
  } finally { p.drop(); }
});

test('a gate with two approvals and no receipt to disambiguate refuses rather than picking', () => {
  const p = project();
  try {
    assert.equal(p.prep('--apply').code, 0);
    p.git(['add', '-A']); p.git(['commit', '-qm', 'prepared']);
    p.approve('aa-other-pr', { pr: 998 });
    p.approve('zz-right-pr', { pr: 999 });
    p.merge({ pr: 999 });
    assert.equal(p.confirm('--pr', '999', '--apply').code, 0);

    // Replayed to the final gate, and the receipt — which names the approval the integration was
    // observed under — is removed. Nothing left says which of the two it was.
    const c = new Store(p.root).change('c1');
    new Store(p.root).putChange({ ...c, state: 'integrated' },
      { expected: c.state_revision, event: { type: 'fixture-replay-final-gate' } });
    const receipt = join(p.root, receiptPath('c1'));
    const kept = readFileSync(receipt, 'utf8');
    rmSync(receipt);

    const r = p.state('can', 'c1', 'closed');
    assert.equal(r.code, 1);
    assert.match(r.err, /E_INTEGRATION_NOT_OBSERVED|E_APPROVAL_AMBIGUOUS/);

    // With the receipt back, the approval it names is the one resolved, and the gate passes.
    writeFileSync(receipt, kept);
    assert.equal(p.state('can', 'c1', 'closed').code, 0);
  } finally { p.drop(); }
});
