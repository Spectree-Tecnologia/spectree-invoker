import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tempDir, cleanup, writeFiles, gitRepo, REPO } from './helpers.mjs';
import { scoreDecision, runEvaluations } from '../scripts/lib/evaluation/agent-evals.mjs';
import { runFlowEvaluation } from '../scripts/lib/evaluation/flow-evals.mjs';
import { readProject } from '../scripts/lib/console/reader.mjs';
import { observeRuntime } from '../scripts/lib/console/observation.mjs';

test('evaluation scorer requires the observed decision and preserves negative and positive controls', () => {
  const expected = { classification: 'interrupted', action: 'reconcile', can_advance: false };
  assert.equal(scoreDecision(expected, { ...expected, reason: 'quota' }), true);
  assert.equal(Boolean(scoreDecision(expected, null)), false);
  assert.equal(scoreDecision(expected, { ...expected, can_advance: true, reason: 'completed' }), false);
  assert.equal(scoreDecision(expected, { ...expected, reason: '' }), false);
});
test('transport tests cannot masquerade as live evaluations, and unauthorized fixture edits fail', () => {
  const scratch = tempDir(); const fixtures = [];
  try {
    const bridge = join(scratch, 'bridge.cjs');
    const body = (extra = '') => `const fs=require('node:fs');fs.readFileSync(0,'utf8');fs.writeFileSync('decision.json',JSON.stringify({classification:'interrupted',action:'reconcile',can_advance:false,reason:'quota'}));${extra}console.log(JSON.stringify({status:'completed'}));`;
    writeFiles(scratch, { 'bridge.cjs': body() });
    const config = { kind: 'bridge', command: [process.execPath, bridge] };
    assert.throws(() => runEvaluations({ config, output: scratch, caseId: 'quota-envelope' }), { code: 'E_EVAL_MODE' });
    const a = runEvaluations({ config, output: scratch, caseId: 'quota-envelope', mode: 'transport-test' });
    fixtures.push(...a.cases.map((c) => c.fixture)); assert.equal(a.passed, true); assert.equal(a.mode, 'transport-test');
    writeFiles(scratch, { 'bridge.cjs': body("fs.writeFileSync('protected.txt','changed');") });
    const b = runEvaluations({ config, output: scratch, caseId: 'quota-envelope', mode: 'transport-test' });
    fixtures.push(...b.cases.map((c) => c.fixture)); assert.equal(b.passed, false); assert.deepEqual(b.cases[0].modifications, ['protected.txt']);
  } finally { fixtures.forEach(cleanup); cleanup(scratch); }
});
test('installed evolution entrypoints, generated profiles, runtime libraries and evaluation fixtures travel together', () => {
  const r = gitRepo();
  try {
    execFileSync(process.execPath, [join(REPO, 'scripts/install-codex.mjs'), r.root, '--apply'], { stdio: 'pipe' });
    const pkg = join(r.root, '.spectree/squad');
    const run = (name, ...args) => spawnSync(process.execPath, [join(pkg, 'scripts', name), ...args], { cwd: r.root, encoding: 'utf8' });
    const list = run('evals.mjs'); assert.equal(list.status, 0, list.stderr); assert.equal(JSON.parse(list.stdout).cases.length, 5);
    assert.equal(JSON.parse(readFileSync(join(pkg, 'package.json'))).version, JSON.parse(readFileSync(join(REPO, 'package.json'))).version);
    const context = spawnSync(process.execPath, ['--input-type=module', '-e', "import {phaseContext} from './.spectree/squad/scripts/lib/execution/context.mjs';console.log(phaseContext('review').sources.length)"], { cwd: r.root, encoding: 'utf8' });
    assert.equal(context.status, 0, context.stderr); assert.equal(context.stdout.trim(), '2');
    assert.match(run('tasks.mjs').stderr, /usage:/);
    assert.match(run('bridge.mjs').stderr, /usage:/);
    assert.ok(readFileSync(join(pkg, 'docs/resilient-execution.md'), 'utf8').includes('budget-plan'));
    assert.match(run('reports.mjs').stderr, /usage:/);
    assert.match(run('adopt.mjs').stderr, /usage:/);
    assert.deepEqual(JSON.parse(run('evals.mjs', '--suite', 'flow').stdout).cases, ['operational-flow']);
    assert.match(readFileSync(join(pkg, 'scripts/lib/shared/process-job.cs'), 'utf8'), /AssignProcessToJobObject/);
    assert.equal(JSON.parse(readFileSync(join(pkg, 'docs/examples/claude-runner.json'))).kind, 'claude-code');
  } finally { cleanup(r.root); }
});

test('flow evaluation exercises real gates, dependencies, interruption and regression repair without pretending QA independence', async () => {
  const scratch = tempDir(); let fixture;
  try {
    const bridge = join(scratch, 'flow-bridge.cjs');
    writeFiles(scratch, { 'flow-bridge.cjs': `const fs=require('fs');const p=JSON.parse(fs.readFileSync(0,'utf8'));
      if(!fs.existsSync('.spectree/first-launch')) { fs.writeFileSync('.spectree/first-launch','fixture');setTimeout(()=>{},10000); }
      else {const v=require(process.cwd()+'/src/value.cjs');v[p.task.id.toLowerCase()]=p.task.id==='A'?1:2;fs.writeFileSync('src/value.cjs','module.exports='+JSON.stringify(v));console.log(JSON.stringify({status:'completed'}));}` });
    const config = { kind: 'bridge', command: [process.execPath, bridge], timeout_seconds: 15 };
    assert.throws(() => runFlowEvaluation({ config, output: scratch }), { code: 'E_EVAL_MODE' });
    const result = runFlowEvaluation({ config, output: scratch, mode: 'transport-test' }); fixture = result.fixture;
    assert.equal(result.passed, true, JSON.stringify(result.error ?? result.steps.at(-1)));
    assert.equal(result.lifecycle_state, 'implemented'); assert.equal(result.qa_gate.blocked, true);
    assert.equal(result.steps.find((s) => s.name === 'detect-regression').result.ok, false);
    assert.equal(result.steps.find((s) => s.name === 'bounded-agent-repair').result.verification.checks.length, 2);
    const projection = readProject(fixture, 'fixture');
    assert.equal(projection.health, 'readable', JSON.stringify(projection.issues));
    assert.equal(projection.runs.length, 5);
    assert.ok(projection.runs.some(r => r.status === 'reconciled'));
    assert.ok(projection.runs.some(r => r.checks.some(c => c.result !== 'PASS')));
    assert.ok(projection.runs.filter(r => r.metrics).every(r => r.metrics.cost_usd === null && r.metrics.input_tokens === null));
    const observation = await observeRuntime(fixture, 'flow');
    assert.equal(observation.status, 'observed', JSON.stringify(observation));
    assert.equal(observation.authorizes_execution, false);
    assert.equal(observation.tasks.complete, true);
    assert.ok(observation.processes.every(p => p.state === 'stopped'));
    writeFiles(fixture, { 'src/value.cjs': 'module.exports={a:1,b:99};' });
    const stale = await observeRuntime(fixture, 'flow');
    assert.equal(stale.status, 'observed', JSON.stringify(stale));
    assert.ok(stale.tasks.tasks.some(t => t.status === 'stale'));
  } finally { if (fixture) cleanup(fixture); cleanup(scratch); }
});
