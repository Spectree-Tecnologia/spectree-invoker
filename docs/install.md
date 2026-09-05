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

Codex reads `AGENTS.md` from the repository root, and skills from `.agents/skills/`. Two ways
to wire the squad in, and the first one changes nothing outside the project:

**Per project** — copy the two entrypoints into the project you are working on:

```bash
cp "<package>/AGENTS.md" ./AGENTS.md            # only if the project has none; see below
cp -r "<package>/.agents/skills/spectree-invoker" ./.agents/skills/
```

**Per user** — put the skill under `$HOME/.agents/skills/spectree-invoker` instead, and it is
available in every project without touching any of them.

Invoke it with `$spectree-invoker`. The five specialists live in that skill's `agents/`
directory as one TOML each and are dispatched by name: `solutions_architect`,
`full_stack_developer`, `quality_engineer`, `platform_engineer`, `integration_engineer`.

**If the project already has an `AGENTS.md`, do not overwrite it.** Append a pointer instead:

```markdown
## Spectree Invoker

The squad's protocol is in `.agents/skills/spectree-invoker/SKILL.md`. Invoke it with
`$spectree-invoker`. Read it before dispatching any specialist.
```

The project's own instructions are the project's. The squad never replaces them.

## Verify an installation

From the package directory:

```bash
node scripts/check-plugin.mjs      # structural integrity — required content, not just files found
node scripts/build.mjs --check     # generated files match protocol/
node --test tests/*.test.mjs       # the deterministic suite
node scripts/capabilities.mjs      # what this harness actually gives the squad
```

`check-plugin` reports **structural integrity only**. It does not run the protocol's rules,
does not observe an agent's behaviour, and does not prove the plugin works inside a harness.
Those are three separate questions and only the first is answered here.

## Update

```bash
claude plugin update spectree@spectree-invoker      # Claude Code
```

For Codex, re-copy the skill directory. Updating never touches a consumer's own `AGENTS.md`,
`CLAUDE.md` or any file outside `.agents/skills/spectree-invoker/`.

Every merge to `main` publishes a `v<version>` tag, so a project can say which commit it is on.

## Remove

Claude Code: `claude plugin uninstall spectree@spectree-invoker`.

Codex: delete `.agents/skills/spectree-invoker/` and the pointer you added to `AGENTS.md`.
Nothing else was written.

## The project's state directory

`.spectree/` in a consumer project holds the change state, evidence, approvals, dispatches
and the deferral ledger. It is created by `node <package>/scripts/state.mjs init <project-id>`
and by nothing else — **reading never creates it**.

Removing the squad does not remove `.spectree/`: it is the project's record, not the tool's.

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
