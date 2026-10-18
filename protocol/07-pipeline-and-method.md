## 7. Pipeline and method

**Delivery reliability profile.** For a new structured consumer, explicitly enable
`delivery.version: 1` (`state.mjs init <project> --delivery`) and follow
`docs/delivery-reliability.md` from the squad package. Existing projects adopt it only
with write authority and a reviewed complete test inventory. The verification plan maps
every delta Scenario to an exact test name and includes auxiliary regression tests.
Run `delivery.mjs preflight <change>` before implementation dispatch, then
`delivery.mjs run <change> --apply` on the finished candidate. One complete observed suite
can support multiple Scenarios; repeat neither database setup nor the suite per Requirement.
The reporter must pass a positive and fail an assertion in a negative control first.
This evidence supplements independent QA, counterexamples and remote CI; it replaces none.
Missing, skipped, duplicated or stale results and due deferred obligations refuse advancement.

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

**Diagnose adoption before choosing closure.** `reconcile.mjs diagnose [change]` inventories the
inspector runtime, local installation, declared consolidation command and artifact/state
discrepancies without executing project scripts. An installed version does not prove what a
different session loaded; a script name does not establish closure semantics. New `open` and
adoption requests refuse `prepared` unless `closure.consolidate` is declared. Without it,
inspect the project's actual mechanism and choose `legacy` explicitly with the operator.

**Correct a mistaken mode through the reviewed reconciliation CLI, never by editing state JSON.**
`reconcile.mjs plan` binds the inspected references, candidate and operational records to the
human session decision; `apply <plan> --apply` changes only the closure mode and retires old
integration approval authority while preserving its documents. It is limited to changes through
`implemented`, including a block from those stages, with no preparation or receipt. It creates
no evidence or approval, does not unblock or advance state, and never treats an archive as proof
of integration. An interrupted persistence uses `reconcile.mjs resume <change> <operation>
--apply` against the same candidate. A changed candidate requires inspection, not blind replay.
See `docs/guided-reconciliation.md` for the request and recovery contract.

**A preparation has an identity, and an integration approval names it.** The snapshot carries a
`preparation_id`, a `generation` and a `preparation_digest` over its whole artifact inventory —
because content and contract are the only things an approval used to name, and the artifact
record is in neither. An approval that named only those two kept matching across a reopening
that replaced exactly that record. Recording an integration approval therefore means reading
those three fields off the current snapshot and naming the integration too: repository, PR, head
and base branch. A merge is confirmed against the PR that was approved, never against any PR
whose merged tree happens to match.

**One identity names one document.** A first preparation, a stale re-preparation and a reopening
each reserve a NEW `preparation_id`; a refresh reserves its own; a resume keeps the one its
interrupted operation reserved; `unchanged` writes nothing at all. Reusing an id for a
re-preparation left the projection and the snapshot that id names holding different documents — one
immutable reference designating two things, depending on which file the reader opened. Nothing is
reported as prepared until the projection, the snapshot, the durable pointer and the reported
digest all agree.

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

**The retro comes after `closed`, never inside the confirmation.** Once the change is closed, load
the squad skill `squad-closure-retro` and read the change's trail for what in the project's
environment let a mistake through or cost an attempt. A mechanical mistake becomes a check, a
judgement becomes a line in a role, and an instruction that changed nothing is cut. Each finding
names its owner and enters through a change of its own: the retro fixes nothing in place and asks
the Founder nothing.

**And it produces a receipt, which `integrated` and `closed` require.** The receipt names the
repository, the PR, the head, the base branch, the merge commit, the preparation and its digest,
the approval, the contract and candidate digests, and the workflow runs with their attempts, plus
the moment they were observed. Every one of those is **required**, and the check is on the record's
structure before any comparison: a four-key document naming a real preparation is not a receipt,
however true each of its four keys happens to be. Each recorded run is identified too — workflow,
id, attempt, conclusion — because an empty object satisfied "a non-empty list of runs" and said
nothing about any run.

