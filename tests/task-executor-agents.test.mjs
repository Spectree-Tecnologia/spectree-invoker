
//
// This file: agent transports, phase context, reports and budget revisions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanup, writeFiles, REPO, closureCli } from './helpers.mjs';
import { snapshot } from '../scripts/lib/change/work.mjs';
import { initTasks, taskStatus, runTask, recoverTask, planTaskBudget, applyTaskBudget } from '../scripts/lib/execution/task-executor.mjs';
import { codexEvents, claudeEvents, preflightAgent, runAgent } from '../scripts/lib/execution/agent-runner.mjs';
import { phaseContext, contextPacket, hash } from '../scripts/lib/execution/context.mjs';
import { engineeringReport } from '../scripts/lib/evaluation/engineering-reports.mjs';
import { fixture } from './task-executor-fixture.mjs';

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
    const advise = () => JSON.parse(closureCli(join(REPO, 'scripts/state.mjs'), ['plan', 'c1', '--json'], { cwd: r.root, env: { SPECTREE_PROJECT_ROOT: r.root } }).stdout);
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

test('a completed claim after prose, in a fence, or after a red run about rate limits is no quota', () => {
  const claim = (status, reason) => JSON.stringify({ spectree_result: 1, status, reason });
  const done = claim('completed', 'T-HTTP implemented.');
  const codex = (message, extra = []) => codexEvents([...extra, { type: 'item.completed', item: { type: 'agent_message', text: message } }, { type: 'turn.completed' }].map(JSON.stringify).join('\n'), { status: 0 });
  const claude = (message) => claudeEvents(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: message }), { status: 0 });
  const red = [{ type: 'item.completed', item: { type: 'command_execution', exit_code: 1, aggregated_output: 'not ok 3 - rate limit returns 429' } }];
  for (const message of [`The HTTP rate limit now answers 429 after ten requests.\n\n${done}`, 'Done.\n```json\n' + done + '\n```']) {
    for (const parsed of [codex(message), claude(message)]) {
      assert.equal(parsed.status, 'reported_success'); assert.equal(parsed.classification, 'delivery_reported');
      assert.equal(parsed.mission.status, 'completed');
    }
  }
  const afterRed = codex(done, red);
  assert.equal(afterRed.status, 'reported_success'); assert.equal(afterRed.classification, 'delivery_reported');
  // A failed claim about a rate-limit task is a failure; only an interrupted claim or the harness says quota.
  const failed = codex(`Notes.\n${claim('failed', 'The rate limit test still fails.')}`);
  assert.equal(failed.status, 'failed'); assert.equal(failed.classification, 'agent_failure');
  const interrupted = claude(claim('interrupted', 'Hit the usage limit.'));
  assert.equal(interrupted.status, 'interrupted'); assert.equal(interrupted.classification, 'quota');
  assert.equal(codex('Done', [{ type: 'turn.failed', error: { message: 'rate limit exceeded' } }]).classification, 'quota');
  assert.equal(codex(claim('blocked', 'The rate limit fixture is missing.')).classification, 'blocked');
  assert.equal(codex('Done', [{ type: 'error', message: 'usage limit reached' }]).classification, 'quota');
  const denied = claudeEvents(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: done,
    permission_denials: [{ tool_name: 'Bash', tool_input: { command: 'curl /rate-limit' } }] }), { status: 0 });
  assert.equal(denied.status, 'failed'); assert.notEqual(denied.classification, 'quota');
  const deep = '{"a":'.repeat(20000) + '1' + '}'.repeat(20000);
  const started = performance.now(); assert.equal(codex(deep).mission, null); assert.ok(performance.now() - started < 2000);
  // A claim must end the message; an object quoted mid-prose is not one.
  assert.equal(codex(`${done}\nThen I stopped.`).mission, null);
});
