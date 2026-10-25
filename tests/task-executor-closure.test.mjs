// Pass 2 attacks the prepared closure, and its findings are repaired through the executor. The
// preparation archives docs/changes/<id>/, so the plan's references must still resolve there.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, writeFiles } from './helpers.mjs';
import { initTasks, taskStatus, runTask, verifyTasks } from '../scripts/lib/execution/task-executor.mjs';
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
    const inspection = { cause: 'Pass 2 attacked B on the prepared closure.', new_hypothesis: 'Rewrite B and keep A.', refs: ['pass2-finding.md'], processes_stopped: true };
    const repaired = runTask(r.root, 'c1', 'B', r.bridge("fs.writeFileSync('src/value.cjs','module.exports={a:1,b:2};\\n');console.log(JSON.stringify({status:'completed'}));"), inspection);
    assert.equal(repaired.ok, true, readFileSync(join(r.root, repaired.attempt.result_ref), 'utf8'));
    assert.equal(repaired.verification.checks.length, 2);
    const packet = JSON.parse(readFileSync(join(r.root, repaired.attempt.packet_ref), 'utf8'));
    assert.ok(packet.reading.some((x) => x.path === 'docs/changes/archive/2026-10-25-c1/tasks.md'));
    assert.equal(r.s.change('c1').state, 'implemented');
  } finally { cleanup(r.root); }
});

test('past implemented the executor stays closed', () => {
  const r = preparedForPass2();
  try {
    r.s.putChange({ ...r.s.change('c1'), state: 'pass2_complete' });
    assert.throws(() => verifyTasks(r.root, 'c1'), { code: 'E_TASK_GATE' });
  } finally { cleanup(r.root); }
});
