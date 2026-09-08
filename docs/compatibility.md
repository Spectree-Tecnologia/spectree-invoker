# Compatibility — what was tested, and what was not

The two columns are kept apart on purpose. A CLI that ran is not a desktop app that ran, and
a rendered file is not a harness that loaded it.

## Tested here

| Surface | Version | How it was established |
|---|---|---|
| Node.js | 24.17.0 · 22.23.2 | the whole suite runs on both: 136 deterministic tests here, and the same suite in CI |
| Ubuntu 24.04 | GitHub runner | CI ran the full suite at the last pushed revision: **188 tests, 187 pass, 0 fail, 1 skipped** — the skip is the `cmd.exe` argument-transport test, which says it is Windows-only |
| Windows | win32/x64 | the suite ran here; the diff layer is exercised against real `git` with spaces and non-ASCII names |
| git | 2.54.0 | `readDiff` is tested against a real repository, including rename, deletion and a `-z` round trip |
| Protocol → adapters | — | `build.mjs --check` runs in CI; a hand edit to any generated file fails it |
| Package integrity | — | `check-plugin.mjs`, with fixtures proving each rule rejects |
| Claude Code desktop, plugin load | 0.14.0 @ `410a429` | the plugin is installed here and **this session exposes all five specialists as dispatchable agent types** — the harness read `agents/` and `commands/`. That is the previous commit, not this work: see the row below |
| **Claude Code desktop** | package 1.0.1 @ `5c67b31` | a session started after the update ran `/spectree:invoker` in an empty scratch project: it loaded the plugin's `CLAUDE.md` (401 lines), ran `capabilities.mjs`, and **reported the state it found instead of inventing one** — empty directory, no work tree, no approvals, no evidence, no pipeline to resume. It refused to invent a first change, emitted the interview round in the §10 format, and recorded the deviations (`context_isolation` declared not verified, `network` UNKNOWN, blast radius is protocol not sandbox, branch protection UNKNOWN) |
| **OpenAI Codex Desktop** | package 1.0.0 @ `dd8507b` | a real session on Windows 10.0.26200 (PowerShell 7.6.5, node 24.17.0, npm 11.13.0, git 2.54.0) discovered the installed skill in its own catalog, loaded `SKILL.md` and `.spectree/squad/SQUAD.md`, ran the installed `capabilities.mjs` and `state.mjs resume` (both exit 0), **dispatched a registered `platform_engineer` through the native multi-agent harness**, and the gate refused promotion with `E_MISSING_APPROVAL`. Native session authentication; no API, no key, no network service |
| Codex install | — | installed into a synthetic consumer that already had its own `AGENTS.md`: file preserved, pointer appended once, second run idempotent, and the installed `capabilities.mjs` and `state.mjs` **executed from inside that consumer** |
| Delivery cycle | — | one change open to `closed` with the closure **prepared on the branch**: the specs consolidated by the project's own command, the folder archived, one manifest, one `--no-ff` merge, and **zero commits after it** — asserted, including that the work tree is left clean |
| post-merge decisions | — | the confirmation driven through the CLI against a stubbed `gh`: a merge carrying a different tree is refused on content AND on ancestry; a merge that rewrote only the archived contract is refused; a prepared artifact altered in the merge is refused; two approvals cannot supply one criterion each, a failed/cancelled/never-reported/other-SHA run stops the closure, an unmapped CI is `E_CI_MAP_MISSING`, and a rerun after success repeats no event |
| Closure preparation | — | a blocker — committed, uncommitted, or the source of a staged rename — stops the consolidation from running at all, in the dry run too; the consolidation's own writes are held to the same ownership, committed or not; ticking a task refreshes the artifact record without re-preparing or invalidating anything; an incompatible manifest is refused without being overwritten, and refused again by the gate |
| CI policy | — | the classification is of the whole candidate: a log commit on top of a code change still classifies as `full`, while the last commit alone reads administrative. A required check that failed, was cancelled, or never reported can never aggregate to green |
| Gate cycle, through the CLI | — | one change driven **open to `closed`** by the installed commands in a synthetic consumer: a real branch, evidence produced by `state.mjs run`, both approvals, a real `git merge --no-ff`, the archival move, and the append-only history asserted step by step |
| Content binding | — | an uncommitted edit at an unchanged `HEAD` is refused with `E_CONTENT_CHANGED`; a `--no-ff` merge over an identical tree is the same candidate and passes; a merge that changes the tree is refused; ticking `tasks.md` or archiving the change moves neither digest |
| Runner semantics | — | `pass1.tests_failing` is satisfied only by TAP showing the named test failing in a completed run — a crash with no plan, a truncated plan, a `# SKIP` and a reported pass are each refused by name; no other property accepts a failing run; an imported document carrying a fingerprint is refused |
| Temporal binding | — | a run that edits the contract while being measured records `INCONCLUSIVE` against the contract it started from, and satisfies no gate afterwards; a report is read only from the path the run allocated and only if the run wrote it |
| TAP reading | TAP 13/14 subset | judged against real `node --test --test-reporter=tap` output — two sibling `describe` groups, and `describe > describe > it` whose first result sits at indent 8: each group is validated as its own document (own plan, own numbering from 1), diagnostics are skipped as blocks so a forged `not ok` inside a YAML error message is not a result, numbers must cover 1..N exactly, the top-level document must close and every subtest must be answered by an agreeing result in its parent (the same real output, cut off after the subtest plan, is refused), and the test name is matched exactly — unsupported shapes are refused, never half-accepted |
| Windows launchers | npm 11.13.0 | `state.mjs run -- npm test` executes in a synthetic consumer through `PATH`/`PATHEXT` resolution of the `.cmd` shim (skipped, and said so, where npm is absent) |
| Argument transport | — | thirteen arguments — empty, spaces, `&`, `\|`, `>`, `^`, `;`, parentheses, tab, accents, trailing backslash — arrive byte for byte through a `%*` shim, asserted together; `%`, `!` and `"` are refused with `E_ARGUMENT_UNTRANSPORTABLE` |
| Path handling | — | an untracked file whose name git escapes (accents, spaces) is read and its content counts; a path that is present and unreadable raises `E_CONTENT_UNAVAILABLE` instead of being hashed as a placeholder |
| Concurrency | — | two processes park on a barrier and are released together onto the same change: one lands, the other is refused with `E_CONCURRENT_UPDATE`, and only the winner appends a history event. Two `prepare-closure --apply` really run at once against one change: whatever the interleaving, the record on disk is one internally consistent preparation, the control's pointer names the document that exists, and no operation is left half open |
| Durable authority | — | a reopening retires the approval in the closure control, not only in the manifest: restoring the approved manifest **byte for byte** brings nothing back, and `resume`, `can`, `transition`, the preparation and the confirmation all give the same answer. A control that is corrupt, of another version, or belongs to another change **blocks** rather than reading as an empty list of retirements |
| Preparation identity | — | `preparation_digest` covers identity, contract, candidate, base, archive and the whole artifact inventory, and excludes the clock: the same preparation run later is the same preparation, a moved artifact is not, and a snapshot edited by hand is `E_PREP_TAMPERED`. An integration approval that names another preparation, another generation or another PR authorises nothing |
| Receipt-gated integration | — | `state transition <id> integrated` on its own is `E_INTEGRATION_NOT_OBSERVED`; only `post-merge --apply` writes the receipt that unlocks it, and a receipt for another PR, another merge or an older generation does not. Running the confirmation twice produces one receipt, one transition per step, and no commit |
| Recovery | — | a crash between starting the consolidation and observing its result is refused as `E_OPERATION_PENDING` with `uncertain: true`; the command is **not** re-run, `resume` prints the phase and the recovery, and the gates refuse to authorise over the half-applied set |
| Composed sequences | — | the four-command detour around a frozen record (alter the code → `stale` → re-prepare → restore → re-prepare) refuses at every step and the merge stays refused; a reopening survives identical digests and a restored manifest; a preparation on day D refreshes on day D+1 without emptying the record and the cycle still closes; a whole cycle leaves one merge commit and nothing after it |
| Migration | — | a v1 record is preserved byte for byte as history and never becomes an approved v2 preparation; the change is reported as needing a fresh preparation and approval; a corrupt record stops the migration; running it twice changes nothing; the installer carries it and never executes it |
| GitHub queries | — | every call is scoped by `--repo`, and runs by `--commit`/`--event`/`--workflow`. A full page of runs from other commits is reported as incomplete, never as "it did not run"; an older green attempt does not speak for the failing re-run that replaced it; a required job that is `skipped` is a refusal; an empty required set is `E_CHECK_SET_EMPTY` |
| Git representation | — | a symlink in the measured surface and an index with unmerged paths are refused by name rather than hashed; the executable bit is part of the content; a commit and the work tree that produced it digest the same |

