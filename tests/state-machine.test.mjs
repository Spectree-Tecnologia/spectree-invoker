// §15.14 infra failure ≠ expected rejection · §15.15 evidence of different content
// §15.16 approval absent/out of scope · §15.17 attempts · §15.18 retry without progress
// §15.20 concurrent update · §15.22 capability unavailable · §15.23 self-review
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, canDispatch, canDispatchWithCapabilities, CODES } from '../scripts/lib/state-machine.mjs';
import { change, evidence, approval } from './helpers.mjs';

const REV = 'f'.repeat(40);
const OTHER = '0'.repeat(40);

test('an illegal transition names where you may actually go', () => {
  const r = canTransition(change({ state: 'draft' }), 'closed', {});
  assert.equal(r.ok, false);
  assert.equal(r.code, CODES.ILLEGAL_TRANSITION);
  assert.match(r.message, /you may go to proposed/);
});

test('scope approval is required, and one for another change does not count', () => {
  const c = change({ state: 'proposed' });
  assert.equal(canTransition(c, 'scope_approved', {}).code, CODES.MISSING_APPROVAL);

  const foreign = approval({ gate: 'scope', revision: REV, change_id: 'some-other-change' });
  assert.equal(canTransition(c, 'scope_approved', { approvals: [foreign] }).code, CODES.APPROVAL_OUT_OF_SCOPE);

  const mine = approval({ gate: 'scope', revision: REV, change_id: 'c1' });
  assert.equal(canTransition(c, 'scope_approved', { approvals: [mine] }).ok, true);
});

test('an approval bound to a revision expires when the revision moves', () => {
  const c = change({ state: 'proposed' });
  const a = approval({ gate: 'scope', revision: OTHER, change_id: 'c1', expires_with_revision: true });
  const r = canTransition(c, 'scope_approved', { approvals: [a], revision: REV });
  assert.equal(r.code, CODES.APPROVAL_STALE);
});

test('an approval for the wrong gate never satisfies another gate', () => {
  const c = change({ state: 'ci_green' });
  const scope = approval({ gate: 'scope', revision: REV, change_id: 'c1' });
  assert.equal(canTransition(c, 'integration_approved', { approvals: [scope], revision: REV }).code, CODES.MISSING_APPROVAL);
});

test('an agent report does not baseline: the transition needs an observed execution', () => {
  const c = change({ state: 'isolated' });
  const reported = evidence({ property: 'suite.baseline', revision: REV, source_kind: 'agent_report', change_id: 'c1' });
  assert.equal(canTransition(c, 'baselined', { evidence: [reported], revision: REV }).code, CODES.SELF_REPORT_ONLY);
});

test('INFRA_ERROR is not a failing scenario and not a passing one', () => {
  const c = change({ state: 'isolated' });
  const infra = evidence({ property: 'suite.baseline', revision: REV, result: 'INFRA_ERROR', change_id: 'c1' });
  const r = canTransition(c, 'baselined', { evidence: [infra], revision: REV });
  assert.equal(r.code, CODES.EVIDENCE_NOT_PASS);
  assert.match(r.message, /did not exercise the property/);
});

test('evidence measured at another revision is stale, not reusable', () => {
  const c = change({ state: 'pass2_complete' });
  const old = evidence({ property: 'ci.green', revision: OTHER, change_id: 'c1' });
  assert.equal(canTransition(c, 'ci_green', { evidence: [old], revision: REV }).code, CODES.STALE_EVIDENCE);
});

test('superseded evidence is not counted', () => {
  const c = change({ state: 'isolated' });
  const dead = evidence({ property: 'suite.baseline', revision: REV, change_id: 'c1', superseded_by: 'e9' });
  assert.equal(canTransition(c, 'baselined', { evidence: [dead], revision: REV }).code, CODES.MISSING_EVIDENCE);
});

