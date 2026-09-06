// One change, driven end to end through the INSTALLED commands in a synthetic consumer,
// including a real branch, a real `--no-ff` merge and the archival the protocol asks for.
//
// The unit tests call the functions directly, which is exactly how four defects survived
// them: the machine had grown a requirement the CLI never supplied, the CLI wrote a block it
// could not undo, evidence stayed valid across an uncommitted edit, and an approval could
// carry new content past a QA and a CI that never saw it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitRepo, tempDir, cleanup, REPO, now } from './helpers.mjs';

/** A consumer project with the squad installed, exactly as a user would have it. */
function consumer() {
  // The state directory is local bookkeeping. Committing it makes every branch switch
  // collide with the squad's own writes, so a consumer keeps it out of version control.
  const repo = gitRepo({ 'seed.txt': 'seed\n', '.gitignore': '.spectree/\n' });
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
  /** Produce evidence the way the protocol wants it: by running something. */
  const run = (property, { role = 'platform_engineer', independentOf, expectNonzero, exit = 0, id } = {}) => cli(
    'run', 'c1', property,
    '--role', role,
    ...(independentOf ? ['--independent-of', independentOf] : []),
    ...(expectNonzero ? ['--expect-nonzero'] : []),
    ...(id ? ['--id', id] : []),
    '--', process.execPath, '-e', `process.exit(${exit})`,
  );
  const drop = () => { cleanup(repo.root); cleanup(scratch); };
  return { ...repo, cli, doc, run, drop };
}

const proposal = (text) => `# proposal\n\n${text}\n`;

/** The two artifacts a change carries: the contract, and the progress note beside it. */
function contractOnDisk(c, text = 'one module, four Requirements', done = false) {
  mkdirSync(join(c.root, 'docs/changes/c1/specs/account'), { recursive: true });
  writeFileSync(join(c.root, 'docs/changes/c1/proposal.md'), proposal(text));
  writeFileSync(join(c.root, 'docs/changes/c1/specs/account/spec.md'), '## ADDED Requirements\n\n### Requirement: x\n');
  writeFileSync(join(c.root, 'docs/changes/c1/tasks.md'), `- [${done ? 'x' : ' '}] build the account module\n`);
}

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

/** Open, approve the scope, cut the branch, build the module: everything up to `implemented`. */
function upToImplemented(c) {
  c.cli('init', 'proj');
  c.cli('open', 'c1', '--scope', 'the account module', '--paths', 'modules/account');
  contractOnDisk(c);
  c.git(['add', '-A']); c.git(['commit', '-qm', 'the proposal']);
  const contract = c.cli('digest', 'c1').out;
  c.cli('record-approval', c.doc('ap1', approvalDoc('ap1', 'scope', contract, c.git(['rev-parse', 'HEAD']).trim())));
  assert.equal(c.cli('transition', 'c1', 'proposed').code, 0);
  assert.equal(c.cli('transition', 'c1', 'scope_approved').code, 0);

  // Step 4 of the pipeline: the branch is cut before anything is written on it.
  c.git(['checkout', '-q', '-b', 'change/c1']);
  assert.equal(c.run('branch.isolated').code, 0);
  assert.equal(c.cli('transition', 'c1', 'isolated').code, 0);
  assert.equal(c.run('suite.baseline').code, 0);
  assert.equal(c.cli('transition', 'c1', 'baselined').code, 0);
  // Pass 1 delivers FAILING tests, so the check is expected to exit non-zero.
  assert.equal(c.run('pass1.tests_failing', { expectNonzero: true, exit: 1 }).code, 0);
  assert.equal(c.cli('transition', 'c1', 'pass1_complete').code, 0);

  mkdirSync(join(c.root, 'modules/account'), { recursive: true });
  writeFileSync(join(c.root, 'modules/account/account.js'), 'export const name = (s) => s.trim();\n');
  c.git(['add', '-A']); c.git(['commit', '-qm', 'the account module']);
  assert.equal(c.cli('transition', 'c1', 'implemented').code, 0);
  return { contract };
}

/** QA and CI, both on the content as it stands now. */
function proveIt(c) {
  assert.equal(c.run('pass2.attack', { role: 'quality_engineer', independentOf: 'full_stack_developer', id: 'e-qa' }).code, 0);
  assert.equal(c.cli('transition', 'c1', 'pass2_complete').code, 0);
  assert.equal(c.run('ci.green', { id: 'e-ci' }).code, 0);
  assert.equal(c.cli('transition', 'c1', 'ci_green').code, 0);
}

