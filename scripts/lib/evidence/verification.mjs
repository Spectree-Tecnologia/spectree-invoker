// Validate the design of checks. A valid plan is NOT evidence that its commands ran.
import { aggregate, resolveCi } from './ci-policy.mjs';
import { deliveryContract } from './delivery-contract.mjs';
import { parseTap, judgeNamedPasses } from '../shared/index.mjs';

const argv = (x) => Array.isArray(x) && x.length > 0 && x.every((v) => typeof v === 'string' && v.trim());
const nonempty = (x) => typeof x === 'string' && x.trim().length > 0;
const list = (x) => Array.isArray(x) && x.length > 0 && x.every(nonempty);
// A check is run by its own command, or read by exact test name from the one suite report.
const runnable = (c) => (c.command === undefined) !== (c.tests === undefined) &&
  (c.command !== undefined ? argv(c.command) : list(c.tests) && new Set(c.tests).size === c.tests.length);
const CONCURRENT_KINDS = ['uniqueness', 'counter'];
// `design` is the Architect's gate on a plan being written: a uniqueness or counter rule is attacked
// by two concurrent writes from the plan on, and the plan says explicitly which rules those are.
// Plans already run or archived keep their meaning; an absent declaration is only refused there.
export function verificationPlan(plan, { design = false } = {}) {
  const errors = [];
  const problem = (code, message) => errors.push({ code, message });
  if (!plan || typeof plan !== 'object' || plan.version !== 1) return { ok: false, errors: [{ code: 'E_PLAN_VERSION', message: 'Expected verification plan version 1.' }] };
  if (typeof plan.changes_field_meaning !== 'boolean') problem('E_PLAN_IMPACT', 'Explicitly declare whether field meaning changes.');
  if (!Array.isArray(plan.checks) || !plan.checks.length) problem('E_PLAN_EMPTY', 'Declare at least one check.');
  const ids = new Set();
  for (const c of Array.isArray(plan.checks) ? plan.checks : []) {
    if (!c || !nonempty(c.id) || ids.has(c.id)) { problem('E_CHECK_ID', 'Every check needs a unique ID.'); continue; }
    ids.add(c.id);
    if (!['behavior', 'inventory'].includes(c.kind) || !nonempty(c.claim) || !runnable(c)) problem('E_CHECK_CONTRACT', `${c.id}: kind, claim and exactly one of an argv command or unique test names are required.`);
    if (c.kind === 'behavior' && (!nonempty(c.counterexample) || !nonempty(c.expected_failure))) problem('E_CHECK_DISCRIMINATION', `${c.id}: name the defective input and the specific failure it must cause.`);
    if (c.kind === 'behavior' && !list(c.scenario_refs)) problem('E_CHECK_SCENARIOS', `${c.id}: name the scenarios or invariant this behavior check exercises.`);
    if (c.counterexample_kind !== undefined && !['sequential', 'concurrent'].includes(c.counterexample_kind)) problem('E_CHECK_CONTRACT', `${c.id}: counterexample_kind is sequential or concurrent.`);
  }
  if (plan.concurrent_invariants === undefined) {
    if (design) problem('E_PLAN_CONCURRENCY', 'Explicitly declare concurrent_invariants: every uniqueness or counter rule, or an empty list when there is none.');
  } else if (!Array.isArray(plan.concurrent_invariants)) problem('E_PLAN_CONCURRENCY', 'concurrent_invariants is a list.');
  else {
    for (const inv of plan.concurrent_invariants) {
      if (!inv || !CONCURRENT_KINDS.includes(inv.kind) || !nonempty(inv.invariant) || !list(inv.scenario_refs) || !nonempty(inv.check_id)) {
        problem('E_CONCURRENT_INVARIANT', 'Each concurrent invariant needs a kind (uniqueness or counter), the invariant, scenario references and a check_id.');
        continue;
      }
      const check = (Array.isArray(plan.checks) ? plan.checks : []).find((c) => c?.id === inv.check_id);
      if (!check || check.kind !== 'behavior' || check.counterexample_kind !== 'concurrent' ||
          !inv.scenario_refs.every((ref) => Array.isArray(check.scenario_refs) && check.scenario_refs.includes(ref))) {
        problem('E_CONCURRENT_CHECK', `${inv.check_id}: a ${inv.kind} rule is proven by a behavior check whose counterexample_kind is concurrent, two writes racing for the same rule, over the scenarios the rule names.`);
      }
    }
  }
  if (plan.changes_field_meaning) {
    const flow = plan.round_trip;
    const required = ['create', 'read', 'edit_other_field', 'save', 'reread'];
    if (!flow || !nonempty(flow.invariant) || !list(flow.scenario_refs) ||
        !Array.isArray(flow.steps) || JSON.stringify(flow.steps) !== JSON.stringify(required)) {
      problem('E_ROUND_TRIP', 'Field meaning changes require create/read/edit_other_field/save/reread, an invariant and scenario references.');
    }
    const check = (Array.isArray(plan.checks) ? plan.checks : []).find((c) => c?.id === flow?.check_id);
    if (!check || check.kind !== 'behavior') problem('E_ROUND_TRIP_CHECK', 'The round trip must name a behavior check, not a count or inventory.');
  }
  if (plan.ci) {
    const jobs = plan.ci.jobs;
    if (!Array.isArray(jobs) || !jobs.length) problem('E_CI_JOBS', 'CI needs jobs.');
    else {
      const jobIds = jobs.map((j) => j?.id);
      if (jobs.some((j) => !j || !['audit', 'functional', 'support'].includes(j.kind) || typeof j.required !== 'boolean' || !Array.isArray(j.needs) || !j.needs.every(nonempty))) problem('E_CI_JOB', 'Each job needs a kind, required boolean and dependency IDs.');
      if (!jobIds.every(nonempty) || new Set(jobIds).size !== jobIds.length) problem('E_CI_JOB_ID', 'CI job IDs must be unique.');
      const visit = (id, stack = []) => {
        if (stack.includes(id)) { problem('E_CI_CYCLE', `CI dependency cycle at ${id}.`); return []; }
        const job = jobs.find((j) => j?.id === id);
        if (!job) { problem('E_CI_MISSING_JOB', `Unknown job ${id}.`); return []; }
        if (!Array.isArray(job.needs)) { problem('E_CI_NEEDS', `${id} must declare its needs array.`); return []; }
        return job.needs.flatMap((n) => [n, ...visit(n, [...stack, id])]);
      };
      const audits = jobs.filter((j) => j?.kind === 'audit').map((j) => j.id);
      if (!audits.length || !jobs.some((j) => j?.kind === 'functional')) problem('E_CI_SEPARATION', 'Declare independent audit and functional jobs.');
      for (const j of jobs) {
        const dependencies = visit(j?.id);
        if (j?.kind === 'functional' && dependencies.some((id) => audits.includes(id))) problem('E_CI_SERIAL_AUDIT', `${j.id} must not depend on an audit job, directly or transitively.`);
      }
      const required = jobs.filter((j) => j?.required === true).map((j) => j.id);
      if (jobs.some((j) => ['audit', 'functional'].includes(j?.kind) && j.required !== true)) problem('E_CI_REQUIRED', 'Audit and functional jobs remain required.');
      if (!list(plan.ci.aggregate?.needs) || !required.every((id) => plan.ci.aggregate.needs.includes(id)) ||
          plan.ci.aggregate.needs.some((id) => !jobIds.includes(id)) || plan.ci.aggregate?.always !== true) {
        problem('E_CI_AGGREGATE', 'The always-running aggregate must depend on every required job.');
      }
    }
  }
  if (plan.delivery !== undefined) errors.push(...deliveryContract(plan).errors);
  return { ok: errors.length === 0, advisory: true, authorizes_execution: false,
    meaning: 'Plan consistency only; commands and negative controls still require execution.', errors };
}

