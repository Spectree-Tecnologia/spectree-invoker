// One change, driven end to end through the INSTALLED commands in a synthetic consumer.
//
// The unit tests call the functions directly, which is exactly how three defects survived
// them: the machine had grown a requirement the CLI never supplied, the CLI wrote a block
// it could not undo, and evidence stayed valid across an uncommitted edit. A cycle that
// only goes through the commands catches that class.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitRepo, tempDir, cleanup, REPO, now } from './helpers.mjs';

/** A consumer project with the squad installed, exactly as a user would have it. */
function consumer() {
  const repo = gitRepo({ 'seed.txt': 'seed\n' });
  execFileSync(process.execPath, [join(REPO, 'scripts', 'install-codex.mjs'), repo.root, '--apply'], { encoding: 'utf8' });
  const state = join(repo.root, '.spectree/squad/scripts/state.mjs');
  // Input documents live OUTSIDE the project: a scratch file dropped in the work tree would
  // change the very content digest the commands are about to compute.
  const scratch = tempDir('spectree-scratch-');
  // spawnSync, not execFileSync: the refusals are on stderr and every one of them is asserted.
  const cli = (...args) => {
    const r = spawnSync(process.execPath, [state, ...args], { cwd: repo.root, encoding: 'utf8' });
    return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
  };
  const doc = (name, body) => {
    const f = join(scratch, `${name}.json`);
    writeFileSync(f, JSON.stringify(body));
    return f;
  };
  const drop = () => { cleanup(repo.root); cleanup(scratch); };
  return { ...repo, cli, doc, drop };
}

const proposal = (text) => `# proposal\n\n${text}\n`;

/** The two artifacts a change carries: the contract, and the progress note beside it. */
function contractOnDisk(c, text = 'one module, four Requirements', done = false) {
  mkdirSync(join(c.root, 'docs/changes/c1/specs/account'), { recursive: true });
  writeFileSync(join(c.root, 'docs/changes/c1/proposal.md'), proposal(text));
  writeFileSync(join(c.root, 'docs/changes/c1/specs/account/spec.md'), '## ADDED Requirements\n\n### Requirement: x\n');
  writeFileSync(join(c.root, 'docs/changes/c1/tasks.md'), `- [${done ? 'x' : ' '}] build the account module\n`);
}

const evidence = (id, property, extra = {}) => ({
  evidence_id: id, change_id: 'c1', property, check: `synthetic: ${property}`,
  executor: { role: 'platform_engineer' }, source_kind: 'observed_execution',
  result: 'PASS', timestamp: now(), ...extra,
});

const approvalDoc = (id, gate, digest, revision, extra = {}) => ({
  approval_id: id, change_id: 'c1', gate,
  granted_by: { identity: 'founder', kind: 'human_in_session' },
  channel: 'session', scope_digest: digest, revision, timestamp: now(), ...extra,
});

test('a gate is bound to the contract, and progress notes are not the contract', () => {
  const c = consumer();
  try {
    assert.equal(c.cli('init', 'proj').code, 0);
    assert.equal(c.cli('open', 'c1', '--scope', 'the account module', '--paths', 'modules/account').code, 0);
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

    // A scope approval opts out of revision expiry on purpose: the Founder approved the
    // contract, and the digest is what revokes it. Code churn during the build is not a
    // change of scope. The integration gate is the one bound to the revision.
    assert.equal(c.cli('record-approval', c.doc('ap1', approvalDoc('ap1', 'scope', d.out, c.base, { expires_with_revision: false }))).code, 0);
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
    c.cli('open', 'c1', '--scope', 'the account module', '--paths', 'modules/account');
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
    assert.doesNotMatch(back.out, /blocked/, 'the block is cleared, not left behind as a ghost');

    const stored = JSON.parse(readFileSync(join(c.root, '.spectree/changes/c1.json'), 'utf8'));
    assert.equal(stored.blocked_from, undefined);
    assert.equal(stored.blocked_reason, undefined);
    assert.equal(c.cli('resume', 'c1', '--json').code, 0);
  } finally { c.drop(); }
});

/** Drives one change from `open` to `implemented`, so the content tests start where they need to. */
function upToImplemented(c) {
  c.cli('init', 'proj');
  c.cli('open', 'c1', '--scope', 'the account module', '--paths', 'modules/account');
  contractOnDisk(c);
  c.git(['add', '-A']); c.git(['commit', '-qm', 'the proposal']);
  const rev = c.git(['rev-parse', 'HEAD']).trim();
  const contract = c.cli('digest', 'c1').out;
  c.cli('record-approval', c.doc('ap1', approvalDoc('ap1', 'scope', contract, rev, { expires_with_revision: false })));
  c.cli('transition', 'c1', 'proposed');
  c.cli('transition', 'c1', 'scope_approved');
  for (const [id, property, to] of [
    ['e1', 'branch.isolated', 'isolated'],
    ['e2', 'suite.baseline', 'baselined'],
    ['e3', 'pass1.tests_failing', 'pass1_complete'],
  ]) {
    c.cli('record-evidence', c.doc(id, evidence(id, property, { revision: c.git(['rev-parse', 'HEAD']).trim() })));
    const t = c.cli('transition', 'c1', to);
    assert.equal(t.code, 0, `${to}: ${t.err}`);
  }
  mkdirSync(join(c.root, 'modules/account'), { recursive: true });
  writeFileSync(join(c.root, 'modules/account/account.js'), 'export const name = (s) => s.trim();\n');
  c.git(['add', '-A']); c.git(['commit', '-qm', 'the account module']);
  assert.equal(c.cli('transition', 'c1', 'implemented').code, 0);
  return { contract };
}

