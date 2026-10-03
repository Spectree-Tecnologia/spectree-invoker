import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitRepo, cleanup, writeFiles, change, REPO } from './helpers.mjs';
import { Store } from '../scripts/lib/store.mjs';
import { doctor, startWork, finishWork, reconcileWork, pendingWork, workPacket, outcome } from '../scripts/lib/work.mjs';

const options = { phase: 'prepare_closure', task: 'tasks.md#T5', next: 'Inspect the archive and consolidated spec.', refs: ['seed.txt'] };
test('doctor detects an empty structured store with existing artifacts without writing or inventing closure', () => {
  const r = gitRepo();
  try {
    new Store(r.root).init({ project_id: 'p', protocol_version: '1.0.0' });
    writeFiles(r.root, { 'docs/changes/c1/proposal.md': 'contract', 'docs/changes/archive/old/proposal.md': 'history' });
    const before = r.git(['status', '--porcelain']);
    const d = doctor(r.root);
    assert.equal(d.mode, 'legacy_artifacts'); assert.equal(d.adoption_required, true);
    assert.deepEqual(d.unregistered_changes, ['c1']); assert.equal(d.registered_changes, 0);
    assert.equal(r.git(['status', '--porcelain']), before);
  } finally { cleanup(r.root); }
});
test('a checkpoint survives interruption and does not infer completion from an archived folder', () => {
  const r = gitRepo();
  try {
    startWork(r.root, 'c1', 'T5', options);
    writeFiles(r.root, { 'docs/changes/archive/c1/proposal.md': 'partially moved' });
    assert.deepEqual(pendingWork(r.root, 'c1').operation_ids, ['T5']);
    const packet = workPacket(r.root, 'c1');
    assert.equal(packet.operations[0].status, 'unfinished');
    assert.equal(packet.authorizes_execution, false);
    assert.throws(() => startWork(r.root, 'c1', 'T5', options), { code: 'E_WORK_CONFLICT' });
    assert.equal(existsSync(join(r.root, '.spectree/approvals')), false);
  } finally { cleanup(r.root); }
});
test('completed harness envelopes carrying rate limits are interruptions, not successful work', () => {
  for (const result of [
    { status: 'completed', content: [{ type: 'text', text: "You've hit your session limit · resets 1:50pm" }] },
    { status: 'completed', message: { content: [{ type: 'text', text: 'You’ve hit your session limit' }] } },
    { status: 'completed', error: 'rate_limit' }, { status: 'completed', apiErrorStatus: 429 },
    { status: 'completed', toolUseResult: { status: 'interrupted' } },
  ]) assert.equal(outcome(result), 'interrupted');
  assert.equal(outcome({ status: 'completed', is_error: true }), 'failed');
  assert.equal(outcome({}), 'unknown');
  assert.equal(outcome({ status: 'completed' }), 'reported_success');
});
test('reconciliation records inspected effects without changing state or granting authority', () => {
  const r = gitRepo();
  try {
    startWork(r.root, 'c1', 'T5', options);
    finishWork(r.root, 'c1', 'T5', { ...options, result: { status: 'completed', error: 'rate_limit' } });
    assert.ok(pendingWork(r.root, 'c1'));
    assert.throws(() => reconcileWork(r.root, 'c1', 'T5', { note: 'Inspected', next: 'Resume' }), { code: 'E_WORK_REFS' });
    reconcileWork(r.root, 'c1', 'T5', { ...options, note: 'Archive exists, no receipt. Resume the native lifecycle dry run.' });
    assert.equal(pendingWork(r.root, 'c1'), null);
    assert.equal(existsSync(join(r.root, '.spectree/changes')), false);
    assert.throws(() => finishWork(r.root, 'c1', 'T5', { ...options, result: { status: 'completed' } }), { code: 'E_WORK_CONFLICT' });
  } finally { cleanup(r.root); }
});
test('packet freshness changes after an uncommitted edit; the event remains immutable', () => {
  const r = gitRepo();
  try {
    startWork(r.root, 'c1', 'build', options);
    finishWork(r.root, 'c1', 'build', { ...options, result: { status: 'completed' } });
    const f = join(r.root, '.spectree/work/c1/build/finished.json'); const before = readFileSync(f, 'utf8');
    writeFileSync(join(r.root, 'seed.txt'), 'new candidate');
    const packet = workPacket(r.root, 'c1');
    assert.equal(packet.operations[0].content_changed, true);
    assert.equal(packet.operations[0].refs[0].fresh, false);
    assert.equal(readFileSync(f, 'utf8'), before);
  } finally { cleanup(r.root); }
});
test('corrupt and traversing checkpoints fail closed', () => {
  const r = gitRepo();
  try {
    assert.throws(() => startWork(r.root, '../escape', 'x', options), { code: 'E_WORK_ID' });
    assert.throws(() => startWork(r.root, 'c1', 'x', { ...options, refs: ['../seed.txt'] }), { code: 'E_WORK_PATH' });
    const dir = join(r.root, '.spectree/work/c1/x'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'started.json'), '{');
    assert.throws(() => pendingWork(r.root, 'c1'), { code: 'E_WORK_CORRUPT' });
  } finally { cleanup(r.root); }
});

test('doctor ignores index documents and archive placeholders', () => {
  const r = gitRepo();
  try {
    writeFiles(r.root, { 'docs/changes/README.md': 'index', 'docs/changes/archive/.gitkeep': '' });
    const result = doctor(r.root);
    assert.deepEqual(result.open_artifacts, []);
    assert.equal(result.archived_artifact_directories, 0);
    assert.equal(result.adoption_required, false);
  } finally { cleanup(r.root); }
});

test('a syntactically valid event with a different identity cannot clear pending work', () => {
  const r = gitRepo();
  try {
    startWork(r.root, 'c1', 'build', options);
    finishWork(r.root, 'c1', 'build', { ...options, result: { status: 'completed' } });
    const path = join(r.root, '.spectree/work/c1/build/finished.json');
    const event = JSON.parse(readFileSync(path, 'utf8'));
    event.operation_id = 'another-operation';
    writeFileSync(path, JSON.stringify(event));
    assert.throws(() => pendingWork(r.root, 'c1'), { code: 'E_WORK_CORRUPT' });
  } finally { cleanup(r.root); }
});
test('state CLI gates and planner both refuse an outstanding checkpoint', () => {
  const r = gitRepo();
  try {
    const s = new Store(r.root); s.init({ project_id: 'p', protocol_version: '1.0.0' });
    s.putChange(change({ base_revision: r.base }));
    startWork(r.root, 'c1', 'prepare', options);
    const run = (...args) => spawnSync(process.execPath, [join(REPO, 'scripts/state.mjs'), ...args],
      { cwd: r.root, env: { ...process.env, SPECTREE_PROJECT_ROOT: r.root }, encoding: 'utf8' });
    const gate = run('can', 'c1', 'proposed');
    assert.equal(gate.status, 1); assert.match(gate.stdout + gate.stderr, /E_OPERATION_PENDING/);
    const plan = run('plan', 'c1', '--json');
    assert.equal(JSON.parse(plan.stdout).action, 'recover_operation');
    reconcileWork(r.root, 'c1', 'prepare', { ...options, note: 'No side effect ran; original file confirmed.' });
    assert.equal(run('can', 'c1', 'proposed').status, 0);
  } finally { cleanup(r.root); }
});
