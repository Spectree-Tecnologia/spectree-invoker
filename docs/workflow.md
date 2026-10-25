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

## Amending ownership mid-build

```bash
node scripts/state.mjs amend-paths <change-id> --add <path>[,<path>] --reason "<why>"
```

The paths cut at `open` are a guess made before anyone wrote, and the build is where it turns
out one file short. **An amendment is recorded, never improvised**: `allowed_paths` grows, and a
`paths_amended` event with the paths, their modules and the reason goes on the trail. A path
already owned is a no-op.

It stops for a person in one case only: **the new path falls in a module the change does not
name** (`modules_named`, or, where the proposal recorded none, the modules its paths already
own). That is a wider scope, so the refusal is `E_AMEND_NEW_MODULE`, and the route is the
Architect amending the proposal and gate 1 again. Operational state and instructions are never
owned, and after `integration_approved` ownership is frozen with the content (`E_AMEND_STATE`).
Where the change has no contractual file on disk, its paths are part of the scope digest, and the
command says the scope approval no longer covers it.

## Preparing

```bash
node scripts/prepare-closure.mjs <change-id>            # plan only, writes nothing
node scripts/prepare-closure.mjs <change-id> --apply
```

**Everything that could block is decided before anything runs**, the dry run included. The
ownership check covers the whole candidate — what is committed against the base *and* what is
uncommitted in the work tree, with a rename counted at **both** ends, since its source is a path
this change is removing. An occupied archive slot is found in the same preflight. A preparation
that writes and then refuses is worse than one that refuses.

**And the consolidation command is held to the same ownership.** Running a command the project
supplied is not approving whatever it writes. Afterwards the **whole** candidate is recomputed —
`base..HEAD` as it stands now, plus what is uncommitted — because a command that *commits* its
trespass would otherwise empty the only list being read. If anything is outside the change's
declared paths, the preparation refuses, archives nothing, and writes no manifest. What the
command wrote, or committed, is left exactly where it is: removing it automatically would
destroy work nobody chose to destroy.

It validates the proposal against the deltas on disk and the change's ownership, runs **the
project's own** consolidation command, archives the change folder, records the deferrals the
change is leaving behind, and writes one manifest at `.spectree/closure/<change-id>.json`:

| Field | What it pins |
|---|---|
| `manifest_version` | the preparation contract this was written under (**2.0.0**) |
| `change_id`, `base_revision` | which change, against which immutable base |
| `generation` | raised by every reopening |
| `preparation_id` | this snapshot, collision-resistant, named by the approval |
| `preparation_digest` | identity + contract + candidate + base + archive + the whole artifact inventory |
| `contract_digest` | the Requirements it consolidated |
| `candidate_digest` | the content it prepared — computed after the writes |
| `archive_path` | where the folder went, or a **declared** reason there is none |
| `artifacts` | what it produced, each with its own git blob |
| `consolidation` | which command produced it, and how it exited |
| `commands` | what it ran, and how each exited |
| `blocking` | what stops integration |
| `deferred` | what is being carried forward, not paid |

A new identity is reserved per WRITE, not per change: a first preparation, a stale re-preparation
and a reopening each get one, a refresh gets its own, and only a resume keeps the identity its
interrupted operation reserved. Reusing it across a re-preparation left one immutable reference
designating two documents — the projection said one thing and the snapshot it names said another.

`preparation_digest` deliberately **excludes** timestamps and display text, so the same
preparation run a minute later is the same preparation. It deliberately **includes** the artifact
inventory, which is the half content and contract never had — and the half an approval that named
only those two kept matching across a reopening that replaced exactly that record.

The current file at `.spectree/closure/<id>.json` is a projection. The immutable snapshot lives
at `.spectree/closure/<id>/<preparation_id>.json`, and a reopening keeps the approved one beside
it, **byte for byte**: a re-serialised document preserves the meaning and loses the document, and
what a retired approval was granted over is the document.

