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
import { writeFileSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gitRepo, tempDir, cleanup, REPO, now, preparationOf, lifecycleOf, stubGh, greenRun } from './helpers.mjs';
import { Store } from '../scripts/lib/store.mjs';

/** A consumer project with the squad installed, exactly as a user would have it. */
function consumer() {
  // The state directory is local bookkeeping. Committing it makes every branch switch
  // collide with the squad's own writes, so a consumer keeps it out of version control.
  const repo = gitRepo({ 'seed.txt': 'seed\n', '.gitignore': '.spectree/\n' });
  execFileSync(process.execPath, [join(REPO, 'scripts', 'install-codex.mjs'), repo.root, '--apply'], { encoding: 'utf8' });
  // The squad is installed once, before any change opens — so it is part of the base and not
  // part of somebody's delivery, which is how a real consumer has it.
  repo.git(['add', '-A']); repo.git(['commit', '-qm', 'install the squad']);
  const state = join(repo.root, '.spectree/squad/scripts/state.mjs');
  // Input documents live OUTSIDE the project: a scratch file dropped in the work tree would
  // change the very content digest the commands are about to compute.
  const scratch = tempDir('spectree-scratch-');
  // spawnSync, not execFileSync: the refusals are on stderr and every one of them is asserted.
  const script = (name, ...args) => {
    const r = spawnSync(process.execPath, [join(repo.root, '.spectree/squad/scripts', name), ...args],
      { cwd: repo.root, encoding: 'utf8' });
    return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
  };
  const cli = (...args) => script('state.mjs', ...args);
  // The GitHub transport is stubbed; every digest, ancestry check, aggregate, receipt and
  // transition around it is the real one.
  const gh = stubGh(tempDir('spectree-gh-'), { repo: 'fixture/repo', pr: null, runs: [] });
  const confirm = (...args) => {
    const r = spawnSync(process.execPath, [join(repo.root, '.spectree/squad/scripts/post-merge.mjs'), 'c1', ...args],
      { cwd: repo.root, encoding: 'utf8', env: { ...process.env, PATH: gh.path() } });
    return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
  };
  /** The merge as GitHub would report it, plus one green run of `check` on the merge commit. */
  const merged = ({ pr = 999, head, merge, base = 'main', runs, jobs } = {}) => {
    const g = greenRun(merge);
    gh.set({
      repo: 'fixture/repo',
      pr: {
        number: pr, state: 'MERGED', mergedAt: now(), mergeCommit: { oid: merge },
        headRefOid: head, headRefName: 'change/c1', baseRefName: base,
        url: `https://example.invalid/pr/${pr}`,
      },
      runs: runs ?? [g.run],
      jobs: jobs ?? { [String(g.run.databaseId)]: g.jobs },
    });
  };
  const doc = (name, body) => {
    const f = join(scratch, `${name}.json`);
    writeFileSync(f, JSON.stringify(body));
    return f;
  };
  /** Produce evidence the way the protocol wants it: by running something. */
  const run = (property, { role = 'platform_engineer', independentOf, expectFailing, exit = 0, id, prints } = {}) => cli(
    'run', 'c1', property,
    '--role', role,
    ...(independentOf ? ['--independent-of', independentOf] : []),
    ...(expectFailing ? ['--expect-failing', expectFailing] : []),
    ...(id ? ['--id', id] : []),
    '--', process.execPath, '-e',
    `${prints ? `console.log(${JSON.stringify(prints)});` : ''}process.exit(${exit})`,
  );
  const drop = () => { cleanup(repo.root); cleanup(scratch); };
  return { ...repo, cli, script, doc, run, drop, gh, confirm, merged };
}

const proposal = (text) => `# proposal\n\n${text}\n`;