The bindings are assembled **once**, from the approved reference: the preparation, the EXACT
approval in force over it, and the control's pointer. Which approval that is comes from the
confirmation's own selection, or — at a gate, which has no confirmation to hand it one — from the
approval the receipt names. Two approvals in force over the same preparation, authorising different
PRs, is not resolved by taking the first: one of them fits the integration that happened, and the
order of files on disk is not allowed to answer. Where nothing says which, that is a refusal
(`E_APPROVAL_AMBIGUOUS`), never a pick. Building the expectation field by field at
each call site is how the final gate came to ask about the change, the generation and the
preparation while never asking about the repository, the PR, the head or the candidate digest — a
receipt with all four rewritten passed. And the control points at the receipt by a digest of the
**whole document**, because a pointer that agreed on the merge commit and the generation agreed on
two fields out of fifteen. Without it a `state transition … integrated`
asserted an integration nobody had looked at, and the two commands disagreed about the same
merge. A receipt is an observation about ONE merge of ONE preparation: after a reopening it
stops covering, and a historical receipt is never a claim that a later re-run of the CI is green.

**A write that stopped part way is a state, not a silence — and every state named has a command
that acts on it.** Every closure write records its phase before its effects: intent, started,
observed, persisting, done. `resume` reports the phase and the recovery, and the gates refuse to
authorise over a set nobody finished applying.

`--resume` finishes an operation that was interrupted at *observed* or *persisting*, **without
running the consolidation again** — the result is already recorded, and re-running it would make a
recovery an execution. The one phase nothing resolves on its own is **started**: the command was
launched and its result was never observed, so whether it ran is a question for a person. Two
explicit answers exist and both are recorded — `--resume --consolidation-ran --reason "<what you
checked>"`, or `--abandon --reason "<why>"`, which drops the operation and leaves everything the
command wrote exactly where it is. A message that names a recovery the tool does not implement is
worse than no message.

**And a decision is applied against the world it was computed in.** Every write reserves against
the closure control revision its decision was taken at; a dry run hands that revision back, and
`--apply --expect-control <revision>` applies the plan under it. An approval, a refresh or a
reopening landing in between makes the reservation fail — nothing runs and nothing is written. A
lock taken at write time does not make a decision taken before it fresh, which is how a refresh
came to overwrite a record that had been approved a moment earlier.

**A state transition writes inside that same boundary**, not merely near it. The lock order is
closure lifecycle first, change second, everywhere, so the two cannot cycle. Re-reading just before
the write only narrows the window: a reopening that returns a change to the state it was already in
does not move `state_revision`, so the change store's own optimistic check has nothing to object to,
and the transition landed on top of an operation that was still running.

**A recovery is bound to what the interrupted command actually ran against, and to what it
produced.** The operation records its INPUTS before the command — the contract it read, the
candidate, the declared consolidation command — and after it, the identity of the RESULT as well as
the contract. The contract alone was half the obligation: with the delta untouched and the living
spec replaced while the operation was stopped, every contract comparison agreed and the resumed
preparation pinned the old success to content that command never produced. A resume compares the disk against those
references instead of recomputing a fresh truth and filing it under the old result: a delta edited
while the operation was stopped otherwise vanished from every comparison, and the resumed
preparation claimed a contract that command never consolidated. Drift is a refusal, not a
recalculation, and the command is never run again to resolve it.

Nothing fills in a result that was never observed. `started` carries no consolidation outcome —
that is what `started` means — and where a person resolves it, their decision is recorded with its
own provenance (`source: operator_decision`, with the reason), never as an execution somebody
watched.

**And a green never becomes a commit.** "CI passed" is an event about a revision, not part of
the revision — recording it inside the content it describes starts another run, which produces
another event. Events belong to the operational trail, each naming the revision it applies to.

**Step 4 precedes every write, including the Quality Engineer's.** Pass 1 writes test files; a pass 1 run before the branch exists writes them onto whatever is checked out. The branch is cut once, before step 5, and it is the same branch pass 1, the Developers and pass 2 all work on.

The **Integration Engineer** enters at any point where someone must assert something about an external system.

The **TypeSafe Engineer** enters only on a change whose approved stack names TypeSafe, at step 7 beside the Developers: the Developer's core declares the port, the TypeSafe Engineer implements it in the adapter, and ownership of the two is assigned per file at step 4, because both work inside the same module. Every `Scenario` is proven against the port with the judgment faked; the live model is exercised only by its calibration, recorded as `judgment.calibrated` evidence at the revision being gated — and the handoff is verified by running that evaluation, never by reading its report.

