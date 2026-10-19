# Persistence

**Example:** `scripts/lib/shared/persistence.mjs`; `exclusive()` in
`scripts/lib/execution/task-executor.mjs` for a lock with its own refusal.
**Guarded by:** `tests/persistence.test.mjs`.

## Rules

Every write under `.spectree/` goes through the persistence layer, with the writer that matches
what the record is:

| The record | Writer |
|---|---|
| a document replaced whole, such as current state | `writeAtomic` |
| an event that must not exist yet, in a folder that already exists | `writeOnce` |
| a record that must not exist yet and must appear complete or not at all | `publishOnce` |

- A critical section runs inside `withLock(kind, file, fn, options)`. The kinds are taken in
  `LOCK_ORDER`: executor, lifecycle (closure control), change, deferred (ledger). A lock may only
  be taken inside one that comes before it in that order.
- A caller that needs its own refusal when the lock is busy passes `busy`, as the task executor
  does with `E_TASK_BUSY`. Without it, a busy lock refuses with `E_CONCURRENT_UPDATE`.
- History is append-only. An existing event is never rewritten. A correction is a new record.

## Never

- Never write a `.spectree/` record with `writeFileSync` directly, with `{ flag: 'wx' }`, or with
  your own `linkSync` or `renameSync`. The one rename left outside the layer archives a change
  folder under `docs/` in `closure/prepare.mjs`.
- Never take a lock out of order, or the same kind twice. The layer refuses it with
  `E_LOCK_ORDER`; do not catch that refusal and retry.
- Never remove a lock file another owner holds.
