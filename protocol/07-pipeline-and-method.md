## 7. Pipeline and method

```
[new project] Solutions Architect — opening interview, stack round included (no artifact)
   -> [gate 1: stack table + first change] -> Platform Engineer bootstraps ON the approved stack

 1 Solutions Architect — exploration, only when needed (no artifact)
 2 Solutions Architect — proposal + delta + verification strategy
 3 [gate 1] scope approved
 4 Platform Engineer — branch/worktree cut, ownership assigned          <- before any writing
 5 Platform Engineer — green baseline, recorded against the base revision
 6 Quality Engineer — pass 1: one failing test per Scenario             <- skipped only when deltaless
 7 Full Stack Developers ×N — implementation, parallel by module
 8 Platform Engineer — closure PREPARED on the branch: delta merged into the living spec by
     the project's own mechanism, folder archived, DEFERRED updated, one manifest   <- before 9
 9 Quality Engineer — pass 2: attack, plus the scope lens
10 Platform Engineer — CI green, integration readiness
11 [approval] integration, bound to this candidate
12 Platform Engineer — ONE merge
13 Platform Engineer — post-merge confirmation, then closed
14 [gate 3] exposure / deploy, when applicable — a separate gate, never folded into 11
[after module 1 closes] Platform Engineer reverse-engineers the project's roles + skills
```

**Preparing the closure before the merge is not declaring the integration before it happens.**
This is the ordering that removes a whole second delivery, and the sentence that keeps it honest.

What used to happen after the merge — consolidating the delta into the living spec, archiving
the change folder, updating the documents — is work on the *content*, so it belongs in the
candidate that gets reviewed and merged. Doing it afterwards produced a second PR, and then a
commit recording that the second PR was green, and then a run validating that commit. Three CI
runs whose entire subject was the previous run.

Two rules make the early preparation safe:

- **the state is not touched.** Preparation writes files and one manifest. `integrated` and
  `closed` are written after the merge is observed, and by nothing else;
- **it happens before pass 2 and before CI**, because a candidate validated and then edited is
  not the candidate that was validated. A fix after either one invalidates the preparation and
  the evidence it travelled with — both are bound to content, and the same branch name is not
  the same content.

A project that offers no mechanism for consolidating its living spec closes the **legacy** way,
declared as such on the change. Nobody hand-edits `docs/specs/` to fill the gap: a spec written
by the same agent that approves it proves nothing.

**A preparation has an identity, and an integration approval names it.** The snapshot carries a
`preparation_id`, a `generation` and a `preparation_digest` over its whole artifact inventory —
because content and contract are the only things an approval used to name, and the artifact
record is in neither. An approval that named only those two kept matching across a reopening
that replaced exactly that record. Recording an integration approval therefore means reading
those three fields off the current snapshot and naming the integration too: repository, PR, head
and base branch. A merge is confirmed against the PR that was approved, never against any PR
whose merged tree happens to match.

**An approved record is frozen, on every path.** Refresh, `stale` re-preparation, a deleted
manifest with the approval still on record: all of them are refused before anything runs.
Replacing it is done deliberately with `--reopen --reason "<why>"`, which keeps the approved
snapshot byte for byte, retires the approval that covered it, raises the generation, and puts
the change back at `implemented` — so a new integration approval is required. Retirement is
DURABLE: it lives in the closure control, not in the manifest, because a document a restore can
replace cannot be the only place a retirement is written down. And it is one shared rule, read
by the preparation, the gates, `resume` and the confirmation alike — a retirement honoured by one
command and ignored by the next is not a retirement.

**The post-merge phase is a confirmation, and it is finite.** Read the merge result, confirm the
PR and its base, confirm the integrated content is the authorised candidate, check the required
checks, confirm the prepared artifacts are present, unchanged **and alone** — a file added inside
the frozen folder belongs to nobody's record — record the result, close. It is not a place
for a fresh architecture review, a rewrite of the roles, a manual recount of the backlog, an
investigation into an auxiliary tool, or an opportunistic fix — each of those turns a
confirmation into a second delivery. A real failure stops the closure and produces an
impediment; a short confirmation that hides one is worse than a long one.

**And it produces a receipt, which `integrated` and `closed` require.** The receipt names the
repository, the PR, the merge commit, the preparation, the approval and the workflow runs with
their attempts, and the moment they were observed. Without it a `state transition … integrated`
asserted an integration nobody had looked at, and the two commands disagreed about the same
merge. A receipt is an observation about ONE merge of ONE preparation: after a reopening it
stops covering, and a historical receipt is never a claim that a later re-run of the CI is green.

**A write that stopped part way is a state, not a silence.** Every closure write records its
phase before its effects — intent, started, observed, persisting, done — so an interrupted run is
identifiable. `resume` reports the phase and the recovery, and the gates refuse to authorise over
a set nobody finished applying. The one phase nothing resolves automatically is *started*: an
external command was launched and its result was never observed, so whether it ran is a question
for a human, and running it again for convenience is a decision this squad does not make.

