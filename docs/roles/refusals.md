# Refusals

**Example:** `scripts/lib/shared/guard.mjs` (`refuse`), `scripts/lib/evidence/ci-policy.mjs`
(returned answers).
**Guarded by:** `tests/roles.test.mjs` for the code names; each module's tests assert on `code`.

## Rules

- A refusal carries a **code**, and the code is the contract. The message is for a person.
- Codes are upper snake case with a severity prefix:
  - `E_` refuses: the action did not happen, or the answer cannot be trusted;
  - `W_` asks for review: the action may proceed, a person should look;
  - `I_` informs.
- A function asked to do something it must not do throws through `refuse(code, message)`, which
  is an `Error` with `code` set.
- A function that answers a question its caller acts on returns the answer instead:
  `{ ok: true, ... }` or `{ ok: false, code, message }`. The caller reads `ok` and `code`.
- A CLI prints a refusal on stderr as `<code>: <message>` and exits `1`. When an unexpected error
  has no code, the CLI supplies its own fallback, such as `E_DELIVERY` or `E_TASK`.
- Results of an execution are not codes: `PASS`, `FAIL`, `INFRA_ERROR`, `NOT_RUN`,
  `EXPECTED_REJECTION` and `INCONCLUSIVE` are verdicts, and they keep their own names.

## Never

- Never branch on a message. Runtime code reads `e.code` or `result.code`, and tests assert the
  code, so rewording a message breaks nothing.
- Never refuse with a bare `throw new Error(...)`: a caller cannot tell it apart from a defect.
  A bare error is for a defect only, such as a broken schema in `shared/validate.mjs`. The
  argument checks in `console/server.mjs` still throw bare errors; that is debt (D-011), not an
  example.
- Never return `ok: false` without a code, and never reuse a code for a different reason. Add a
  new code instead.
- Never turn a refusal into a success to keep a flow moving. Let the code reach the caller.
