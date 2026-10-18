#!/usr/bin/env node
// One delivery, driven end to end through the INSTALLED squad, timed command by command. This is
// the squad's own machine clock for M6 (docs/maintenance.md), and it measures nothing else.
//
//   node bench/delivery.mjs [--mode prepared|legacy|compare] [--n 7] [--json]
//
//   prepared  the closure is prepared on the branch: one PR, one merge, nothing after it.
//   legacy    the change merges first and closes afterwards: a second PR carries the consolidation
//             and the archive, and a commit on main records that the second PR was green. It is the
//             procedure the prepared closure replaced, as the protocol describes it — reproduced
//             here, not remembered.
//
// `gh` is a TRANSPORT stub. Every digest, ancestry check, aggregate, receipt and transition is the
// real one; the network is left out on purpose — timed with it, this would measure GitHub and call
// it the squad. The queue, the runner and the human are the other clocks, and they are measured
// against real runs, never here.
//
// The counts it prints — pull requests, pushes to main — are what the procedure PRODUCES. How many
// CI runs those become is a fact about a real repository, and this does not infer it.

import { flags } from '../scripts/lib/shared/cli.mjs';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { gitRepo, tempDir, cleanup, REPO, now, preparationOf, stubGh, greenRun } from '../support/fixtures.mjs';
import { contentDigest } from '../scripts/lib/digest.mjs';

const argv = process.argv.slice(2);
const opt = flags(argv).value;
const MODE = opt('mode', 'prepared');
const N = Number(opt('n', 7));
if (!['prepared', 'legacy', 'compare'].includes(MODE)) { console.error('--mode is "prepared", "legacy" or "compare"'); process.exit(2); }
if (!Number.isInteger(N) || N < 1) { console.error('--n is a positive integer'); process.exit(2); }
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--json') continue;
  if (['--mode', '--n'].includes(argv[i]) && argv[i + 1] && !argv[i + 1].startsWith('--')) { i++; continue; }
  throw new Error(`unknown or incomplete option: ${argv[i]}`);
}
const measuredSource = contentDigest(REPO);

const SCENARIO = 'Scenario: creation with a blank name';
const clockNow = () => Number(process.hrtime.bigint() / 1000000n);

