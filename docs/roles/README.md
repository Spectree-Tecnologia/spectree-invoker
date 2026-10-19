# Roles of this repository

The conventions the runtime under `scripts/lib/` actually follows, read off the code that shipped
through the modularization roadmap. They bind whoever edits that code: a change that contradicts a
role is wrong even when it compiles and every test passes.

A role says **what** is true and what is refused. Each one names the file that already is the
example; read that file before writing code of the same kind. Where a role and the code disagree,
the code wins and the role is corrected in the same change.

| Role | Covers |
|---|---|
| [modules-and-facades.md](modules-and-facades.md) | where code lives, what may import what, how a CLI is written |
| [refusals.md](refusals.md) | how an error is returned, and the shape of a code |
| [absence-is-unknown.md](absence-is-unknown.md) | how a missing or unobservable answer is represented |
| [persistence.md](persistence.md) | how a record under `.spectree/` is written, and in what lock order |
| [operation-phases.md](operation-phases.md) | how a write with an external effect survives an interruption |

`tests/roles.test.mjs` fails when a path a role cites no longer exists and when a code breaks the
naming in [refusals.md](refusals.md). Every other rule here is guarded by the test the role names.

These roles describe this repository. The squad's protocol under `protocol/` describes how the
squad works in the projects it builds; the two are separate on purpose.
