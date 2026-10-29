

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { cleanup, writeFiles, approval, REPO, closureCli } from './helpers.mjs';
import { pendingWork, reconcileWork } from '../scripts/lib/change/work.mjs';
import { initTasks, taskStatus, runTask, recoverTask, verifyTasks, validatePlan } from '../scripts/lib/execution/task-executor.mjs';
import { fixture } from './task-executor-fixture.mjs';

test('dependency frontier executes and reverifies real named tests without advancing lifecycle', () => {
  const r = fixture();
  try {
    assert.deepEqual(initTasks(r.root, 'c1', r.plan).ready, ['A']);
    assert.throws(() => runTask(r.root, 'c1', 'A', { kind: 'invalid' }), { code: 'E_AGENT_CONFIG' });
    assert.equal(taskStatus(r.root, 'c1').tasks[0].attempts, 0);
    const can = () => closureCli(join(REPO, 'scripts/state.mjs'), ['can', 'c1', 'implemented'], { cwd: r.root, env: { SPECTREE_PROJECT_ROOT: r.root } });
    assert.match(can().stderr, /E_TASK_INCOMPLETE/);
    assert.throws(() => runTask(r.root, 'c1', 'B', r.good()), { code: 'E_TASK_NOT_READY' });
    const first = runTask(r.root, 'c1', 'A', r.good());
    assert.equal(first.ok, true, readFileSync(join(r.root, first.attempt.result_ref), 'utf8'));
    assert.deepEqual(taskStatus(r.root, 'c1').ready, ['B']);
    const result = runTask(r.root, 'c1', 'B', r.good());
    assert.equal(result.ok, true, readFileSync(join(r.root, result.attempt.result_ref), 'utf8')); assert.equal(result.verification.checks.length, 2);
    assert.equal(result.status.complete, true); assert.equal(r.s.change('c1').state, 'pass1_complete');
    const planned = closureCli(join(REPO, 'scripts/state.mjs'), ['plan', 'c1', '--json'], { cwd: r.root, env: { SPECTREE_PROJECT_ROOT: r.root } });
    assert.equal(JSON.parse(planned.stdout).action, 'record_transition');
    assert.equal(can().status, 0);
    assert.equal(r.s.dispatches('c1').length, 2); assert.equal(pendingWork(r.root, 'c1'), null);
    assert.throws(() => initTasks(r.root, 'c1', r.plan), { code: 'E_TASK_EXISTS' });
  } finally { cleanup(r.root); }
});

test('reported completion without passing behavior cannot release dependents', () => {
  const r = fixture();
  try {
    initTasks(r.root, 'c1', r.plan);
    const out = runTask(r.root, 'c1', 'A', r.bridge("console.log(JSON.stringify({status:'completed'}));"));
    assert.equal(out.ok, false); assert.deepEqual(out.status.ready, []); assert.ok(pendingWork(r.root, 'c1'));
    assert.throws(() => runTask(r.root, 'c1', 'A', r.good()), { code: 'E_TASK_NOT_READY' });
    recoverTask(r.root, 'c1', out.attempt.id, { cause: 'No implementation was written.', new_hypothesis: 'Implement the missing public behavior.', refs: ['src/value.cjs'], processes_stopped: true });
    assert.equal(runTask(r.root, 'c1', 'A', r.good()).ok, true);
    assert.deepEqual(r.s.dispatches('c1').map((d) => d.attempt).sort(), [1, 2]);
  } finally { cleanup(r.root); }
});

test('quota in completed envelope is interrupted even if code was written', () => {
  const r = fixture();
  try {
    initTasks(r.root, 'c1', r.plan);
    const out = runTask(r.root, 'c1', 'A', r.bridge("fs.writeFileSync('src/value.cjs','module.exports={a:1,b:0}');console.log(JSON.stringify({status:'completed',error:'rate_limit'}));"));
    assert.equal(out.attempt.status, 'interrupted'); assert.equal(out.verification, null); assert.deepEqual(out.status.ready, []);
    assert.throws(() => recoverTask(r.root, 'c1', out.attempt.id, { cause: 'quota', new_hypothesis: 'retry', refs: ['spec.md'] }), { code: 'E_TASK_RECOVERY' });
  } finally { cleanup(r.root); }
});

test('process records past the default 1 MiB listing neither break the inventory nor enter it', () => {
  const r = fixture();
  try {
    initTasks(r.root, 'c1', r.plan);
    // About 1.3 MiB of untracked paths under .spectree/processes, the shape a long-lived consumer reaches.
    const segment = 'p'.repeat(200);
    for (let i = 0; i < 6000; i++) writeFiles(r.root, { [`.spectree/processes/op-${i}/${segment}`]: '{}' });
    const out = runTask(r.root, 'c1', 'A', r.good());
    assert.equal(out.ok, true, readFileSync(join(r.root, out.attempt.result_ref), 'utf8'));
    assert.deepEqual(JSON.parse(readFileSync(join(r.root, out.attempt.result_ref), 'utf8')).changed, ['src/value.cjs']);
  } finally { cleanup(r.root); }
});

