---
name: squad-test-quality
description: How the squad writes a test worth keeping — where it goes, what it may fake, and the shapes that pass without proving anything. Load before writing or judging any test, in Quality Engineer pass 1 and pass 2 and in a Developer's implementation cycle.
---

# Test quality

A test exists to fail when its `Scenario` is broken. Everything below serves that one property, which this squad calls **discriminating**: red on the defect, green on the rule. Adapted, with attribution, from Matt Pocock's `tdd` and `codebase-design` skills (MIT).

## Where the test goes

A test crosses the module where a caller crosses it — the **seam** — and asserts what that caller can observe.

- **A rule of the core** is tested through its use case, with its ports given fakes through the constructor. No database, no framework, no network: the use case was built to be provable that way (Section 5.4).
- **An adapter** is tested through the module's published entry, against a local stand-in for the technology it wraps — a test database, an in-memory filesystem — never a mock of the driver.
- **A neighbour** is reached through its query contract, faked at that contract. Never import its internals to build a fixture.

The tell of a test placed past the seam: it changes when the implementation changes and the behaviour does not.

## What may be faked

Classify each dependency of the code under test, and the class decides:

| Dependency | In the test |
|---|---|
| In-process — pure computation, in-memory state | the real thing |
| Local and substitutable — the project's database, the filesystem | a local stand-in, run in the suite |
| Owned, behind a port — another module, a transaction, a clock | an in-memory fake of the port |
| Truly external — a payment provider, an email gateway, a paid model | a fake adapter behind the port; the live service never runs in the suite |

Your own module's classes are never mocked. A port with a production adapter and a test fake is a real seam; a port with only one adapter is indirection, and the Architect should hear about it.

## The shapes that prove nothing

- **Coupled to the implementation** — mocks an internal collaborator, asserts call counts or call order, tests a private function, or verifies through a side channel, such as querying the table instead of reading back through the interface.
- **Tautological** — the expected value is computed the way the code computes it (`expect(total(items)).toBe(items.reduce(...))`), so it agrees with the code by construction. The expected value comes from the `Scenario`, a worked example, or a known literal.
- **Shape instead of behaviour** — asserts that a field exists, that a function was exported, that a list is non-empty, where the `Scenario` names a value.
- **Never seen red** — a test nobody watched fail on the defect it targets. Pass 1 shows the red on the base revision; otherwise the mutation probe shows it, on a disposable copy.

## Done

A test is finished when it names its `Scenario`, crosses the seam above, takes its expected value from an independent source, and has been observed failing on the defect it exists to catch. One behaviour per test, named for what the caller gets (`rejects a blank account name`), never for how the code does it.