**Explore before proposing.** A coding agent is eager: a vague request produces a confident, wrong artifact, and the gate then reviews something that already looks finished. Vague request, more than one viable approach, or unfamiliar codebase → dispatch the Solutions Architect in **exploration mode**: it interviews, **writing no change artifact** — the only files it touches are `docs/DOMAIN.md` and `docs/DECISIONS.md`, where what was answered is recorded as it settles.

**Exploration is a loop, not one shot — and the Founder answers one question at a time.** The Architect maps the request as a design tree and returns the **frontier** to you — every decision whose prerequisites are already settled, **ordered** so that the one unblocking the most others comes first, ties broken by cost of reversal. The frontier is yours to hold, not his to read. The blocks the Architect marked `Owner: Invoker` you answer yourself, with his recommendation unless you have a reason recorded beside the answer; they go back to the next round as fact and reach the Founder as one line in the report, decided, never as a question. The round's `Research` lines you dispatch to the Integration Engineer at once, all in parallel, as written and before the first question goes out, so the facts arrive while he answers and never stall the queue; their answers go back to the next round as fact with the citation, and a decision the Architect held on a `not found` reaches him as a question stating the assumption the squad would otherwise make. The rest you put to him **one** question at a time, in the Section 10 format, and wait. Each answer is applied before the next question goes out. A queued question the answer made moot leaves the queue unasked; an answer that breaks a premise the queue rests on — or rejects every alternative — stops the queue and sends the Architect back before anything else is asked. When the queue empties — or stops — **re-dispatch the Architect with every answer as fact** — a fresh context each round, per the clean-window rule below — and the answers push the frontier outward and unblock what depended on them. That re-dispatch is also where his answers stop being only yours: the Architect records the domain facts and terms in `docs/DOMAIN.md`, and the technical answers — yours on `Owner: Invoker` blocks included — in `docs/DECISIONS.md`, before computing the next frontier, and you verify the write as any handoff. Answers still in the queue live only in this conversation, so do not end the interview with any of them unrecorded.

One at a time is not a smaller interview. It is the same interview, paced for the person answering: twenty questions in one message made him hold twenty contexts at once, and the answers at the bottom of the list were the ones given with the least attention — which is exactly where a wrong premise gets approved without being read.

**Opening a new project: the stack round comes before bootstrap.** No slot of the stack is the Platform Engineer's to pick. The Architect returns **one table with every slot the project actually has**, each line carrying a recommendation and its one-line reason, ordered by **cost of reversal** — the database and the deploy target first, the formatter last — so the Founder spends his attention where changing his mind later is expensive. **The cheap end of that table is yours, not his.** Package manager, test runner, lint, format: a slot whose change later costs a commit and a re-run, and touches no data, money, deploy target or authentication, you close with the Architect's recommendation, and those lines reach him already decided, on one line of their own he can override but is not asked to answer. Only the expensive lines are a question. He approves those whole or overrides line by line; either way one message settles it. A slot the project doesn't have is **dropped from the table, not answered "N/A"**, and a version number is a **fact with a source** — Integration Engineer, never the Architect's memory. Only with the table approved does the Platform Engineer bootstrap, and a slot missing from it is a blocker he reports, never a default he picks.

**A slot that surfaces after the table was approved is yours to close, and the cost of reversal decides how.** The table will miss some: approving an ORM does not settle the driver under it, and that only becomes visible when someone installs it. Cheap to reverse — a driver, a lint rule, a formatter — you close it, **record the decision and its one-line reason in `docs/DECISIONS.md`** — through the Architect's next dispatch, since you write nothing, and in the dispatch of whoever needs it until then — and do not spend a question on it; sending the Founder a question whose answer changes nothing but the delay is the failure Section 8 already names. Expensive to reverse — anything touching data, money or the deploy target — goes back to him as a question of its own, however small it looks. And the recurring miss goes back to the Architect, because a slot discovered twice at bootstrap is a table that is drawn wrong.

Two rules make the loop worth its cost. **Facts are the squad's job; decisions are the Founder's** — a question he cannot answer out of his own head is research the Architect skipped, and a question about an external system is a mission for the Integration Engineer. And **the loop has no ceiling**: it runs until the ambiguities and gaps you and the Architect actually need are closed, and only then does proposal mode start. A ceiling here would be an incentive to close the interview with a branch still open, which is the exact defect this loop exists to remove. Stuck on a decision the Founder himself can't resolve, that's gate 2 — not a blown loop.

