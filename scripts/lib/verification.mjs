// Validate the design of checks. A valid plan is NOT evidence that its commands ran.
import { aggregate } from './ci-policy.mjs';
import { deliveryContract } from './delivery-contract.mjs';

const argv = (x) => Array.isArray(x) && x.length > 0 && x.every((v) => typeof v === 'string' && v.trim());
const nonempty = (x) => typeof x === 'string' && x.trim().length > 0;
const list = (x) => Array.isArray(x) && x.length > 0 && x.every(nonempty);
export function verificationPlan(plan) {
  const errors = [];
  const problem = (code, message) => errors.push({ code, message });
  if (!plan || typeof plan !== 'object' || plan.version !== 1) return { ok: false, errors: [{ code: 'E_PLAN_VERSION', message: 'Expected verification plan version 1.' }] };
  if (typeof plan.changes_field_meaning !== 'boolean') problem('E_PLAN_IMPACT', 'Explicitly declare whether field meaning changes.');
  if (!Array.isArray(plan.checks) || !plan.checks.length) problem('E_PLAN_EMPTY', 'Declare at least one check.');
  const ids = new Set();
  for (const c of Array.isArray(plan.checks) ? plan.checks : []) {
    if (!c || !nonempty(c.id) || ids.has(c.id)) { problem('E_CHECK_ID', 'Every check needs a unique ID.'); continue; }
    ids.add(c.id);
    if (!['behavior', 'inventory'].includes(c.kind) || !nonempty(c.claim) || !argv(c.command)) problem('E_CHECK_CONTRACT', `${c.id}: kind, claim and argv command are required.`);
    if (c.kind === 'behavior' && (!nonempty(c.counterexample) || !nonempty(c.expected_failure))) problem('E_CHECK_DISCRIMINATION', `${c.id}: name the defective input and the specific failure it must cause.`);
    if (c.kind === 'behavior' && !list(c.scenario_refs)) problem('E_CHECK_SCENARIOS', `${c.id}: name the scenarios or invariant this behavior check exercises.`);
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

/** A green in another environment does not explain a red, nor erase it. */
export function baselineVerdict(evidence, { revision, fingerprint, environment }) {
  if (!revision || !fingerprint || !['local', 'ci'].includes(environment)) return { ok: false, code: 'E_BASELINE_IDENTITY' };
  const observed = evidence.filter((e) => e.property === 'suite.baseline' && !e.superseded_by &&
    e.source_kind === 'observed_execution' && e.revision === revision && e.fingerprint === fingerprint);
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
