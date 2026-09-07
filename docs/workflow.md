# The delivery cycle: one PR, and a confirmation after it

## What was wrong

A consumer's change 18 produced this:

1. a PR for the implementation;
2. CI after the merge;
3. a commit recording the merge — which started CI again;
4. a **second PR** to consolidate the specs and archive the change folder;
5. a commit recording that this one was green too — which started CI a fifth time.

Five runs, about 16m36s of CI, for one delivery. Three of those runs had as their entire subject
the previous run. And because the second PR arrived after the approval, it collected fixes and
investigations that were never in anybody's scope — which then collided with the rule that lets
an administrative closure proceed without a new approval.

Those numbers are evidence of a flow problem. They are not a benchmark, and nothing here
promises a number.

## The cycle now

```
scope approved
  -> branch and baseline
  -> pass 1, where the change has Scenarios
  -> implementation
  -> closure PREPARED on the branch          <- the move
  -> pass 2 over the final candidate
  -> CI, readiness
  -> integration approval bound to that candidate
  -> ONE merge
  -> post-merge confirmation
  -> closed
```

**Preparing the closure before the merge is not declaring the integration before it happens.**
Consolidating the delta into the living spec and archiving the folder are changes to *content*,
so they belong in the candidate that gets reviewed and merged. Nothing about the state moves:
`integrated` and `closed` are written after the merge is observed, and by nothing else.

Preparation comes **before** pass 2 and CI, because a candidate that is validated and then
edited is not the candidate that was validated.

## Preparing

```bash
node scripts/prepare-closure.mjs <change-id>            # plan only, writes nothing
node scripts/prepare-closure.mjs <change-id> --apply
```

It validates the proposal against the deltas on disk and the change's ownership, runs **the
project's own** consolidation command, archives the change folder, records the deferrals the
change is leaving behind, and writes one manifest at `.spectree/closure/<change-id>.json`:

| Field | What it pins |
|---|---|
| `manifest_version` | the preparation contract this was written under |
| `change_id`, `base_revision` | which change, against which immutable base |
| `contract_digest` | the Requirements it consolidated |
| `candidate_digest` | the content it prepared — computed after the writes |
| `artifacts` | what it produced, each with its own digest |
| `commands` | what it ran, and how each exited |
| `blocking` | what stops integration |
| `deferred` | what is being carried forward, not paid |

The manifest lives under `.spectree/`, which every digest already excludes, so it is never part
of the candidate it describes.

It is **idempotent** for the same contract and candidate (a second `--apply` reports
`unchanged`), refuses a manifest belonging to another change (`E_PREP_COLLISION`) or written
under another contract version, and refuses to be read as valid once either digest moves
(`E_PREP_STALE`). **An archived folder is not proof**: the folder says a move happened; only the
manifest says what was true when it happened.

`integration_approved` requires a preparation that covers the candidate. A fix after preparation
invalidates it, and so does a Requirement added afterwards — the same rule that already
invalidates a QA pass, for the same reason.

### A project with no consolidation mechanism

Declare the command once:

```bash
node scripts/state.mjs init <project-id> -- npm run spec:merge
```

Without it, `prepare-closure` refuses with `E_NO_CONSOLIDATION` and writes nothing. **Hand-editing
`docs/specs/` is not the fallback** — a spec written by the agent that also approves it proves
nothing. Such a project closes the legacy way, and says so out loud:

```bash
node scripts/state.mjs open <id> --closure-mode legacy ...
```

That is an explicit statement on the change, never a silent fallback, and the post-merge
confirmation reports it as legacy.

## After the merge

```bash
node scripts/post-merge.mjs <change-id> --pr <number>            # confirm only
node scripts/post-merge.mjs <change-id> --pr <number> --apply    # confirm and close
```

Seven steps and no eighth: read the merge result, confirm the PR and its base branch, confirm
the integrated content **is** the authorised candidate, check the checks the policy required,
confirm the prepared artifacts are there, record the result in the trail, close.

It is not a place for an architecture review, a rewrite of the roles, a recount of the backlog,
an investigation into an auxiliary tool, or an opportunistic fix. A real failure stops the
closure and produces an impediment — a short confirmation that hides one is worse than a long
one. Deploy stays a separate decision and a separate gate.

## CI proportional to what changed

`scripts/ci-treatment.mjs` classifies the **whole candidate against its base** — never the last
commit, and never the PR title, the commit prefix or a label.

| What the candidate contains | Treatment |
|---|---|
| code, tests, dependencies, config, workflow, protocol, living spec, or anything unrecognised | full |
| recognised documentation only | documented closure |
| the operational trail only | operational trail |
| nothing, or a comparison that could not be made | full |

Adding a log commit on top of a code change does not reclassify the code: against the base, the
code is still there. The example workflow in `.github/workflows/check.yml` shows the shape —
a `classify` job, jobs gated on its output, and a `required` aggregate that runs with
`if: always()` and fails when any needed job is anything other than `success`. **Require the
aggregate**, not the individual jobs: a check that failed, was cancelled or never reported is
not a pass, and `[skip ci]` is never the mechanism.

The policy is reusable (`scripts/lib/ci-policy.mjs`) and this delivery changes **no consumer's
workflow**.

## The trail, and what it is not

A green is an event about a revision, not part of it. Recording "CI passed" inside the content
it describes starts another run, which produces another event.

Events go to `.spectree/history/<change-id>.jsonl`, append-only, each naming the change and the
revision it applies to — transitions, `closure_prepared`, `integration_observed` with the PR and
merge commit.

```bash
node scripts/state.mjs trail <change-id>
node scripts/state.mjs trail --export trail.jsonl
```

**Retention is the project's `.spectree/` directory and nothing more.** A consumer that gitignores
it — which is the recommendation, because committing it makes every branch switch collide with
the squad's own writes — has no durable copy off that machine. That is a limit, stated rather
than papered over: export it into whatever the project actually keeps records in. A consumer that
needs a versioned trail can commit exports on its own cadence; nothing here creates a chain of
commits to achieve it, and no existing history is rewritten.

## Migrating a consumer

Nothing changes silently. In order:

1. **Nothing to do to keep working.** A change opened with `--closure-mode legacy` follows the
   old flow, and the state machine exempts it by name.
2. **Declare the consolidation command** when the project has one (`state.mjs init … -- <cmd>`,
   or `closure.consolidate` in `.spectree/project.json`, an array when any argument has a space).
3. **Move preparation before pass 2** in the next change. Nothing else in the pipeline moves.
4. **Adopt the CI policy when you want it.** It is a script and a library; your workflow is
   yours, and this delivery does not touch it.
5. **Require the aggregate** in branch protection before relying on any selective job. Nothing
   here changes a protection, and nothing here can.

## What this is, and what it is not

Mechanised: the preparation and its manifest, the staleness rules, the classification, the
aggregate, the post-merge sequence, the trail and its export.

Still behavioural: what belongs in a change's scope, when a discovery is a referral rather than a
fix, and the judgement in a pass 2. Those are read in the protocol, not enforced by a script.

The operational target — one PR, and a post-merge phase that only confirms — is what the
synthetic cycle in `tests/cli-cycle.test.mjs` exercises end to end: one merge, and **zero commits
after it**, asserted. The "under five minutes" figure is a hypothesis to measure on a real
change, excluding human waiting and respecting every required check. No synthetic test proves it.
