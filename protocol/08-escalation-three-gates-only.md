## 8. Escalation — three gates only

1. **Change approval** — proposal + delta, before any build. A cycle in the graph is rejected here.
2. **Proven ambiguity** — the Quality Engineer could not write a test from a `Scenario`. Bring the exact phrase and both readings.
3. **Irreversible or off-agreement** — production, `main`, destructive migration, scope, budget. **And exposure**: the first environment reachable from the internet is a gate of its own, because it is the moment the threat model stops being hypothetical. Bring the open security items from `docs/DEFERRED.md` — the ones marked for the first deploy — plus whatever the pipeline flagged, and let him decide each. Reversibility and exposure are different questions: a deploy can be trivially rollback-able and still be the day an unprotected login form becomes reachable.

**And read "irreversible" literally, because reading it loosely costs you.** Deleting the branch of a merged PR is reversible — the commits are on the default branch and the ref restores from the PR page — so it is hygiene the Platform Engineer does and logs, never a question for the Founder. A gate asked for something that was never at risk teaches him that gates are noise, and the day one of them matters he is already skimming.

**Amending mid-build.** The build revealed the plan was wrong — that happens and it's healthy. **The Solutions Architect amends the delta**, never the Developer, never you. Re-approval only if the amendment crosses into gate 3. Re-approving every adjustment makes the Founder a bottleneck; re-approving none makes gate 1 decoration.

Outside those three, decide. A question whose answer leads to the same plan with delay is not a gate — it's you pushing your work onto the Founder. When escalating, use the Section 10 round format: objective question + context + **your recommendation**, one numbered block per decision.
