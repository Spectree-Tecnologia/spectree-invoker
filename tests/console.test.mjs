import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { request } from 'node:http';
import { readProject, pipeline } from '../scripts/lib/console/reader.mjs';
import { startConsole } from '../scripts/lib/console/server.mjs';
import { ORDER } from '../scripts/lib/change/state-machine.mjs';
import { tempDir, writeFiles, cleanup, change, evidence, approval } from './helpers.mjs';

function fixture(t) { const root = tempDir('spectree-console-'); t.after(() => cleanup(root)); return root; }
function json(root, path, value) { writeFiles(root, { [path]: JSON.stringify(value) }); }
function seed(root, id = 'c1') {
  json(root, '.spectree/project.json', { schema_version: '1.0.0', project_id: 'console-fixture' });
  json(root, `.spectree/changes/${id}.json`, change({ change_id: id, state: 'implemented' }));
}
function snapshot(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true }).filter(d => d.isFile()).map(d => {
    const path = join(d.parentPath ?? d.path, d.name); return [path, readFileSync(path).toString('base64')];
  });
}
test('Console projects persisted observations without creating current authority or writing files', t => {
  const root = fixture(t); seed(root);
  json(root, '.spectree/evidence/e1.json', evidence({ property: 'suite.baseline', change_id: 'c1', revision: 'a'.repeat(40) }));
  json(root, '.spectree/approvals/a1.json', approval({ gate: 'scope', change_id: 'other', revision: 'a'.repeat(40) }));
  writeFiles(root, { '.spectree/history/c1.jsonl': JSON.stringify({ type: 'transition', to: 'implemented', at: '2026-10-03T10:00:00Z' }) + '\n' });
  const before = snapshot(root), p = readProject(root, 'p1');
  assert.equal(p.changes[0].state, 'implemented'); assert.equal(p.evidence[0].result, 'PASS');
  assert.equal(p.events[0].change_id, 'c1'); assert.equal(p.approvals[0].change_id, 'other');
  assert.equal(p.freshness, 'not_revalidated'); assert.equal(p.authorizes_execution, false);
  assert.equal(p.health, 'readable'); assert.deepEqual(pipeline.map(s => s.id), ORDER);
  assert.deepEqual(snapshot(root), before);
});
test('empty, uninitialized, missing, invalid schema and archived-only projects never imply success', t => {
  const root = fixture(t);
  assert.equal(readProject(root, 'p').health, 'uninitialized');
  mkdirSync(join(root, 'docs/changes/archive/old'), { recursive: true });
  let p = readProject(root, 'p'); assert.equal(p.legacy.archives, 1); assert.deepEqual(p.changes, []);
  seed(root); json(root, '.spectree/changes/c1.json', change({ state: 'unknown' }));
  p = readProject(root, 'p'); assert.equal(p.health, 'partial'); assert.equal(p.changes.length, 0);
  assert.equal(p.issues[0].code, 'E_DOCUMENT_INVALID');
  assert.equal(readProject(join(root, 'missing'), 'p').health, 'partial');
});
test('corruption and oversized records are explicit and unrelated valid records survive', t => {
  const root = fixture(t); seed(root);
  writeFiles(root, { '.spectree/changes/broken.json': '{', '.spectree/evidence/huge.json': 'x'.repeat(512 * 1024 + 1), '.spectree/history/c1.jsonl': '{"type":"opened"}\n{broken\n' });
  mkdirSync(join(root, '.spectree/evidence/directory.json'));
  const p = readProject(root, 'p');
  assert.equal(p.changes.length, 1); assert.equal(p.events.length, 1);
  for (const code of ['E_DOCUMENT_INVALID', 'E_READ_LIMIT', 'E_EVENT_INVALID', 'E_NOT_REGULAR_FILE']) assert.ok(p.issues.some(i => i.code === code));
});
test('unknown versions and mismatched record identities are never projected as valid observations', t => {
  const root = fixture(t); seed(root);
  json(root, '.spectree/changes/future.json', { ...change({ change_id: 'future' }), schema_version: '2.0.0' });
  json(root, '.spectree/changes/alias.json', change({ change_id: 'c1' }));
  const p = readProject(root, 'p');
  assert.equal(p.changes.length, 1); assert.ok(p.issues.some(i => i.code === 'E_RECORD_IDENTITY'));
  assert.ok(p.issues.some(i => i.code === 'E_DOCUMENT_INVALID'));
});
test('reader refuses symlink/junction ancestors and never returns outside data', t => {
  const root = fixture(t), outside = fixture(t);
  seed(outside); mkdirSync(join(root, '.spectree'), { recursive: true });
  symlinkSync(join(outside, '.spectree/changes'), join(root, '.spectree/changes'), process.platform === 'win32' ? 'junction' : 'dir');
  const p = readProject(root, 'p');
  assert.equal(p.changes.length, 0); assert.ok(p.issues.some(i => i.code === 'E_WORK_PATH'));
  // Remove just the link before fixture cleanup; never recurse through a junction.
  rmSync(join(root, '.spectree/changes'));
});
test('tasks retain interruption, dependencies and unverified evidence without calling an executor', t => {
  const root = fixture(t); seed(root);
  json(root, '.spectree/tasks/c1.json', { version: 1, change_id: 'c1', plan: { tasks: [{ id: 'a', mission: 'Build', depends_on: [] }, { id: 'b', mission: 'Check', depends_on: ['a'] }] },
    attempts: [{ id: 'attempt-1', task_id: 'a', status: 'interrupted' }], results: { a: { valid: true, evidence_ref: '../private.key' } } });
  json(root, '.spectree/work/c1/op/finished.json', { version: 1, change_id: 'c1', operation_id: 'op', event: 'finished', status: 'interrupted', at: '2026-10-03T10:00:00Z' });
  const p = readProject(root, 'p');
  assert.equal(p.tasks[0].attempts[0].status, 'interrupted'); assert.equal(p.tasks[0].freshness, 'not_revalidated');
  assert.deepEqual(p.tasks[1].depends_on, ['a']); assert.equal(p.events[0].status, 'interrupted');
  assert.equal(p.issues.length, 0); // Artifact references are displayed as text; never read.
});
async function server(t, options) {
  const instance = await startConsole(options);
  t.after(() => new Promise(resolve => { instance.server.close(resolve); instance.server.closeAllConnections(); }));
  return instance;
}
function get(origin, path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(origin + path, { method, headers }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', b => body += b);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }); req.on('error', reject); req.end();
  });
}
test('local API requires a session and refuses writes, remote origins, host rebinding and arbitrary paths', async t => {
  const { origin, token } = await server(t, { demo: true });
  const headers = { Authorization: `Bearer ${token}` };
  assert.equal((await get(origin, '/api/snapshot')).status, 401);
  assert.equal((await get(origin, '/api/snapshot', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await get(origin, '/api/snapshot', { headers, method: 'POST' })).status, 405);
  assert.equal((await get(origin, '/api/snapshot', { headers: { ...headers, Origin: 'https://evil.invalid' } })).status, 403);
  assert.equal((await get(origin, '/', { headers: { Host: 'evil.invalid' } })).status, 403);
  assert.equal((await get(origin, '/api/snapshot', { headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  for (const path of ['/api/snapshot?root=../../secret', '/.spectree/project.json', '/..%2fpackage.json', '/package.json']) assert.equal((await get(origin, path, { headers })).status, 404);
  const r = await get(origin, '/api/snapshot', { headers });
  assert.equal(r.status, 200); assert.equal(JSON.parse(r.body).mode, 'demo'); assert.ok(!r.body.includes(token));
  assert.equal(r.headers['access-control-allow-origin'], undefined);
  assert.equal(r.headers['cache-control'], 'no-store');
  const html = await get(origin, '/'); assert.ok(html.headers['content-security-policy'].includes("frame-ancestors 'none'"));
  assert.equal(html.status, 200); assert.equal((await get(origin, '/app.mjs')).status, 200);
});
test('server isolates allowlisted roots, refuses demo mixing, and rereads changing files', async t => {
  const a = fixture(t), b = fixture(t); seed(a, 'a'); seed(b, 'b');
  await assert.rejects(startConsole({ demo: true, roots: [a] }), /separadamente/);
  await assert.rejects(startConsole({ roots: [] }), /project/);
  const { origin, token } = await server(t, { roots: [a, b] });
  const headers = { Authorization: `Bearer ${token}` };
  const initial = JSON.parse((await get(origin, '/api/snapshot', { headers })).body);
  assert.equal(initial.projects[0].changes[0].change_id, 'a'); assert.equal(initial.projects[1].changes[0].change_id, 'b');
  assert.equal(initial.mode, 'live'); assert.ok(!JSON.stringify(initial).includes(a));
  json(a, '.spectree/changes/a.json', change({ change_id: 'a', state: 'blocked', blocked_from: 'draft' }));
  await new Promise(resolve => setTimeout(resolve, 2050));
  const updated = JSON.parse((await get(origin, '/api/snapshot', { headers })).body);
  assert.equal(updated.projects[0].changes[0].state, 'blocked'); assert.equal(updated.projects[1].changes[0].state, 'implemented');
});