test('an uncommitted edit invalidates the evidence: the revision is not the content', () => {
  const c = consumer();
  try {
    upToImplemented(c);
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
    assert.match(rec.err, /no fingerprint/, 'and the command says so at the moment it is written');

    const r = c.cli('can', 'c1', 'pass2_complete');
    assert.equal(r.code, 1);
    assert.match(r.err, /records no fingerprint at all/);
    assert.equal(JSON.parse(readFileSync(join(c.root, '.spectree/evidence/e-old.json'), 'utf8')).fingerprint, undefined);
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
    proveIt(c);

    const proven = c.cli('digest', 'c1', '--gate', 'integration').out;

    // The reviewed content is proven. Now change the code and approve THAT, with no new runs.
    writeFileSync(join(c.root, 'modules/account/account.js'), 'export const name = (s) => s;\n');
    const unproven = c.cli('digest', 'c1', '--gate', 'integration').out;
    assert.notEqual(unproven, proven, 'the candidate really is a different one');
    c.cli('record-approval', c.doc('ap2', approvalDoc('ap2', 'integration', unproven, c.git(['rev-parse', 'HEAD']).trim())));

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

test('one change goes the whole way to closed: branch, merge --no-ff, archive', () => {
  const c = consumer();
  try {
    upToImplemented(c);
    proveIt(c);
    const candidate = c.git(['rev-parse', 'HEAD']).trim();

    // The integration gate authorises the contract AND the code that will travel with it.
    const integration = c.cli('digest', 'c1', '--gate', 'integration');
    assert.notEqual(integration.out, c.cli('digest', 'c1').out, 'integration is not bound to the documents alone');
    assert.match(integration.err, /the contract AND the code/);

    const missing = c.cli('can', 'c1', 'integration_approved');
    assert.equal(missing.code, 1);
    assert.match(missing.err, /E_MISSING_APPROVAL/);

    c.cli('record-approval', c.doc('ap2', approvalDoc('ap2', 'integration', integration.out, candidate)));
    assert.equal(c.cli('transition', 'c1', 'integration_approved').code, 0);

    // A real merge. `--no-ff` writes a new commit over an identical tree: the candidate that
    // was reviewed is the candidate being integrated, and the digest must say so.
    c.git(['checkout', '-q', 'main']);
    c.git(['merge', '--no-ff', '-q', '-m', 'merge change/c1', 'change/c1']);
    const merged = c.git(['rev-parse', 'HEAD']).trim();
    assert.notEqual(merged, candidate, 'the revision moved');
    assert.equal(c.cli('digest', 'c1', '--gate', 'integration').out, integration.out,
      'and the content did not: the approval and the runs still cover exactly this code');
    assert.equal(c.cli('transition', 'c1', 'integrated').code, 0);

    const notClosed = c.cli('can', 'c1', 'closed');
    assert.equal(notClosed.code, 1);
    assert.match(notClosed.err, /closure\.merged/, 'closing needs the merge to have been observed');

    // The closure check is a real question about the two revisions, not a synthetic PASS.
    const closure = c.cli('run', 'c1', 'closure.merged', '--role', 'platform_engineer', '--id', 'e-merge',
      '--', 'git', 'merge-base', '--is-ancestor', candidate, merged);
    assert.equal(closure.code, 0, closure.err);

    // Archival moves the contract; it does not change it, and it is not a code change either.
    c.git(['mv', 'docs/changes/c1', 'docs/changes/archive-tmp']);
    mkdirSync(join(c.root, 'docs/changes/archive'), { recursive: true });
    c.git(['mv', 'docs/changes/archive-tmp', 'docs/changes/archive/2026-09-06-c1']);
    c.git(['add', '-A']); c.git(['commit', '-qm', 'archive c1']);
    const afterArchive = c.cli('digest', 'c1');
    assert.equal(afterArchive.code, 0);
    assert.match(afterArchive.err, /archive\/2026-09-06-c1/, 'the digest follows the contract into the archive');
    assert.equal(c.cli('digest', 'c1', '--gate', 'integration').out, integration.out,
      'archiving is bookkeeping: neither digest moves');

    assert.equal(c.cli('transition', 'c1', 'closed').code, 0);

    const done = c.cli('resume');
    assert.match(done.out, /change\s+none open/, 'a closed change is no longer open work');
    const history = readFileSync(join(c.root, '.spectree/history/c1.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(history.map((h) => h.to).filter(Boolean), [
      'proposed', 'scope_approved', 'isolated', 'baselined', 'pass1_complete',
      'implemented', 'pass2_complete', 'ci_green', 'integration_approved', 'integrated', 'closed',
    ], 'every step is in the append-only record, in order');
  } finally { c.drop(); }
});

test('a merge that changes the tree is a different candidate, and is refused', () => {
  const c = consumer();
  try {
    upToImplemented(c);
    proveIt(c);
    const candidate = c.git(['rev-parse', 'HEAD']).trim();
    const integration = c.cli('digest', 'c1', '--gate', 'integration').out;
    c.cli('record-approval', c.doc('ap2', approvalDoc('ap2', 'integration', integration, candidate)));
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