function delivery(MODE) {
  const startedAt = new Date().toISOString();
  const started = clockNow();
  const clock = {};
  const count = { pull_requests: 0, pushes_to_main: 0 };
  const timed = (key, fn) => {
    const t = clockNow();
    try { return fn(); } finally { clock[key] = (clock[key] ?? 0) + (clockNow() - t); }
  };

  const repo = gitRepo({ 'seed.txt': 'seed\n', '.gitignore': '.spectree/\n' });
  const scratch = tempDir('bench-scratch-');
  const ghDir = tempDir('bench-gh-');
  const gh = stubGh(ghDir, { repo: 'fixture/repo', pr: null, runs: [] });

  const git = (...a) => timed('git', () => repo.git(a)).trim();
  const squad = (script, ...args) => {
    const key = script === 'state.mjs' ? `squad state ${args[0]}` : `squad ${script.replace(/\.mjs$/, '')}`;
    const r = timed(key, () => spawnSync(process.execPath,
      [join(repo.root, '.spectree/squad/scripts', script), ...args],
      { cwd: repo.root, encoding: 'utf8', env: { ...process.env, PATH: gh.path() } }));
    if (r.status !== 0) {
      throw new Error(`${script} ${args.slice(0, 3).join(' ')} exited ${r.status}\n${r.stderr}\n${r.stdout}`);
    }
    return (r.stdout ?? '').trim();
  };
  const state = (...a) => squad('state.mjs', ...a);
  // Synthetic, and it says so in the record itself: nobody approved anything in a benchmark.
  const approval = (id, gate, digest, revision, extra = {}) => {
    const f = join(scratch, `${id}.json`);
    writeFileSync(f, JSON.stringify({
      approval_id: id, change_id: 'c1', gate,
      granted_by: { identity: 'bench-fixture', kind: 'human_in_session' },
      channel: 'bench/delivery.mjs — synthetic fixture; no person approved this',
      scope_digest: digest, revision, timestamp: now(), ...extra,
    }));
    return f;
  };
  const merge = (branch, pr) => {
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', branch, '-m', `Merge pull request #${pr} from ${branch}`);
    count.pull_requests += 1;
    count.pushes_to_main += 1;
    return git('rev-parse', 'HEAD');
  };

  try {
    timed('install', () => execFileSync(process.execPath,
      [join(REPO, 'scripts', 'install-codex.mjs'), repo.root, '--apply'], { encoding: 'utf8' }));
    git('add', '-A'); git('commit', '-qm', 'install the squad');

    // The consumer's own consolidation, kept out of version control with the rest of .spectree/.
    writeFileSync(join(repo.root, '.spectree/consolidate.mjs'), [
      "import { cpSync, existsSync, mkdirSync } from 'node:fs';",
      'const from = `${process.argv[2]}/specs`;',
      "if (existsSync(from)) { mkdirSync('docs/specs', { recursive: true }); cpSync(from, 'docs/specs', { recursive: true }); }",
    ].join('\n') + '\n');
    state('init', 'bench', '--repository', 'fixture/repo',
      '--ci-workflow', 'check', '--ci-jobs', 'classify,plugin', '--ci-event', 'push', '--ci-branch', 'main',
      '--', process.execPath, '.spectree/consolidate.mjs', '{change_dir}');
    state('open', 'c1', '--scope', 'reject a blank account name', '--paths', 'modules/account,docs',
      '--modules', 'account', ...(MODE === 'legacy' ? ['--closure-mode', 'legacy'] : []));

    // --- the contract ------------------------------------------------------------------------------
    mkdirSync(join(repo.root, 'modules/account'), { recursive: true });
    writeFileSync(join(repo.root, 'modules/account/account.mjs'), 'export const name = (s) => String(s ?? "").trim();\n');
    mkdirSync(join(repo.root, 'docs/changes/c1/specs/account'), { recursive: true });
    writeFileSync(join(repo.root, 'docs/changes/c1/proposal.md'), '# Reject a blank account name\n\nOne module, one Requirement.\n');
    writeFileSync(join(repo.root, 'docs/changes/c1/specs/account/spec.md'), [
      '## ADDED Requirements',
      '',
      '### Requirement: Account rejects a blank name',
      'The system SHALL reject an account name that is empty or blank.',
      '',
      '#### Scenario: Creation with a blank name',
      '- **GIVEN** an authenticated user',
      '- **WHEN** an account is created with an empty `name`',
      '- **THEN** the error `ACCOUNT_NAME_REQUIRED` is returned',
    ].join('\n') + '\n');
    writeFileSync(join(repo.root, 'docs/changes/c1/tasks.md'), '- [ ] reject a blank name\n');
    git('add', '-A'); git('commit', '-qm', 'the proposal');

    state('record-approval', approval('ap-scope', 'scope', state('digest', 'c1'), git('rev-parse', 'HEAD')));
    state('transition', 'c1', 'proposed');
    state('transition', 'c1', 'scope_approved');

    // --- branch, baseline, pass 1 ------------------------------------------------------------------
    git('checkout', '-q', '-b', 'change/c1');
    const exitsZero = ['--', process.execPath, '-e', 'process.exit(0)'];
    state('run', 'c1', 'branch.isolated', '--role', 'platform_engineer', ...exitsZero);
    state('transition', 'c1', 'isolated');
    state('run', 'c1', 'suite.baseline', '--role', 'platform_engineer', ...exitsZero);
    state('transition', 'c1', 'baselined');

    writeFileSync(join(repo.root, 'modules/account/blank-name.test.mjs'), [
      "import { test } from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { name } from './account.mjs';",
      '',
      `test('${SCENARIO}', () => { assert.throws(() => name('   '), /ACCOUNT_NAME_REQUIRED/); });`,
    ].join('\n') + '\n');
    state('run', 'c1', 'pass1.tests_failing', '--role', 'quality_engineer',
      '--expect-failing', SCENARIO, '--report',
      '--', process.execPath, '--test', '--test-reporter=tap', '--test-reporter-destination={report}',
      'modules/account/blank-name.test.mjs');
    state('transition', 'c1', 'pass1_complete');

    // --- the implementation ------------------------------------------------------------------------
    writeFileSync(join(repo.root, 'modules/account/account.mjs'), [
      'export const name = (s) => {',
      '  const trimmed = String(s ?? "").trim();',
      '  if (!trimmed) throw new Error("ACCOUNT_NAME_REQUIRED");',
      '  return trimmed;',
      '};',
    ].join('\n') + '\n');
    git('add', '-A'); git('commit', '-qm', 'the account module rejects a blank name');
    state('transition', 'c1', 'implemented');

    if (MODE === 'prepared') {
      squad('prepare-closure.mjs', 'c1', '--apply', '--json');
      git('add', '-A'); git('commit', '-qm', 'closure prepared on the branch');
    }

    // --- pass 2, CI, the integration approval ------------------------------------------------------
    state('run', 'c1', 'pass2.attack', '--role', 'quality_engineer', '--independent-of', 'full_stack_developer',
      '--', process.execPath, '--test', 'modules/account/blank-name.test.mjs');
    state('transition', 'c1', 'pass2_complete');
    state('run', 'c1', 'ci.green', '--role', 'platform_engineer',
      '--', process.execPath, '--test', 'modules/account/blank-name.test.mjs');
    state('transition', 'c1', 'ci_green');

    const head = git('rev-parse', 'HEAD');
    const m = MODE === 'prepared' ? preparationOf(repo.root, 'c1') : null;
    state('record-approval', approval('ap-int', 'integration', state('digest', 'c1', '--gate', 'integration'), head, {
      ...(m ? { preparation: { preparation_id: m.preparation_id, generation: m.generation, preparation_digest: m.preparation_digest } } : {}),
      integration_target: { repository: 'fixture/repo', pr: 1, head_sha: head, base_branch: 'main' },
    }));
    state('transition', 'c1', 'integration_approved');

    // --- ONE merge, and its confirmation -----------------------------------------------------------
    const mergeOid = merge('change/c1', 1);
    const g = greenRun(mergeOid);
    gh.set({
      repo: 'fixture/repo',
      pr: { number: 1, state: 'MERGED', merged: true, mergedAt: now(), mergeCommit: { oid: mergeOid },
            headRefOid: head, baseRefName: 'main', headRefName: 'change/c1', url: 'https://example.invalid/pr/1' },
      runs: [g.run], jobs: { [String(g.run.databaseId)]: g.jobs },
    });
    squad('post-merge.mjs', 'c1', '--pr', '1', '--apply', '--json');

    // --- what the legacy closure still owes after the merge ----------------------------------------
    if (MODE === 'legacy') {
      git('checkout', '-q', '-b', 'closure/c1');
      timed('operator consolidation', () => execFileSync(process.execPath,
        ['.spectree/consolidate.mjs', 'docs/changes/c1'], { cwd: repo.root }));
      mkdirSync(join(repo.root, 'docs/changes/archive'), { recursive: true });
      git('mv', 'docs/changes/c1', `docs/changes/archive/${new Date().toISOString().slice(0, 10)}-c1`);
      git('add', '-A'); git('commit', '-qm', 'close c1: consolidate the delta and archive the change');
      merge('closure/c1', 2);
      // And the commit recording that the closure PR was green: a run whose only subject is a run.
      writeFileSync(join(repo.root, 'docs/STATUS.md'), `c1 closed; closure PR #2 green at ${now()}\n`);
      git('add', '-A'); git('commit', '-qm', 'record that the closure PR was green');
      count.pushes_to_main += 1;
    }

    const final = JSON.parse(readFileSync(join(repo.root, '.spectree/changes/c1.json'), 'utf8')).state;
    if (final !== 'closed') throw new Error(`the change ended at "${final}", not "closed"`);
    const mergeCount = Number(git('rev-list', '--count', '--merges', `${repo.base}..HEAD`));
    const afterMerge = Number(git('rev-list', '--count', `${mergeOid}..HEAD`));
    if (mergeCount !== count.pull_requests || (MODE === 'prepared' && afterMerge !== 0)) {
      throw new Error('observed Git history disagrees with the simulated procedure');
    }
    if (git('status', '--porcelain')) throw new Error('the synthetic delivery left a dirty work tree');
    const wall = clockNow() - started;
    return { mode: MODE, started_at: startedAt, clock, count, final_state: final,
      observed_merge_commits: mergeCount, commits_after_first_merge: afterMerge,
      wall_ms: wall, wall_without_install_ms: wall - clock.install };
  } finally { cleanup(repo.root); cleanup(scratch); cleanup(ghDir); }
}

