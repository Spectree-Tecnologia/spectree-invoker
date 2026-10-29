import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitRepo, cleanup, change, approval, REPO, writeFiles } from './helpers.mjs';
import { Store } from '../scripts/lib/change/store.mjs';
import { diagnoseProject, selectClosureMode } from '../scripts/lib/closure/project-diagnostics.mjs';
import { planReconciliation, applyReconciliation, resumeReconciliation } from '../scripts/lib/closure/reconciliation.mjs';
import { planAdoption } from '../scripts/lib/closure/adoption.mjs';
import { readLifecycle, withAuthority } from '../scripts/lib/change/lifecycle.mjs';
import { startConsole } from '../scripts/lib/console/server.mjs';
import { runtimePanel } from '../console/runtime.mjs';
import { observeRuntime } from '../scripts/lib/console/observation.mjs';

test('prepared selection requires a usable declaration, and never executes it', () => {
  assert.throws(() => selectClosureMode({ closure: { consolidate: [''] } }, 'prepared'), { code: 'E_CLOSURE_MECHANISM' });
  assert.equal(selectClosureMode({ closure: { consolidate: ['never-execute', '{change_dir}'] } }), 'prepared');
  assert.throws(() => selectClosureMode(null, 'automatic'), { code: 'E_CLOSURE_MODE' });
});

const request = { version: 1, change_id: 'c1', closure_mode: 'legacy', reason: 'The reviewed legacy contract archives without a preparation command.',
  actor: { kind: 'human_in_session', identity: 'synthetic operator' }, refs: ['package.json'] };
