---
name: squad-incident-response
description: How the squad works a security incident — an affected advisory, a leaked secret, a red security scan — from triage to a verified fix, with what the Invoker decides alone and what is gate 3 for the Founder. Load when a security watch returns `affected` or `unknown`, a secret scan or audit goes red, or someone reports suspicious activity.
---

# Incident response: triage, contain, fix, prove

An incident is not a reason to skip the pipeline; it is a reason to run it in a different order. The fix still travels as a change with a test, a green CI and a merge, because a hurried patch that nobody verified is the second incident. What changes is the priority, and which reversible steps happen before the change is cut.

## Who does what

- **The Invoker** triages, decides every reversible step, and is the only voice the Founder hears.
- **The Integration Engineer** brings the facts, through `squad-security-watch`. No fact, no verdict: an incident triaged from a headline is a guess.
- **The Platform Engineer** contains and operates: runtime and dependency versions, CI, credentials the squad holds, the merge.
- **The Quality Engineer** writes the failing test that proves the exposure and later its absence.
- **A Full Stack Developer** changes application code, when the fix lives there.

## 1. Triage, in one pass

| Priority | When | Pace |
|---|---|---|
| **P1** | exploited (KEV listed, vendor confirms, or seen in the project's logs) **and** reachable here | preempts the roadmap; the change is cut now |
| **P2** | reachable, no exploitation reported, or a public PoC | next change in the sequence |
| **P3** | not reachable, or the component is not deployed | a `docs/DEFERRED.md` item with a trigger, re-evaluated at the next watch |

`unknown` reachability is triaged as reachable. A leaked secret is P1 the moment it is in any commit, pushed or not.

## 2. Contain: what the Invoker decides alone, and what is gate 3

**Reversible and inside the repository, the Invoker decides and records** (Section 3):
- raising a dependency or runtime to the fixed version, through a change;
- turning off a feature or an integration the project controls, through a change;
- rotating a credential that only reaches a development or CI environment;
- adding a check that refuses the vulnerable version.

**Gate 3, one question to the Founder, with the concrete risk in one line and a recommendation** (Sections 8 and 10):
- anything that touches production: a deploy, a rollback, taking a service offline;
- revoking or rotating a credential that production uses;
- rewriting history on the default branch, which also never un-leaks a secret: the secret is rotated first, and the rewrite is a separate decision;
- any message outside the project: a customer, a vendor, an authority.

Under pressure, the gate is not skipped. The fastest route that still passes it is offered instead.

## 3. Fix, as a change

- **Deltaless when no behaviour changes** (a version bump, a configuration), with the existing suite green as its exit criterion.
- **A discriminating test where the class allows it**: the Quality Engineer feeds the advisory's hostile input (a malformed stream, a crafted hostname, a planted token) and the test fails on the vulnerable revision and passes on the fix. It runs only on a disposable copy, never against a live service.
- **A check that keeps it closed**: the version floor, the audit level or the scan rule that would have caught it, seen refusing the incident's own input before it counts.

## 4. Prove and close

The incident closes on commands, not on the fix being merged: the audit no longer lists the advisory, the runtime reports the fixed version where it runs, the rotated credential is refused at the old value. Each is a command the Invoker ran, with its output. What could not be proven, such as a production host nobody can reach, stays open in `docs/DEFERRED.md` with its owner.

Then the change gets its retro like any other. **How did this reach us** is the first question it answers: a watch that ran late, an inventory that missed a component, a floor that allowed the vulnerable version.

## Never

- Never run an exploit against anything but a disposable copy.
- Never disable a check, lower an audit level or allowlist an advisory to get green. An accepted risk is a `docs/DEFERRED.md` item with the Founder's decision, never a silenced tool.
- Never put the secret, the exploit payload or the vulnerable endpoint in a commit, an issue or a message.
