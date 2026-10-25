// A pass 2 dispatch starts from a brief written before it is sent: the independence it owes and the
// final scope. Both were forgotten by hand in the SYND passkeys change; the operation now refuses
// to start without them, and refuses to finish if the scope was cut while the round ran.

import { test } from 'node:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { gitRepo, writeFiles, cleanup, change, writePass2Brief } from './helpers.mjs';
import { Store } from '../scripts/lib/change/store.mjs';
import { startWork, finishWork, workRecords, pendingWork } from '../scripts/lib/change/work.mjs';

function repo() {
  const r = gitRepo({ 'src/a.cjs': 'module.exports = 1;\n' });
  const s = new Store(r.root); s.init({ project_id: 'proj', protocol_version: '1.0.0' });
  s.putChange(change({ base_revision: r.base, state: 'implemented', allowed_paths: ['src/'] }));
  return r;
}
const start = (r, op, brief) => startWork(r.root, 'c1', op, { phase: 'pass2', task: 'attack', next: 'Record.', brief });
const code = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };
const done = { status: 'completed' };

test('a pass 2 operation does not start without a brief declaring independence and the final scope', () => {
  const r = repo();
  try {
    assert.equal(code(() => start(r, 'p1')), 'E_PASS2_BRIEF');
    assert.equal(code(() => start(r, 'p1', '.spectree/pass2/missing.json')), 'E_PASS2_BRIEF');
    for (const over of [{ independent_of: [] }, { independent_of: ['full_stack_developer', 42] }, { fork: true }, { fork: undefined },
      { withheld: ['builder_report', 'pull_request'] }, { withheld: ['builder_report', 'builder_reasoning', 'pull_request', 7] },
      { scope: { attack: [], excluded: [] } }, { scope: { attack: [], rerun: [], excluded: [] } },
      { scope: { attack: [{ path: 'src/a.cjs', reason: 'changed' }], excluded: [] } },
      { scope: { attack: ['src/'] } }, { version: 2 }]) {
      assert.equal(code(() => start(r, 'p1', writePass2Brief(r.root, 'bad', over))), 'E_PASS2_BRIEF', JSON.stringify(over));
    }
    const started = start(r, 'p1', writePass2Brief(r.root));
    assert.deepEqual(started.brief.independent_of, ['full_stack_developer']);
    assert.equal(started.brief.attack, 1);
    assert.match(started.brief.sha256, /^[a-f0-9]{64}$/);
    // A later round with no file left to attack still opens to rerun the killed mutants whose target moved.
    assert.equal(start(r, 'p-rerun', writePass2Brief(r.root, 'rerun', { scope: { attack: [], rerun: ['m-b'], excluded: [] } })).brief.rerun, 1);
    // Other phases are not asked for one.
    assert.equal(code(() => startWork(r.root, 'c1', 'impl', { phase: 'implement', task: 't', next: 'n' })), null);
  } finally { cleanup(r.root); }
});

test('cutting the scope after the round started refuses its finish; the round is reconciled and dispatched again', () => {
  const r = repo();
  try {
    const path = writePass2Brief(r.root);
    start(r, 'p1', path);
    writePass2Brief(r.root, 'brief', { scope: { attack: ['src/a.cjs'], excluded: ['src/b.cjs'] } });
    assert.equal(code(() => finishWork(r.root, 'c1', 'p1', { result: done, next: 'Record.' })), 'E_PASS2_SCOPE_MOVED');
    assert.equal(pendingWork(r.root, 'c1').operation_id, 'p1', 'the round stays pending until it is reconciled');
    // A brief removed mid-round is a scope nobody can read any more: the same refusal.
    start(r, 'p3', writePass2Brief(r.root, 'brief-3'));
    rmSync(join(r.root, '.spectree/pass2/brief-3.json'));
    assert.equal(code(() => finishWork(r.root, 'c1', 'p3', { result: done, next: 'Record.' })), 'E_PASS2_SCOPE_MOVED');
    // The new scope is a new operation, with its own brief pinned.
    start(r, 'p2', writePass2Brief(r.root, 'brief-2', { scope: { attack: ['src/a.cjs'], excluded: ['src/b.cjs'] } }));
    assert.equal(finishWork(r.root, 'c1', 'p2', { result: done, next: 'Record.' }).status, 'reported_success');
  } finally { cleanup(r.root); }
});

test('an operation started before briefs existed still finishes', () => {
  const r = repo();
  try {
    writeFiles(r.root, { '.spectree/work/c1/old/started.json': JSON.stringify({ version: 1, event: 'started',
      at: '2026-10-25T00:00:00.000Z', change_id: 'c1', operation_id: 'old', phase: 'pass2', task: 'attack', next: 'Record.',
      refs: [], snapshot: { revision: r.base, content_digest: `sha256:${'a'.repeat(64)}`, branch: 'main' } }) });
    assert.equal(finishWork(r.root, 'c1', 'old', { result: done, next: 'Record.' }).status, 'reported_success');
    assert.equal(workRecords(r.root, 'c1')[0].started.brief, undefined);
  } finally { cleanup(r.root); }
});

test('work.mjs start takes the brief on the command line', async () => {
  const { spawnSync } = await import('node:child_process');
  const { join } = await import('node:path');
  const { REPO } = await import('./helpers.mjs');
  const r = repo();
  try {
    const cli = (...args) => spawnSync(process.execPath, [join(REPO, 'scripts/work.mjs'), ...args], { cwd: r.root, encoding: 'utf8', env: { ...process.env, SPECTREE_PROJECT_ROOT: r.root } });
    const without = cli('start', 'c1', 'p1', '--phase', 'pass2', '--task', 'attack', '--next', 'Record.');
    assert.equal(without.status, 1); assert.match(without.stderr, /E_PASS2_BRIEF/);
    const withBrief = cli('start', 'c1', 'p1', '--phase', 'pass2', '--task', 'attack', '--next', 'Record.', '--brief', writePass2Brief(r.root));
    assert.equal(withBrief.status, 0, withBrief.stderr);
    assert.equal(JSON.parse(withBrief.stdout).brief.path, '.spectree/pass2/brief.json');
  } finally { cleanup(r.root); }
});
