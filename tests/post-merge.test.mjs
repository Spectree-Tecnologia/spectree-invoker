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
import { writeFileSync, mkdirSync, readFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../scripts/lib/store.mjs';
import { contractDigest, contentDigestAt, gatedDigest } from '../scripts/lib/digest.mjs';
import { buildManifest } from '../scripts/lib/closure-prep.mjs';
import { gitRepo, tempDir, cleanup, now, REPO } from './helpers.mjs';

/** A `gh` on PATH that answers from a JSON file the test controls. */
function stubGh(dir, { pr, runs }) {
  const shim = join(dir, 'shim');
  mkdirSync(shim, { recursive: true });
  writeFileSync(join(shim, 'answers.json'), JSON.stringify({ pr, runs }));
  writeFileSync(join(shim, 'gh.cjs'), [
    "const { readFileSync } = require('node:fs');",
    "const a = JSON.parse(readFileSync(require('node:path').join(__dirname, 'answers.json'), 'utf8'));",
    "process.stdout.write(JSON.stringify(process.argv[2] === 'pr' ? a.pr : a.runs));",
  ].join('\n'));
  writeFileSync(join(shim, 'gh.cmd'), `@"${process.execPath}" "${join(shim, 'gh.cjs')}" %*\r\n`);
  writeFileSync(join(shim, 'gh'), `#!/bin/sh\nexec "${process.execPath}" "${join(shim, 'gh.cjs')}" "$@"\n`);
  try { chmodSync(join(shim, 'gh'), 0o755); } catch { /* Windows */ }
  return shim;
}

/**
 * A change that reached `integration_approved`, with a merge on `main` and an approval bound to
 * whichever tree the caller says was authorised.
 */
function fixture({ mergeDiffers = false, prepared = true, ci = ['check'] } = {}) {
  const repo = gitRepo({ 'app.js': 'export const n = 1;\n', '.gitignore': '.spectree/\n' });
  const base = repo.base;

  repo.git(['checkout', '-q', '-b', 'candidate']);
  writeFileSync(join(repo.root, 'app.js'), 'export const n = 2;\n');
  repo.git(['add', '-A']); repo.git(['commit', '-qm', 'the approved candidate']);
  const candidate = repo.git(['rev-parse', 'HEAD']).trim();

  repo.git(['checkout', '-q', 'main']);
  if (mergeDiffers) {
    // A merge that landed something else entirely — and a local checkout that still looks right.
    writeFileSync(join(repo.root, 'app.js'), 'export const n = 999;\n');
    repo.git(['add', '-A']); repo.git(['commit', '-qm', 'something else']);
  } else {
    repo.git(['merge', '--no-ff', '-q', '-m', 'merge candidate', 'candidate']);
  }
  const merge = repo.git(['rev-parse', 'HEAD']).trim();
  repo.git(['checkout', '-q', 'candidate']);

  const store = new Store(repo.root);
  store.init({
    project_id: 'fixture', protocol_version: '1.0.0',
    ...(ci ? { ci: { required_runs: ci } } : {}),
  });
  const change = {
    schema_version: '1.0.0', project_id: 'fixture', change_id: 'c1', change_type: 'feature',
    protocol_version: '1.0.0', adapter: 'codex', base_revision: base, scope: 'fixture',
    allowed_paths: ['app.js'], deltaless: true, state: 'integration_approved',
  };
  store.putChange(change, { event: { type: 'opened' } });

  // The approval names the tree that was actually reviewed: the candidate's.
  const contract = contractDigest(repo.root, change);
  const approved = contentDigestAt(repo.root, candidate);
  for (const gate of ['scope', 'integration']) {
    store.putApproval({
      schema_version: '1.0.0', approval_id: `ap-${gate}`, change_id: 'c1', gate,
      granted_by: { identity: 'fixture', kind: 'human_in_session' }, channel: 'session',
      scope_digest: gate === 'scope' ? contract.digest : gatedDigest(contract.digest, approved.digest),
      revision: candidate, timestamp: now(),
    });
  }
  const landed = contentDigestAt(repo.root, merge);
  for (const property of ['pass2.attack', 'ci.green']) {
    store.putEvidence({
      schema_version: '1.0.0', evidence_id: `ev-${property}`, change_id: 'c1', property,
      check: 'synthetic fixture', source_kind: 'observed_execution',
      executor: { role: property === 'pass2.attack' ? 'quality_engineer' : 'platform_engineer', independent_of: ['full_stack_developer'] },
      revision: landed.revision, fingerprint: landed.digest, contract_digest: contract.digest,
      result: 'PASS', timestamp: now(),
    });
  }
  if (prepared) {
    mkdirSync(join(repo.root, '.spectree/closure'), { recursive: true });
    writeFileSync(join(repo.root, '.spectree/closure/c1.json'), JSON.stringify(buildManifest({
      changeId: 'c1', baseRevision: base, contractDigest: contract.digest,
      candidateDigest: landed.digest, preparedAt: now(),
    })));
  }

  const pr = {
    number: 999, state: 'MERGED', mergedAt: now(), mergeCommit: { oid: merge },
    headRefOid: candidate, headRefName: 'candidate', baseRefName: 'main',
    url: 'https://example.invalid/pr/999',
  };
  const runs = (ci ?? ['check']).map((name) => ({
    databaseId: 1, name, workflowName: name, status: 'completed', conclusion: 'success', headSha: merge,
  }));
  const shim = stubGh(tempDir('spectree-gh-'), { pr, runs });

  const post = (...args) => {
    const r = spawnSync(process.execPath, [join(REPO, 'scripts/post-merge.mjs'), 'c1', '--pr', '999', ...args], {
      cwd: repo.root, encoding: 'utf8',
      env: { ...process.env, PATH: `${shim}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}` },
    });
    return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
  };
  const stateNow = () => new Store(repo.root).change('c1').state;
  const setRuns = (list) => writeFileSync(join(shim, 'answers.json'), JSON.stringify({ pr, runs: list }));
  const drop = () => { cleanup(repo.root); cleanup(join(shim, '..')); };
  return { ...repo, store, post, stateNow, setRuns, candidate, merge, base, drop };
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
    assert.ok(failed.includes('the approved commit is in the merge'));
    assert.equal(summary.closed, false);
    assert.equal(f.stateNow(), 'integration_approved', 'and nothing moved');
  } finally { f.drop(); }
});

