// The post-merge confirmation, driven through the CLI against a stubbed GitHub.
//
// The defect these exist for: the confirmation used to compare the LOCAL CHECKOUT against the
// approval. The checkout is whatever the operator happens to have, so a merge carrying entirely
// different content closed the change with exit 0 — the approval matched, because it was never
// asked about the merge. Every content question here is asked of the merge commit's tree.
//
// GitHub is stubbed by a `gh` on PATH. That is a stub of the transport, not of the decisions:
// the digests, the ancestry, the aggregate and the state transitions are the real ones.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../scripts/lib/change/store.mjs';
import { contractDigest, contractDigestAt, contentDigest, contentDigestAt, gatedDigest } from '../scripts/lib/shared/digest.mjs';
import { buildManifest } from '../scripts/lib/closure/closure-prep.mjs';
import { emptyLifecycle, lifecyclePath, snapshotPath, currentPath } from '../scripts/lib/change/lifecycle.mjs';
import { gitRepo, tempDir, cleanup, now, REPO, stubGh, greenRun, integrationApproval, ciConfig, recordIntegrationApproval, closureCli } from './helpers.mjs';
import { confirmMerge } from '../scripts/lib/closure/index.mjs';

/**
 * A change that reached `integration_approved`, with a merge on `main` and an approval bound to
 * whichever tree the caller says was authorised.
 */
