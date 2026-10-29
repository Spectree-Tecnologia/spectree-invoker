// One change, driven end to end through the INSTALLED commands in a synthetic consumer,
// including a real branch, a real `--no-ff` merge and the archival the protocol asks for.
//
// The unit tests call the functions directly, which is exactly how four defects survived
// them: the machine had grown a requirement the CLI never supplied, the CLI wrote a block it
// could not undo, evidence stayed valid across an uncommitted edit, and an approval could
// carry new content past a QA and a CI that never saw it.
//
// This file: what a contract change, a pass 1 run, a report and a reopening invalidate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { now, lifecycleOf } from './helpers.mjs';
import { Store } from '../scripts/lib/change/store.mjs';
import { consumer, proposal, SCENARIO, TAP, approvalDoc, integrationDoc, upToImplemented, proveIt, prepare } from './cli-cycle-fixture.mjs';

test('adding a Requirement invalidates the QA, and the preparation, that never saw it', () => {
  const c = consumer();
  try {
    upToImplemented(c);
    assert.equal(prepare(c, ['--apply']).code, 0);
    c.git(['add', '-A']); c.git(['commit', '-qm', 'closure prepared']);
    proveIt(c);

    // The code is untouched; the contract grows an acceptance criterion — edited where the
    // contract now lives, which after preparation is the archive.
    const before = c.cli('digest', 'c1', '--gate', 'integration').out;
    const spec = join(c.root, `docs/changes/archive/${new Date().toISOString().slice(0, 10)}-c1/specs/account/spec.md`);
    assert.ok(existsSync(spec), 'the contract is in the archive');
    writeFileSync(spec, ['## ADDED Requirements', '', '### Requirement: x', '', '### Requirement: y', ''].join('\n'));
    c.git(['add', '-A']); c.git(['commit', '-qm', 'one more Requirement']);
    assert.notEqual(c.cli('digest', 'c1', '--gate', 'integration').out, before, 'the candidate is a new one');

    // Approve the new contract properly, so the only things left unproven are the QA and the
    // preparation — both of which were computed from Requirements that no longer exist.
    const rev = c.git(['rev-parse', 'HEAD']).trim();
    c.cli('record-approval', c.doc('ap1b', approvalDoc('ap1b', 'scope', c.cli('digest', 'c1').out, rev)));
    c.cli('record-approval', c.doc('ap2', integrationDoc(c, 'ap2', c.cli('digest', 'c1', '--gate', 'integration').out, rev)));

    const staleQa = c.cli('can', 'c1', 'integration_approved');
    assert.equal(staleQa.code, 1, 'a run cannot speak for Requirements it never saw');
    assert.match(staleQa.err, /E_CONTRACT_CHANGED/);
    assert.match(staleQa.err, /Requirements moved since that run/);

    // Re-running QA is not enough: the closure was consolidated from the old contract too.
    assert.equal(c.run('pass2.attack', { role: 'quality_engineer', independentOf: 'full_stack_developer', id: 'e-qa2' }).code, 0);
    const stalePrep = c.cli('can', 'c1', 'integration_approved');
    assert.equal(stalePrep.code, 1);
    assert.match(stalePrep.err, /E_CLOSURE_NOT_PREPARED/);
    assert.match(stalePrep.err, /E_PREP_STALE/);

    // And re-preparing over it is not a repair any more: an integration approval already names
    // that snapshot, so replacing it is a REOPENING — which keeps the old record, retires the
    // approval, and asks for a new one against the new generation.
    const overwrite = prepare(c, ['--apply']);
    assert.equal(overwrite.code, 1, 'an approved record is not silently replaced');
    assert.match(overwrite.err, /E_PREP_FROZEN/);

    const reopened = prepare(c, ['--apply', '--reopen', '--reason', 'the contract gained a Requirement after approval']);
    assert.equal(reopened.code, 0, reopened.err);
    assert.equal(new Store(c.root).change('c1').state, 'implemented', 'a reopening returns the change to the working point');

    // The retired approval does not come back, however well the digests line up.
    c.git(['add', '-A']); c.git(['commit', '-qm', 'the reopened closure']);
    assert.equal(c.run('pass2.attack', { role: 'quality_engineer', independentOf: 'full_stack_developer', id: 'e-qa3' }).code, 0);
    assert.equal(c.cli('transition', 'c1', 'pass2_complete').code, 0);
    assert.equal(c.run('ci.green', { id: 'e-ci3' }).code, 0);
    assert.equal(c.cli('transition', 'c1', 'ci_green').code, 0);
    const still = c.cli('can', 'c1', 'integration_approved');
    assert.equal(still.code, 1);
    assert.match(still.err, /E_MISSING_APPROVAL|E_APPROVAL/);

    const rev2 = c.git(['rev-parse', 'HEAD']).trim();
    c.cli('record-approval', c.doc('ap4', integrationDoc(c, 'ap4', c.cli('digest', 'c1', '--gate', 'integration').out, rev2)));
    assert.equal(c.cli('can', 'c1', 'integration_approved').code, 0);
  } finally { c.drop(); }
});

