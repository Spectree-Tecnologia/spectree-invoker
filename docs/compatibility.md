# Compatibility — what was tested, and what was not

The two columns are kept apart on purpose. A CLI that ran is not a desktop app that ran, and
a rendered file is not a harness that loaded it.

## Tested here

| Surface | Version | How it was established |
|---|---|---|
| Node.js | 24.17.0 | the whole suite runs on it: 136 deterministic tests |
| Windows | win32/x64 | the suite ran here; the diff layer is exercised against real `git` with spaces and non-ASCII names |
| git | 2.54.0 | `readDiff` is tested against a real repository, including rename, deletion and a `-z` round trip |
| Protocol → adapters | — | `build.mjs --check` runs in CI; a hand edit to any generated file fails it |
| Package integrity | — | `check-plugin.mjs`, with fixtures proving each rule rejects |
| Claude Code desktop, plugin load | 0.14.0 @ `410a429` | the plugin is installed here and **this session exposes all five specialists as dispatchable agent types** — the harness read `agents/` and `commands/`. That is the previous commit, not this work: see the row below |
| Codex install | — | installed into a synthetic consumer that already had its own `AGENTS.md`: file preserved, pointer appended once, second run idempotent, and the installed `capabilities.mjs` and `state.mjs` **executed from inside that consumer** |
| Gate cycle, through the CLI | — | one change driven **open to `closed`** by the installed commands in a synthetic consumer: a real branch, evidence produced by `state.mjs run`, both approvals, a real `git merge --no-ff`, the archival move, and the append-only history asserted step by step |
| Content binding | — | an uncommitted edit at an unchanged `HEAD` is refused with `E_CONTENT_CHANGED`; a `--no-ff` merge over an identical tree is the same candidate and passes; a merge that changes the tree is refused; ticking `tasks.md` or archiving the change moves neither digest |
| Runner semantics | — | `pass1.tests_failing` is satisfied only by TAP showing the named test failing in a completed run — a crash with no plan, a truncated plan, a `# SKIP` and a reported pass are each refused by name; no other property accepts a failing run; an imported document carrying a fingerprint is refused |
| Temporal binding | — | a run that edits the contract while being measured records `INCONCLUSIVE` against the contract it started from, and satisfies no gate afterwards; a report is read only from the path the run allocated and only if the run wrote it |
| TAP reading | TAP 13/14 subset | judged against real `node --test --test-reporter=tap` output — two sibling `describe` groups, and `describe > describe > it` whose first result sits at indent 8: each group is validated as its own document (own plan, own numbering from 1), diagnostics are skipped as blocks so a forged `not ok` inside a YAML error message is not a result, numbers must cover 1..N exactly, the top-level document must close and every subtest must be answered by an agreeing result in its parent (the same real output, cut off after the subtest plan, is refused), and the test name is matched exactly — unsupported shapes are refused, never half-accepted |
| Windows launchers | npm 11.13.0 | `state.mjs run -- npm test` executes in a synthetic consumer through `PATH`/`PATHEXT` resolution of the `.cmd` shim (skipped, and said so, where npm is absent) |
| Argument transport | — | thirteen arguments — empty, spaces, `&`, `\|`, `>`, `^`, `;`, parentheses, tab, accents, trailing backslash — arrive byte for byte through a `%*` shim, asserted together; `%`, `!` and `"` are refused with `E_ARGUMENT_UNTRANSPORTABLE` |
| Path handling | — | an untracked file whose name git escapes (accents, spaces) is read and its content counts; a path that is present and unreadable raises `E_CONTENT_UNAVAILABLE` instead of being hashed as a placeholder |
| Concurrency | — | two processes park on a barrier and are released together onto the same change: one lands, the other is refused with `E_CONCURRENT_UPDATE`, and only the winner appends a history event |

`engines` declares `node >= 20.11.0`; only 24.17.0 was actually exercised.

The suite is **136 deterministic tests**, and it writes nothing inside the package under test — a regression asserts that, because an earlier version of the drift test edited `CLAUDE.md` in place and made the suite unrunnable under read-only authorisation.

## Implemented, real validation pending

| Surface | Status |
|---|---|
| **Claude Code, at this commit** | The surface the harness loads — `.claude-plugin/plugin.json`, `commands/`, `agents/` — has the **same file set and the same frontmatter keys** at this commit as at the commit currently loaded; only the content inside changed. So the load path is exercised and the shape is unchanged, but **this commit itself has not been loaded**: the installed copy is a cache of `410a429`, and reaching it needs the merge and a `claude plugin update`. Loading is the last step, not a prerequisite of the work. |
| **OpenAI Codex** | The skill, the five specialists in `.codex/agents/`, the protocol document and the scripts are generated, installed into a synthetic consumer, and the installed scripts run there — including a full gate cycle driven by the installed commands. Agent locations follow the official custom-agent documentation (`.codex/agents/`, `~/.codex/agents/`). **No Codex session has loaded them**, and no Codex is present in this environment, so the harness has never dispatched one of these specialists. |
| Linux / macOS | Not run. Nothing in the code is Windows-specific — paths are normalised to POSIX and no shell string is assembled — but that is an argument, not a result. |

**Nothing above is claimed as proven compatibility.** Where a harness was unavailable, the
implementation and its independent tests are complete and the line reads *implemented;
real validation pending* — never *compatible*.

## How to close the pending rows

In a disposable environment, with no publishing and no external operation:

- **Claude Code** — merge, `claude plugin update spectree@spectree-invoker`, then run
  `/spectree:invoker` with no argument in a scratch project and confirm it loads `CLAUDE.md`
  from `${CLAUDE_PLUGIN_ROOT}` and reports state rather than inventing it. Both experiences are
  desktop and natively authenticated: nothing here asks for an API key or reaches a model directly.
- **Codex** — copy the skill into a scratch project, run `$spectree-invoker`, and confirm the
  skill loads and that one specialist can be dispatched by name.

Record each as evidence with `source_kind: observed_execution` and the harness version in
`environment`. Until then the rows stay where they are.

## Deliberate non-goals

No MCP server, no dashboard, no external telemetry, no database, no cloud integration, and no
mandatory paid API. The squad is not bound to any model: the model is the user's configuration,
the harness is the execution mechanism, and neither is named in `protocol/`.

The two supported surfaces are the **desktop experiences** of Claude Code and OpenAI Codex,
running on their own native authentication. Nothing here calls a model, holds an API key, asks
for one, or adds inference infrastructure — the harness is the only thing that talks to a model,
and it already knows how.
