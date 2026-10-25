---
name: squad-closure-retro
description: The retrospective the Invoker runs after a change reaches `closed` — what in the project's environment let a mistake through or cost an attempt, ranked by severity, each with its evidence, its fix and its owner. Load once the change is closed, never inside the post-merge confirmation.
---

# Closure retro: the squad learns from the change it just closed

A closure confirms and archives; on its own it learns nothing. The same mistake caught late on one change is caught late again on the next, until somebody writes it down — and what gets written down is usually one more paragraph every agent reads on every turn. This retro turns what the closed change went through into improvements of the **project's environment**: a check first, a line in a role only where no check could do the job, and a cut where an instruction changed nothing. Adapted, with attribution, from Matt Pocock's `retro` skill (MIT).

## When, and what it never does

- **After `closed`, never before.** The post-merge phase is a confirmation, and it is finite (Section 7). The retro is not part of it, and it does not reopen the change.
- **It records; it fixes nothing.** Each finding is a proposal with an owner. A fix enters the repository through a change of its own, or through the next proposal that passes gate 1 — a discovery outside the scope earns a record and a referral, never implicit permission to fix it on the spot.
- **It asks the Founder nothing.** Every finding is about how the squad works, which is the squad's job. He reads the result as lines in the status report.

## Evidence, read from artifacts

Read the change's trail, not your memory of the session: the work checkpoints and their reconciliations, `.spectree/runs/<change>/`, the diagnosis and review records, every refused handoff, the attempts each task spent and any ceiling hit, every red CI run with its head, the Quality Engineer's findings, any gate 2, and the deviations recorded. **A candidate without a record behind it is not a finding.**

Start from what was measured: `retro.mjs collect <pr> --apply` reads the merged PR, its CI runs per commit, the merge's commits and archive, and the PR's **Atrito** section, and records them in `.spectree/retros/` with the known finding signatures they match. A matched signature is a candidate for you to judge, never a finding by itself, and an empty match is not a clean change.

Then read what came back: `retro.mjs trends` counts each finding signature across every retro already written. A signature in two retros that nobody marked paid is a second recurrence, and it earns a change of its own instead of another line; an open one that no retro has named in the last three is a candidate to close. Both are candidates; the judgement is still yours.

## What to look for

Each category says what to look for, then what to propose.

- **Automated checks.** Look for a mistake that was caught late (by pass 2, by CI, by your own verification), or not caught at all, when a deterministic check would have caught it at the step that made it. Read the project's own check command and CI workflow first: a check that exists but is unwired or silently broken is the finding, not a reason to write a new one. → A **mechanical** violation (a fixed pattern, a banned import, a file in the wrong place) gets a check: a lint rule, a script in CI, a test. It never gets a rule in a role. Before the check counts, it must be seen rejecting the incident's own input.
- **Review standards.** Look for a mistake pass 2 or the review missed that no check could catch, because it is a judgement: consistency across files, or "matches the surrounding code". → One line in the project's role, where the Platform Engineer's re-verification keeps it true. It never goes into an instruction every agent reads on every turn.
- **Navigation.** Look for a dispatch that spent attempts finding the file that already was the pattern, or a mandatory reading that left it out. → The file goes into the mandatory reading of that kind of dispatch, or a project skill gains a pointer to it.
- **Information access.** Look for a fact that was missing when it was needed: a `not found`, logs nobody could read, a gate 2 born from a missing fact rather than an ambiguous phrase. → The source or the read-only access that would have answered it.
- **Tool economy.** Look for a ceiling hit, a re-dispatch, or a command that answered with noise: a search that also matched `node_modules`, or output too long to read. → A narrower command, or a project script that answers in one line.
- **No-ops.** Look for a line in a role or a project skill that nothing in this change depended on: a rule nobody followed while nothing failed. → Cut it. A role loses force with every line that binds nothing.
- **The squad's own method.** Look for a gap in a card, a squad skill or the runtime, not in the project. → It is not the project's to change. Report it as a squad finding.

## The result

Order the findings by severity:

1. what let a defect reach integration;
2. what cost an attempt, a re-dispatch or a ceiling;
3. what cost a turn.

Each finding is one line:

```
<severity> · <category> · `<category-slug> · <area> · <pattern>` · <evidence: file or record> · <what happened> · <proposed fix> · owner: <Platform Engineer | Architect | Invoker | change of its own | squad>
```

- **The signature is how a finding is recognised next time.** Reuse the one an earlier retro gave the same pattern, so `trends` counts it once per retro instead of as a new finding.
- **The retro itself is a file, and the runtime holds it to that.** Write it to `docs/retros/<date>-<change>.md` with a line `Change: \`<change>\`` and a section `## What was read`, then record it: `state.mjs run <change> retro.recorded --role invoker -- node <squad>/scripts/retro.mjs check <change> <file>`. Until that run passes, `state.mjs plan` answers `record_retro` for the closed change and `state.mjs open` refuses the next one with `E_RETRO_PENDING`. Only a person waives it, with `--retro-waived "<reason>"`, and the reason stays on the change that opened.
- **Recording.** The Platform Engineer records the project's findings in `docs/DEFERRED.md` on the next branch he cuts, before any other write on it, each with a stable number and its owner. They are never committed straight to the default branch, because that is gate 3.
- **Reporting.** They reach the Founder under **Desvios registrados** in the next status report, one line each. Squad findings are marked as such.
- **An empty retro is a result.** Say so in one line, naming what was read. A change that produced no record of a single refused handoff, red run or extra attempt is either clean or unrecorded. Check which before saying "clean".
