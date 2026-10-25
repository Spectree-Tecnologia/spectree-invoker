import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitRepo, cleanup, writeFiles, commitAll, REPO } from './helpers.mjs';

test('installed reliability commands run a checkpoint, a baseline and a mutation in a disposable consumer', () => {
  const r = gitRepo({
    'math.cjs': 'module.exports = n => n + 1;\n',
    'math.test.cjs': "const {test}=require('node:test');const assert=require('node:assert/strict');test('preserves value',()=>assert.equal(require('./math.cjs')(1),2));\n",
  });
  try {
    execFileSync(process.execPath, [join(REPO, 'scripts/install-codex.mjs'), r.root, '--apply'], { stdio: 'pipe' });
    const squad = join(r.root, '.spectree/squad');
    const run = (script, ...args) => spawnSync(process.execPath, [join(squad, 'scripts', script), ...args], {
      cwd: r.root, env: { ...process.env, SPECTREE_PROJECT_ROOT: r.root, CI: 'false', GITHUB_ACTIONS: 'false' }, encoding: 'utf8',
    });
    const ok = (script, ...args) => { const result = run(script, ...args); assert.equal(result.status, 0, result.stdout + result.stderr); return result.stdout; };
    assert.equal(JSON.parse(ok('work.mjs', 'doctor')).mode, 'uninitialized');
    ok('state.mjs', 'init', 'synthetic');
    ok('state.mjs', 'open', 'c1', '--type', 'feature', '--base', r.base, '--scope', 'synthetic verification', '--paths', 'math.cjs', '--closure-mode', 'legacy');
    ok('state.mjs', 'run', 'c1', 'suite.baseline', '--role', 'platform_engineer', '--', process.execPath, '--test', 'math.test.cjs');
    // The installer can add AGENTS.md, so the baseline must refuse until that new candidate
    // is explicitly the recorded base. This prevents laundering a dirty baseline.
    assert.equal(run('verification.mjs', 'baseline', 'c1', 'local').status, 1);
    const adoptedBase = commitAll(r, 'install squad in synthetic consumer');
    ok('state.mjs', 'open', 'c2', '--type', 'feature', '--base', adoptedBase, '--scope', 'baseline identity', '--paths', 'math.cjs', '--closure-mode', 'legacy');
    ok('state.mjs', 'run', 'c2', 'suite.baseline', '--role', 'platform_engineer', '--', process.execPath, '--test', 'math.test.cjs');
    assert.equal(JSON.parse(ok('verification.mjs', 'baseline', 'c2', 'local')).ok, true);
    assert.equal(run('verification.mjs', 'baseline', 'c2', 'ci').status, 1);
    assert.ok(existsSync(join(squad, 'docs/reliability.md')));
    assert.equal(JSON.parse(ok('verification.mjs', 'plan', join(squad, 'docs/examples/verification.json'))).ok, true);
    // One suite run, every named check judged from its report.
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; // a nested runner reports to its parent, not to stdout
    const suite = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'math.test.cjs'], { cwd: r.root, env, encoding: 'utf8' });
    const example = JSON.parse(readFileSync(join(squad, 'docs/examples/verification.json'), 'utf8'));
    example.checks[1].tests = ['preserves value'];
    writeFiles(r.root, { '.spectree/plan.json': JSON.stringify(example), '.spectree/suite.tap': suite.stdout });
    const judged = JSON.parse(ok('verification.mjs', 'checks', '.spectree/plan.json', '.spectree/suite.tap'));
    assert.deepEqual(judged.checks.map((c) => c.result), ['NOT_EVALUATED', 'PASS', 'NOT_EVALUATED']);
    example.checks[1].tests = ['preserves values'];
    writeFiles(r.root, { '.spectree/plan.json': JSON.stringify(example) });
    assert.equal(run('verification.mjs', 'checks', '.spectree/plan.json', '.spectree/suite.tap').status, 1);
    ok('work.mjs', 'start', 'c1', 'probe-01', '--phase', 'test', '--task', 'preserves value', '--next', 'run isolated probe', '--refs', 'math.test.cjs');
    writeFiles(r.root, { '.spectree/probe.json': JSON.stringify({ target: 'math.cjs', before: 'n + 1', after: 'n + 2',
      test_name: 'preserves value', command: [process.execPath, '--test', '--test-reporter=tap', 'math.test.cjs'], timeout_seconds: 20 }) });
    const result = JSON.parse(ok('mutation-probe.mjs', '.spectree/probe.json', '--apply'));
    assert.equal(result.result, 'PASS');
    assert.equal(readFileSync(join(r.root, 'math.cjs'), 'utf8'), 'module.exports = n => n + 1;\n');
    writeFiles(r.root, { '.spectree/envelope.json': JSON.stringify({ status: 'completed', is_error: false }) });
    ok('work.mjs', 'finish', 'c1', 'probe-01', '--result', '.spectree/envelope.json', '--next', 'verify evidence', '--refs', 'math.test.cjs');
    assert.equal(JSON.parse(ok('work.mjs', 'resume', 'c1')).pending, null);
  } finally { cleanup(r.root); }
});
