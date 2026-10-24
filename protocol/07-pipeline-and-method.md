## 7. Pipeline and method

```
[new project] Solutions Architect — opening interview, stack round included (no artifact)
   -> [gate 1: stack table + first change] -> Platform Engineer bootstraps ON the approved stack

 1 Solutions Architect — exploration, only when needed (no change artifact)
 2 Solutions Architect — proposal + delta + verification strategy
 3 [gate 1] scope approved
 4 Platform Engineer — branch/worktree cut, ownership assigned          <- before any writing
 5 Platform Engineer — green baseline, recorded against the base revision
 6 Quality Engineer — pass 1: new behavior red, preserved behavior green <- skipped only when deltaless
 7 Full Stack Developers ×N — implementation, parallel by module
 8 Platform Engineer — closure PREPARED on the branch: delta merged into the living spec by
     the project's own mechanism, folder archived, DEFERRED updated, one manifest   <- before 9
 9 Quality Engineer — pass 2: attack, plus the scope lens
10 Platform Engineer — CI green, integration readiness
11 [approval] integration, bound to this candidate
12 Platform Engineer — ONE merge
13 Platform Engineer — post-merge confirmation, then closed
14 [gate 3] exposure / deploy, when applicable — a separate gate, never folded into 11
[after closed] Invoker — closure retro: findings recorded, never fixed in place
[after module 1 closes] Platform Engineer reverse-engineers the project's roles + skills
```

The reason behind each rule below, and the incident that produced it, is in {{RATIONALE_LOCATION}}. Read it when a rule does not plainly settle a case; the rule as written here is what binds.

### 7.1 Before the build

**Explore before proposing.** Vague request, more than one viable approach, or unfamiliar codebase → the Solutions Architect in **exploration mode**, **writing no change artifact**; it touches only `docs/DOMAIN.md` and `docs/DECISIONS.md`.

**Exploration is a loop, not one shot — and the Founder answers one question at a time.** The Architect returns the **frontier**, ordered by what unblocks most, then by cost of reversal. You hold it:
- blocks marked `Owner: Invoker` you answer yourself, with the Architect's recommendation unless you record a reason; they reach the Founder as one decided line;
- the round's `Research` lines you dispatch to the Integration Engineer at once, all in parallel, before the first question; a decision held on a `not found` reaches him stating the assumption the squad would make;
- the rest go to him **one** question at a time (Section 10). Apply each answer before the next; drop questions it made moot; an answer that breaks a premise or rejects every alternative stops the queue and sends the Architect back;
- when the queue empties or stops, **re-dispatch the Architect with every answer as fact**, fresh context. It records them in `docs/DOMAIN.md` and `docs/DECISIONS.md` before the next frontier; verify the write, and do not end the interview with any of them unrecorded.

**Facts are the squad's job; decisions are the Founder's.** A question about an external system is the Integration Engineer's. The loop has no ceiling; proposal mode starts only when the gaps are closed. A decision the Founder cannot resolve is gate 2.

**Opening a new project: the stack round comes before bootstrap.** The Architect returns **one table with every slot the project actually has**, recommended and ordered by **cost of reversal**. **The cheap end of that table is yours, not his**: what touches no data, money, deploy target or authentication you close, on one decided line he may override; only the expensive lines are a question. Absent slots are **dropped, not answered "N/A"**; a version is a **fact with a source**; no bootstrap before approval, and a missing slot is a blocker, never a default.

**A slot that surfaces after the table was approved is yours to close, and the cost of reversal decides how.** Cheap: close it and **record the decision and its one-line reason in `docs/DECISIONS.md`** through the Architect. Expensive (data, money, deploy target): a question of its own.

