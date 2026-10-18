import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { gitRepo, cleanup, writeFiles, change, approval, REPO } from './helpers.mjs';
import { Store } from '../scripts/lib/change/store.mjs';
import { contractDigest } from '../scripts/lib/shared/digest.mjs';
import { snapshot, pendingWork, reconcileWork } from '../scripts/lib/change/work.mjs';
import { initTasks, taskStatus, runTask, recoverTask, verifyTasks, validatePlan, planTaskBudget, applyTaskBudget } from '../scripts/lib/execution/task-executor.mjs';
import { codexEvents, preflightAgent, runAgent } from '../scripts/lib/execution/agent-runner.mjs';
import { phaseContext, contextPacket, hash } from '../scripts/lib/execution/context.mjs';
import { engineeringReport } from '../scripts/lib/evaluation/engineering-reports.mjs';

function fixture() {
  const r = gitRepo({ 'src/value.cjs': 'module.exports = { a: 0, b: 0 };\n', 'spec.md': 'Scenario A returns 1. Scenario B returns 2.\n',
    'tests/a.cjs': "const {test}=require('node:test');const assert=require('node:assert/strict');test('A',()=>assert.equal(require('../src/value.cjs').a,1));\n",
    'tests/b.cjs': "const {test}=require('node:test');const assert=require('node:assert/strict');test('B',()=>assert.equal(require('../src/value.cjs').b,2));\n" });
  r.git(['checkout', '-qb', 'feature']);
  const s = new Store(r.root); s.init({ project_id: 'proj', protocol_version: '1.0.0' });
  const c = s.putChange(change({ base_revision: r.base, state: 'pass1_complete', closure_mode: 'legacy', allowed_paths: ['src/'] }));
  s.putApproval(approval({ change_id: 'c1', gate: 'scope', revision: r.base, scope_digest: contractDigest(r.root, c).digest }));
  const plan = { version: 1, tasks: ['A', 'B'].map((id, i) => ({ id, mission: `Implement scenario ${id}`, depends_on: i ? ['A'] : [],
    refs: ['spec.md'], scenarios: [id], allowed_paths: ['src/value.cjs'], max_attempts: 2,
    checks: [{ scenario: id, test_name: id, command: [process.execPath, '--test', '--test-reporter=tap', `tests/${id.toLowerCase()}.cjs`], files: [`tests/${id.toLowerCase()}.cjs`], timeout_seconds: 10 }] })) };
  const bridge = (body) => {
    writeFiles(r.root, { '.spectree/bridge.cjs': `const fs=require('node:fs');const p=JSON.parse(fs.readFileSync(0,'utf8'));${body}` });
    return { kind: 'bridge', command: [process.execPath, '.spectree/bridge.cjs'], timeout_seconds: 10 };
  };
  const good = () => bridge("const e=JSON.parse(fs.readFileSync('.spectree/runs/c1/'+p.dispatch_id+'/000001.json'));if(e.type!=='run.started')throw Error('missing start');const v=require('../src/value.cjs');v[p.task.id.toLowerCase()]=p.task.id==='A'?1:2;fs.writeFileSync('src/value.cjs','module.exports = '+JSON.stringify(v));console.log(JSON.stringify({status:'completed'}));");
  return { ...r, s, plan, bridge, good };
}
test('dependency frontier executes and reverifies real named tests without advancing lifecycle', () => {
  const r = fixture();
  try {
    assert.deepEqual(initTasks(r.root, 'c1', r.plan).ready, ['A']);
    assert.throws(() => runTask(r.root, 'c1', 'A', { kind: 'invalid' }), { code: 'E_AGENT_CONFIG' });
    assert.equal(taskStatus(r.root, 'c1').tasks[0].attempts, 0);
    const can = () => spawnSync(process.execPath, [join(REPO, 'scripts/state.mjs'), 'can', 'c1', 'implemented'],
      { cwd: r.root, env: { ...process.env, SPECTREE_PROJECT_ROOT: r.root }, encoding: 'utf8' });
    assert.match(can().stderr, /E_TASK_INCOMPLETE/);
    assert.throws(() => runTask(r.root, 'c1', 'B', r.good()), { code: 'E_TASK_NOT_READY' });
    const first = runTask(r.root, 'c1', 'A', r.good());
    assert.equal(first.ok, true, readFileSync(join(r.root, first.attempt.result_ref), 'utf8'));
    assert.deepEqual(taskStatus(r.root, 'c1').ready, ['B']);
    const result = runTask(r.root, 'c1', 'B', r.good());
    assert.equal(result.ok, true, readFileSync(join(r.root, result.attempt.result_ref), 'utf8')); assert.equal(result.verification.checks.length, 2);
    assert.equal(result.status.complete, true); assert.equal(r.s.change('c1').state, 'pass1_complete');
    const planned = spawnSync(process.execPath, [join(REPO, 'scripts/state.mjs'), 'plan', 'c1', '--json'],
      { cwd: r.root, env: { ...process.env, SPECTREE_PROJECT_ROOT: r.root }, encoding: 'utf8' });
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
test('Codex JSONL parsing requires a completed turn and respects errors and malformed output', () => {
  const success = { status: 0 };
  assert.equal(codexEvents('{"type":"turn.completed","usage":{"input_tokens":10}}', success).status, 'turn_completed');
  assert.equal(codexEvents('{"type":"thread.started"}', success).status, 'unknown');
  assert.equal(codexEvents('not json', success).status, 'unknown');
  assert.equal(codexEvents('{"type":"turn.failed","error":{"message":"quota exceeded"}}', success).status, 'interrupted');
  assert.equal(codexEvents('{"type":"turn.completed"}', { status: 1 }).status, 'failed');
});
test('phase context preserves common rules, separates phase material and fingerprints references', () => {
  const r = fixture();
  try {
    const p = contextPacket(r.root, r.plan.tasks[0], { change_id: 'c1' });
    assert.deepEqual(p.profile.sources.map((s) => s.name), ['core', 'implement']);
    assert.match(p.profile.sources[0].text, /quota/); assert.notEqual(phaseContext('review').digest, p.profile.digest);
    const old = p.reading[0].sha256; writeFileSync(join(r.root, 'spec.md'), 'changed');
    assert.notEqual(contextPacket(r.root, r.plan.tasks[0], {}).reading[0].sha256, old);
  } finally { cleanup(r.root); }
});
test('reports require both review axes and evidence for blockers; candidate edits invalidate them', () => {
  const r = fixture();
  try {
    const doc = { version: 1, candidate: snapshot(r.root), spec: [], standards: [] };
    assert.equal(engineeringReport(r.root, 'review', doc).ok, true);
    assert.throws(() => engineeringReport(r.root, 'review', { ...doc, spec: undefined }));
    assert.throws(() => engineeringReport(r.root, 'review', { ...doc, spec: [{ kind: 'blocker', claim: 'bad', basis: 'spec' }] }));
    writeFileSync(join(r.root, 'src/value.cjs'), 'changed');
    assert.throws(() => engineeringReport(r.root, 'review', doc), { code: 'E_REPORT_STALE' });
  } finally { cleanup(r.root); }
});
test('diagnosis cannot conceal intermittent failures with invalid counts or unsupported cause', () => {
  const r = fixture();
  try {
    const doc = { version: 1, candidate: snapshot(r.root), symptom: 'timeout', environment: 'local', conclusion: 'inconclusive',
      hypotheses: [{ id: 'h1', claim: 'worker contention', prediction: 'one worker lowers failure rate' }],
      observations: [{ hypothesis: 'h1', command: ['node', '--test'], attempts: 3, failures: 2, intervention: 'none', refs: ['spec.md'] }] };
    assert.equal(engineeringReport(r.root, 'diagnosis', doc).ok, true);
    assert.throws(() => engineeringReport(r.root, 'diagnosis', { ...doc, conclusion: 'cause_supported' }));
    doc.observations[0].failures = 4; assert.throws(() => engineeringReport(r.root, 'diagnosis', doc));
  } finally { cleanup(r.root); }
});

test('reviewed budget revision is bounded, candidate-bound, audited, and preserves old attempts and immutable plan', () => {
  const r = fixture();
  try {
    r.plan.tasks[0].max_attempts = 1; initTasks(r.root, 'c1', r.plan);
    const failed = runTask(r.root, 'c1', 'A', r.bridge("console.log(JSON.stringify({status:'completed'}));"));
    assert.equal(failed.verification.checks[0].result, 'FAIL');
    const inspect = { cause: 'No implementation.', new_hypothesis: 'Write the missing behavior.', refs: [failed.attempt.result_ref], new_max_attempts: 2 };
    assert.throws(() => planTaskBudget(r.root, 'c1', 'A', inspect), { code: 'E_TASK_PENDING' });
    recoverTask(r.root, 'c1', failed.attempt.id, { ...inspect, processes_stopped: true });
    const path = join(r.root, '.spectree/tasks/c1.json');
    const original = JSON.parse(readFileSync(path));
    const advise = () => JSON.parse(spawnSync(process.execPath, [join(REPO, 'scripts/state.mjs'), 'plan', 'c1', '--json'],
      { cwd: r.root, env: { ...process.env, SPECTREE_PROJECT_ROOT: r.root }, encoding: 'utf8' }).stdout);
    assert.equal(advise().action, 'review_task_budget');
    r.s.putChange({ ...r.s.change('c1'), state: 'blocked', blocked_from: 'pass1_complete', blocked_reason: 'Budget exhausted after inspected failure.' });
    assert.throws(() => planTaskBudget(r.root, 'c1', 'A', { ...inspect, new_max_attempts: 5 }), { code: 'E_TASK_BUDGET' });
    assert.throws(() => planTaskBudget(r.root, 'c1', 'B', inspect), { code: 'E_TASK_BUDGET' });
    writeFiles(r.root, { '.spectree/operator-decision.txt': 'Synthetic operator authorizes one additional attempt for A.' });
    const plan = planTaskBudget(r.root, 'c1', 'A', inspect);
    const decision = { decision: 'approve', plan_digest: hash(plan), kind: 'human_in_session', identity: 'fixture operator', reason: 'Reviewed missing behavior.', refs: ['.spectree/operator-decision.txt'] };
    assert.throws(() => applyTaskBudget(r.root, 'c1', plan, { ...decision, plan_digest: 'wrong' }), { code: 'E_TASK_BUDGET_DECISION' });
    assert.throws(() => applyTaskBudget(r.root, 'c1', plan, { ...decision, kind: 'agent' }), { code: 'E_TASK_BUDGET_DECISION' });
    const receiptPath = join(r.root, failed.attempt.process_ref, 'agent/receipt.json');
    const receipt = readFileSync(receiptPath, 'utf8');
    writeFileSync(receiptPath, '{}');
    assert.throws(() => applyTaskBudget(r.root, 'c1', plan, decision), { code: 'E_TASK_PENDING' });
    writeFileSync(receiptPath, receipt);
    const oldChange = r.s.change('c1');
    const changePath = join(r.root, '.spectree/changes/c1.json');
    const changeBytes = readFileSync(changePath);
    r.s.putChange(oldChange);
    assert.throws(() => applyTaskBudget(r.root, 'c1', plan, decision), { code: 'E_TASK_BUDGET_STALE' });
    writeFileSync(changePath, changeBytes); // Restore this synthetic mutation byte for byte.
    const evidencePath = join(r.root, failed.attempt.result_ref);
    const evidence = readFileSync(evidencePath, 'utf8');
    writeFileSync(evidencePath, '{}');
    assert.throws(() => applyTaskBudget(r.root, 'c1', plan, decision), { code: 'E_TASK_BUDGET_STALE' });
    writeFileSync(evidencePath, evidence);
    writeFileSync(join(r.root, 'src/value.cjs'), 'module.exports={a:99,b:0};');
    assert.throws(() => applyTaskBudget(r.root, 'c1', plan, decision), { code: 'E_TASK_BUDGET_STALE' });
    writeFileSync(join(r.root, 'src/value.cjs'), 'module.exports = { a: 0, b: 0 };\n');
    writeFiles(r.root, { '.spectree/budget-plan.json': '\uFEFF' + JSON.stringify({ plan, plan_digest: hash(plan) }),
      '.spectree/budget-decision.json': JSON.stringify(decision) });
    const applied = spawnSync(process.execPath, [join(REPO, 'scripts/tasks.mjs'), 'budget-apply', 'c1', '.spectree/budget-plan.json', '--decision', '.spectree/budget-decision.json', '--apply'],
      { cwd: r.root, env: { ...process.env, SPECTREE_PROJECT_ROOT: r.root }, encoding: 'utf8' });
    assert.equal(applied.status, 0, applied.stderr);
    const result = JSON.parse(applied.stdout);
    assert.deepEqual(result.status.ready, ['A']); assert.equal(result.authorizes_execution, false);
    const after = JSON.parse(readFileSync(path));
    assert.deepEqual(after.plan, original.plan); assert.deepEqual(after.attempts, original.attempts); assert.deepEqual(after.results, original.results);
    assert.equal(after.budget_revisions[0].decision.identity, 'fixture operator');
    assert.throws(() => applyTaskBudget(r.root, 'c1', plan, decision));
    assert.equal(r.s.change('c1').state, 'blocked'); assert.equal(advise().action, 'resolve_blocker');
    assert.throws(() => runTask(r.root, 'c1', 'A', r.good()), { code: 'E_TASK_GATE' });
    const unblocked = { ...r.s.change('c1'), state: 'pass1_complete' };
    delete unblocked.blocked_from; delete unblocked.blocked_reason;
    r.s.putChange(unblocked); // Explicit fixture lifecycle recovery, never performed by budget application.
    assert.equal(advise().action, 'implement_change');
    const retried = runTask(r.root, 'c1', 'A', r.bridge("if(p.retry?.new_hypothesis!=='Write the missing behavior.')throw Error('Missing inspected hypothesis');fs.writeFileSync('src/value.cjs','module.exports={a:1,b:0}');console.log(JSON.stringify({status:'completed'}));"));
    assert.equal(retried.ok, true);
    const retryPacket = JSON.parse(readFileSync(join(r.root, retried.attempt.packet_ref)));
    assert.equal(retryPacket.retry.previous_operation, failed.attempt.id);
    assert.equal(retryPacket.retry.budget_revision, after.budget_revisions[0].digest);
    assert.deepEqual(r.s.dispatches('c1').map(d => d.attempt).sort(), [1, 2]);
    assert.equal(taskStatus(r.root, 'c1').tasks[0].original_max_attempts, 1);
    assert.equal(r.s.change('c1').state, 'pass1_complete');
    const corrupted = JSON.parse(readFileSync(path));
    corrupted.budget_revisions[0].plan.new_max_attempts = 10;
    writeFileSync(path, JSON.stringify(corrupted));
    assert.throws(() => taskStatus(r.root, 'c1'), { code: 'E_TASK_STORE' });
  } finally { cleanup(r.root); }
});

test('preflight refuses unavailable launcher before writing an attempt, and never claims nested tools or quota', () => {
  const r = fixture();
  try {
    initTasks(r.root, 'c1', r.plan);
    assert.throws(() => runTask(r.root, 'c1', 'A', { kind: 'codex', executable: join(r.root, 'missing-agent') }), { code: 'E_AGENT_PREREQUISITE' });
    assert.throws(() => runTask(r.root, 'c1', 'A', { kind: 'bridge', command: [process.execPath, 'missing-bridge.mjs'] }), { code: 'E_AGENT_PREREQUISITE' });
    assert.equal(taskStatus(r.root, 'c1').tasks[0].attempts, 0);
    assert.equal(r.s.dispatches('c1').length, 0);
    const check = preflightAgent(r.root, r.good());
    assert.equal(check.ok, true); assert.equal(check.nested_tools, 'unverified'); assert.equal(check.quota, 'unverified');
  } finally { cleanup(r.root); }
});

test('Codex terminal events distinguish transport completion, blocked mission, unavailable tools and delivery claims', () => {
  const parse = (message, extra = []) => codexEvents([...extra, { type: 'item.completed', item: { type: 'agent_message', text: message } }, { type: 'turn.completed' }].map(JSON.stringify).join('\n'), { status: 0 });
  assert.equal(parse('I could not complete the task').status, 'turn_completed');
  const blocked = parse(JSON.stringify({ spectree_result: 1, status: 'blocked', reason: 'Missing tool.' }));
  assert.equal(blocked.status, 'failed'); assert.equal(blocked.classification, 'blocked');
  assert.equal(parse(JSON.stringify({ spectree_result: 1, status: 'completed', reason: 'Implemented.' })).status, 'reported_success');
  assert.equal(parse(JSON.stringify({ spectree_result: 1, status: 'completed', reason: 'Implemented quota handling and resolved tool_unavailable.' })).status, 'reported_success');
  assert.equal(parse('blocked', [{ type: 'item.completed', item: { error: 'helper_unknown_error' } }]).classification, 'tool_unavailable');
  assert.equal(parse('Done', [{ type: 'item.completed', item: { type: 'command_execution', exit_code: 0, aggregated_output: 'Source mentions quota and helper_unknown_error.' } }]).status, 'turn_completed');
  assert.equal(codexEvents('{"type":"turn.completed"}\n{"type":"turn.completed"}', { status: 0 }).status, 'unknown');
  assert.equal(codexEvents('null', { status: 0 }).classification, 'protocol_error');
  const partial = codexEvents('{"type":', { status: null, error: { code: 'ETIMEDOUT' } });
  assert.equal(partial.status, 'interrupted'); assert.equal(partial.classification, 'timeout');
});

test('bridge timeout wins over exit one and terminal observation persists before acceptance', () => {
  const r = fixture();
  try {
    const config = r.bridge("console.log(JSON.stringify({status:'failed',error:'timeout'}));process.exitCode=1;");
    const result = runAgent(r.root, {}, config);
    assert.equal(result.status, 'interrupted'); assert.equal(result.classification, 'timeout');
    const durable = JSON.parse(readFileSync(join(r.root, result.process.ref, 'agent-result.json')));
    assert.equal(durable.status, 'interrupted'); assert.equal(durable.exit_code, 1);
    const quota = runAgent(r.root, {}, r.bridge("console.log(JSON.stringify({status:'failed',error:'quota_exceeded'}));process.exitCode=1;"));
    assert.equal(quota.status, 'interrupted'); assert.equal(quota.classification, 'quota');
    const delivered = runAgent(r.root, {}, r.bridge("console.log(JSON.stringify({status:'completed',summary:'Implemented quota handling.'}));"));
    assert.equal(delivered.status, 'reported_success'); assert.equal(delivered.classification, 'delivery_reported');
  } finally { cleanup(r.root); }
});
