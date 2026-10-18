import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import { tempDir, cleanup, writeFiles, gitRepo, change } from './helpers.mjs';
import { appendRunEvent, runEvents, agentMetrics } from '../scripts/lib/change/run-events.mjs';
import { readProject } from '../scripts/lib/console/reader.mjs';
import { observeRuntime } from '../scripts/lib/console/observation.mjs';
import { observeProcesses } from '../scripts/lib/shared/process-supervisor.mjs';
import { startConsole } from '../scripts/lib/console/server.mjs';
import { installConsole } from '../scripts/install-console.mjs';
import { runtimePanel } from '../console/runtime.mjs';

test('run journal rejects missing starts, duplicates, corrupt identities and false synthetic usage', t => {
  const root = tempDir(); t.after(() => cleanup(root));
  assert.throws(() => appendRunEvent(root, 'c1', 'op', 'run.finished'), { code: 'E_RUN_EVENT' });
  appendRunEvent(root, 'c1', 'op', 'run.started', { task_id: 'A' });
  assert.throws(() => appendRunEvent(root, 'c1', 'op', 'run.started'), { code: 'E_RUN_EVENT' });
  const metrics = agentMetrics({ elapsed_ms: 5, usage: { input_tokens: 99 }, cost_usd: 8 }, { kind: 'bridge' });
  assert.equal(metrics.input_tokens, null); assert.equal(metrics.cost_usd, null); assert.equal(metrics.elapsed_ms, 5);
  appendRunEvent(root, 'c1', 'op', 'agent.finished', { metrics });
  assert.equal(runEvents(root, 'c1', 'op').length, 2);
  writeFiles(root, { '.spectree/project.json': JSON.stringify({ schema_version: '1.0.0', project_id: 'test' }), '.spectree/changes/c1.json': JSON.stringify(change()) });
  const invalid = { ...runEvents(root, 'c1', 'op')[1], metrics: { ...metrics, reported_models: 'not-an-array' } };
  writeFiles(root, { '.spectree/runs/c1/op/000002.json': JSON.stringify(invalid) });
  assert.throws(() => runEvents(root, 'c1', 'op'), { code: 'E_RUN_CORRUPT' });
  const p = readProject(root, 'p');
  assert.equal(p.runs[0].status, 'unknown'); assert.equal(p.runs[0].metrics, null);
  assert.match(runtimePanel({ project: p, changeId: 'c1', inspect: () => '' }), /Não reportado/);
  assert.equal(agentMetrics({ usage: { input_tokens: 0, output_tokens: 12 }, cost_usd: 0 }, { kind: 'codex', model: 'requested' }).input_tokens, 0);
  assert.equal(agentMetrics({}, { kind: 'codex' }).reported_models, null);
});

test('runtime observation is read only and refuses executable git configuration', async t => {
  const r = gitRepo(); t.after(() => cleanup(r.root));
  writeFiles(r.root, { '.spectree/project.json': JSON.stringify({ schema_version: '1.0.0', project_id: 'test' }), '.spectree/changes/c1.json': JSON.stringify(change({ base_revision: r.base })) });
  const snapshot = () => readdirSync(r.root, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => [join(e.parentPath ?? e.path, e.name), readFileSync(join(e.parentPath ?? e.path, e.name)).toString('base64')]);
  const before = snapshot();
  const result = await observeRuntime(r.root, 'c1');
  assert.equal(result.status, 'observed', JSON.stringify(result)); assert.equal(result.authorizes_execution, false);
  assert.deepEqual(snapshot(), before);
  r.git(['config', 'filter.unsafe.clean', 'echo never-run']);
  writeFiles(r.root, { '.gitattributes': '* filter=unsafe\n' });
  assert.equal((await observeRuntime(r.root, 'c1')).code, 'E_OBSERVATION_HELPER');
});

test('observation HTTP endpoint retains authentication, root allowlist and read-only methods', async t => {
  const { root, base } = gitRepo(); t.after(() => cleanup(root));
  const instance = await startConsole({ roots: [root] });
  t.after(() => new Promise(resolve => instance.server.close(resolve)));
  const url = instance.origin + '/api/observation?project=project-1&change=c1';
  assert.equal((await fetch(url)).status, 401);
  const headers = { Authorization: `Bearer ${instance.token}` };
  assert.equal((await fetch(url, { headers, method: 'POST' })).status, 405);
  assert.equal((await fetch(url + '&root=C:/', { headers })).status, 400);
  assert.equal((await fetch(url, { headers: { ...headers, Origin: 'https://example.com' } })).status, 403);
  assert.equal((await fetch(url, { headers })).status, 409);
  writeFiles(root, { '.spectree/project.json': JSON.stringify({ schema_version: '1.0.0', project_id: 'proj' }), '.spectree/changes/c1.json': JSON.stringify(change({ base_revision: base })) });
  const selected = await fetch(url, { headers });
  assert.equal(selected.status, 200); assert.equal((await selected.json()).status, 'observed');
});

test('process observations distinguish stopped receipts from missing or foreign boundaries', t => {
  const root = tempDir(); t.after(() => cleanup(root));
  assert.equal(observeProcesses(root, 'missing').state, 'unknown');
  const id = '12345678-1234-1234-1234-123456789012';
  const req = { id, host: hostname(), platform: process.platform };
  writeFiles(root, { 'p/request.json': JSON.stringify(req), 'p/receipt.json': JSON.stringify({ id, state: 'stopped' }) });
  assert.equal(observeProcesses(root, 'p').state, 'stopped');
  writeFiles(root, { 'p/request.json': JSON.stringify({ ...req, host: 'another-host' }) });
  assert.equal(observeProcesses(root, 'p').state, 'unknown');
});

test('Console installation is dry-run by default, relocatable and immutable across reinstalls', t => {
  const scratch = tempDir(); t.after(() => cleanup(scratch));
  const destination = join(scratch, 'console with spaces');
  const plan = installConsole(destination);
  assert.equal(existsSync(destination), false);
  const installed = installConsole(destination, { apply: true });
  assert.equal(installed.release, plan.release); assert.equal(installed.installed, true);
  assert.equal(installConsole(destination, { apply: true }).release, plan.release);
  const output = execFileSync(process.execPath, [join(destination, 'releases', installed.release, 'scripts/console.mjs'), '--help'], { cwd: scratch, encoding: 'utf8' });
  assert.match(output, /project/);
  writeFiles(destination, { [`releases/${installed.release}/console/app.mjs`]: 'changed' });
  assert.throws(() => installConsole(destination, { apply: true }), { code: 'E_INSTALL_IMMUTABLE' });
  const conflict = join(scratch, 'conflict'); writeFiles(conflict, { 'spectree-console.cmd': 'user file' });
  assert.throws(() => installConsole(conflict, { apply: true }), { code: 'E_INSTALL_CONFLICT' });
});
