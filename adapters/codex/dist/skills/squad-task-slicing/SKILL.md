---
name: squad-task-slicing
description: How the Solutions Architect cuts a change into tasks for `tasks.md` — vertical slices by `Scenario`, each fitting a fresh window and naming what blocks it; a preparatory refactor as its own change; a wide refactor as expand–contract. Load before writing `tasks.md`.
---

<!-- GENERATED FILE — do not edit.
     Source: protocol/skills/squad-task-slicing.md
     Rebuild: node scripts/build.mjs   ·   Verify: node scripts/build.mjs --check -->

# Task slicing: how a change becomes tasks

`tasks.md` is the dispatch, and its cut decides how much each Developer has to hold at once, what can run in parallel, and when the suite is allowed to be red. Adapted, with attribution, from Matt Pocock's `to-tickets` skill (MIT).

## A task is a set of `Scenario`s, never a set of files

- **Cut vertically.** A task delivers one `Scenario` or a few, end to end through every path of the module it needs: core, adapter, UI. When it is done, it is verifiable on its own, by the named tests that prove its `Scenario`s. Those tests are the exit criterion the executor checks, and it registers them with the `Scenario` IDs.
- **A task fits a fresh window.** The mission, its contract, its mandatory reading and its exit criterion fit the compact dispatch (Section 7). If they do not, the task is too big, and you split it by `Scenario`, never by "first half of the code".
- **Splitting by layer is for volume only.** A large module can take one Developer per path, because the three paths are disjoint. When you do it, the core task comes first and the adapter and UI tasks are blocked by it, because they consume what it declares. A layer split chosen by default produces three tasks, none of which proves a `Scenario` alone.
- **Upstream before downstream.** A task in a downstream module that consumes a new query is blocked by the task in the upstream module that publishes it. Tasks in independent modules have no edge between them, which is what lets them run in parallel.

## Blocking edges

Each task names the tasks that must finish before it can start, or "none". An edge exists only where one task genuinely gates the other: it consumes what the other declares, or it edits what the other creates. The frontier is every task whose blockers are all done. Two tasks that need the same file are not an edge, they are a map drawn wrong, and that goes back to the module graph before any task is written.

## Make the change easy, then make the easy change

When the first `Scenario` is hard to land because the code is the wrong shape, the fix is a preparatory refactor, and **it is its own deltaless change, sequenced ahead of this one**. "Add X and also refactor Y" is two changes (your card, Change size). It goes first so that this change's suite is green at baseline and its diff is only the behaviour.

## A wide refactor is expand–contract

A wide refactor is one mechanical change whose blast radius crosses the whole codebase: renaming a contract several modules consume, retyping a shared DTO, changing a column. No vertical slice of it can land green, so do not force one. Sequence it in three parts:

1. **Expand.** Add the new form beside the old one, so nothing breaks: a new field, a new query, a new column.
2. **Migrate, in batches.** Move the callers over one batch at a time, each batch its own task blocked by the expand, with the suite green after each one, because the old form still exists. The natural batch here is one consuming module, which is also one Developer and runs in parallel along the graph.
3. **Contract.** Remove the old form once nothing uses it, in a task blocked by every batch.

On a schema, expand and migrate are reversible migrations. **The contract that drops a column or table is destructive, and that is gate 3**, a separate decision even when everything before it was routine. When the batches cannot stay green alone, keep the sequence, but say so in `tasks.md`: green is promised only after the last batch, and the baseline names that revision.

## What stays out

- **The Founder does not review the granularity.** The cut is yours, and it is checked by what happens to it: a task that hit its ceiling or was split mid-build is a retro finding.
- **No file list in place of a behaviour.** Paths go in the task as its allowed paths, never as what it delivers. "Create the DTO and the repository" is a layer list; "an account created with a blank name is refused" is a task.