test('whole candidate evidence becomes stale after external edits and can be reverified', () => {
  const r = fixture();
  try {
    initTasks(r.root, 'c1', r.plan); runTask(r.root, 'c1', 'A', r.good());
    writeFileSync(join(r.root, 'src/value.cjs'), 'module.exports={a:1,b:0}; // changed\n');
    assert.equal(taskStatus(r.root, 'c1').tasks[0].status, 'stale');
    assert.throws(() => runTask(r.root, 'c1', 'B', r.good()), { code: 'E_TASK_NOT_READY' });
    const verified = verifyTasks(r.root, 'c1'); assert.equal(verified.ok, true, readFileSync(join(r.root, verified.evidence_ref), 'utf8'));
    assert.deepEqual(taskStatus(r.root, 'c1').ready, ['B']);
  } finally { cleanup(r.root); }
});

test('later task cannot regress a previously completed scenario', () => {
  const r = fixture();
  try {
    initTasks(r.root, 'c1', r.plan); runTask(r.root, 'c1', 'A', r.good());
    const out = runTask(r.root, 'c1', 'B', r.bridge("fs.writeFileSync('src/value.cjs','module.exports={a:0,b:2}');console.log(JSON.stringify({status:'completed'}));"));
    assert.equal(out.ok, false); assert.notEqual(out.verification.checks[0].result, 'PASS'); assert.equal(out.status.complete, false);
    const inspection = { cause: 'B regressed A, reproduced by immutable test.', new_hypothesis: 'Restore A and preserve B.', refs: ['src/value.cjs', out.attempt.result_ref], processes_stopped: true };
    assert.throws(() => runTask(r.root, 'c1', 'B', r.good(), inspection), { code: 'E_TASK_NOT_READY' });
    recoverTask(r.root, 'c1', out.attempt.id, inspection);
    const repaired = runTask(r.root, 'c1', 'B', r.bridge("fs.writeFileSync('src/value.cjs','module.exports={a:1,b:2}');console.log(JSON.stringify({status:'completed'}));"), inspection);
    assert.equal(repaired.ok, true); assert.equal(repaired.verification.checks.length, 2);
    writeFileSync(join(r.root, 'src/value.cjs'), 'module.exports={a:0,b:2}');
    assert.throws(() => runTask(r.root, 'c1', 'B', r.good(), inspection), { code: 'E_ATTEMPTS_EXCEEDED' });
  } finally { cleanup(r.root); }
});

test('failed reverification stays invalid until reconciled and rerun; missing evidence cannot authorize completion', () => {
  const r = fixture();
  try {
    initTasks(r.root, 'c1', r.plan); const first = runTask(r.root, 'c1', 'A', r.good());
    writeFileSync(join(r.root, first.attempt.result_ref), '{}');
    assert.throws(() => taskStatus(r.root, 'c1'), { code: 'E_TASK_EVIDENCE' });
    assert.equal(verifyTasks(r.root, 'c1').ok, true);
    writeFileSync(join(r.root, 'src/value.cjs'), 'module.exports={a:0,b:0}');
    assert.equal(verifyTasks(r.root, 'c1').ok, false);
    assert.equal(taskStatus(r.root, 'c1').tasks[0].status, 'stale');
    const op = pendingWork(r.root, 'c1').operation_id;
    reconcileWork(r.root, 'c1', op, { note: 'Regression reproduced and inspected.', next: 'Restore the verified behavior and run checks.', refs: ['src/value.cjs'] });
    writeFileSync(join(r.root, 'src/value.cjs'), 'module.exports={a:1,b:0}');
    assert.equal(verifyTasks(r.root, 'c1').ok, true);
    assert.deepEqual(taskStatus(r.root, 'c1').ready, ['B']);
  } finally { cleanup(r.root); }
});

test('scope approval and actual branch are checked before dispatch', () => {
  const r = fixture();
  try {
    r.git(['checkout', '-q', 'main']); assert.throws(() => initTasks(r.root, 'c1', r.plan), { code: 'E_TASK_BRANCH' });
    r.git(['checkout', '-q', 'feature']); initTasks(r.root, 'c1', r.plan);
    const c = r.s.change('c1'); r.s.putChange({ ...c, scope: 'changed contract' });
    assert.throws(() => runTask(r.root, 'c1', 'A', r.good()), { code: 'E_TASK_STALE' });
  } finally { cleanup(r.root); }
});

