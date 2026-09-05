# Compatibility — what was tested, and what was not

The two columns are kept apart on purpose. A CLI that ran is not a desktop app that ran, and
a rendered file is not a harness that loaded it.

## Tested here

| Surface | Version | How it was established |
|---|---|---|
| Node.js | 24.17.0 | the whole suite runs on it: 74 deterministic tests |
| Windows | win32/x64 | the suite ran here; the diff layer is exercised against real `git` with spaces and non-ASCII names |
| git | 2.54.0 | `readDiff` is tested against a real repository, including rename, deletion and a `-z` round trip |
| Protocol → adapters | — | `build.mjs --check` and `--extraction-proof` run in CI |
| Package integrity | — | `check-plugin.mjs`, with fixtures proving each rule rejects |

`engines` declares `node >= 20.11.0`; only 24.17.0 was actually exercised.

## Implemented, real validation pending

| Surface | Status |
|---|---|
| **Claude Code** | The plugin layout, entrypoint and cards are unchanged in shape from the version in use, and `CLAUDE.md` plus the five cards render byte-identical to the previously shipped files apart from one intentional line. **Not re-loaded inside a live Claude Code session as part of this work.** |
| **OpenAI Codex** | `AGENTS.md`, `.agents/skills/spectree-invoker/SKILL.md` and five specialist TOMLs are generated and structurally checked. The syntax was taken from a shipping project that distributes a Codex adapter, and from the AGENTS.md specification. **No Codex session has loaded them.** |
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
