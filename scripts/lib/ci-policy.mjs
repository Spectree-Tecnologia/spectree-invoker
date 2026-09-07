// How much validation a candidate has earned, decided from what it actually changed.
//
// The waste this removes is real and was measured in a consumer: five CI runs for one change,
// three of them re-validating a commit whose only content was a note that the previous run had
// been green. But a cheaper run is only worth having if it cannot be talked into skipping a run
// that mattered, so every rule here is a positive allowlist and every doubt lands on FULL.
//
// It classifies nothing itself. `lib/diff.mjs` already answers "what kind of file is this",
// with a positive allowlist and renames judged on both ends; this only maps those kinds to a
// treatment. Two answers to the same question is how they start disagreeing.
//
// Three things it deliberately does not look at: the PR title, the commit message prefix, and
// labels. All three are text a human writes about a change, and none of them is the change.

import { KIND } from './diff.mjs';

export const TREATMENT = {
  FULL: 'full',
  DOCUMENTED_CLOSURE: 'documented_closure',
  OPERATIONAL_TRAIL: 'operational_trail',
};

/** Kinds that always earn the full suite. Everything not named here is one of them by default. */
const DEMANDS_FULL = new Set([
  KIND.SOURCE, KIND.TEST, KIND.DEPENDENCY, KIND.PIPELINE,
  KIND.RUNTIME_CONFIG, KIND.PROTOCOL, KIND.UNKNOWN,
]);

/**
 * @param {object} diff  the result of `classifyDiff`, over the FULL candidate against its base
 * @returns {{ treatment: string, reason: string, deciding: object[], kinds: string[] }}
 *
 * The caller must pass the whole candidate, not the last commit. Adding a log commit on top of
 * a code change would otherwise reclassify the code out of sight — and that is exactly the
 * shortcut this file exists to refuse.
 */
export function treatmentFor(diff) {
  const files = diff?.files ?? [];
  if (files.length === 0) {
    return {
      treatment: TREATMENT.FULL,
      reason: 'the candidate changes nothing against its base; an empty comparison is unknown, not safe',
      deciding: [], kinds: [],
    };
  }

  const kinds = [...new Set(files.flatMap((f) => f.kinds))].sort();
  const deciding = files.filter((f) => f.kinds.some((k) => DEMANDS_FULL.has(k)));
  if (deciding.length) {
    return {
      treatment: TREATMENT.FULL,
      reason: `${deciding.length} file(s) of kind ${[...new Set(deciding.flatMap((f) => f.kinds))].sort().join(', ')}`,
      deciding, kinds,
    };
  }

  // What is left is administrative, operational, or both. Both together is still a delivery
  // touching two different things, and the stricter of the two wins.
  const administrative = files.filter((f) => f.kinds.includes(KIND.ADMINISTRATIVE));
  if (administrative.length) {
    return {
      treatment: TREATMENT.DOCUMENTED_CLOSURE,
      reason: 'every file is recognised documentation, and none of it is a behavioural contract',
      deciding: administrative, kinds,
    };
  }
  return {
    treatment: TREATMENT.OPERATIONAL_TRAIL,
    reason: 'every file is the operational trail, which records what happened and defines nothing',
    deciding: files, kinds,
  };
}

/**
 * The checks each treatment owes. Names are the caller's to map onto jobs; what matters is that
 * the set is declared here and that the aggregate below is computed from the same list.
 */
export const REQUIRED_CHECKS = {
  [TREATMENT.FULL]: ['drift', 'integrity', 'suite', 'capabilities', 'consumer-install'],
  [TREATMENT.DOCUMENTED_CLOSURE]: ['drift', 'integrity', 'references', 'suite'],
  [TREATMENT.OPERATIONAL_TRAIL]: ['trail-integrity'],
};

/**
 * Did the required set actually succeed? A check that failed, was cancelled, timed out, or never
 * reported is not a check that passed — and none of those may be read as green because the job
 * that would have said so did not run.
 *
 * @param {string} treatment
 * @param {Record<string,string>} observed  check name -> conclusion, as the CI reported it
 */
export function aggregate(treatment, observed = {}, requiredOverride) {
  // The names a project's CI actually reports are the project's, not this file's. Where the
  // caller supplies them, those are the required set; the built-in list is the default for a
  // caller that has its own names already.
  const required = requiredOverride ?? REQUIRED_CHECKS[treatment];
  if (!required) {
    return { ok: false, code: 'E_UNKNOWN_TREATMENT', message: `no required set is declared for treatment "${treatment}"` };
  }
  const missing = required.filter((c) => !(c in observed));
  if (missing.length) {
    return { ok: false, code: 'E_CHECK_MISSING', message: `required check(s) never reported: ${missing.join(', ')}`, missing };
  }
  const bad = required.filter((c) => observed[c] !== 'success');
  if (bad.length) {
    return {
      ok: false, code: 'E_CHECK_NOT_GREEN',
      message: bad.map((c) => `${c} = ${observed[c]}`).join('; '),
      failed: bad,
    };
  }
  return { ok: true, required };
}
