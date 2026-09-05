# Compatibility — what was tested, and what was not

The two columns are kept apart on purpose. A CLI that ran is not a desktop app that ran, and
a rendered file is not a harness that loaded it.

## Tested here

| Surface | Version | How it was established |
|---|---|---|
| Node.js | 24.17.0 | the whole suite runs on it: 100 deterministic tests |
| Windows | win32/x64 | the suite ran here; the diff layer is exercised against real `git` with spaces and non-ASCII names |
| git | 2.54.0 | `readDiff` is tested against a real repository, including rename, deletion and a `-z` round trip |
| Protocol → adapters | — | `build.mjs --check` runs in CI; a hand edit to any generated file fails it |
| Package integrity | — | `check-plugin.mjs`, with fixtures proving each rule rejects |
| Codex install | — | installed into a synthetic consumer that already had its own `AGENTS.md`: file preserved, pointer appended once, second run idempotent, and the installed `capabilities.mjs` and `state.mjs` **executed from inside that consumer** |
| Concurrency | — | two real processes writing the same change: one lands, the other is refused with `E_CONCURRENT_UPDATE` |

`engines` declares `node >= 20.11.0`; only 24.17.0 was actually exercised.

The suite is **100 deterministic tests**, and it writes nothing inside the package under test — a regression asserts that, because an earlier version of the drift test edited `CLAUDE.md` in place and made the suite unrunnable under read-only authorisation.

## Implemented, real validation pending

| Surface | Status |
|---|---|
| **Claude Code** | The plugin layout, entrypoint and cards are unchanged in shape from the version in use, and `CLAUDE.md` plus the five cards render byte-identical to the previously shipped files apart from one intentional line. **Not re-loaded inside a live Claude Code session as part of this work.** |
| **OpenAI Codex** | The skill, the five specialists in `.codex/agents/`, the protocol document and the scripts are generated, installed into a synthetic consumer, and the installed scripts run there. Agent locations follow the official custom-agent documentation (`.codex/agents/`, `~/.codex/agents/`). **No Codex session has loaded them**, so the harness has never dispatched one of these specialists. |
| Linux / macOS | Not run. Nothing in the code is Windows-specific — paths are normalised to POSIX and no shell string is assembled — but that is an argument, not a result. |
| Claude Code desktop app | Not tested. The CLI working says nothing about it. |

**Nothing above is claimed as proven compatibility.** Where a harness was unavailable, the
implementation and its independent tests are complete and the line reads *implemented;
real validation pending* — never *compatible*.

## How to close the pending rows

In a disposable environment, with no publishing and no external operation:

- **Claude Code** — install the plugin from a local checkout, run `/spectree:invoker` with no
  argument in a scratch project, and confirm it loads `CLAUDE.md` from `${CLAUDE_PLUGIN_ROOT}`
  and reports state rather than inventing it.
- **Codex** — copy the skill into a scratch project, run `$spectree-invoker`, and confirm the
  skill loads and that one specialist can be dispatched by name.

Record each as evidence with `source_kind: observed_execution` and the harness version in
`environment`. Until then the rows stay where they are.

## Deliberate non-goals

No MCP server, no dashboard, no external telemetry, no database, no cloud integration, and no
mandatory paid API. The squad is not bound to any model: the model is the user's configuration,
the harness is the execution mechanism, and neither is named in `protocol/`.