The manifest lives under `.spectree/`, which every digest already excludes, so it is never part
of the candidate it describes.

It is **idempotent** for the same contract and candidate (a second `--apply` reports
`unchanged`). A manifest belonging to another change (`E_PREP_COLLISION`), written under another
contract version (`E_PREP_CONTRACT_VERSION`), or missing the fields it is read for
(`E_PREP_MALFORMED`) is **refused without being overwritten**, `--apply` included: whatever it
records is the only account of that preparation, and the run that refuses it is not the run that
gets to destroy it. Both halves are enforced — the writer refuses to overwrite, and the gate
refuses to read, because matching digests on a document written in another dialect is a
coincidence and not agreement.

A **stale** manifest is different in kind — same change, same contract version, content that
moved — and re-preparing it with `--apply` is exactly the intended repair (`E_PREP_STALE`).

And a third state sits between those two. The preparation can still be valid — same contract,
same candidate — while the RECORD of what it produced falls behind it: ticking a box in
`tasks.md` changes a prepared artifact without moving either digest. Re-running `--apply` then
reports **`refreshed`**: only the artifact record is brought up to date, no consolidation is
re-run, no folder is moved, and because neither digest moves, **nothing that was proven about
them is invalidated**. Progress is not scope, and it is not a candidate either — the alternative
was a confirmation that refused an artifact for being exactly as it should be.

Two things bound that refresh, and without either one it becomes a way of erasing the record it
exists to maintain.

It reads the folder the manifest **names** (`archive_path`), never one recomputed from today's
date — the archive slot is `<YYYY-MM-DD>-<change-id>`, so anything deriving it from the clock is
asking about a different folder the moment midnight passes. A resumption the next day found
nothing there and wrote an **empty** artifact list over the real one. A location that is gone, or
that the record cannot name, is refused (`E_PREP_MISSING`, `E_PREP_MALFORMED`): an empty list is
not a safe default, it is the confirmation after the merge losing everything it had to compare
against.

And the record **freezes** (`E_PREP_FROZEN`). Before the integration approval, a ticked box is
progress and the record catching up is maintenance. After it, that same write updates the
reference using the very thing it exists to compare against — a merge that altered a prepared
artifact was refused, refreshed, then accepted, with the tool having erased its own evidence.
The digests stay separate either way, so a checkbox still never invalidates a QA pass.

**Frozen is a property of the record, not of a code path.** It holds when an integration approval
names exactly what the manifest records — so every route that would replace it is refused, before
the consolidation runs and before anything is written: the refresh, a `stale` re-preparation, and
a run where the manifest was deleted while its approval stayed on record. Attached to the refresh
alone it was walked around in four commands: move the code so the preparation reads `stale`,
re-prepare (which rewrites the artifact list from whatever is on disk), restore the code,
re-prepare again — same digests, same approvals, substituted record.

Replacing an approved record is done deliberately, and it costs the approval:

```bash
node scripts/prepare-closure.mjs <change-id> --apply --reopen --reason "<why>"
```

The reopening keeps the approved manifest at `.spectree/closure/<id>.superseded.<stamp>.json`,
records `closure_reopened` with the reason in the trail, and lists the approvals it retired in
the new manifest's `supersedes_approval`. A substituted record does not inherit the approval of
the one it replaced, so **a new integration approval is required**.

**Retired means retired on every path**, and that is one shared rule (`approvalsInForce`) rather
than a filter each command writes for itself — the preparation's freeze, the state machine's
gates, `resume` and the confirmation after the merge all read approvals through it. Written as a
local filter it held in the confirmation and nowhere else: `post-merge` refused a reopened
closure while `state.mjs transition` walked the same change to `integrated` on the strength of
the approval the reopening had retired. A retired approval is **not deleted** — it stays in the
store and in the trail, and `resume` lists it under `approvals_retired`, separately from the ones
in force. It stops being authority, not history.

**An archived folder is not proof**: the folder says a move happened; only the
manifest says what was true when it happened.

