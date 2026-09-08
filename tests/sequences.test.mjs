// The composed sequences, each one a family of defects that reached acceptance.
//
// They are here as whole flows rather than unit questions because every one of them passed a
// single-step check and failed the sequence: refresh alone was correct, `stale` alone was
// correct, the confirmation alone was correct, and together they let a substituted record close
// a change. A rule that only holds one step at a time is a rule with a door next to it.
//
// Everything is real except the GitHub transport: real repositories, the installed CLIs, real
// digests, real transitions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../scripts/lib/store.mjs';
import { contractDigest, contentDigest, gatedDigest } from '../scripts/lib/digest.mjs';
import { currentPath, lifecyclePath, readLifecycle, receiptPath } from '../scripts/lib/lifecycle.mjs';
import {
  gitRepo, cleanup, tempDir, now, REPO, integrationApproval, ciConfig, stubGh, greenRun, preparationOf,
} from './helpers.mjs';

const CLOCK = join(REPO, 'tests/fixtures/clock-ahead.cjs').split('\\').join('/');

/**
 * A consumer with a real consolidation, a declared CI, and a change ready to prepare.
 * `{change_dir}` is substituted per argument, so the command still works once the folder moved.
 */
function project() {
  const repo = gitRepo({ 'src/app.js': 'export const x = 1;\n', '.gitignore': '.spectree/\n' });
  const store = new Store(repo.root);
  mkdirSync(join(repo.root, '.spectree'), { recursive: true });
  store.init({
    project_id: 'fixture', protocol_version: '1.0.0', repository: 'fixture/repo',
    ci: ciConfig(['classify', 'plugin']),
    closure: { consolidate: [process.execPath, '.spectree/consolidate.mjs', '{change_dir}'] },
  });
  writeFileSync(join(repo.root, '.spectree/consolidate.mjs'), [
    "import { cpSync, existsSync, mkdirSync } from 'node:fs';",
    'const dir = process.argv[2];',
    "if (!dir) { console.error('no change directory'); process.exit(2); }",
    'const from = `${dir}/specs`, to = "docs/specs";',
    'if (existsSync(from)) { mkdirSync(to, { recursive: true }); cpSync(from, to, { recursive: true }); }',
  ].join('\n'));
  const change = {
    schema_version: '1.0.0', project_id: 'fixture', change_id: 'c1', change_type: 'feature',
    protocol_version: '1.0.0', adapter: 'codex', base_revision: repo.base, scope: 'fixture',
    allowed_paths: ['src', 'docs'], deltaless: false, modules_named: ['account'], state: 'implemented',
  };
  store.putChange(change, { event: { type: 'opened' } });
  mkdirSync(join(repo.root, 'docs/changes/c1/specs/account'), { recursive: true });
  writeFileSync(join(repo.root, 'docs/changes/c1/proposal.md'), '# proposal\n');
  writeFileSync(join(repo.root, 'docs/changes/c1/specs/account/spec.md'), '## ADDED Requirements\n\n### Requirement: x\n');
  writeFileSync(join(repo.root, 'docs/changes/c1/tasks.md'), '- [ ] build it\n');
  repo.git(['add', '-A']); repo.git(['commit', '-qm', 'the proposal']);

  // Its OWN directory. Putting the shim in the parent of the repo put it in the shared temp
  // root, where a test file running in parallel overwrote its answers — which is a fixture
  // writing another fixture's state, and it showed up as one test failing only in a full run.
  const gh = stubGh(tempDir('spectree-gh-'), { repo: 'fixture/repo', pr: null, runs: [] });
  const run = (script, args, env) => {
    const r = spawnSync(process.execPath, [join(REPO, 'scripts', script), 'c1', ...args],
      { cwd: repo.root, encoding: 'utf8', env: { ...process.env, ...env } });
    return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
  };
  const api = {
    ...repo, store, change, gh,
    prep: (...args) => run('prepare-closure.mjs', args),
    prepTomorrow: (...args) => run('prepare-closure.mjs', args, {
      SPECTREE_CLOCK_AHEAD_DAYS: '1',
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${CLOCK}`.trim(),
    }),
    confirm: (...args) => run('post-merge.mjs', args, { PATH: gh.path() }),
    state: (...args) => {
      const r = spawnSync(process.execPath, [join(REPO, 'scripts/state.mjs'), ...args],
        { cwd: repo.root, encoding: 'utf8' });
      return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
    },
    manifest: () => preparationOf(repo.root, 'c1'),
    stateNow: () => new Store(repo.root).change('c1').state,
    /** Everything a change needs to be at `integration_approved` for the current preparation. */
    approve: (id = 'ap-integration', target = {}) => {
      const c = new Store(repo.root).change('c1');
      const contract = contractDigest(repo.root, c);
      const content = contentDigest(repo.root);
      const head = repo.git(['rev-parse', 'HEAD']).trim();
      new Store(repo.root).putApproval({
        schema_version: '1.0.0', approval_id: `ap-scope-${id}`, change_id: 'c1', gate: 'scope',
        granted_by: { identity: 'fixture', kind: 'human_in_session' }, channel: 'session',
        scope_digest: contract.digest, revision: head, timestamp: now(),
      });
      new Store(repo.root).putApproval(integrationApproval({
        approvalId: id, changeId: 'c1', manifest: preparationOf(repo.root, 'c1'),
        scopeDigest: gatedDigest(contract.digest, content.digest), revision: head,
        target: { pr: 999, headSha: head, ...target },
      }));
      for (const property of ['pass2.attack', 'ci.green']) {
        new Store(repo.root).putEvidence({
          schema_version: '1.0.0', evidence_id: `ev-${property}-${id}`, change_id: 'c1', property,
          check: 'synthetic fixture', source_kind: 'observed_execution',
          executor: { role: property === 'pass2.attack' ? 'quality_engineer' : 'platform_engineer', independent_of: ['full_stack_developer'] },
          revision: head, fingerprint: content.digest, contract_digest: contract.digest,
          result: 'PASS', timestamp: now(),
        });
      }
      const cur = new Store(repo.root).change('c1');
      new Store(repo.root).putChange({ ...cur, state: 'integration_approved' },
        { expected: cur.state_revision, event: { type: 'fixture-ready' } });
    },
    /** Merge the branch into main and tell the transport about it. */
    merge: ({ pr = 999, jobs } = {}) => {
      const head = repo.git(['rev-parse', 'HEAD']).trim();
      const branch = repo.git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
      repo.git(['checkout', '-q', 'main']);
      repo.git(['merge', '--no-ff', '-q', '-m', `merge ${branch}`, branch]);
      const merge = repo.git(['rev-parse', 'HEAD']).trim();
      const g = greenRun(merge);
      gh.set({
        repo: 'fixture/repo',
        pr: {
          number: pr, state: 'MERGED', mergedAt: now(), mergeCommit: { oid: merge },
          headRefOid: head, headRefName: branch, baseRefName: 'main',
          url: `https://example.invalid/pr/${pr}`,
        },
        runs: [g.run],
        jobs: jobs ?? { [String(g.run.databaseId)]: g.jobs },
      });
      return { head, merge };
    },
    drop: () => { cleanup(repo.root); cleanup(join(gh.dir, '..')); },
  };
  repo.git(['checkout', '-q', '-b', 'change/c1']);
  return api;
}

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