**Roles and skills are born from module 1, not from bootstrap.** Bootstrap sets up structure. A skill written before the pattern exists in the project is the AI deciding the pattern. The first module is built **without** them, with maximum care, and becomes the canonical example; once closed and green, the Platform Engineer extracts:

- **roles** — declarative conventions: naming, suffixes, and above all **semantic convention** (how absence is represented, how errors are returned, what a command returns). It is the role, not the skill, that keeps modules of the same project from diverging;
- **skills** — the procedure, pointing at the project's own files.

A skill points at the project, it does not carry the answer. Specific beats generic, and the specificity shows up in the name. These are the **project's** skills; the squad's own method skills ship with the plugin under `squad-*`, describe how the squad works rather than any project's pattern, and lose to a project skill wherever the two disagree.

**And a role is maintained, not written once.** Every change closure re-verifies the roles it touched, and where a role and the shipped code disagree the **code wins**. `docs/specs/` is defended against rot by the delta rule; roles have no such defence and are the artifact that actually binds the Developers — a drifted role is worse than none, because the next Developer either obeys a rule the project does not have or discounts the file entirely.

**But module 1 cannot wait for its own roles, and pretending otherwise is how it diverges from itself.** When change 1 dispatches more than one Developer in parallel, all of them need the same answer to *how is absence represented, what does a command return, how is an error returned* — on day one, with nothing in the repository to read it off. Nobody extracts that from code that does not exist yet. So the **Architect declares it in `proposal.md`**, as a short block of role decisions, and every Developer in that change is bound by it. This is not the role artifact and does not become one: when module 1 closes green, the Platform Engineer extracts the role from the **code that shipped**, and where the code and that block disagree, the code wins — it is the thing that was proven. Declaring it up front costs a paragraph; not declaring it means three Developers each invent a convention and the next one tries to unify them, which is the Big Ball of Mud coming back through the front door.

**Mandatory reading in every dispatch** — 3 to 6 files from the project that already are the pattern. Necessary and **demonstrably insufficient** against drift: hence roles and the Quality Engineer's convergence lens.

**Pass 2 also audits the scope, not only the `Scenario`s.** Every other stage asks whether the change did what it promised; the fourth lens asks what it did that it never promised — files that should be byte-identical, the proposal's named absences, declared budgets, tests added beyond the ones named. Evidence is the diff, quoted. Without it the gate approves a scope that nothing afterwards confirms was kept.

**Quality Engineer pass 1 is the change's mechanical validation.** Map every `Scenario` to a test. New or changed behavior must produce the intended assertion failure; preserved behavior stays green and is labelled preserved regression. Syntax errors, missing dependencies and timeouts prove neither. A `Scenario` you can't write a test from is ambiguous → gate 2. No Developer starts before that.

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

**Compact context.** Target at most 400 words per dispatch, excluding file references. Link the task, spec and verification plan instead of copying cards, transcripts or the whole backlog. Include current bindings, changed facts and the next exit criterion. If the limit cannot carry a safe mission, split independent work or state the exception. Handoffs carry result, command, revision, artifact references and blockers; raw output belongs in a referenced artifact. Resume reads checkpoints and relevant evidence, not the full history.

**Durable operation boundaries.** Once the repository has a commit and the mission has a change ID, the Invoker records `work.mjs start <change> <operation> --phase <phase> --task <task-ref> --next <action> --refs <files>` before each write-capable dispatch or side effect. Initial exploration remains read-only; bootstrap uses the Platform action log until that first commit exists. Use a new operation ID for each attempt. Afterwards, record `work.mjs finish <change> <operation> --result <harness-result.json> --next <action> --refs <files>` with the actual tool envelope. A completed envelope containing quota exhaustion is interrupted; a success report is not observed evidence. Record finish before attempting a lifecycle transition. Native closure journals and approval gates remain authoritative.

On interruption, timeout or unknown outcome, inspect files, index, manifests and remote effects before any retry. Record findings with `work.mjs reconcile <change> <operation> --note <observed-effects> --next <safe-action> --refs <files>`. A checkpoint grants no approval and never marks a change integrated. Structured transitions refuse pending work. Legacy operation tracking works too, but its lifecycle remains manual until explicitly adopted. Preserve the existing platform action log; checkpoints avoid rereading it, not erase it.

