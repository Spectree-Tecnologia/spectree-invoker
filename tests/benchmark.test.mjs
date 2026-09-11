import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO } from './helpers.mjs';

test('paired benchmark exercises both installed modes and publishes raw bounded measurements', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // This child launches its own real node:test runner.
  const result = spawnSync(process.execPath, [join(REPO, 'bench/delivery.mjs'), '--mode', 'compare', '--n', '1', '--json'],
    { cwd: REPO, env, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.stderr);
  const doc = JSON.parse(result.stdout);
  assert.equal(doc.samples.length, 2);
  assert.equal(doc.summaries.length, 2);
  assert.match(doc.source.digest, /^sha256:/);
  for (const sample of doc.samples) {
    assert.equal(sample.final_state, 'closed');
    assert.ok(sample.wall_ms >= sample.wall_without_install_ms);
    assert.ok(sample.wall_without_install_ms > 0);
    assert.equal(sample.count.pull_requests, sample.mode === 'prepared' ? 1 : 2);
    assert.equal(sample.count.pushes_to_main, sample.mode === 'prepared' ? 1 : 3);
  }
  assert.ok(doc.clocks_not_observed.includes('human waiting'));
});
