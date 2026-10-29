// One change, driven end to end through the INSTALLED commands in a synthetic consumer,
// including a real branch, a real `--no-ff` merge and the archival the protocol asks for.
//
// The unit tests call the functions directly, which is exactly how four defects survived
// them: the machine had grown a requirement the CLI never supplied, the CLI wrote a block it
// could not undo, evidence stayed valid across an uncommitted edit, and an approval could
// carry new content past a QA and a CI that never saw it.
//
// This file: gates, evidence against content, and the one-PR closure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { now, preparationOf } from './helpers.mjs';
import { Store } from '../scripts/lib/change/store.mjs';
import { consumer, proposal, contractOnDisk, approvalDoc, integrationDoc, upToImplemented, proveIt, prepare } from './cli-cycle-fixture.mjs';

test('a gate is bound to the contract, and progress notes are not the contract', () => {
  const c = consumer();
  try {
    assert.equal(c.cli('init', 'proj').code, 0);
    assert.equal(c.cli('open', 'c1', '--modules', 'account', '--scope', 'the account module', '--paths', 'modules/account', '--closure-mode', 'legacy').code, 0);
    contractOnDisk(c);

    // The CLI computes the digest from the artifact on disk. Nothing here reads an approval.
    const d = c.cli('digest', 'c1');
    assert.equal(d.code, 0);
    assert.match(d.out, /^sha256:[0-9a-f]{64}$/);
    assert.match(d.err, /proposal\.md/, 'it names the contractual files it digested');
    assert.doesNotMatch(d.err, /tasks\.md/, 'and tasks.md is not one of them');

    assert.equal(c.cli('transition', 'c1', 'proposed').code, 0);

    const noApproval = c.cli('can', 'c1', 'scope_approved');
    assert.equal(noApproval.code, 1);
    assert.match(noApproval.err, /E_MISSING_APPROVAL/);

    assert.equal(c.cli('record-approval', c.doc('ap1', approvalDoc('ap1', 'scope', d.out, c.base))).code, 0);
    assert.equal(c.cli('can', 'c1', 'scope_approved').code, 0);
    assert.equal(c.cli('transition', 'c1', 'scope_approved').code, 0);

    // Ticking a checkbox is progress, not scope. It must not revoke anything.
    contractOnDisk(c, 'one module, four Requirements', true);
    assert.equal(c.cli('digest', 'c1').out, d.out, 'the contract digest is unmoved by tasks.md');
    assert.match(c.cli('can', 'c1', 'isolated').err, /E_MISSING_EVIDENCE/, 'the approval still stands');

    // Editing the proposal is a change of scope, and it does revoke.
    contractOnDisk(c, 'one module, and also a second one', true);
    const drifted = c.cli('can', 'c1', 'isolated');
    assert.equal(drifted.code, 1);
    assert.match(drifted.err, /E_APPROVAL_DIGEST_MISMATCH/);
    assert.match(drifted.err, /current contract: docs\/changes\/c1/, 'the refusal is actionable');

    // Put it back and the same approval is good again: the binding is to content, not to a moment.
    contractOnDisk(c, 'one module, four Requirements', true);
    assert.match(c.cli('can', 'c1', 'isolated').err, /E_MISSING_EVIDENCE/, 'only the evidence is missing now');
  } finally { c.drop(); }
});

test('the CLI blocks a change and can bring it back, without hand-editing JSON', () => {
  const c = consumer();
  try {
    c.cli('init', 'proj');
    c.cli('open', 'c1', '--modules', 'account', '--scope', 'the account module', '--paths', 'modules/account', '--closure-mode', 'legacy');
    c.cli('transition', 'c1', 'proposed');

    const noReason = c.cli('transition', 'c1', 'blocked');
    assert.equal(noReason.code, 2, 'a block with no stated cause is refused');
    assert.match(noReason.err, /--reason/);

    assert.equal(c.cli('transition', 'c1', 'blocked', '--reason', 'the PSP webhook contract is unknown').code, 0);

    const r = c.cli('resume', 'c1');
    assert.match(r.out, /\[blocked\]/);
    assert.match(r.out, /recover to proposed/, 'resume says where recovery goes');

    const jump = c.cli('can', 'c1', 'scope_approved');
    assert.equal(jump.code, 1);
    assert.match(jump.err, /E_BLOCKED_RECOVERY/, 'a block is not a shortcut past the next gate');

    assert.equal(c.cli('transition', 'c1', 'proposed').code, 0, 'recovery goes back to where the block happened');
    const back = c.cli('resume', 'c1');
    assert.match(back.out, /\[proposed\]/);
    assert.doesNotMatch(back.out, /^change\s+c1\s+\[blocked\]|^blocked\s+|recover to proposed/m,
      'the state block and its recovery instruction are cleared');

    const stored = JSON.parse(readFileSync(join(c.root, '.spectree/changes/c1.json'), 'utf8'));
    assert.equal(stored.blocked_from, undefined);
    assert.equal(stored.blocked_reason, undefined);
    const resumed = c.cli('resume', 'c1', '--json');
    assert.equal(resumed.code, 0);
    assert.equal(JSON.parse(resumed.out).recommendation.action, 'request_approval',
      'a missing scope approval is a prerequisite, not a resurrected state block');
  } finally { c.drop(); }
});