test('pass 2 by an executor that saw the builder is refused as not independent', () => {
  const c = change({ state: 'implemented' });
  const notIndependent = evidence({
    property: 'pass2.attack', revision: REV, change_id: 'c1',
    executor: { role: 'quality_engineer', independent_of: [] },
  });
  const r = canTransition(c, 'pass2_complete', { evidence: [notIndependent], revision: REV });
  assert.equal(r.code, CODES.NOT_INDEPENDENT);
  assert.match(r.message, /saw the builder/);

  const independent = evidence({
    evidence_id: 'e2', property: 'pass2.attack', revision: REV, change_id: 'c1',
    executor: { role: 'quality_engineer', independent_of: ['full_stack_developer'] },
  });
  assert.equal(canTransition(c, 'pass2_complete', { evidence: [independent], revision: REV }).ok, true);
});

test('a deltaless change skips pass 1 and nothing else', () => {
  const deltaless = change({ state: 'baselined', deltaless: true });
  assert.equal(canTransition(deltaless, 'implemented', {}).ok, true, 'pass 1 is skipped');

  const withDelta = change({ state: 'baselined' });
  assert.equal(canTransition(withDelta, 'implemented', {}).ok, false, 'a change with a delta may not skip pass 1');

  // and the steps before the baseline are the same for both
  assert.equal(canTransition(change({ state: 'scope_approved', deltaless: true }), 'baselined', {}).code,
    CODES.ILLEGAL_TRANSITION, 'isolation is not skipped either');
});

test('a concurrent update is refused, not merged', () => {
  const c = change({ state: 'proposed', state_revision: 4 });
  const a = approval({ gate: 'scope', revision: REV, change_id: 'c1' });
  const r = canTransition(c, 'scope_approved', { approvals: [a], revision: REV, expectedStateRevision: 3 });
  assert.equal(r.code, CODES.CONCURRENT_UPDATE);
  assert.match(r.message, /moved underneath/);
});

test('the attempt budget belongs to the key, so renaming the mission does not reset it', () => {
  const base = { change_id: 'c1', role: 'full_stack_developer', budget_key: 'c1:dev', max_attempts: 3 };
  const history = [{ ...base }, { ...base }, { ...base }];
  const r = canDispatch({ ...base, attempt: 4, previous_attempt: { cause: 'x', new_hypothesis: 'y' } }, history);
  assert.equal(r.code, CODES.ATTEMPTS_EXCEEDED);
  assert.match(r.message, /Renaming the mission does not reset it/);

  const renamed = canDispatch(
    { change_id: 'c1', role: 'full_stack_developer', budget_key: 'c1:dev', max_attempts: 3, attempt: 4, previous_attempt: { cause: 'x', new_hypothesis: 'y' } },
    history);
  assert.equal(renamed.code, CODES.ATTEMPTS_EXCEEDED);
});

test('a retry with no new information is refused', () => {
  const d = { change_id: 'c1', role: 'quality_engineer', max_attempts: 3, attempt: 2 };
  assert.equal(canDispatch(d, []).code, CODES.RETRY_WITHOUT_PROGRESS);
  assert.equal(canDispatch({ ...d, previous_attempt: { cause: 'timeout', new_hypothesis: 'raise the timeout' } }, []).ok, true);
});

test('a dispatch needing an absent capability is refused, not warned', () => {
  const d = { required_capabilities: ['network'] };
  assert.equal(canDispatchWithCapabilities(d, { network: 'absent' }).code, CODES.CAPABILITY_UNAVAILABLE);
  assert.equal(canDispatchWithCapabilities(d, {}).code, CODES.CAPABILITY_UNAVAILABLE, 'unknown is not permission');
  assert.equal(canDispatchWithCapabilities(d, { network: 'declared' }).ok, true);
});

test('the machine performs nothing: it only answers', () => {
  const c = change({ state: 'integration_approved' });
  const before = JSON.stringify(c);
  canTransition(c, 'integrated', {});
  assert.equal(JSON.stringify(c), before, 'canTransition must not mutate the change');
});
