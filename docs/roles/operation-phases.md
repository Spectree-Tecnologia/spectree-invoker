# Operation phases

**Example:** `PHASE`, `beginOperation` and `advanceOperation` in
`scripts/lib/change/lifecycle.mjs`, used by `scripts/lib/closure/post-merge.mjs`.
**Guarded by:** `tests/lifecycle.test.mjs`, `tests/sequences-recovery.test.mjs`,
`tests/work-checkpoints.test.mjs`.

## Rules

- A write whose effects reach outside one record records its phase **before** each effect:
  `intent`, `started`, `observed`, `persisting`, `done`. Phases only move forward.
- Each phase has one recovery, written in `RECOVERY`:
  - `intent`: nothing ran, so the command runs again;
  - `started`: a command was launched and its result never observed, so a person decides whether
    it ran (`--resume --consolidation-ran --reason`, or `--abandon --reason`);
  - `observed` and `persisting`: `--resume` finishes the missing steps without running the
    command again.
- An operation records the inputs it ran against before it runs, and the identity of its result
  after. A resume compares the disk with those records and refuses on drift.
- A decision is applied under the closure control revision it was taken at:
  `--apply --expect-control <revision>`.
- A dispatch or side effect outside the closure is bracketed by `work.mjs start` and
  `work.mjs finish`, and an unknown outcome is settled by `work.mjs reconcile` after inspection.

## Never

- Never fill in a result that was never observed. A `started` operation carries no outcome, and a
  person's answer is recorded as `source: operator_decision`, never as an execution.
- Never re-run the command to recover from `observed` or `persisting`.
- Never let a checkpoint or a recovery grant an approval or advance the lifecycle state.
- Never print a recovery the tool does not implement.
