# Maintenance backlog

Risks this repository owns. A consumer project can record an impediment one of these caused it,
but it never inherits the job of fixing the squad: the owner named here is the owner.

## M1 — the runner is where evidence becomes authority

**Owner:** this repository.
**Status:** open, and it stays open — this is a standing constraint, not a task to close.

`state.mjs run` and the TAP reader in `scripts/lib/tap.mjs` are the point where a command's exit
becomes a fact a gate will act on. Nine review rounds landed on this surface, and the pattern was
consistent enough to be worth writing down: **each convenience added here opened the next hole.**

- `--expect-nonzero` made a property's meaning optional, and turned a red CI green.
- `--expect-signal` replaced it with a substring, which a syntax error's echoed source satisfied.
- `--report <path>` let a genuinely red report from yesterday answer for a command that crashed
  on startup today.
- A filter written to skip the parser's empty root group is what let a truncated report through.
- Keying groups by indentation merged two sibling `describe` blocks into one.
- Ignoring `# Subtest:` markers left the middle group of `describe > describe > it` missing, and
  refused a legitimate run.

Four of those were introduced while fixing the previous one. That is what this entry is for.

**Criteria for any change to this surface**, all of them, before it ships:

1. a regression that **fails on the code as it stands** and passes after — for the defect, and
   for the inverse of the defect where one exists (wrongly accepted *and* wrongly refused);
2. at least one regression judged against **real runner output**, produced during the test, not a
   hand-written fixture — a fixture encodes what the author believes the runner emits;
3. the truncation, sibling-group and dangling-subtest regressions still passing, because those
   are the cases that returned;
4. a new option is justified in the commit against the alternative of **not having it**. Every
   option here is a door, and the ones above were all added for convenience;
5. an unsupported or unparseable shape is **refused**, never half-read. Silence about what a run
   did is not evidence that it did it.

## M2 — the supported TAP subset is narrow, deliberately

**Owner:** this repository.
**Status:** open; widening it is a decision, not a fix.

What is read is documented in [install.md](install.md). A runner that does not emit TAP needs a
reporter or a converter, and nothing here translates another format. If a consumer is blocked by
that, the impediment is theirs to record and this backlog item is where the work would land —
widening the subset, or adding a second format behind the same refusals.

## M3 — harness loading

**Owner:** this repository.
**Status:** both **closed** for their bounded paths — Codex Desktop for boot/dispatch/refusal,
Claude Code for boot and state reporting in an empty project.

See [compatibility.md](compatibility.md) for what each row rests on. The criterion has not moved:
nothing leaves "implemented, real validation pending" without an observed execution inside the
harness itself.

## M4 — pass 2 cannot be closed honestly on a single-context harness

**Owner:** this repository.
**Status:** open. It is a limit to state, not a bug to fix, until a harness proves isolation.

`pass2_complete` requires evidence whose executor records `independent_of: ['full_stack_developer']`,
because an adversarial pass that saw the builder's reasoning is not the independent pass the
pipeline assumes. The Codex Desktop smoke reported `operating_mode: single-context`, with isolation
**not proven** — so on that harness, today, recording that independence would be asserting
something nobody observed, and the gate should not be closed on it.

`capabilities.mjs` already prints the warning. What is missing is a way for a harness to *prove*
isolation rather than declare it, and until one exists the honest answer is the one the tool gives:
say the mode, do not close the gate, and record the deviation.

Criteria for closing this: a harness that exposes an observable signal of context isolation, and a
check that reads it — not a declaration in an adapter file, which is what the current
`context_isolation` field already is.
