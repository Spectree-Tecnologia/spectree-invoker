import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verificationPlan, baselineVerdict, verificationCi } from '../scripts/lib/evidence/verification.mjs';

const plan = () => ({ version: 1, changes_field_meaning: true,
  checks: [{ id: 'round-trip', kind: 'behavior', claim: 'Editing a label preserves the forecast',
    command: ['node', '--test', 'round-trip.test.mjs'], scenario_refs: ['REQ-1/SC-2'],
    counterexample: 'Seed the editor with effective amount instead of forecast', expected_failure: 'Stored forecast changes after saving only the label' }],
  round_trip: { check_id: 'round-trip', invariant: 'Forecast and settled difference are unchanged', scenario_refs: ['REQ-1/SC-2'],
    steps: ['create', 'read', 'edit_other_field', 'save', 'reread'] },
  ci: { jobs: [{ id: 'audit', kind: 'audit', required: true, needs: [] },
    { id: 'tests', kind: 'functional', required: true, needs: [] }], aggregate: { always: true, needs: ['audit', 'tests'] } } });
test('field meaning changes require a discriminating persisted round trip', () => {
  assert.equal(verificationPlan(plan()).ok, true);
  for (const mutate of [p => delete p.round_trip, p => p.round_trip.steps.pop(),
    p => p.checks[0].kind = 'inventory', p => delete p.checks[0].counterexample,
    p => delete p.checks[0].scenario_refs]) {
    const p = plan(); mutate(p); assert.equal(verificationPlan(p).ok, false);
  }
});
test('functional validation cannot be blocked directly or indirectly by the audit', () => {
  const p = plan(); p.ci.jobs[1].needs = ['audit'];
  assert.ok(verificationPlan(p).errors.some(e => e.code === 'E_CI_SERIAL_AUDIT'));
  p.ci.jobs.push({ id: 'middle', kind: 'support', required: false, needs: ['audit'] });
  p.ci.jobs[1].needs = ['middle'];
  assert.ok(verificationPlan(p).errors.some(e => e.code === 'E_CI_SERIAL_AUDIT'));
});
test('cycles, unknown dependencies and missing aggregate inputs fail closed', () => {
  for (const mutate of [p => p.ci.jobs[0].needs = ['audit'], p => p.ci.jobs[1].needs = ['missing'],
    p => p.ci.aggregate.needs = ['tests'], p => p.ci.aggregate.always = false,
    p => p.ci.jobs[0].required = false, p => p.ci.jobs.push(p.ci.jobs[0])]) {
    const p = plan(); mutate(p); assert.equal(verificationPlan(p).ok, false);
  }
});
test('the aggregate refuses a failed, skipped, cancelled or missing required audit even when tests passed', () => {
  for (const audit of ['failure', 'skipped', 'cancelled', undefined]) assert.equal(verificationCi(plan(), { audit, tests: 'success' }).ok, false);
  assert.equal(verificationCi(plan(), { audit: 'success', tests: 'success' }).ok, true);
});
const base = { revision: 'a'.repeat(40), fingerprint: 'b'.repeat(64), environment: 'local' };
const evidence = (id, result, ci = false) => ({ evidence_id: id, property: 'suite.baseline',
  source_kind: 'observed_execution', revision: base.revision, fingerprint: base.fingerprint, result, environment: { ci } });
test('a green retry does not erase instability at the same base and environment', () => {
  const r = baselineVerdict([evidence('red', 'INFRA_ERROR'), evidence('green', 'PASS')], base);
  assert.equal(r.ok, false); assert.equal(r.code, 'E_BASELINE_UNSTABLE');
});
test('explicit CI baseline preserves unresolved local failures without inventing a diagnosis', () => {
  const r = baselineVerdict([evidence('local-red', 'INFRA_ERROR'), evidence('ci-green', 'PASS', true)], { ...base, environment: 'ci' });
  assert.equal(r.ok, true); assert.deepEqual(r.unresolved_elsewhere, ['local-red']);
  assert.match(r.diagnosis, /does not establish/);
});
test('a report, wrong revision, dirty content or unknown environment is not the baseline', () => {
  for (const override of [{ source_kind: 'agent_report' }, { revision: 'c'.repeat(40) },
    { fingerprint: 'd'.repeat(64) }, { environment: {} }]) {
    assert.equal(baselineVerdict([{ ...evidence('e', 'PASS'), ...override }], base).ok, false);
  }
});

test('malformed plans and CI result payloads are refusals', () => {
  for (const checks of [null, {}, 'checks']) assert.equal(verificationPlan({ ...plan(), checks }).ok, false);
  for (const observed of [null, [], 'success']) assert.equal(verificationCi(plan(), observed).ok, false);
});
