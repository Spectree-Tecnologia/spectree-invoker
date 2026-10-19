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
// This file: whole cycles, and a plan or an approval landing while the world moves.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { currentPath, lifecyclePath, readLifecycle, receiptPath, pendingOperation } from '../scripts/lib/change/lifecycle.mjs';
import { now } from './helpers.mjs';
import { project, consolidationRuns } from './sequences-fixture.mjs';

// 1. approve -> the merge alters a task -> refresh refuses -> the stale detour refuses ->
//    the confirmation goes on refusing.
test('the stale detour around a frozen record refuses at every step, and the merge stays refused', () => {
  const p = project();
  try {
    { const r0 = p.prep('--apply'); assert.equal(r0.code, 0, r0.err); }
    p.git(['add', '-A']); p.git(['commit', '-qm', 'closure prepared']);
    p.approve();
    const archive = p.manifest().archive_path;

    // The alteration the confirmation exists to catch: operational, so neither digest moves.
    writeFileSync(join(p.root, `${archive}/tasks.md`), '- [ ] NOT the prepared record\n');
    const direct = p.prep('--apply', '--json');
    assert.equal(direct.code, 1);
    assert.equal(JSON.parse(direct.out).code, 'E_PREP_FROZEN');

    // The four-command detour: move the code so the preparation reads `stale`, re-prepare,
    // put the code back, re-prepare again.
    const original = readFileSync(join(p.root, 'src/app.js'), 'utf8');
    writeFileSync(join(p.root, 'src/app.js'), 'export const x = 2;\n');
    assert.equal(JSON.parse(p.prep('--apply', '--json').out).code, 'E_PREP_FROZEN');
    writeFileSync(join(p.root, 'src/app.js'), original);
    assert.equal(JSON.parse(p.prep('--apply', '--json').out).code, 'E_PREP_FROZEN');

    const before = readFileSync(join(p.root, currentPath('c1')), 'utf8');
    p.git(['add', '-A']); p.git(['commit', '-qm', 'the altered artifact']);
    p.merge();
    const confirmed = p.confirm('--pr', '999', '--apply', '--json');
    assert.equal(confirmed.code, 1, 'the merge carries an artifact nobody approved');
    assert.equal(p.stateNow(), 'integration_approved');
    assert.equal(readFileSync(join(p.root, currentPath('c1')), 'utf8'), before, 'and the record is untouched');
  } finally { p.drop(); }
});

// 2 and 3. reopen -> identical digests -> every gate refuses the old approval; and restoring the
//    old manifest does not restore it either.
test('a reopening survives identical digests and a restored manifest', () => {
  const p = project();
  try {
    { const r0 = p.prep('--apply'); assert.equal(r0.code, 0, r0.err); }
    p.git(['add', '-A']); p.git(['commit', '-qm', 'closure prepared']);
    p.approve();
    const approvedBytes = readFileSync(join(p.root, currentPath('c1')), 'utf8');

    const reopened = p.prep('--apply', '--reopen', '--reason', 'the delta was amended', '--json');
    assert.equal(reopened.code, 0, reopened.err);
    assert.equal(JSON.parse(reopened.out).generation, 2);
    assert.equal(p.stateNow(), 'implemented');

    // Restore the OLD manifest wholesale. Retirement is durable, so nothing comes back.
    writeFileSync(join(p.root, currentPath('c1')), approvedBytes);
    const resumed = JSON.parse(p.state('resume', 'c1', '--json').out);
    assert.deepEqual(resumed.approvals_retired.map((a) => a.approval_id), ['ap-integration']);
    assert.deepEqual(resumed.approvals.map((a) => a.gate), ['scope']);
    assert.equal(resumed.closure.generation, 2);
  } finally { p.drop(); }
});

