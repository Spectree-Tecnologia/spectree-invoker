import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gitRepo, cleanup, change, writeFiles, REPO, approval } from './helpers.mjs';
import { Store } from '../scripts/lib/store.mjs';
import { deliveryContract, suiteVerdict } from '../scripts/lib/delivery-contract.mjs';
import { deliveryGate, deliveryPlan, deliveryPreflight, runDelivery, deliveryMetrics, recoverDelivery } from '../scripts/lib/delivery.mjs';
import { contractDigest } from '../scripts/lib/digest.mjs';
import { ledgerView, ledgerGate } from '../scripts/lib/delivery-ledger.mjs';

const command = [process.execPath, '--test', '--test-reporter=tap', 'suite.test.mjs'];
const probe = [process.execPath, '--test', '--test-reporter=tap', 'probe.test.mjs'];
function plan() { return { version: 1, change: 'c1', changes_field_meaning: false,
  checks: [{ id: 'C1', kind: 'behavior', claim: 'the named behavior works', command,
    scenario_refs: ['module / requirement / scenario'], counterexample: 'defect', expected_failure: 'assertion' }],
  delivery: { version: 1, suites: [{ id: 'application', format: 'tap', command, full_suite: true,
    probe: { command: probe, test: 'reporter probe' },
    timeout_seconds: 10, expected_tests: ['scenario', 'auxiliary'], scenarios: [{ ref: 'module / requirement / scenario', test: 'scenario' }] }] } }; }
const source = (mode = 'pass') => `import {test} from 'node:test'; import assert from 'node:assert/strict';
test('scenario', ${mode === 'skip' ? '{skip:true},' : ''} () => assert.equal(1,${mode === 'fail' ? 2 : 1}));
${mode !== 'missing' ? "test('auxiliary', () => assert.ok(true));" : ''}
${mode === 'duplicate' ? "test('scenario', () => {});" : ''}
${mode === 'crash' ? "throw new Error('startup failed');" : ''}
`;
function fixture() {
  const repo = gitRepo({ 'suite.test.mjs': source(), 'probe.test.mjs': `import {test} from 'node:test'; import assert from 'node:assert/strict'; test('reporter probe', () => assert.equal(process.env.SPECTREE_DELIVERY_PROBE,'pass'));`,
    'docs/changes/c1/proposal.md': '# approved canary\n', 'docs/changes/c1/verification.json': JSON.stringify(plan()) });
  const store = new Store(repo.root);
  store.init({ project_id: 'proj', protocol_version: '1.0.0', delivery: { version: 1 } });
  store.putChange(change({ base_revision: repo.base, state: 'pass1_complete', closure_mode: 'legacy' }));
  ledgerView(repo.root, { apply: true });
  return { ...repo, store, drop: () => cleanup(repo.root) };
}
function runSource(mode) {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--input-type=module', '--test-reporter=tap', '-e', source(mode)], { encoding: 'utf8', env });
  return { text: r.stdout, exit: r.status };
}