/**
 * Every check that names tests, judged from ONE suite report. A command check is not run here and
 * says so; a report that is not a complete TAP document judges nothing.
 */
export function verificationChecks(plan, report) {
  const valid = verificationPlan(plan);
  if (!valid.ok) return { ok: false, code: 'E_CHECK_PLAN', errors: valid.errors };
  const tap = parseTap(report);
  const checks = plan.checks.map((c) => {
    if (!c.tests) return { id: c.id, result: 'NOT_EVALUATED', reason: 'runs its own command; this report does not judge it' };
    const verdict = judgeNamedPasses(tap, c.tests);
    return { id: c.id, result: verdict.result, reason: verdict.reason, tests: verdict.tests };
  });
  const judged = checks.filter((c) => c.result !== 'NOT_EVALUATED');
  return { ok: judged.length > 0 && judged.every((c) => c.result === 'PASS'),
    code: !judged.length ? 'E_CHECK_NONE' : judged.some((c) => c.result === 'INFRA_ERROR') ? 'E_CHECK_REPORT'
      : judged.some((c) => c.result !== 'PASS') ? 'E_CHECK_FAILED' : null,
    meaning: 'Read from one suite report. It is evidence of that run only; a command check still needs its own execution.', checks };
}

// A CI run the project already paid for is an observation of the base, read from GitHub by its
// identity. It is the one other way a baseline is observed; it speaks for no other property.
const BASELINE_SOURCES = ['observed_execution', 'observed_ci_run'];