// 4. prepare on day D, tick a task on D+1, refresh, approve, merge, close.
test('a day passing does not empty the record, and the cycle still closes', () => {
  const p = project();
  try {
    { const r0 = p.prep('--apply'); assert.equal(r0.code, 0, r0.err); }
    const archive = p.manifest().archive_path;
    assert.equal(p.manifest().artifacts.length, 3);
    p.git(['add', '-A']); p.git(['commit', '-qm', 'closure prepared']);

    // Tomorrow: the archive slot's name carries yesterday's date, and the record names it.
    writeFileSync(join(p.root, `${archive}/tasks.md`), '- [x] build it\n');
    const refreshed = p.prepTomorrow('--apply', '--json');
    assert.equal(refreshed.code, 0, refreshed.err);
    assert.equal(JSON.parse(refreshed.out).state, 'refreshed');
    assert.equal(p.manifest().artifacts.length, 3, 'a day passing does not empty the record');
    p.git(['add', '-A']); p.git(['commit', '-qm', 'the last task ticked']);

    p.approve();
    p.merge();
    const r = p.confirm('--pr', '999', '--apply', '--json');
    assert.equal(r.code, 0, r.err);
    assert.equal(p.stateNow(), 'closed');
  } finally { p.drop(); }
});

test('a receipt for another PR does not close this change', () => {
  const p = project();
  try {
    { const r0 = p.prep('--apply'); assert.equal(r0.code, 0, r0.err); }
    p.git(['add', '-A']); p.git(['commit', '-qm', 'closure prepared']);
    p.approve('ap-integration', { pr: 999 });
    p.merge({ pr: 1000 });

    // The approval authorised PR 999. The merge that happened is PR 1000, and its tree matches.
    const r = p.confirm('--pr', '1000', '--apply', '--json');
    assert.equal(r.code, 1, 'a matching tree is not the integration that was authorised');
    const failed = JSON.parse(r.out).steps.filter((s) => !s.ok).map((s) => s.name);
    assert.ok(failed.includes('what landed is what was authorised'), failed.join(', '));
    assert.equal(existsSync(join(p.root, receiptPath('c1'))), false, 'and no receipt was written');
    assert.equal(p.stateNow(), 'integration_approved');
  } finally { p.drop(); }
});

test('a whole cycle leaves one merge commit and no post-merge commit at all', () => {
  const p = project();
  try {
    const beforeCommits = Number(p.git(['rev-list', '--count', 'HEAD']).trim());
    { const r0 = p.prep('--apply'); assert.equal(r0.code, 0, r0.err); }
    p.git(['add', '-A']); p.git(['commit', '-qm', 'closure prepared on the branch']);
    p.approve();
    const { merge } = p.merge();
    assert.equal(p.confirm('--pr', '999', '--apply').code, 0);

    assert.equal(p.git(['rev-parse', 'HEAD']).trim(), merge, 'the merge is the last commit there is');
    const after = Number(p.git(['rev-list', '--count', 'HEAD']).trim());
    // base + the proposal, then the branch commit, then the merge. Nothing recorded the green.
    assert.ok(after - beforeCommits <= 2, `${after - beforeCommits} commits added`);
    const trail = readFileSync(join(p.root, '.spectree/history/c1.jsonl'), 'utf8');
    assert.match(trail, /integration_observed/, 'the observation is an event, not a commit');
    assert.equal(p.git(['status', '--porcelain']).trim(), '');
  } finally { p.drop(); }
});

// --- a plan really applied after the world moved ---------------------------------------------------

test('the plan carries the revision it was computed at, and applying it later is refused', () => {
  const p = project({ counting: true });
  try {
    assert.equal(p.prep('--apply').code, 0);
    p.git(['add', '-A']); p.git(['commit', '-qm', 'closure prepared']);
    p.approve();

    // The plan, taken now, names the control revision behind it.
    const planned = JSON.parse(p.prep('--json').out);
    assert.ok(Number.isInteger(planned.expected_control_revision));
    const ranBefore = consolidationRuns(p);

    // Somebody else reopens in the meantime.
    assert.equal(p.prep('--apply', '--reopen', '--reason', 'a concurrent decision').code, 0);

    // Now APPLY THE OLD PLAN, by its own token. This is the step the earlier test only described.
    const applied = p.prep('--apply', '--expect-control', String(planned.expected_control_revision), '--json');
    assert.equal(applied.code, 1, 'a plan is applied against the world it was computed in');
    const doc = JSON.parse(applied.out);
    assert.equal(doc.code, 'E_CONCURRENT_UPDATE');
    assert.match(doc.message, new RegExp(`expected revision ${planned.expected_control_revision}`));
    assert.equal(consolidationRuns(p), ranBefore + 1,
      'the reopening ran it once; the refused apply ran nothing');
    assert.equal(pendingOperation(readLifecycle(p.root, 'c1').doc), null, 'and left no operation open');

    // Re-deciding against what is there now is the repair, and it works.
    const fresh = JSON.parse(p.prep('--json').out);
    assert.notEqual(fresh.expected_control_revision, planned.expected_control_revision);
  } finally { p.drop(); }
});