test('cyclic, unknown, untested and cross-task writable oracles are refused', () => {
  const r = fixture();
  try {
    for (const edit of [p => p.tasks[0].depends_on.push('B'), p => p.tasks[0].depends_on.push('missing'),
      p => p.tasks[0].scenarios.push('unverified'), p => p.tasks[1].allowed_paths.push('tests/a.cjs'), p => p.tasks[0].allowed_paths.push('../outside')]) {
      const p = structuredClone(r.plan); edit(p); assert.throws(() => validatePlan(r.root, p));
    }
  } finally { cleanup(r.root); }
});

test('out of scope modifications and changed acceptance files fail closed', () => {
  for (const target of ['unrelated.txt', 'tests/a.cjs']) {
    const r = fixture();
    try {
      initTasks(r.root, 'c1', r.plan);
      const config = r.bridge(`fs.writeFileSync('src/value.cjs','module.exports={a:1,b:0}');fs.writeFileSync(${JSON.stringify(target)},'tampered');console.log(JSON.stringify({status:'completed'}));`);
      if (target.startsWith('tests')) assert.throws(() => runTask(r.root, 'c1', 'A', config), { code: 'E_TASK_STALE' });
      else { const out = runTask(r.root, 'c1', 'A', config); assert.equal(out.ok, false); assert.equal(out.scope_ok, false); }
      assert.ok(pendingWork(r.root, 'c1'));
    } finally { cleanup(r.root); }
  }
});

test('exit zero with empty TAP or skipped named tests is never accepted', () => {
  const r = fixture();
  try {
    writeFileSync(join(r.root, 'tests/a.cjs'), "console.log('TAP version 13\\n1..1\\nok 1 - A # SKIP');");
    initTasks(r.root, 'c1', r.plan);
    assert.equal(runTask(r.root, 'c1', 'A', r.good()).ok, false);
  } finally { cleanup(r.root); }
});

test('a busy executor cannot be claimed by another process', () => {
  const r = fixture();
  try {
    initTasks(r.root, 'c1', r.plan);
    writeFileSync(join(r.root, '.spectree/tasks/executor.lock'), '{}');
    assert.throws(() => runTask(r.root, 'c1', 'A', r.good()), { code: 'E_TASK_BUSY' });
  } finally { cleanup(r.root); }
});

test('attempt budget remains exhausted after reconciliation and every uncertain attempt is retained', () => {
  const r = fixture();
  try {
    r.plan.tasks[0].max_attempts = 1; initTasks(r.root, 'c1', r.plan);
    const out = runTask(r.root, 'c1', 'A', r.bridge("console.log('{}');"));
    assert.equal(out.attempt.status, 'unknown');
    recoverTask(r.root, 'c1', out.attempt.id, { cause: 'Empty envelope, no writes.', new_hypothesis: 'Fix transport.', refs: ['src/value.cjs'], processes_stopped: true });
    assert.equal(taskStatus(r.root, 'c1').tasks[0].status, 'exhausted');
    assert.throws(() => runTask(r.root, 'c1', 'A', r.good()), { code: 'E_TASK_NOT_READY' });
  } finally { cleanup(r.root); }
});

test('process death after an actual write leaves a recoverable attempt, never an automatic retry', async () => {
  const r = fixture();
  try {
    initTasks(r.root, 'c1', r.plan);
    const config = r.bridge("fs.writeFileSync('src/value.cjs','module.exports={a:1,b:0}');process.kill(JSON.parse(fs.readFileSync('.spectree/tasks/executor.lock','utf8')).pid,'SIGKILL');");
    writeFiles(r.root, { '.spectree/config.json': JSON.stringify(config) });
    const child = spawn(process.execPath, [join(REPO, 'scripts/tasks.mjs'), 'run', 'c1', 'A', '--adapter', '.spectree/config.json', '--apply'],
      { cwd: r.root, env: { ...process.env, SPECTREE_PROJECT_ROOT: r.root }, stdio: 'ignore' });
    await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    const status = taskStatus(r.root, 'c1'); assert.equal(status.pending.length, 1); assert.deepEqual(status.ready, []);
    assert.match(readFileSync(join(r.root, 'src/value.cjs'), 'utf8'), /a:1/);
    // The independent supervisor observes owner death and drains the boundary.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    recoverTask(r.root, 'c1', status.pending[0], { cause: 'Executor died after write; inspected source and stopped child.', new_hypothesis: 'Verify the existing implementation.', refs: ['src/value.cjs'], processes_stopped: true });
    assert.equal(runTask(r.root, 'c1', 'A', r.good()).ok, true);
  } finally { cleanup(r.root); }
});
