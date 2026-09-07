# Install, verify, update, remove, migrate, recover

Nothing here changes anything global by default, nothing requires a symlink, and every
command works from a path containing spaces.

## Claude Code

```bash
claude plugin marketplace add Spectree-Tecnologia/spectree-invoker
claude plugin install spectree@spectree-invoker
```

Boot it inside a project with `/spectree:invoker`. With no argument it reports the pipeline
state; with an argument it takes the request into the pipeline.

## OpenAI Codex

Use the installer. It is a **dry run by default** and writes nothing until `--apply`:

```bash
node <package>/scripts/install-codex.mjs /path/to/project            # plan only
node <package>/scripts/install-codex.mjs /path/to/project --apply    # perform it
node <package>/scripts/install-codex.mjs /path/to/project --apply --global
```

What it places, and where — the locations are the ones Codex actually reads:

| Destination | What |
|---|---|
| `.codex/agents/*.toml` (or `~/.codex/agents/`) | the five specialists, as Codex **custom agents** |
| `.agents/skills/spectree-invoker/SKILL.md` | the entrypoint skill, invoked with `$spectree-invoker` |
| `.spectree/squad/SQUAD.md` | the squad's protocol |
| `.spectree/squad/scripts/`, `.spectree/squad/schemas/` | the scripts the skill tells the agent to run, and what they need |

A skill's own `agents/` subfolder does **not** register custom agents; `.codex/agents/` does. That is why the installer exists rather than a `cp -r`.

**It never rewrites the consumer's `AGENTS.md`.** If one exists, a short pointer is appended once, below whatever is already there — and a second run appends nothing. If none exists, one is created containing only the pointer. `AGENTS.md` stays the project's document; the squad's definition is `SQUAD.md`.

Other guarantees, each covered by a regression test: idempotent (a second `--apply` reports only `unchanged`), contained (a destination that escapes the project is refused, never clamped), no symlink anywhere, and nothing global unless `--global` is passed. An existing squad file is **not** overwritten without `--force`, and the refusal names every file it would have replaced.

## Verify an installation

From the package directory:

```bash
node scripts/check-plugin.mjs      # structural integrity — required content, not just files found
node scripts/build.mjs --check     # generated files match protocol/
node --test tests/*.test.mjs       # the deterministic suite — writes nothing inside the package
node scripts/capabilities.mjs      # what this harness actually gives the squad
```

`check-plugin` reports **structural integrity only**. It does not run the protocol's rules,
does not observe an agent's behaviour, and does not prove the plugin works inside a harness.
Those are three separate questions and only the first is answered here.

## Update

```bash
claude plugin update spectree@spectree-invoker      # Claude Code
```

For Codex, re-run the installer. It reports `unchanged` for everything already current, and
`overwrite` for a squad file that moved — and **refuses to overwrite anything without `--force`**,
naming each file first. Updating never touches the consumer's own `AGENTS.md`.

Every merge to `main` publishes a `v<version>` tag, so a project can say which commit it is on.

## Remove

Claude Code: `claude plugin uninstall spectree@spectree-invoker`.

Codex: delete `.agents/skills/spectree-invoker/`, `.codex/agents/{solutions_architect,full_stack_developer,quality_engineer,platform_engineer,integration_engineer}.toml`,
`.spectree/squad/`, and the pointer block in `AGENTS.md` (it is marked with an HTML comment).
Nothing else was ever written.

## The project's state directory

`.spectree/` in a consumer project holds the change state, evidence, approvals, dispatches
and the deferral ledger. It is created by `node <package>/scripts/state.mjs init <project-id>`
and by nothing else — **reading never creates it**.

Removing the squad does not remove `.spectree/`: it is the project's record, not the tool's.

## Gates, digests and blocks

A gate is bound to **content**, so the CLI computes the digest of what is on the table and
compares it — it never copies the digest out of an approval or a record, which would only
ever agree with itself. There are two digests, because a gate asks two questions:

| Digest | Covers | Which gates |
|---|---|---|
| contract | `proposal.md` and `specs/**` inside `docs/changes/<id>/` | `scope`, `ambiguity` |
| contract + content | the above **and** the commit plus every uncommitted change | `integration`, `irreversible`, `exposure` |

```bash
node scripts/state.mjs digest <change-id>                      # the contract
node scripts/state.mjs digest <change-id> --gate integration   # the contract and the code
```