function fixture({
  mergeDiffers = false, prepared = true, ci = ['classify', 'plugin'],
  rewriteContractInMerge = false, extraAncestorApproval = false, alterArtifactInMerge = false,
} = {}) {
  const repo = gitRepo({ 'app.js': 'export const n = 1;\n', '.gitignore': '.spectree/\n' });
  const base = repo.base;
  const contractFile = 'docs/changes/c1/proposal.md';
  const taskFile = 'docs/changes/c1/tasks.md';

  repo.git(['checkout', '-q', '-b', 'candidate']);
  writeFileSync(join(repo.root, 'app.js'), 'export const n = 2;\n');
  mkdirSync(join(repo.root, 'docs/changes/c1'), { recursive: true });
  writeFileSync(join(repo.root, contractFile), '# Approved: refuse an invalid account\n');
  writeFileSync(join(repo.root, taskFile), '- [x] build it\n');
  repo.git(['add', '-A']); repo.git(['commit', '-qm', 'the approved candidate']);
  const candidate = repo.git(['rev-parse', 'HEAD']).trim();

  // A commit that is an ancestor of the merge but is not the approved candidate.
  const ancestor = base;

  repo.git(['checkout', '-q', 'main']);
  if (mergeDiffers) {
    writeFileSync(join(repo.root, 'app.js'), 'export const n = 999;\n');
    mkdirSync(join(repo.root, 'docs/changes/c1'), { recursive: true });
    writeFileSync(join(repo.root, contractFile), '# Approved: refuse an invalid account\n');
    writeFileSync(join(repo.root, taskFile), '- [x] build it\n');
    repo.git(['add', '-A']); repo.git(['commit', '-qm', 'something else']);
  } else {
    repo.git(['merge', '--no-ff', '-q', '-m', 'merge candidate', 'candidate']);
    if (rewriteContractInMerge) {
      writeFileSync(join(repo.root, contractFile), '# NOT APPROVED: accept an invalid account\n');
      repo.git(['add', '-A']); repo.git(['commit', '-qm', 'quietly rewrite the contract']);
    }
    if (alterArtifactInMerge) {
      // Operational, so neither the code digest nor the contract digest moves.
      writeFileSync(join(repo.root, taskFile), '- [ ] actually it was never built\n');
      repo.git(['add', '-A']); repo.git(['commit', '-qm', 'alter a prepared artifact']);
    }
  }
  const merge = repo.git(['rev-parse', 'HEAD']).trim();
  repo.git(['checkout', '-q', 'candidate']);

  const store = new Store(repo.root);
  store.init({
    project_id: 'fixture', protocol_version: '1.0.0', repository: 'fixture/repo',
    ...(ci ? { ci: ciConfig(ci) } : {}),
  });
  const change = {
    schema_version: '1.0.0', project_id: 'fixture', change_id: 'c1', change_type: 'feature',
    protocol_version: '1.0.0', adapter: 'codex', base_revision: base, scope: 'fixture',
    allowed_paths: ['app.js', 'docs'], deltaless: true, state: 'integration_approved',
  };
  store.putChange(change, { event: { type: 'opened' } });

  const landed = contentDigestAt(repo.root, merge);
  const landedContract = contractDigestAt(repo.root, merge, change);
  let manifest = null;
  if (prepared) {
    // The artifacts as they stood on the CANDIDATE: that is what a preparation would have
    // recorded, and what the merge is then checked against.
    // Path, TYPE, MODE and blob — the whole tree entry, because a merge that changes only the
    // mode changes what the file may do and nothing else would see it.
    const entryFor = (p) => {
      const line = execFileSync('git', ['ls-tree', candidate, '--', p], { cwd: repo.root, encoding: 'utf8' }).trim();
      const [meta] = line.split('	');
      const [mode, type, blob] = meta.split(/\s+/);
      return { path: p, type, mode, op: 'archived', digest: blob };
    };
    manifest = buildManifest({
      changeId: 'c1', projectId: 'fixture', generation: 1, baseRevision: base,
      contractDigest: landedContract.digest, candidateDigest: landed.digest, preparedAt: now(),
      archivePath: 'docs/changes/archive/2026-01-01-c1',
      artifacts: [contractFile, taskFile].map(entryFor),
    });
    mkdirSync(join(repo.root, '.spectree/closure/c1'), { recursive: true });
    writeFileSync(join(repo.root, currentPath('c1')), JSON.stringify(manifest, null, 2));
    writeFileSync(join(repo.root, snapshotPath('c1', manifest.preparation_id)), JSON.stringify(manifest, null, 2));
  }
  // The durable control. Authority lives here, so a fixture that skipped it would be testing a
  // state no real project can be in.
  mkdirSync(join(repo.root, '.spectree/closure'), { recursive: true });
  writeFileSync(join(repo.root, lifecyclePath('c1')), JSON.stringify({
    ...emptyLifecycle('c1', 'fixture'),
    current_preparation: manifest?.preparation_id ?? null,
  }, null, 2));

  // The approval names the tree that was actually reviewed: the candidate's, contract included.
  const approvedContract = contractDigestAt(repo.root, candidate, change);
  const approvedContent = contentDigestAt(repo.root, candidate);
  const approvedGate = gatedDigest(approvedContract.digest, approvedContent.digest);
  store.putApproval({
    schema_version: '1.0.0', approval_id: 'ap-scope', change_id: 'c1', gate: 'scope',
    granted_by: { identity: 'fixture', kind: 'human_in_session' }, channel: 'session',
    scope_digest: approvedContract.digest, revision: candidate, timestamp: now(),
  });
  const target = { repository: 'fixture/repo', pr: 999, headSha: candidate, baseBranch: 'main' };
  if (extraAncestorApproval) {
    // Named so it sorts FIRST: an ancestor, for other content. And the matching one is granted
    // at a commit that is not in the merge at all.
    recordIntegrationApproval(repo.root, 'c1', integrationApproval({
      approvalId: 'ap-a-ancestor', changeId: 'c1', scopeDigest: 'sha256:something-else-entirely',
      revision: ancestor, manifest, target,
    }));
    repo.git(['checkout', '-q', '-b', 'sibling', base]);
    writeFileSync(join(repo.root, 'app.js'), 'export const n = 2;\n');
    mkdirSync(join(repo.root, 'docs/changes/c1'), { recursive: true });
    writeFileSync(join(repo.root, contractFile), '# Approved: refuse an invalid account\n');
    writeFileSync(join(repo.root, taskFile), '- [x] build it\n');
    repo.git(['add', '-A']); repo.git(['commit', '-qm', 'the same content, off to one side']);
    const sibling = repo.git(['rev-parse', 'HEAD']).trim();
    repo.git(['checkout', '-q', 'candidate']);
    recordIntegrationApproval(repo.root, 'c1', integrationApproval({
      approvalId: 'ap-z-matching', changeId: 'c1',
      scopeDigest: gatedDigest(contractDigestAt(repo.root, merge, change).digest, contentDigestAt(repo.root, merge).digest),
      revision: sibling, manifest, target,
    }));
  } else {
    recordIntegrationApproval(repo.root, 'c1', integrationApproval({
      approvalId: 'ap-integration', changeId: 'c1', scopeDigest: approvedGate,
      revision: candidate, manifest, target,
    }));
  }

  for (const property of ['pass2.attack', 'ci.green']) {
    store.putEvidence({
      schema_version: '1.0.0', evidence_id: `ev-${property}`, change_id: 'c1', property,
      check: 'synthetic fixture', source_kind: 'observed_execution',
      executor: { role: property === 'pass2.attack' ? 'quality_engineer' : 'platform_engineer', independent_of: ['full_stack_developer'] },
      revision: landed.revision, fingerprint: landed.digest, contract_digest: landedContract.digest,
      result: 'PASS', timestamp: now(),
    });
  }

  const pr = {
    number: 999, state: 'MERGED', mergedAt: now(), mergeCommit: { oid: merge },
    headRefOid: candidate, headRefName: 'candidate', baseRefName: 'main',
    url: 'https://example.invalid/pr/999',
  };
  const green = greenRun(merge);
  const shim = stubGh(tempDir('spectree-gh-'), {
    repo: 'fixture/repo', pr, runs: [green.run], jobs: { [String(green.run.databaseId)]: green.jobs },
  });

  const post = (...args) => closureCli(join(REPO, 'scripts/post-merge.mjs'), ['c1', '--pr', '999', ...args],
    { cwd: repo.root, env: { PATH: shim.path() } });
  /** The same confirmation, called in this process: the project root is NOT this process's cwd. */
  const confirm = (...args) => {
    const out = [];
    const err = [];
    const path = process.env.PATH;
    process.env.PATH = shim.path(path);
    try {
      const code = confirmMerge({ root: repo.root, argv: args, out: (x) => out.push(x), err: (x) => err.push(x) });
      return { code, out: out.join('\n'), err: err.join('\n') };
    } finally { process.env.PATH = path; }
  };
  const stateNow = () => new Store(repo.root).change('c1').state;
  /** Replace the runs (and their jobs) the transport reports for this merge. */
  const setRuns = (runs, jobs) => shim.set({ repo: 'fixture/repo', pr, runs, jobs: jobs ?? {} });
  const drop = () => { cleanup(repo.root); cleanup(join(shim.dir, '..')); };
  return { ...repo, store, post, confirm, stateNow, setRuns, candidate, merge, base, manifest, green, drop };
}

