// The shared core: CLI flags, git and timestamps are written once, in scripts/lib/shared/.
// Each guard below is first shown rejecting the hand-rolled form it exists to keep out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { flags } from '../scripts/lib/shared/cli.mjs';
import { REPO } from './helpers.mjs';

const SHARED = join(REPO, 'scripts', 'lib', 'shared');
function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return p === SHARED ? [] : sources(p);
    return e.name.endsWith('.mjs') ? [p] : [];
  });
}
const outsideShared = [...sources(join(REPO, 'scripts')), ...sources(join(REPO, 'bench'))]
  .map((p) => ({ path: relative(REPO, p), text: readFileSync(p, 'utf8') }));

const FLAG_LOOKUP = /indexOf\(`--\$\{/;
// A local helper named git that calls the binary itself. A domain function that runs one git
// command is not a helper and is not what this catches.
const GIT_WRAPPER = /(?:const|let)\s+git\s*=\s*\([^)]*\)\s*=>\s*(?:\{[^}]*?)?execFileSync\(\s*'git'|function\s+git\s*\([^)]*\)\s*\{[^}]*?execFileSync\(\s*'git'/;
const STAMP = /const\s+stamp\s*=\s*\(\)\s*=>/;

test('the guards recognise the hand-rolled forms they keep out', () => {
  assert.match("const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return argv[i + 1]; };", FLAG_LOOKUP);
  assert.match("const git = (args) => execFileSync('git', args, { cwd: root });", GIT_WRAPPER);
  assert.match("function git(args, fallback = null) {\n  try { return execFileSync('git', args, { cwd: root }).trim(); }", GIT_WRAPPER);
  assert.match("const stamp = () => new Date().toISOString();", STAMP);
  assert.match("const git = (args) => {\n  metrics.calls += 1;\n  return execFileSync('git', args, { cwd: root }).trim();", GIT_WRAPPER);
  assert.doesNotMatch("function inventory(root) {\n  const names = execFileSync('git', ['ls-files'], { cwd: root });", GIT_WRAPPER,
    'a domain function that runs one git command is not a helper');
});

test('no CLI reads a flag value by hand', () => {
  assert.deepEqual(outsideShared.filter((f) => FLAG_LOOKUP.test(f.text)).map((f) => f.path), []);
});

test('no module wraps git in a helper of its own', () => {
  assert.deepEqual(outsideShared.filter((f) => GIT_WRAPPER.test(f.text)).map((f) => f.path), []);
});

test('the record timestamp is defined once', () => {
  assert.deepEqual(outsideShared.filter((f) => STAMP.test(f.text)).map((f) => f.path), []);
});

test('a flag followed by another flag has no value', () => {
  const f = flags(['c1', '--reason', '--apply', '--base', 'main']);
  assert.equal(f.value('reason'), undefined);
  assert.equal(f.value('reason', 'fallback'), 'fallback');
  assert.equal(f.value('base'), 'main');
  assert.equal(f.has('apply'), true);
  assert.equal(f.has('json'), false);
});

test('an empty value is missing unless the caller keeps it', () => {
  assert.equal(flags(['--reason', '']).value('reason', 'x'), 'x');
  assert.equal(flags(['--reason', ''], { emptyIsValue: true }).value('reason', 'x'), '');
  assert.equal(flags(['--reason']).value('reason', 'x'), 'x');
});

test('verify-change refuses --head without a revision instead of diffing a flag', () => {
  for (const args of [['c1', '--head'], ['c1', '--head', '--json']]) {
    const r = spawnSync(process.execPath, [join(REPO, 'scripts', 'verify-change.mjs'), ...args], { encoding: 'utf8' });
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
    assert.match(r.stderr, /usage: verify-change\.mjs/);
  }
});