`engines` declares `node >= 20.11.0`; 24.17.0 and 22.23.2 were actually exercised.

The suite is **231 deterministic tests**, and it writes nothing inside the package under test — a regression asserts that, because an earlier version of the drift test edited `CLAUDE.md` in place and made the suite unrunnable under read-only authorisation.

## Implemented, real validation pending

| Surface | Status |
|---|---|
| **OpenAI Codex — what the smoke did not cover** | The bounded smoke covered boot, dispatch and one refusal on a disposable fixture. It was **not** a delivery cycle, a deploy, or proof across every Codex harness. Two things stayed open in it and are open still: the installed diagnostic reported the **harness identity and version as `UNKNOWN`** (Codex Desktop sets none of the variables it looks for — `install_shape` now names the layout instead, which is a filesystem fact and not an identity), and **context isolation was not proven** (`single-context`), which is the limit recorded as M4 in [maintenance.md](maintenance.md). |
| **post-merge against real GitHub** | The decisions are exercised through the CLI against a stubbed `gh` — the transport is stubbed; the digests, ancestry, aggregate, receipt and transitions are real, and the stub honours `--commit`, `--event` and `--workflow` so a query that never applied them cannot look correct. The **live** `gh` calls have never run: a disposable consumer has no remote and no PR. The field names were corrected against the real CLI (`gh pr view --json merged` does not exist; the state is `MERGED` with `mergedAt`); `gh pr checks` exiting 8 for pending is handled as an answer rather than a transport failure, and that too is untested against the real CLI. Tracked as M5 in [maintenance.md](maintenance.md). |
| **Delivery time** | Nothing here measures wall clock against a real GitHub queue. The confirmation reports its own `gh_calls`, `git_calls`, `elapsed_ms` and `log_bytes`, and the structural claims — one PR, one merge, no post-merge commit, no rerun caused by recording a green — are asserted. "Under five minutes" remains a hypothesis; a single observation would be an observation, not a p95. |
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
