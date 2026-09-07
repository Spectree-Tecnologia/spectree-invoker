// The cycles this delivery removes, and the ones it refuses to remove.
//
// The waste it targets was measured in a consumer: one change produced five CI runs, three of
// them re-validating a commit whose only content was a note that the previous run had been
// green. Cheaper is only worth having if it cannot be talked into skipping a run that mattered,
// so every test here has an inverse: what must still be refused.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { classifyDiff, classifyPath, KIND } from '../scripts/lib/diff.mjs';
import { treatmentFor, aggregate, TREATMENT, REQUIRED_CHECKS } from '../scripts/lib/ci-policy.mjs';
import { comparePreparation, preparationCovers, buildManifest, consolidationCommand } from '../scripts/lib/closure-prep.mjs';
import { Store } from '../scripts/lib/store.mjs';
import { gitRepo, commitAll, tempDir, cleanup, change, REPO } from './helpers.mjs';

const file = (path, status = 'M') => ({ status, path });

// --- what never earns the cheap treatment -----------------------------------

test('a workflow, a config, a test or an unknown file never earns the cheap treatment', () => {
  for (const path of [
    '.github/workflows/check.yml', 'tsconfig.json', 'tests/a.test.mjs', 'package.json',
    'some/thing/nobody/anticipated.kt', 'docs/specs/account/spec.md', 'Makefile', '.env',
  ]) {
    const t = treatmentFor(classifyDiff([file(path)]));
    assert.equal(t.treatment, TREATMENT.FULL, `${path} (${classifyPath(path)}) must earn the full suite`);
  }
});

test('documentation earns the documented-closure treatment, and the trail its own', () => {
  assert.equal(treatmentFor(classifyDiff([file('docs/guide.md'), file('README.md')])).treatment, TREATMENT.DOCUMENTED_CLOSURE);
  assert.equal(treatmentFor(classifyDiff([file('.spectree/history/c1.jsonl')])).treatment, TREATMENT.OPERATIONAL_TRAIL);
  // Both together is a delivery touching two things, and the stricter of the two wins.
  assert.equal(treatmentFor(classifyDiff([file('docs/guide.md'), file('.spectree/history/c1.jsonl')])).treatment,
    TREATMENT.DOCUMENTED_CLOSURE);
  // Nothing at all is not "safe": an empty comparison is unknown.
  assert.equal(treatmentFor(classifyDiff([])).treatment, TREATMENT.FULL);
});

test('a rename out of source into docs is still source, on both ends', () => {
  const t = treatmentFor(classifyDiff([{ status: 'R', path: 'docs/moved.md', from: 'src/logic.ts' }]));
  assert.equal(t.treatment, TREATMENT.FULL, 'moving code into docs does not make it docs');
});

// --- a log commit cannot hide the code under it ------------------------------

test('the classification is of the whole candidate, so a log commit hides nothing', () => {
  const repo = gitRepo({ 'src/app.js': 'export const a = 1;\n' });
  try {
    repo.git(['checkout', '-q', '-b', 'work']);
    writeFileSync(join(repo.root, 'src/app.js'), 'export const a = 2;\n');
    commitAll(repo, 'the actual change');
    mkdirSync(join(repo.root, 'docs'), { recursive: true });
    writeFileSync(join(repo.root, 'docs/notes.md'), 'the run was green\n');
    commitAll(repo, 'record that it was green');

    const lastCommitOnly = execFileSync(process.execPath,
      [join(REPO, 'scripts/ci-treatment.mjs'), '--base', 'HEAD~1', '--json'], { cwd: repo.root, encoding: 'utf8' });
    assert.equal(JSON.parse(lastCommitOnly).treatment, TREATMENT.DOCUMENTED_CLOSURE,
      'the last commit alone really does look administrative — which is exactly the trap');

    const wholeCandidate = execFileSync(process.execPath,
      [join(REPO, 'scripts/ci-treatment.mjs'), '--base', repo.base, '--json'], { cwd: repo.root, encoding: 'utf8' });
    const t = JSON.parse(wholeCandidate);
    assert.equal(t.treatment, TREATMENT.FULL, 'against the base, the code is still there');
    assert.ok(t.deciding.some((f) => f.path === 'src/app.js'));
  } finally { cleanup(repo.root); }
});

