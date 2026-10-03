import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gitRepo, tempDir, cleanup, writeFiles } from './helpers.mjs';
import { planAdoption, applyAdoption } from '../scripts/lib/adoption.mjs';
import { Store } from '../scripts/lib/store.mjs';
import { supervisedLaunch, inspectProcesses } from '../scripts/lib/process-supervisor.mjs';
import { claudeEvents, agentCommand } from '../scripts/lib/agent-runner.mjs';

const request = { version: 1, project_id: 'legacy', change_id: 'next', scope: 'Implement the next reviewed feature',
  allowed_paths: ['src/'], refs: ['docs/changes/old/proposal.md'], adapter: 'claude-code', closure_mode: 'prepared' };
function fixture() { return gitRepo({ '.gitignore': '.spectree/\n', 'src/a.txt': 'original', 'docs/changes/old/proposal.md': '# Old artifact',
  'docs/changes/archive/past/proposal.md': '# Historical archive' }); }
test('adoption planning is read only and application creates only a draft, never approvals or historical closure', () => {
  const r = fixture();
  try {
    const plan = planAdoption(r.root, request); assert.equal(existsSync(join(r.root, '.spectree')), false);
    assert.equal(plan.inventory.archived_artifact_directories, 1); assert.equal(plan.historical_approvals_created, 0);
    assert.equal(applyAdoption(r.root, plan).state, 'draft');
    const s = new Store(r.root); assert.equal(s.change('next').state, 'draft'); assert.deepEqual(s.approvals('next'), []);
    assert.equal(readFileSync(join(r.root, request.refs[0]), 'utf8'), '# Old artifact');
    assert.throws(() => applyAdoption(r.root, plan), { code: 'E_ADOPTION_EXISTS' });
  } finally { cleanup(r.root); }
});
test('adoption refuses altered plans, source drift, ignored authority drift and project identity replacement', () => {
  const r = fixture();
  try {
    const p = planAdoption(r.root, request);
    assert.throws(() => applyAdoption(r.root, { ...p, change: { ...p.change, state: 'implemented' } }), { code: 'E_ADOPTION_STALE' });
    writeFileSync(join(r.root, request.refs[0]), 'changed');
    assert.throws(() => applyAdoption(r.root, p), { code: 'E_ADOPTION_STALE' });
    const p2 = planAdoption(r.root, request);
    new Store(r.root).init({ project_id: 'legacy', protocol_version: '1.0.0', ci: { existing: true } });
    assert.throws(() => applyAdoption(r.root, p2), { code: 'E_ADOPTION_STALE' });
    assert.throws(() => planAdoption(r.root, { ...request, project_id: 'other' }), { code: 'E_ADOPTION_IDENTITY' });
    const p3 = planAdoption(r.root, request); applyAdoption(r.root, p3);
    assert.deepEqual(new Store(r.root).project().ci, { existing: true });
  } finally { cleanup(r.root); }
});
test('Claude requires one successful terminal result and never treats quota, permission denial or malformed output as success', () => {
  const ok = { type: 'result', subtype: 'success', is_error: false, result: 'done', usage: { input_tokens: 3 } };
  const parse = (events, result = { status: 0 }) => claudeEvents(events.map((e) => typeof e === 'string' ? e : JSON.stringify(e)).join('\n'), result);
  assert.equal(parse([ok]).status, 'reported_success'); assert.equal(parse([ok]).usage.input_tokens, 3);
  assert.equal(parse([{ type: 'system' }]).status, 'unknown'); assert.equal(parse([ok, ok]).status, 'unknown');
  assert.equal(parse([ok, 'malformed']).status, 'unknown'); assert.equal(parse([ok], { status: 1 }).status, 'failed');
  assert.equal(parse([{ ...ok, result: 'usage limit reached' }]).status, 'interrupted');
  assert.equal(parse([{ ...ok, permission_denials: [{ tool_name: 'Write' }] }]).status, 'failed');
  assert.equal(parse([{ ...ok, is_error: true }]).status, 'failed');
  const cmd = agentCommand('/tmp', { kind: 'claude-code' }); assert.ok(cmd.includes('--safe-mode')); assert.ok(cmd.includes('dontAsk'));
  assert.ok(!cmd.some((s) => /bypassPermissions|dangerously|--bare/.test(s)));
  assert.throws(() => agentCommand('/tmp', { kind: 'claude-code', read_only: true, allowed_tools: ['Bash'] }), { code: 'E_AGENT_CONFIG' });
  assert.throws(() => agentCommand('/tmp', { kind: 'claude-code', timeout_seconds: 0 }), { code: 'E_AGENT_CONFIG' });
});
test('supervised commands preserve stdin/argv and record observed shutdown', () => {
  const root = tempDir();
  try {
    const args = ['space and & character', 'a"b', 'trailing\\'];
    const r = supervisedLaunch([process.execPath, '-e', "console.log(JSON.stringify({args:process.argv.slice(1),input:require('fs').readFileSync(0,'utf8')}))", ...args], { cwd: root, input: 'input', timeout: 5000 });
    assert.equal(r.error, undefined, r.stderr); assert.equal(r.status, 0);
    assert.deepEqual(JSON.parse(r.stdout), { args, input: 'input' });
    assert.equal(inspectProcesses(root, r.process.ref)[0].stopped, true);
  } finally { cleanup(root); }
});
test('timeout terminates a child that could write after its parent deadline', async () => {
  const root = tempDir();
  try {
    writeFiles(root, { 'child.cjs': "setTimeout(()=>require('fs').writeFileSync('late.txt','unsafe'),1800);setInterval(()=>{},1000);",
      'parent.cjs': "require('child_process').spawn(process.execPath,['child.cjs'],{stdio:'ignore'});setInterval(()=>{},1000);" });
    const r = supervisedLaunch([process.execPath, 'parent.cjs'], { cwd: root, timeout: 200 });
    assert.equal(r.error.code, 'ETIMEDOUT'); assert.equal(r.process.quiescent, true);
    await new Promise((resolve) => setTimeout(resolve, 1900)); assert.equal(existsSync(join(root, 'late.txt')), false);
  } finally { cleanup(root); }
});
test('successful parent with surviving descendants is cleaned up and cannot report success', () => {
  const root = tempDir();
  try {
    writeFiles(root, { 'parent.cjs': "const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:process.platform==='win32'});c.unref();" });
    const r = supervisedLaunch([process.execPath, 'parent.cjs'], { cwd: root, timeout: 5000 });
    assert.equal(r.error.code, 'E_PROCESS_DESCENDANTS'); assert.equal(r.process.quiescent, true);
  } finally { cleanup(root); }
});
test('unknown process receipts cannot be reconciled by operator assertion', () => {
  const root = tempDir();
  try { writeFiles(root, { '.spectree/processes/test/request.json': '{}' });
    assert.throws(() => inspectProcesses(root, '.spectree/processes/test'), { code: 'E_PROCESS_UNKNOWN' });
  } finally { cleanup(root); }
});
test('Windows supervisor death closes its job before any orphan can perform a late write', { skip: process.platform !== 'win32' }, async () => {
  const root = tempDir();
  try {
    writeFiles(root, { 'kill-supervisor.cjs': "process.kill(process.ppid,'SIGKILL');setTimeout(()=>require('fs').writeFileSync('late.txt','unsafe'),1000);setInterval(()=>{},1000);" });
    const r = supervisedLaunch([process.execPath, 'kill-supervisor.cjs'], { cwd: root, timeout: 5000 });
    assert.equal(r.error.code, 'E_PROCESS_UNKNOWN');
    assert.equal(inspectProcesses(root, r.process.ref)[0].stopped, true);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal(existsSync(join(root, 'late.txt')), false);
  } finally { cleanup(root); }
});
test('a fast output overflow cannot be truncated into a successful result', () => {
  const root = tempDir();
  try {
    const r = supervisedLaunch([process.execPath, '-e', "process.stdout.write('x'.repeat(20000))"], { cwd: root, timeout: 5000, maxBuffer: 1024 });
    assert.equal(r.error.code, 'ENOBUFS'); assert.ok(Buffer.byteLength(r.stdout) <= 1024);
  } finally { cleanup(root); }
});
