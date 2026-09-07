## 6. Artifacts — living spec, change as delta

```
docs/
  specs/<module>/spec.md          <- current truth. NOBODY edits it by hand.
  changes/<slug>/
    proposal.md | specs/<module>/spec.md (delta only) | tasks.md
  changes/archive/<YYYY-MM-DD>-<slug>/
  DEFERRED.md                     <- what was seen, decided and left out. Outlives the change.
  ROADMAP.md                      <- the sequencing the Founder already approved. Never scope, never dates.
```

**`DEFERRED.md` is the ledger of what a change saw and deliberately did not do**, and it is not the same list as a proposal's named absences. Those are **scope** — what this change does not contain — and they die with the change that declared them. This file carries what is **not** feature scope: the ceiling nobody has hit yet, the defect found in passing that belongs to its own change, the thing that is safe today and stops being safe the day the product is reachable. A named absence answers "why isn't this in here"; a deferral answers "who owes this, and when does it come due".

Three rules make it a ledger instead of a graveyard. **Numbers are stable** — never reused, never renumbered, because the log, the proposals and the archive cite them. **A closed item keeps its number and is struck through with what closed it**, so the file records that the debt was paid rather than quietly losing it. And **every closure writes a status line saying what that change owed and did not pay** — without it, deferring is free, and free deferral is how a list of forty things becomes a list nobody reads. Each item names its owner: the Architect, the Platform Engineer, a change of its own, or the first deploy.

**`ROADMAP.md` records sequencing the Founder has already approved**, and exists because that decision is otherwise the only one he makes that never becomes an artifact — the order survives the conversation and every reason for it does not. It is emphatically **not scope** (each change still faces its own gate 1, from its own proposal), **not a date** (the order is the claim; the calendar is not), and **not the living spec** (that says what is true today; this says what is agreed to come next). The Architect owns it, writing from the Invoker's report of the round — the Invoker still writes nothing.

**A spec domain is a module, always 1:1.** Never a spec per layer (`auth-backend`), per component (`auth-user-menu`), per use case (`authenticate-user-usecase`) or per setup task (`monorepo-bootstrap`). **Setup tasks get no spec** — no externally observable behaviour, so no test can ever fail because of them; they live in `tasks.md` and die there.

**The change carries the delta.** `## ADDED` / `## MODIFIED` / `## REMOVED` / `## RENAMED Requirements`.

**`RENAMED` exists because a rename has no other honest spelling.** Expressed as `REMOVED` plus `ADDED`, a renamed `Requirement` reads in the archive as one requirement retired and an unrelated one invented on the same day — its `Scenario`s look new, its history ends, and nobody a year later can tell that the rule never changed. `RENAMED` carries the old name and the new one and nothing else; the operations apply in the order `RENAMED` → `REMOVED` → `MODIFIED` → `ADDED`, so anything else in the same delta lands on the name the requirement now has.

**`proposal.md` names the modules that will carry a delta, and that list is a contract.** The set of modules named there and the set of `specs/<module>/spec.md` files present must be **the same set** — a module named with no delta is work that was planned and silently dropped; a delta for a module nobody named is scope that entered without passing gate 1. Neither is visible to anyone reading only one of the two files, and both are one comparison away from being caught at closure.

**A `MODIFIED` block carries the whole Requirement as it will read afterwards, every kept `Scenario` included — never only the part that changed.** The merge replaces the Requirement wholesale, so a `Scenario` the block omits is a `Scenario` deleted from the living spec, silently, by an author who meant to leave it alone. The cost is real — most of a `MODIFIED` block is text identical to what is already there — and it is paid on purpose: the alternative is a merge that has to guess what "unchanged" meant.

**That same comparison is the only thing that catches two changes colliding.** Change A closes and adds a `Scenario` to a Requirement; change B's `MODIFIED` for that Requirement was written before A landed and does not have it. Git sees no conflict — the deltas are different files in different change folders — and the merge quietly reverts A. Checking every `MODIFIED` against the **current** living spec catches both failures with one comparison, and the two are told apart by their fix: a `Scenario` the author forgot goes back into the block; a `Scenario` that appeared after the delta was written means the delta is stale and the Architect re-derives it against the spec as it stands now.

