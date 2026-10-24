// Small, verifiable procedures over the GitHub CLI.
//
// The waste these replace is not the API, it is the habit: re-reading a whole run log while the
// run's state has not changed, re-deriving conventions already recorded, and asking for every
// field of an object to use two of them. Each of those is paid in tokens and in wall clock, and
// none of them makes the answer more true.
//
// Every call here names the fields it needs AND the repository it means. A query that searches
// broadly and filters afterwards is a query that goes wrong quietly: fifty runs from other
// changes push the one being looked for off the end of the page, and "not in the list" then
// reads as "did not run" instead of "not asked for".
//
// Nothing here merges, pushes, deletes, or changes a protection: this file reads, and the one
// thing it can be asked to wait for is a state.

import { launch } from './launch.mjs';

const jsonOrThrow = (r, what) => {
  if (r.error) { const e = new Error(`${what}: ${r.error.message}`); e.code = 'E_GH_UNAVAILABLE'; throw e; }
  if (r.status !== 0) {
    const e = new Error(`${what}: gh exited ${r.status}. ${String(r.stderr ?? '').trim()}`);
    e.code = 'E_GH_FAILED';
    e.status = r.status;
    e.stdout = r.stdout;
    throw e;
  }
  try { return JSON.parse(r.stdout); }
  catch { const e = new Error(`${what}: gh returned output that is not JSON`); e.code = 'E_GH_MALFORMED'; throw e; }
};