Record that value as the approval's `scope_digest`. **The digest is the expiry**, and it is the
right one for the gate: a contract approval dies when the contract changes, a code approval when
the contract or the code changes. Nothing else has to be set — `expires_with_revision: true` is
available to demand the same revision as well, and it is an opt-in, never the default.

- **Progress is not scope.** `tasks.md` is outside the contract digest, so ticking a checkbox
  revokes nothing. Editing the proposal or the delta does, with `E_APPROVAL_DIGEST_MISMATCH`.
- **The unit of content is the tree, not the commit.** A `--no-ff` merge writes a new commit
  over an identical tree: same candidate, same digest, and the gate does not reopen. A merge
  that resolves into a different tree is a different candidate, and it is refused.
- **An uncommitted edit is a change.** `HEAD` does not move, the content digest does, and the
  gate refuses with `E_CONTENT_CHANGED`.

Both digests exclude the squad's own bookkeeping — `.spectree/` and `docs/changes/` — because
those change on the squad's own writes and are never what a check measured. `docs/changes/` is
excluded in full so that archiving a change does not read as changing the code; its contractual
half is covered by the contract digest, which follows the folder into `docs/changes/archive/`.
Where the content cannot be established — no work tree, or a file that is present and cannot be
read — the CLI stops with `E_CONTENT_UNAVAILABLE`: an unavailable comparison is unknown, not
unchanged.

Keep `.spectree/` out of version control. It is the project's record, but it is written on every
transition, so committing it makes each branch switch collide with the squad's own writes.

### Evidence is produced, not asserted

A gate that requires **fresh** evidence requires a `fingerprint` — the digest of the content the
run exercised — and only one command produces it:

```bash
node scripts/state.mjs run <change-id> <property> --role <role> [--independent-of a,b] \
  [--expect-failing <test name> [--report]] [--id <evidence-id>] -- <command> [args...]
```

It measures the content, runs the command, measures again, and records the result together with
the digests it started from — the content **and** the contract. Exit 0 is `PASS`. A command that
could not be executed is `INFRA_ERROR`, and one that **changed the content it was measuring** is
`INCONCLUSIVE`: it satisfies no gate, because what it exercised cannot be established.

**`pass1.tests_failing` means a named test ran and failed**, and that is the property's
meaning, not an option on the command line. It requires `--expect-failing "<test name>"` — the
name matched **exactly**, because a substring can match two tests — and the run must emit TAP,
on stdout or into the report this run allocates. The runner then reads structure, not text:

| The run showed | Result |
|---|---|
| a plan, all planned results reported, `not ok` for the named test, non-zero exit | `PASS` |
| no plan at all — a crash before any test was enumerated | `INFRA_ERROR` |
| fewer results than planned, or `Bail out!` | `INFRA_ERROR` |
| the named test absent, or `# SKIP` | `INFRA_ERROR` |
| the named test reported `ok` | `FAIL` |
| a failure reported alongside exit 0 | `INFRA_ERROR` |

This replaced a substring search, which `const ACCOUNT_NAME_REQUIRED = ;` satisfied: the syntax
error printed the identifier, no test ran, and the gate opened. A stack trace, an echoed source
line and a log message are all text; a plan and a numbered result are structure.

Structure only holds if the blocks are respected, so the parser tracks context rather than
matching lines. **What is supported**, and everything outside it is refused rather than
half-read:

- a plan (`1..N`) in **every group** that reports results, and the counts must agree — an outer
  plan that adds up does not excuse subtests that stopped halfway. A group is one nested TAP
  document, not an indentation level: two sibling `describe` blocks both sit at indent 4 and each
  carries its own plan and its own numbering from 1, so a sibling can never complete another's
  plan. Only `1..N` is read; a plan starting anywhere else is refused as unsupported;
- **numbered** results, each number used once, and every number from 1 to N present — a result
  numbered outside its group's plan is refused, and so is a gap;
- `# Subtest:` markers, which announce a child at the indentation of the document announcing
  it. They are what makes `describe > describe > it` readable: its first result sits two levels
  deep, and without the marker the middle group would not exist yet when its child closed;
- a **closed top-level document**. A subtest that plans one test and reports one test is a tidy
  subtest, not a finished run: output cut off after it is refused, because the document that
  should have reported that subtest never said anything at all;
- every subtest answered by **one result in its parent**, and that result agreeing with it. A
  subtest nothing in the parent reports is dangling however well its own counts add up, and a
  parent recording a failing subtest as passing is two descriptions of different runs;
