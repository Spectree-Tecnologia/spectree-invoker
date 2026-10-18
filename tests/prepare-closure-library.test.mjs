// Closure preparation, called as a function in this process — no child process, no exit.
//
// The command line is only `prepareClosure({ root, argv })` and an exit code, so every flow it
// has must be reachable from here: the dry run, the write, the second run that finds nothing to
// do, and each refusal. The project root is a temporary repository and NOT the working directory
// of this process, so anything that still read `process.cwd()` would prepare the wrong project.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../scripts/lib/change/store.mjs';
import { prepareClosure } from '../scripts/lib/closure/index.mjs';
import { gitRepo, cleanup } from './helpers.mjs';

/** A deltaless change at `implemented`, whose consolidation command leaves a mark when it runs. */
function fixture() {
  const repo = gitRepo({ 'src/app.js': 'export const x = 1;\n', '.gitignore': '.spectree/\n' });
  const store = new Store(repo.root);
  store.init({
    project_id: 'fixture', protocol_version: '1.0.0',
    closure: { consolidate: [process.execPath, '-e', "require('fs').writeFileSync('.spectree/ran','yes')"] },
  });
  store.putChange({
    schema_version: '1.0.0', project_id: 'fixture', change_id: 'c1', change_type: 'feature',
    protocol_version: '1.0.0', adapter: 'codex', base_revision: repo.base, scope: 'fixture',
    allowed_paths: ['src', 'docs'], deltaless: true, state: 'implemented',
  }, { event: { type: 'opened' } });
  mkdirSync(join(repo.root, 'docs/changes/c1'), { recursive: true });
  writeFileSync(join(repo.root, 'docs/changes/c1/proposal.md'), '# proposal\n\nno delta\n');
  repo.git(['add', '-A']); repo.git(['commit', '-qm', 'the proposal']);

  const prep = (...argv) => {
    const out = [];
    const err = [];
    const code = prepareClosure({ root: repo.root, argv, out: (s) => out.push(s), err: (s) => err.push(s) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  return {
    root: repo.root, prep,
    ran: () => existsSync(join(repo.root, '.spectree/ran')),
    manifest: () => existsSync(join(repo.root, '.spectree/closure/c1.json'))
      ? JSON.parse(readFileSync(join(repo.root, '.spectree/closure/c1.json'), 'utf8')) : null,
    open: () => existsSync(join(repo.root, 'docs/changes/c1')),
    drop: () => cleanup(repo.root),
  };
}

test('no change named is a usage error, answered and not exited', () => {
  const f = fixture();
  try {
    const r = f.prep();
    assert.equal(r.code, 2);
    assert.match(r.err, /^usage: prepare-closure\.mjs/);
    const json = f.prep('--json');
    assert.equal(json.code, 2);
    assert.equal(JSON.parse(json.out).state, 'usage_error');
  } finally { f.drop(); }
});

test('an unknown change is refused with exit 1', () => {
  const f = fixture();
  try {
    const r = f.prep('nope');
    assert.equal(r.code, 1);
    assert.match(r.err, /no such change: nope/);
  } finally { f.drop(); }
});

test('the dry run plans in the given root and writes nothing', () => {
  const f = fixture();
  try {
    const r = f.prep('c1');
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^DRY RUN — nothing will be written {2}-> {2}c1/);
    assert.match(r.out, /Re-run with --apply/);
    assert.equal(f.ran(), false);
    assert.equal(f.manifest(), null);
    assert.equal(f.open(), true);
  } finally { f.drop(); }
});

test('applying prepares, and the second run finds it unchanged', () => {
  const f = fixture();
  try {
    const first = f.prep('c1', '--apply');
    assert.equal(first.code, 0, first.err);
    assert.match(first.out, /^prepared c1 {2}\(generation 1, /);
    assert.equal(f.ran(), true);
    assert.equal(f.open(), false);
    const manifest = f.manifest();
    assert.equal(manifest.change_id, 'c1');

    const again = f.prep('c1', '--apply', '--json');
    assert.equal(again.code, 0, again.err);
    const doc = JSON.parse(again.out);
    assert.equal(doc.state, 'unchanged');
    assert.equal(f.manifest().preparation_id, manifest.preparation_id);
  } finally { f.drop(); }
});

test('a plan applied against a control that moved is refused, in the same JSON shape', () => {
  const f = fixture();
  try {
    const r = f.prep('c1', '--apply', '--json', '--expect-control', '7');
    assert.equal(r.code, 1);
    const doc = JSON.parse(r.out);
    assert.equal(doc.state, 'refused');
    assert.equal(doc.code, 'E_CONCURRENT_UPDATE');
    assert.equal(f.ran(), false);
  } finally { f.drop(); }
});

test('recovery flags with nothing to recover are usage errors', () => {
  const f = fixture();
  try {
    assert.equal(f.prep('c1', '--apply', '--resume').code, 2);
    assert.equal(f.prep('c1', '--apply', '--abandon', '--reason', 'x').code, 2);
    const reopen = f.prep('c1', '--apply', '--reopen', '--reason', 'x');
    assert.equal(reopen.code, 2);
    assert.match(reopen.err, /--reopen is only meaningful/);
    assert.equal(f.ran(), false);
  } finally { f.drop(); }
});