test('an unavailable comparison classifies as full, and says so', () => {
  const repo = gitRepo();
  try {
    let out = '', code = 0;
    try {
      out = execFileSync(process.execPath, [join(REPO, 'scripts/ci-treatment.mjs'), '--base', '0'.repeat(40), '--json'],
        { cwd: repo.root, encoding: 'utf8' });
    } catch (e) { out = e.stdout ?? ''; code = e.status ?? 1; }
    assert.equal(code, 1, 'it does not exit 0 on an answer it could not compute');
    assert.equal(JSON.parse(out).treatment, TREATMENT.FULL);
    assert.match(JSON.parse(out).reason, /E_DIFF_UNAVAILABLE/);
  } finally { cleanup(repo.root); }
});

// --- a required check that did not succeed is never green --------------------

test('a failed, cancelled, or missing required check cannot aggregate to green', () => {
  const green = Object.fromEntries(REQUIRED_CHECKS[TREATMENT.FULL].map((c) => [c, 'success']));
  assert.equal(aggregate(TREATMENT.FULL, green).ok, true);

  for (const bad of ['failure', 'cancelled', 'timed_out', 'skipped', 'neutral', 'action_required', '']) {
    const r = aggregate(TREATMENT.FULL, { ...green, suite: bad });
    assert.equal(r.ok, false, `"${bad}" is not success`);
    assert.equal(r.code, 'E_CHECK_NOT_GREEN');
  }

  const missing = { ...green };
  delete missing.suite;
  const r = aggregate(TREATMENT.FULL, missing);
  assert.equal(r.ok, false, 'a check that never reported is not a check that passed');
  assert.equal(r.code, 'E_CHECK_MISSING');
  assert.deepEqual(r.missing, ['suite']);

  assert.equal(aggregate('something-nobody-declared', green).code, 'E_UNKNOWN_TREATMENT');
});

test('the workflow requires the aggregate, and decides from the policy', () => {
  const wf = readFileSync(join(REPO, '.github/workflows/check.yml'), 'utf8');
  assert.match(wf, /if: always\(\)/, 'the aggregate runs even when a needed job failed');
  assert.match(wf, /is not success/, 'and it fails on anything that is not success');
  assert.doesNotMatch(wf, /\[skip ci\]/, 'skipping CI is never the mechanism');
  assert.match(wf, /ci-treatment\.mjs/, 'the classification comes from the policy, not from a label');
  assert.doesNotMatch(wf, /pull_request\.title/, 'never the title');
});

// --- a merge without equivalence cannot close --------------------------------

test('a merge that landed different content does not close the change', () => {
  const prepared = buildManifest({
    changeId: 'c1', baseRevision: 'a'.repeat(40),
    contractDigest: 'K1', candidateDigest: 'C1', preparedAt: '2026-01-01T00:00:00Z',
  });
  assert.equal(preparationCovers(prepared, { contractDigest: 'K1', candidateDigest: 'C1' }).ok, true);

  const moved = preparationCovers(prepared, { contractDigest: 'K1', candidateDigest: 'C2' });
  assert.equal(moved.code, 'E_PREP_STALE');
  assert.match(moved.message, /same branch name is not the same content/);

  assert.equal(preparationCovers(prepared, { contractDigest: 'K2', candidateDigest: 'C1' }).code, 'E_PREP_STALE');
  assert.equal(preparationCovers(null, { contractDigest: 'K1', candidateDigest: 'C1' }).code, 'E_PREP_MISSING');

  const blocked = { ...prepared, blocking: ['the consolidation failed'] };
  assert.equal(preparationCovers(blocked, { contractDigest: 'K1', candidateDigest: 'C1' }).code, 'E_PREP_BLOCKED');
});

// --- idempotent, and a collision refused -------------------------------------

test('the same preparation twice is unchanged; a different one is a collision', () => {
  const a = buildManifest({ changeId: 'c1', baseRevision: 'b', contractDigest: 'K', candidateDigest: 'C', preparedAt: 't' });
  assert.equal(comparePreparation(null, a).state, 'new');
  assert.equal(comparePreparation(a, a).state, 'unchanged');
  assert.equal(comparePreparation({ ...a, change_id: 'c2' }, a).code, 'E_PREP_COLLISION');
  assert.equal(comparePreparation({ ...a, manifest_version: '0.9.0' }, a).code, 'E_PREP_CONTRACT_VERSION');
  assert.equal(comparePreparation({ ...a, candidate_digest: 'OTHER' }, a).code, 'E_PREP_STALE');
});

// --- a legacy consumer is told, in as many words -----------------------------

