// A TAP reader, for the one question free text cannot answer: did the test we named actually
// run, and did it fail?
//
// Substring matching on output was the previous answer, and it is satisfied by a stack trace,
// an echoed source line, or a log message that happens to contain the word. `const
// ACCOUNT_NAME_REQUIRED = ;` is a syntax error whose diagnostic prints the identifier, and no
// test ran at all. A plan, a numbered result line and a matching count are structure.
//
// But structure only holds if the parse respects the format's blocks. A TAP diagnostic is a
// YAML document indented under its result, and it can contain anything — including a line that
// reads exactly like a result. Reading line by line and matching a pattern lets a failing
// test's own error message declare a different test failed. So this parser tracks context:
// YAML blocks are skipped entirely, plans and results are collected per indentation level, and
// every level is validated. What it cannot parse, it refuses; it never half-accepts.
//
// TAP because it is the format the widest set of runners already emit — `node --test`, pytest
// with a TAP reporter, prove, tape. A runner that emits something else needs a reporter or a
// converter: reading from a file changes where the TAP comes from, never what it is.

const RESULT = /^(\s*)(not\s+)?ok\b(.*)$/;
const NUMBERED = /^\s*(\d+)?\s*(?:-\s*)?(.*)$/;
const PLAN = /^(\s*)(\d+)\.\.(\d+)\s*$/;
const BAILOUT = /^\s*Bail out!\s*(.*)$/;
const YAML_OPEN = /^(\s*)---\s*$/;
const YAML_CLOSE = /^(\s*)\.\.\.\s*$/;
const IGNORED = /^\s*(#|TAP version\b|$)/;

const indentOf = (line) => /^\s*/.exec(line)[0].length;

/**
 * @returns {{ plans: Map<number, number>, results: object[], bailout: string|null, problems: string[] }}
 * `plans` and `results` are keyed by indentation, because a subtest is a nested TAP document
 * with a plan of its own and both levels have to add up.
 */
export function parseTap(text) {
  const plans = new Map();
  const results = [];
  const problems = [];
  let bailout = null;
  let yamlAt = null;

  for (const raw of String(text ?? '').split(/\r?\n/)) {
    if (yamlAt !== null) {
      const close = YAML_CLOSE.exec(raw);
      if (close && close[1].length === yamlAt) yamlAt = null;
      continue; // a diagnostic can say anything, including "not ok 1 - something else"
    }

    const open = YAML_OPEN.exec(raw);
    if (open) { yamlAt = open[1].length; continue; }

    const bail = BAILOUT.exec(raw);
    if (bail) { bailout = bail[1] || 'no reason given'; continue; }

    const plan = PLAN.exec(raw);
    if (plan) {
      const depth = plan[1].length;
      const count = Number(plan[3]) - Number(plan[2]) + 1;
      if (plans.has(depth)) problems.push(`two plans at the same level (indent ${depth}); the document is not one TAP stream`);
      else plans.set(depth, count);
      continue;
    }

    const m = RESULT.exec(raw);
    if (!m) {
      if (!IGNORED.test(raw)) continue; // free text between results is allowed by TAP
      continue;
    }
    const depth = m[1].length;
    const rest = NUMBERED.exec(m[3] ?? '');
    const number = rest[1] ? Number(rest[1]) : null;
    const label = rest[2] ?? '';
    const directive = /#\s*(TODO|SKIP)\b/i.exec(label)?.[1]?.toUpperCase() ?? null;
    const name = label.replace(/\s*#\s*(TODO|SKIP)\b.*$/i, '').trim();
    results.push({ ok: !m[2], number, name, directive, depth });
  }

  if (yamlAt !== null) problems.push('a diagnostic block was never closed, so the rest of the output could not be read');
  return { plans, results, bailout, problems };
}

const fail = (reason) => ({ result: 'INFRA_ERROR', reason, matched: null });

/** Every level that reported anything must have a plan, and the two must agree. */
function validate(tap) {
  for (const p of tap.problems) return p;

  const depths = new Set([...tap.plans.keys(), ...tap.results.map((r) => r.depth)]);
  if (depths.size === 0) return 'the output carries no test plan: nothing enumerated any tests, so nothing ran';

  for (const depth of [...depths].sort((a, b) => a - b)) {
    const at = tap.results.filter((r) => r.depth === depth);
    const where = depth === 0 ? 'the run' : `the subtests at indent ${depth}`;
    if (!tap.plans.has(depth)) return `${where} reported ${at.length} result(s) with no plan, so there is nothing to check them against`;
    const planned = tap.plans.get(depth);
    if (planned === 0 && at.length === 0) return `${where} planned zero tests; an empty suite is not a failing suite`;
    if (at.length !== planned) return `${where} planned ${planned} test(s) and reported ${at.length}: it did not finish`;

    const numbers = at.map((r) => r.number);
    if (numbers.some((n) => n === null)) return `${where} reported a result with no number, and an unnumbered result cannot be placed in the plan`;
    if (new Set(numbers).size !== numbers.length) return `${where} reported the same test number twice, so the results do not line up with the plan`;
  }
  return null;
}

/**
 * Did `expected` run and fail, in a run that actually completed? The name is matched exactly:
 * a substring can match two tests, and then the answer depends on which one the parser saw first.
 * @returns {{ result: 'PASS'|'FAIL'|'INFRA_ERROR', reason: string, matched: object|null }}
 */
export function judgeFailingRun(tap, expected, exitCode) {
  if (tap.bailout !== null) return fail(`the run bailed out (${tap.bailout}), so the tests never finished`);

  const bad = validate(tap);
  if (bad) return fail(bad);

  const named = tap.results.filter((r) => r.name === expected);
  if (named.length === 0) {
    return fail(`no test named "${expected}" appears in the results, so the Scenario was never exercised`);
  }
  if (named.length > 1) {
    return fail(`"${expected}" appears ${named.length} times in the results; which one is the Scenario cannot be decided here`);
  }

  const [only] = named;
  if (only.directive) return fail(`"${expected}" was ${only.directive}, and a test that did not run proves nothing`);
  if (only.ok) return { result: 'FAIL', reason: `"${expected}" ran and passed; pass 1 delivers a failing test`, matched: null };
  if (exitCode === 0) return fail('the run reported a failure and still exited 0: the two disagree, and neither can be trusted');
  return { result: 'PASS', reason: `"${only.name}" ran and failed`, matched: only };
}
