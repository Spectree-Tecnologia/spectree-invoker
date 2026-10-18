// The consumer with the squad installed, shared by tests/cli-cycle*.test.mjs. It lives apart so
// the runner can run those files in parallel.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gitRepo, tempDir, cleanup, REPO, now, preparationOf, stubGh, greenRun, closureCli } from './helpers.mjs';

/** A consumer project with the squad installed, exactly as a user would have it. */
export function consumer() {
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
  // The closure CLIs answer in process (`closureCli`); the installed copy is still the code run.
  const script = (name, ...args) => closureCli(join(repo.root, '.spectree/squad/scripts', name), args, { cwd: repo.root });
  const cli = (...args) => script('state.mjs', ...args);
  // The GitHub transport is stubbed; every digest, ancestry check, aggregate, receipt and
  // transition around it is the real one.
  const gh = stubGh(tempDir('spectree-gh-'), { repo: 'fixture/repo', pr: null, runs: [] });
  const confirm = (...args) => closureCli(join(repo.root, '.spectree/squad/scripts/post-merge.mjs'), ['c1', ...args],
    { cwd: repo.root, env: { PATH: gh.path() } });
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

export const proposal = (text) => `# proposal\n\n${text}\n`;

/** The Scenario pass 1 must show failing, and the TAP a runner would emit around it. */
export const SCENARIO = 'Scenario: creation with a blank name';

export const TAP = {
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
export function contractOnDisk(c, text = 'one module, four Requirements', done = false) {
  mkdirSync(join(c.root, 'docs/changes/c1/specs/account'), { recursive: true });
  writeFileSync(join(c.root, 'docs/changes/c1/proposal.md'), proposal(text));
  writeFileSync(join(c.root, 'docs/changes/c1/specs/account/spec.md'), '## ADDED Requirements\n\n### Requirement: x\n');
  writeFileSync(join(c.root, 'docs/changes/c1/tasks.md'), `- [${done ? 'x' : ' '}] build the account module\n`);
}

export const approvalDoc = (id, gate, digest, revision, extra = {}) => ({
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
export const integrationDoc = (c, id, digest, revision, target = {}) => {
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

/** Open, approve the scope, cut the branch, build the module: everything up to `implemented`. */
export function upToImplemented(c) {
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
export function proveIt(c) {
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
export function prepare(c, args = []) {
  return c.script('prepare-closure.mjs', 'c1', ...args);
}
