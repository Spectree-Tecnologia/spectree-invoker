// A baseline read from a CI run the project already paid for: the declared workflow, finished, on
// exactly the base revision, every declared job settled. It records one observation and is judged
// the way a fresh run is; it speaks for the baseline and for nothing else.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { gitRepo, cleanup, tempDir, stubGh, greenRun, REPO, change, evidence, approval } from './helpers.mjs';
import { ciRunBaseline } from '../scripts/lib/evidence/index.mjs';
import { canTransition, CODES } from '../scripts/lib/change/state-machine.mjs';
import { Store } from '../scripts/lib/change/store.mjs';
import { stateCommand } from '../scripts/lib/closure/index.mjs';

const REV = 'a'.repeat(40);
const project = { ci: { version: 2, required_runs: { full: { workflow: 'check', jobs: ['classify', 'plugin'], event: 'push', branch: 'main' } } } };
const judge = (run, o = {}) => ciRunBaseline(run, { project, changeId: 'c1', revision: REV, fingerprint: 'b'.repeat(64), at: '2026-10-24T00:00:00Z', ...o });
const withJobs = ({ run, jobs }) => ({ ...run, jobs });

test('the declared run, green on the base revision, is recorded as an observed CI baseline', () => {
  const r = judge(withJobs(greenRun(REV, { id: 41 })));
  assert.equal(r.ok, true);
  assert.equal(r.result, 'PASS');
  assert.equal(r.evidence.source_kind, 'observed_ci_run');
  assert.equal(r.evidence.property, 'suite.baseline');
  assert.deepEqual(r.evidence.environment, { ci: true, run_ref: 'https://example.invalid/run/41' });
  assert.equal(r.evidence.revision, REV);
});

test('a red run at the base is recorded as a red baseline, the debt the protocol stops on', () => {
  const g = greenRun(REV, { id: 42 });
  const r = judge({ ...g.run, conclusion: 'failure', jobs: [g.jobs[0], { ...g.jobs[1], conclusion: 'failure' }] });
  assert.equal(r.ok, true);
  assert.equal(r.result, 'FAIL');
});

test('another commit, another workflow, an unfinished, cancelled or partial run records nothing', () => {
  const g = withJobs(greenRun(REV, { id: 43 }));
  const cases = [
    [{ ...g, headSha: 'c'.repeat(40) }, 'E_RUN_REVISION'],
    [{ ...g, workflowName: 'nightly', name: 'nightly' }, 'E_RUN_WORKFLOW'],
    [{ ...g, event: 'pull_request' }, 'E_RUN_WORKFLOW'],
    [{ ...g, status: 'in_progress', conclusion: null }, 'E_RUN_NOT_COMPLETE'],
    [{ ...g, conclusion: 'cancelled' }, 'E_RUN_INCONCLUSIVE'],
    [{ ...g, jobs: [g.jobs[0], { ...g.jobs[1], conclusion: 'skipped' }] }, 'E_RUN_INCONCLUSIVE'],
    [{ ...g, jobs: [g.jobs[0]] }, 'E_RUN_JOBS'],
  ];
  for (const [run, code] of cases) assert.equal(judge(run).code, code, code);
  assert.equal(judge(g, { project: {} }).code, 'E_CI_MAP_MISSING');
});

test('a CI run observes the baseline and nothing else', () => {
  const scope = approval({ approval_id: 'ap-scope', gate: 'scope', change_id: 'c1', scope_digest: 'D-scope', revision: REV });
  const ctx = (ev) => ({ approvals: [scope], revision: REV, scopeDigests: { scope: 'D-scope', integration: 'D-int' }, closure: { ok: true }, evidence: [ev] });
  const fromRun = (property) => evidence({ property, revision: REV, source_kind: 'observed_ci_run', change_id: 'c1' });
  assert.equal(canTransition(change({ state: 'isolated' }), 'baselined', ctx(fromRun('suite.baseline'))).ok, true);
  assert.equal(canTransition(change({ state: 'baselined' }), 'pass1_complete', ctx(fromRun('pass1.tests_failing'))).code, CODES.SELF_REPORT_ONLY);
});

test('verification.mjs baseline ci --from-run reads the run, records it and judges the baseline', () => {
  const repo = gitRepo({ 'seed.txt': 'seed\n', '.gitignore': '.spectree/\n' });
  const gh = stubGh(tempDir('spectree-gh-'), { repo: 'fixture/repo', runs: [] });
  try {
    const state = (...argv) => stateCommand({ root: repo.root, argv, out: () => {}, err: () => {} });
    assert.equal(state('init', 'proj', '--repository', 'fixture/repo', '--ci-workflow', 'check', '--ci-jobs', 'classify,plugin'), 0);
    assert.equal(state('open', 'c1', '--scope', 'baseline', '--paths', 'seed.txt', '--closure-mode', 'legacy'), 0);
    const base = new Store(repo.root).change('c1').base_revision;
    const green = greenRun(base, { id: 7 }), other = greenRun('d'.repeat(40), { id: 8 });
    gh.set({ repo: 'fixture/repo', runs: [green.run, other.run], jobs: { 7: green.jobs, 8: other.jobs } });
    const verification = (...args) => spawnSync(process.execPath, [join(REPO, 'scripts', 'verification.mjs'), ...args], {
      cwd: repo.root, encoding: 'utf8', env: { ...process.env, PATH: gh.path(), SPECTREE_PROJECT_ROOT: repo.root } });

    const wrong = verification('baseline', 'c1', 'ci', '--from-run', '8');
    assert.equal(wrong.status, 1);
    assert.match(wrong.stderr, /E_RUN_REVISION/);
    assert.equal(new Store(repo.root).evidence('c1').length, 0, 'a refused run records nothing');

    const ok = verification('baseline', 'c1', 'ci', '--from-run', '7');
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).ok, true);
    const [ev] = new Store(repo.root).evidence('c1');
    assert.equal(ev.source_kind, 'observed_ci_run');
    assert.equal(verification('baseline', 'c1', 'local', '--from-run', '7').status, 1, 'a CI run is never a local baseline');

    // An imported document cannot claim the read.
    const forged = join(tempDir('spectree-doc-'), 'ev.json');
    const { fingerprint: _, ...rest } = ev;
    writeFileSync(forged, JSON.stringify({ ...rest, evidence_id: 'ev-forged' }));
    assert.equal(state('record-evidence', forged), 1);
  } finally { cleanup(repo.root); }
});
