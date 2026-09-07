// §15.14 infra failure ≠ expected rejection · §15.15 evidence of different content
// §15.16 approval absent/out of scope · §15.17 attempts · §15.18 retry without progress
// §15.20 concurrent update · §15.22 capability unavailable · §15.23 self-review
//
// The acceptance regressions for the same module live in acceptance-regressions.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, canDispatch, canDispatchWithCapabilities, ENTRY_REQUIREMENTS, ORDER, CODES } from '../scripts/lib/state-machine.mjs';
import { change, evidence, approval } from './helpers.mjs';

const REV = 'f'.repeat(40);
const OTHER = '0'.repeat(40);

/** A scope approval that is bound, fresh and content-matched — so tests can isolate one variable. */
const scopeOk = (o = {}) => approval({ approval_id: 'ap-scope', gate: 'scope', change_id: 'c1', scope_digest: 'D-scope', revision: REV, ...o });
const integrationOk = (o = {}) => approval({ approval_id: 'ap-int', gate: 'integration', change_id: 'c1', scope_digest: 'D-int', revision: REV, ...o });
const DIGESTS = { scope: 'D-scope', integration: 'D-int' };
const ctx = (o = {}) => ({ approvals: [scopeOk()], revision: REV, scopeDigests: DIGESTS, ...o });

test('the pipeline moves one step at a time, and the message says where you may go', () => {
  const r = canTransition(change({ state: 'draft' }), 'closed', {});
  assert.equal(r.code, CODES.ILLEGAL_TRANSITION);
  assert.match(r.message, /you may go to proposed, blocked/);
});

test('every state in the order is reachable only from its predecessor', () => {
  for (let i = 1; i < ORDER.length; i++) {
    const from = ORDER[i - 1], to = ORDER[i];
    const skipTarget = ORDER[i + 1];
    if (!skipTarget) continue;
    const r = canTransition(change({ state: from }), skipTarget, ctx());
    assert.equal(r.ok, false, `${from} must not jump straight to ${skipTarget}`);
  }
});

test('scope approval is required, and one for another change does not count', () => {
  const c = change({ state: 'proposed' });
  assert.equal(canTransition(c, 'scope_approved', { revision: REV, scopeDigests: DIGESTS }).code, CODES.MISSING_APPROVAL);

  const foreign = scopeOk({ change_id: 'some-other-change' });
  assert.equal(canTransition(c, 'scope_approved', ctx({ approvals: [foreign] })).code, CODES.APPROVAL_OUT_OF_SCOPE);

  assert.equal(canTransition(c, 'scope_approved', ctx()).ok, true);
});

test('the digest is what expires an approval; the revision only when it says so', () => {
  const c = change({ state: 'proposed' });
  assert.equal(canTransition(c, 'scope_approved', ctx({ approvals: [scopeOk({ revision: OTHER })] })).ok, true,
    'a commit that left the contract alone does not revoke the contract approval');
  assert.equal(canTransition(c, 'scope_approved', ctx({ approvals: [scopeOk({ revision: OTHER, expires_with_revision: true })] })).code,
    CODES.APPROVAL_STALE);
});

test('an approval for the wrong gate never satisfies another gate', () => {
  const c = change({ state: 'ci_green' });
  // Integrating re-checks the technical evidence too, so supply it and vary only the approval.
  const proven = [
    evidence({ evidence_id: 'e-qa', property: 'pass2.attack', revision: REV, change_id: 'c1',
      executor: { role: 'quality_engineer', independent_of: ['full_stack_developer'] } }),
    evidence({ evidence_id: 'e-ci', property: 'ci.green', revision: REV, change_id: 'c1' }),
  ];
  const r = canTransition(c, 'integration_approved', ctx({ evidence: proven }));
  assert.equal(r.code, CODES.MISSING_APPROVAL);
  assert.match(r.message, /"integration"/);
  assert.equal(canTransition(c, 'integration_approved', ctx({ evidence: proven, approvals: [scopeOk(), integrationOk()] })).ok, true);
});

test('a human signature does not stand in for a run on the code being integrated', () => {
  // The defect: integration_approved and integrated checked approvals and nothing else, so
  // approving new content was enough to carry it past QA and CI that never saw it.
  const c = change({ state: 'ci_green' });
  const r = canTransition(c, 'integration_approved', ctx({ approvals: [scopeOk(), integrationOk()] }));
  assert.equal(r.code, CODES.MISSING_EVIDENCE);
  assert.match(r.message, /pass2\.attack/);
});

test('an agent report does not baseline: the transition needs an observed execution', () => {
  const reported = evidence({ property: 'suite.baseline', revision: REV, source_kind: 'agent_report', change_id: 'c1' });
  const r = canTransition(change({ state: 'isolated' }), 'baselined', ctx({ evidence: [reported] }));
  assert.equal(r.code, CODES.SELF_REPORT_ONLY);
});

