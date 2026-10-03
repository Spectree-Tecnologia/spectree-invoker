#!/usr/bin/env node
// Explicit live smoke test. Seeded lifecycle fixtures test dispatch/verification, not approvals.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store } from '../scripts/lib/store.mjs';
import { contractDigest } from '../scripts/lib/digest.mjs';
import { initTasks, runTask } from '../scripts/lib/task-executor.mjs';

if (process.argv[2] !== '--apply' || process.argv.length !== 3) {
  console.log('Dry run. Use node evals/executor-smoke.mjs --apply to run one real agent in a synthetic temporary repository.');
} else {
  const root = mkdtempSync(join(tmpdir(), 'spectree-executor-smoke-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString().trim();
  const put = (path, text) => writeFileSync(join(root, path), text);
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'tests'));
  put('src/math.cjs', 'module.exports = n => n;\n');
  put('spec.md', 'Scenario increment: the existing public function returns the input integer plus one. Keep its CommonJS signature. This synthetic project uses src/ and tests/; no new architecture or dependencies are in scope.\n');
  put('tests/math.cjs', "const {test}=require('node:test');const assert=require('node:assert/strict');test('increment preserves integer arithmetic',()=>{const f=require('../src/math.cjs');assert.equal(f(0),1);assert.equal(f(-2),-1);assert.equal(f(3),4);});\n");
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Synthetic evaluation'); git('config', 'commit.gpgsign', 'false');
  git('add', '-A'); git('commit', '-qm', 'synthetic base'); git('checkout', '-qb', 'fixture-implementation');
  const base = git('rev-parse', 'HEAD'); const store = new Store(root);
  store.init({ project_id: 'synthetic-executor-smoke', protocol_version: '1.0.0' });
  const change = store.putChange({ schema_version: '1.0.0', project_id: 'synthetic-executor-smoke', change_id: 'smoke', change_type: 'feature',
    protocol_version: '1.0.0', adapter: 'codex', base_revision: base, scope: 'Synthetic increment fixture', allowed_paths: ['src/math.cjs'], state: 'pass1_complete' });
  store.putApproval({ schema_version: '1.0.0', approval_id: 'synthetic-scope', change_id: 'smoke', gate: 'scope',
    granted_by: { identity: 'synthetic-evaluation-fixture', kind: 'repository_policy', reference: 'evals/executor-smoke.mjs' },
    channel: 'fixture', scope_digest: contractDigest(root, change).digest, revision: base, timestamp: new Date().toISOString() });
  const plan = { version: 1, tasks: [{ id: 'increment', mission: 'Implement the increment Scenario in the existing function. Change only src/math.cjs. Run the existing acceptance test with node --test --test-reporter=tap tests/math.cjs; do not edit tests or specs.',
    depends_on: [], refs: ['spec.md'], scenarios: ['increment'], allowed_paths: ['src/math.cjs'], max_attempts: 1,
    checks: [{ scenario: 'increment', test_name: 'increment preserves integer arithmetic', command: [process.execPath, '--test', '--test-reporter=tap', 'tests/math.cjs'], files: ['tests/math.cjs'], timeout_seconds: 30 }] }] };
  initTasks(root, 'smoke', plan);
  const result = runTask(root, 'smoke', 'increment', { kind: 'codex', timeout_seconds: 180 });
  const report = { mode: 'live-synthetic-runtime', fixture: root,
    limitation: 'Lifecycle preconditions are seeded fixtures. This run observes real dispatch, implementation and acceptance verification, not the full squad pipeline.',
    ...result, lifecycle_state: store.change('smoke').state, implementation: readFileSync(join(root, 'src/math.cjs'), 'utf8') };
  writeFileSync(join(root, '.spectree/smoke-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2)); if (!result.ok) process.exitCode = 1;
}
