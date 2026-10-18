// The closure CLIs are thin facades, and the suite leans on that: most tests call the library
// function behind each one in process (`closureCli`). These tests hold the two ways equal — the
// same exit code, the same stdout and the same refusal — so a facade that grew logic of its own
// would fail here instead of hiding behind the in-process calls.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { gitRepo, cleanup, REPO, closureCli } from './helpers.mjs';

const both = (script, argv, cwd) => {
  const file = join(REPO, 'scripts', script);
  return [closureCli(file, argv, { cwd }), closureCli(file, argv, { cwd, spawn: true })];
};
const same = ([inProcess, spawned]) => {
  assert.equal(inProcess.code, spawned.code);
  assert.equal(inProcess.out, spawned.out);
  return { inProcess, spawned };
};

test('the guard tells a changed facade from an unchanged one', () => {
  assert.throws(() => same([{ code: 0, out: '' }, { code: 1, out: '' }]), { code: 'ERR_ASSERTION' });
  assert.throws(() => same([{ code: 0, out: 'a' }, { code: 0, out: 'b' }]), { code: 'ERR_ASSERTION' });
});

test('state.mjs answers the same in process and as a process', () => {
  const repo = gitRepo({ '.gitignore': '.spectree/\n' });
  try {
    same(both('state.mjs', ['no-such-command'], repo.root));
    assert.equal(same(both('state.mjs', ['init', 'proj'], repo.root)).spawned.code, 0);
    const { inProcess, spawned } = same(both('state.mjs', ['can', 'missing', 'proposed'], repo.root));
    assert.equal(inProcess.code, 1);
    assert.equal(inProcess.err, spawned.err);
    same(both('state.mjs', ['resume', '--json'], repo.root));
  } finally { cleanup(repo.root); }
});

test('prepare-closure.mjs and post-merge.mjs refuse the same way in process and as a process', () => {
  const repo = gitRepo({ '.gitignore': '.spectree/\n' });
  try {
    for (const script of ['prepare-closure.mjs', 'post-merge.mjs']) {
      const { inProcess, spawned } = same(both(script, [], repo.root));
      assert.notEqual(inProcess.code, 0);
      assert.equal(inProcess.err, spawned.err);
      same(both(script, ['missing'], repo.root));
    }
  } finally { cleanup(repo.root); }
});
