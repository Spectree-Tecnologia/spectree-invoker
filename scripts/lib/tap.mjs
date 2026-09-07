// A TAP reader, for the one question free text cannot answer: did the test we named actually
// run, and did it fail?
//
// Substring matching on output was the previous answer, and it is satisfied by a stack trace,
// an echoed source line, or a log message that happens to contain the word. `const
// ACCOUNT_NAME_REQUIRED = ;` is a syntax error whose diagnostic prints the identifier, and no
// test ran at all. A plan, a numbered result line and a matching count are structure.
//
// Structure only holds if the parse respects the format's shape, and that shape is a TREE, not
// a set of indentation levels. Two sibling `describe` blocks both live at indent 4 and each
// carries its own plan and its own numbering starting at 1 — keying anything by depth either
// rejects that legitimate output as "two plans at the same level", or, worse, adds the results
// of one group to the other until some plan appears satisfied. So each nested document is its
// own group: opened when the indentation deepens, closed when it comes back, validated alone.
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
const SUBTEST = /^(\s*)#\s*Subtest:/;

const indentOf = (line) => /^\s*/.exec(line)[0].length;

/**
 * @returns {{ groups: object[], bailout: string|null, problems: string[] }}
 * Each group is one nested TAP document: `{ indent, line, plan, planFrom, results }`.
 */