// --- the shared boundary, from both sides ----------------------------------------------------------

test('an approval that lands between a refresh\'s decision and its write refuses the refresh', () => {
  const p = project();
  try {
    assert.equal(p.prep('--apply').code, 0);
    p.git(['add', '-A']); p.git(['commit', '-qm', 'closure prepared']);
    const approvedRecord = readFileSync(join(p.root, currentPath('c1')), 'utf8');

    // The refresh has something to do: a task was ticked.
    const archive = p.manifest().archive_path;
    writeFileSync(join(p.root, `${archive}/tasks.md`), '- [x] build it\n');
    const plan = JSON.parse(p.prep('--json').out);
    assert.equal(plan.state, 'refreshed', 'the refresh really is what it would do');

    // The approval lands in between, over the record as it stands.
    p.approve();

    const applied = p.prep('--apply', '--expect-control', String(plan.expected_control_revision), '--json');
    assert.equal(applied.code, 1, 'a decision taken before the approval is not applied after it');
    assert.equal(JSON.parse(applied.out).code, 'E_CONCURRENT_UPDATE');
    assert.equal(readFileSync(join(p.root, currentPath('c1')), 'utf8'), approvedRecord,
      'and the approved record is byte for byte what it was');
  } finally { p.drop(); }
});

test('an approval recorded while an operation is open is refused', () => {
  const p = project({ counting: true });
  try {
    assert.equal(p.prepCrashing('started', '--apply').code, 86);

    // There is no coherent preparation to approve: one is half written, and the operation that
    // would have finished it is still open. Authorising over that is authorising over half of
    // two different states.
    const r = p.approveExpectingFailure();
    assert.equal(r.code, 1, 'an approval is not granted over a half-applied write');
    assert.match(r.err, /E_OPERATION_PENDING|E_PREP/);
    assert.equal(existsSync(join(p.root, '.spectree/approvals/ap-x.json')), false, 'and nothing was stored');
  } finally { p.drop(); }
});

test('an integration approval with no durable record is not authority', () => {
  const p = project();
  try {
    assert.equal(p.prep('--apply').code, 0);
    p.git(['add', '-A']); p.git(['commit', '-qm', 'closure prepared']);
    p.approve();
    p.merge();
    assert.equal(p.confirm('--pr', '999').code, 0, 'the approval is authority to begin with');

    // Remove ONLY the durable entry, leaving the approval document exactly where it is. That is
    // the shape a crash between the two writes would leave, and half an approval is not authority.
    const f = join(p.root, lifecyclePath('c1'));
    const lc = JSON.parse(readFileSync(f, 'utf8'));
    writeFileSync(f, JSON.stringify({ ...lc, approved: [] }, null, 2));

    const r = p.confirm('--pr', '999', '--json');
    assert.equal(r.code, 1, 'half an approval never reads as a whole one');
    assert.match(JSON.stringify(JSON.parse(r.out).impediments), /approval/);
    const resumed = JSON.parse(p.state('resume', 'c1', '--json').out);
    assert.deepEqual(resumed.approvals.map((a) => a.gate), ['scope'], 'and resume does not present it as in force');
    assert.equal(existsSync(join(p.root, '.spectree/approvals/ap-integration.json')), true,
      'the document is untouched — it stopped being authority, not history');
  } finally { p.drop(); }
});
