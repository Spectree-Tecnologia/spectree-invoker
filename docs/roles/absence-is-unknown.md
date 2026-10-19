# Absence is unknown

**Example:** `scripts/lib/change/planner-ci.mjs` (`unknown(reason)`), `outcome()` in
`scripts/lib/change/work.mjs`, `scripts/lib/shared/digest.mjs`.
**Guarded by:** `tests/work-checkpoints.test.mjs`, `tests/planner.test.mjs`.

## Rules

- A missing artifact, an answer that cannot be read and a comparison that cannot be made all
  mean **unknown** or **blocked**. They never mean done, green, empty or unchanged.
- A state that might be unknown has an explicit `'unknown'` value next to the values it can
  prove, and the object carries a `reason` saying what is missing. `observePlanCi` returns
  `{ status: 'unknown', reason, ... }` when it cannot tie the PR to this checkout.
- A value nobody measured stays `null`, not `0` and not a default. Usage, model and cost that a
  transport cannot report stay unknown.
- An agent's report of success is only `reported_success`. Success needs observed evidence.
- An unparseable or missing envelope is unknown, never successful.

## Never

- Never fall back to a value that reads as success when a read fails: no `catch { return true }`,
  no `?? 'green'`, no empty list standing for "no changes".
- Never infer completion from an artifact that only looks finished, such as an archived folder or
  a ticked box in `tasks.md`.
- Never let an operator's assertion replace an observation the runtime cannot make. A process
  boundary that cannot be observed stays unknown and keeps blocking recovery.