test('a merge that landed different content does not close the change, however good the checkout looks', () => {
  const f = fixture({ mergeDiffers: true });
  try {
    // The local checkout IS the approved candidate. The merge is not.
    assert.notEqual(f.git(['rev-parse', `${f.candidate}^{tree}`]).trim(), f.git(['rev-parse', `${f.merge}^{tree}`]).trim());

    const r = f.post('--apply', '--json');
    assert.equal(r.code, 1);
    const summary = JSON.parse(r.out);
    const failed = summary.steps.filter((s) => !s.ok).map((s) => s.name);
    assert.ok(failed.includes('what landed is what was authorised'), `expected the content check to fail, got ${failed.join(', ')}`);
    assert.ok(failed.includes('one approval covers the content and the history'));
    assert.equal(summary.closed, false);
    assert.equal(f.stateNow(), 'integration_approved', 'and nothing moved');
  } finally { f.drop(); }
});

test('a merge that carries the approved tree closes the change, and adds no commit', () => {
  const f = fixture();
  try {
    const before = f.git(['rev-parse', 'HEAD']).trim();
    const dry = f.post('--json');
    assert.equal(dry.code, 0, `${dry.err}\n${dry.out}`);
    assert.equal(JSON.parse(dry.out).closed, false, 'a plan closes nothing');
    assert.equal(f.stateNow(), 'integration_approved');

    const r = f.post('--apply', '--json');
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).closed, true);
    assert.equal(f.stateNow(), 'closed');
    assert.equal(f.git(['rev-parse', 'HEAD']).trim(), before, 'confirming the merge is not a commit');
    assert.equal(f.git(['status', '--porcelain']).trim(), '', 'and it leaves nothing uncommitted');
  } finally { f.drop(); }
});