`pass2_complete` and `integration_approved` require a preparation that covers the candidate, so pass 2
attacks what will be integrated and a late document never pays for a second attack. A fix after preparation
invalidates it, and so does a Requirement added afterwards — the same rule that already
invalidates a QA pass, for the same reason.

A fix does not make the next round attack the whole change again. Each round is recorded with
what it attacked, bound to the bytes, and the next round reads what moved since:

```bash
node scripts/work.mjs start <change> <op> --phase pass2 --task <ref> --next <action>   # before the dispatch
node scripts/work.mjs finish <change> <op> --result <envelope.json> --next <action>   # its duration and usage
node scripts/mutation-probe.mjs <plan.json> --apply > .spectree/pass2/<change>-probe.json
node scripts/pass2.mjs record <change> <report.json> --operation <op>   # before any repair; {"attacked": [...], "mutation_report": "..."}
node scripts/pass2.mjs scope <change>   # files to attack, mutants carried and to rerun, past rounds' time and tokens
```

The record is advisory: `pass2.attack` and `mutation.killed` are still observed on the whole current
candidate. The probe output is saved under `.spectree/`, because a report inside the tree would move
the content it measured. Tokens come only from the agent envelope; without them they stay unknown.

### The integration approval

It names three things now, and `record-approval` refuses one that does not:

```json
{
  "gate": "integration",
  "scope_digest": "<state.mjs digest <id> --gate integration>",
  "preparation": { "preparation_id": "…", "generation": 1, "preparation_digest": "sha256:…" },
  "integration_target": { "repository": "owner/name", "pr": 21, "head_sha": "…", "base_branch": "main" }
}
```

The preparation reference is read off the current snapshot; the target is the integration being
authorised. Nothing there grants anything — `granted_by` is the claim about a human, and the CLI
records it rather than making it. What the references buy is that a merge is confirmed against
**the PR that was approved**, never against any PR whose merged tree happens to match.

### Recovery

Every closure write records its phase before its effects: `intent`, `started`, `observed`,
`persisting`, `done`. An interrupted run is therefore a state rather than a silence — `resume`
prints the phase and the recovery, and the gates refuse to authorise over a set nobody finished
applying.

Every state named has a command that acts on it, because a message recommending a recovery the
tool does not implement is worse than no message:

| Phase | What happened | What finishes it |
|---|---|---|
| `intent` | nothing ran | re-run the command |
| `started` | the command was launched, its result never observed | **a person decides** (below) |
| `observed` | the result is recorded, nothing persisted | `--apply --resume` |
| `persisting` | persistence stopped part way | `--apply --resume` |

`--resume` finishes the operation that was reserved — the same `preparation_id`, the same
generation — and it does **not** run the consolidation again: the result is already on record, and
re-running it would make a recovery an execution. It is routed by the operation's **kind**, before
any ordinary shortcut: a refresh interrupted at `persisting` is finished, not answered by a run
that reserves a second refresh and refuses its own predecessor; and `unchanged` — which is a
statement about content — never stands in for "the operation finished", which is how a prepare
that had written its projection reported success with the operation still open and no event in the
trail.

**And it is bound to what the interrupted command ran against.** The operation records its inputs
before the command (the contract, the candidate, the declared consolidation command) and the
contract identity it observed after it. A resume compares the disk against those:

| Drift | What happens |
|---|---|
| the contract moved while the operation was stopped | `E_RESUME_INPUTS_CHANGED`, nothing written, the command **not** re-run |
| what the command **produced** moved | the same — the delta untouched and the living spec replaced is the half a contract comparison cannot see |
| the project changed `closure.consolidate` | the same |
| the operation carries no recorded observation | `E_RESUME_NO_OBSERVATION` — nothing invents one |

The result's identity is the candidate digest taken **after** the command, so a consolidation that
legitimately rewrites its own output on the first run is recorded as it actually ended, while the
archive, the trail and administrative progress sit outside that digest by construction and do not
read as drift.