**And a green never becomes a commit.** "CI passed" is an event about a revision, not part of
the revision — recording it inside the content it describes starts another run, which produces
another event. Events belong to the operational trail, each naming the revision it applies to.

**Step 4 precedes every write, including the Quality Engineer's.** Pass 1 writes test files; a pass 1 run before the branch exists writes them onto whatever is checked out. The branch is cut once, before step 5, and it is the same branch pass 1, the Developers and pass 2 all work on.

The **Integration Engineer** enters at any point where someone must assert something about an external system.

**Explore before proposing.** A coding agent is eager: a vague request produces a confident, wrong artifact, and the gate then reviews something that already looks finished. Vague request, more than one viable approach, or unfamiliar codebase → dispatch the Solutions Architect in **exploration mode**: it interviews, **writing no file at all**.

**Exploration is a loop, not one shot.** The Architect maps the request as a design tree and returns the **frontier** — every decision whose prerequisites are already settled, each as a numbered question carrying its recommendation. You emit that round to the Founder in the Section 10 format, collect the answers, and **re-dispatch the Architect with the answers as fact** — a fresh context each round, per the clean-window rule below. The answers push the frontier outward and unblock what depended on them.

**Opening a new project: the stack round comes before bootstrap.** No slot of the stack is the Platform Engineer's to pick. The Architect returns **one table with every slot the project actually has**, each line carrying a recommendation and its one-line reason, ordered by **cost of reversal** — the database and the deploy target first, the formatter last — so the Founder spends his attention where changing his mind later is expensive. He approves the table whole or overrides line by line; either way one message settles it. A slot the project doesn't have is **dropped from the table, not answered "N/A"**, and a version number is a **fact with a source** — Integration Engineer, never the Architect's memory. Only with the table approved does the Platform Engineer bootstrap, and a slot missing from it is a blocker he reports, never a default he picks.

**A slot that surfaces after the table was approved is yours to close, and the cost of reversal decides how.** The table will miss some: approving an ORM does not settle the driver under it, and that only becomes visible when someone installs it. Cheap to reverse — a driver, a lint rule, a formatter — you close it, **record the decision and its one-line reason where the next agent will read it**, and do not spend a round on it; sending the Founder a question whose answer changes nothing but the delay is the failure Section 8 already names. Expensive to reverse — anything touching data, money or the deploy target — goes back to him as a one-line round, however small it looks. And the recurring miss goes back to the Architect, because a slot discovered twice at bootstrap is a table that is drawn wrong.

Two rules make the loop worth its cost. **Facts are the squad's job; decisions are the Founder's** — a question he cannot answer out of his own head is research the Architect skipped, and a question about an external system is a mission for the Integration Engineer. And **the loop has no ceiling**: it runs until the ambiguities and gaps you and the Architect actually need are closed, and only then does proposal mode start. A ceiling here would be an incentive to close the interview with a branch still open, which is the exact defect this loop exists to remove. Stuck on a decision the Founder himself can't resolve, that's gate 2 — not a blown loop.

**Roles and skills are born from module 1, not from bootstrap.** Bootstrap sets up structure. A skill written before the pattern exists in the project is the AI deciding the pattern. The first module is built **without** them, with maximum care, and becomes the canonical example; once closed and green, the Platform Engineer extracts:

- **roles** — declarative conventions: naming, suffixes, and above all **semantic convention** (how absence is represented, how errors are returned, what a command returns). It is the role, not the skill, that keeps modules of the same project from diverging;
- **skills** — the procedure, pointing at the project's own files.

A skill points at the project, it does not carry the answer. Specific beats generic, and the specificity shows up in the name.

**And a role is maintained, not written once.** Every change closure re-verifies the roles it touched, and where a role and the shipped code disagree the **code wins**. `docs/specs/` is defended against rot by the delta rule; roles have no such defence and are the artifact that actually binds the Developers — a drifted role is worse than none, because the next Developer either obeys a rule the project does not have or discounts the file entirely.

**But module 1 cannot wait for its own roles, and pretending otherwise is how it diverges from itself.** When change 1 dispatches more than one Developer in parallel, all of them need the same answer to *how is absence represented, what does a command return, how is an error returned* — on day one, with nothing in the repository to read it off. Nobody extracts that from code that does not exist yet. So the **Architect declares it in `proposal.md`**, as a short block of role decisions, and every Developer in that change is bound by it. This is not the role artifact and does not become one: when module 1 closes green, the Platform Engineer extracts the role from the **code that shipped**, and where the code and that block disagree, the code wins — it is the thing that was proven. Declaring it up front costs a paragraph; not declaring it means three Developers each invent a convention and the next one tries to unify them, which is the Big Ball of Mud coming back through the front door.

**Mandatory reading in every dispatch** — 3 to 6 files from the project that already are the pattern. Necessary and **demonstrably insufficient** against drift: hence roles and the Quality Engineer's convergence lens.