export function parseTap(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const groups = [];
  const problems = [];
  let bailout = null;
  let yamlAt = null;

  const open = (indent, line) => {
    const g = { indent, line, plan: null, planFrom: null, results: [], parentResult: null, awaiting: null };
    groups.push(g);
    return g;
  };
  const stack = [open(0, 0)];
  const top = () => stack[stack.length - 1];

  /**
   * Put a line at its indentation, opening and closing groups as needed, and return the group
   * it belongs to. Closing a group leaves its parent owed one result — the verdict the parent
   * prints for that subtest.
   */
  const locate = (indent, lineNo) => {
    while (stack.length > 1 && indent < top().indent) {
      const closed = stack.pop();
      const parent = top();
      if (parent.awaiting) {
        problems.push(`the group starting at line ${parent.awaiting.line} closed without a result in its parent`);
      }
      parent.awaiting = closed;
    }
    if (indent > top().indent) stack.push(open(indent, lineNo));
    return top();
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    if (yamlAt !== null) {
      const close = YAML_CLOSE.exec(raw);
      if (close && close[1].length === yamlAt) yamlAt = null;
      continue; // a diagnostic can say anything, including "not ok 1 - something else"
    }
    const yaml = YAML_OPEN.exec(raw);
    if (yaml) { yamlAt = yaml[1].length; continue; }

    const bail = BAILOUT.exec(raw);
    if (bail) { bailout = bail[1] || 'no reason given'; continue; }

    // `# Subtest: <name>` announces a child, at the indentation of the document announcing it.
    // It is the only line that marks an intermediate level BEFORE anything is reported in it,
    // and without it `describe > describe > it` jumps straight from indent 0 to indent 8: the
    // middle group would not exist yet when its child closed, and the child would be attached
    // to the wrong parent. A comment is not a result, so this opens context and records nothing.
    const marker = SUBTEST.exec(raw);
    if (marker) { locate(marker[1].length, i + 1); continue; }

    const plan = PLAN.exec(raw);
    const res = plan ? null : RESULT.exec(raw);
    if (!plan && !res) continue; // other comments, `TAP version`, blank lines, free text

    // The indentation of a structural line decides which document it belongs to. Deeper opens
    // a new group; shallower closes every group deeper than it. Coming back to a depth that
    // was closed opens a NEW group, because that is a sibling and not a continuation.
    locate((plan ? plan[1] : res[1]).length, i + 1);

    if (plan) {
      const from = Number(plan[2]);
      const to = Number(plan[3]);
      if (top().plan !== null) {
        problems.push(`the group starting at line ${top().line} declares two plans; that is not one TAP document`);
      } else {
        top().plan = to - from + 1;
        top().planFrom = from;
      }
      continue;
    }

    const rest = NUMBERED.exec(res[3] ?? '');
    const owed = top().awaiting;
    top().awaiting = null;
    const label = rest[2] ?? '';
    const directive = /#\s*(TODO|SKIP)\b/i.exec(label)?.[1]?.toUpperCase() ?? null;
    const entry = {
      ok: !res[2],
      number: rest[1] ? Number(rest[1]) : null,
      name: label.replace(/\s*#\s*(TODO|SKIP)\b.*$/i, '').trim(),
      directive,
      group: top(),
    };
    top().results.push(entry);
    if (owed) owed.parentResult = entry;
  }

  // Anything still open at the end never closed, and never got its result either.
  while (stack.length > 1) {
    const closed = stack.pop();
    if (!top().awaiting) top().awaiting = closed;
  }

  if (yamlAt !== null) problems.push('a diagnostic block was never closed, so the rest of the output could not be read');
  return { groups, bailout, problems };
}

const fail = (reason) => ({ result: 'INFRA_ERROR', reason, matched: null });

const describe = (g) => (g.indent === 0 ? 'the run' : `the group starting at line ${g.line}`);

/** Every group is a document of its own: its plan, its results and its numbering must agree. */
function validate(tap) {
  for (const p of tap.problems) return p;

  // The root is ALWAYS checked, including when it is empty. Skipping empty groups was how a
  // stream cut off after a subtest's own plan passed: the subtest added up, and the document
  // that should have reported it had neither a plan nor a result to be missing from.
  const [root] = tap.groups;
  if (root.plan === null && root.results.length === 0) {
    return tap.groups.length > 1
      ? 'the run reported subtests but never closed: no plan and no result at the top level, so the output stops before the run finished'
      : 'the output carries no test plan: nothing enumerated any tests, so nothing ran';
  }

  for (const g of tap.groups) {
    if (g.indent > 0) {
      if (g.parentResult === null) {
        return `the group starting at line ${g.line} has no result in its parent, so nothing reports whether it finished`;
      }
      // The parent's result IS the subtest's verdict. If it disagrees with what the subtest
      // reported, the two halves of the document describe different runs.
      if (g.results.some((r) => !r.ok && !r.directive) && g.parentResult.ok) {
        return `the group starting at line ${g.line} reported a failing test, and its parent recorded it as passing`;
      }
    }
    const where = describe(g);
    if (g.plan === null) {
      return `${where} reported ${g.results.length} result(s) with no plan of its own, so there is nothing to check them against`;
    }
    if (g.planFrom !== 1) {
      return `${where} declares a plan starting at ${g.planFrom}; only "1..N" is supported, and an unsupported shape is refused rather than half-read`;
    }
    if (g.plan === 0 && g.results.length === 0) {
      return `${where} planned zero tests; an empty suite is not a failing suite`;
    }
    if (g.results.length !== g.plan) {
      return `${where} planned ${g.plan} test(s) and reported ${g.results.length}: it did not finish`;
    }

    const numbers = g.results.map((r) => r.number);
    if (numbers.some((n) => n === null)) {
      return `${where} reported a result with no number, and an unnumbered result cannot be placed in the plan`;
    }
    const seen = new Set(numbers);
    if (seen.size !== numbers.length) {
      return `${where} reported the same test number twice, so the results do not line up with the plan`;
    }
    for (let n = 1; n <= g.plan; n++) {
      if (!seen.has(n)) {
        const outside = numbers.filter((x) => x < 1 || x > g.plan);
        return outside.length
          ? `${where} planned 1..${g.plan} and reported test ${outside.join(', ')}, which is outside it`
          : `${where} planned 1..${g.plan} and never reported test ${n}`;
      }
    }
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

  const named = tap.groups.flatMap((g) => g.results).filter((r) => r.name === expected);
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
  return { result: 'PASS', reason: `"${only.name}" ran and failed`, matched: { ok: only.ok, number: only.number, name: only.name } };
}
