# Maintenance backlog

Risks this repository owns. A consumer project can record an impediment one of these caused it,
but it never inherits the job of fixing the squad: the owner named here is the owner.

## M1 — the runner is where evidence becomes authority

**Owner:** this repository.
**Status:** open, and it stays open — this is a standing constraint, not a task to close.

`state.mjs run` and the TAP reader in `scripts/lib/tap.mjs` are the point where a command's exit
becomes a fact a gate will act on. Nine review rounds landed on this surface, and the pattern was
consistent enough to be worth writing down: **each convenience added here opened the next hole.**

- `--expect-nonzero` made a property's meaning optional, and turned a red CI green.
- `--expect-signal` replaced it with a substring, which a syntax error's echoed source satisfied.
- `--report <path>` let a genuinely red report from yesterday answer for a command that crashed
  on startup today.
- A filter written to skip the parser's empty root group is what let a truncated report through.
- Keying groups by indentation merged two sibling `describe` blocks into one.
- Ignoring `# Subtest:` markers left the middle group of `describe > describe > it` missing, and
  refused a legitimate run.

Four of those were introduced while fixing the previous one. That is what this entry is for.

**Criteria for any change to this surface**, all of them, before it ships:

1. a regression that **fails on the code as it stands** and passes after — for the defect, and
   for the inverse of the defect where one exists (wrongly accepted *and* wrongly refused);
2. at least one regression judged against **real runner output**, produced during the test, not a
   hand-written fixture — a fixture encodes what the author believes the runner emits;
3. the truncation, sibling-group and dangling-subtest regressions still passing, because those
   are the cases that returned;
4. a new option is justified in the commit against the alternative of **not having it**. Every
   option here is a door, and the ones above were all added for convenience;
5. an unsupported or unparseable shape is **refused**, never half-read. Silence about what a run
   did is not evidence that it did it.

## M5 — the post-merge path through `gh`

**Owner:** this repository.
**Status:** **closed**, observed on 2026-09-10 against
`GilsonJunior-Developer/spectree-invoker-smoke-claude` — a disposable target created for this,
authorised by the Founder in session. Nothing was run against a real consumer.

A change was driven open-to-`closed` by the INSTALLED CLIs in that repository, with real evidence,
a real PR, a real merge and real `gh` calls. Three paths were exercised:

| Path | What happened |
|---|---|
| **positive** — PR #1 | merge `190cf34f7123`; the push run on `main` (`34431054767`, `verify=success`) was found by `--commit --event push --branch main --workflow check`; `post-merge --apply` closed the change; `state transition … integrated` on its own refused first with `E_INTEGRATION_NOT_OBSERVED`; the receipt names the repository, PR 1, head `7094859de982`, merge `190cf34f7123`, preparation `prep-98eca15f…`, approval `ap-int-c1` and `check#34431054767/attempt1=success jobs:[verify=success]`; **3 gh calls, 0 log bytes, `origin/main` unchanged by closing** |
| **negative** — PR #2 | an extra commit pushed AFTER the approval, then merged. The confirmation refused on three independent grounds: the approval names other content, no approval covers both content and history, and `E_PREP_STALE`. **No receipt, no `integration_observed`, the state byte for byte what it was** |
| **not green** — PR #3 | CI checks something the local suite does not, and the change does not satisfy it. Confirmed once while the run was still going (`E_CHECK_NOT_GREEN: verify = in_progress`) and once after it finished red (`verify = failure`). No receipt either time |

Two transport facts came out of it, both worth keeping:

- **`gh pr checks` exits 8** while a check is pending. The transport treats 0, 1 and 8 as answers.
- **A `pull_request` run's `head_sha` is the ephemeral merge commit**, not the branch head, so
  `--commit <branch head>` finds nothing there — correctly. In one instance the two shared their
  first twelve hex characters (`89d2443a7c956fbe…` against `89d2443a7c95059c…`), which is the shape
  of trap a short-sha comparison walks into. Confirm a PR's checks through the PR.

What this does **not** claim: that every harness, every merge method or every CI shape behaves the
same. Squash, rebase and merge queues are still unsupported and still say so.

## M6 — delivery time is a hypothesis, not a measurement

**Owner:** this repository.
**Status:** open.

The structural claims are asserted: one PR, one merge, no commit after it, and no rerun caused by
recording that a run was green. Those are properties of the flow, and the tests hold them.

The **comparable end-to-end improvement** is not measured. `post-merge.mjs` reports `gh_calls`, `git_calls_here`, `elapsed_ms` and
`log_bytes` from a monotonic clock, which measures this squad's own work; it does not measure the
GitHub queue, the runner, or a human deciding. Machine time, queue time and human waiting are
three different numbers and nothing here should present them as one.

