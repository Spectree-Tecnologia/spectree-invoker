import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tempDir, cleanup, writeFiles, gitRepo, REPO } from './helpers.mjs';
import { scoreDecision, runEvaluations } from '../scripts/lib/agent-evals.mjs';

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
    const context = spawnSync(process.execPath, ['--input-type=module', '-e', "import {phaseContext} from './.spectree/squad/scripts/lib/context.mjs';console.log(phaseContext('review').sources.length)"], { cwd: r.root, encoding: 'utf8' });
    assert.equal(context.status, 0, context.stderr); assert.equal(context.stdout.trim(), '2');
    assert.match(run('tasks.mjs').stderr, /usage:/);
    assert.match(run('reports.mjs').stderr, /usage:/);
  } finally { cleanup(r.root); }
});
