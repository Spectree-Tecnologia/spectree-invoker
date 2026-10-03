<!-- GENERATED FILE — do not edit.
     Source: protocol/runtime/diagnose.md
     Rebuild: node scripts/build.mjs   ·   Verify: node scripts/build.mjs --check -->

# Diagnosis phase

Separate observed symptom, hypothesis and demonstrated cause. First construct a
command that reaches the reported symptom, rather than an unrelated failure.
Record its environment and candidate. For intermittent failures, record attempts
and failures instead of selecting a green rerun. A green CI does not explain a
local red result.

Reduce the reproduction and formulate competing falsifiable hypotheses. Change
one factor at a time; record the predicted and observed effect. Investigating to
construct a reproduction is allowed, but a plausible explanation remains a
hypothesis until tested. Confirm the original reproduction after any correction.
Add a regression at the public boundary and remove temporary instrumentation.
If the cause remains unknown, report inconclusive, with the next useful check.
