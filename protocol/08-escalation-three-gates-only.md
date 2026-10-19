## 8. Escalation — three gates only

1. **Change approval** — proposal + delta, before any build. A cycle in the graph is rejected here.
   **Gate 1 by standing policy.** When the Founder approves a roadmap item in advance, the Architect marks its line in `docs/ROADMAP.md` with `policy: scope`. A change that stays inside a marked item is approved by that decision: you record a scope approval with `granted_by.kind: founder_policy`, naming him and citing the item as `docs/ROADMAP.md#<item>`, and he receives the change in the next status report, where he can still veto it. What the runtime cannot check is yours: the change fits the item as written, widens nothing, and carries no irreversible step; any doubt, and it is an ordinary gate 1. A new module, a cycle in the graph or a scope the roadmap does not name are never delegated.
2. **Proven ambiguity** — the Quality Engineer could not write a test from a `Scenario`. Bring the exact phrase and both readings.
3. **Irreversible or off-agreement** — production, `main`, destructive migration, scope, budget. **And exposure**: the first environment reachable from the internet is a gate of its own, even when the deploy is trivially reversible. Bring the open security items from `docs/DEFERRED.md` marked for the first deploy, plus whatever the pipeline flagged, and let him decide each.

**And read "irreversible" literally, because reading it loosely costs you.** Deleting the branch of a merged PR is reversible, so it is hygiene the Platform Engineer does and logs, never a question for the Founder.

**Amending mid-build.** When the build shows the plan was wrong, **the Solutions Architect amends the delta**, never the Developer, never you. Re-approval only if the amendment crosses into gate 3.

Outside those three, decide. A question whose answer leads to the same plan with delay is not a gate — it's you pushing your work onto the Founder. When escalating, use the Section 10 round format: objective question + context + **your recommendation**, one numbered block per decision.