Putting the drift back the way it was makes the operation resumable again: the refusal was about
the difference, not a door that closed. And the comparison is on the **declared** command, not the
substituted one — `{change_dir}` resolves differently once the folder is archived, which this very
operation does.

`started` is the one phase nothing resolves on its own, because whether the command ran is
genuinely unknown — and it carries no consolidation result, which is exactly what `started` means.
Where a person resolves it, their decision becomes a record with its own provenance
(`consolidation.source: "operator_decision"`, carrying the reason), never an `observed_execution`.
A default PASS in that slot would be the tool asserting the observation nobody made.

Two explicit answers exist and both are recorded in the trail:

```bash
node scripts/prepare-closure.mjs <id> --apply --resume --consolidation-ran --reason "<what you checked>"
node scripts/prepare-closure.mjs <id> --apply --abandon --reason "<why>"
```

A refusal in the preflight guarantees nothing was run and nothing was written. That guarantee
does **not** extend to a command the project supplied and this squad launched: what it wrote, or
committed, is preserved and reported — including by `--abandon` — because removing it
automatically would destroy work nobody chose to destroy.

A lock is broken only when its owner can be identified and is demonstrably gone, and the breaking
is announced. Never for being old: a slow consolidation is not an abandoned one.

### Applying a plan against the world it was computed in

Every write reserves against the closure control revision behind its decision. A dry run returns
that revision as `expected_control_revision`, and:

```bash
node scripts/prepare-closure.mjs <id> --apply --expect-control <revision>
```

applies the plan under it. An approval, a refresh or a reopening landing in between makes the
reservation fail with `E_CONCURRENT_UPDATE` — nothing runs, nothing is written. This is what makes
the boundary transactional rather than merely locked: a lock taken at write time does not make a
decision taken before it fresh, and that is exactly how a refresh came to overwrite a record that
had been approved a moment earlier.

Recording an integration approval is one transaction for the same reason: the durable entry and
the document are written inside a single critical section, control first, reserved against the
revision of the read that **validated the preparation** — not a newer read taken just before the
write, which would reserve against a world the decision never saw. A crash between the two leaves
no authority in either direction: an approval file with no control entry is **not** authority, and
a control entry naming a file that is not there authorises nothing.

**A state transition writes inside that boundary too.** Lock order is closure lifecycle, then
change, everywhere. Re-reading close to the write is not the same thing: a reopening that returns
a change to the state it was already in does not move `state_revision`, so the change store's own
check saw nothing, and a transition decided before that reopening landed on top of an operation
that was still running.

### A project with no consolidation mechanism

Declare the command once:

```bash
node scripts/state.mjs init <project-id> -- npm run spec:merge
```

Options of `init` (`--repository`, `--ci-workflow`, `--delivery`…) go before `--`. Everything
after it is the command, argument by argument, and `init` reads none of it as its own option.

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

Finite and no more: read the merge result, confirm the PR and its base branch, confirm the
integrated content **is** the authorised candidate, check the jobs the policy required, confirm
the prepared artifacts are there **unchanged and alone**, write the receipt, close.

**The receipt is what makes `integrated` and `closed` reachable at all.** It records the
repository, the PR, the head, the base branch, the merge commit, the preparation and its digest,
the approval, the contract and candidate digests, and each workflow run with its attempt and jobs,
plus the moment they were observed.

Every one of those is **required**, and structure is checked before any comparison. A record that
carried four true keys — change, generation, preparation and version — and nothing else used to
authorise `integrated` with no merge, no PR, no run and no approval anywhere, because the check
compared only the fields its caller had assembled. Each run is identified as well: workflow, id,
attempt, conclusion. `runs: [{}]` satisfied "a non-empty list" and said nothing about any run.

