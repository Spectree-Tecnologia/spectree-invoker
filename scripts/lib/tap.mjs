// A TAP reader, for the one question free text cannot answer: did the test we named actually
// run, and did it fail?
//
// Substring matching on output was the previous answer, and it is satisfied by a stack trace,
// an echoed source line, or a log message that happens to contain the word. `const
// ACCOUNT_NAME_REQUIRED = ;` is a syntax error whose diagnostic prints the identifier, and no
// test ran at all. A plan, a numbered result line and a matching count are structure: they say
// a harness enumerated tests, ran them, and finished.
//
// TAP because it is the format the widest set of runners already emit — `node --test`, pytest
// with a TAP reporter, prove, tape — and because it is line-oriented enough to read without a
// dependency. A runner that writes it to a file is read with `--report`.

const RESULT = /^(\s*)(not\s+)?ok\b\s*(\d+)?\s*(?:-\s*)?(.*)$/;
const PLAN = /^(\s*)(\d+)\.\.(\d+)\s*$/;
const BAILOUT = /^\s*Bail out!\s*(.*)$/;

/**
 * @returns {{ plan: number|null, cases: object[], allCases: object[], bailout: string|null }}
 * `cases` are top level only — that is what the plan counts. `allCases` includes subtests,
 * because the Scenario under test is often one.
 */
export function parseTap(text) {
  const out = { plan: null, cases: [], allCases: [], bailout: null };
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const bail = BAILOUT.exec(raw);
    if (bail) { out.bailout = bail[1] || 'no reason given'; continue; }

    const plan = PLAN.exec(raw);
    if (plan) {
      if (plan[1].length === 0 && out.plan === null) out.plan = Number(plan[3]) - Number(plan[2]) + 1;
      continue;
    }

    const m = RESULT.exec(raw);
    if (!m) continue;
    // A YAML diagnostic block is indented under its result line and may contain anything,
    // including the source that failed to parse. Names come from result lines only.
    const name = m[4].replace(/\s*#\s*(TODO|SKIP).*$/i, '').trim();
    const directive = /#\s*(TODO|SKIP)/i.exec(m[4])?.[1]?.toUpperCase() ?? null;
    const entry = { ok: !m[2], number: m[3] ? Number(m[3]) : null, name, directive, depth: m[1].length };
    out.allCases.push(entry);
    if (m[1].length === 0) out.cases.push(entry);
  }
  return out;
}

/**
 * Did `expected` run and fail, in a run that actually completed?
 * @returns {{ result: 'PASS'|'FAIL'|'INFRA_ERROR', reason: string, matched: object|null }}
 */
export function judgeFailingRun(tap, expected, exitCode) {
  if (tap.bailout !== null) {
    return { result: 'INFRA_ERROR', reason: `the run bailed out (${tap.bailout}), so the tests never finished`, matched: null };
  }
  if (tap.plan === null) {
    return { result: 'INFRA_ERROR', reason: 'the output carries no test plan: nothing enumerated any tests, so nothing ran', matched: null };
  }
  if (tap.plan === 0) {
    return { result: 'INFRA_ERROR', reason: 'the run planned zero tests; an empty suite is not a failing suite', matched: null };
  }
  if (tap.cases.length !== tap.plan) {
    return { result: 'INFRA_ERROR', reason: `the run planned ${tap.plan} test(s) and reported ${tap.cases.length}: it did not finish`, matched: null };
  }

  const named = tap.allCases.filter((c) => c.name.includes(expected));
  if (named.length === 0) {
    return { result: 'INFRA_ERROR', reason: `no test named "${expected}" appears in the results, so the Scenario was never exercised`, matched: null };
  }
  const failed = named.find((c) => !c.ok && !c.directive);
  if (!failed) {
    const skipped = named.find((c) => c.directive);
    return skipped
      ? { result: 'INFRA_ERROR', reason: `"${expected}" was ${skipped.directive}, and a test that did not run proves nothing`, matched: null }
      : { result: 'FAIL', reason: `"${expected}" ran and passed; pass 1 delivers a failing test`, matched: null };
  }
  if (exitCode === 0) {
    return { result: 'INFRA_ERROR', reason: 'the run reported a failure and still exited 0: the two disagree, and neither can be trusted', matched: null };
  }
  return { result: 'PASS', reason: `"${failed.name}" ran and failed`, matched: failed };
}