- YAML diagnostics (`---` … `...`) skipped entirely. A failing test's own error message can
  contain a line that reads exactly like `not ok 1 - <the test you asked about>`, and a
  line-by-line parser lets one test declare the failure of another. An unclosed block makes the
  rest unreadable, and unreadable is refused;
- `# SKIP` and `# TODO` read as directives: a test that did not run proves nothing;
- exactly one test with the name you passed. Two, and which one is the Scenario cannot be decided.

`--report` changes **where the TAP is read from — never what it is**. A runner that does not
emit TAP needs a reporter or a converter; nothing here translates another format. Use it when
the runner writes its report to a file instead of stdout:

```bash
node scripts/state.mjs run c1 pass1.tests_failing --role quality_engineer   --expect-failing "Scenario: creation with a blank name" --report   -- npx some-runner --tap-out {report}
```

The flag **takes no path**. The runner allocates a fresh file outside the work tree, substitutes
`{report}` in the command with it, and reads that file afterwards — so the report is this run's
own, and a report the command did not write is `INFRA_ERROR` however red it is. Pointing at a
path of your own was how a genuinely failing run from yesterday could stand in for a command
that crashed on startup today.

No other property accepts `--expect-failing` or `--report`. A command that failed is not
evidence that it succeeded, and there is no flag that makes it one.

The launcher is resolved the way the platform resolves it. On Windows `npm`, `npx` and `pnpm`
are `.cmd` shims that Node refuses to spawn directly, so the runner finds them through `PATH`
and `PATHEXT` and invokes the shim deliberately — rather than turning `shell: true` on for
every string, which would hand every argument back to the interpreter. Arguments are quoted so
they arrive byte for byte: an empty argument stays an empty argument, and a trailing backslash
does not escape the closing quote. What **cannot** survive that trip is refused with
`E_ARGUMENT_UNTRANSPORTABLE` rather than delivered as something else — `%` and `!` are expanded
by cmd before any quoting applies, and a `"` is re-parsed when the shim forwards with `%*`.
Where the refusal bites, invoke the underlying executable directly.

`record-evidence` **imports** a document. It observes nothing, so it neither stamps a
`fingerprint`/`contract_digest` nor accepts one: a document cannot acquire the authority of an
execution by describing itself as one, and a file carrying either field is refused with a
pointer to `run`. Use it for what it is for — results no gate requires to be fresh, external
references, legacy records. (This is a guarantee about the supported flow, not a defence
against someone writing into `.spectree/` by hand.)

Integrating re-checks the runs, not only the signature. `integration_approved` and `integrated`
each require `pass2.attack` and `ci.green` on the content being integrated, so an approval can
never carry code past a QA and a CI that never saw it. And `pass1.tests_failing` and
`pass2.attack` are bound to the **contract** as well: they are claims about the Scenarios, so
adding an acceptance criterion invalidates them with `E_CONTRACT_CHANGED` even when the code
never moved. Moving the same contract into the archive does not.

Both bindings are captured **before** the command runs and compared after it. A run that edits
the contract it is being measured against is `INCONCLUSIVE`, and the record keeps the contract
it started from — otherwise a run could supply its own acceptance criteria and then be credited
with meeting them.

Blocking states its cause, and records where to come back to:

```bash
node scripts/state.mjs transition <change-id> blocked --reason "the PSP webhook contract is unknown"
```

`blocked_from` is written by the command, not by hand. Recovery returns to that state and to
no other — `E_BLOCKED_RECOVERY` for anything else — and re-checks that state's requirements,
so a block never launders a step whose preconditions were never met. Coming back clears both
fields.

## Migrate

Documents carry `schema_version`. A document written by another version is **refused, not
repaired**: the reader raises `E_SCHEMA_VERSION` and stops. Migration is an explicit act, and
a legacy record imported into the store keeps `source_kind: legacy_record` — a historical
report never becomes verified evidence by being copied forward.

## Recover

- **A generated file was hand-edited.** `node scripts/build.mjs` rewrites it from `protocol/`.
  The edit is lost, which is correct: the protocol is the source.
- **State looks wrong.** `node scripts/state.mjs validate` checks every stored document against
  its schema and names the invalid ones. It repairs nothing.
- **A change is stuck.** `node scripts/state.mjs can <change-id> <state>` prints the refusal
  code and the reason. The refusal is the diagnosis.
- **The store is unreadable.** `.spectree/history/<id>.jsonl` is append-only and was never
  rewritten; the current state can be re-derived from it by hand.