test('a merge that carries the approved tree closes the change, and adds no commit', () => {
  const f = fixture();
  try {
    const before = f.git(['rev-parse', 'HEAD']).trim();
    const dry = f.post('--json');
    assert.equal(dry.code, 0, dry.err);
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
      f.setRuns([{ databaseId: 1, name: 'check', workflowName: 'check', status: 'completed', conclusion, headSha: f.merge }]);
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
    assert.match(JSON.stringify(JSON.parse(r.out).impediments), /E_CHECK_MISSING/);
  } finally { none.drop(); }

  const wrongSha = fixture();
  try {
    wrongSha.setRuns([{ databaseId: 1, name: 'check', workflowName: 'check', status: 'completed', conclusion: 'success', headSha: 'f'.repeat(40) }]);
    const r = wrongSha.post('--apply', '--json');
    assert.equal(r.code, 1, 'a green run on another commit says nothing about this one');
    assert.match(JSON.stringify(JSON.parse(r.out).impediments), /E_CHECK_MISSING/);
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
  const src = readFileSync(join(REPO, 'scripts/lib/gh.mjs'), 'utf8');
  const fields = /const want = fields \?\? \[([^\]]+)\]/.exec(src)[1];
  assert.doesNotMatch(fields, /'merged'/, 'there is no such field');
  for (const f of ['state', 'mergedAt', 'mergeCommit', 'baseRefName']) {
    assert.match(fields, new RegExp(`'${f}'`), `${f} is what the confirmation reads`);
  }
  assert.match(src, /workflowName/, 'runs are matched on the workflow name gh actually reports');
});

test('gh is asked for one PR and one run list, not for a log to re-read', () => {
  const src = readFileSync(join(REPO, 'scripts/lib/gh.mjs'), 'utf8');
  assert.match(src, /--json/, 'every query names its fields');
  assert.doesNotMatch(src, /gh\W+api\W+repos/, 'no unbounded API reads');
  const post = readFileSync(join(REPO, 'scripts/post-merge.mjs'), 'utf8');
  assert.equal((post.match(/pullRequest\(/g) ?? []).length, 1, 'the PR is read once');
  assert.equal((post.match(/runsForSha\(/g) ?? []).length, 1, 'the runs are read once');
});