test('pass 1 is satisfied only by a named test that ran and failed', () => {
  const c = consumer();
  try {
    upToImplemented(c);
    const ev = (id) => JSON.parse(readFileSync(join(c.root, `.spectree/evidence/${id}.json`), 'utf8'));

    // The semantics belong to the property, so they cannot be switched off by omitting a flag.
    const bare = c.cli('run', 'c1', 'pass1.tests_failing', '--role', 'quality_engineer',
      '--', process.execPath, '-e', 'process.exit(0)');
    assert.equal(bare.code, 2, 'a run with nothing failing is not pass 1');
    assert.match(bare.err, /--expect-failing/);

    // And no other property may be satisfied by a run that failed.
    const wrong = c.cli('run', 'c1', 'ci.green', '--role', 'platform_engineer',
      '--expect-failing', SCENARIO, '--', process.execPath, '-e', 'process.exit(1)');
    assert.equal(wrong.code, 2);
    assert.match(wrong.err, /not available for "ci\.green"/);

    // A syntax error whose diagnostic echoes the Scenario name: nothing ran, and no substring
    // in that output can say otherwise.
    const crashed = c.run('pass1.tests_failing', {
      role: 'quality_engineer', expectFailing: SCENARIO, exit: 1, prints: TAP.crash, id: 'e-crash',
    });
    assert.equal(crashed.code, 1);
    assert.match(crashed.err, /INFRA_ERROR/);
    assert.match(crashed.err, /carries no test plan/);
    assert.equal(ev('e-crash').result, 'INFRA_ERROR');
    assert.equal(ev('e-crash').negative_control.observed_signal, undefined, 'it saw nothing, and does not claim to');

    // A run that started and stopped halfway is not a finished run.
    const cut = c.run('pass1.tests_failing', {
      role: 'quality_engineer', expectFailing: SCENARIO, exit: 1, prints: TAP.truncated, id: 'e-cut',
    });
    assert.equal(cut.code, 1);
    assert.match(cut.err, /planned 3 test\(s\) and reported 1/);

    // A skipped test did not run either.
    const skipped = c.run('pass1.tests_failing', {
      role: 'quality_engineer', expectFailing: SCENARIO, exit: 1, prints: TAP.skipped, id: 'e-skip',
    });
    assert.equal(skipped.code, 1);
    assert.match(skipped.err, /SKIP/);

    // The test ran and passed: that is a real answer, and it is not pass 1's.
    const green = c.run('pass1.tests_failing', {
      role: 'quality_engineer', expectFailing: SCENARIO, exit: 0, prints: TAP.green, id: 'e-green',
    });
    assert.equal(green.code, 1);
    assert.match(green.err, /ran and passed/);
    assert.equal(ev('e-green').result, 'FAIL');
  } finally { c.drop(); }
});