The expectation is built **once**, by `integrationExpectation`, from the approved reference — the
preparation, the EXACT approval in force over it, and the control's pointer — and every gate reads
that one object. Which approval that is never comes from position in a list: the confirmation hands
over the one it selected against every criterion, and a gate resolves the one the receipt names.
Two approvals over the same preparation authorising different PRs used to make the confirmation
find the right one and then check the receipt against whichever came first on disk — a false
negative with an exact answer available. Where nothing disambiguates, `E_APPROVAL_AMBIGUOUS` says
so instead of choosing. Assembling it field by field at each call site is how the final gate came to
compare the change, the generation and the preparation while never comparing the repository, the
PR, the head or the candidate digest. It is deliberately **not** built from the local checkout:
which candidate was observed is a question the approved reference answers.

It is also checked against the closure control, by a digest of the **whole receipt**: a pointer
that agreed on the merge commit and the generation agreed on two fields out of fifteen, and every
other binding could be rewritten underneath it. A `legacy` closure carries fewer fields and **says
so on the change** — an absence of the v2 fields is never read as a declaration of legacy. The state machine requires it, so a
`state transition <id> integrated` on its own is refused with `E_INTEGRATION_NOT_OBSERVED` —
which is the defect it exists for: the confirmation refused a reopened closure while a plain
transition walked the same change to `integrated` on an approval that had been retired.

A receipt is an observation about ONE merge of ONE preparation under ONE approval. After a
reopening it stops covering, and a historical receipt is never a claim that a later re-run of the
CI is green: a contradicting observation is reported, and it does not erase the closure that was
recorded.

**Every question is asked of the merge commit's tree, never of the local checkout.** The checkout
is whatever the operator happens to have; a confirmation that trusts it will close a change over
a tree nobody approved. So:

- the **code** digest comes from `git ls-tree` at the merge commit;
- the **contract** does too. `docs/changes/` is outside the code digest by design, so a merge
  that quietly rewrote a proposal moves nothing the code comparison can see;
- the prepared artifacts are compared **by content** in the merge — existence was the weakest
  question that could be asked about them;
- the prepared artifacts are compared against the frozen inventory in **four** directions:
  missing, altered content, altered **mode or type**, and **added**. The addition was invisible
  because the comparison walked the record; the mode was invisible because the record held only a
  blob — and an archived file is outside the code digest and outside the contract digest, so
  `100644` becoming `100755` with the same blob had nothing anywhere to catch it. A tree that
  cannot be listed is **unknown**, and unknown is not an empty tree;
- **one** approval must satisfy every criterion: it names this contract, this tree, this
  preparation and this PR, *and* it was granted at a commit inside this merge. Letting one
  approval supply the content match and another the ancestry means the order of files on disk
  decides the verdict.

### Asking GitHub by identity

Every query is scoped server-side rather than filtered afterwards. `--repo` on everything;
`gh run list --commit --event --branch --workflow`; then `gh run view` for that run's jobs. A
list of the fifty most recent runs of the whole repository, filtered locally, meant that fifty
runs belonging to other changes hid the one being asked about — and an answer that is missing
because the question was too broad is not "it did not run". A full page is reported as
**incomplete**, and incomplete is never green.

The run that speaks is the **latest** run of that workflow on that commit, at its **latest
attempt**. The order of a response is not a decision, and an older attempt that had been green is
not evidence about the re-run that replaced it.

A project declares its CI as an identity:

```json
"ci": {
  "version": 2,
  "required_runs": {
    "full": { "workflow": "check", "jobs": ["classify", "plugin"], "event": "push", "branch": "main" }
  }
}
```

A bare legacy list of names is accepted only while it resolves to exactly one; two or more is
`E_CI_MAP_AMBIGUOUS` and asks for migration, because a run title, a job name and a workflow
identity are three different things. An empty required set is `E_CHECK_SET_EMPTY` — a policy that
asks for nothing cannot certify anything — and a *required* job that was skipped is a refusal.

On the green path nothing downloads a log; the confirmation reports its own counts
(`gh_calls`, `git_calls_here`, `elapsed_ms`, `log_bytes`) so the cost is measured rather than
asserted.

