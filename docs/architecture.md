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
| `adapters/codex/dist/SQUAD.md` | `protocol/` + `adapters/codex/` |
| `.agents/skills/spectree-invoker/SKILL.md` | `adapters/codex/skill-body.md` |
| `adapters/codex/dist/agents/*.toml` | `protocol/roles/` + `adapters/codex/roles/` |

The installer copies the specialists into the consumer's `.codex/agents/`, the runtime and
SQUAD.md into `.spectree/squad/`, and appends a pointer to its existing AGENTS.md.

`node scripts/build.mjs` writes them; `--check` fails when any is stale; CI runs `--check` on
every pull request. There is no second hand-maintained copy of the rules anywhere.

**Rules here, reasons elsewhere.** The rendered core carries the rules and is loaded on every
session; the reason behind each rule is in `docs/protocol-rationale.md`, read on demand.
`protocol/rules.json` lists every rule the core must carry, and `check-plugin.mjs` fails when a
rendered core drops one, grows past the ceiling in that file, or stops pointing at the rationale.
The Solutions Architect and Platform Engineer cards follow the same rule, with their own lists and
ceilings in the same file, checked in the card each adapter ships.

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
| `prepare-closure.mjs` | is consolidation/archival prepared, owned, recoverable and bound to this candidate? |
| `post-merge.mjs` | did the approved integration actually land with the required CI? |
| `migrate-closure.mjs` | what explicit migration does a historical closure record require? |

`lib/change/lifecycle.mjs` owns durable approval authority, immutable preparation identity, operation
phases/recovery and receipt bindings. `state-machine.mjs` makes pure decisions; the CLIs apply
them under the lifecycle/change write boundaries. Preparation occurs before integration approval;
confirmation writes operational records, not a second closure commit.

`bench/` observes performance outside this authority path. Its synthetic approvals and GitHub
fixtures never leave disposable consumers; timing reports are not evidence satisfying any gate.

## The runtime's own modules

`scripts/lib/` is seven modules, one folder each. A module's `index.mjs` is its published entry:
another module, a CLI, Presence or the benchmark imports only from there, and the files beside it
reach each other directly. The graph runs one way:

```
shared <- change <- evidence, execution <- closure <- console, evaluation
```

| Module | What it holds |
|---|---|
| `shared` | CLI flags, git, digests, process launch and supervision, TAP parsing, schema validation, harness declarations |
| `change` | the change store and state machine, scope policy, planner, operation checkpoints, run events, the closure control (`lifecycle.mjs`) and the core-domain line |
| `evidence` | verification plans, mutation probes, diff classification, CI policy, the delivery contract and ledger |
| `execution` | phase context, the task executor, agent runners, the bridge mailbox |
| `closure` | preparation, closure, reconciliation, adoption, diagnostics |
| `evaluation` | agent and flow evaluations, engineering reports |
| `console` | the local Console server, an application nothing in the runtime imports |

`tests/module-graph.test.mjs` fails on a deep import between modules, on an index that re-exports
another module, and on a cycle. Tests themselves import files directly: they are white-box.

A CLI is a thin command line over a module function. `prepare-closure.mjs` hands `root` and `argv`
to `prepareClosure` (`closure/prepare.mjs`) and turns the returned code into the exit code, so
every preparation flow can be tested in the same process. `state.mjs` does the same through
`stateCommand` (`closure/state.mjs`), one function per command, and `post-merge.mjs` through
`confirmMerge` (`closure/post-merge.mjs`).

Every write under `.spectree/` goes through `shared/persistence.mjs`: `writeAtomic` replaces a
document whole, `writeOnce` and `publishOnce` create a record that must not exist yet, and
`withLock` runs a critical section under a lock file. `LOCK_ORDER` is executor, closure control,
change, deferral ledger, and `withLock` refuses a lock requested out of that order
(`E_LOCK_ORDER`). `tests/persistence.test.mjs` fails on a raw exclusive write, link or rename
anywhere else under `scripts/lib/`.

The conventions this code follows, and the file that is the example of each, are written as
[roles](roles/README.md). They bind whoever edits `scripts/lib/`.

## Four kinds of check, kept apart

1. **Structural integrity** — `check-plugin.mjs`. Files, content, references, manifests.
2. **Executable rules** — the state machine, the validator, the diff classifier, with tests.
3. **Observed agent behaviour** — not automated. `tests/fixtures/evaluations.json` records
   situations with their correct answers so a human can score what an agent said.
4. **Real operation in a harness** — bounded loading/dispatch smokes are recorded in
   `compatibility.md`; M5 records live GitHub confirmation. Proven context isolation (M4) and
   a comparable end-to-end performance campaign (M6) remain separate and open.

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
