# Read-only next-step planning

`state.mjs plan` recommends an operational next step from the same gate context used by `can`
and `transition`. It does not implement the work, dispatch agents, record evidence, grant approval,
prepare files, merge a PR or mutate a store. No new approval policy is introduced.

```sh
node <squad>/scripts/state.mjs plan <change-id> --json
node <squad>/scripts/state.mjs resume <change-id> --json
node <squad>/scripts/state.mjs plan <change-id> --observe-ci --pr 27 --json
```

With no id, exactly one open change is selected. Zero or multiple open changes require selection;
the planner never adopts the first change just because it appeared first on disk. Explicit missing
ids are reported as missing. `resume` keeps its existing state inventory and adds `recommendation`;
its historical `next_action` field is retained as a stored note, not authority. Resume reuses its
content/contract measurement for planning, instead of hashing the tree twice.

## Output contract, version 1

Every plan has `advisory: true`, `authorizes_execution: false`, action, role, status, reason and
preconditions (change/state revisions, lifecycle revision, Git revision and content/contract digests
where readable). This is an observation, not an atomic snapshot or an executable capability.
The next real command must reread and revalidate. A printed command is an argument array relative
to the installed scripts directory, not shell text to evaluate. `--apply` is not a plan option.

`ready` means a recommendation is available; it never means permission to execute. `blocked`
identifies a prerequisite to resolve; `waiting` means an observed external check is pending;
`complete` means no further work is inferred for this closed change. CLI exit 0 means a report
was produced, including a blocked report; usage errors exit 2.

| Situation | Recommendation |
|---|---|
| Missing/stale scope approval | Ask the Founder for that approval |
| Missing/stale evidence | Produce the named property with a real project check |
| Unprepared candidate before QA/integration approval | Inspect preparation with its dry-run |
| Uncertain interrupted operation | Resolve the recorded operation, with human decision where required |
| Unproven independent QA | M4 blocker, not a manufactured independence flag |
| Required PR check pending | Wait for changed status, no rerun or repeated full logs |
| Required PR check failed/cancelled/skipped | Diagnose the reported check |
| Missing integration observation | Inspect with post-merge dry-run, supplying the approved PR identity |
| Local gate allows a transition | Revalidate and record only within actual task authorization |

Preparation is suggested before QA and before asking for integration approval over its record.
Its own preflight still decides ownership, frozen records and recovery; the planner does not
duplicate those checks. A refusal is a blocker to resolve, not a retry instruction. Similarly,
`implemented` has a permissive state gate but still requires developer work; the planner does
not turn that permissiveness into an automatic completion claim.

Gate failures carry `detail.gate` or `detail.property`, so the planner does not parse English
messages or implement a second approval/evidence validator. M4 is deliberately more conservative
than the historical gate: the gate still accepts declared independence, but the recommendation
does not present it as observed. This does not close M4 or alter existing transitions.

## Optional live CI

No network is used by local plan/resume. `--observe-ci` explicitly reads the PR and its required
checks via the existing `gh` transport. It requires project.repository and an explicit PR number.
The full head SHA and branch must identify the checkout (or the merge SHA must identify it after
merge). A changed PR, empty required-check set or unavailable transport is unknown, not green.
A second PR read guards against head/state movement while querying checks; it is not a promise
that GitHub remains unchanged after the response.

PR check success never becomes local `ci.green` evidence. For a merged PR, the observation directs
the operator to post-merge's own checks of the merge and main runs; PR checks cannot substitute
for main evidence. No logs, comments, approvals, reruns or merges are written by this option.

## Validation and limits

Tests cover gate parity and structured failures, stale evidence, missing approval, preparation
ordering, M4, pending/red/unknown CI, changing PR identity, recovery, ambiguous change selection,
determinism and byte-identical files across installed plan/resume calls. An old plan's state revision
cannot be used to apply a stale transition. Existing transition/recovery suites still apply.

The structural benefit is one recommendation containing action, owner and reason, instead of
having to derive these from a state inventory and an independently queried gate. A reduction in
model decisions, tool calls or end-to-end latency has NOT been measured in a real harness campaign;
that evaluation belongs to M6. Do not claim percentage savings or automatic delivery from this feature.
