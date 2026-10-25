---
name: squad-code-smells
description: The baseline the squad's review applies on the standards axis when the project's own conventions say nothing — twelve code smells, each a labelled suggestion with its fix. Load for the standards axis of Quality Engineer pass 2 and of any review.
user-invocable: false
---

<!-- GENERATED FILE — do not edit.
     Source: protocol/skills/squad-code-smells.md
     Rebuild: node scripts/build.mjs   ·   Verify: node scripts/build.mjs --check -->

# Code smells: the standards baseline

The standards axis of a review asks whether the code is written the way this project writes code. On module 1 the project has no roles yet, so the axis would come back empty exactly when it matters most. This baseline fills it. Adapted, with attribution, from the smell baseline of Matt Pocock's `code-review` skill (MIT), after Fowler's *Refactoring*, chapter 3.

## Order of authority

1. **The project's roles and conventions.** Where they endorse something below, the smell is suppressed.
2. **The invariants of Section 5.** These are not smells: a violation is a finding with a failing check behind it — the boundary check, a test — and only then a blocker.
3. **This baseline.** Every smell is a **suggestion**, never a blocker, whatever the evidence looks like. Skip anything a linter or formatter the project runs already enforces.

## The twelve

Match each against the diff. A smell already covered by an invariant points at it, and is reported as that invariant when a check fails.

- **Mysterious name** — a name that does not say what it does or holds, or that uses a word the subdomain's `_Avoid_` list rejects. → rename it with the term from `docs/DOMAIN.md`.
- **Duplicated code** — the same logic shape in more than one hunk. → extract it once; across two flows of one aggregate, it is a domain service (5.7).
- **Feature envy** — a function that reads another object's data more than its own. → move it onto that data. Across modules, it is a command reaching into a neighbour (5.5).
- **Data clump** — the same few fields always travelling together. → a value object waiting to be born.
- **Primitive obsession** — a string or number standing in for a domain concept. → its own value object, carrying its rule (5.7).
- **Repeated switch** — the same branching on the same type in several places. → one map, or polymorphism, shared by both sites.
- **Shotgun surgery** — one logical change forcing edits across many files. → gather what changes together; across modules, ask whether one concept has two representations.
- **Divergent change** — one file edited for several unrelated reasons. → split it so each part changes for one reason.
- **Speculative generality** — a parameter, hook or abstraction no `Scenario` asks for, including a port with one adapter and no fake. → inline it until a real need shows.
- **Message chain** — `a.b().c().d()` that a caller should not depend on. → one method on the first object hides the walk.
- **Middle man** — a function or class that only delegates. A use case that only forwards a query to its repository is this smell (5.7). → call the real target.
- **Refused bequest** — an implementation that ignores most of what it inherits. → composition instead of inheritance.

## A finding

One line each, so the axis can be counted:

```
possible <smell> · <file>:<line> · "<quoted hunk>" · <the fix, one line> · suggestion
```

The axis is reported even when it has nothing, as `standards: no finding against the baseline` — an empty axis and an unreviewed one must not read the same.
