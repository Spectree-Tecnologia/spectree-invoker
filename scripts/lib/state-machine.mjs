// The change lifecycle, as transitions with preconditions and objective refusal codes.
//
// It validates the flow. It never performs the work: nothing here pushes, merges, deploys
// or touches a remote. A transition says "the preconditions for calling this done are met",
// and that is the whole of its authority.

/** Refusal codes. Objective, stable, and quotable back to the Founder. */
export const CODES = {
  ILLEGAL_TRANSITION: 'E_ILLEGAL_TRANSITION',
  MISSING_EVIDENCE: 'E_MISSING_EVIDENCE',
  STALE_EVIDENCE: 'E_STALE_EVIDENCE',
  EVIDENCE_NOT_PASS: 'E_EVIDENCE_NOT_PASS',
  NOT_INDEPENDENT: 'E_NOT_INDEPENDENT',
  MISSING_APPROVAL: 'E_MISSING_APPROVAL',
  APPROVAL_OUT_OF_SCOPE: 'E_APPROVAL_OUT_OF_SCOPE',
  APPROVAL_STALE: 'E_APPROVAL_STALE',
  SELF_REPORT_ONLY: 'E_SELF_REPORT_ONLY',
  CONCURRENT_UPDATE: 'E_CONCURRENT_UPDATE',
  ATTEMPTS_EXCEEDED: 'E_ATTEMPTS_EXCEEDED',
  RETRY_WITHOUT_PROGRESS: 'E_RETRY_WITHOUT_PROGRESS',
  CAPABILITY_UNAVAILABLE: 'E_CAPABILITY_UNAVAILABLE',
};

/**
 * Each transition names what must be true. `evidence` entries are matched on `property`;
 * `approval` entries on `gate`.
 */
export const TRANSITIONS = {
  draft: { proposed: {} },
  proposed: {
    scope_approved: { approvals: ['scope'] },
    blocked: {},
  },
  scope_approved: {
    isolated: { evidence: [{ property: 'branch.isolated' }] },
    blocked: {},
  },
  isolated: {
    baselined: { evidence: [{ property: 'suite.baseline', result: 'PASS', observed: true }] },
    blocked: {},
  },
  baselined: {
    // The only place the deltaless path diverges: pass 1 is skipped, nothing else is.
    pass1_complete: { evidence: [{ property: 'pass1.tests_failing', observed: true }] },
    implemented: { when: (c) => c.deltaless === true },
    blocked: {},
  },
  pass1_complete: { implemented: {}, blocked: {} },
  implemented: {
    pass2_complete: {
      evidence: [{ property: 'pass2.attack', observed: true }],
      independentOf: ['full_stack_developer'],
    },
    blocked: {},
  },
  pass2_complete: {
    ci_green: { evidence: [{ property: 'ci.green', result: 'PASS', observed: true, fresh: true }] },
    blocked: {},
  },
  ci_green: {
    integration_approved: { approvals: ['integration'] },
    blocked: {},
  },
  integration_approved: { integrated: {}, blocked: {} },
  integrated: {
    closed: { evidence: [{ property: 'closure.merged', observed: true }] },
    blocked: {},
  },
  closed: {},
  blocked: {
    proposed: {}, scope_approved: {}, isolated: {}, baselined: {},
    pass1_complete: {}, implemented: {}, pass2_complete: {}, ci_green: {},
    integration_approved: {}, integrated: {},
  },
};

const refuse = (code, message, detail) => ({ ok: false, code, message, ...(detail ? { detail } : {}) });

/**
 * @param {object} change            current change document
 * @param {string} to                target state
 * @param {object} ctx
 * @param {object[]} ctx.evidence    evidence documents for this change
 * @param {object[]} ctx.approvals   approval documents for this change
 * @param {string}  ctx.revision     the revision the caller believes is current
 * @param {number}  [ctx.expectedStateRevision]
 */