test('delivery matches real node:test output and refuses omitted, skipped, duplicate and crashing tests', () => {
  const suite = plan().delivery.suites[0];
  for (const [mode, expected] of [['pass', 'PASS'], ['missing', 'INFRA_ERROR'], ['skip', 'INFRA_ERROR'], ['duplicate', 'INFRA_ERROR'], ['fail', 'FAIL'], ['crash', 'INFRA_ERROR']]) {
    const run = runSource(mode);
    assert.equal(suiteVerdict(run.text, run.exit, suite).result, expected, `${mode}\n${run.text}`);
  }
  const run = runSource('pass');
  assert.equal(suiteVerdict(run.text.replace(/1\.\.2/g, ''), run.exit, suite).result, 'INFRA_ERROR');
});
test('delivery contract rejects unmapped scenarios and incomplete inventories', () => {
  assert.equal(deliveryContract(plan()).ok, true);
  const p = plan(); p.delivery.suites[0].scenarios = [];
  assert.equal(deliveryContract(p).ok, false);
  p.delivery.suites[0].expected_tests = [];
  assert.equal(deliveryContract(p).ok, false);
});
test('single full-suite observation is bound to candidate, plan, contract and captured output', () => {
  const f = fixture();
  try {
    assert.equal(deliveryGate(f.root, 'c1', 'implemented').code, 'E_DELIVERY_MISSING');
    assert.equal(deliveryPreflight(f.root, 'c1').ok, true);
    const result = runDelivery(f.root, 'c1');
    assert.equal(result.result, 'PASS', JSON.stringify(result));
    assert.equal(deliveryGate(f.root, 'c1', 'implemented').ok, true);
    const output = join(f.root, `.spectree/delivery/c1/${result.run_id}/application.tap`);
    const saved = readFileSync(output, 'utf8'); writeFileSync(output, saved + '# altered\n');
    assert.equal(deliveryGate(f.root, 'c1', 'implemented').code, 'E_DELIVERY_REPORT');
    writeFileSync(output, saved);
    writeFileSync(join(f.root, 'suite.test.mjs'), source('missing'));
    assert.equal(deliveryGate(f.root, 'c1', 'implemented').code, 'E_DELIVERY_STALE');
    const failed = runDelivery(f.root, 'c1'); assert.equal(failed.result, 'FAIL');
    assert.equal(deliveryGate(f.root, 'c1', 'implemented').ok, false);
    assert.equal(deliveryMetrics(f.root, 'c1').infrastructure_failures, 1);
  } finally { f.drop(); }
});
test('delivery discovers the same plan after archive and refuses ambiguous plans', () => {
  const f = fixture();
  try {
    const before = deliveryPlan(f.root, 'c1').digest;
    mkdirSync(join(f.root, 'docs/changes/archive'));
    renameSync(join(f.root, 'docs/changes/c1'), join(f.root, 'docs/changes/archive/2026-10-13-c1'));
    assert.equal(deliveryPlan(f.root, 'c1').digest, before);
    writeFiles(f.root, { 'docs/changes/c1/verification.json': JSON.stringify(plan()) });
    assert.throws(() => deliveryPlan(f.root, 'c1'), /found 2/);
  } finally { f.drop(); }
});
test('ledger drift and due milestones block, while future obligations remain visible', () => {
  const f = fixture();
  try {
    f.store.putDeferred({ owner: 'platform_engineer', impact: 'defect', status: 'open', title: 'canary obligation',
      current_decision: 'resolve before integration', opened_by_change: 'c1', due: { change_id: 'c1', state: 'integration_approved' } });
    assert.equal(ledgerGate(f.root, 'c1', 'implemented').code, 'E_DELIVERY_LEDGER_DRIFT');
    ledgerView(f.root, { apply: true });
    assert.equal(ledgerGate(f.root, 'c1', 'implemented').ok, true);
    assert.equal(ledgerGate(f.root, 'c1', 'integration_approved').code, 'E_DELIVERY_DUE');
    assert.equal(ledgerGate(f.root, 'future', 'integrated').ok, true);
    writeFileSync(join(f.root, '.spectree/deferred.json'), '{');
    assert.equal(ledgerGate(f.root, 'c1', 'implemented').code, 'E_DELIVERY_LEDGER');
  } finally { f.drop(); }
});
test('incomplete run cannot hide behind a success; telemetry reports missing measures as null', () => {
  const f = fixture();
  try {
    const run = runDelivery(f.root, 'c1'); assert.equal(run.result, 'PASS');
    const start = JSON.parse(readFileSync(join(f.root, `.spectree/delivery/c1/${run.run_id}/started.json`)));
    writeFiles(f.root, { '.spectree/delivery/c1/interrupted/started.json': JSON.stringify({ ...start, run_id: 'interrupted' }) });
    assert.equal(deliveryGate(f.root, 'c1', 'implemented').code, 'E_DELIVERY_PENDING');
    assert.throws(() => runDelivery(f.root, 'c1'), /Unfinished/);
    const metrics = deliveryMetrics(f.root, 'c1');
    assert.equal(metrics.incomplete_runs, 1); assert.equal(metrics.model_cost_usd, null);
    assert.equal(metrics.implementation_to_integration_elapsed_ms, null);
  } finally { f.drop(); }
});
test('delivery CLI reports the same gate refusal as the library', () => {
  const f = fixture();
  try {
    const r = spawnSync(process.execPath, [join(REPO, 'scripts/delivery.mjs'), 'check', 'c1'], { cwd: f.root, encoding: 'utf8' });
    assert.equal(r.status, 1); assert.equal(JSON.parse(r.stdout).code, 'E_DELIVERY_MISSING');
  } finally { f.drop(); }
});
test('a delta scenario omitted from the verification plan is refused before execution', () => {
  const f = fixture();
  try {
    writeFiles(f.root, { 'docs/changes/c1/specs/module/spec.md': '## ADDED Requirements\n### Requirement: requirement\n#### Scenario: omitted\n- WHEN x\n- THEN y\n' });
    assert.throws(() => deliveryPreflight(f.root, 'c1'), /Delta scenario has no delivery mapping/);
  } finally { f.drop(); }
});
test('state can, planner and transition share delivery gates; observations cannot substitute for scope approval', () => {
  const f = fixture();
  const cli = args => spawnSync(process.execPath, [join(REPO, 'scripts/state.mjs'), ...args], { cwd: f.root, encoding: 'utf8' });
  try {
    assert.match(cli(['can', 'c1', 'implemented']).stderr, /E_DELIVERY_MISSING/);
    const advice = JSON.parse(cli(['plan', 'c1', '--json']).stdout);
    assert.equal(advice.action, 'inspect_delivery');
    const result = runDelivery(f.root, 'c1'); assert.equal(result.result, 'PASS');
    assert.match(cli(['can', 'c1', 'implemented']).stderr, /E_MISSING_APPROVAL/);
    f.store.putApproval(approval({ change_id: 'c1', gate: 'scope', revision: f.base,
      scope_digest: contractDigest(f.root, f.store.change('c1')).digest }));
    const transition = cli(['transition', 'c1', 'implemented']);
    assert.equal(transition.status, 0, transition.stderr);
    assert.equal(f.store.change('c1').state, 'implemented');
  } finally { f.drop(); }
});
test('a newer failed suite cannot be hidden by a previous green on identical candidate content', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'suite.test.mjs'), `import {test} from 'node:test';import assert from 'node:assert/strict';import {existsSync} from 'node:fs';test('scenario',()=>assert.ok(!existsSync('.spectree/fault')));test('auxiliary',()=>{});`);
    assert.equal(runDelivery(f.root, 'c1').result, 'PASS');
    writeFileSync(join(f.root, '.spectree/fault'), 'fault');
    assert.equal(runDelivery(f.root, 'c1').result, 'FAIL');
    assert.equal(deliveryGate(f.root, 'c1', 'implemented').code, 'E_DELIVERY_FAILED');
    assert.equal(deliveryMetrics(f.root, 'c1').candidates_observed, 1);
  } finally { f.drop(); }
});
test('reporter negative control must actually fail; a fake always-green reporter blocks the suite', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'probe.test.mjs'), `import {test} from 'node:test';test('reporter probe',()=>{});`);
    const result = runDelivery(f.root, 'c1');
    assert.equal(result.result, 'FAIL'); assert.equal(result.error.code, 'E_DELIVERY_PROBE');
    assert.equal(result.suites.length, 0);
  } finally { f.drop(); }
});
test('plan and contract changes invalidate a completed delivery even though the plan is operational content', () => {
  const f = fixture();
  try {
    assert.equal(runDelivery(f.root, 'c1').result, 'PASS');
    const p = plan(); p.checks[0].claim = 'changed check';
    writeFileSync(join(f.root, 'docs/changes/c1/verification.json'), JSON.stringify(p));
    assert.equal(deliveryGate(f.root, 'c1', 'implemented').code, 'E_DELIVERY_STALE');
    writeFileSync(join(f.root, 'docs/changes/c1/verification.json'), JSON.stringify(plan()));
    writeFileSync(join(f.root, 'docs/changes/c1/proposal.md'), '# changed scope');
    assert.equal(deliveryGate(f.root, 'c1', 'implemented').code, 'E_DELIVERY_STALE');
  } finally { f.drop(); }
});
test('recovery refuses the still-active delivery writer even with an inspection document', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'suite.test.mjs'), source('fail'));
    const result = runDelivery(f.root, 'c1');
    assert.throws(() => recoverDelivery(f.root, 'c1', result.run_id, { reason: 'inspected', refs: ['suite.test.mjs'] }), /active or unobservable/);
  } finally { f.drop(); }
});
test('a stopped writer can reconcile an interrupted observation and rerun without declaring it successful', () => {
  const f = fixture();
  try {
    const launched = spawnSync(process.execPath, [join(REPO, 'scripts/delivery.mjs'), 'run', 'c1', '--apply'], { cwd: f.root, encoding: 'utf8' });
    assert.equal(launched.status, 0, launched.stderr);
    const run = JSON.parse(launched.stdout);
    // Canary simulates loss of the final observation after the real supervised processes stopped.
    unlinkSync(join(f.root, `.spectree/delivery/c1/${run.run_id}/finished.json`));
    const recovery = recoverDelivery(f.root, 'c1', run.run_id, { reason: 'Inspect canary effects and receipts', refs: ['suite.test.mjs'] });
    assert.equal(recovery.authorizes_execution, false);
    assert.equal(deliveryGate(f.root, 'c1', 'implemented').code, 'E_DELIVERY_MISSING');
    assert.equal(runDelivery(f.root, 'c1').result, 'PASS');
    assert.equal(deliveryGate(f.root, 'c1', 'implemented').ok, true);
  } finally { f.drop(); }
});
test('concurrent canary changes use different namespaces in their actual test resources', async () => {
  const f = fixture();
  try {
    const second = plan(); second.change = 'c2';
    writeFiles(f.root, { 'docs/changes/c2/proposal.md': '# second canary', 'docs/changes/c2/verification.json': JSON.stringify(second),
      'suite.test.mjs': `import {test} from 'node:test';import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';test('scenario',()=>{const ns=process.env.SPECTREE_TEST_NAMESPACE;assert.match(ns,/^spectree_[a-f0-9]{32}$/);writeFileSync('.spectree/'+ns,ns,{flag:'wx'});});test('auxiliary',()=>{});` });
    f.store.putChange(change({ change_id: 'c2', base_revision: f.base, state: 'pass1_complete', closure_mode: 'legacy' }));
    const run = id => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(REPO, 'scripts/delivery.mjs'), 'run', id, '--apply'], { cwd: f.root, windowsHide: true });
      let out = '', err = ''; child.stdout.on('data', b => out += b); child.stderr.on('data', b => err += b);
      child.on('error', reject); child.on('close', code => code === 0 ? resolve(JSON.parse(out)) : reject(Error(err + out)));
    });
    const results = await Promise.all([run('c1'), run('c2')]);
    const namespaces = results.map(r => r.suites[0].namespace);
    assert.equal(new Set(namespaces).size, 2);
    assert.ok(namespaces.every(ns => existsSync(join(f.root, '.spectree', ns))));
  } finally { f.drop(); }
});
test('Codex installation includes delivery CLI, schema, guide and dependencies', () => {
  const f = fixture();
  try {
    const installed = spawnSync(process.execPath, [join(REPO, 'scripts/install-codex.mjs'), f.root, '--apply'], { encoding: 'utf8' });
    assert.equal(installed.status, 0, installed.stderr);
    assert.ok(existsSync(join(f.root, '.spectree/squad/docs/delivery-reliability.md')));
    const result = spawnSync(process.execPath, [join(f.root, '.spectree/squad/scripts/delivery.mjs'), 'plan', 'c1'], { cwd: f.root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).ok, true);
  } finally { f.drop(); }
});
test('a superseded obligation cannot vanish into an absent successor or a cycle', () => {
  const f = fixture();
  try {
    const item = { owner: 'quality_engineer', impact: 'defect', current_decision: 'replaced', status: 'superseded', superseded_by: 2 };
    f.store.putDeferred(item);
    assert.equal(ledgerGate(f.root, 'c1', 'implemented').code, 'E_DELIVERY_LEDGER');
    f.store.putDeferred({ ...item, stable_id: 2, superseded_by: 1 });
    assert.equal(ledgerGate(f.root, 'c1', 'implemented').code, 'E_DELIVERY_LEDGER');
  } finally { f.drop(); }
});