Criteria for closing: a baseline and a result measured in the same environment on comparable
scope, with those three separated, and enough observations that the word used is not "p95" for a
sample of one. "Under five minutes" is not promised and is not a criterion.

Instrumentation added in 1.2.6: `bench/delivery.mjs --mode compare` runs paired reconstructed
legacy/prepared procedures on the current runtime with raw samples and source identity;
`bench/observe-run.mjs` reads exact GitHub run attempts and all job pages. A live observation of
run 34545915474 separated 96s of job occupancy from the 103s job span. It does not establish pure
queue time or human waiting. Those remain unknown unless measured independently. See
[performance.md](performance.md) for definitions, provenance and commands. M6 remains open.

## M2 — the supported TAP subset is narrow, deliberately

**Owner:** this repository.
**Status:** open; widening it is a decision, not a fix.

What is read is documented in [install.md](install.md). A runner that does not emit TAP needs a
reporter or a converter, and nothing here translates another format. If a consumer is blocked by
that, the impediment is theirs to record and this backlog item is where the work would land —
widening the subset, or adding a second format behind the same refusals.

## M3 — harness loading

**Owner:** this repository.
**Status:** both **closed** for their bounded paths — Codex Desktop for boot/dispatch/refusal,
Claude Code for boot and state reporting in an empty project.

See [compatibility.md](compatibility.md) for what each row rests on. The criterion has not moved:
nothing leaves "implemented, real validation pending" without an observed execution inside the
harness itself.

## M4 — pass 2 cannot be closed honestly on a single-context harness

**Owner:** this repository.
**Status:** open, and now open **by measurement** rather than by omission. It is a limit to state,
not a bug to fix, until a harness proves isolation.

Measured 2026-09-10 on Claude Code desktop (`AI_AGENT=claude-code_2-1-260_agent`), by real
dispatches on a disposable consumer:

- **Prompt isolation exists.** A dispatched agent sees no prior conversation, no sibling's report,
  and no marker held only by the loop that dispatched it. The control arm was run — with the marker
  placed in the dispatch, the same probe quotes it back — so the negative result is absence, not
  incapacity. This is what `context_isolation: "prompt_only"` in the Claude Code adapter now says.
- **No observable signal exists.** A subagent's shell reports the same `CLAUDE_CODE_SESSION_ID`,
  `CLAUDE_CODE_HOST_SESSION_ID`, `CLAUDE_PID` and `AI_AGENT` as the main loop, and an identical set
  of environment variable names. `CLAUDE_AGENT_TYPE` is not set. `process.ppid` differs — and
  differs between two consecutive shells of the same loop, so it discriminates nothing.
- **Capability isolation does not exist.** The parent session transcript is readable from inside a
  dispatched agent, and the Quality Engineer's card carries a shell. The independence of pass 2 is
  protocol, never mechanism.

Two defects found while measuring, both fixed:

- `operating_mode` gave opposite answers about one harness depending on install shape —
  `single-context` in a consumer (the installer shipped no adapter declarations) and
  `delegating-with-isolation` in the package (read straight off `context_isolation`). The second
  silenced the closing NOTE. The installer now ships the declarations, and the mode reaches
  `delegating-with-isolation` only through `observedIsolationSignal()`, never through a field.
- `--independent-of` is recorded verbatim as evidence and checked as if observed. It still is —
  making the gate refuse would block every consumer on every harness, which is the Founder's call
  and not a fix. What changed is that `state.mjs run` now records the MEASURED execution context
  beside it, so two records asserting independence from one context say so on their face.

`pass2_complete` requires evidence whose executor records `independent_of: ['full_stack_developer']`,
because an adversarial pass that saw the builder's reasoning is not the independent pass the
pipeline assumes. The Codex Desktop smoke reported `operating_mode: single-context`, with isolation
**not proven** — so on that harness, today, recording that independence would be asserting
something nobody observed, and the gate should not be closed on it.

`capabilities.mjs` already prints the warning. What is missing is a way for a harness to *prove*
isolation rather than declare it, and until one exists the honest answer is the one the tool gives:
say the mode, do not close the gate, and record the deviation.

Criteria for closing this: a harness that exposes an observable signal of context isolation, and a
check that reads it — not a declaration in an adapter file, which is what the `context_isolation`
field is and remains. The check now exists and has one home: `observedIsolationSignal()` in
`scripts/lib/harness.mjs`. It returns `null` on every harness measured so far, and the day one
grows a marker, that function reads it and this item closes.