test('an uncommitted edit invalidates the evidence: the revision is not the content', () => {
  const c = consumer();
  try {
    upToImplemented(c);
    const rev = c.git(['rev-parse', 'HEAD']).trim();
    c.cli('record-evidence', c.doc('e4', evidence('e4', 'pass2.attack', {
      revision: rev, executor: { role: 'quality_engineer', independent_of: ['full_stack_developer'] },
    })));
    assert.equal(c.cli('can', 'c1', 'pass2_complete').code, 0, 'the run measured the content on disk');

    // Change the code and commit nothing. HEAD is where it was; the proposal is untouched.
    writeFileSync(join(c.root, 'modules/account/account.js'), 'export const name = (s) => s;\n');
    assert.equal(c.git(['rev-parse', 'HEAD']).trim(), rev, 'the revision really did not move');

    const r = c.cli('can', 'c1', 'pass2_complete');
    assert.equal(r.code, 1, 'the same command must not keep allowing it');
    assert.match(r.err, /E_CONTENT_CHANGED/);
    assert.match(r.err, /uncommitted change is still a change/);
    assert.match(r.err, /current content: .*uncommitted changes/, 'the refusal says what moved');

    // Put the code back and the same evidence is valid again — it is bound to content.
    writeFileSync(join(c.root, 'modules/account/account.js'), 'export const name = (s) => s.trim();\n');
    assert.equal(c.cli('can', 'c1', 'pass2_complete').code, 0);

    // Ticking a task is not code, and does not revoke a run either.
    contractOnDisk(c, 'one module, four Requirements', true);
    assert.equal(c.cli('can', 'c1', 'pass2_complete').code, 0, 'progress notes are outside the content digest');
  } finally { c.drop(); }
});

test('evidence that cannot say what content it ran against does not satisfy a fresh gate', () => {
  const c = consumer();
  try {
    upToImplemented(c);
    // A record with an explicit, wrong fingerprint: the CLI stamps one only when absent.
    c.cli('record-evidence', c.doc('e4', evidence('e4', 'pass2.attack', {
      revision: c.git(['rev-parse', 'HEAD']).trim(), fingerprint: 'sha256:' + 'f'.repeat(64),
      executor: { role: 'quality_engineer', independent_of: ['full_stack_developer'] },
    })));
    const r = c.cli('can', 'c1', 'pass2_complete');
    assert.equal(r.code, 1);
    assert.match(r.err, /E_CONTENT_CHANGED/);
  } finally { c.drop(); }
});

test('one change goes the whole way to closed, through the installed commands', () => {
  const c = consumer();
  try {
    upToImplemented(c);
    const rev = c.git(['rev-parse', 'HEAD']).trim();

    c.cli('record-evidence', c.doc('e4', evidence('e4', 'pass2.attack', {
      revision: rev, executor: { role: 'quality_engineer', independent_of: ['full_stack_developer'] },
    })));
    assert.equal(c.cli('transition', 'c1', 'pass2_complete').code, 0);

    c.cli('record-evidence', c.doc('e5', evidence('e5', 'ci.green', { revision: rev })));
    assert.equal(c.cli('transition', 'c1', 'ci_green').code, 0);

    // The integration gate authorises the contract AND the code that will travel with it,
    // so its digest is a different value from the scope gate's.
    const integration = c.cli('digest', 'c1', '--gate', 'integration');
    assert.equal(integration.code, 0);
    assert.notEqual(integration.out, c.cli('digest', 'c1').out, 'integration is not bound to the documents alone');
    assert.match(integration.err, /the contract AND the code/);

    const missing = c.cli('can', 'c1', 'integration_approved');
    assert.equal(missing.code, 1);
    assert.match(missing.err, /E_MISSING_APPROVAL/);

    c.cli('record-approval', c.doc('ap2', approvalDoc('ap2', 'integration', integration.out, rev)));
    assert.equal(c.cli('transition', 'c1', 'integration_approved').code, 0);
    assert.equal(c.cli('transition', 'c1', 'integrated').code, 0);

    const notClosed = c.cli('can', 'c1', 'closed');
    assert.equal(notClosed.code, 1);
    assert.match(notClosed.err, /closure\.merged/, 'closing needs the merge to have been observed');

    c.cli('record-evidence', c.doc('e6', evidence('e6', 'closure.merged', { revision: rev })));
    assert.equal(c.cli('transition', 'c1', 'closed').code, 0);

    const done = c.cli('resume');
    assert.match(done.out, /change\s+none open/, 'a closed change is no longer open work');

    const stored = JSON.parse(readFileSync(join(c.root, '.spectree/changes/c1.json'), 'utf8'));
    assert.equal(stored.state, 'closed');
    const history = readFileSync(join(c.root, '.spectree/history/c1.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(history.map((h) => h.to).filter(Boolean), [
      'proposed', 'scope_approved', 'isolated', 'baselined', 'pass1_complete',
      'implemented', 'pass2_complete', 'ci_green', 'integration_approved', 'integrated', 'closed',
    ], 'every step is in the append-only record, in order');
  } finally { c.drop(); }
});