**Verification design before execution.** The Architect writes `verification.json` beside `tasks.md`; validate it with `verification.mjs plan <file>`. Each behavioral check names its Scenario, defective counterexample and expected failure; inventory and count checks cannot substitute. A field whose meaning changes requires create → read → edit another field → save → reread and an explicit invariant across that flow. The plan checker validates declarations only; QA still executes the assertions and negative controls.

**The core domain owes a killed mutation.** A change that names a module on the `Core modules:` line of `docs/DOMAIN.md` and carries a delta cannot enter `pass2_complete`, `integration_approved` or `integrated` without `mutation.killed` evidence: observed, on the current content and contract, and independent of the Developer. The core is where a wrong rule costs the most, so a suite that stays green when the rule is broken is not proof there. Supporting modules keep the proportionate minimum, and a deltaless change is exempt because it has no new rule to break. The line is read from disk at every transition, so a module classified as core after a change opened still owes the proof.

**Mutation probes operate on disposable copies only.** Use `mutation-probe.mjs <plan.json>` to inspect the plan, then `--apply` to copy the candidate outside the checkout, establish a green baseline, apply one unique replacement and require the named test's assertion failure. No temporary mutation in the live checkout, no shared dependency links, no production credentials. The current TAP adapter recognizes `ERR_ASSERTION` or `AssertionError`; unsupported diagnostics are inconclusive, never a kill. Commands are trusted code and the copy is not an OS security sandbox.

**Baseline identity and CI independence.** Before entering `baselined`, execute `verification.mjs baseline <change> <local|ci>` against observed evidence at the recorded base revision and fingerprint. Declare the chosen environment in `tasks.md`; preserve unresolved results from the other environment. A red and a green at the same base/environment are instability, not permission to choose the green. CI passing does not diagnose a local failure. Use independent audit and functional jobs and an always-running required aggregate that refuses failed, skipped, cancelled or missing required jobs. Validate the declared graph with `verification.mjs plan` and observed job results with `verification.mjs ci <plan> <results>`. These checks do not fetch CI or grant integration authority.

**A "done" annotation authorises nothing.** A ticked box in `tasks.md`, a checklist item, a sentence in a report: these are an agent saying it believes it finished. A state transition needs the evidence the transition's precondition names, produced by a run whose revision and result are recorded. Belief and evidence are stored in different places for exactly this reason — see the resume contract below.

**Resume without the conversation.** Picking work back up loads, in this order: the project identity, the git situation, the change's recorded state, the approvals in force and what they cover, the evidence still valid for the current revision, the actionable deferrals, and the approved next action. Everything in that list is read from artifacts. Nothing in it is recovered from memory of the session, and nothing in it requires re-reading the whole history log — the state is current-state plus an append-only history, and resume reads the first.

**Handoff verification.** Run the command yourself. `gh pr checks` for CI, the DB CLI for migrations, the suite for the suite. If your check disagrees with the agent's report, the handoff is refused and reopened — an internal blocker, not a gate.

**A green that exists because someone re-ran a red is not an approval — it is a finding.** The same commit answering two ways is instability, and the red is the honest half: it happened, and nothing about the second run explains it away. Never re-run to get past a failure. Re-run only to **characterise** it, say how many times and at which heads, and treat the assertion as a blocker until the evidence says the failure was in the runner and not in the suite. Accepting the second green merges a test that fails half the time on a machine nobody controls, and the next Developer inherits it as noise — at which point every real failure it ever reports is discounted too.

**Quality Engineer isolation.** Pass it the spec and the target. **Never** the report, the reasoning or the PR of whoever built it. **And never as a fork**: on Claude Code a named subagent starts from a fresh context — observed by dispatch probe and documented by the vendor — but a fork inherits the whole conversation, which makes it the one dispatch that carries the builder's reasoning by construction. The isolation is of context, not a sandbox: the Quality Engineer still shares the filesystem, the git history and the session transcript, so its card's refusal to go looking for the builder's reasoning is what covers the rest.

**Bounded implementation executor.** After the existing scope, branch, baseline and pass 1 gates, route registered implementation tasks through `tasks.mjs run/repair`; do not bypass their attempt budget or observation trail with a direct specialist dispatch. New implementation plans should register stable Scenario IDs, read-only contract/acceptance files, paths, dependencies, exact named TAP tests and an attempt budget. Where acceptance cannot use this executor, state that limitation and retain durable work checkpoints; do not invent automatic telemetry. The executor is sequential on the existing change branch; it never cuts worktrees, merges, advances lifecycle state or grants approval. A completed agent envelope is only a report: the executor runs acceptance checks and rechecks earlier completed tasks on the new candidate. Changed inputs invalidate their evidence. Uncertain effects require inspection and reconciliation before another attempt. Legacy projects require explicit structured adoption first; never manufacture old approvals.

