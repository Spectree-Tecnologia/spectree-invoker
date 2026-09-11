# Measuring delivery performance (M6)

Status: instrumentation available; comparable end-to-end improvement NOT established. No five-minute promise.
These tools are for the maintainer of this repository, not installed runtime gates.

## Local machine: paired synthetic procedures

Run with no tests, builds or other benchmarks competing for the machine:

```sh
node bench/delivery.mjs --mode compare --n 7 --json
```

Each pair alternates prepared/legacy order. Both use the current installed runtime and the same
tiny account scenario. Legacy reconstructs the old procedure; it does NOT execute an old release.
The full baseline/branch probes and human approvals are synthetic, QA executes a real tiny test,
and GitHub is a transport stub. This measures local procedure cost, not model reasoning or a
representative consumer suite. A prepared procedure may cost MORE locally while avoiding remote
delivery cycles; neither result alone establishes an end-to-end speedup.

The report retains individual samples, per-command totals, Node/platform, package revision and
content fingerprint. Source drift during the campaign refuses the report. `wall_ms` spans fixture
creation through final checks (cleanup excluded); `wall_without_install_ms` subtracts the measured
installer execution, not all fixture setup. `instrumented_ms` sums selected commands and is not
renamed as elapsed time. PR/push counters are simulated; merge counts and absence of prepared
post-merge commits are also checked against actual disposable Git history.

Store JSON outside the source tree. Do not average failed or mixed-build runs away. Keep raw data;
report n, min, median and max, not p95 from a handful of observations.

## GitHub machine time and scheduling observations

```sh
node bench/observe-run.mjs --repo Spectree-Tecnologia/spectree-invoker --run 34545915474 --attempt 1
```

Only GET requests through `gh api` with native CLI authentication; this is GitHub transport,
not a model API. No log download, merge, push, rerun or protection change. Exact run and attempt,
all job pages, full SHA, duplicate/foreign job checks, and a final run-state reread. A changing run
or incomplete page set refuses the sample. Pending/failed observations are not turned green.
Three `gh` invocations may perform more than three HTTP requests due to pagination.

Fields use the official [run-attempt](https://docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run-attempt)
and [job-attempt](https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run-attempt) endpoints.
`job_sum_ms` is resource duration; `job_union_ms` counts overlapping jobs once. The job span includes
inter-job gaps. Initial wait is creation to first measured job, only for attempt 1. None of these
is pure queue time: eligibility/dependency/enqueue timestamps are not established. `queue_ms` is
therefore null, not zero. A terminal all-skipped run has no measured job interval.

Live read-only check on 2026-09-11: run 34545915474, attempt 1, SHA
1263a9ed7231d2e1eba175a8254b70d4cc7b2dea: classify 6s, plugin 79s, required 4s, tag 7s;
96s job occupancy, 103s span, 2s initial wait. This one invoker run does not explain a consumer's
historical 20–30 minutes. It identifies plugin as the largest job in THIS sample.

## Human waiting: explicit provenance, never guessed

Optionally pass `--human-events file.json` with independently recorded request/decision moments:

```json
{"version":1,"repository":"owner/repo","run_id":123,"waits":[
  {"id":"integration","source":"reference to the request and decision",
   "requested_at":"2026-09-11T10:00:00Z","decided_at":"2026-09-11T10:02:00Z"}
]}
```

These are operator-supplied timestamps, not observed execution or approval authority. Missing
human events remain unknown. Overlaps use a union, not a sum. PR age, commit timestamps and gaps
between messages do not establish human waiting. The three clocks can overlap; do not add them
to invent end-to-end elapsed time.

## Acceptance and next optimization

The installed legacy cycle must retain durable approval authority and refuse absent, file-only or
retired approvals. Both synthetic modes must finish. Collector regressions cover parallel jobs,
pagination, identity, reruns, missing timestamps and pending results.

The only CI optimization in this delivery removes the duplicate classifier invocation: the first
already emits both GitHub outputs and the explanation. No check/job is skipped and no protection
is weakened. Its structural saving is one classification, not a claimed percentage speedup.

Before broader optimization, collect comparable real changes, record work-start/work-end and
explicit approval waits, retain CI attempts, and separate model/tool work from scheduling. M6
stays open while these observations or a comparable baseline are missing. M4 is not part of this
campaign. A future CI split must show the same required assertions on representative changes.