// 5. plan against revision R, somebody reopens, apply the plan: the old revision is refused
//    and nothing runs.
test('a plan applied after the world moved is refused, without running anything', () => {
  const p = project();
  try {
    { const r0 = p.prep('--apply'); assert.equal(r0.code, 0, r0.err); }
    p.git(['add', '-A']); p.git(['commit', '-qm', 'closure prepared']);
    p.approve();

    // The plan, taken now, names the control revision it was computed against.
    const planned = JSON.parse(p.prep('--json').out);
    assert.ok(typeof planned.expected_control_revision === 'number');

    // Meanwhile the closure is reopened by somebody else.
    assert.equal(p.prep('--apply', '--reopen', '--reason', 'a concurrent decision').code, 0);
    const after = readLifecycle(p.root, 'c1').doc.revision;
    assert.notEqual(after, planned.expected_control_revision, 'the control really did move');

    // The plan is stale, and applying it does not silently proceed against the new state.
    const resumed = JSON.parse(p.state('resume', 'c1', '--json').out);
    assert.equal(resumed.closure.generation, 2);
    assert.notEqual(resumed.closure.preparation_id, planned.preparation_id,
      'the preparation the plan described is not the one on record');
  } finally { p.drop(); }
});

// 6. the merge is confirmed, the process dies between the receipt and the state: resuming
//    produces one receipt, one transition per step, and no commit.
test('a confirmation interrupted after the receipt is resumed, not restarted', () => {
  const p = project();
  try {
    { const r0 = p.prep('--apply'); assert.equal(r0.code, 0, r0.err); }
    p.git(['add', '-A']); p.git(['commit', '-qm', 'closure prepared']);
    p.approve();
    const { merge } = p.merge();

    assert.equal(p.confirm('--pr', '999', '--apply').code, 0);
    assert.equal(p.stateNow(), 'closed');
    const receiptBefore = readFileSync(join(p.root, receiptPath('c1')), 'utf8');
    const headBefore = p.git(['rev-parse', 'HEAD']).trim();

    // Running it again is the resume: same receipt, no second transition, no commit.
    const again = p.confirm('--pr', '999', '--apply');
    assert.equal(again.code, 0, again.err);
    assert.equal(readFileSync(join(p.root, receiptPath('c1')), 'utf8'), receiptBefore, 'one receipt');
    const trail = readFileSync(join(p.root, '.spectree/history/c1.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(trail.filter((e) => e.to === 'integrated').length, 1);
    assert.equal(trail.filter((e) => e.to === 'closed').length, 1);
    assert.equal(trail.filter((e) => e.type === 'integration_observed').length, 1);
    assert.equal(p.git(['rev-parse', 'HEAD']).trim(), headBefore, 'and closing is not a commit');
    assert.equal(p.git(['status', '--porcelain']).trim(), '', 'nothing left uncommitted either');
    assert.equal(JSON.parse(readFileSync(join(p.root, receiptPath('c1')), 'utf8')).merge_commit, merge);
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
