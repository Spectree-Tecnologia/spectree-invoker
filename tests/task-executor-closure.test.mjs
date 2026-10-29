// Pass 2 attacks the prepared closure, and its findings are repaired through the executor. The
// preparation archives docs/changes/<id>/, so the plan's references must still resolve there.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, writeFiles, writePass2Brief } from './helpers.mjs';
import { startWork, finishWork } from '../scripts/lib/change/work.mjs';
import { recordPass2Round } from '../scripts/lib/evidence/pass2.mjs';
import { initTasks, taskStatus, runTask, verifyTasks } from '../scripts/lib/execution/task-executor.mjs';
import { beginOperation } from '../scripts/lib/change/lifecycle.mjs';
import { fixture } from './task-executor-fixture.mjs';

function preparedForPass2() {
  const r = fixture();
  writeFiles(r.root, { 'docs/changes/c1/tasks.md': '- A\n- B\n' });
  r.git(['add', '-A']); r.git(['commit', '-qm', 'tasks']);
  const plan = structuredClone(r.plan); plan.tasks.forEach((t) => t.refs.push('docs/changes/c1/tasks.md'));
  initTasks(r.root, 'c1', plan);
  assert.equal(runTask(r.root, 'c1', 'A', r.good()).ok, true);
  assert.equal(runTask(r.root, 'c1', 'B', r.good()).ok, true);
  r.git(['add', '-A']); r.git(['commit', '-qm', 'implementation']);
  r.s.putChange({ ...r.s.change('c1'), state: 'implemented' });
  // What prepare-closure does to the folder: the same bytes, archived.
  mkdirSync(join(r.root, 'docs/changes/archive'), { recursive: true });
  renameSync(join(r.root, 'docs/changes/c1'), join(r.root, 'docs/changes/archive/2026-10-25-c1'));
  writeFiles(r.root, { 'docs/specs/m/spec.md': '# m\n' });
  r.git(['add', '-A']); r.git(['commit', '-qm', 'closure prepared']);
  return r;
}

test('after the closure is prepared, task references resolve through the archived folder', () => {
  const r = preparedForPass2();
  try {
    const status = taskStatus(r.root, 'c1');
    assert.deepEqual(status.tasks.map((t) => t.status), ['stale', 'stale']);
    const verified = verifyTasks(r.root, 'c1');
    assert.equal(verified.ok, true, readFileSync(join(r.root, verified.evidence_ref), 'utf8'));
    assert.equal(taskStatus(r.root, 'c1').complete, true);
    assert.equal(r.s.change('c1').state, 'implemented');
  } finally { cleanup(r.root); }
});

test('a pass 2 finding is repaired through the executor while the change is implemented', () => {
  const r = preparedForPass2();
  try {
    writeFiles(r.root, { 'pass2-finding.md': 'B returns 2 only by accident.\n' });
    test('a repair over an unrecorded pass 2 round is refused before it consumes an attempt', () => {
  const r = preparedForPass2();
  try {
    startWork(r.root, 'c1', 'pass2-r1', { phase: 'pass2', task: 'attack the prepared closure', next: 'Record the round.', brief: writePass2Brief(r.root, 'pass2-r1') });
    writeFiles(r.root, { '.spectree/pass2-finding.md': 'B returns 2 only by accident.\n' });
    finishWork(r.root, 'c1', 'pass2-r1', { result: { status: 'completed' }, next: 'Record the round.' });
    const repair = { cause: 'Pass 2 attacked B.', new_hypothesis: 'Rewrite B.', refs: ['.spectree/pass2-finding.md'], processes_stopped: true };
    const fix = r.bridge("fs.writeFileSync('src/value.cjs','module.exports={a:1,b:2};\\n');console.log(JSON.stringify({status:'completed'}));");
    const attempts = () => JSON.stringify(taskStatus(r.root, 'c1').tasks);
    const before = attempts();
    assert.throws(() => runTask(r.root, 'c1', 'B', fix, repair), { code: 'E_PASS2_UNRECORDED' });
    assert.equal(attempts(), before, 'no attempt was saved and nothing waits for reconciliation');
    recordPass2Round(r.root, 'c1', { attacked: ['src/value.cjs'] }, { operation: 'pass2-r1' });
    assert.equal(runTask(r.root, 'c1', 'B', fix, repair).ok, true);
  } finally { cleanup(r.root); }
});

const inspection = { cause: 'Pass 2 attacked B on the prepared closure.', new_hypothesis: 'Rewrite B and keep A.', refs: ['pass2-finding.md'], processes_stopped: true };
    const repaired = runTask(r.root, 'c1', 'B', r.bridge("fs.writeFileSync('src/value.cjs','module.exports={a:1,b:2};\\n');console.log(JSON.stringify({status:'completed'}));"), inspection);
    assert.equal(repaired.ok, true, readFileSync(join(r.root, repaired.attempt.result_ref), 'utf8'));
    assert.equal(repaired.verification.checks.length, 2);
    const packet = JSON.parse(readFileSync(join(r.root, repaired.attempt.packet_ref), 'utf8'));
    assert.ok(packet.reading.some((x) => x.path === 'docs/changes/archive/2026-10-25-c1/tasks.md'));
    assert.equal(r.s.change('c1').state, 'implemented');
  } finally { cleanup(r.root); }
});

const inspection = { cause: 'Pass 2 attacked B on the prepared closure.', new_hypothesis: 'Rewrite B and keep A.', refs: ['src/value.cjs'], processes_stopped: true };

test('an ordinary run stays closed in implemented, and everything stays closed past it', () => {
  const r = preparedForPass2();
  try {
    assert.throws(() => runTask(r.root, 'c1', 'B', r.good()), { code: 'E_TASK_NOT_READY' });
    r.s.putChange({ ...r.s.change('c1'), state: 'pass2_complete' });
    assert.throws(() => verifyTasks(r.root, 'c1'), { code: 'E_TASK_GATE' });
    assert.throws(() => runTask(r.root, 'c1', 'B', r.good(), inspection), { code: 'E_TASK_GATE' });
  } finally { cleanup(r.root); }
});

// The executor's lock already takes the closure authority idle-only; this proves the window keeps it.
test('a pending lifecycle operation keeps the repair window closed', () => {
  const r = preparedForPass2();
  try {
    beginOperation(r.root, 'c1', { kind: 'prepare', operationId: 'op-prepare-interrupted', detail: {} });
    assert.throws(() => verifyTasks(r.root, 'c1'), { code: 'E_OPERATION_PENDING' });
    assert.throws(() => runTask(r.root, 'c1', 'B', r.good(), inspection), { code: 'E_OPERATION_PENDING' });
  } finally { cleanup(r.root); }
});
