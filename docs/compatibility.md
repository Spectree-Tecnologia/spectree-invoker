# Compatibility — what was tested, and what was not

The two columns are kept apart on purpose. A CLI that ran is not a desktop app that ran, and
a rendered file is not a harness that loaded it.

## Tested here

| Surface | Version | How it was established |
|---|---|---|
| Node.js | 24.17.0 · 22.23.2 | the whole suite runs on both: 136 deterministic tests here, and the same suite in CI |
| Ubuntu 24.04 | GitHub runner | CI ran the full suite: **159 tests, 158 pass, 0 fail, 1 skipped** — the skip is the `cmd.exe` argument-transport test, which says it is Windows-only |
| Windows | win32/x64 | the suite ran here; the diff layer is exercised against real `git` with spaces and non-ASCII names |
| git | 2.54.0 | `readDiff` is tested against a real repository, including rename, deletion and a `-z` round trip |
| Protocol → adapters | — | `build.mjs --check` runs in CI; a hand edit to any generated file fails it |
| Package integrity | — | `check-plugin.mjs`, with fixtures proving each rule rejects |
| Claude Code desktop, plugin load | 0.14.0 @ `410a429` | the plugin is installed here and **this session exposes all five specialists as dispatchable agent types** — the harness read `agents/` and `commands/`. That is the previous commit, not this work: see the row below |
| **Claude Code desktop** | package 1.0.1 @ `5c67b31` | a session started after the update ran `/spectree:invoker` in an empty scratch project: it loaded the plugin's `CLAUDE.md` (401 lines), ran `capabilities.mjs`, and **reported the state it found instead of inventing one** — empty directory, no work tree, no approvals, no evidence, no pipeline to resume. It refused to invent a first change, emitted the interview round in the §10 format, and recorded the deviations (`context_isolation` declared not verified, `network` UNKNOWN, blast radius is protocol not sandbox, branch protection UNKNOWN) |
| **OpenAI Codex Desktop** | package 1.0.0 @ `dd8507b` | a real session on Windows 10.0.26200 (PowerShell 7.6.5, node 24.17.0, npm 11.13.0, git 2.54.0) discovered the installed skill in its own catalog, loaded `SKILL.md` and `.spectree/squad/SQUAD.md`, ran the installed `capabilities.mjs` and `state.mjs resume` (both exit 0), **dispatched a registered `platform_engineer` through the native multi-agent harness**, and the gate refused promotion with `E_MISSING_APPROVAL`. Native session authentication; no API, no key, no network service |
| Codex install | — | installed into a synthetic consumer that already had its own `AGENTS.md`: file preserved, pointer appended once, second run idempotent, and the installed `capabilities.mjs` and `state.mjs` **executed from inside that consumer** |
| Delivery cycle | — | one change open to `closed` with the closure **prepared on the branch**: the specs consolidated by the project's own command, the folder archived, one manifest, one `--no-ff` merge, and **zero commits after it** — asserted, including that the work tree is left clean |
| CI policy | — | the classification is of the whole candidate: a log commit on top of a code change still classifies as `full`, while the last commit alone reads administrative. A required check that failed, was cancelled, or never reported can never aggregate to green |
| Gate cycle, through the CLI | — | one change driven **open to `closed`** by the installed commands in a synthetic consumer: a real branch, evidence produced by `state.mjs run`, both approvals, a real `git merge --no-ff`, the archival move, and the append-only history asserted step by step |
| Content binding | — | an uncommitted edit at an unchanged `HEAD` is refused with `E_CONTENT_CHANGED`; a `--no-ff` merge over an identical tree is the same candidate and passes; a merge that changes the tree is refused; ticking `tasks.md` or archiving the change moves neither digest |
| Runner semantics | — | `pass1.tests_failing` is satisfied only by TAP showing the named test failing in a completed run — a crash with no plan, a truncated plan, a `# SKIP` and a reported pass are each refused by name; no other property accepts a failing run; an imported document carrying a fingerprint is refused |
| Temporal binding | — | a run that edits the contract while being measured records `INCONCLUSIVE` against the contract it started from, and satisfies no gate afterwards; a report is read only from the path the run allocated and only if the run wrote it |
| TAP reading | TAP 13/14 subset | judged against real `node --test --test-reporter=tap` output — two sibling `describe` groups, and `describe > describe > it` whose first result sits at indent 8: each group is validated as its own document (own plan, own numbering from 1), diagnostics are skipped as blocks so a forged `not ok` inside a YAML error message is not a result, numbers must cover 1..N exactly, the top-level document must close and every subtest must be answered by an agreeing result in its parent (the same real output, cut off after the subtest plan, is refused), and the test name is matched exactly — unsupported shapes are refused, never half-accepted |
| Windows launchers | npm 11.13.0 | `state.mjs run -- npm test` executes in a synthetic consumer through `PATH`/`PATHEXT` resolution of the `.cmd` shim (skipped, and said so, where npm is absent) |
| Argument transport | — | thirteen arguments — empty, spaces, `&`, `\|`, `>`, `^`, `;`, parentheses, tab, accents, trailing backslash — arrive byte for byte through a `%*` shim, asserted together; `%`, `!` and `"` are refused with `E_ARGUMENT_UNTRANSPORTABLE` |
| Path handling | — | an untracked file whose name git escapes (accents, spaces) is read and its content counts; a path that is present and unreadable raises `E_CONTENT_UNAVAILABLE` instead of being hashed as a placeholder |
| Concurrency | — | two processes park on a barrier and are released together onto the same change: one lands, the other is refused with `E_CONCURRENT_UPDATE`, and only the winner appends a history event |

`engines` declares `node >= 20.11.0`; 24.17.0 and 22.23.2 were actually exercised.

The suite is **159 deterministic tests**, and it writes nothing inside the package under test — a regression asserts that, because an earlier version of the drift test edited `CLAUDE.md` in place and made the suite unrunnable under read-only authorisation.

## Implemented, real validation pending

| Surface | Status |
|---|---|
| **OpenAI Codex — what the smoke did not cover** | The bounded smoke covered boot, dispatch and one refusal on a disposable fixture. It was **not** a delivery cycle, a deploy, or proof across every Codex harness. Two things stayed open in it and are open still: the installed diagnostic reported the **harness identity and version as `UNKNOWN`** (Codex Desktop sets none of the variables it looks for — `install_shape` now names the layout instead, which is a filesystem fact and not an identity), and **context isolation was not proven** (`single-context`), which is the limit recorded as M4 in [maintenance.md](maintenance.md). |
| **post-merge through `gh`** | Implemented and its decision logic tested offline; the GitHub calls themselves have never run, because a disposable consumer has no remote and no PR. Tracked as M5 in [maintenance.md](maintenance.md). |
| macOS | Not run. Nothing in the code is macOS-specific and Linux now passes, but that is an argument, not a result. |

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