const run = (args, cwd) => launch(['gh', ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

/** `--repo owner/name` on every call that accepts it. Which repository is not a thing to infer. */
const withRepo = (args, repo) => (repo ? [...args, '--repo', repo] : args);

/** The repository this working tree belongs to, as `owner/name`. */
export function repository({ cwd } = {}) {
  const data = jsonOrThrow(run(['repo', 'view', '--json', 'nameWithOwner'], cwd), 'repository');
  return data.nameWithOwner;
}

/**
 * One PR, only the fields the post-merge confirmation reads — and only fields `gh` has.
 *
 * There is no `merged` field: `gh pr view --json merged` fails with "Unknown JSON field". The
 * state is `MERGED` and `mergedAt` carries the moment, so those are what this asks for.
 */
export function pullRequest(number, { cwd, repo, fields } = {}) {
  const want = fields ?? [
    'number', 'state', 'mergedAt', 'mergeCommit', 'headRefOid', 'headRefName',
    'baseRefName', 'url', 'title',
  ];
  return jsonOrThrow(run(withRepo(['pr', 'view', String(number), '--json', want.join(',')], repo), cwd), `pr ${number}`);
}

/**
 * One PR as the REST API returns it, for the readers that need what `gh pr view` asks GraphQL for:
 * its body, when it opened and the commit it merged as. REST because some harnesses refuse
 * GraphQL, and a reader that only works in one of them is not a reader.
 */
export function pullRequestRecord(number, { cwd, repo }) {
  return jsonOrThrow(run(['api', `repos/${repo}/pulls/${Number(number)}`], cwd), `pr ${number}`);
}

/**
 * The REQUIRED checks of a pull request, as GitHub itself decides what is required.
 *
 * `gh pr checks` exits non-zero when a check is pending or failing, and that exit code is not an
 * error: it is the answer. Treating it as a transport failure turned "still running" into
 * "cannot be read", which is a different thing to report and a different thing to do about.
 */
export function prChecks(number, { cwd, repo, required = true } = {}) {
  const args = withRepo(['pr', 'checks', String(number), '--json', 'name,state,bucket,workflow,completedAt,link'], repo);
  if (required) args.push('--required');
  const r = run(args, cwd);
  if (r.error) { const e = new Error(`pr checks ${number}: ${r.error.message}`); e.code = 'E_GH_UNAVAILABLE'; throw e; }
  // 0 = all succeeded, 8 = still pending, 1 = at least one failed. Anything else, and the text
  // is not a report about checks.
  if (![0, 1, 8].includes(r.status)) {
    const e = new Error(`pr checks ${number}: gh exited ${r.status}. ${String(r.stderr ?? '').trim()}`);
    e.code = 'E_GH_FAILED';
    throw e;
  }
  let checks;
  try { checks = JSON.parse(r.stdout); }
  catch {
    // No required checks configured prints a message, not JSON. That is "none declared", which
    // is emphatically not "all green".
    if (/no checks reported|no required checks/i.test(String(r.stdout) + String(r.stderr))) return { pending: false, checks: [] };
    const e = new Error(`pr checks ${number}: gh returned output that is not JSON`);
    e.code = 'E_GH_MALFORMED';
    throw e;
  }
  return { pending: r.status === 8, checks };
}

/**
 * The workflow runs for one commit, asked for by identity.
 *
 * `--commit`, `--event`, `--branch` and `--workflow` are the filters GitHub applies server-side.
 * Fetching the most recent fifty runs of the whole repository and filtering afterwards meant that
 * fifty runs belonging to other changes hid the one being asked about — and an answer that is
 * missing because the question was too broad is not "it did not run".
 */
export function runsForCommit(sha, { cwd, repo, event, branch, workflow, limit = 30 } = {}) {
  const args = withRepo(['run', 'list', '--commit', String(sha), '--limit', String(limit)], repo);
  if (event) args.push('--event', event);
  if (branch) args.push('--branch', branch);
  if (workflow) args.push('--workflow', String(workflow));
  args.push('--json', 'databaseId,name,workflowName,workflowDatabaseId,status,conclusion,headSha,event,attempt,createdAt,url');
  const runs = jsonOrThrow(run(args, cwd), `runs for ${String(sha).slice(0, 8)}`);
  // The server filter is the contract; this is a belt on it, because a `gh` that silently
  // ignored an unknown flag would otherwise hand back somebody else's commit.
  const wrong = runs.filter((r) => r.headSha && r.headSha !== sha);
  if (wrong.length) {
    const e = new Error(`gh returned ${wrong.length} run(s) for another commit; the query was not applied as asked`);
    e.code = 'E_GH_UNFILTERED';
    throw e;
  }
  return {
    runs,
    // A full page means there may be more, and "more" is not something to guess about.
    complete: runs.length < limit,
    limit,
  };
}

/**
 * The run that speaks for a workflow on that commit: the most recent one, and its latest attempt.
 *
 * Picking whichever entry came first in the JSON let an OLD attempt that had been green stand in
 * for a re-run that failed. Order of a response is not a decision.
 */
export function latestRun(runs, { workflowName, workflowId } = {}) {
  const mine = runs.filter((r) => (workflowId ? String(r.workflowDatabaseId) === String(workflowId) : true))
    .filter((r) => (workflowName ? r.workflowName === workflowName || r.name === workflowName : true));
  if (mine.length === 0) return null;
  return [...mine].sort((a, b) => {
    const t = String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
    if (t !== 0) return t;
    return Number(b.attempt ?? 0) - Number(a.attempt ?? 0) || Number(b.databaseId ?? 0) - Number(a.databaseId ?? 0);
  })[0];
}

/** One run's state, its attempt, and its jobs — without downloading a single log line. */
export function runView(runId, { cwd, repo, jobs = false } = {}) {
  const want = ['databaseId', 'status', 'conclusion', 'attempt', 'workflowName', 'workflowDatabaseId', 'headSha', 'event', 'url'];
  if (jobs) want.push('jobs');
  return jsonOrThrow(run(withRepo(['run', 'view', String(runId), '--json', want.join(',')], repo), cwd), `run ${runId}`);
}

/**
 * Wait for a run to reach a terminal state, polling the STATE and nothing else.
 *
 * Bounded by a deadline, cancellable, with backoff on transport errors only. It returns the
 * state it saw rather than a verdict: a timeout is "still running", which is not a failure and
 * is certainly not a pass — and it is never a reason to start the run again.
 */
export function waitForRun(runId, {
  cwd, repo, intervalMs = 15000, maxIntervalMs = 60000, deadlineMs = 15 * 60 * 1000,
  sleep, now = () => Number(process.hrtime.bigint() / 1000000n), signal,
} = {}) {
  const pause = sleep ?? ((ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms));
  const started = now();
  let wait = intervalMs;
  let polls = 0;
  let last = null;
  let transportErrors = 0;
  for (;;) {
    if (signal?.aborted) return { ...last, cancelled: true, polls, waitedMs: now() - started };
    try {
      last = runView(runId, { cwd, repo });
      polls += 1;
      transportErrors = 0;
      wait = intervalMs;
      if (last.status === 'completed') return { ...last, polls, waitedMs: now() - started };
    } catch (e) {
      if (e.code !== 'E_GH_UNAVAILABLE' && e.code !== 'E_GH_FAILED') throw e;
      transportErrors += 1;
      // Backoff applies to a transport that is failing, not to a run that is simply slow.
      wait = Math.min(maxIntervalMs, wait * 2);
      if (transportErrors > 5) {
        const err = new Error(`run ${runId}: the transport failed ${transportErrors} times in a row (${e.message})`);
        err.code = 'E_GH_UNAVAILABLE';
        throw err;
      }
    }
    if (now() - started + wait > deadlineMs) {
      return { ...(last ?? { databaseId: runId }), timedOut: true, polls, waitedMs: now() - started };
    }
    pause(wait);
  }
}

/** Only the jobs that did not succeed, and only when something did not succeed. */
export function failedJobs(runId, { cwd, repo } = {}) {
  const data = runView(runId, { cwd, repo, jobs: true });
  return (data.jobs ?? [])
    .filter((j) => j.conclusion && j.conclusion !== 'success' && j.conclusion !== 'skipped')
    .map((j) => ({ name: j.name, conclusion: j.conclusion, url: j.url }));
}