If the merge commit is not here, that is an impediment: fetch it before confirming something you
cannot see.

It is **resumable**. The remaining transitions are computed from the state on disk, so a rerun
after a crash — or after success — repeats no event and refuses nothing that already happened.

### Mapping the policy onto your CI

`gh` reports **workflow runs** (`workflowName: "check"`); the policy speaks in check names.
Nothing bridges those by guessing, so the project declares it:

```json
{ "ci": { "required_runs": ["check"] } }
```

or one list per treatment (`{"full": [...], "documented_closure": [...]}`). A project that has
not declared it gets `E_CI_MAP_MISSING` — a check nobody mapped is a check nobody observed, and
unknown is never permission. Runs are matched to the **merge commit's SHA**: a green run on
another commit says nothing about this one.

It is not a place for an architecture review, a rewrite of the roles, a recount of the backlog,
an investigation into an auxiliary tool, or an opportunistic fix. A real failure stops the
closure and produces an impediment — a short confirmation that hides one is worse than a long
one. Deploy stays a separate decision and a separate gate.

## After `closed`: the retro is owed

A closed change is not the end of the work: it owes its retro, and the runtime keeps the debt
visible instead of trusting someone to remember it.

```bash
node scripts/retro.mjs collect <pr> --apply                     # measured signals -> .spectree/retros/
node scripts/retro.mjs trends                                   # which findings came back, which went quiet
# write docs/retros/<date>-<change>.md: "Change: `<change>`" and "## What was read"
node scripts/state.mjs run <change> retro.recorded --role invoker -- \
  node scripts/retro.mjs check <change> docs/retros/<date>-<change>.md
```

Until `retro.recorded` is an observed PASS, `state.mjs plan` answers `record_retro` for the closed
change (and, with nothing open, plans that change by itself), and `state.mjs open` refuses the next
change with `E_RETRO_PENDING`. The check observes a file that names its change and says what was
read; the judgement inside it stays the Invoker's. Only a person skips it, with
`--retro-waived "<reason>"` on the change that opens, and that change keeps the waiver and the
names of the changes it covers.

`retro.mjs trends [--dir docs/retros]` reads the retros already written and groups their findings
by signature, oldest retro first. `recurring` lists signatures seen in two or more retros that no
index marks paid and that have not gone quiet; `quiet` lists open ones no retro has named in the last three. When the retros
directory has a `README.md` with a `| R-NNN | signature | … | situation |` table, the status comes
from there, by id or by signature; without one it stays unknown, and unknown is never paid. The Solutions Architect reads
it before a proposal.

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

The policy is reusable (`scripts/lib/evidence/ci-policy.mjs`) and this delivery changes **no consumer's
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

## Migrating a consumer's closure records

Installing updates code. Rewriting a project's records is a different act with a different blast
radius, so the installer carries the migration and never runs it:

```bash
node .spectree/squad/scripts/migrate-closure.mjs            # plan only, writes nothing
node .spectree/squad/scripts/migrate-closure.mjs --apply
```

It is idempotent. A v1 record is preserved **byte for byte** as history and never becomes an
approved v2 preparation: a v1 record names no preparation, so no approval on record can be shown
to have been granted over it, and inventing that link would be the tool manufacturing an
authorisation nobody gave. Those changes are reported as needing a fresh preparation and a fresh
integration approval. A corrupt record stops the migration rather than being migrated by
guessing, and a control that exists and cannot be read blocks the gates until it is recovered —
reading it as "nothing was ever retired" is exactly the substitution the record exists to refuse.

## What is measured, and what is refused

`contentDigest` speaks about files. A symlink is stored by git as its target string, so hashing
one silently compares a pointer with a file; a junction on Windows has no honest reading at all;
and an index with unmerged paths has more than one version of a path, so "the content" is not yet
a question with an answer. All three are refused by name rather than hashed into a number nobody
can reproduce. Support for them is not a correction to make quietly — it would be a new capability.
