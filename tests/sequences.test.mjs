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
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../scripts/lib/store.mjs';
import { contractDigest, contentDigest, gatedDigest } from '../scripts/lib/digest.mjs';
import { currentPath, lifecyclePath, snapshotPath, readLifecycle, receiptPath, pendingOperation, preparationDigest } from '../scripts/lib/lifecycle.mjs';
import {
  gitRepo, cleanup, tempDir, now, REPO, integrationApproval, recordIntegrationApproval, ciConfig, stubGh, greenRun, preparationOf,
} from './helpers.mjs';

const CLOCK = join(REPO, 'tests/fixtures/clock-ahead.cjs').split('\\').join('/');
const CRASH_SHIM = join(REPO, 'tests/fixtures/crash-at-phase.cjs').split('\\').join('/');

/**
 * A consumer with a real consolidation, a declared CI, and a change ready to prepare.
 * `{change_dir}` is substituted per argument, so the command still works once the folder moved.
 */
function project({ counting = false } = {}) {
  const repo = gitRepo({ 'src/app.js': 'export const x = 1;\n', '.gitignore': '.spectree/\n' });
  const store = new Store(repo.root);
  mkdirSync(join(repo.root, '.spectree'), { recursive: true });
  store.init({
    project_id: 'fixture', protocol_version: '1.0.0', repository: 'fixture/repo',
    ci: ciConfig(['classify', 'plugin']),
    closure: { consolidate: [process.execPath, '.spectree/consolidate.mjs', '{change_dir}'] },
  });
  writeFileSync(join(repo.root, '.spectree/consolidate.mjs'), [
    "import { cpSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';",
    'const dir = process.argv[2];',
    "if (!dir) { console.error('no change directory'); process.exit(2); }",
    // One character per execution. A recovery that re-ran the command would be invisible without
    // it: the output is the same either way, and "it looks right afterwards" is not the question.
    ...(counting ? ["appendFileSync('.spectree/ran', 'x');"] : []),
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
    /** The same command, killed the instant the control records `phase`. A real interruption. */
    prepCrashing: (phase, ...args) => run('prepare-closure.mjs', args, {
      SPECTREE_CRASH_AT: phase,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${CRASH_SHIM}`.trim(),
    }),
    confirmCrashing: (phase, ...args) => run('post-merge.mjs', args, {
      PATH: gh.path(),
      SPECTREE_CRASH_AT: phase,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${CRASH_SHIM}`.trim(),
    }),
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
    /** The same command with extra environment — a barrier shim, say. */
    stateWith: (env, ...args) => {
      const r = spawnSync(process.execPath, [join(REPO, 'scripts/state.mjs'), ...args],
        { cwd: repo.root, encoding: 'utf8', env: { ...process.env, ...env } });
      return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
    },
    /** Killed the instant a named file's bytes land — a boundary the phases do not name. */
    prepCrashingOnWrite: (suffix, ...args) => run('prepare-closure.mjs', args, {
      SPECTREE_CRASH_ON_WRITE: suffix,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${CRASH_SHIM}`.trim(),
    }),
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
      recordIntegrationApproval(repo.root, 'c1', integrationApproval({
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
    /** Record an integration approval through the CLI, and report what it said. */
    approveExpectingFailure: () => {
      const c = new Store(repo.root).change('c1');
      const head = repo.git(['rev-parse', 'HEAD']).trim();
      const doc = join(repo.root, '.spectree/approval-input.json');
      let manifest = null;
      try { manifest = preparationOf(repo.root, 'c1'); } catch { /* none written */ }
      writeFileSync(doc, JSON.stringify(integrationApproval({
        approvalId: 'ap-x', changeId: 'c1', manifest,
        scopeDigest: gatedDigest(contractDigest(repo.root, c).digest, contentDigest(repo.root).digest),
        revision: head, target: { pr: 999, headSha: head },
      })));
      const r = spawnSync(process.execPath, [join(REPO, 'scripts/state.mjs'), 'record-approval', doc],
        { cwd: repo.root, encoding: 'utf8' });
      return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
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

// --- interruptions that really interrupt ---------------------------------------------------------

const CRASH = join(REPO, 'tests/fixtures/crash-at-phase.cjs').split('\\').join('/');

/** How many times the consolidation has actually executed. The number that matters in a recovery. */
const consolidationRuns = (p) => {
  const f = join(p.root, '.spectree/ran');
  return existsSync(f) ? readFileSync(f, 'utf8').length : 0;
};

test('an interruption after the command was observed resumes without running it again', () => {
  const p = project({ counting: true });
  try {
    // A REAL crash: the child process dies the instant the control records `observed`. Editing
    // files afterwards to simulate one would be testing the edit.
    const killed = p.prepCrashing('observed', '--apply');
    assert.equal(killed.code, 86, 'the child really died');
    assert.equal(consolidationRuns(p), 1, 'and the consolidation really ran');
    assert.equal(existsSync(join(p.root, 'docs/specs/account/spec.md')), true, 'it left its output');
    assert.equal(existsSync(join(p.root, currentPath('c1'))), false, 'and no preparation was written');

    const before = readLifecycle(p.root, 'c1').doc;
    assert.equal(before.operation.phase, 'observed');
    const plannedId = before.operation.plan.preparation_id;

    // A plain re-run refuses, and names the command that recovers — which is the whole complaint:
    // a message that recommended a re-run, beside a re-run that refused.
    const plain = p.prep('--apply', '--json');
    assert.equal(plain.code, 1);
    assert.equal(JSON.parse(plain.out).code, 'E_OPERATION_PENDING');
    assert.match(plain.err, /--resume/);
    assert.equal(consolidationRuns(p), 1, 'and it did not run the command again either');

    // The recommended command works, and finishes the operation that was interrupted.
    const resumed = p.prep('--apply', '--resume', '--json');
    assert.equal(resumed.code, 0, resumed.err);
    assert.equal(consolidationRuns(p), 1, 'a recovery finishes an operation; it does not execute one');
    const m = p.manifest();
    assert.equal(m.preparation_id, plannedId, 'and it finishes the SAME preparation that was reserved');
    assert.equal(m.preparation_digest, preparationDigest(m));
    const after = readLifecycle(p.root, 'c1').doc;
    assert.equal(pendingOperation(after), null, 'nothing is left open');
    assert.equal(after.current_preparation, m.preparation_id);
    const trail = readFileSync(join(p.root, '.spectree/history/c1.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(trail.filter((e) => e.type === 'closure_prepared').length, 1, 'one preparation, one event');
  } finally { p.drop(); }
});

test('an interruption during persistence finishes only the steps that are missing', () => {
  const p = project({ counting: true });
  try {
    const killed = p.prepCrashing('persisting', '--apply');
    assert.equal(killed.code, 86);
    assert.equal(consolidationRuns(p), 1);
    assert.equal(readLifecycle(p.root, 'c1').doc.operation.phase, 'persisting');

    const resumed = p.prep('--apply', '--resume', '--json');
    assert.equal(resumed.code, 0, resumed.err);
    assert.equal(consolidationRuns(p), 1);
    assert.equal(existsSync(join(p.root, 'docs/changes/c1')), false, 'the folder is archived');
    const m = p.manifest();
    assert.ok(m.artifacts.length, 'and the record describes it');
    assert.equal(pendingOperation(readLifecycle(p.root, 'c1').doc), null);

    // The whole cycle still closes on top of a resumed preparation.
    p.git(['add', '-A']); p.git(['commit', '-qm', 'the resumed preparation']);
    p.approve();
    p.merge();
    assert.equal(p.confirm('--pr', '999', '--apply').code, 0);
    assert.equal(p.stateNow(), 'closed');
  } finally { p.drop(); }
});

test('an interruption before the command was observed stays uncertain, and is resolved by a person', () => {
  const p = project({ counting: true });
  try {
    const killed = p.prepCrashing('started', '--apply');
    assert.equal(killed.code, 86, 'it died before the result was ever observed');
    // Whether the command ran is genuinely unknown here — the process died between launching it
    // and recording what it returned.
    const open = pendingOperation(readLifecycle(p.root, 'c1').doc);
    assert.equal(open.phase, 'started');
    assert.equal(open.uncertain, true);

    // `--resume` alone will NOT carry it: nothing may decide this on the tool's own authority.
    const attempted = p.prep('--apply', '--resume', '--json');
    assert.equal(attempted.code, 1);
    assert.equal(JSON.parse(attempted.out).code, 'E_OPERATION_PENDING');
    assert.match(attempted.err, /--consolidation-ran/);
    assert.match(attempted.err, /--abandon/);

    // A person looked. That is recorded, and it is what moves the operation on — the command is
    // still not run again.
    const before = consolidationRuns(p);
    const resolved = p.prep('--apply', '--resume', '--consolidation-ran', '--reason', 'the living spec has the delta', '--json');
    assert.equal(resolved.code, 0, resolved.err);
    assert.equal(consolidationRuns(p), before, 'the decision is not an execution');
    const trail = readFileSync(join(p.root, '.spectree/history/c1.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const decision = trail.find((e) => e.type === 'closure_uncertainty_resolved');
    assert.equal(decision.reason, 'the living spec has the delta');
  } finally { p.drop(); }
});

test('an uncertain operation can be abandoned, and what it wrote is left alone', () => {
  const p = project({ counting: true });
  try {
    assert.equal(p.prepCrashing('started', '--apply').code, 86);
    const spec = join(p.root, 'docs/specs/account/spec.md');
    const wrote = existsSync(spec);

    assert.equal(p.prep('--apply', '--abandon').code, 2, 'abandoning is not anonymous either');
    const r = p.prep('--apply', '--abandon', '--reason', 'checked: the command never started', '--json');
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).state, 'abandoned');
    assert.equal(pendingOperation(readLifecycle(p.root, 'c1').doc), null, 'the operation is gone');
    assert.equal(readLifecycle(p.root, 'c1').doc.abandoned.length, 1, 'and it is still in the record');
    assert.equal(existsSync(spec), wrote, 'nothing the command wrote was reverted');

    // And the change can be prepared again from a clean slate.
    assert.equal(p.prep('--apply').code, 0);
    assert.ok(p.manifest());
  } finally { p.drop(); }
});

test('a confirmation interrupted between the receipt and the state is resumed, not restarted', () => {
  const p = project();
  try {
    assert.equal(p.prep('--apply').code, 0);
    p.git(['add', '-A']); p.git(['commit', '-qm', 'closure prepared']);
    p.approve();
    const { merge } = p.merge();

    // A REAL crash inside the confirmation, the instant the control reaches `persisting` — which
    // is after the receipt is written and before the transitions.
    // Crash once the control POINTS at the receipt: the receipt is on disk, the transitions are
    // not. That is the window the reviewer named, and it is where a resume has to be a resume.
    const killed = p.confirmCrashing('receipt', '--pr', '999', '--apply');
    assert.equal(killed.code, 86, 'the child really died mid-confirmation');
    assert.equal(existsSync(join(p.root, receiptPath('c1'))), true, 'the receipt was already written');
    assert.equal(p.stateNow(), 'integration_approved', 'and the change had not moved yet');
    const receiptBefore = readFileSync(join(p.root, receiptPath('c1')), 'utf8');

    const resumed = p.confirm('--pr', '999', '--apply');
    assert.equal(resumed.code, 0, resumed.err);
    assert.equal(p.stateNow(), 'closed');
    assert.equal(readFileSync(join(p.root, receiptPath('c1')), 'utf8'), receiptBefore,
      'one receipt, and the moment it recorded is not re-stamped');

    const trail = readFileSync(join(p.root, '.spectree/history/c1.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(trail.filter((e) => e.type === 'integration_observed').length, 1, 'one observation');
    assert.equal(trail.filter((e) => e.to === 'integrated').length, 1);
    assert.equal(trail.filter((e) => e.to === 'closed').length, 1);
    assert.equal(p.git(['rev-parse', 'HEAD']).trim(), merge, 'and no commit was made');
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

// --- the transition inside the authority boundary -------------------------------------------------

const BARRIER = join(REPO, 'tests/fixtures/barrier-at-lock.cjs').split('\\').join('/');

/** A change prepared, approved, and put back at `implemented` so a forward transition is legal. */
function readyToTransition() {
  const p = project({ counting: true });
  const r = p.prep('--apply');
  assert.equal(r.code, 0, r.err);
  p.git(['add', '-A']); p.git(['commit', '-qm', 'prepared']);
  p.approve();
  const c = new Store(p.root).change('c1');
  new Store(p.root).putChange({ ...c, state: 'implemented' },
    { expected: c.state_revision, event: { type: 'fixture-back-to-work' } });
  // A slow consolidation, so a reopening really is still running when the barrier releases.
  const script = join(p.root, '.spectree/consolidate.mjs');
  writeFileSync(script, `${readFileSync(script, 'utf8')}\nAtomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);\n`);
  return p;
}

test('a transition decided before a reopening does not land after it', () => {
  const p = readyToTransition();
  try {
    const marker = join(p.root, '.spectree/barrier.json');
    const stateBefore = readFileSync(join(p.root, '.spectree/changes/c1.json'), 'utf8');
    const trailBefore = readFileSync(join(p.root, '.spectree/history/c1.jsonl'), 'utf8');

    // The barrier fires at the transition's FIRST attempt on the closure lock — after its
    // decision, before its write. A reopening runs to `started` while it waits.
    //
    // Held at the CHANGE lock, this same interleaving used to pass: a reopening that returns a
    // change to the state it was already in does not move `state_revision`, so the change store's
    // own optimistic check saw nothing to object to.
    const r = p.stateWith({
      SPECTREE_BARRIER_LOCK: '/closure/c1.lifecycle.lock',
      SPECTREE_BARRIER_ARGV: JSON.stringify([
        join(REPO, 'scripts/prepare-closure.mjs'), 'c1', '--apply', '--reopen', '--reason', 'a concurrent decision',
      ]),
      SPECTREE_BARRIER_UNTIL: 'reopen/started',
      SPECTREE_BARRIER_OUT: marker,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${BARRIER}`.trim(),
    }, 'transition', 'c1', 'pass2_complete');

    const observed = JSON.parse(readFileSync(marker, 'utf8'));
    assert.equal(observed.kind, 'reopen', 'the barrier really did hold until the reopening started');
    assert.equal(observed.phase, 'started');

    assert.equal(r.code, 1, 'a transition does not land on top of an operation that is still running');
    assert.match(r.err, /E_OPERATION_PENDING|E_CONCURRENT_UPDATE/);
    assert.equal(readFileSync(join(p.root, '.spectree/changes/c1.json'), 'utf8'), stateBefore,
      'the state is byte for byte what it was');
    // The trail DOES grow — the reopening is writing its own events while this waits. What must
    // not be in it is a transition: comparing the whole file would be asserting that a concurrent
    // operation wrote nothing, which is a different and false claim.
    const trailNow = readFileSync(join(p.root, '.spectree/history/c1.jsonl'), 'utf8').trim().split(String.fromCharCode(10)).map(JSON.parse);
    assert.equal(trailNow.filter((e) => e.to === 'pass2_complete').length, 0, 'no transition event was written');
    assert.ok(trailNow.length > trailBefore.trim().split(String.fromCharCode(10)).length, 'and the reopening did get on with its own work');

    // And the reason it refused is still on record: the reopening's operation is open. Whether
    // that reopening then finishes is not this test's subject — the barrier's child does not
    // outlive the process holding it — and it is proven by the other ordering below, where the
    // barrier waits for `done` and therefore keeps it alive.
    const lc = readLifecycle(p.root, 'c1').doc;
    assert.equal(pendingOperation(lc).kind, 'reopen');
    assert.equal(lc.generation, 2, 'the reopening had already raised the generation');
  } finally { p.drop(); }
});

