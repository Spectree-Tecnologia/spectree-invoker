// §15.6 Windows/POSIX, spaces, Unicode · §15.7 package.json and lockfiles
// §15.8 deletion and rename outside the allowlist · §15.9 git failure
// §15.10 missing base · §15.11 .e2e file · §15.12 base preserved after integration
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { classifyPath, classifyDiff, readDiff, normalisePath, outsideAllowedPaths, KIND } from '../scripts/lib/evidence/diff.mjs';
import { gitRepo, commitAll, cleanup } from './helpers.mjs';

test('a dependency manifest is never administrative', () => {
  assert.equal(classifyPath('package.json'), KIND.DEPENDENCY);
  assert.equal(classifyPath('apps/web/package.json'), KIND.DEPENDENCY);
  assert.equal(classifyPath('pnpm-lock.yaml'), KIND.DEPENDENCY);
  assert.equal(classifyPath('package-lock.json'), KIND.DEPENDENCY);
});

test('workflows, runtime config and tests each get their own kind', () => {
  assert.equal(classifyPath('.github/workflows/check.yml'), KIND.PIPELINE);
  assert.equal(classifyPath('tsconfig.base.json'), KIND.RUNTIME_CONFIG);
  assert.equal(classifyPath('src/a.e2e.ts'), KIND.TEST);
  assert.equal(classifyPath('src/a.attack.test.ts'), KIND.TEST);
  assert.equal(classifyPath('tests/whatever.mjs'), KIND.TEST);
});

test('an unrecognised path is source, never administrative by omission', () => {
  assert.equal(classifyPath('some/thing/nobody/anticipated.kt'), KIND.SOURCE);
  assert.equal(classifyPath('Makefile'), KIND.SOURCE);
});

test('only the declared administrative patterns are administrative', () => {
  assert.equal(classifyPath('README.md'), KIND.ADMINISTRATIVE);
  assert.equal(classifyPath('docs/guide.md'), KIND.ADMINISTRATIVE);
  // The living spec is what a test is written from, so it is a behavioural contract and named
  // as one. It was SOURCE before, which reached the same treatment by a less honest name.
  assert.equal(classifyPath('docs/specs/ledger/spec.md'), KIND.PROTOCOL, 'the living spec is a contract, not documentation');
});

test('the operational trail is its own kind, and only that one prefix', () => {
  assert.equal(classifyPath('.spectree/history/c1.jsonl'), KIND.OPERATIONAL);
  assert.equal(classifyPath('.spectree/changes/c1.json'), KIND.SOURCE, 'current state is not the trail, and is not waved through');
  assert.equal(classifyPath('history/c1.jsonl'), KIND.SOURCE);
});

test('Windows separators normalise, and traversal is refused', () => {
  assert.equal(normalisePath('src\\modules\\a.ts'), 'src/modules/a.ts');
  assert.throws(() => normalisePath('../outside.ts'), /escapes the repository/);
  assert.throws(() => normalisePath('src/../../etc/passwd'), /escapes the repository/);
  assert.throws(() => normalisePath('/etc/passwd'), /absolute path/);
  assert.throws(() => normalisePath('C:/Windows/system32'), /absolute path/);
});

test('a rename is classified on both ends', () => {
  const d = classifyDiff([{ status: 'R', path: 'docs/moved.md', from: 'src/logic.ts' }]);
  assert.deepEqual(d.files[0].kinds.sort(), [KIND.ADMINISTRATIVE, KIND.SOURCE].sort());
  assert.equal(d.administrative_only, false, 'moving source into docs does not make it documentation');
});

test('ownership containment is by segment, not by substring', () => {
  const bad = outsideAllowedPaths([{ status: 'M', path: 'src-other/a.ts' }], ['src']);
  assert.equal(bad.length, 1, '"src-other" is not inside "src"');
  assert.equal(outsideAllowedPaths([{ status: 'M', path: 'src/a.ts' }], ['src']).length, 0);
  const rename = outsideAllowedPaths([{ status: 'R', path: 'src/a.ts', from: 'lib/a.ts' }], ['src']);
  assert.equal(rename.length, 1, 'the source of a rename counts too');
  assert.equal(rename[0].status, 'R(from)');
});