test('an uncommitted edit invalidates the evidence: the revision is not the content', () => {
  const c = consumer();
  try {
    upToImplemented(c);
    assert.equal(prepare(c, ['--apply']).code, 0, 'pass 2 attacks the prepared candidate');
    const rev = c.git(['rev-parse', 'HEAD']).trim();
    assert.equal(c.run('pass2.attack', { role: 'quality_engineer', independentOf: 'full_stack_developer' }).code, 0);
    assert.equal(c.cli('can', 'c1', 'pass2_complete').code, 0, 'the run measured the content on disk');

    // Change the code and commit nothing. HEAD is where it was; the proposal is untouched.
    writeFileSync(join(c.root, 'modules/account/account.js'), 'export const name = (s) => s;\n');
    assert.equal(c.git(['rev-parse', 'HEAD']).trim(), rev, 'the revision really did not move');

    const r = c.cli('can', 'c1', 'pass2_complete');
    assert.equal(r.code, 1, 'the same command must not keep allowing it');
    assert.match(r.err, /E_CONTENT_CHANGED/);
    assert.match(r.err, /uncommitted change is still a change/);

    // And resume must not go on presenting that run as valid here.
    const resumed = JSON.parse(c.cli('resume', 'c1', '--json').out);
    assert.deepEqual(resumed.evidence_valid_here.filter((e) => e.property === 'pass2.attack'), []);
    assert.match(resumed.evidence_stale.find((e) => e.property === 'pass2.attack').why, /other content/);

    // Put the code back and the same evidence is valid again — it is bound to content.
    writeFileSync(join(c.root, 'modules/account/account.js'), 'export const name = (s) => s.trim();\n');
    assert.equal(c.cli('can', 'c1', 'pass2_complete').code, 0);

    // Ticking a task is not code, and does not revoke a run either.
    contractOnDisk(c, 'one module, four Requirements', true);
    assert.equal(c.cli('can', 'c1', 'pass2_complete').code, 0, 'progress notes are outside the content digest');
  } finally { c.drop(); }
});

test('recording a document later cannot claim today\'s content for yesterday\'s run', () => {
  const c = consumer();
  try {
    upToImplemented(c);
    // A synthetic result about the content as it was, written by hand. `record-evidence` does
    // not stamp a fingerprint, so it cannot be laundered into evidence about the content now.
    const f = c.doc('e-old', {
      evidence_id: 'e-old', change_id: 'c1', property: 'pass2.attack', check: 'synthetic, from earlier',
      executor: { role: 'quality_engineer', independent_of: ['full_stack_developer'] },
      source_kind: 'observed_execution', revision: c.git(['rev-parse', 'HEAD']).trim(),
      result: 'PASS', timestamp: now(),
    });
    const rec = c.cli('record-evidence', f);
    assert.equal(rec.code, 0, 'recording it is allowed; counting it is not');
    assert.match(rec.err, /imported, not observed here/, 'and the command says so at the moment it is written');

    const r = c.cli('can', 'c1', 'pass2_complete');
    assert.equal(r.code, 1);
    assert.match(r.err, /records no fingerprint at all/);
    assert.equal(JSON.parse(readFileSync(join(c.root, '.spectree/evidence/e-old.json'), 'utf8')).fingerprint, undefined);

    // And filling the field in by hand is not a way around it. The document would then be
    // claiming an observation, and the command that imports it never made one.
    const withDigest = c.doc('e-forged', {
      evidence_id: 'e-forged', change_id: 'c1', property: 'pass2.attack', check: 'synthetic',
      executor: { role: 'quality_engineer', independent_of: ['full_stack_developer'] },
      source_kind: 'observed_execution', revision: c.git(['rev-parse', 'HEAD']).trim(),
      fingerprint: c.cli('digest', 'c1', '--gate', 'integration').out,
      result: 'PASS', timestamp: now(),
    });
    const forged = c.cli('record-evidence', withDigest);
    assert.equal(forged.code, 1, 'an imported document cannot carry a content binding');
    assert.match(forged.err, /written by `state\.mjs run`/);
    assert.equal(existsSync(join(c.root, '.spectree/evidence/e-forged.json')), false, 'and nothing was stored');
  } finally { c.drop(); }
});

