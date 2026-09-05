# How this package is put together

## One source, two renderings

```
protocol/            the vendor-neutral core — the single authoritative source
  manifest.json      what the core is made of, in order, and the tokens adapters fill
  NN-*.md            one fragment per section of the protocol
  roles/*.md         one body per specialist, harness-neutral

adapters/
  claude-code/       tokens, per-role frontmatter and tool sections, targets
  codex/             tokens, per-role TOML metadata, the skill body

schemas/             the structured contracts: change, dispatch, evidence, deferred, approval
scripts/             build, checks, state, capabilities
tests/               deterministic suite + behavioural fixtures
docs/                install, compatibility, this file
```

Everything below is **generated** and carries a header saying so:

| Generated | From |
|---|---|
| `CLAUDE.md` | `protocol/` + `adapters/claude-code/` |
| `agents/*.md` | `protocol/roles/` + `adapters/claude-code/roles/` |
| `AGENTS.md` | `protocol/` + `adapters/codex/` |
| `.agents/skills/spectree-invoker/SKILL.md` | `adapters/codex/skill-body.md` |
| `.agents/skills/spectree-invoker/agents/*.toml` | `protocol/roles/` + `adapters/codex/roles/` |

`node scripts/build.mjs` writes them; `--check` fails when any is stale; CI runs `--check` on
every pull request. There is no second hand-maintained copy of the rules anywhere.

**Determinism.** The output is a pure function of `protocol/` and each `adapter.json`. No
timestamps, no host paths, no filesystem ordering. Running the build twice writes nothing the
second time.

**The extraction was proven lossless, once, at the commit it was made from.** Rendering each
target from `protocol/` and comparing it against `410a429` gave: all five specialist cards
**byte-identical**, and `CLAUDE.md` different by **exactly one line** — changed deliberately so
the sentence stops naming a Claude-specific directory.

That proof is recorded in `protocol/manifest.json` and is **not** re-runnable, on purpose. The
protocol has legitimately evolved since, so a comparison against that revision now differs for
good reasons, and a command that can never pass again is decoration. What guards the extraction
from here on is `--check`: every generated file must match what `protocol/` renders, on every
pull request.

## What each script is for

| Script | Answers |
|---|---|
| `build.mjs` | are the adapters what the protocol says they should be? |
| `check-plugin.mjs` | does the package contain the content it must contain? |
| `state.mjs` | what is the state, and is this transition allowed? |
| `verify-change.mjs` | did this change stay inside its scope, against its recorded base? |
| `capabilities.mjs` | what does this harness actually give the squad? |

## Four kinds of check, kept apart

1. **Structural integrity** — `check-plugin.mjs`. Files, content, references, manifests.
2. **Executable rules** — the state machine, the validator, the diff classifier, with tests.
3. **Observed agent behaviour** — not automated. `tests/fixtures/evaluations.json` records
   situations with their correct answers so a human can score what an agent said.
4. **Real operation in a harness** — see `compatibility.md`. Pending, and said so.

Collapsing any two of these is how a green starts meaning more than it should.

## The state model

`.spectree/` in the consumer project. Current state is a small file per change; history is an
append-only JSONL beside it. Resume reads the first and never replays the second.

- **Atomic writes** — temp file plus rename, never a partial file.
- **Optimistic concurrency** — `state_revision`; a write that expects a different value is refused.
- **Immutable base** — `base_revision` is written once. Every comparison is made against it, so
  a merge cannot make the comparison vacuous.
- **Explicit migration** — a document from another `schema_version` is refused, never repaired.
- **Absence is unknown** — a missing artifact means unknown or blocked. It never means done.

## Evidence, and what a green is worth

Six results, and only two are verdicts: `PASS`, `FAIL`, `EXPECTED_REJECTION`, `INFRA_ERROR`,
`NOT_RUN`, `INCONCLUSIVE`. Four sources: `agent_report`, `observed_execution`,
`external_reference`, `legacy_record`.

The rules the state machine enforces from those two lists:

- an agent report never satisfies a step that needs an observed execution;
- evidence measured at another revision is stale, and the transition says so;
- `INFRA_ERROR` is neither a pass nor a fail — the property was never exercised;
- a negative control needs its **expected signal**, because a crash also exits non-zero;
- an approval belongs to one gate and one change, and can expire with the revision;
- pass 2 by an executor that is not recorded as independent of the builder is refused.