test('the other ordering too: a reopening that COMPLETED under the barrier refuses the decision', () => {
  const p = readyToTransition();
  try {
    const marker = join(p.root, '.spectree/barrier.json');
    const stateBefore = readFileSync(join(p.root, '.spectree/changes/c1.json'), 'utf8');

    // Same window, the other side of it: the reopening runs all the way to `done` while the
    // transition waits. There is then no pending operation to object to — the only thing that says
    // the world moved is the control's revision, which is what the reservation compares.
    const r = p.stateWith({
      SPECTREE_BARRIER_LOCK: '/closure/c1.lifecycle.lock',
      SPECTREE_BARRIER_ARGV: JSON.stringify([
        join(REPO, 'scripts/prepare-closure.mjs'), 'c1', '--apply', '--reopen', '--reason', 'a concurrent decision',
      ]),
      SPECTREE_BARRIER_UNTIL: 'reopen/done',
      SPECTREE_BARRIER_OUT: marker,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${BARRIER}`.trim(),
    }, 'transition', 'c1', 'pass2_complete');

    const observed = JSON.parse(readFileSync(marker, 'utf8'));
    assert.equal(observed.kind, 'reopen');
    assert.equal(observed.phase, 'done', 'the reopening really did finish before the release');
    assert.equal(pendingOperation(readLifecycle(p.root, 'c1').doc), null, 'so nothing was pending');

    assert.equal(r.code, 1, 'and the decision still does not apply: it was taken against another world');
    assert.match(r.err, /E_CONCURRENT_UPDATE/);
    assert.equal(readFileSync(join(p.root, '.spectree/changes/c1.json'), 'utf8'), stateBefore);
    assert.equal(readLifecycle(p.root, 'c1').doc.generation, 2);

    // Deciding again, against what is there now, is the repair — and `pass2_complete` rests on the
    // scope approval and the QA evidence, neither of which a reopening retires, so it goes through.
    const again = p.state('transition', 'c1', 'pass2_complete');
    assert.equal(again.code, 0, again.err);
  } finally { p.drop(); }
});

test('with nobody competing, the same transition goes through', () => {
  const p = readyToTransition();
  try {
    const r = p.state('transition', 'c1', 'pass2_complete');
    assert.equal(r.code, 0, r.err);
    assert.equal(p.stateNow(), 'pass2_complete');
  } finally { p.drop(); }
});

// --- a recovery is bound to what the interrupted command actually ran against ---------------------

test('a contract that moved while the operation was interrupted refuses the resume', () => {
  const p = project({ counting: true });
  try {
    assert.equal(p.prepCrashing('observed', '--apply').code, 86);
    assert.equal(consolidationRuns(p), 1);

    // The delta is edited while the operation is stopped. The consolidation that ran consolidated
    // Requirement `x`; the delta on disk now says something else.
    writeFileSync(join(p.root, 'docs/changes/c1/specs/account/spec.md'),
      '## ADDED Requirements\n\n### Requirement: DIFFERENT\n');

    const r = p.prep('--apply', '--resume', '--json');
    assert.equal(r.code, 1, 'a resume finishes an operation; it does not re-decide it under another contract');
    const doc = JSON.parse(r.out);
    assert.equal(doc.code, 'E_RESUME_INPUTS_CHANGED');
    assert.match(JSON.stringify(doc.drift), /contract moved/);
    assert.equal(consolidationRuns(p), 1, 'and it did not run the command again');
    assert.equal(existsSync(join(p.root, currentPath('c1'))), false, 'no preparation was published');
    assert.equal(pendingOperation(readLifecycle(p.root, 'c1').doc).phase, 'observed',
      'the operation is still open, for a person to resolve');

    // Putting the delta back makes it resumable again — the refusal was about the drift, not a
    // door that closed for good.
    writeFileSync(join(p.root, 'docs/changes/c1/specs/account/spec.md'),
      '## ADDED Requirements\n\n### Requirement: x\n');
    const again = p.prep('--apply', '--resume', '--json');
    assert.equal(again.code, 0, again.err);
    assert.equal(consolidationRuns(p), 1);
  } finally { p.drop(); }
});

test('a resume with no recorded observation refuses instead of inventing one', () => {
  const p = project({ counting: true });
  try {
    assert.equal(p.prepCrashing('started', '--apply').code, 86);
    // `started` carries no consolidation result — that is what `started` means. The default that
    // used to fill one in was the tool asserting an observation nobody made.
    const open = pendingOperation(readLifecycle(p.root, 'c1').doc);
    assert.equal(open.detail?.consolidation, undefined);

    const r = p.prep('--apply', '--resume', '--json');
    assert.equal(r.code, 1);
    assert.match(JSON.stringify(JSON.parse(r.out).code), /E_OPERATION_PENDING|E_RESUME_NO_OBSERVATION/);

    // The operator's decision becomes a record with its OWN provenance, not an observation.
    assert.equal(p.prep('--apply', '--resume', '--consolidation-ran', '--reason', 'the living spec has the delta').code, 0);
    const m = preparationOf(p.root, 'c1');
    assert.equal(m.consolidation.source, 'operator_decision');
    assert.equal(m.consolidation.decided_because, 'the living spec has the delta');
    assert.notEqual(m.consolidation.source, 'observed_execution');
  } finally { p.drop(); }
});

// --- recovery is routed by the operation's kind ----------------------------------------------------

test('a refresh interrupted at persistence is finished, not replaced by a new one', () => {
  const p = project({ counting: true });
  try {
    assert.equal(p.prep('--apply').code, 0);
    p.git(['add', '-A']); p.git(['commit', '-qm', 'prepared']);
    const archive = preparationOf(p.root, 'c1').archive_path;
    writeFileSync(join(p.root, `${archive}/tasks.md`), '- [x] build it\n');

    assert.equal(p.prepCrashing('persisting', '--apply').code, 86);
    const open = pendingOperation(readLifecycle(p.root, 'c1').doc);
    assert.equal(open.kind, 'refresh');
    const reserved = open.plan.preparation_id;

    const r = p.prep('--apply', '--resume', '--json');
    assert.equal(r.code, 0, r.err);
    const doc = JSON.parse(r.out);
    assert.equal(doc.state, 'refreshed');
    assert.equal(doc.resumed_operation, open.operation_id, 'it finished THAT refresh, not a new one');
    assert.equal(doc.preparation_id, reserved, 'under the identity that refresh reserved');
    assert.equal(consolidationRuns(p), 1);

    const lc = readLifecycle(p.root, 'c1').doc;
    assert.equal(pendingOperation(lc), null);
    assert.equal(lc.current_preparation, preparationOf(p.root, 'c1').preparation_id,
      'the pointer names the document that exists');
    const trail = readFileSync(join(p.root, '.spectree/history/c1.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(trail.filter((e) => e.type === 'closure_artifacts_refreshed').length, 1, 'one event for one operation');
  } finally { p.drop(); }
});

test('a prepare that wrote its projection and nothing else is finished, not reported as done', () => {
  const p = project({ counting: true });
  try {
    // Crash the instant the projection's bytes land: the snapshot exists, the trail does not, and
    // the operation is open. The digests then match what was just written, so the `unchanged`
    // shortcut used to answer 0 and leave all of that as it was.
    const r0 = p.prepCrashingOnWrite('/closure/c1.json', '--apply');
    assert.equal(r0.code, 86);
    assert.equal(consolidationRuns(p), 1);
    const projection = readFileSync(join(p.root, currentPath('c1')), 'utf8');
    const open = pendingOperation(readLifecycle(p.root, 'c1').doc);
    assert.equal(open.phase, 'persisting');

    const r = p.prep('--apply', '--resume', '--json');
    assert.equal(r.code, 0, r.err);
    assert.equal(consolidationRuns(p), 1);
    assert.equal(readFileSync(join(p.root, currentPath('c1')), 'utf8'), projection,
      'the immutable snapshot is not re-stamped with a second `prepared_at`');

    const lc = readLifecycle(p.root, 'c1').doc;
    assert.equal(pendingOperation(lc), null, 'no pending operation behind a zero exit');
    assert.equal(lc.current_preparation, JSON.parse(projection).preparation_id);
    const trail = readFileSync(join(p.root, '.spectree/history/c1.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(trail.filter((e) => e.type === 'closure_prepared').length, 1);
  } finally { p.drop(); }
});

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
