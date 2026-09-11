// Descriptive telemetry only. No result from this module is workflow authority.
const time = (s) => typeof s === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(s) && Number.isFinite(Date.parse(s)) ? Date.parse(s) : null;
const interval = (a, b) => {
  const start = time(a), end = time(b);
  if (start === null || end === null) return null;
  if (end < start) throw new Error('timestamps are reversed');
  return [start, end];
};
export function unionMs(intervals) {
  const sorted = intervals.map((x) => [...x]).sort((a, b) => a[0] - b[0]);
  let total = 0, edge = -Infinity;
  for (const [start, end] of sorted) {
    if (end < start) throw new Error('timestamps are reversed');
    total += Math.max(0, end - Math.max(start, edge));
    edge = Math.max(edge, end);
  }
  return total;
}

export function runTiming(run, jobs, { repository, runId, attempt }) {
  if (run.id !== runId || run.run_attempt !== attempt || run.repository?.full_name?.toLowerCase() !== repository.toLowerCase()) {
    throw new Error('run identity does not match the requested repository/run/attempt');
  }
  if (!/^[a-f0-9]{40}$/.test(run.head_sha ?? '')) throw new Error('run has no full head SHA');
  if (!Array.isArray(jobs) || new Set(jobs.map((j) => j.id)).size !== jobs.length) throw new Error('invalid or duplicate jobs');
  const measured = jobs.map((j) => {
    if (!Number.isSafeInteger(j.id) || j.run_id !== runId || j.head_sha !== run.head_sha) throw new Error('job identity mismatch');
    const span = j.status === 'completed' && j.conclusion !== 'skipped' ? interval(j.started_at, j.completed_at) : null;
    if (j.status === 'completed' && j.conclusion !== 'skipped' && !span) throw new Error('completed job has no usable interval');
    return { id: j.id, name: j.name, status: j.status, conclusion: j.conclusion,
      started_at: j.started_at ?? null, completed_at: j.completed_at ?? null,
      duration_ms: span ? span[1] - span[0] : null, span };
  });
  const spans = measured.filter((j) => j.span).map((j) => j.span);
  const complete = jobs.length > 0 && run.status === 'completed' && jobs.every((j) => j.status === 'completed');
  const first = spans.length ? Math.min(...spans.map((s) => s[0])) : null;
  const last = spans.length ? Math.max(...spans.map((s) => s[1])) : null;
  const created = time(run.created_at);
  if (created !== null && first !== null && first < created) throw new Error('job precedes run creation');
  return {
    repository, run_id: runId, attempt, head_sha: run.head_sha, event: run.event,
    branch: run.head_branch, status: run.status, conclusion: run.conclusion, url: run.html_url,
    created_at: run.created_at, run_started_at: run.run_started_at,
    complete, jobs: measured.map(({ span, ...j }) => j),
    // Sum is resource usage; union is wall occupancy. Parallel jobs must not inflate elapsed time.
    job_sum_ms: complete ? spans.reduce((n, [a, b]) => n + b - a, 0) : null,
    job_union_ms: complete ? unionMs(spans) : null,
    initial_wait_ms: complete && attempt === 1 && created !== null && first !== null ? first - created : null,
    job_span_ms: complete && first !== null ? last - first : null,
    queue_ms: null,
    queue_note: 'Job eligibility/enqueue timestamps are unavailable. Initial wait and inter-job gaps also include scheduling/dependencies; they are NOT pure runner queue time. Reruns cannot reuse the original created_at as an attempt start.',
    human_wait_ms: null,
    human_note: 'Not inferred from PR creation, review or merge. Use separately recorded request/decision events.',
  };
}

export function humanTiming(doc, repository, runId) {
  if (doc?.version !== 1 || doc.repository !== repository || doc.run_id !== runId || !Array.isArray(doc.waits)) {
    throw new Error('human event file must identify version 1, repository, run_id and waits');
  }
  if (new Set(doc.waits.map((w) => w.id)).size !== doc.waits.length) throw new Error('duplicate human wait id');
  const spans = doc.waits.map((w) => {
    if (!w.id || !w.source) throw new Error('human wait requires id and provenance');
    const span = interval(w.requested_at, w.decided_at);
    if (!span) throw new Error('human wait requires both timestamps with timezone');
    return span;
  });
  return { source_kind: 'operator_supplied_timestamps_not_approval', waits: doc.waits,
    wait_union_ms: spans.length ? unionMs(spans) : null };
}