test('a run that rewrites the contract cannot be credited with the Requirements it wrote', () => {
  const c = consumer();
  try {
    upToImplemented(c);
    // The command passes, and while passing it adds a Requirement to the proposal. Binding the
    // evidence to the contract as it reads afterwards would let a run supply its own criteria.
    const script = "require('fs').appendFileSync('docs/changes/c1/specs/account/spec.md','\\n### Requirement: z\\n')";
    const r = c.cli('run', 'c1', 'pass2.attack', '--role', 'quality_engineer',
      '--independent-of', 'full_stack_developer', '--id', 'e-self', '--', process.execPath, '-e', script);
    assert.equal(r.code, 1);
    assert.match(r.err, /INCONCLUSIVE/);
    assert.match(r.err, /CONTRACT moved during the run/);

    const stored = JSON.parse(readFileSync(join(c.root, '.spectree/evidence/e-self.json'), 'utf8'));
    assert.equal(stored.result, 'INCONCLUSIVE');
    assert.notEqual(stored.contract_digest, c.cli('digest', 'c1').out, 'it records the contract it started from, not the one it created');

    // And it satisfies nothing, even once that new contract is approved.
    c.git(['add', '-A']); c.git(['commit', '-qm', 'the run rewrote the spec']);
    const rev = c.git(['rev-parse', 'HEAD']).trim();
    c.cli('record-approval', c.doc('ap1b', approvalDoc('ap1b', 'scope', c.cli('digest', 'c1').out, rev)));
    const gate = c.cli('can', 'c1', 'pass2_complete');
    assert.equal(gate.code, 1);
    assert.match(gate.err, /E_EVIDENCE_NOT_PASS|E_CONTRACT_CHANGED|E_CONTENT_CHANGED/);
  } finally { c.drop(); }
});