test('INFRA_ERROR is not a failing scenario and not a passing one', () => {
  const infra = evidence({ property: 'suite.baseline', revision: REV, result: 'INFRA_ERROR', change_id: 'c1' });
  const r = canTransition(change({ state: 'isolated' }), 'baselined', ctx({ evidence: [infra] }));
  assert.equal(r.code, CODES.EVIDENCE_NOT_PASS);
  assert.match(r.message, /did not exercise the property/);
});

test('evidence measured at another revision is stale where freshness is required', () => {
  const old = evidence({ property: 'ci.green', revision: OTHER, change_id: 'c1' });
  const r = canTransition(change({ state: 'pass2_complete' }), 'ci_green', ctx({ evidence: [old] }));
  assert.equal(r.code, CODES.STALE_EVIDENCE);
});

test('superseded evidence is not counted', () => {
  const dead = evidence({ property: 'suite.baseline', revision: REV, change_id: 'c1', superseded_by: 'e9' });
  const r = canTransition(change({ state: 'isolated' }), 'baselined', ctx({ evidence: [dead] }));
  assert.equal(r.code, CODES.MISSING_EVIDENCE);
});

test('pass 2 by an executor that saw the builder is refused as not independent', () => {
  const c = change({ state: 'implemented' });
  const notIndependent = evidence({
    property: 'pass2.attack', revision: REV, change_id: 'c1',
    executor: { role: 'quality_engineer', independent_of: [] },
  });
  const r = canTransition(c, 'pass2_complete', ctx({ evidence: [notIndependent] }));
  assert.equal(r.code, CODES.NOT_INDEPENDENT);
  assert.match(r.message, /saw the builder/);

  const independent = evidence({
    evidence_id: 'e2', property: 'pass2.attack', revision: REV, change_id: 'c1',
    executor: { role: 'quality_engineer', independent_of: ['full_stack_developer'] },
  });
  assert.equal(canTransition(c, 'pass2_complete', ctx({ evidence: [independent] })).ok, true);
});

test('a deltaless change skips pass 1 and nothing else', () => {
  assert.equal(canTransition(change({ state: 'baselined', deltaless: true }), 'implemented', ctx()).ok, true);
  assert.equal(canTransition(change({ state: 'baselined' }), 'implemented', ctx()).ok, false,
    'a change with a delta may not skip pass 1');
  assert.equal(canTransition(change({ state: 'scope_approved', deltaless: true }), 'baselined', ctx()).ok, false,
    'isolation is not skipped either');
});

test('a concurrent update is refused, not merged', () => {
  const c = change({ state: 'proposed', state_revision: 4 });
  const r = canTransition(c, 'scope_approved', ctx({ expectedStateRevision: 3 }));
  assert.equal(r.code, CODES.CONCURRENT_UPDATE);
  assert.match(r.message, /moved underneath/);
});

test('the attempt budget belongs to the key, so renaming the mission does not reset it', () => {
  const base = { change_id: 'c1', role: 'full_stack_developer', budget_key: 'c1:dev', max_attempts: 3 };
  const history = [{ ...base }, { ...base }, { ...base }];
  const r = canDispatch({ ...base, attempt: 4, previous_attempt: { cause: 'x', new_hypothesis: 'y' } }, history);
  assert.equal(r.code, CODES.ATTEMPTS_EXCEEDED);
  assert.match(r.message, /Renaming the mission does not reset it/);
});

test('a retry with no new information is refused', () => {
  const d = { change_id: 'c1', role: 'quality_engineer', max_attempts: 3, attempt: 2 };
  assert.equal(canDispatch(d, []).code, CODES.RETRY_WITHOUT_PROGRESS);
  assert.equal(canDispatch({ ...d, previous_attempt: { cause: 'timeout', new_hypothesis: 'raise the timeout' } }, []).ok, true);
});

test('only a declared or verified capability lets a dispatch through', () => {
  const d = { required_capabilities: ['network'] };
  assert.equal(canDispatchWithCapabilities(d, { network: 'absent' }).code, CODES.CAPABILITY_UNAVAILABLE);
  assert.equal(canDispatchWithCapabilities(d, { network: 'unknown' }).code, CODES.CAPABILITY_UNAVAILABLE);
  assert.equal(canDispatchWithCapabilities(d, {}).code, CODES.CAPABILITY_UNAVAILABLE);
  assert.equal(canDispatchWithCapabilities(d, { network: 'declared' }).ok, true);
});

test('requirements are attached to the state entered, not to the edge', () => {
  // The defect this guards: a state reachable by two edges, checked on only one of them.
  for (const state of Object.keys(ENTRY_REQUIREMENTS)) {
    assert.ok(ORDER.includes(state) || state === 'blocked', `${state} is a known state`);
  }
  assert.deepEqual(ENTRY_REQUIREMENTS.blocked, {}, 'blocking is an admission, not an achievement');
  assert.ok(ENTRY_REQUIREMENTS.closed.approvals.includes('integration'));
});

test('the machine performs nothing: it only answers', () => {
  const c = change({ state: 'integration_approved' });
  const before = JSON.stringify(c);
  canTransition(c, 'integrated', ctx());
  assert.equal(JSON.stringify(c), before, 'canTransition must not mutate the change');
});