/**
 * Judge one existing workflow run as the CI baseline of a change, and say what to record.
 *
 * It has to be the run the project declared (`ci.required_runs.full`), finished green, on exactly
 * the base revision, with every declared job green: a run on another commit measured other code,
 * and a skipped job is a job that did not say anything.
 */
export function ciRunBaseline(run, { project, changeId, revision, fingerprint, at }) {
  const no = (code, message) => ({ ok: false, code, message });
  const policy = resolveCi(project, 'full');
  if (!policy.ok) return no(policy.code, policy.message);
  if (!run || run.status !== 'completed') return no('E_RUN_NOT_COMPLETE', `run ${run?.databaseId ?? '?'} is ${run?.status ?? 'unreadable'}: a run still going is not a baseline`);
  const workflowOk = policy.workflowId ? String(run.workflowDatabaseId) === String(policy.workflowId)
    : run.workflowName === policy.workflow || run.name === policy.workflow;
  if (!workflowOk) return no('E_RUN_WORKFLOW', `run ${run.databaseId} is workflow "${run.workflowName}", and the project declares "${policy.workflow}"`);
  if (policy.event && run.event && run.event !== policy.event) return no('E_RUN_WORKFLOW', `run ${run.databaseId} ran on "${run.event}", and the project declares "${policy.event}"`);
  if (run.headSha !== revision) return no('E_RUN_REVISION', `run ${run.databaseId} measured ${String(run.headSha).slice(0, 8)}, not the base revision ${revision.slice(0, 8)}`);
  const jobs = Array.isArray(run.jobs) ? run.jobs : [];
  const observed = Object.fromEntries(policy.jobs.map((j) => [j, jobs.find((x) => x.name === j)?.conclusion]));
  // A red base is a fact to record, the pre-existing debt the protocol stops on. A run that was
  // cancelled, skipped or never reported a declared job measured nothing, and records nothing.
  const missing = policy.jobs.filter((j) => observed[j] === undefined || observed[j] === null);
  if (missing.length) return no('E_RUN_JOBS', `run ${run.databaseId} never reported ${missing.join(', ')}`);
  const unsettled = [['run', run.conclusion], ...Object.entries(observed)].filter(([, c]) => !['success', 'failure'].includes(c));
  if (unsettled.length) return no('E_RUN_INCONCLUSIVE', `run ${run.databaseId}: ${unsettled.map(([n, c]) => `${n} = ${c}`).join('; ')}, which is neither a pass nor a failure`);
  const result = run.conclusion === 'success' && aggregate('full', observed, policy.jobs).ok ? 'PASS' : 'FAIL';
  return { ok: true, result, jobs: observed, evidence: {
    evidence_id: `ev-ci-${run.databaseId}-${run.attempt ?? 1}`, change_id: changeId, property: 'suite.baseline',
    check: `GitHub Actions run ${run.databaseId} (attempt ${run.attempt ?? 1}) of "${policy.workflow}": ${policy.jobs.join(', ')}`,
    executor: { role: 'platform_engineer' }, source_kind: 'observed_ci_run', revision, fingerprint,
    environment: { ci: true, run_ref: run.url ?? String(run.databaseId) }, timestamp: at, result } };
}

/** A green in another environment does not explain a red, nor erase it. */
export function baselineVerdict(evidence, { revision, fingerprint, environment }) {
  if (!revision || !fingerprint || !['local', 'ci'].includes(environment)) return { ok: false, code: 'E_BASELINE_IDENTITY' };
  const observed = evidence.filter((e) => e.property === 'suite.baseline' && !e.superseded_by &&
    BASELINE_SOURCES.includes(e.source_kind) && e.revision === revision && e.fingerprint === fingerprint);
  const selected = observed.filter((e) => environment === 'ci' ? e.environment?.ci === true : e.environment?.ci === false);
  const bad = selected.filter((e) => e.result !== 'PASS');
  return { ok: selected.length > 0 && !bad.length,
    code: !selected.length ? 'E_BASELINE_MISSING' : bad.length ? 'E_BASELINE_UNSTABLE' : null,
    revision, fingerprint, environment, selected_refs: selected.map((e) => e.evidence_id),
    unresolved_elsewhere: observed.filter((e) => !selected.includes(e) && e.result !== 'PASS').map((e) => e.evidence_id),
    diagnosis: 'Observed results only. Passing in CI does not establish the cause of local instability.' };
}
export function verificationCi(plan, observed) {
  const valid = verificationPlan(plan);
  if (!valid.ok || !plan.ci) return { ok: false, code: 'E_CI_PLAN', errors: valid.errors };
  if (!observed || typeof observed !== 'object' || Array.isArray(observed)) return { ok: false, code: 'E_CI_RESULTS' };
  return aggregate('full', observed, plan.ci.jobs.filter((j) => j.required).map((j) => j.id));
}
