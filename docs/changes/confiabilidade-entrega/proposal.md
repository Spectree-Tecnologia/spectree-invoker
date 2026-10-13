# Confiabilidade de Entrega — 1.13

Approved in the Founder session on 2026-10-12, following the read-only Sindy audit.
Implementation belongs to the Invoker; all executable validation uses disposable canaries.

## Scope

1. A delivery profile binds a full-suite command, exact test inventory and scenario mapping
   to the current candidate. A single observed TAP run answers multiple scenario checks.
   Missing, duplicate, skipped, failed, truncated or stale results never satisfy delivery.
2. The structured deferred ledger generates its Markdown view. Explicit change/state
   deadlines block at their milestone; informational and future items remain visible.
   Corrupt ledgers and divergent views are refused, not interpreted as empty.
3. Closure preflight discovers active/archived plans and checks the ledger before mutation.
   Existing durable closure recovery remains authoritative. Operational observations stay
   under .spectree; candidate hashing is not weakened to accommodate arbitrary logs.
4. Reporter preflight uses real positive and negative runner output. Each suite invocation
   receives a unique test namespace. Read-only metrics distinguish infrastructure failures,
   first-attempt acceptance and elapsed delivery/closure time from model cost and human wait.

## Compatibility and limits

Existing consumers keep their gates until explicitly enabling delivery version 1 in
.spectree/project.json. Enabling requires a delivery section in the change's verification
plan; missing plans fail closed. New protocol guidance uses this profile. No consumer is
installed or modified by this producer cycle. TAP is the supported reporter; no arbitrary
JSON/JUnit conversion is silently trusted. Declared inventory is a reviewed contract, not
automatic proof that a runner discovered every test in a language. Consumer test harnesses
must actually use the namespace for database isolation. Local reports are not signatures
against an administrator rewriting state and do not replace independent QA or remote CI.

## Acceptance

- Real node:test output: complete success passes; a missing scenario, omitted auxiliary
  test, skip, assertion failure, crash, duplicate name and truncated report refuse.
- Candidate, plan, contract or captured output changes invalidate recorded results.
- A newer failure or interrupted run cannot be hidden by an older success.
- Ledger view drift and a due obligation refuse; a future obligation does not.
- Closure carries opened_by_change items and refuses unreadable ledgers before consolidation.
- Discovery works after archive; repeated/resumed preparation retains existing recovery tests.
- Canary namespaces differ across concurrent invocations; metrics expose missing data as null.
- Build drift, plugin integrity and the entire existing regression suite remain green.