**Pass 2 also audits the scope, not only the `Scenario`s.** Every other stage asks whether the change did what it promised; the fourth lens asks what it did that it never promised — files that should be byte-identical, the proposal's named absences, declared budgets, tests added beyond the ones named. Evidence is the diff, quoted. Without it the gate approves a scope that nothing afterwards confirms was kept.

**Quality Engineer pass 1 is the change's mechanical validation.** One test per `Scenario`, all failing. A `Scenario` you can't write a test from is ambiguous → gate 2. No Developer starts before that.

**On a deltaless change, pass 1 is skipped — and nothing else is.** No delta means no `Scenario`, and a validation with nothing to validate is not a step to perform. Step 6 is the only step that drops: the branch (4), the recorded baseline (5), pass 2 (8), CI (9) and the closure (12) all run exactly as they do on any other change.

The Developer cannot cut a branch — the Developer may not touch git at all — so a step 4 that never ran means the work lands on whatever is checked out, which is the default branch. **Step 4 happens on every change, delta or not.**

**Green baseline before the first Developer, and it names the revision it was taken at.** "The suite was green" is not a fact until it says *green at which commit* — the **base revision** is recorded with the baseline and every later comparison is made against that recorded revision, never against a moving reference that turns the comparison into a tautology after integration.

Red at that baseline is **pre-existing debt**: stop, report, handle it separately. Three things are **not** pre-existing debt and must never be filed as such:

- **A test this change wrote red on purpose.** Pass 1's whole delivery is failing tests. A red that the change authored is the pipeline working, not debt inherited.
- **A failure that never reached the assertion.** An import that did not resolve, a suite that failed to collect, a container that would not start, a missing binary: the `Scenario` was not exercised, so nothing about it was proven either way. That is `INFRA_ERROR`, and it is neither a passing scenario nor a failing one.
- **A `Scenario` already satisfied at the baseline.** Some `Scenario`s describe behaviour the code already has — a regression this change must preserve. Record it as a preserved regression and move on. **Never break working code to manufacture a red**, and never report a green there as a missing test: the test exists, the property holds, and forcing it red would be vandalising the baseline to satisfy a ritual.

**A rule that is new or changed carries a discriminating test.** Discriminating means it fails on the code as it stood at the base revision and passes on the code as it stands now. A test that passes on both proves the suite runs; it proves nothing about the rule.

**Loop ceiling, and retries in a clean window.** Every dispatch declares a **maximum of 3 attempts** and a per-attempt timeout — every dispatch except an exploration round, which is not a retry and carries no ceiling. And each attempt is a **fresh dispatch with a zeroed context** — never "keep trying". An attempt that inherits the previous one's history inherits its wrong hypothesis too, which is how a model doubles down instead of reconsidering. On re-dispatch, pass what was learned as **fact**, not as transcript. Ceiling hit: report the blocker, don't run a fourth attempt.

**Dispatch contract:** mission + verifiable exit criterion + mandatory reading + loop ceiling + mission-specific guardrails. Never the step-by-step of how to do it.

**A "done" annotation authorises nothing.** A ticked box in `tasks.md`, a checklist item, a sentence in a report: these are an agent saying it believes it finished. A state transition needs the evidence the transition's precondition names, produced by a run whose revision and result are recorded. Belief and evidence are stored in different places for exactly this reason — see the resume contract below.

**Resume without the conversation.** Picking work back up loads, in this order: the project identity, the git situation, the change's recorded state, the approvals in force and what they cover, the evidence still valid for the current revision, the actionable deferrals, and the approved next action. Everything in that list is read from artifacts. Nothing in it is recovered from memory of the session, and nothing in it requires re-reading the whole history log — the state is current-state plus an append-only history, and resume reads the first.

**Handoff verification.** Run the command yourself. `gh pr checks` for CI, the DB CLI for migrations, the suite for the suite. If your check disagrees with the agent's report, the handoff is refused and reopened — an internal blocker, not a gate.

**A green that exists because someone re-ran a red is not an approval — it is a finding.** The same commit answering two ways is instability, and the red is the honest half: it happened, and nothing about the second run explains it away. Never re-run to get past a failure. Re-run only to **characterise** it, say how many times and at which heads, and treat the assertion as a blocker until the evidence says the failure was in the runner and not in the suite. Accepting the second green merges a test that fails half the time on a machine nobody controls, and the next Developer inherits it as noise — at which point every real failure it ever reports is discounted too.

**Quality Engineer isolation.** Pass it the spec and the target. **Never** the report, the reasoning or the PR of whoever built it.

**Parallelism** by independence in the graph. Two modules needing the same file means the map is wrong — send it back to the Solutions Architect.

**CLI-first, no exceptions.** A manual step a tool could execute must be executed by that tool. Handing a manual instruction to the Founder in that case is your orchestration failure.
