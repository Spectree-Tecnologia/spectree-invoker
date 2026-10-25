import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verificationPlan, verificationChecks, baselineVerdict, verificationCi } from '../scripts/lib/evidence/verification.mjs';

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

// One suite report judges every check that names its tests. The SYND C3a CI spent 28 of its 30
// minutes re-running the suite once per check; the full suite holding the same tests took 72 s.
const report = (lines, plan = lines.length) => ['TAP version 13', ...lines, `1..${plan}`].join('\n');
const named = (tests, extra = {}) => ({ ...plan(), checks: [{ ...plan().checks[0], command: undefined, tests, ...extra }] });
const strip = (p) => { delete p.checks[0].command; return p; };
test('checks are judged from one suite report, by exact test name', () => {
  const p = strip(named(['keeps forecast', 'keeps difference']));
  const r = verificationChecks(p, report(['ok 1 - keeps forecast', 'ok 2 - keeps difference', 'ok 3 - unrelated']));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.checks[0].result, 'PASS');
});
test('a missing, duplicated, skipped or failed name refuses the check, and a broken report judges nothing', () => {
  const p = strip(named(['keeps forecast']));
  for (const [lines, code] of [
    [['ok 1 - keeps forecasts'], 'E_CHECK_FAILED'],
    [['ok 1 - keeps forecast', 'ok 2 - keeps forecast'], 'E_CHECK_FAILED'],
    [['ok 1 - keeps forecast # SKIP later'], 'E_CHECK_FAILED'],
    [['not ok 1 - keeps forecast'], 'E_CHECK_FAILED'],
  ]) {
    const r = verificationChecks(p, report(lines));
    assert.equal(r.ok, false, lines.join(' | ')); assert.equal(r.code, code);
  }
  for (const text of [report(['ok 1 - keeps forecast'], 2), 'ok 1 - keeps forecast', 'Bail out! db down\n' + report(['ok 1 - keeps forecast']), '']) {
    const r = verificationChecks(p, text);
    assert.equal(r.ok, false); assert.equal(r.code, 'E_CHECK_REPORT'); assert.equal(r.checks[0].result, 'INFRA_ERROR');
  }
});
test('a group verdict is not a test, so a describe name never satisfies a check', () => {
  const p = strip(named(['amounts']));
  const tap = ['TAP version 13', '# Subtest: amounts', '    ok 1 - keeps forecast', '    1..1', 'ok 1 - amounts', '1..1'].join('\n');
  assert.equal(verificationChecks(p, tap).ok, false);
});
test('a check carries a command or test names, never both or neither, and a report never stands for a command', () => {
  for (const mutate of [(c) => { c.tests = ['x']; }, (c) => { delete c.command; }, (c) => { delete c.command; c.tests = []; },
    (c) => { delete c.command; c.tests = ['x', 'x']; }]) {
    const p = plan(); mutate(p.checks[0]); assert.equal(verificationPlan(p).ok, false);
  }
  const r = verificationChecks(plan(), report(['ok 1 - anything']));
  assert.equal(r.ok, false); assert.equal(r.code, 'E_CHECK_NONE'); assert.equal(r.checks[0].result, 'NOT_EVALUATED');
});

// The consumer CI blueprint is the cheap shape by default. Each predicate is shown rejecting the
// blueprint main had before v1.51.0: every push to every branch, no cancellation, a shared DB name.
import { readFileSync } from 'node:fs';
const cheap = (yml) => ({
  triggers: /^on:\n {2}pull_request:\n {2}push:\n {4}branches: \[main\]$/m.test(yml),
  cancels: /^concurrency:\n(?: {2}.*\n)* {2}cancel-in-progress: true$/m.test(yml),
  namespace: /SPECTREE_TEST_NAMESPACE: \S*\$\{\{ github\.run_id \}\}/.test(yml),
  oneReport: (yml.match(/--test-reporter=tap/g) ?? []).length === 1 && /verification\.mjs checks "\$plan" suite\.tap/.test(yml),
});
test('the consumer CI blueprint runs once per PR or main push, cancels stale runs and judges checks from one report', () => {
  const before = 'name: Consumer checks\non: [push, pull_request]\npermissions:\n  contents: read\njobs:\n  tests:\n    steps:\n      - run: npm test\n';
  assert.deepEqual(Object.values(cheap(before)), [false, false, false, false]);
  const now = cheap(readFileSync(new URL('../docs/examples/consumer-ci.yml', import.meta.url), 'utf8'));
  assert.deepEqual(now, { triggers: true, cancels: true, namespace: true, oneReport: true });
});