test('a project that declares no consolidation mechanism is named, not improvised for', () => {
  const r = consolidationCommand({ project_id: 'p' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'E_NO_CONSOLIDATION');
  assert.match(r.message, /Hand-editing docs\/specs\/ is not the fallback/);

  assert.deepEqual(consolidationCommand({ closure: { consolidate: ['npm', 'run', 'spec:merge'] } }).command,
    ['npm', 'run', 'spec:merge']);
  assert.equal(consolidationCommand({ closure: { consolidate: [] } }).code, 'E_NO_CONSOLIDATION');
});

// --- resume across an interruption -------------------------------------------

test('resume answers the same before and after the merge, from artifacts alone', () => {
  const dir = tempDir('spectree-resume-');
  try {
    const s = new Store(dir);
    s.init({ project_id: 'p', protocol_version: '1.0.0' });
    s.putChange(change({ state: 'ci_green' }), { event: { type: 'transition', to: 'ci_green' } });

    // Interrupted before the merge: a fresh reader finds the same state, and no memory of it.
    assert.equal(new Store(dir).change('c1').state, 'ci_green');

    s.putChange({ ...s.change('c1'), state: 'integrated' }, { event: { type: 'transition', to: 'integrated' }, expected: 1 });
    const after = new Store(dir);
    assert.equal(after.change('c1').state, 'integrated');
    assert.deepEqual(after.history('c1').map((e) => e.to), ['ci_green', 'integrated'],
      'the trail is append-only, and picking the work back up reads it rather than a session');
  } finally { cleanup(dir); }
});

// --- the trail is not a commit ------------------------------------------------

test('the operational trail is exportable, and it is not part of what it describes', () => {
  const repo = gitRepo({ 'src/a.js': 'export const a = 1;\n', '.gitignore': '.spectree/\n' });
  const out = join(tempDir('spectree-trail-'), 'trail.jsonl');
  try {
    const s = new Store(repo.root);
    s.init({ project_id: 'p', protocol_version: '1.0.0' });
    s.putChange(change({ state: 'draft' }), { event: { type: 'opened' } });
    s.appendHistory('c1', { type: 'integration_observed', at: '2026-01-01T00:00:00Z', pr: 42 });

    execFileSync(process.execPath, [join(REPO, 'scripts/state.mjs'), 'trail', 'c1', '--export', out], { cwd: repo.root });
    const lines = readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.ok(lines.some((e) => e.type === 'integration_observed' && e.pr === 42));
    assert.ok(lines.every((e) => e.change_id === 'c1'), 'every event names the change it applies to');

    // Recording the merge added no commit and left the work tree clean.
    assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: repo.root, encoding: 'utf8' }).trim(), '');
    assert.equal(classifyPath('.spectree/history/c1.jsonl'), KIND.OPERATIONAL);
  } finally { cleanup(repo.root); cleanup(join(out, '..')); }
});

// --- both adapters carry the same protocol ------------------------------------

test('the protocol reaches both adapters identically, including the new closure rules', async () => {
  const { renderAdapter } = await import('../scripts/build.mjs');
  const claude = renderAdapter('claude-code').find((f) => f.path === 'CLAUDE.md').content;
  const codex = renderAdapter('codex').find((f) => f.path.endsWith('SQUAD.md')).content;
  for (const marker of [
    'Preparing the closure before the merge is not declaring the integration before it happens',
    'The post-merge phase is a confirmation, and it is finite',
    'Never accept two representations of the same concept across modules',
  ]) {
    assert.ok(claude.includes(marker), `claude-code carries: ${marker}`);
    assert.ok(codex.includes(marker), `codex carries: ${marker}`);
  }
  // Same body, different addressing: neither adapter may quietly drop a rule the other has.
  const rules = (t) => t.split('\n').filter((l) => /^- Never /.test(l.trim())).map((l) => l.trim());
  assert.ok(rules(claude).length >= 15, 'the refusals are actually in there');
  assert.deepEqual(rules(claude), rules(codex), 'the refusals are the same list in both');
});

test('the installed consumer gets the closure and CI tooling, not just the state machine', () => {
  const dir = tempDir('spectree-install-tools-');
  try {
    execFileSync(process.execPath, [join(REPO, 'scripts/install-codex.mjs'), dir, '--apply'], { encoding: 'utf8' });
    for (const f of [
      'state.mjs', 'prepare-closure.mjs', 'post-merge.mjs', 'ci-treatment.mjs',
      'lib/ci-policy.mjs', 'lib/closure-prep.mjs', 'lib/gh.mjs',
    ]) {
      assert.ok(existsSync(join(dir, '.spectree/squad/scripts', f)), `${f} travels with the squad`);
    }
  } finally { cleanup(dir); }
});
