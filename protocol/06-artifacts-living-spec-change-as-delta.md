## 6. Artifacts — living spec, change as delta

```
docs/
  specs/<module>/spec.md          <- current truth. NOBODY edits it by hand.
  changes/<slug>/
    proposal.md | specs/<module>/spec.md (delta only) | tasks.md
  changes/archive/<YYYY-MM-DD>-<slug>/
  DEFERRED.md                     <- what was seen, decided and left out. Outlives the change.
  ROADMAP.md                      <- the sequencing the Founder already approved. Never scope, never dates.
  DOMAIN.md                       <- the business: subdomains, core domain, their language, settled domain facts with their source.
  DECISIONS.md                    <- how it is built: the approved stack and every technical decision taken outside a proposal.
```

**`DEFERRED.md` is the ledger of what a change saw and deliberately did not do** — not a proposal's named absences, which are scope and die with their change. **Numbers are stable**, never reused or renumbered. **A closed item keeps its number and is struck through with what closed it.** **Every closure writes a status line saying what that change owed and did not pay.** Each item names its owner.

**`ROADMAP.md` records sequencing the Founder has already approved.** It is **not scope** (each change still faces its own gate 1 unless the Founder marked its item `policy: scope`, Section 8), **not a date**, and **not the living spec**.

**`DOMAIN.md` is the project's memory of the business**, so a domain fact the Founder settled once is never asked again. It holds the product and its users; the subdomains, with the module serving each and the core ones on a `Core modules:` line the runtime reads; each subdomain's **language** (term, definition, words to avoid); and every settled fact with its source. It is **not the living spec**, **not scope**, and **not `PRODUCT.md`**.

**`DECISIONS.md` is the project's memory of how it is built**: the approved stack with the alternatives turned down, every slot the Invoker closed, every technical answer an exploration settled — numbered, dated, with who decided. An entry is superseded by a new one, never edited. It is **not a proposal**: an irreversible decision of a change stays in its `proposal.md`, where gate 1 approves it.

The Architect owns the roadmap, `DOMAIN.md` and `DECISIONS.md`, writing from the Invoker's report; the Invoker writes nothing.

**A spec domain is a module, always 1:1.** Never a spec per layer, per component, per use case or per setup task. **Setup tasks get no spec**; they live in `tasks.md` and die there.

**The change carries the delta.** `## ADDED` / `## MODIFIED` / `## REMOVED` / `## RENAMED Requirements`.

**`RENAMED` exists because a rename has no other honest spelling.** It carries the old name and the new one and nothing else. Operations apply in the order `RENAMED` → `REMOVED` → `MODIFIED` → `ADDED`.

**`proposal.md` names the modules that will carry a delta, and that list is a contract.** The modules named there and the `specs/<module>/spec.md` files present must be **the same set**.

**A `MODIFIED` block carries the whole Requirement as it will read afterwards, every kept `Scenario` included — never only the part that changed.** The merge replaces the Requirement wholesale.

**That same comparison is the only thing that catches two changes colliding.** Check every `MODIFIED` against the **current** living spec. A `Scenario` the author forgot goes back into the block; a `Scenario` that appeared after the delta was written means the delta is stale, and the Architect re-derives it against the spec as it stands.

**A change that changes no behaviour carries no delta, and that is a valid change.** It still runs as a change — folder, `proposal.md`, `tasks.md`, gate 1 on the scope.

**And it says so out loud: `proposal.md` declares the change deltaless, in as many words.** A change that declares itself deltaless **and** ships delta files is refused at closure.

Its exit criterion is **the existing suite green**, judged: each test edit in its diff states its need, an expectation **weakened** (loosened, skipped, deleted, rewritten to match the code) goes back to the Architect, and **untouched tests do not demonstrate equivalence either** — verify in proportion to what the refactor touched.

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
- **Observability test** — *could a tester who has never seen the code tell whether it passed?*
- **Errors are codes, not messages.** `INVALID_AMOUNT`, never "Invalid amount".
- **A `Requirement` states what is true, never what changed.** The section header names the operation.
- **These rules were written to be counted, so count them.** One `SHALL` per `Requirement`, at least one `Scenario` under each, no path or library in the text: the closure script checks them.
- **Every `Scenario` is a test**, and the edge case is mandatory beside the happy path. A `Scenario` asserting **derived state** carries `GIVEN`/`THEN` with no `WHEN`.
- **Content boundary, in the delta AND at merge** — no file name, path, internal class, framework, library or step-by-step. *If the implementation can change without changing externally visible behaviour, it does not belong in the spec.* The Platform Engineer refuses to merge a violating delta.
- **Per-module vocabulary**, and **the same name meaning different things in different modules is correct**. Never unify them.
- **No backfilling.** `docs/specs/` grows only through closed deltas.
- **Size** — one logical unit of work per change. Split when the intent changes, the scope explodes, or the original part can close on its own.
