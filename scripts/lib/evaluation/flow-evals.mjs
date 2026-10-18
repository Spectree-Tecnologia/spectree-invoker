// Exercise a lifecycle from draft through verified implementation in a NEW synthetic repo.
// Scope policy is a declared fixture. No QA-isolation, CI, merge or production claim is made.
import { git as gitIn, refuse } from '../shared/index.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  packageRoot,
  hash,
  initTasks,
  runTask,
  recoverTask,
  verifyTasks,
  taskStatus,
} from '../execution/index.mjs';
import { planAdoption, applyAdoption } from '../closure/index.mjs';
import { pendingWork, reconcileWork, Store } from '../change/index.mjs';

export function runFlowEvaluation({ config, output, mode = 'live' }) {
  if (!['live', 'transport-test'].includes(mode) || (mode === 'live' && !['codex', 'claude-code'].includes(config.kind))) refuse('E_EVAL_MODE', 'Live flows require a native agent; a bridge is only a transport test.');
  const root = mkdtempSync(join(tmpdir(), 'spectree-flow-eval-'));
  const runDir = join(resolve(output), `flow-${randomUUID()}`); mkdirSync(runDir, { recursive: true });
  const report = { version: 1, mode, suite: 'operational-flow', fixture: root, adapter: config.kind, requested_model: config.model ?? null,
    package_version: JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version,
    runtime_digest: hash(['evaluation/flow-evals.mjs', 'execution/task-executor.mjs', 'execution/agent-runner.mjs', 'shared/process-supervisor.mjs', 'shared/process-job.cs', 'shared/process-worker.mjs'].map((p) => readFileSync(join(packageRoot, 'scripts/lib', p), 'utf8'))),
    scope: 'Draft, fixture scope policy, observed branch/baseline/red tests, interrupted attempt, dependencies, injected regression and bounded repair. Stops before independent QA/CI/integration.',
    steps: [], completed: false, passed: false };
  const persist = () => writeFileSync(join(runDir, 'summary.json'), JSON.stringify(report, null, 2)); persist();
  const put = (p, text) => { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), text); };
  const git = (...args) => gitIn(root, args).trim();
  const env = { ...process.env, SPECTREE_PROJECT_ROOT: root }; delete env.NODE_TEST_CONTEXT;
  const step = (name, fn) => {
    const began = performance.now(); const result = fn();
    report.steps.push({ name, elapsed_ms: Math.round(performance.now() - began), result }); persist(); return result;
  };
  const require = (ok, message) => { if (!ok) throw Error(message); };
  const cli = (...args) => {
    const r = spawnSync(process.execPath, [join(packageRoot, 'scripts/state.mjs'), ...args], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
    require(r.status === 0, `state ${args[0]}: ${r.stderr || r.error?.message}`); return r.stdout.trim();
  };
  try {
    git('init', '-q', '-b', 'main'); git('config', 'user.email', 'eval@example.invalid'); git('config', 'user.name', 'Synthetic flow evaluation'); git('config', 'commit.gpgsign', 'false');
    put('.gitignore', '.spectree/\n');
    put('src/value.cjs', 'module.exports = { a: 0, b: 0 };\n');
    put('policy.md', 'Synthetic evaluation policy: authorize ONLY this disposable fixture scope. No historical consent, real human approval, merge or deployment is represented.\n');
    put('docs/changes/flow/proposal.md', '# Fixture contract\nScenario A: export a=1. Scenario B depends on A: export b=2 while retaining a=1. CommonJS src/value.cjs only. No dependencies, architecture changes, delegation or network.\n');
    put('tests/baseline.cjs', "const {test}=require('node:test');const assert=require('node:assert/strict');test('existing API shape',()=>assert.deepEqual(Object.keys(require('../src/value.cjs')).sort(),['a','b']));\n");
    git('add', '-A'); git('commit', '-qm', 'synthetic baseline and contract');
    const adopted = planAdoption(root, { version: 1, project_id: 'flow-fixture', change_id: 'flow', scope: 'Synthetic two-scenario implementation',
      allowed_paths: ['src/value.cjs'], refs: ['docs/changes/flow/proposal.md'], adapter: config.kind === 'claude-code' ? 'claude-code' : 'codex', closure_mode: 'legacy' });
    step('adopt-as-draft', () => applyAdoption(root, adopted));
    step('proposed', () => cli('transition', 'flow', 'proposed'));
    const approval = { schema_version: '1.0.0', approval_id: 'fixture-policy', change_id: 'flow', gate: 'scope',
      granted_by: { identity: 'synthetic-fixture-policy', kind: 'repository_policy', reference: 'policy.md' }, channel: 'fixture',
      scope_digest: cli('digest', 'flow'), revision: git('rev-parse', 'HEAD'), timestamp: new Date().toISOString() };
    put('.spectree/fixture-approval.json', JSON.stringify(approval));
    step('current-fixture-policy', () => cli('record-approval', '.spectree/fixture-approval.json'));
    step('scope-approved', () => cli('transition', 'flow', 'scope_approved'));
    git('checkout', '-qb', 'fixture-implementation');
    put('.spectree/assert-branch.cjs', "const b=require('child_process').execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim();require('assert').equal(b,'fixture-implementation');");
    step('observed-isolation', () => cli('run', 'flow', 'branch.isolated', '--role', 'platform_engineer', '--', process.execPath, '.spectree/assert-branch.cjs'));
    cli('transition', 'flow', 'isolated');
    step('observed-baseline', () => cli('run', 'flow', 'suite.baseline', '--role', 'platform_engineer', '--', process.execPath, '--test', '--test-reporter=tap', 'tests/baseline.cjs'));
    cli('transition', 'flow', 'baselined');
    for (const [id, value] of [['A', 1], ['B', 2]]) put(`tests/${id}.cjs`, `const {test}=require('node:test');const assert=require('node:assert/strict');test('${id}',()=>assert.equal(require('../src/value.cjs').${id.toLowerCase()},${value}));\n`);
    step('observed-red-tests', () => cli('run', 'flow', 'pass1.tests_failing', '--role', 'quality_engineer', '--expect-failing', 'A', '--', process.execPath, '--test', '--test-reporter=tap', 'tests/A.cjs', 'tests/B.cjs'));
    cli('transition', 'flow', 'pass1_complete');
    const plan = { version: 1, tasks: ['A', 'B'].map((id, i) => ({ id, mission: `Implement Scenario ${id} in src/value.cjs; preserve all previously implemented behavior. The fixture provides immutable tests and contract. Do not change any other path.`,
      depends_on: i ? ['A'] : [], refs: ['docs/changes/flow/proposal.md'], scenarios: [id], allowed_paths: ['src/value.cjs'], max_attempts: 3,
      checks: [{ scenario: id, test_name: id, command: [process.execPath, '--test', '--test-reporter=tap', `tests/${id}.cjs`], files: [`tests/${id}.cjs`], timeout_seconds: 20 }] })) };
    step('task-frontier', () => initTasks(root, 'flow', plan));
    const interrupted = step('forced-deadline', () => runTask(root, 'flow', 'A', { ...config, timeout_seconds: 1 }));
    require(interrupted.attempt.status === 'interrupted' && !interrupted.ok && interrupted.status.ready.length === 0, 'Forced interruption did not block the frontier.');
    step('reconcile-interruption', () => recoverTask(root, 'flow', interrupted.attempt.id, { cause: 'Fixture forced the native process deadline; inspect its source and managed process receipt.',
      new_hypothesis: 'Finish the remaining Scenario A using fresh context.', refs: ['src/value.cjs', interrupted.attempt.result_ref], processes_stopped: true }));
    require(step('implement-A', () => runTask(root, 'flow', 'A', config)).ok, 'Scenario A failed.');
    require(taskStatus(root, 'flow').ready.includes('B'), 'Dependency B did not open after verified A.');
    require(step('implement-B-preserve-A', () => runTask(root, 'flow', 'B', config)).ok, 'Scenario B or regression checks failed.');
    put('src/value.cjs', 'module.exports = { a: 1, b: -99 }; // synthetic regression injected by evaluator\n');
    const broken = step('detect-regression', () => verifyTasks(root, 'flow'));
    require(!broken.ok && !taskStatus(root, 'flow').complete, 'Regression incorrectly passed.');
    const pending = pendingWork(root, 'flow');
    step('reconcile-regression', () => reconcileWork(root, 'flow', pending.operation_id, { note: 'Evaluator injected b=-99; the named B assertion failed.', next: 'Repair only the public implementation and reverify all Scenarios.', refs: [broken.evidence_ref, 'src/value.cjs'] }));
    require(step('bounded-agent-repair', () => runTask(root, 'flow', 'B', config, { cause: 'B assertion failed after evaluator injected b=-99.',
      new_hypothesis: 'Restore B to the contractual value while preserving A; acceptance remains immutable.', refs: [broken.evidence_ref, 'src/value.cjs'] })).ok, 'Bounded repair failed.');
    step('implemented', () => cli('transition', 'flow', 'implemented'));
    const qa = spawnSync(process.execPath, [join(packageRoot, 'scripts/state.mjs'), 'can', 'flow', 'pass2_complete'], { cwd: root, env, encoding: 'utf8' });
    require(qa.status === 1, 'Independent QA gate unexpectedly opened.');
    report.qa_gate = { blocked: true, reason: qa.stderr.trim() };
    report.lifecycle_state = new Store(root).change('flow').state;
    report.final_frontier = taskStatus(root, 'flow'); report.passed = report.final_frontier.complete;
  } catch (e) { report.error = { code: e.code ?? 'E_FLOW', message: e.message }; }
  report.completed = true; persist();
  return { ...report, report: join(runDir, 'summary.json') };
}
