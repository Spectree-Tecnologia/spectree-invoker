import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTiming, humanTiming, unionMs } from '../bench/lib/timing.mjs';
import { collectRun } from '../bench/observe-run.mjs';

const t = (s) => `2026-09-11T00:00:${String(s).padStart(2, '0')}Z`;
const sha = 'a'.repeat(40);
const run = { id: 7, run_attempt: 1, repository: { full_name: 'fixture/repo' }, head_sha: sha,
  status: 'completed', conclusion: 'success', created_at: t(0), run_started_at: t(1) };
const job = (id, start, end) => ({ id, run_id: 7, head_sha: sha, name: `job${id}`,
  status: 'completed', conclusion: 'success', started_at: t(start), completed_at: t(end) });
const identity = { repository: 'fixture/repo', runId: 7, attempt: 1 };

test('parallel jobs have separate resource sum and wall union, never a fabricated queue', () => {
  const r = runTiming(run, [job(1, 2, 12), job(2, 7, 17)], identity);
  assert.equal(r.job_sum_ms, 20000);
  assert.equal(r.job_union_ms, 15000);
  assert.equal(r.initial_wait_ms, 2000);
  assert.equal(r.queue_ms, null);
  assert.equal(r.human_wait_ms, null);
  assert.equal(unionMs([[0, 10], [3, 4], [12, 14]]), 12);
});
test('pending, empty, skipped and rerun observations do not invent elapsed time', () => {
  assert.equal(runTiming({ ...run, status: 'in_progress' }, [job(1, 2, 3)], identity).job_union_ms, null);
  assert.equal(runTiming(run, [], identity).complete, false);
  assert.equal(runTiming(run, [{ ...job(1, 2, 3), conclusion: 'skipped' }], identity).jobs[0].duration_ms, null);
  assert.equal(runTiming({ ...run, run_attempt: 2 }, [job(1, 2, 3)], { ...identity, attempt: 2 }).initial_wait_ms, null);
  assert.equal(runTiming({ ...run, conclusion: 'failure' }, [job(1, 2, 3)], identity).conclusion, 'failure');
});
test('foreign runs, jobs, duplicate jobs, missing and reversed timestamps are refused', () => {
  for (const bad of [{ ...run, id: 8 }, { ...run, run_attempt: 2 }, { ...run, head_sha: 'abc' },
    { ...run, repository: { full_name: 'other/repo' } }]) assert.throws(() => runTiming(bad, [job(1, 2, 3)], identity));
  for (const jobs of [[{ ...job(1, 2, 3), run_id: 8 }], [{ ...job(1, 2, 3), head_sha: 'b'.repeat(40) }],
    [job(1, 2, 3), job(1, 4, 5)], [job(1, 4, 2)], [{ ...job(1, 2, 3), completed_at: null }]]) {
    assert.throws(() => runTiming(run, jobs, identity));
  }
});
test('human timestamps retain provenance, use a union and are not approval records', () => {
  const doc = { version: 1, repository: 'fixture/repo', run_id: 7, waits: [
    { id: 'a', source: 'operator transcript reference', requested_at: t(2), decided_at: t(12) },
    { id: 'b', source: 'operator transcript reference', requested_at: t(7), decided_at: t(17) },
  ] };
  assert.equal(humanTiming(doc, 'fixture/repo', 7).wait_union_ms, 15000);
  assert.throws(() => humanTiming(doc, 'other/repo', 7));
  assert.throws(() => humanTiming({ ...doc, waits: [doc.waits[0], doc.waits[0]] }, 'fixture/repo', 7));
  assert.throws(() => humanTiming({ ...doc, waits: [{ ...doc.waits[0], decided_at: null }] }, 'fixture/repo', 7));
});
test('collector pins attempt endpoints, consumes all pages and rechecks run identity', () => {
  const calls = [];
  const request = (path, paginate) => {
    calls.push([path, paginate]);
    return paginate ? [{ total_count: 2, jobs: [job(1, 2, 3)] }, { total_count: 2, jobs: [job(2, 4, 5)] }] : run;
  };
  const r = collectRun(identity, request);
  assert.equal(r.run.jobs.length, 2);
  assert.equal(r.log_bytes, 0);
  assert.deepEqual(calls, [['repos/fixture/repo/actions/runs/7/attempts/1', false],
    ['repos/fixture/repo/actions/runs/7/attempts/1/jobs?per_page=100', true],
    ['repos/fixture/repo/actions/runs/7/attempts/1', false]]);
  assert.throws(() => collectRun(identity, (_, pages) => pages ? [{ total_count: 2, jobs: [job(1, 2, 3)] }] : run));
  let reads = 0;
  assert.throws(() => collectRun(identity, (_, pages) => pages ? [{ total_count: 1, jobs: [job(1, 2, 3)] }] :
    (++reads === 1 ? run : { ...run, run_attempt: 2 })));
  assert.throws(() => collectRun({ ...identity, repository: '../repo' }, () => { throw new Error('must not query'); }), /invalid/);
});