**A change that changes no behaviour carries no delta, and that is a valid change.** Converging two modules onto one convention, moving a type to where it belongs, replacing an implementation behind an unchanged contract: nothing externally observable moves, so no `Requirement` is born and there is nothing to write. It still runs as a change — folder, `proposal.md`, `tasks.md`, gate 1 on the scope — because it is still a Developer editing code, and code entering the repository through any other door is how a project acquires edits nobody approved.

**And it says so out loud: `proposal.md` declares the change deltaless, in as many words.** Without the declaration, a change with no `specs/` folder is indistinguishable from one where the Architect simply forgot to write the delta — same empty folder, same silence, opposite meanings — and the closure has no way to tell which it is holding. The declaration turns an absence into an assertion someone made and can be held to. Its mirror is a rejection: a change that declares itself deltaless **and** ships delta files is a contradiction, refused at closure, because whichever half is true the other half was written without meaning it.

The exit criterion is **the existing suite green** — and the second half of it is a judgement, not a file-name match.

An edited test is **not** proof that behaviour changed: an import moves, a fixture grows a field, a file is renamed, and the assertion still asserts the same property. What is disqualifying is an expectation **weakened** — loosened, skipped, deleted, or rewritten to match what the code now does. So a test file in the diff of a deltaless change is a **question**, answered by reading each edit and saying why it was needed; a weakened expectation is the wrong kind of change and goes back to the Architect.

And the mirror, which is the easier mistake to make: **untouched tests do not demonstrate equivalence either.** They show the suite was not adjusted. Behaviour nothing ever covered can move underneath a green suite without a single test noticing, so the verification is proportionate to what the refactor touched, not satisfied by the absence of an edit.

```markdown
### Requirement: Account rejects empty name
The system SHALL reject account creation with an empty or blank name.

#### Scenario: Creation with a blank name
- **GIVEN** an authenticated user
- **WHEN** an account is created with an empty `name`
- **THEN** the error `ACCOUNT_NAME_REQUIRED` is returned
```

Drafting rules, all checkable by reading:

- **RFC 2119** — `MUST`/`SHALL` non-negotiable, `SHOULD` a recommendation with justifiable exceptions, `MAY` genuinely optional. **One `SHALL` per Requirement**; an "and also" clause means two requirements.
- **Observability test** — *could a tester who has never seen the code tell whether it passed?* `THEN a Result.ok wrapping the User is returned` fails; `THEN the error USER_NOT_FOUND is returned` passes.
- **Errors are codes, not messages.** `INVALID_AMOUNT`, never "Invalid amount".
- **A `Requirement` states what is true, never what changed.** "The system SHALL **now also** accept…" is correct on the day of the delta and wrong forever after; the living spec accumulates that phrasing until it reads as a changelog. The operation is named by the delta's section header; the `Requirement` carries only the rule.
- **These rules were written to be counted, so count them.** One `SHALL` per `Requirement`, at least one `Scenario` under each, no path or library in the text — every one is a count or a pattern, and the closure script checks them so that a rule does not hold only while someone is paying attention.
- **Every `Scenario` is a test**, and a single one only covers the happy path — the edge case is mandatory. A `Scenario` asserting **derived state** carries `GIVEN`/`THEN` with no `WHEN` — the value is a function of the state, and there is no action to name.
- **Content boundary, in the delta AND at merge** — no file name, path, internal class, framework, library or step-by-step. Criterion: *if the implementation can change without changing externally visible behaviour, it does not belong in the spec.* The Platform Engineer refuses to merge a delta that violates this — the living spec **accumulates**, and a contaminated delta today is a spec that goes stale with every refactor.
- **Per-module vocabulary**, plus the rule that runs against instinct: **the same name meaning different things in different modules is correct**. Without a declared vocabulary each Developer invents their own and the next one tries to unify — unifying is the Big Ball of Mud coming back.
- **No backfilling.** `docs/specs/` grows only through closed deltas. A spec for code nobody is changing rots and starts lying.
- **Size** — one logical unit of work per change. Split when the intent changes, the scope explodes, or the original part can close on its own.
