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

Record that value as the approval's `scope_digest`. Two consequences, and both are the point:

- **Progress is not scope.** `tasks.md` is outside the contract digest, so ticking a checkbox
  revokes nothing. Editing the proposal or the delta does, with `E_APPROVAL_DIGEST_MISMATCH`.
- **The revision is not the content.** Evidence a gate requires to be *fresh* must carry the
  `fingerprint` of the content it ran against — the CLI stamps it at `record-evidence`, so
  record immediately after the run. An uncommitted edit leaves `HEAD` exactly where it was and
  still moves that fingerprint: the gate then refuses with `E_CONTENT_CHANGED`. Evidence that
  carries no fingerprint at all cannot say what it measured, and is refused the same way.

Both digests exclude the squad's own bookkeeping — `.spectree/` and `docs/changes/*/tasks.md` —
because those change on the squad's own writes and are never what a check measured. Where the
content cannot be established at all (no work tree), the CLI stops with `E_CONTENT_UNAVAILABLE`:
an unavailable comparison is unknown, not unchanged.

A **scope** approval should carry `"expires_with_revision": false`. The Founder approved the
contract, and the contract digest is what revokes it; commits landing during the build are not a
change of scope. Leave the default in place for `integration`, whose digest is about the code.

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
