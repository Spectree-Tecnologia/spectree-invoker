---
name: squad-deepening-scan
description: How the Solutions Architect scans a project for deepening opportunities — shallow code inside a module that makes the next change harder — and returns ranked candidates, each one a deltaless change waiting for its gate 1. Load when the Invoker dispatches a deepening scan.
user-invocable: false
---

<!-- GENERATED FILE — do not edit.
     Source: protocol/skills/squad-deepening-scan.md
     Rebuild: node scripts/build.mjs   ·   Verify: node scripts/build.mjs --check -->

# Deepening scan: finding where a module got shallow

Nothing in the pipeline asks whether a module's code got harder to change. Each change does what it promised and closes green, and the friction piles up in the same places, one defensible diff at a time. This scan looks for it on purpose and proposes the refactors that pay it back. Adapted, with attribution, from Matt Pocock's `improve-codebase-architecture` and `codebase-design` skills (MIT).

## The vocabulary, kept apart from ours

In this squad a **module** is a business capability (Section 5), and that meaning does not change here. What Matt Pocock's vocabulary calls a module is anything with an interface and an implementation. Here that is a **unit**: a function, a class, a use case, an aggregate's folder.

- **Interface**: everything a caller must know to use a unit correctly, including its invariants, error codes and ordering. It is more than its signature.
- **Deep**: a lot of behaviour behind a small interface. **Shallow**: an interface almost as large as what it hides.
- **Seam**: where a unit's interface lives, the place behaviour can change without editing the callers. A **port** is a seam. A port with a production adapter and a test fake is a real seam; a port with one adapter and no fake is indirection.
- **Locality**: a change, a bug or a rule lives in one place. **Leverage**: one implementation serves many callers and many tests.

## Where to look

- **Scope before you scan.** Deepening pays back on the code that will change again. Look where the Invoker's dispatch points: a direction he names, a module a retro flagged twice, or the hot spots he read off `git log` — the files the last stretch of history kept touching. You have no shell, so the hot spots arrive in the dispatch. Scattered history with no hot spot means a wider net, not a scan of everything.
- **Read before you judge.** Read `docs/DOMAIN.md` for the names a deepened unit should carry and `docs/DECISIONS.md` for what was already settled. A candidate that contradicts a recorded decision is raised only when the friction is real enough to reopen it, and then it cites the `D-<n>` it reopens.

## What to look for

- **A rule the model should carry, living in use cases.** An entity reduced to getters and setters, with each use case remembering to validate (5.7).
- **A use case that only forwards to its repository.** A query dressed as a command (5.7).
- **A flat core.** Entities side by side with no aggregate folder, so nobody can say what changes together (5.7).
- **One concept spread across many small units.** Understanding it means bouncing between files that each hold one line of it.
- **A calculation duplicated across two flows.** It is a domain service waiting to be born (5.7).
- **Code that is hard to test through its interface,** or that is only tested past it.

Apply the **deletion test** to each suspect. Imagine the unit gone: if its complexity vanishes, it was a pass-through and inlining it is the deepening. If the complexity reappears across its callers, it was earning its keep, and it stays.

**A boundary violation is not a candidate.** A command crossing modules, an entity escaping its module, a business concept in `shared`: those are Section 5 invariants. They are findings with a failing check behind them, and they go to the Quality Engineer's lens and the boundary check, not to a ranked list of suggestions.

## The result

Deliver it to the Invoker in your round, one block per candidate:

```
Candidate <n>: <the module and the units involved, named in the subdomain's language>
Problem: <the friction, with the evidence: the files, the hot spot, the retro finding>
Change: <what moves, in plain words; no new interface designed yet>
Pays back: <in locality and leverage, and how the tests would get simpler>
Tested by: <the dependency class from `squad-test-quality`, and where the seam goes>
Strength: <Strong | Worth exploring | Speculative>
```

End with the one you would do first, and why.

- **A candidate taken becomes a deltaless change** with its own proposal, tasks and gate 1, or a standing-policy approval where the roadmap item allows it. Nothing externally observable moves, so its exit criterion is the existing suite green.
- **Tests are replaced, not layered.** Once tests at the deepened unit's interface exist, the tests on the shallow units they replace are waste. In a deltaless change, deleting a test is a question. The proposal answers it by naming each test removed and the interface test that now proves the same property.
- **An empty scan is a result.** Say what was read and that nothing earned a place.
