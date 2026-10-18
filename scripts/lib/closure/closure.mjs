// Closure checks: what a change owes before it can be called closed.
//
// Two beliefs are removed here on purpose.
//
//   "a test was edited, therefore behaviour changed"  — false. Imports move, fixtures
//   grow a field, a file gets renamed. What matters is whether an expectation was
//   WEAKENED, and that is a review, not a file-name match.
//
//   "no test was edited, therefore behaviour did not change"  — also false. A change
//   can alter behaviour that no test ever covered. Untouched tests prove the suite
//   was not adjusted; they prove nothing about equivalence.
//
// So this module reports findings for a human or an adversarial pass to judge, and it
// says out loud which of its answers are mechanical and which are not.

import { KIND } from '../evidence/index.mjs';

export const DELTA_OPS = ['RENAMED', 'REMOVED', 'MODIFIED', 'ADDED'];

/** Deltaless closure. Returns findings; the caller decides. */
export function checkDeltaless(diff, { declaredDeltaless, hasSpecFolder }) {
  const findings = [];

  if (declaredDeltaless && hasSpecFolder) {
    findings.push({
      code: 'E_DELTALESS_CONTRADICTION', severity: 'error', mechanical: true,
      message: 'the change declares itself deltaless and ships delta files; one of the two halves was written without meaning it',
    });
  }
  if (!declaredDeltaless && !hasSpecFolder) {
    findings.push({
      code: 'E_UNDECLARED_EMPTY_SPECS', severity: 'error', mechanical: true,
      message: 'no specs/ folder and no deltaless declaration — indistinguishable from a delta somebody forgot; declare the intent',
    });
  }
  if (declaredDeltaless && diff.tests.length > 0) {
    findings.push({
      code: 'W_DELTALESS_TESTS_TOUCHED', severity: 'review', mechanical: false,
      message: `${diff.tests.length} test file(s) changed under a deltaless change. Not an error by itself: read each and justify it.`,
      detail: diff.tests.map((t) => ({ path: t.path, status: t.status })),
      review_questions: [
        'was any expectation weakened, loosened, skipped or deleted to obtain a pass?',
        'is each edit explained by an import move, a fixture shape or a rename — and does the assertion still assert the same property?',
        'if an expectation genuinely changed, the change needed a delta and this is the wrong shape.',
      ],
    });
  }
  if (declaredDeltaless && diff.tests.length === 0) {
    findings.push({
      code: 'I_TESTS_UNTOUCHED', severity: 'info', mechanical: true,
      message: 'no test file changed. This shows the suite was not adjusted; it does not by itself demonstrate behavioural equivalence.',
    });
  }
  return findings;
}

/** The proposal names the modules that will carry a delta. The two sets must match. */
export function checkProposalDeltaContract(modulesNamed, deltaModules) {
  const named = new Set(modulesNamed), present = new Set(deltaModules);
  const findings = [];
  for (const m of named) if (!present.has(m)) findings.push({
    code: 'E_NAMED_WITHOUT_DELTA', severity: 'error', mechanical: true,
    message: `proposal names module "${m}" but no delta file is present — planned work silently dropped`,
  });
  for (const m of present) if (!named.has(m)) findings.push({
    code: 'E_DELTA_WITHOUT_NAME', severity: 'error', mechanical: true,
    message: `a delta exists for module "${m}" which the proposal never named — scope that entered without passing the gate`,
  });
  return findings;
}

/**
 * Scenario loss in a MODIFIED block, against the living spec as it stands NOW.
 * The same comparison detects two different failures, told apart by whether the
 * scenario existed at the base revision.
 */
export function checkModifiedScenarioLoss({ requirement, livingScenarios, blockScenarios, baseScenarios }) {
  const inBlock = new Set(blockScenarios);
  const missing = livingScenarios.filter((s) => !inBlock.has(s));
  if (missing.length === 0) return [];
  const atBase = new Set(baseScenarios ?? livingScenarios);
  const forgotten = missing.filter((s) => atBase.has(s));
  const appeared = missing.filter((s) => !atBase.has(s));
  const findings = [];
  if (forgotten.length) findings.push({
    code: 'E_SCENARIO_DROPPED', severity: 'error', mechanical: true,
    message: `MODIFIED "${requirement}" omits ${forgotten.length} Scenario(s) the living spec still has; the merge would delete them silently`,
    detail: forgotten, remedy: 'copy these back into the block',
  });
  if (appeared.length) findings.push({
    code: 'E_DELTA_STALE', severity: 'error', mechanical: true,
    message: `MODIFIED "${requirement}" was written before another change added ${appeared.length} Scenario(s); merging it would revert them`,
    detail: appeared, remedy: 're-derive the block against the living spec as it stands now — do not patch it',
  });
  return findings;
}

/** A removal is declared, identified and justified, or it is not a removal — it is a loss. */
export function checkRemovals(removals) {
  const findings = [];
  for (const r of removals) {
    if (!r.requirement) findings.push({ code: 'E_REMOVAL_UNIDENTIFIED', severity: 'error', mechanical: true, message: 'a REMOVED entry names no Requirement' });
    else if (!r.reason) findings.push({ code: 'E_REMOVAL_UNJUSTIFIED', severity: 'error', mechanical: true, message: `REMOVED "${r.requirement}" carries no reason` });
    else if (r.in_approved_scope === false) findings.push({ code: 'E_REMOVAL_OUT_OF_SCOPE', severity: 'error', mechanical: true, message: `REMOVED "${r.requirement}" is not in the approved scope` });
  }
  return findings;
}

/** Operations apply in this order; anything else lands on a name that no longer exists. */
export function applyOrder(ops) {
  const rank = Object.fromEntries(DELTA_OPS.map((o, i) => [o, i]));
  return [...ops].sort((a, b) => (rank[a.op] ?? 99) - (rank[b.op] ?? 99));
}

/**
 * Evidence reuse across a revision change. A documentation-only edit need not invalidate
 * the whole suite — but the criterion has to be explicit and testable, not a feeling.
 */
export function evidenceStillValid(evidence, diff, { protocolIsBehaviour = true } = {}) {
  const kinds = new Set(diff.kinds);
  const touchesBehaviour =
    kinds.has(KIND.SOURCE) || kinds.has(KIND.DEPENDENCY) || kinds.has(KIND.RUNTIME_CONFIG) ||
    kinds.has(KIND.PIPELINE) || kinds.has(KIND.TEST) || (protocolIsBehaviour && kinds.has(KIND.PROTOCOL));
  if (touchesBehaviour) {
    return { valid: false, reason: `the diff touches ${[...kinds].join(', ')}; evidence measured before it describes different content` };
  }
  return { valid: true, reason: 'the diff is administrative only under the positive allowlist; no executable content changed' };
}