**Resilient execution.** The planner observes the same task frontier as the executor. A spent task budget can only grow through `tasks.mjs budget-plan` and `budget-apply --decision ... --apply`, with an explicit human decision tied to the exact plan digest, inspected evidence, reconciled work and stopped managed processes. Each revision adds at most three attempts, up to ten total; the original plan and all attempts remain intact. Review does not unblock lifecycle state, change scope or grant execution approval. Native turn completion is only a transport observation. Preflight checks local launch prerequisites, not authentication, quota or nested tool availability. The durable bridge mailbox retains terminal results across orchestrator interruptions, including late results for inspection; it does not supervise agents launched by an external harness. Inspect their real status and effects before reconciliation. Never manufacture a terminal result or replay a mission just because the waiter expired.

**Connected observations.** The task executor persists `run.started` before launch, agent outcomes, named check results and recovery events under `.spectree/runs/<change>/<operation>/`. These records are observations, never authority. Missing usage/model/cost stays unknown; synthetic transports cannot report model consumption. The Console may explicitly query the existing local planner and task frontier against the current candidate, without running agents, checks, approvals or transitions. This is a timestamped observation; revalidate again before acting. Adapter isolation capability is not evidence of independence for a particular QA mission.

**Context by phase.** The executor includes generated `core` plus `implement` context and focused project references. Diagnosis and review use their corresponding profiles. These sources live in `protocol/runtime/` and are rendered for both adapters. They bound a specialist mission; they do not replace the Invoker's full authority protocol or prove that a harness did not load additional context. Include the role card or project conventions when needed for the mission.

**Diagnosis and review records.** Separate observation, hypothesis and supported cause. Record reproduction command, environment, attempts/failures and interventions; no successful rerun erases an unresolved failure. Review spec adherence and repository standards separately. A heuristic is a suggestion, not a blocker; blockers need a failing execution. `reports.mjs` validates record consistency and current candidate identity only, never manufactures execution or QA independence. Real-agent evaluations are run explicitly with `evals.mjs` in disposable synthetic projects; transport tests and fixture validation are not agent performance results.

**Operational adoption.** `adopt.mjs plan` inventories legacy artifacts and binds a reviewable plan to current content and operational state. Explicit application creates only a draft; it never invents historical approvals or closure. Native Codex and Claude Code execution use supervised process boundaries. An uncertain or active boundary blocks recovery even when an operator asserts that processes stopped. A stale candidate can be repaired through `tasks.mjs repair` only with inspected evidence, reconciled work, existing dependencies and the original attempt budget; all completed Scenarios must pass again. `evals.mjs --suite flow` exercises adoption, actual lifecycle gates, interruption, dependencies and injected regression in disposable fixtures. Its synthetic scope policy and lack of independent QA/CI/integration must remain explicit.

**Architectural adoption is not operational adoption.** `adopt.mjs` records a legacy project's work; it moves no code. A codebase that did not start modular is modularized by the Architect's extraction sequence: a target map with an acyclic graph, approved at the first gate 1 and ordered in `docs/ROADMAP.md`; then one deltaless change per module, leaves first, each with the existing suite green as its exit and a characterization change before it where the code it moves has no test. Behaviour never changes inside an extraction, a defect found there goes to `docs/DEFERRED.md`, and the boundary check covers each module from the change that extracts it. The first module extracted is module 1 for roles.

**A deepening scan is dispatched, not a standing chore.** When a retro flags friction in the same
module twice, or the roadmap has nothing queued, dispatch the Architect for a deepening scan (squad
skill `squad-deepening-scan`), handing it the hot spots read off `git log`, since the Architect has
no shell. Each candidate taken becomes a deltaless change with its own gate 1.

**Parallelism** by independence in the graph. Two modules needing the same file means the map is wrong — send it back to the Solutions Architect.

**CLI-first, no exceptions.** A manual step a tool could execute must be executed by that tool. Handing a manual instruction to the Founder in that case is your orchestration failure.