**Roles and skills are born from module 1, not from bootstrap.** Once module 1 closes green, the Platform Engineer extracts **roles** (naming and **semantic convention**: absence, errors, what a command returns) and **skills** (procedure pointing at the project's files). A project skill beats a squad skill (`squad-*`).

**And a role is maintained, not written once.** Every closure re-verifies the roles it touched; where role and code disagree, the **code wins**.

**But module 1 cannot wait for its own roles, and pretending otherwise is how it diverges from itself.** With more than one Developer on change 1, the **Architect declares the semantic convention in `proposal.md`**, binding them all, until the role is extracted from the code.

**Architectural adoption is not operational adoption.** `adopt.mjs` moves no code. Modularizing is the Architect's extraction sequence: an acyclic target map approved at gate 1, then one deltaless change per module, leaves first, a characterization change before any untested code moves. The first module extracted is module 1 for roles.

**A deepening scan is dispatched, not a standing chore.** When a retro flags the same module twice, or the roadmap is empty, the Architect runs squad skill `squad-deepening-scan` on hot spots from `git log`; each candidate taken is a deltaless change.

**Verification design before execution.** The Architect writes `verification.json` beside `tasks.md`, validated with `verification.mjs plan <file>`; each behavioral check names its Scenario, a defective counterexample and the expected failure.

**One suite run serves every check, never one run per Requirement.** `verification.mjs checks <plan> <report>` judges every check's named `tests` from one TAP run, archived changes too.

**Delivery reliability profile.** New consumers enable `delivery.version: 1` (`docs/delivery-reliability.md`): Scenarios mapped to exact test names, `delivery.mjs preflight` before implementation, `delivery.mjs run --apply` on the candidate. It supplements QA and CI; missing, skipped, duplicated or stale results and due deferrals refuse advancement.

### 7.2 Building

**Step 4 precedes every write, including the Quality Engineer's.** One branch, cut before step 5, on every change; pass 1, the Developers and pass 2 all work on it.

**Green baseline before the first Developer, and it names the revision it was taken at.** Every later comparison is against that **base revision**. Red there is **pre-existing debt**: stop, report, handle separately. Not debt:
- **A test this change wrote red on purpose.**
- **A failure that never reached the assertion.** That is `INFRA_ERROR`, neither pass nor fail.
- **A `Scenario` already satisfied at the baseline.** A preserved regression. **Never break working code to manufacture a red.**

**Baseline identity and CI independence.** Before `baselined`, run `verification.mjs baseline <change> <local|ci>` at the base revision and declare the environment in `tasks.md`. A red and a green at the same base are instability, never a choice of the green. CI has independent audit and functional jobs under an always-running required aggregate, checked with `verification.mjs ci <plan> <results>`.

**Quality Engineer pass 1 is the change's mechanical validation.** Every `Scenario` maps to a test; new behavior fails on the intended assertion, preserved behavior stays green; an untestable `Scenario` is gate 2. No Developer starts before it but the surface's.

**A `Scenario` that calls what does not exist yet gets a surface first.** One Developer, an ordinary dispatch, writes only the published exports and signatures, bodies returning `NOT_IMPLEMENTED`, no table, no test; exit: typecheck, lint and guards green. Pass 1 runs on it with `--expect-from`, every red at its assertion.

**On a deltaless change, pass 1 is skipped — and nothing else is.**

**A rule that is new or changed carries a discriminating test.** It fails at the base revision and passes now.

**Quality Engineer isolation.** Pass it the spec and the target, **never** the builder's report, reasoning or PR, **and never as a fork**.

**The TypeSafe Engineer** works at step 7 only when the stack names TypeSafe, implementing the adapter behind the core's port; `Scenario`s are proven with the judgment faked, and the live model runs only in its calibration, recorded as `judgment.calibrated` at the gated revision. The **Integration Engineer** enters wherever an external system must be asserted.

**Pass 2 also audits the scope, not only the `Scenario`s.** What it did that it never promised — byte-identical files, named absences, budgets — quoted from the diff.

**The core domain owes a killed mutation.** A delta on a module of the `Core modules:` line of `docs/DOMAIN.md` needs `mutation.killed` evidence, observed on the current content and independent of the Developer, before `pass2_complete` or any later state.

**Mutation probes operate on disposable copies only.** Never in the live checkout or with production credentials (`mutation-probe.mjs <plan> --apply`); an unrecognized diagnostic is inconclusive, never a kill.

### 7.3 Dispatch

**Dispatch contract:** mission + verifiable exit criterion + mandatory reading + loop ceiling + mission-specific guardrails. Never the step-by-step of how to do it.

**Mandatory reading in every dispatch** — 3 to 6 project files that already are the pattern; necessary and **demonstrably insufficient** against drift.

**Compact context.** At most 400 words per dispatch, linking task, spec and plan; handoffs carry result, command, revision, references and blockers.

**Loop ceiling, and retries in a clean window.** Every dispatch but an exploration round has a **maximum of 3 attempts** and a timeout; each attempt is a **fresh dispatch with a zeroed context**, carrying what was learned as **fact**. Ceiling hit: report the blocker.

**Parallelism** by independence in the graph. Two modules needing the same file means the map is wrong.

**Bounded implementation executor.** After pass 1, implementation tasks go through `tasks.mjs run/repair`, never a direct dispatch around their budget and trail. It never merges, advances state or grants approval, and uncertain effects need inspection first.

**Resilient execution.** A spent budget grows only through `tasks.mjs budget-plan` and `budget-apply`, on a human decision bound to the plan digest. Never manufacture a terminal result or replay a mission because a waiter expired.

**Connected observations.** Run records are observations, never authority; missing usage or cost stays unknown.

**Context by phase.** Phase profiles from `protocol/runtime/` bound a mission and replace nothing here.

**Diagnosis and review records.** Separate observation, hypothesis and cause; a blocker needs a failing execution.

**Operational adoption.** `adopt.mjs` creates only a draft, never historical approvals; an uncertain process boundary blocks recovery whatever an operator asserts.

**Durable operation boundaries.** Once there is a commit and a change ID, `work.mjs start <change> <operation>` before each write-capable dispatch or side effect and `work.mjs finish` with the real envelope before any transition; on an unknown outcome, inspect the effects, then `work.mjs reconcile`. Quota exhaustion in a completed envelope is an interruption; a checkpoint grants nothing.

### 7.4 Verifying and closing

**Handoff verification.** Run the command yourself — `gh pr checks`, the DB CLI, the suite. A disagreement with the agent's report refuses the handoff.

**A green that exists because someone re-ran a red is not an approval — it is a finding.** Re-run only to **characterise** a failure; the assertion stays a blocker until the evidence puts the fault in the runner.

**A "done" annotation authorises nothing.** A transition needs the evidence its precondition names, from a run with recorded revision and result.

**Resume without the conversation.** Load from artifacts: identity, git, recorded state, approvals in force, evidence valid now, deferrals due, the approved next action.

**Preparing the closure before the merge is not declaring the integration before it happens.** Consolidation, archive and document updates travel in the candidate. Two rules:
- **the state is not touched.** `integrated` and `closed` are written after the merge is observed, and by nothing else;
- **it happens before pass 2 and before CI**; a later fix invalidates the preparation and its evidence.

Without a consolidation mechanism the change closes the **legacy** way, declared on it; nobody hand-edits `docs/specs/`.

**Diagnose adoption before choosing closure.** `reconcile.mjs diagnose`; `prepared` needs `closure.consolidate` declared.

**Correct a mistaken mode through the reviewed reconciliation CLI, never by editing state JSON.** `reconcile.mjs plan`, then `apply <plan> --apply` (`docs/guided-reconciliation.md`).

**A preparation has an identity, and an integration approval names it.** The approval names the snapshot's `preparation_id`, `generation` and `preparation_digest`, plus repository, PR, head and base branch. A merge is confirmed against the PR approved.

**One identity names one document.** Every preparation, re-preparation and reopening reserves a new `preparation_id`.

**An approved record is frozen, on every path.** Replacing it takes `--reopen --reason "<why>"`, which retires the approval and returns the change to `implemented`.

**A write that stopped part way is a state, not a silence — and every state named has a command that acts on it.** `--resume` finishes *observed* or *persisting* without re-running the command; at *started* a person decides, with `--consolidation-ran` or `--abandon` and a reason.

**A recovery is bound to what the interrupted command actually ran against, and to what it produced.** Drift is a refusal, never a recalculation or a re-run. A person's resolution is recorded as `source: operator_decision`, never as an observed execution.

**And a decision is applied against the world it was computed in.** `--apply --expect-control <revision>` applies a plan under the revision it was computed at.

**A state transition writes inside that same boundary**: closure lifecycle lock first, change second.

**The post-merge phase is a confirmation, and it is finite.** Confirm the PR, base, authorised candidate, required checks and the prepared artifacts present, unchanged **and alone**; record; close. Never a review or an opportunistic fix.

**And it produces a receipt, which `integrated` and `closed` require.** Every field is required, bound to the exact approval in force, pointed at by a digest of the **whole document**, covering one merge of one preparation.

**And a green never becomes a commit.** "CI passed" is an event in the operational trail, naming its revision.

**The retro comes after `closed`, never inside the confirmation.** Then load the squad skill `squad-closure-retro`; each finding names its owner and enters through a change of its own, nothing fixed in place.

**CLI-first, no exceptions.** A step a tool could execute, the tool executes. A step that is human by nature reaches him as one command to run: the Platform Engineer's wizard (squad skill `squad-human-step-wizard`).
