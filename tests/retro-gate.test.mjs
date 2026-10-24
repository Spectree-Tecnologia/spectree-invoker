// A closed change owes its retro. The planner points at it instead of answering "nothing to do",
// and no new change opens over it until `retro.recorded` is observed or a person waives it with a
// reason. Each refusal is shown first, then the observed record that lifts it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../scripts/lib/change/store.mjs';
import { planNext, pendingRetros } from '../scripts/lib/change/index.mjs';
import { stateCommand } from '../scripts/lib/closure/index.mjs';
import { REPO, gitRepo, cleanup } from './helpers.mjs';

function fixture() {
  const repo = gitRepo({ 'src/app.js': 'export const x = 1;\n', '.gitignore': '.spectree/\n' });
  const state = (...argv) => {
    const out = []; const err = [];
    const code = stateCommand({ root: repo.root, argv, out: (s) => out.push(s), err: (s) => err.push(s) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  const store = () => new Store(repo.root);
  const open = (id, ...extra) => state('open', id, '--scope', 'fixture', '--paths', 'src', '--deltaless', '--closure-mode', 'legacy', ...extra);
  // White-box: the closure itself is proven elsewhere; here only its end state matters.
  const close = (id) => { const s = store(); s.putChange({ ...s.change(id), state: 'closed' }); };
  const retro = (id, body = `# Retro\n\nChange: \`${id}\`\n\n## What was read\n\nThe merge.\n`) => {
    mkdirSync(join(repo.root, 'docs/retros'), { recursive: true });
    writeFileSync(join(repo.root, `docs/retros/${id}.md`), body);
    return state('run', id, 'retro.recorded', '--role', 'invoker', '--',
      process.execPath, join(REPO, 'scripts/retro.mjs'), 'check', id, `docs/retros/${id}.md`);
  };
  return { root: repo.root, state, store, open, close, retro, drop: () => cleanup(repo.root) };
}

test('a closed change without its retro is planned as the retro, and as nothing once it is recorded', () => {
  const change = { change_id: 'c1', state: 'closed' };
  const owed = planNext(change, { retroRecorded: false });
  assert.equal(owed.action, 'record_retro');
  assert.equal(owed.code, 'E_RETRO_PENDING');
  assert.equal(owed.skill, 'squad-closure-retro');
  assert.equal(planNext(change, { retroRecorded: true }).action, 'none');
});

test('a waiver names the changes it covers, and covers nothing else', () => {
  const changes = [{ change_id: 'a', state: 'closed' }, { change_id: 'b', state: 'closed' }, { change_id: 'c', state: 'draft', retro_waiver: { changes: ['a'], reason: 'r' } }];
  assert.deepEqual(pendingRetros(changes, () => []), ['b']);
  const recorded = [{ property: 'retro.recorded', result: 'PASS', source_kind: 'observed_execution' }];
  assert.deepEqual(pendingRetros(changes, (id) => (id === 'b' ? recorded : [])), []);
  assert.deepEqual(pendingRetros(changes, (id) => (id === 'b' ? [{ ...recorded[0], source_kind: 'agent_report' }] : [])), ['b'],
    'a reported retro is not an observed one');
});

test('no change opens over a closed change that owes its retro, until the retro is observed', () => {
  const f = fixture();
  try {
    assert.equal(f.state('init', 'proj').code, 0);
    assert.equal(f.open('c1').code, 0);
    f.close('c1');

    const refused = f.open('c2');
    assert.equal(refused.code, 1);
    assert.match(refused.err, /^E_RETRO_PENDING: c1 closed without a recorded retro/);
    assert.equal(f.store().change('c2'), null);
    const plan = JSON.parse(f.state('plan', '--json').out);
    assert.equal(plan.action, 'record_retro', 'with nothing open, the owed retro is the work');

    const wrong = f.retro('c1', '# Retro\n\nChange: `c9`\n\n## What was read\n');
    assert.equal(wrong.code, 1, 'a retro naming another change is a failed check');
    assert.deepEqual(f.store().evidence('c1').map((e) => e.result), ['FAIL'], 'and the run records what it observed');
    assert.equal(f.open('c2').code, 1, 'a FAIL lifts nothing');

    const recorded = f.retro('c1');
    assert.equal(recorded.code, 0, recorded.err);
    assert.equal(f.open('c2').code, 0);
    assert.equal(JSON.parse(f.state('plan', 'c1', '--json').out).action, 'none');
  } finally { f.drop(); }
});

test('a waiver needs a reason, and the reason stays on the change that opened over it', () => {
  const f = fixture();
  try {
    assert.equal(f.state('init', 'proj').code, 0);
    assert.equal(f.open('c1').code, 0);
    f.close('c1');
    assert.equal(f.open('c2', '--retro-waived', '').code, 2);
    const opened = f.open('c2', '--retro-waived', 'closed before the retro gate existed');
    assert.equal(opened.code, 0, opened.err);
    assert.deepEqual(f.store().change('c2').retro_waiver, { changes: ['c1'], reason: 'closed before the retro gate existed' });
    assert.equal(f.open('c3').code, 0, 'a waived retro is not owed again');
  } finally { f.drop(); }
});