/** The Scenario pass 1 must show failing, and the TAP a runner would emit around it. */
const SCENARIO = 'Scenario: creation with a blank name';
const TAP = {
  red: ['TAP version 13', '1..1', `not ok 1 - ${SCENARIO}`].join('\n'),
  green: ['TAP version 13', '1..1', `ok 1 - ${SCENARIO}`].join('\n'),
  // A syntax error: the diagnostic echoes the source line, and no test ever ran. This is the
  // output that satisfied a substring match, which is why substring matching is gone.
  crash: ["SyntaxError: Unexpected token ';'", 'const ACCOUNT_NAME_REQUIRED = ;', `  while loading ${SCENARIO}`].join('\n'),
  truncated: ['TAP version 13', '1..3', `not ok 1 - ${SCENARIO}`].join('\n'),
  skipped: ['TAP version 13', '1..1', `not ok 1 - ${SCENARIO} # SKIP`].join('\n'),
  // A tidy, complete subtest inside a run that never reported anything of its own.
  truncatedRoot: ['TAP version 13', `    not ok 1 - ${SCENARIO}`, '    1..1'].join('\n'),
};

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

/**
 * An integration approval as the contract now requires one: bound to the content, to the
 * PREPARATION SNAPSHOT it was granted over, and to the integration it authorises.
 *
 * The preparation reference is what the artifact record was always missing. Content and
 * contract are in no way affected by a `tasks.md` inside the archived folder, so an approval
 * naming only those two kept matching across a reopening that replaced exactly that record.
 */
const integrationDoc = (c, id, digest, revision, target = {}) => {
  const m = preparationOf(c.root, 'c1');
  return approvalDoc(id, 'integration', digest, revision, {
    preparation: { preparation_id: m.preparation_id, generation: m.generation, preparation_digest: m.preparation_digest },
    integration_target: {
      repository: target.repository ?? 'fixture/repo',
      pr: target.pr ?? 999,
      head_sha: target.headSha ?? revision,
      base_branch: target.baseBranch ?? 'main',
    },
  });
};

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

/** Open, approve the scope, cut the branch, build the module: everything up to `implemented`. */
function upToImplemented(c) {
  c.cli('init', 'proj', '--repository', 'fixture/repo', '--ci-workflow', 'check', '--ci-jobs', 'classify,plugin',
        '--', process.execPath, '.spectree/consolidate.mjs', '{change_dir}');
  // The consumer's own spec consolidation, declared once at init. It lives under `.spectree/`
  // so that running it is not itself a change to the content being measured.
  // A real, minimal consolidation: it copies the delta into the living spec, and it reads the
  // change folder from `{change_dir}` so it still works once the preparation archived it. A
  // command that only prints success proves nothing about the mechanism this depends on.
  writeFileSync(join(c.root, '.spectree/consolidate.mjs'), [
    "import { cpSync, existsSync, mkdirSync } from 'node:fs';",
    "const dir = process.argv[2];",
    "if (!dir) { console.error('no change directory given'); process.exit(2); }",
    "const from = `${dir}/specs`, to = 'docs/specs';",
    "if (existsSync(from)) { mkdirSync(to, { recursive: true }); cpSync(from, to, { recursive: true }); }",
    "else { console.log('deltaless: nothing to consolidate'); }",
  ].join('\n'));
  c.cli('open', 'c1', '--scope', 'the account module', '--paths', 'modules/account,docs', '--modules', 'account');
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
  // Pass 1 delivers FAILING tests, and the property says so: a named test must be reported as
  // failing by a run that enumerated its tests and finished.
  assert.equal(c.run('pass1.tests_failing', {
    role: 'quality_engineer', expectFailing: SCENARIO, exit: 1, prints: TAP.red,
  }).code, 0);
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

/**
 * The closure, prepared on the branch and BEFORE the final validation — which is the whole
 * point: specs consolidated and the folder archived after QA and CI would mean the thing that
 * was validated is not the thing being integrated.
 */
function prepare(c, args = []) {
  return c.script('prepare-closure.mjs', 'c1', ...args);
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
    c.cli('open', 'c1', '--scope', 'the account module', '--paths', 'modules/account,docs');
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
    c.cli('open', 'c1', '--scope', 'the account module', '--paths', 'modules/account');
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
