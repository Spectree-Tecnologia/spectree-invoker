import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tempDir, cleanup, writeFiles, REPO } from './helpers.mjs';
import { createBridgeRequest, inspectBridgeRequest, publishBridgeResult, waitBridgeResult } from '../scripts/lib/execution/bridge-mailbox.mjs';
import { parseTap, judgePassingRun } from '../scripts/lib/shared/tap.mjs';

test('durable mailbox can receive an agent final from a new process; duplicates and changed evidence fail closed', async () => {
  const root = tempDir();
  try {
    const req = createBridgeRequest(root, { dispatch_id: 'task-1', task: { id: 'A' } }, 60);
    assert.equal(inspectBridgeRequest(root, 'task-1').state, 'waiting');
    writeFiles(root, { '.spectree/actual-final.json': '{"status":"completed","summary":"Observed final from fixture agent."}' });
    const result = { request_id: req.request_id, packet_digest: req.packet_digest, source: 'agent_final', agent_id: 'fixture-agent', status: 'completed', summary: 'Fixture implemented.', refs: ['.spectree/actual-final.json'] };
    assert.throws(() => publishBridgeResult(root, req.request_id, { ...result, packet_digest: 'wrong' }), { code: 'E_BRIDGE_RESULT' });
    writeFiles(root, { '.spectree/result.json': JSON.stringify(result) });
    const child = spawnSync(process.execPath, [join(REPO, 'scripts/bridge.mjs'), 'publish', req.request_id, '.spectree/result.json', '--apply'], { cwd: root, env: { ...process.env, SPECTREE_PROJECT_ROOT: root }, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const terminal = await waitBridgeResult(root, req.request_id);
    assert.equal(terminal.status, 'completed'); assert.equal(terminal.authorizes_execution, false);
    assert.throws(() => publishBridgeResult(root, req.request_id, result), { code: 'E_BRIDGE_CONFLICT' });
    assert.throws(() => createBridgeRequest(root, req.packet), { code: 'E_BRIDGE_CONFLICT' });
    writeFiles(root, { '.spectree/actual-final.json': 'changed evidence' });
    assert.throws(() => inspectBridgeRequest(root, req.request_id), { code: 'E_BRIDGE_RECORD' });
  } finally { cleanup(root); }
});

test('expired mailbox retains a late final for inspection but cannot turn timeout into delivery', async () => {
  const root = tempDir();
  try {
    const req = createBridgeRequest(root, { dispatch_id: 'task-late' }, 1);
    const timeout = await waitBridgeResult(root, req.request_id);
    assert.equal(timeout.status, 'interrupted'); assert.equal(timeout.error, 'timeout');
    writeFiles(root, { '.spectree/late-final.txt': 'Agent ended after deadline.' });
    const late = publishBridgeResult(root, req.request_id, { request_id: req.request_id, packet_digest: req.packet_digest,
      source: 'agent_final', agent_id: 'fixture-agent', status: 'completed', summary: 'Late completion.', refs: ['.spectree/late-final.txt'] });
    assert.equal(late.state, 'late'); assert.equal((await waitBridgeResult(root, req.request_id)).error, 'timeout');
    assert.match(readFileSync(join(root, '.spectree/bridge-mailbox/task-late/terminal.json'), 'utf8'), /Late completion/);
  } finally { cleanup(root); }
});

test('passing oracle separates actual assertion failure from crash, skip, absent and malformed tests', () => {
  const judge = (text, code = 1) => judgePassingRun(parseTap(text), 'A', code).result;
  assert.equal(judge('TAP version 13\nnot ok 1 - A\n  ---\n  code: ERR_ASSERTION\n  ...\n1..1\n'), 'FAIL');
  assert.equal(judge('TAP version 13\nnot ok 1 - A\n  ---\n  name: SyntaxError\n  ...\n1..1\n'), 'INFRA_ERROR');
  assert.equal(judge('ok 1 - A # SKIP\n1..1\n', 0), 'INFRA_ERROR');
  assert.equal(judge('1..0\n', 0), 'INFRA_ERROR');
  assert.equal(judge('not ok 1 - A\n'), 'INFRA_ERROR');
  assert.equal(judge('ok 1 - A\n1..1\n', 0), 'PASS');
  assert.equal(judge('not ok 1 - A\n  ---\n  code: ERR_ASSERTION\n  ...\n1..1\n', 0), 'INFRA_ERROR');
});