test('the runner executes the launcher this platform actually has', (t) => {
  let hasNpm = true;
  try { execFileSync('npm', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' }); }
  catch { hasNpm = false; }
  if (!hasNpm) return t.skip('npm is not on PATH in this environment');

  const c = consumer();
  try {
    c.cli('init', 'proj');
    c.cli('open', 'c1', '--modules', 'account', '--scope', 'the account module', '--paths', 'modules/account', '--closure-mode', 'legacy');
    // On Windows `npm` is `npm.cmd`, which Node refuses to spawn without a shell. Reading that
    // as INFRA_ERROR is true and useless: the command works in the operator's own terminal.
    writeFileSync(join(c.root, 'package.json'),
      JSON.stringify({ name: 'consumer', private: true, scripts: { test: 'node --version' } }, null, 2));
    const r = c.cli('run', 'c1', 'ci.green', '--role', 'platform_engineer', '--id', 'e-npm', '--', 'npm', 'test', '--silent');
    assert.equal(r.code, 0, r.err);
    const stored = JSON.parse(readFileSync(join(c.root, '.spectree/evidence/e-npm.json'), 'utf8'));
    assert.equal(stored.result, 'PASS');
    assert.equal(stored.exit_code, 0);
    assert.match(stored.check, /npm test --silent/);
  } finally { c.drop(); }
});

test('a report is read only when this run wrote it', () => {
  const c = consumer();
  try {
    upToImplemented(c);
    const ev = (id) => JSON.parse(readFileSync(join(c.root, `.spectree/evidence/${id}.json`), 'utf8'));
    const write = (tap) => `require('fs').writeFileSync(process.argv[1], ${JSON.stringify(`${tap}\n`)});process.exit(1)`;

    // A report from an earlier, genuinely red run, sitting where anyone can point at it.
    const stale = join(c.root, 'earlier.tap');
    writeFileSync(stale, `${TAP.red}\n`);

    // The flag takes no path at all, so it cannot be aimed at that file.
    const aimed = c.cli('run', 'c1', 'pass1.tests_failing', '--role', 'quality_engineer',
      '--expect-failing', SCENARIO, '--report', stale, '--', process.execPath, '-e', 'process.exit(1)');
    assert.equal(aimed.code, 2);
    assert.match(aimed.err, /--report takes no path/);

    // And a run that writes nothing has produced no results, whatever else is on disk.
    const silent = c.cli('run', 'c1', 'pass1.tests_failing', '--role', 'quality_engineer', '--id', 'e-silent',
      '--expect-failing', SCENARIO, '--report', '--', process.execPath, '-e',
      "throw new Error('MODULE_NOT_FOUND')", '{report}');
    assert.equal(silent.code, 1);
    assert.match(silent.err, /INFRA_ERROR/);
    assert.match(silent.err, /wrote no report/);
    assert.equal(ev('e-silent').result, 'INFRA_ERROR');

    // --report without the token would leave the destination to chance.
    const noToken = c.cli('run', 'c1', 'pass1.tests_failing', '--role', 'quality_engineer',
      '--expect-failing', SCENARIO, '--report', '--', process.execPath, '-e', 'process.exit(1)');
    assert.equal(noToken.code, 2);
    assert.match(noToken.err, /needs \{report\}/);

    // Written by this run, at the path this run chose: that is a report.
    const good = c.cli('run', 'c1', 'pass1.tests_failing', '--role', 'quality_engineer', '--id', 'e-report',
      '--expect-failing', SCENARIO, '--report', '--', process.execPath, '-e', write(TAP.red), '{report}');
    assert.equal(good.code, 0, good.err);
    assert.equal(ev('e-report').result, 'PASS');

    // A report this run really did write, whose subtest is complete and whose run never closed.
    const cutOff = c.cli('run', 'c1', 'pass1.tests_failing', '--role', 'quality_engineer', '--id', 'e-cut-root',
      '--expect-failing', SCENARIO, '--report', '--', process.execPath, '-e', write(TAP.truncatedRoot), '{report}');
    assert.equal(cutOff.code, 1, 'a complete subtest is not a complete run');
    assert.match(cutOff.err, /INFRA_ERROR/);
    assert.equal(ev('e-cut-root').result, 'INFRA_ERROR');

    // Writing the report never counts as changing the content being measured.
    assert.equal(ev('e-report').fingerprint, ev('e-silent').fingerprint);
  } finally { c.drop(); }
});

test('a reopening retires the approval on every path that reads one, not just in the confirmation', () => {
  const c = consumer();
  try {
    upToImplemented(c);
    assert.equal(prepare(c, ['--apply']).code, 0);
    c.git(['add', '-A']); c.git(['commit', '-qm', 'closure prepared on the branch']);
    proveIt(c);
    const candidate = c.git(['rev-parse', 'HEAD']).trim();
    const integration = c.cli('digest', 'c1', '--gate', 'integration');
    c.cli('record-approval', c.doc('ap2', integrationDoc(c, 'ap2', integration.out, candidate, { headSha: candidate })));
    assert.equal(c.cli('transition', 'c1', 'integration_approved').code, 0);
    const approvedBytes = readFileSync(join(c.root, '.spectree/closure/c1.json'), 'utf8');
    const approvedRecord = JSON.parse(approvedBytes);

    // Reopened deliberately: the record is kept, the approval that covered it is retired.
    const reopened = prepare(c, ['--apply', '--reopen', '--reason', 'the delta was amended after approval']);
    assert.equal(reopened.code, 0, reopened.err);
    const kept = readdirSync(join(c.root, '.spectree/closure/c1')).filter((n) => n.endsWith('.approved.json'));
    assert.equal(kept.length, 1, 'the approved record is preserved, not overwritten');
    // Byte for byte. A re-serialised document preserves the meaning and loses the document, and
    // what a retired approval was granted over is the document.
    assert.equal(readFileSync(join(c.root, '.spectree/closure/c1', kept[0]), 'utf8'), approvedBytes);
    assert.deepEqual(JSON.parse(readFileSync(join(c.root, '.spectree/closure/c1.json'), 'utf8')).supersedes_approval, ['ap2']);
    // And the durable control says so too, so restoring the old manifest restores nothing.
    assert.deepEqual(lifecycleOf(c.root, 'c1').retired_approvals.map((r) => r.approval_id), ['ap2']);
    assert.equal(lifecycleOf(c.root, 'c1').generation, 2);

    // The merge happens anyway. Without a new approval NOTHING may advance — and the defect was
    // exactly this: the confirmation after the merge refused, while `transition` walked the same
    // change to `integrated` on the strength of the approval the reopening had retired.
    // The reopening consolidated the same delta over the same content, so there is nothing to
    // commit — and that is the sharp case: identical digests, so the retired approval would
    // still match the gate exactly. Only the retirement stands between it and `integrated`.
    c.git(['checkout', '-q', 'main']);
    c.git(['merge', '--no-ff', '-q', '-m', 'merge change/c1', 'change/c1']);

    const stateBefore = readFileSync(join(c.root, '.spectree/changes/c1.json'), 'utf8');
    const trailBefore = readFileSync(join(c.root, '.spectree/history/c1.jsonl'), 'utf8');

    // The reopening put the change back at the working point, so `integrated` is not even a
    // step away any more — and it says so rather than reporting something about approvals.
    const can = c.cli('can', 'c1', 'integrated');
    assert.equal(can.code, 1, 'a retired approval is history, not authority');
    assert.match(can.err, /E_ILLEGAL_TRANSITION/);
    const moved = c.cli('transition', 'c1', 'integrated');
    assert.equal(moved.code, 1, 'and the transition refuses for the same reason `can` did');
    assert.equal(readFileSync(join(c.root, '.spectree/changes/c1.json'), 'utf8'), stateBefore, 'the state did not move');
    assert.equal(readFileSync(join(c.root, '.spectree/history/c1.jsonl'), 'utf8'), trailBefore, 'and no transition was recorded');

    // Resume separates the two rather than listing them side by side.
    const resumed = JSON.parse(c.cli('resume', 'c1', '--json').out);
    assert.deepEqual(resumed.approvals.map((a) => a.gate), ['scope'], 'only what is in force');
    assert.deepEqual(resumed.approvals_retired.map((a) => a.approval_id), ['ap2'], 'the retired one is still visible as history');
    assert.equal(resumed.closure.generation, 2);
    assert.match(c.cli('resume', 'c1').out, /retired.*ap2/);

    // Walk it back up. Every gate along the way passes on evidence that is genuinely current —
    // the content never moved — and the one thing that does NOT come back is the authority.
    c.git(['checkout', '-q', 'change/c1']);
    assert.equal(c.run('pass2.attack', { role: 'quality_engineer', independentOf: 'full_stack_developer', id: 'e-qa2' }).code, 0);
    assert.equal(c.cli('transition', 'c1', 'pass2_complete').code, 0);
    assert.equal(c.run('ci.green', { id: 'e-ci2' }).code, 0);
    assert.equal(c.cli('transition', 'c1', 'ci_green').code, 0);

    // Identical digests to the ones `ap2` names, and it still authorises nothing.
    assert.equal(c.cli('digest', 'c1', '--gate', 'integration').out, integration.out,
      'the content really did come back to what the retired approval named');
    const stillRefused = c.cli('can', 'c1', 'integration_approved');
    assert.equal(stillRefused.code, 1, 'matching digests do not resurrect a retired approval');
    assert.match(stillRefused.err, /E_MISSING_APPROVAL|E_APPROVAL/);

    // A NEW approval, over the record that actually exists now, releases it.
    const again = c.cli('digest', 'c1', '--gate', 'integration');
    const head = c.git(['rev-parse', 'HEAD']).trim();
    c.cli('record-approval', c.doc('ap3', integrationDoc(c, 'ap3', again.out, head, { headSha: head })));
    assert.equal(c.cli('transition', 'c1', 'integration_approved').code, 0);

    c.git(['checkout', '-q', 'main']);
    const merge = c.git(['rev-parse', 'HEAD']).trim();
    c.merged({ head, merge });
    assert.equal(c.confirm('--pr', '999', '--apply').code, 0);
    assert.equal(new Store(c.root).change('c1').state, 'closed');

    // And the old approvals are still in the store: retired, never deleted.
    assert.deepEqual(
      readdirSync(join(c.root, '.spectree/approvals')).sort(), ['ap1.json', 'ap2.json', 'ap3.json']);
  } finally { c.drop(); }
});