test('running the same confirmation again is idempotent, not an illegal transition', () => {
  const f = fixture();
  try {
    assert.equal(f.post('--apply', '--json').code, 0);
    assert.equal(f.stateNow(), 'closed');

    const again = f.post('--apply', '--json');
    assert.equal(again.code, 0, again.err);
    assert.doesNotMatch(again.err, /E_ILLEGAL_TRANSITION/);
    assert.equal(JSON.parse(again.out).closed, true);

    const trail = readFileSync(join(f.root, '.spectree/history/c1.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(trail.filter((e) => e.type === 'integration_observed').length, 1, 'one merge, one event');
    assert.equal(trail.filter((e) => e.to === 'closed').length, 1);
  } finally { f.drop(); }
});

test('an interruption between the two transitions is resumed, not restarted', () => {
  const f = fixture();
  try {
    // Interrupted after `integrated` was written and before `closed` was.
    const c = f.store.change('c1');
    f.store.putChange({ ...c, state: 'integrated' }, { event: { type: 'transition', from: c.state, to: 'integrated' }, expected: c.state_revision });
    assert.equal(f.stateNow(), 'integrated');

    const r = f.post('--apply', '--json');
    assert.equal(r.code, 0, r.err);
    assert.equal(f.stateNow(), 'closed');
    const trail = readFileSync(join(f.root, '.spectree/history/c1.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(trail.filter((e) => e.to === 'integrated').length, 1, 'the step already taken is not taken twice');
  } finally { f.drop(); }
});

test('a required run that failed, was cancelled, or never reported stops the closure', () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
    const f = fixture();
    try {
      const bad = greenRun(f.merge, { conclusion });
      f.setRuns([bad.run], { [String(bad.run.databaseId)]: bad.jobs });
      const r = f.post('--apply', '--json');
      assert.equal(r.code, 1, `${conclusion} must not close`);
      assert.match(JSON.stringify(JSON.parse(r.out).impediments), /E_CHECK_NOT_GREEN/);
      assert.equal(f.stateNow(), 'integration_approved');
    } finally { f.drop(); }
  }

  const none = fixture();
  try {
    none.setRuns([]);
    const r = none.post('--apply', '--json');
    assert.equal(r.code, 1, 'a run that never reported is not a run that passed');
    // Nothing ran at all: the refusal names the run that was never found, which is a sharper
    // answer than a check that never reported inside a run nobody located.
    assert.match(JSON.stringify(JSON.parse(r.out).impediments), /required run was found/);
  } finally { none.drop(); }

  const wrongSha = fixture();
  try {
    const elsewhere = greenRun('f'.repeat(40), { id: 5 });
    wrongSha.setRuns([elsewhere.run], { [String(elsewhere.run.databaseId)]: elsewhere.jobs });
    const r = wrongSha.post('--apply', '--json');
    assert.equal(r.code, 1, 'a green run on another commit says nothing about this one');
    assert.match(JSON.stringify(JSON.parse(r.out).impediments), /required run was found/);
  } finally { wrongSha.drop(); }
});

test('a project that never mapped its CI is unknown, and unknown is not permission', () => {
  const f = fixture({ ci: null });
  try {
    const r = f.post('--apply', '--json');
    assert.equal(r.code, 1);
    assert.match(JSON.stringify(JSON.parse(r.out).impediments), /E_CI_MAP_MISSING/);
    assert.equal(f.stateNow(), 'integration_approved');
  } finally { f.drop(); }
});

test('without a closure preparation covering what landed, the change does not close', () => {
  const f = fixture({ prepared: false });
  try {
    const r = f.post('--apply', '--json');
    assert.equal(r.code, 1);
    assert.match(JSON.stringify(JSON.parse(r.out).impediments), /E_PREP_MISSING/);
    assert.equal(f.stateNow(), 'integration_approved');
  } finally { f.drop(); }
});

test('the fields asked of gh are fields gh has', () => {
  // `gh pr view --json merged` fails with "Unknown JSON field: merged". The state is MERGED and
  // mergedAt carries the moment; asking for a field that does not exist is not a smoke pending,
  // it is a contract that never worked.
  const src = readFileSync(join(REPO, 'scripts/lib/shared/gh.mjs'), 'utf8');
  const fields = /const want = fields \?\? \[([^\]]+)\]/.exec(src)[1];
  assert.doesNotMatch(fields, /'merged'/, 'there is no such field');
  for (const f of ['state', 'mergedAt', 'mergeCommit', 'baseRefName']) {
    assert.match(fields, new RegExp(`'${f}'`), `${f} is what the confirmation reads`);
  }
  assert.match(src, /workflowName/, 'runs are matched on the workflow name gh actually reports');
});

test('a confirmation asks by identity and downloads no logs', () => {
  const f = fixture();
  try {
    const r = f.post('--apply', '--json');
    assert.equal(r.code, 0, r.err);
    const m = JSON.parse(r.out).metrics;
    // The count is bounded and reported rather than fixed at a magic number: the repository,
    // the PR, the runs on that commit, and that one run's jobs. Pinning it at two once made a
    // correct extra query look like a regression.
    assert.ok(m.gh_calls > 0 && m.gh_calls <= 6, `bounded transport, got ${m.gh_calls}`);
    assert.equal(m.log_bytes, 0, 'a green path downloads no log');
    assert.ok(typeof m.elapsed_ms === 'number');

    // And the queries themselves are scoped: repository, commit and workflow, server-side.
    const src = readFileSync(join(REPO, 'scripts/lib/shared/gh.mjs'), 'utf8');
    assert.match(src, /'--repo'/, 'which repository is not a thing to infer');
    assert.match(src, /'--commit'/, 'runs are asked for by commit, not filtered after the fact');
    assert.match(src, /'--workflow'/);
    assert.doesNotMatch(src, /gh\W+api\W+repos/, 'no unbounded API reads');
  } finally { f.drop(); }
});

test('a full page of runs is an incomplete answer, and incomplete is not green', () => {
  const f = fixture();
  try {
    // Thirty runs belonging to other commits, and the one being looked for is not among them.
    // The old query fetched the most recent fifty of the whole repository and filtered
    // afterwards, so this was reported as "it did not run".
    const others = Array.from({ length: 30 }, (_, i) => greenRun('f'.repeat(40), { id: 100 + i }).run);
    f.setRuns(others, {});
    const r = f.post('--apply', '--json');
    assert.equal(r.code, 1);
    const failed = JSON.parse(r.out).steps.filter((s) => !s.ok);
    assert.match(JSON.stringify(failed), /required run was found|never reported/);
    assert.equal(f.stateNow(), 'integration_approved');
  } finally { f.drop(); }
});

test('an older green attempt does not speak for the re-run that replaced it', () => {
  const f = fixture();
  try {
    const old = greenRun(f.merge, { id: 1, attempt: 1 });
    const rerun = greenRun(f.merge, { id: 2, attempt: 2, conclusion: 'failure' });
    // Deliberately ordered with the green one first: the order of a response is not a decision.
    f.setRuns([old.run, rerun.run], {
      [String(old.run.databaseId)]: old.jobs,
      [String(rerun.run.databaseId)]: rerun.jobs,
    });
    const r = f.post('--apply', '--json');
    assert.equal(r.code, 1, 'the latest run of that workflow is the one that speaks');
    assert.match(JSON.stringify(JSON.parse(r.out).impediments), /E_CHECK_NOT_GREEN/);
  } finally { f.drop(); }
});

test('a merge that rewrote the contract does not close, even with the code untouched', () => {
  const f = fixture({ rewriteContractInMerge: true });
  try {
    // `docs/changes/` is outside the code digest by design, so a merge that quietly edits the
    // proposal moves nothing the code comparison can see. Reading the contract from the local
    // checkout answered a question about the operator's disk.
    assert.match(readFileSync(join(f.root, 'docs/changes/c1/proposal.md'), 'utf8'), /refuse/, 'the checkout still says refuse');
    assert.match(f.git(['show', `${f.merge}:docs/changes/c1/proposal.md`]), /accept/, 'the merge says accept');

    const r = f.post('--apply', '--json');
    assert.equal(r.code, 1);
    const failed = JSON.parse(r.out).steps.filter((s) => !s.ok).map((s) => s.name);
    assert.ok(failed.includes('what landed is what was authorised'), `got ${failed.join(', ')}`);
    assert.equal(f.stateNow(), 'integration_approved');
  } finally { f.drop(); }
});

test('one approval has to satisfy both halves; two cannot supply one each', () => {
  const f = fixture({ extraAncestorApproval: true });
  try {
    // An older approval that IS an ancestor but names other content, plus the one that names
    // this content but was granted outside the merge. Checking content against whichever
    // matches and history against whichever is first let the pair authorise between them.
    const r = f.post('--apply', '--json');
    assert.equal(r.code, 1);
    const summary = JSON.parse(r.out);
    const failed = summary.steps.filter((s) => !s.ok).map((s) => s.name);
    assert.ok(failed.includes('one approval covers the content and the history'), `got ${failed.join(', ')}`);
    assert.equal(f.stateNow(), 'integration_approved');
  } finally { f.drop(); }
});

test('a prepared artifact altered in the merge is not the artifact that was prepared', () => {
  const f = fixture({ alterArtifactInMerge: true });
  try {
    const r = f.post('--apply', '--json');
    assert.equal(r.code, 1);
    const failed = JSON.parse(r.out).steps.filter((s) => !s.ok).map((s) => s.name);
    assert.ok(failed.includes('prepared artifacts are in the merge, unchanged and alone'), `got ${failed.join(', ')}`);
  } finally { f.drop(); }
});

test('a file the repository stores with CRLF digests the same in the checkout and in the merge', () => {
  // Git for Windows ships core.autocrlf=true. `hash-object` then converts CRLF to LF even for a
  // file whose committed blob keeps CRLF, so the checkout and the merge tree named the same bytes
  // differently and every confirmation on that machine refused a merge that was correct.
  const repo = gitRepo({ '.gitignore': '.spectree/\n' });
  try {
    repo.git(['config', 'core.autocrlf', 'false']);
    mkdirSync(join(repo.root, 'docs/changes/c1'), { recursive: true });
    writeFileSync(join(repo.root, 'app.js'), 'export const n = 1;\r\n');
    writeFileSync(join(repo.root, 'docs/changes/c1/proposal.md'), '# c1\r\n');
    repo.git(['add', '-A']);
    repo.git(['commit', '-qm', 'crlf in the repository']);
    repo.git(['config', 'core.autocrlf', 'true']);
    const change = { change_id: 'c1' };
    assert.equal(contentDigest(repo.root).digest, contentDigestAt(repo.root, 'HEAD').digest);
    assert.equal(contractDigest(repo.root, change).digest, contractDigestAt(repo.root, 'HEAD', change).digest);
  } finally { cleanup(repo.root); }
});

test('in process: usage errors are answered with exit 2, not exited', () => {
  const f = fixture();
  try {
    const none = f.confirm();
    assert.equal(none.code, 2);
    assert.match(none.err, /^usage: post-merge\.mjs/);
    const noPr = f.confirm('c1');
    assert.equal(noPr.code, 2);
    assert.match(noPr.err, /^--pr <number> is required/);
    assert.equal(f.confirm('nope', '--pr', '999').code, 1);
  } finally { f.drop(); }
});

test('in process: the approved merge plans, closes, and confirms again without moving', () => {
  const f = fixture();
  try {
    const dry = f.confirm('c1', '--pr', '999', '--json');
    assert.equal(dry.code, 0, dry.err);
    assert.equal(JSON.parse(dry.out).closed, false);
    assert.equal(f.stateNow(), 'integration_approved');

    const closed = f.confirm('c1', '--pr', '999', '--apply');
    assert.equal(closed.code, 0, closed.err);
    assert.match(closed.out, /closed c1\. PR #999/);
    assert.equal(f.stateNow(), 'closed');

    const again = f.confirm('c1', '--pr', '999', '--apply', '--json');
    assert.equal(again.code, 0, again.err);
    assert.equal(JSON.parse(again.out).closed, true);
  } finally { f.drop(); }
});

test('in process: a merge that landed different content is refused with exit 1', () => {
  const f = fixture({ mergeDiffers: true });
  try {
    const r = f.confirm('c1', '--pr', '999', '--apply');
    assert.equal(r.code, 1);
    assert.match(r.err, /^post-merge REFUSED for c1/);
    assert.equal(f.stateNow(), 'integration_approved');
  } finally { f.drop(); }
});