test('a run that changes what it is measuring is INCONCLUSIVE, not a pass', () => {
  const c = consumer();
  try {
    upToImplemented(c);
    const r = c.cli('run', 'c1', 'ci.green', '--role', 'platform_engineer', '--',
      process.execPath, '-e', "require('fs').writeFileSync('modules/account/extra.js','export const x=1;\\n')");
    assert.equal(r.code, 1);
    assert.match(r.err, /INCONCLUSIVE/);
    assert.match(r.err, /content moved DURING the run/);
  } finally { c.drop(); }
});

test('an approval cannot carry new content past a QA and a CI that never saw it', () => {
  const c = consumer();
  try {
    const { contract } = upToImplemented(c);
    // An integration approval names the preparation it authorises, so there has to be one.
    assert.equal(prepare(c, ['--apply']).code, 0);
    c.git(['add', '-A']); c.git(['commit', '-qm', 'closure prepared']);
    proveIt(c);

    const proven = c.cli('digest', 'c1', '--gate', 'integration').out;

    // The reviewed content is proven. Now change the code and approve THAT, with no new runs.
    writeFileSync(join(c.root, 'modules/account/account.js'), 'export const name = (s) => s;\n');
    const unproven = c.cli('digest', 'c1', '--gate', 'integration').out;
    assert.notEqual(unproven, proven, 'the candidate really is a different one');
    c.cli('record-approval', c.doc('ap2', integrationDoc(c, 'ap2', unproven, c.git(['rev-parse', 'HEAD']).trim())));

    const r = c.cli('can', 'c1', 'integration_approved');
    assert.equal(r.code, 1, 'a signature is authorisation, never validation');
    assert.match(r.err, /E_CONTENT_CHANGED/);
    assert.match(r.err, /pass2\.attack|ci\.green/);

    // Going back to the proven code does not rescue that approval: it named the other one.
    writeFileSync(join(c.root, 'modules/account/account.js'), 'export const name = (s) => s.trim();\n');
    assert.equal(c.cli('digest', 'c1', '--gate', 'integration').out, proven);
    const back = c.cli('can', 'c1', 'integration_approved');
    assert.equal(back.code, 1);
    assert.match(back.err, /E_APPROVAL_DIGEST_MISMATCH/);
    assert.ok(contract);
  } finally { c.drop(); }
});