export function canTransition(change, to, ctx = {}) {
  const { evidence = [], approvals = [], revision, expectedStateRevision } = ctx;

  if (expectedStateRevision !== undefined && expectedStateRevision !== (change.state_revision ?? 0)) {
    return refuse(CODES.CONCURRENT_UPDATE,
      `the change moved underneath this write: expected state_revision ${expectedStateRevision}, found ${change.state_revision ?? 0}`);
  }

  const allowed = TRANSITIONS[change.state];
  if (!allowed) return refuse(CODES.ILLEGAL_TRANSITION, `unknown state "${change.state}"`);
  const rule = allowed[to];
  if (!rule) {
    return refuse(CODES.ILLEGAL_TRANSITION,
      `${change.state} -> ${to} is not a transition; from ${change.state} you may go to ${Object.keys(allowed).join(', ') || 'nowhere'}`);
  }
  if (rule.when && !rule.when(change)) {
    return refuse(CODES.ILLEGAL_TRANSITION, `${change.state} -> ${to} needs a condition this change does not meet`);
  }

  for (const need of rule.approvals ?? []) {
    const found = approvals.filter((a) => a.gate === need);
    if (found.length === 0) {
      return refuse(CODES.MISSING_APPROVAL, `no approval on record for gate "${need}"`);
    }
    const inScope = found.filter((a) => !a.change_id || a.change_id === change.change_id);
    if (inScope.length === 0) {
      return refuse(CODES.APPROVAL_OUT_OF_SCOPE, `the "${need}" approval on record belongs to another change`);
    }
    const usable = inScope.filter((a) => !(a.expires_with_revision && revision && a.revision !== revision));
    if (usable.length === 0) {
      return refuse(CODES.APPROVAL_STALE, `the "${need}" approval was granted for a revision that is no longer current`);
    }
    if (usable.every((a) => a.granted_by?.kind === undefined)) {
      return refuse(CODES.MISSING_APPROVAL, `the "${need}" approval names no granting party`);
    }
  }

  for (const need of rule.evidence ?? []) {
    const matching = evidence.filter((e) => e.property === need.property && !e.superseded_by);
    if (matching.length === 0) {
      return refuse(CODES.MISSING_EVIDENCE, `no evidence for "${need.property}"`);
    }
    const observed = need.observed ? matching.filter((e) => e.source_kind === 'observed_execution') : matching;
    if (observed.length === 0) {
      return refuse(CODES.SELF_REPORT_ONLY,
        `"${need.property}" is only an agent report; this transition needs an observed execution`);
    }
    const fresh = need.fresh && revision ? observed.filter((e) => e.revision === revision) : observed;
    if (fresh.length === 0) {
      return refuse(CODES.STALE_EVIDENCE,
        `"${need.property}" was observed at another revision; the content it measured is not the content being transitioned`);
    }
    if (need.result) {
      const right = fresh.filter((e) => e.result === need.result);
      if (right.length === 0) {
        const got = [...new Set(fresh.map((e) => e.result))].join(', ');
        return refuse(CODES.EVIDENCE_NOT_PASS,
          `"${need.property}" is ${got}, not ${need.result}` +
          (got.includes('INFRA_ERROR') ? ' — an infrastructure failure did not exercise the property, so it proves nothing either way' : ''));
      }
    }
    if (rule.independentOf) {
      const independent = fresh.some((e) =>
        rule.independentOf.every((r) => (e.executor?.independent_of ?? []).includes(r)));
      if (!independent) {
        return refuse(CODES.NOT_INDEPENDENT,
          `"${need.property}" was not produced independently of ${rule.independentOf.join(', ')}; ` +
          'a review that saw the builder\'s reasoning is not the independent pass this transition assumes');
      }
    }
  }

  return { ok: true, from: change.state, to };
}

/** Attempt budget. The key is the budget, not the mission's wording. */
export function canDispatch(dispatch, history = []) {
  const key = dispatch.budget_key ?? `${dispatch.change_id}:${dispatch.role}`;
  const prior = history.filter((d) => (d.budget_key ?? `${d.change_id}:${d.role}`) === key);
  const used = prior.length;
  if (used >= dispatch.max_attempts) {
    return refuse(CODES.ATTEMPTS_EXCEEDED,
      `budget "${key}" is spent: ${used} of ${dispatch.max_attempts} attempts used. Renaming the mission does not reset it.`);
  }
  if (dispatch.attempt > 1) {
    const p = dispatch.previous_attempt;
    if (!p || !p.cause || !p.new_hypothesis) {
      return refuse(CODES.RETRY_WITHOUT_PROGRESS,
        'a retry must record the cause of the previous failure and a new hypothesis; repeating a dispatch with no new information is a gamble, not a retry');
    }
  }
  return { ok: true, attempts_used: used, attempts_left: dispatch.max_attempts - used };
}

/** Capability gate: a dispatch that needs what the harness does not have is refused, not warned. */
export function canDispatchWithCapabilities(dispatch, capabilities = {}) {
  for (const need of dispatch.required_capabilities ?? []) {
    const state = capabilities[need];
    if (state === 'absent' || state === undefined) {
      return refuse(CODES.CAPABILITY_UNAVAILABLE,
        `this dispatch requires "${need}" and the harness reports it as ${state ?? 'unknown'}`);
    }
  }
  return { ok: true };
}