const results = [];
for (let i = 0; i < N; i++) {
  // Paired, alternating order: never run all of one mode before all of the other.
  const modes = MODE === 'compare' ? (i % 2 ? ['legacy', 'prepared'] : ['prepared', 'legacy']) : [MODE];
  for (const mode of modes) {
    process.stderr.write(`  ${mode} ${i + 1}/${N}\n`);
    results.push({ pair: i + 1, ...delivery(mode) });
  }
}
if (contentDigest(REPO).digest !== measuredSource.digest) throw new Error('package changed during measurement; refusing a mixed-build report');

// The procedure is deterministic, so every delivery must produce the same counts. One that did not
// would mean the benchmark measured two different procedures and averaged them.
if (!results.every((r) => JSON.stringify(r.count) === JSON.stringify(results.find((x) => x.mode === r.mode).count))) {
  console.error('the deliveries produced different counts; refusing to summarise them together');
  process.exit(1);
}

const summary = (xs) => {
  const v = [...xs].sort((a, b) => a - b);
  const mid = v.length / 2;
  const median = v.length % 2 ? v[Math.floor(mid)] : (v[mid - 1] + v[mid]) / 2;
  return { n: v.length, min: v[0], median, max: v[v.length - 1] };
};
const sumWhere = (r, pred) => Object.entries(r.clock).filter(([k]) => pred(k)).reduce((a, [, v]) => a + v, 0);
function summarise(results) {
const keys = [...new Set(results.flatMap((r) => Object.keys(r.clock)))].sort();

const report = {
  mode: results[0].mode,
  n: results.length,
  runtime: `node ${process.versions.node}`,
  platform: `${process.platform}/${process.arch}`,
  counts: results[0].count,
  per_key_ms: Object.fromEntries(keys.map((k) => [k, summary(results.map((r) => r.clock[k] ?? 0))])),
  squad_ms: summary(results.map((r) => sumWhere(r, (k) => k.startsWith('squad ')))),
  git_ms: summary(results.map((r) => sumWhere(r, (k) => k === 'git'))),
  operator_ms: summary(results.map((r) => sumWhere(r, (k) => k.startsWith('operator ')))),
  instrumented_ms: summary(results.map((r) => sumWhere(r, (k) => k !== 'install'))),
  wall_without_install_ms: summary(results.map((r) => r.wall_without_install_ms)),
};
return report;
}
const report = {
  report_version: 1, kind: 'synthetic-local-procedure', source: measuredSource,
  baseline: 'legacy procedure reconstructed on the CURRENT runtime, not the old release',
  clocks_not_observed: ['model work', 'GitHub queue', 'GitHub jobs', 'human waiting'],
  counts_kind: 'simulated procedure events, not remote PRs or pushes',
  wall_scope: 'fixture creation through closed/legacy bookkeeping; excludes cleanup; install also reported separately',
  samples: results,
  summaries: [...new Set(results.map((r) => r.mode))].map((mode) => summarise(results.filter((r) => r.mode === mode))),
};

if (argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const s = (x) => `${(x / 1000).toFixed(2)}s`.padStart(8);
const row = (label, t) => console.log(`  ${label.padEnd(28)} min${s(t.min)}  median${s(t.median)}  max${s(t.max)}`);
for (const result of report.summaries) {
console.log(`\ndelivery — mode "${result.mode}", n=${result.n}, ${result.runtime}, ${result.platform}\n`);
for (const k of Object.keys(result.per_key_ms)) row(k, result.per_key_ms[k]);
console.log();
row('squad (every script)', result.squad_ms);
row('git', result.git_ms);
if (result.mode === 'legacy') row('operator (closure by hand)', result.operator_ms);
row('WALL, without install', result.wall_without_install_ms);
console.log(`\n  simulated pull requests ${result.counts.pull_requests}   pushes to main ${result.counts.pushes_to_main}` +
  '   (what the procedure produces; the CI runs they become are observed elsewhere)\n');
}