test('one PR: the closure is prepared on the branch, and the merge is the only integration', () => {
  const c = consumer();
  try {
    upToImplemented(c);

    // The closure is prepared BEFORE the final validation, so what QA and CI look at is the
    // candidate that will be integrated — specs consolidated, folder archived, one manifest.
    const dry = prepare(c);
    assert.equal(dry.code, 0, dry.err);
    assert.match(dry.out, /DRY RUN/);
    assert.equal(existsSync(join(c.root, '.spectree/closure/c1.json')), false, 'a dry run writes nothing');

    const prepared = prepare(c, ['--apply']);
    assert.equal(prepared.code, 0, prepared.err);
    const manifest = JSON.parse(readFileSync(join(c.root, '.spectree/closure/c1.json'), 'utf8'));
    assert.equal(manifest.change_id, 'c1');
    assert.deepEqual(manifest.blocking, []);
    assert.ok(manifest.artifacts.length, 'the archived contract is recorded as an artifact');
    assert.ok(existsSync(join(c.root, 'docs/specs/account/spec.md')), "the consumer's own command consolidated the delta");
    assert.equal(existsSync(join(c.root, 'docs/changes/c1')), false, 'the change folder moved into the archive');

    // Preparing is not declaring. The change is still `implemented`, and nothing above wrote
    // `integrated` or `closed` — that is the merge's job and only the merge's.
    assert.equal(JSON.parse(readFileSync(join(c.root, '.spectree/changes/c1.json'), 'utf8')).state, 'implemented');

    c.git(['add', '-A']); c.git(['commit', '-qm', 'closure prepared on the branch']);
    proveIt(c);
    const candidate = c.git(['rev-parse', 'HEAD']).trim();

    const integration = c.cli('digest', 'c1', '--gate', 'integration');
    assert.notEqual(integration.out, c.cli('digest', 'c1').out, 'integration is not bound to the documents alone');

    const missing = c.cli('can', 'c1', 'integration_approved');
    assert.equal(missing.code, 1);
    assert.match(missing.err, /E_MISSING_APPROVAL/);

    // Ticking the last task before the approval is progress, and the record catches up without
    // re-consolidating anything.
    const archived = preparationOf(c.root, 'c1').archive_path;
    writeFileSync(join(c.root, `${archived}/tasks.md`), '- [x] build the account module\n');
    const refreshed = prepare(c, ['--apply']);
    assert.equal(refreshed.code, 0, refreshed.err);
    assert.match(refreshed.out, /refreshed/);
    c.git(['add', '-A']); c.git(['commit', '-qm', 'the last task ticked']);

    const candidate2 = c.git(['rev-parse', 'HEAD']).trim();
    const gate = c.cli('digest', 'c1', '--gate', 'integration');
    const rec = c.cli('record-approval', c.doc('ap2', integrationDoc(c, 'ap2', gate.out, candidate2, { headSha: candidate2 })));
    assert.equal(rec.code, 0, rec.err);
    const t = c.cli('transition', 'c1', 'integration_approved');
    assert.equal(t.code, 0, t.err);

    // ONE merge. `--no-ff` writes a new commit over an identical tree: the candidate that was
    // reviewed is the candidate being integrated, and the digest says so.
    c.git(['checkout', '-q', 'main']);
    c.git(['merge', '--no-ff', '-q', '-m', 'merge change/c1', 'change/c1']);
    const merge = c.git(['rev-parse', 'HEAD']).trim();
    assert.notEqual(merge, candidate2, 'the revision moved');

    // `integrated` is OBSERVED, never asserted: a transition on its own cannot reach it.
    const asserted = c.cli('transition', 'c1', 'integrated');
    assert.equal(asserted.code, 1, 'a transition does not observe a merge');
    assert.match(asserted.err, /E_INTEGRATION_NOT_OBSERVED/);

    c.merged({ head: candidate2, merge });
    const planned = c.confirm('--pr', '999');
    assert.equal(planned.code, 0, planned.err);
    assert.equal(new Store(c.root).change('c1').state, 'integration_approved', 'a plan writes nothing');

    const confirmed = c.confirm('--pr', '999', '--apply');
    assert.equal(confirmed.code, 0, confirmed.err);

    // The point of the whole exercise: closing added no commit. The old flow ended with one
    // that said the previous run had been green, and that commit started another run.
    assert.equal(c.git(['rev-parse', 'HEAD']).trim(), merge, 'no commit was made after the merge');
    assert.equal(c.git(['status', '--porcelain']).trim(), '', 'and nothing is left uncommitted either');

    const done = c.cli('resume');
    assert.match(done.out, /change\s+none open/, 'a closed change is no longer open work');
    const history = readFileSync(join(c.root, '.spectree/history/c1.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(history.some((h) => h.type === 'integration_observed'), 'the observation is in the trail');
    assert.deepEqual(history.map((h) => h.to).filter(Boolean), [
      'proposed', 'scope_approved', 'isolated', 'baselined', 'pass1_complete',
      'implemented', 'pass2_complete', 'ci_green', 'integration_approved', 'integrated', 'closed',
    ], 'every step is in the append-only record, in order');
    assert.ok(history.some((h) => h.type === 'closure_prepared'), 'and the preparation is an event, not a commit');
  } finally { c.drop(); }
});

test('the preparation is idempotent, and a moved folder is not proof it was valid', () => {
  const c = consumer();
  try {
    upToImplemented(c);
    assert.equal(prepare(c, ['--apply']).code, 0);
    const first = readFileSync(join(c.root, '.spectree/closure/c1.json'), 'utf8');

    const again = prepare(c, ['--apply']);
    assert.equal(again.code, 0);
    assert.match(again.out, /unchanged/);
    assert.equal(readFileSync(join(c.root, '.spectree/closure/c1.json'), 'utf8'), first, 'the manifest is not rewritten');

    // The folder is archived and the manifest describes another candidate: "already archived"
    // is a move that happened, not a preparation that is valid for what is here now.
    writeFileSync(join(c.root, 'modules/account/account.js'), 'export const name = (s) => s;\n');
    const stale = prepare(c);
    assert.equal(stale.code, 1);
    assert.match(stale.err, /E_PREP_STALE/);
    assert.match(stale.err, /candidate moved/);

    const gate = c.cli('can', 'c1', 'integration_approved');
    assert.equal(gate.code, 1, 'and the gate refuses on the same grounds');
  } finally { c.drop(); }
});

test('a consumer with no consolidation mechanism is told, not improvised for', () => {
  const c = consumer();
  try {
    // Initialised WITHOUT --consolidate: there is no mechanism this squad may use, and editing
    // docs/specs/ by hand is not the fallback.
    c.cli('init', 'proj');
    const refusedOpen = c.cli('open', 'c1', '--modules', 'account', '--scope', 'the account module', '--paths', 'modules/account,docs');
    assert.equal(refusedOpen.code, 1);
    assert.match(refusedOpen.err, /E_CLOSURE_SELECTION/);
    assert.equal(existsSync(join(c.root, '.spectree/changes/c1.json')), false);
    assert.equal(c.cli('open', 'c1', '--modules', 'account', '--scope', 'the account module', '--paths', 'modules/account,docs', '--closure-mode', 'legacy').code, 0);
    contractOnDisk(c);
    c.git(['add', '-A']); c.git(['commit', '-qm', 'the proposal']);

    const refused = prepare(c, ['--apply']);
    assert.equal(refused.code, 1);
    assert.match(refused.err, /E_NO_CONSOLIDATION/);
    assert.match(refused.err, /Hand-editing docs\/specs\/ is not the fallback/);
    assert.equal(existsSync(join(c.root, 'docs/specs')), false, 'and it wrote no spec');
    assert.equal(existsSync(join(c.root, 'docs/changes/c1')), true, 'and archived nothing');

    // The legacy flow is available, and it is a statement rather than a silent fallback.
    const legacy = prepare(c, ['--legacy']);
    assert.equal(legacy.code, 0);
    assert.match(legacy.err, /closes the legacy way/);
    assert.equal(existsSync(join(c.root, '.spectree/closure/c1.json')), false, 'legacy prepares nothing');
  } finally { c.drop(); }
});

test('a merge that changes the tree is a different candidate, and is refused', () => {
  const c = consumer();
  try {
    upToImplemented(c);
    assert.equal(prepare(c, ['--apply']).code, 0);
    c.git(['add', '-A']); c.git(['commit', '-qm', 'closure prepared']);
    proveIt(c);
    const candidate = c.git(['rev-parse', 'HEAD']).trim();
    const integration = c.cli('digest', 'c1', '--gate', 'integration').out;
    c.cli('record-approval', c.doc('ap2', integrationDoc(c, 'ap2', integration, candidate, { headSha: candidate })));
    assert.equal(c.cli('transition', 'c1', 'integration_approved').code, 0);

    // A merge that resolves into something else — the tree is not the reviewed tree.
    c.git(['checkout', '-q', 'main']);
    c.git(['merge', '--no-ff', '-q', '-m', 'merge change/c1', 'change/c1']);
    writeFileSync(join(c.root, 'modules/account/account.js'), 'export const name = (s) => s.toLowerCase();\n');
    c.git(['add', '-A']); c.git(['commit', '-qm', 'a fixup during the merge']);

    const r = c.cli('can', 'c1', 'integrated');
    assert.equal(r.code, 1);
    assert.match(r.err, /E_APPROVAL_DIGEST_MISMATCH|E_CONTENT_CHANGED/,
      'what was integrated is not what was approved and proven');
  } finally { c.drop(); }
});

test('a change opens only naming its modules or declaring itself deltaless', () => {
  const c = consumer();
  try {
    c.cli('init', 'proj', '--', process.execPath, '-e', '0');
    for (const extra of [[], ['--modules', ' , ']]) {
      const refused = c.cli('open', 'c1', ...extra, '--scope', 'the account module', '--paths', 'modules/account', '--closure-mode', 'legacy');
      assert.equal(refused.code, 1); assert.match(refused.err, /E_MODULES_UNNAMED/);
      assert.equal(existsSync(join(c.root, '.spectree/changes/c1.json')), false);
    }
    assert.equal(c.cli('open', 'c1', '--deltaless', '--scope', 'a refactor', '--paths', 'modules/account', '--closure-mode', 'legacy').code, 0);
  } finally { c.drop(); }
});
