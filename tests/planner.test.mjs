import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planNext } from '../scripts/lib/planner.mjs';
import { canTransition } from '../scripts/lib/state-machine.mjs';
import { change, approval, evidence } from './helpers.mjs';
const revision = 'a'.repeat(40);
const ctx = (extra = {}) => ({ revision, contentDigest: 'content-a', contractDigest: 'contract-a',
  closure: { ok: true }, approvals: [approval({ gate: 'scope', change_id: 'c1', revision, scope_digest: 'contract-a' })],
  scopeDigests: { scope: 'contract-a', integration: 'both-a' }, ...extra });
const proof = (property, extra = {}) => evidence({ property, revision, fingerprint: 'content-a',
  executor: { role: 'quality_engineer', independent_of: ['full_stack_developer'] }, ...extra });

test('planner repeats the gate refusal with structured approval identity, not parsed prose', () => {
  const c = change({ state: 'proposed' }), context = ctx({ approvals: [] });
  const p = planNext(c, context);
  assert.equal(p.action, 'request_approval');
  assert.equal(p.approval_gate, 'scope');
  assert.deepEqual(p.gate, canTransition(c, p.target_state, context));
  assert.equal(p.authorizes_execution, false);
});
test('stale evidence recommends the actual missing property and never claims a successful check', () => {
  const p = planNext(change({ state: 'pass2_complete' }), ctx({ evidence: [proof('ci.green', { fingerprint: 'old' })] }));
  assert.equal(p.action, 'produce_evidence');
  assert.equal(p.property, 'ci.green');
  assert.equal(p.code, 'E_CONTENT_CHANGED');
});
test('preparation precedes pass 2 and integration approval; stale scope still comes first', () => {
  for (const state of ['implemented', 'ci_green']) {
    assert.equal(planNext(change({ state }), ctx({ closure: { ok: false } })).action, 'prepare_closure');
    assert.equal(planNext(change({ state }), ctx({ closure: { ok: false }, approvals: [] })).action, 'request_approval');
  }
});
test('M4 is not laundered by a claimed independent_of flag or a passing runtime gate', () => {
  const c = change({ state: 'implemented' });
  const e = { ...proof('pass2.attack'), contract_digest: 'contract-a' };
  const context = ctx({ evidence: [e] });
  assert.equal(canTransition(c, 'pass2_complete', context).ok, true);
  const plan = planNext(c, context);
  assert.equal(plan.action, 'resolve_qa_independence');
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.authorizes_execution, false);
});
test('CI observation changes the recommendation, never the stored evidence or gate', () => {
  const c = change({ state: 'pass2_complete' });
  for (const [status, action] of [['pending', 'wait_ci'], ['failed', 'investigate_ci'], ['unknown', 'inspect_ci'], ['green', 'produce_evidence']]) {
    const context = ctx();
    const before = JSON.stringify(context);
    assert.equal(planNext(c, context, { ci: { status, reason: 'fixture' } }).action, action);
    assert.equal(JSON.stringify(context), before);
  }
});
test('pending operations and corruption precede work, and closed means no new work', () => {
  const context = ctx({ pendingOperation: { kind: 'prepare', phase: 'started', uncertain: true, recovery: 'operator decision required' } });
  const p = planNext(change({ state: 'implemented' }), context);
  assert.equal(p.action, 'recover_operation');
  assert.equal(p.requires_human_decision, true);
  assert.equal(planNext(change(), ctx({ authority: { ok: false, code: 'E_LIFECYCLE_CORRUPT' } })).action, 'repair_authority');
  assert.equal(planNext(change({ state: 'closed' }), ctx()).action, 'none');
  assert.equal(planNext(change({ state: 'blocked', blocked_from: 'implemented' }), ctx()).recovery_target, 'implemented');
});
test('the same input produces the same advisory plan and carries observations, not reusable authority', () => {
  const c = change({ state: 'scope_approved', state_revision: 9 });
  const context = ctx({ evidence: [proof('branch.isolated')] });
  const before = JSON.stringify({ c, context });
  const a = planNext(c, context, { controlRevision: 3 });
  assert.equal(a.action, 'record_transition');
  assert.equal(a.preconditions.state_revision, 9);
  assert.equal(a.preconditions.control_revision, 3);
  assert.deepEqual(a, planNext(c, context, { controlRevision: 3 }));
  assert.equal(JSON.stringify({ c, context }), before);
  assert.equal(planNext(change({ state: 'baselined', deltaless: true }), ctx()).action, 'implement_change');
});
