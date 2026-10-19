// The consumer project the sequences run against, shared by tests/sequences*.test.mjs. It lives
// apart so the runner can run those files in parallel.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../scripts/lib/change/store.mjs';
import { contractDigest, contentDigest, gatedDigest } from '../scripts/lib/shared/digest.mjs';
import { gitRepo, cleanup, tempDir, now, REPO, integrationApproval, recordIntegrationApproval, ciConfig, stubGh, greenRun, preparationOf, closureCli } from './helpers.mjs';

export const CLOCK = join(REPO, 'tests/fixtures/clock-ahead.cjs').split('\\').join('/');

export const CRASH_SHIM = join(REPO, 'tests/fixtures/crash-at-phase.cjs').split('\\').join('/');

/**
 * A consumer with a real consolidation, a declared CI, and a change ready to prepare.
 * `{change_dir}` is substituted per argument, so the command still works once the folder moved.
 */
export function project({ counting = false } = {}) {
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
  // In process unless the call loads a shim, which only a new process can (`closureCli`).
  const run = (script, args, env) => closureCli(join(REPO, 'scripts', script), ['c1', ...args], { cwd: repo.root, env });
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
    state: (...args) => closureCli(join(REPO, 'scripts/state.mjs'), args, { cwd: repo.root }),
    /** The same command with extra environment — a barrier shim, say. */
    stateWith: (env, ...args) => closureCli(join(REPO, 'scripts/state.mjs'), args, { cwd: repo.root, env }),
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

export const CRASH = join(REPO, 'tests/fixtures/crash-at-phase.cjs').split('\\').join('/');

/** How many times the consolidation has actually executed. The number that matters in a recovery. */
export const consolidationRuns = (p) => {
  const f = join(p.root, '.spectree/ran');
  return existsSync(f) ? readFileSync(f, 'utf8').length : 0;
};

export const BARRIER = join(REPO, 'tests/fixtures/barrier-at-lock.cjs').split('\\').join('/');

/** A change prepared, approved, and put back at `implemented` so a forward transition is legal. */
export function readyToTransition() {
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