const raced = () => ({ ...plan(),
  checks: [...plan().checks, { id: 'name-race', kind: 'behavior', claim: 'Two racing registrations keep one name',
    tests: ['two concurrent registrations with one name keep one'], scenario_refs: ['REQ-2/SC-1'],
    counterexample: 'Read that the name is free, then write, with nothing between them', counterexample_kind: 'concurrent',
    expected_failure: 'Both racing writes succeed instead of one NAME_TAKEN' }],
  concurrent_invariants: [{ kind: 'uniqueness', invariant: 'One name per user', scenario_refs: ['REQ-2/SC-1'], check_id: 'name-race' }] });
test('a plan being designed declares its uniqueness and counter rules, each attacked by a concurrent counterexample', () => {
  assert.equal(verificationPlan(raced(), { design: true }).ok, true);
  assert.equal(verificationPlan({ ...plan(), concurrent_invariants: [] }, { design: true }).ok, true);
  const code = (p, design = true) => verificationPlan(p, { design }).errors.map((e) => e.code);
  assert.deepEqual(code(plan()), ['E_PLAN_CONCURRENCY']);
  for (const [mutate, expected] of [
    [(p) => delete p.checks[1].counterexample_kind, 'E_CONCURRENT_CHECK'],
    [(p) => { p.checks[1].counterexample_kind = 'sequential'; }, 'E_CONCURRENT_CHECK'],
    [(p) => { p.checks[1].kind = 'inventory'; }, 'E_CONCURRENT_CHECK'],
    [(p) => { p.concurrent_invariants[0].check_id = 'missing'; }, 'E_CONCURRENT_CHECK'],
    [(p) => { p.checks[1].scenario_refs = ['REQ-9/SC-3']; }, 'E_CONCURRENT_CHECK'],
    [(p) => { p.concurrent_invariants[0].kind = 'ordering'; }, 'E_CONCURRENT_INVARIANT'],
    [(p) => delete p.concurrent_invariants[0].scenario_refs, 'E_CONCURRENT_INVARIANT'],
    [(p) => { p.checks[1].counterexample_kind = 'parallel'; }, 'E_CHECK_CONTRACT'],
    [(p) => { p.concurrent_invariants = {}; }, 'E_PLAN_CONCURRENCY'],
  ]) {
    const p = raced(); mutate(p);
    assert.ok(code(p).includes(expected), `${expected} expected, got ${code(p)}`);
  }
});
test('a plan already run or archived is not redesigned: an absent declaration is refused only at design', () => {
  assert.equal(verificationPlan(plan()).ok, true);
  const p = raced(); delete p.checks[1].counterexample_kind;
  assert.ok(verificationPlan(p).errors.some((e) => e.code === 'E_CONCURRENT_CHECK'), 'a declaration that is present is still held to its check');
});
test('verification.mjs plan designs a new plan and reads an archived one as it was written', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, dirname } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const cli = join(dirname(fileURLToPath(import.meta.url)), '../scripts/verification.mjs');
  const root = mkdtempSync(join(tmpdir(), 'plan-design-'));
  const at = (rel) => { const f = join(root, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(plan())); return f; };
  const env = { ...process.env }; delete env.SPECTREE_PROJECT_ROOT;
  const run = (cwd, file) => spawnSync(process.execPath, [cli, 'plan', file], { cwd, encoding: 'utf8', env });
  const fresh = run(root, at('docs/changes/c1/verification.json'));
  assert.equal(fresh.status, 1); assert.match(fresh.stdout, /E_PLAN_CONCURRENCY/);
  const archived = run(root, at('docs/changes/archive/2026-10-01-c0/verification.json'));
  assert.equal(archived.status, 0, archived.stdout + archived.stderr);
  // A project whose own checkout sits under a changes/archive/ folder still designs its new plans.
  const nested = join(root, 'srv/changes/archive/app');
  mkdirSync(nested, { recursive: true });
  const inside = run(nested, at('srv/changes/archive/app/docs/changes/c2/verification.json'));
  assert.equal(inside.status, 1); assert.match(inside.stdout, /E_PLAN_CONCURRENCY/);
});
