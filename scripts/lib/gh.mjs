// Small, verifiable procedures over the GitHub CLI.
//
// The waste these replace is not the API, it is the habit: re-reading a whole run log while the
// run's state has not changed, re-deriving conventions already recorded, and asking for every
// field of an object to use two of them. Each of those is paid in tokens and in wall clock, and
// none of them makes the answer more true.
//
// Every call here names the fields it needs. Nothing here merges, pushes, deletes, or changes a
// protection: this file reads, and the one thing it can be asked to wait for is a state.

import { launch } from './launch.mjs';

const jsonOrThrow = (r, what) => {
  if (r.error) { const e = new Error(`${what}: ${r.error.message}`); e.code = 'E_GH_UNAVAILABLE'; throw e; }
  if (r.status !== 0) {
    const e = new Error(`${what}: gh exited ${r.status}. ${String(r.stderr ?? '').trim()}`);
    e.code = 'E_GH_FAILED';
    throw e;
  }
  try { return JSON.parse(r.stdout); }
  catch { const e = new Error(`${what}: gh returned output that is not JSON`); e.code = 'E_GH_MALFORMED'; throw e; }
};

const run = (args, cwd) => launch(['gh', ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

/**
 * One PR, only the fields the post-merge confirmation reads — and only fields `gh` has.
 *
 * There is no `merged` field: `gh pr view --json merged` fails with "Unknown JSON field". The
 * state is `MERGED` and `mergedAt` carries the moment, so those are what this asks for.
 */
export function pullRequest(number, { cwd, fields } = {}) {
  const want = fields ?? [
    'number', 'state', 'mergedAt', 'mergeCommit', 'headRefOid', 'headRefName',
    'baseRefName', 'url', 'title',
  ];
  return jsonOrThrow(run(['pr', 'view', String(number), '--json', want.join(',')], cwd), `pr ${number}`);
}

/**
 * The workflow runs for one commit.
 *
 * `gh run list` reports WORKFLOW runs — `workflowName: "check"` — and a policy speaks in check
 * names. Nothing here bridges the two by guessing: the caller maps them from what the project
 * declares, and this only answers "what ran on this sha, and how did it end".
 */
export function runsForSha(sha, { cwd, limit = 50 } = {}) {
  const runs = jsonOrThrow(
    run(['run', 'list', '--limit', String(limit), '--json', 'databaseId,name,workflowName,status,conclusion,headSha'], cwd),
    `runs for ${sha}`);
  return runs.filter((r) => !sha || r.headSha === sha);
}

/**
 * Wait for a run to reach a terminal state, polling the STATE and nothing else.
 *
 * Bounded by attempts and by interval, and it returns the state it saw rather than a verdict:
 * a timeout is "still running", which is not a failure and is certainly not a pass.
 */
export function waitForRun(runId, { cwd, attempts = 40, intervalMs = 15000, sleep } = {}) {
  const pause = sleep ?? ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms));
  let last = null;
  for (let i = 0; i < attempts; i++) {
    last = jsonOrThrow(run(['run', 'view', String(runId), '--json', 'status,conclusion,databaseId'], cwd), `run ${runId}`);
    if (last.status === 'completed') return { ...last, waited: i };
    pause(intervalMs);
  }
  return { ...last, timedOut: true, waited: attempts };
}

/** Only the jobs that did not succeed, and only when something did not succeed. */
export function failedJobs(runId, { cwd } = {}) {
  const data = jsonOrThrow(run(['run', 'view', String(runId), '--json', 'jobs'], cwd), `jobs of run ${runId}`);
  return (data.jobs ?? [])
    .filter((j) => j.conclusion && j.conclusion !== 'success' && j.conclusion !== 'skipped')
    .map((j) => ({ name: j.name, conclusion: j.conclusion, url: j.url }));
}