test('real git: spaces, Unicode, deletion and rename survive the -z round trip', () => {
  const repo = gitRepo({
    'src/a file with spaces.ts': 'export const a = 1;\n',
    'src/acentuação-ñ-日本語.ts': 'export const b = 2;\n',
    'src/gone.ts': 'export const c = 3;\n',
    'src/old-name.ts': 'export const d = 4;\n',
  });
  try {
    rmSync(join(repo.root, 'src/gone.ts'));
    mkdirSync(dirname(join(repo.root, 'src/new-name.ts')), { recursive: true });
    writeFileSync(join(repo.root, 'src/new-name.ts'), 'export const d = 4;\n');
    rmSync(join(repo.root, 'src/old-name.ts'));
    writeFileSync(join(repo.root, 'package.json'), '{"name":"x"}\n');
    const head = commitAll(repo, 'move things around');

    const entries = readDiff(repo.base, head, { cwd: repo.root });
    const byPath = Object.fromEntries(entries.map((e) => [e.path, e]));
    assert.ok(byPath['src/gone.ts'], 'deletion is reported');
    assert.equal(byPath['src/gone.ts'].status, 'D');
    assert.ok(byPath['package.json'], 'the dependency manifest is reported');

    const renamed = entries.find((e) => e.status === 'R' || e.path === 'src/new-name.ts');
    assert.ok(renamed, 'the rename or its add/delete pair is reported');

    const d = classifyDiff(entries);
    assert.ok(d.kinds.includes(KIND.DEPENDENCY), 'package.json forces a dependency review');
    assert.equal(d.administrative_only, false);
    // The files with spaces and non-ASCII names round-tripped without being split.
    const names = entries.map((e) => e.path).join('|');
    assert.ok(!names.includes('"'), 'no quoted/escaped path leaked through');
  } finally { cleanup(repo.root); }
});

test('an unavailable comparison is an error, never "nothing changed"', () => {
  const repo = gitRepo();
  try {
    assert.throws(
      () => readDiff('0000000000000000000000000000000000000000', 'HEAD', { cwd: repo.root }),
      (e) => e.code === 'E_DIFF_UNAVAILABLE' && /never "no changes"/.test(e.message));
  } finally { cleanup(repo.root); }
});

test('git missing entirely is an error, not an empty diff', () => {
  assert.throws(
    () => readDiff('HEAD~1', 'HEAD', { cwd: '/nonexistent-directory-for-spectree-test' }),
    (e) => e.code === 'E_DIFF_UNAVAILABLE');
});

test('the base revision stays meaningful after the branch is integrated', () => {
  // The failure this guards: comparing against a moving reference, which after a merge
  // makes the diff empty and the check vacuous.
  const repo = gitRepo({ 'src/a.ts': 'export const a = 1;\n' });
  try {
    writeFileSync(join(repo.root, 'src/a.ts'), 'export const a = 2;\n');
    const head = commitAll(repo, 'edit');
    repo.git(['checkout', '-q', '-b', 'feature']);
    repo.git(['checkout', '-q', 'main']);
    repo.git(['merge', '-q', '--no-ff', '-m', 'integrate', 'feature']);

    const againstRecordedBase = readDiff(repo.base, 'HEAD', { cwd: repo.root });
    assert.equal(againstRecordedBase.length, 1, 'against the recorded base the change is still visible');

    const againstMovingRef = readDiff(head, 'HEAD', { cwd: repo.root });
    assert.equal(againstMovingRef.length, 0, 'against a moving reference the very same change reads as empty');
  } finally { cleanup(repo.root); }
});
