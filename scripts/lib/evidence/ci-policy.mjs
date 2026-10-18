// How much validation a candidate has earned, decided from what it actually changed.
//
// The waste this removes is real and was measured in a consumer: five CI runs for one change,
// three of them re-validating a commit whose only content was a note that the previous run had
// been green. But a cheaper run is only worth having if it cannot be talked into skipping a run
// that mattered, so every rule here is a positive allowlist and every doubt lands on FULL.
//
// It classifies nothing itself. `lib/evidence/diff.mjs` already answers "what kind of file is this",
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
 * The JOBS each treatment requires — one table, consumed by the workflow that plans the run and
 * by the aggregate that judges it.
 *
 * It used to promise `references` and `trail-integrity`, and no job of either name existed. A
 * required set naming checks nobody runs is not a lighter validation, it is an unenforced one:
 * the aggregate looked for a name it never found, or worse, looked for names that were never
 * wired to the jobs the workflow actually has.
 *
 * So the reduction these treatments buy is real and small: every treatment runs `classify` and
 * `plugin`, and the heavier STEPS inside `plugin` — the capability report and the synthetic
 * consumer install — run only for `full`. A treatment whose validation is not implemented does
 * not get a discount; it gets the full suite and says so.
 */
export const REQUIRED_JOBS = {
  [TREATMENT.FULL]: ['classify', 'plugin'],
  [TREATMENT.DOCUMENTED_CLOSURE]: ['classify', 'plugin'],
  [TREATMENT.OPERATIONAL_TRAIL]: ['classify', 'plugin'],
};

/** The steps within `plugin` that only a full treatment earns. Named here, read by the workflow. */
export const FULL_ONLY_STEPS = ['capabilities', 'consumer-install'];

/** Kept as the public name the CLI and the docs already use. */
export const REQUIRED_CHECKS = REQUIRED_JOBS;

/**
 * Which workflow, jobs, event and branch satisfy the policy for one treatment, as the PROJECT
 * declares them. Nothing here bridges a workflow name to a job name by guessing.
 *
 * Two shapes are accepted:
 *
 *   v2  ci: { version: 2, required_runs: { <treatment>: { workflow, jobs, event, branch } } }
 *   v1  ci: { required_runs: ["check"] }  or  { required_runs: { <treatment>: ["check"] } }
 *
 * A v1 list is a list of run NAMES with no workflow identity and no event behind it. It is
 * accepted only while it resolves to exactly one name; anything else asks for migration rather
 * than being interpreted, because a title, a job name and a workflow identity are three
 * different things and the moment they disagree the wrong one is green.
 */
export function resolveCi(project, treatment) {
  const ci = project?.ci;
  const declared = ci?.required_runs;
  if (!declared) {
    return {
      ok: false, code: 'E_CI_MAP_MISSING',
      message: 'this project does not declare which workflow runs satisfy the policy ' +
        '(`ci.required_runs` in .spectree/project.json). A check nobody mapped is a check nobody observed.',
    };
  }
  if (Number(ci.version) >= 2) {
    const entry = declared[treatment];
    if (!entry) {
      return { ok: false, code: 'E_CI_MAP_MISSING', message: `\`ci.required_runs.${treatment}\` is not declared` };
    }
    const jobs = entry.jobs ?? [];
    if (!entry.workflow || jobs.length === 0) {
      return {
        ok: false, code: 'E_CI_MAP_MISSING',
        message: `\`ci.required_runs.${treatment}\` must name a workflow and at least one job; an empty required set is not a green one`,
      };
    }
    return {
      ok: true, version: 2, workflow: entry.workflow, workflowId: entry.workflow_id ?? null,
      jobs, event: entry.event ?? null, branch: entry.branch ?? null,
    };
  }

  const legacy = Array.isArray(declared) ? declared : declared[treatment];
  if (!legacy || legacy.length === 0) {
    return { ok: false, code: 'E_CI_MAP_MISSING', message: `no required runs are declared for treatment "${treatment}"` };
  }
  if (legacy.length > 1) {
    return {
      ok: false, code: 'E_CI_MAP_AMBIGUOUS',
      message: `\`ci.required_runs\` lists ${legacy.length} names (${legacy.join(', ')}) with no workflow identity behind them, ` +
        'so which run each names cannot be resolved. Migrate to `ci: { version: 2, required_runs: { <treatment>: { workflow, jobs, event, branch } } }`.',
    };
  }
  return { ok: true, version: 1, workflow: legacy[0], workflowId: null, jobs: legacy, event: null, branch: null };
}

/**
 * Did the required set actually succeed? A check that failed, was cancelled, timed out, or never
 * reported is not a check that passed — and none of those may be read as green because the job
 * that would have said so did not run.
 *
 * `observed` maps a required name to what the CI reported. `undefined` means never reported,
 * which is deliberately distinct from every conclusion string.
 *
 * @param {string} treatment
 * @param {Record<string,string>} observed  check name -> conclusion, as the CI reported it
 */
export function aggregate(treatment, observed = {}, requiredOverride) {
  // The names a project's CI actually reports are the project's, not this file's. Where the
  // caller supplies them, those are the required set; the built-in list is the default for a
  // caller that has its own names already.
  const required = requiredOverride ?? REQUIRED_JOBS[treatment];
  if (!required) {
    return { ok: false, code: 'E_UNKNOWN_TREATMENT', message: `no required set is declared for treatment "${treatment}"` };
  }
  // An empty required list is not "everything passed": it is a policy that asks for nothing, and
  // a policy that asks for nothing cannot certify anything.
  if (required.length === 0) {
    return { ok: false, code: 'E_CHECK_SET_EMPTY', message: 'the required set is empty, and an empty set is not a green one' };
  }
  const missing = required.filter((c) => !(c in observed) || observed[c] === undefined || observed[c] === null);
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