function fixture() {
  const repo = gitRepo({ '.gitignore': '.spectree/\n', 'app.mjs': 'export const x = 1;\n',
    'package.json': JSON.stringify({ scripts: { 'spec:close': 'node archive.mjs' } }) });
  const store = new Store(repo.root);
  store.init({ project_id: 'proj', protocol_version: '1.0.0' });
  store.putChange(change({ base_revision: repo.base, state: 'blocked', blocked_from: 'implemented', closure_mode: 'prepared', allowed_paths: ['app.mjs'], deltaless: true }),
    { event: { type: 'synthetic_previous_block' } });
  return { ...repo, store };
}
test('diagnosis does not infer authority from script names, archived artifacts or local version', () => {
  const r = fixture();
  try {
    writeFiles(r.root, { 'docs/changes/archive/2026-10-05-c1/tasks.md': 'done', '.spectree/squad/package.json': '{"version":"1.0.0"}' });
    const d = diagnoseProject(r.root, 'c1');
    assert.equal(d.closure.prepared_supported, false); assert.equal(d.runtime.active_consumer_version, null);
    assert.equal(d.runtime.installed_matches_inspector, false);
    assert.deepEqual(d.changes[0].issues.map(i => i.code), ['E_CLOSURE_MECHANISM', 'W_ARCHIVE_STATE_DIVERGENCE', 'E_CHANGE_BLOCKED']);
    assert.equal(d.script_candidates[0].name, 'spec:close');
    assert.throws(() => selectClosureMode(r.store.project()), { code: 'E_CLOSURE_SELECTION' });
    assert.throws(() => planAdoption(r.root, { version: 1, project_id: 'proj', change_id: 'next', scope: 'next',
      allowed_paths: ['app.mjs'], refs: ['package.json'], adapter: 'codex', closure_mode: 'prepared' }), { code: 'E_CLOSURE_MECHANISM' });
    assert.equal(existsSync(join(r.root, '.spectree/changes/next.json')), false);
    const cli = (...args) => spawnSync(process.execPath, [join(REPO, 'scripts/state.mjs'), ...args], { cwd: r.root, encoding: 'utf8' });
    const denied = cli('open', 'next', '--deltaless', '--scope', 'next', '--paths', 'app.mjs');
    assert.match(denied.stderr, /E_CLOSURE_SELECTION/);
    assert.equal(cli('open', 'next', '--deltaless', '--scope', 'next', '--paths', 'app.mjs', '--closure-mode', 'legacy').status, 0);
  } finally { cleanup(r.root); }
});
test('reviewed correction preserves blocked state and history, retires only integration approval authority', () => {
  const r = fixture();
  try {
    r.store.putApproval(approval({ gate: 'integration', change_id: 'c1', revision: r.base }));
    const history = readFileSync(join(r.root, '.spectree/history/c1.jsonl'), 'utf8');
    const p = planReconciliation(r.root, request);
    assert.equal(existsSync(join(r.root, '.spectree/closure')), false, 'planning has no lock or write');
    const result = applyReconciliation(r.root, p);
    assert.equal(result.authorizes_execution, false);
    assert.equal(r.store.change('c1').state, 'blocked');
    assert.equal(r.store.change('c1').blocked_from, 'implemented');
    assert.equal(r.store.change('c1').closure_mode, 'legacy');
    assert.ok(readFileSync(join(r.root, '.spectree/history/c1.jsonl'), 'utf8').startsWith(history));
    assert.equal(r.store.history('c1').filter(e => e.type === 'closure_mode_reconciled').length, 1);
    assert.equal(r.store.approvals('c1').length, 1); assert.equal(r.store.evidence('c1').length, 0);
    assert.ok(readLifecycle(r.root, 'c1').doc.retired_approvals.some(a => a.approval_id === 'a1'));
    resumeReconciliation(r.root, 'c1', result.operation_id);
    assert.equal(r.store.history('c1').length, 2);
  } finally { cleanup(r.root); }
});
for (const phase of ['plan', 'receipt']) test(`interruption at ${phase} persistence resumes exactly once and blocks unrelated authority`, () => {
  const r = fixture();
  try {
    const p = planReconciliation(r.root, request), op = `reconcile-${p.plan_digest}`;
    const obstruction = join(r.root, '.spectree/reconciliations/c1', op, `${phase}.json`);
    mkdirSync(obstruction, { recursive: true });
    assert.throws(() => applyReconciliation(r.root, p), { code: 'E_RECONCILIATION_LIMIT' });
    assert.equal(r.store.change('c1').closure_mode, phase === 'plan' ? 'prepared' : 'legacy');
    assert.throws(() => withAuthority(r.root, 'c1', {}, () => {}), { code: 'E_OPERATION_PENDING' });
    const d = diagnoseProject(r.root, 'c1');
    assert.deepEqual(d.changes[0].issues.find(i => i.code === 'E_OPERATION_PENDING').command, ['reconcile.mjs', 'resume', 'c1', op, '--apply']);
    rmdirSync(obstruction);
    resumeReconciliation(r.root, 'c1', op); resumeReconciliation(r.root, 'c1', op);
    assert.equal(r.store.change('c1').state, 'blocked');
    assert.equal(r.store.history('c1').filter(e => e.type === 'closure_mode_reconciled').length, 1);
    assert.equal(readLifecycle(r.root, 'c1').doc.operation.phase, 'done');
  } finally { cleanup(r.root); }
});
test('correction refuses tampering, drift, agent decisions, late gates and prior preparations', () => {
  const r = fixture();
  try {
    const p = planReconciliation(r.root, request);
    assert.throws(() => applyReconciliation(r.root, { ...p, after: { ...p.after, state: 'closed' } }), { code: 'E_RECONCILIATION_PLAN' });
    assert.throws(() => planReconciliation(r.root, { ...request, actor: { kind: 'agent', identity: 'bot' } }), { code: 'E_RECONCILIATION_DECISION' });
    writeFileSync(join(r.root, 'app.mjs'), 'changed');
    assert.throws(() => applyReconciliation(r.root, p), { code: 'E_RECONCILIATION_STALE' });
    r.store.putChange({ ...r.store.change('c1'), blocked_from: 'ci_green' });
    assert.throws(() => planReconciliation(r.root, request), { code: 'E_RECONCILIATION_STAGE' });
    assert.equal(diagnoseProject(r.root, 'c1').changes[0].issues.find(i => i.code === 'E_CLOSURE_MECHANISM').command, undefined);
    r.store.putChange({ ...r.store.change('c1'), blocked_from: 'implemented' });
    writeFiles(r.root, { '.spectree/closure/c1.json': '{}' });
    assert.throws(() => planReconciliation(r.root, request), { code: 'E_RECONCILIATION_PREPARED' });
  } finally { cleanup(r.root); }
});
test('interrupted correction refuses to resume against changed candidate', () => {
  const r = fixture();
  try {
    const p = planReconciliation(r.root, request), op = `reconcile-${p.plan_digest}`;
    const obstruction = join(r.root, '.spectree/reconciliations/c1', op, 'plan.json');
    mkdirSync(obstruction, { recursive: true });
    assert.throws(() => applyReconciliation(r.root, p));
    rmdirSync(obstruction); writeFileSync(join(r.root, 'app.mjs'), 'changed');
    assert.throws(() => resumeReconciliation(r.root, 'c1', op), { code: 'E_RECONCILIATION_STALE' });
    assert.equal(r.store.change('c1').closure_mode, 'prepared');
  } finally { cleanup(r.root); }
});
test('resume binds ignored inspection references and validates the complete appended event', () => {
  const r = fixture();
  try {
    writeFiles(r.root, { '.spectree/inspected.txt': 'reviewed contract' });
    const p = planReconciliation(r.root, { ...request, refs: ['.spectree/inspected.txt'] }), op = `reconcile-${p.plan_digest}`;
    const obstruction = join(r.root, '.spectree/reconciliations/c1', op, 'receipt.json');
    mkdirSync(obstruction, { recursive: true });
    assert.throws(() => applyReconciliation(r.root, p));
    rmdirSync(obstruction);
    writeFileSync(join(r.root, '.spectree/inspected.txt'), 'different');
    assert.throws(() => resumeReconciliation(r.root, 'c1', op), { code: 'E_RECONCILIATION_STALE' });
    writeFileSync(join(r.root, '.spectree/inspected.txt'), 'reviewed contract');
    const historyFile = join(r.root, '.spectree/history/c1.jsonl');
    const history = r.store.history('c1');
    history.at(-1).actor.identity = 'other person';
    writeFileSync(historyFile, history.map(e => JSON.stringify(e)).join('\n') + '\n');
    assert.throws(() => resumeReconciliation(r.root, 'c1', op), { code: 'E_RECONCILIATION_HISTORY' });
  } finally { cleanup(r.root); }
});
test('ambiguous artifacts, unrelated authority drift and executor locks refuse correction', () => {
  const r = fixture();
  try {
    const p = planReconciliation(r.root, request);
    r.store.putApproval(approval({ gate: 'scope', revision: r.base, change_id: 'c1' }));
    assert.throws(() => applyReconciliation(r.root, p), { code: 'E_RECONCILIATION_STALE' });
    writeFiles(r.root, { '.spectree/tasks/executor.lock': 'busy' });
    assert.throws(() => planReconciliation(r.root, request), { code: 'E_TASK_BUSY' });
    writeFiles(r.root, { 'docs/changes/c1/tasks.md': 'open', 'docs/changes/archive/2026-10-05-c1/tasks.md': 'closed' });
    assert.throws(() => planReconciliation(r.root, request), { code: 'E_ARTIFACT_AMBIGUOUS' });
  } finally { cleanup(r.root); }
});
test('Console can diagnose project without changes, and renders escaped actionable discrepancies', async () => {
  const r = gitRepo({ 'package.json': '{"scripts":{"spec:close":"echo unused"}}' });
  let console;
  try {
    console = await startConsole({ roots: [r.root] });
    const response = await fetch(console.origin + '/api/observation?project=project-1', { headers: { Authorization: `Bearer ${console.token}` } });
    assert.equal(response.status, 200);
    const data = await response.json(); assert.equal(data.status, 'observed');
    const snapshot = await (await fetch(console.origin + '/api/snapshot', { headers: { Authorization: `Bearer ${console.token}` } })).json();
    assert.equal(snapshot.runtime_version, data.diagnostic.runtime.inspector_version);
    assert.equal(data.diagnostic.project_id, null); assert.equal(existsSync(join(r.root, '.spectree')), false);
    data.diagnostic.changes.push({ change_id: '<script>', issues: [{ code: 'E_TEST', message: '<img>', next: 'Inspect', command: ['reconcile.mjs', 'diagnose'] }] });
    const html = runtimePanel({ project: {}, observation: data, inspect: () => '' });
    assert.match(html, /Prontidão operacional/); assert.match(html, /&lt;img&gt;/);
    assert.doesNotMatch(html, /<script>/);
  } finally { if (console) await new Promise(resolve => console.server.close(resolve)); cleanup(r.root); }
});
test('project observation flushes a diagnostic larger than a pipe buffer without truncation', async () => {
  const r = fixture();
  try {
    for (let i = 0; i < 100; i++) writeFiles(r.root, {
      [`.spectree/changes/large-${i}.json`]: JSON.stringify({ ...change({ change_id: `large-${i}`, state: 'blocked', blocked_from: 'implemented' }), blocked_reason: 'Inspected operational discrepancy. '.repeat(50) })
    });
    const result = await observeRuntime(r.root);
    assert.equal(result.status, 'observed', JSON.stringify(result));
    assert.equal(result.diagnostic.changes.length, 101);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) > 64 * 1024);
  } finally { cleanup(r.root); }
});
