// The change lifecycle, as transitions with preconditions and objective refusal codes.
//
// It validates the flow. It never performs the work: nothing here pushes, merges, deploys
// or touches a remote. A transition says "the preconditions for calling this done are met",
// and that is the whole of its authority.
//
// Requirements belong to the STATE BEING ENTERED, not to the edge. An earlier version
// attached them to edges, and the same state could then be entered from a different edge
// with none of them checked — which is exactly how `blocked` became a bypass.

/** Refusal codes. Objective, stable, and quotable back to the Founder. */
export const CODES = {
  ILLEGAL_TRANSITION: 'E_ILLEGAL_TRANSITION',
  MISSING_EVIDENCE: 'E_MISSING_EVIDENCE',
  STALE_EVIDENCE: 'E_STALE_EVIDENCE',
  CONTENT_CHANGED: 'E_CONTENT_CHANGED',
  CONTRACT_CHANGED: 'E_CONTRACT_CHANGED',
  EVIDENCE_NOT_PASS: 'E_EVIDENCE_NOT_PASS',
  NOT_INDEPENDENT: 'E_NOT_INDEPENDENT',
  MISSING_APPROVAL: 'E_MISSING_APPROVAL',
  APPROVAL_OUT_OF_SCOPE: 'E_APPROVAL_OUT_OF_SCOPE',
  APPROVAL_STALE: 'E_APPROVAL_STALE',
  APPROVAL_DIGEST_MISMATCH: 'E_APPROVAL_DIGEST_MISMATCH',
  SELF_REPORT_ONLY: 'E_SELF_REPORT_ONLY',
  CONCURRENT_UPDATE: 'E_CONCURRENT_UPDATE',
  ATTEMPTS_EXCEEDED: 'E_ATTEMPTS_EXCEEDED',
  RETRY_WITHOUT_PROGRESS: 'E_RETRY_WITHOUT_PROGRESS',
  CAPABILITY_UNAVAILABLE: 'E_CAPABILITY_UNAVAILABLE',
  BLOCKED_RECOVERY: 'E_BLOCKED_RECOVERY',
  CLOSURE_NOT_PREPARED: 'E_CLOSURE_NOT_PREPARED',
};

/** The ordered pipeline. Every forward edge goes to the next state and to no other. */
export const ORDER = [
  'draft', 'proposed', 'scope_approved', 'isolated', 'baselined',
  'pass1_complete', 'implemented', 'pass2_complete', 'ci_green',
  'integration_approved', 'integrated', 'closed',
];

/**
 * What must be true to BE IN a state. Checked on every entry, by whatever route.
 * `evidence` entries match on `property`; `approvals` on `gate`.
 */
export const ENTRY_REQUIREMENTS = {
  draft: {},
  proposed: {},
  scope_approved: { approvals: ['scope'] },
  isolated: {
    approvals: ['scope'],
    evidence: [{ property: 'branch.isolated', result: 'PASS', observed: true, fresh: false }],
  },
  baselined: {
    approvals: ['scope'],
    evidence: [{ property: 'suite.baseline', result: 'PASS', observed: true, fresh: false }],
  },
  pass1_complete: {
    approvals: ['scope'],
    evidence: [{ property: 'pass1.tests_failing', result: 'PASS', observed: true, fresh: false, contract: true }],
  },
  implemented: { approvals: ['scope'] },
  pass2_complete: {
    approvals: ['scope'],
    evidence: [{ property: 'pass2.attack', result: 'PASS', observed: true, fresh: true, contract: true, independentOf: ['full_stack_developer'] }],
  },
  ci_green: {
    approvals: ['scope'],
    evidence: [{ property: 'ci.green', result: 'PASS', observed: true, fresh: true }],
  },
  // Authorisation is not validation. An approval says a human agreed to integrate THIS
  // candidate; it does not say the candidate was ever exercised. Both states re-check the
  // technical evidence against the content on disk, so a human signature can never stand in
  // for a run that never happened on the code being integrated.
  integration_approved: {
    approvals: ['scope', 'integration'],
    evidence: [
      { property: 'pass2.attack', result: 'PASS', observed: true, fresh: true, contract: true, independentOf: ['full_stack_developer'] },
      { property: 'ci.green', result: 'PASS', observed: true, fresh: true },
    ],
  },
  integrated: {
    approvals: ['scope', 'integration'],
    evidence: [
      { property: 'pass2.attack', result: 'PASS', observed: true, fresh: true, contract: true, independentOf: ['full_stack_developer'] },
      { property: 'ci.green', result: 'PASS', observed: true, fresh: true },
    ],
  },
  closed: {
    approvals: ['scope', 'integration'],
    evidence: [{ property: 'closure.merged', result: 'PASS', observed: true, fresh: false }],
  },
  blocked: {},
};

/**
 * Properties whose PASS means the named test RAN AND FAILED. Pass 1's delivery is failing
 * tests, and nothing else in the pipeline asserts a failure.
 *
 * This is protocol knowledge about what a property means, not a detail of how the runner is
 * invoked — which is why it is not a flag. A flag makes the semantics optional: pass it and a
 * red run reads as green, omit it and a run that never failed reads as pass 1 delivered.
 * Belonging to this set is mandatory in both directions: these properties require a named
 * failing test, and no other property may be satisfied by a run that failed.
 */
export const ASSERTS_FAILURE = new Set(['pass1.tests_failing']);

/** Legal edges. Forward one step, or into `blocked` from anywhere but the ends. */
export function legalTargets(change) {
  if (change.state === 'blocked') {
    // Recovery returns to where the block happened and nowhere else. The entry
    // requirements of that state are then re-checked, so a block never launders
    // a step whose preconditions were never met.
    return change.blocked_from ? [change.blocked_from] : [];
  }
  const i = ORDER.indexOf(change.state);
  if (i === -1) return [];
  const next = [];
  if (i + 1 < ORDER.length) next.push(ORDER[i + 1]);
  if (change.state !== 'closed') next.push('blocked');
  // A deltaless change has no Scenario, so pass 1 does not apply to it — and only
  // that one step is skipped.
  if (change.state === 'baselined' && change.deltaless === true) next.push('implemented');
  return next;
}

const refuse = (code, message, detail) => ({ ok: false, code, message, ...(detail ? { detail } : {}) });

/**
 * @param {object} change
 * @param {string} to
 * @param {object} ctx
 * @param {object[]} [ctx.evidence]
 * @param {object[]} [ctx.approvals]
 * @param {string}   [ctx.revision]        the revision the caller believes is current
 * @param {object}   [ctx.closure]         the closure preparation's verdict for THIS candidate,
 *                                          as `lib/closure-prep.mjs` computed it
 * @param {string}   [ctx.contractDigest]  the contract as it reads NOW
 * @param {string}   [ctx.contentDigest]   the content a check would run against NOW —
 *                                          the commit plus the uncommitted working tree
 * @param {object}   [ctx.scopeDigests]    { [gate]: digest } the digest each gate must match
 * @param {number}   [ctx.expectedStateRevision]
 */
export function canTransition(change, to, ctx = {}) {
  const { evidence = [], approvals = [], revision, contentDigest, contractDigest, closure, scopeDigests = {}, expectedStateRevision } = ctx;

  if (expectedStateRevision !== undefined && expectedStateRevision !== (change.state_revision ?? 0)) {
    return refuse(CODES.CONCURRENT_UPDATE,
      `the change moved underneath this write: expected state_revision ${expectedStateRevision}, found ${change.state_revision ?? 0}`);
  }

  if (!ORDER.includes(change.state) && change.state !== 'blocked') {
    return refuse(CODES.ILLEGAL_TRANSITION, `unknown state "${change.state}"`);
  }

  const targets = legalTargets(change);
  if (!targets.includes(to)) {
    if (change.state === 'blocked' && !change.blocked_from) {
      return refuse(CODES.BLOCKED_RECOVERY,
        'this change is blocked and does not record where it was blocked from, so there is nowhere safe to return to. ' +
        'Set blocked_from to the state it was in, and recovery will re-check that state\'s requirements.');
    }
    if (change.state === 'blocked') {
      return refuse(CODES.BLOCKED_RECOVERY,
        `recovery from blocked returns to "${change.blocked_from}" and nowhere else; ` +
        `"${to}" would skip every step between them`);
    }
    return refuse(CODES.ILLEGAL_TRANSITION,
      `${change.state} -> ${to} is not a transition; from ${change.state} you may go to ${targets.join(', ') || 'nowhere'}`);
  }

  // Entering `blocked` needs nothing: a block is an admission, not an achievement.
  const need = ENTRY_REQUIREMENTS[to] ?? {};

  for (const gate of need.approvals ?? []) {
    const forGate = approvals.filter((a) => a.gate === gate);
    if (forGate.length === 0) return refuse(CODES.MISSING_APPROVAL, `no approval on record for gate "${gate}"`);

    // An approval must name the change it authorises. An unbound approval is not
    // "for every change", it is one whose scope nobody wrote down.
    const bound = forGate.filter((a) => a.change_id === change.change_id);
    if (bound.length === 0) {
      const others = [...new Set(forGate.map((a) => a.change_id ?? '(no change_id)'))].join(', ');
      return refuse(CODES.APPROVAL_OUT_OF_SCOPE,
        `the "${gate}" approval on record does not name this change (it names: ${others})`);
    }

    // Bound to content: the digest the human approved must be the digest of what is
    // being gated. Where the caller supplies no digest for the gate, that is a
    // refusal too — an unchecked digest is a digest that proves nothing.
    const expectedDigest = scopeDigests[gate];
    if (expectedDigest === undefined) {
      return refuse(CODES.APPROVAL_DIGEST_MISMATCH,
        `the "${gate}" approval cannot be checked: no digest of the current ${gate} artifact was supplied to compare it against`);
    }
    const sameContent = bound.filter((a) => a.scope_digest === expectedDigest);
    if (sameContent.length === 0) {
      return refuse(CODES.APPROVAL_DIGEST_MISMATCH,
        `the "${gate}" approval was granted for different content ` +
        `(approved ${bound[0].scope_digest}, current ${expectedDigest})`);
    }

    // The digest above IS the expiry, and it is the right one for the gate: a contract gate
    // dies when the contract changes, a code gate when the contract or the code changes.
    // Revision was only ever a proxy for that, and a bad one in both directions — it revoked
    // a scope approval over a commit that never touched the contract, and it survived an
    // uncommitted edit that changed everything. It applies now only where an approval asks
    // for it in as many words.
    const fresh = revision
      ? sameContent.filter((a) => a.expires_with_revision !== true || a.revision === revision)
      : sameContent;
    if (fresh.length === 0) {
      return refuse(CODES.APPROVAL_STALE,
        `the "${gate}" approval says it expires with the revision: it was granted at ${bound[0].revision.slice(0, 8)} and the current revision is ${revision.slice(0, 8)}`);
    }
    if (fresh.every((a) => a.granted_by?.kind === undefined)) {
      return refuse(CODES.MISSING_APPROVAL, `the "${gate}" approval names no granting party`);
    }
  }

  for (const want of need.evidence ?? []) {
    const matching = evidence.filter((e) => e.property === want.property && !e.superseded_by);
    if (matching.length === 0) return refuse(CODES.MISSING_EVIDENCE, `no evidence for "${want.property}"`);

    const observed = want.observed !== false ? matching.filter((e) => e.source_kind === 'observed_execution') : matching;
    if (observed.length === 0) {
      return refuse(CODES.SELF_REPORT_ONLY,
        `"${want.property}" is only an agent report; entering "${to}" needs an observed execution`);
    }

    // The revision is not the content, in either direction: an uncommitted edit leaves HEAD
    // where it was, and a `--no-ff` merge moves HEAD over an identical tree. So where the
    // content is known it is the whole test, and the revision is the fallback for callers
    // that cannot compute one.
    let fresh = observed;
    if (want.fresh && contentDigest) {
      fresh = fresh.filter((e) => e.fingerprint === contentDigest);
      if (fresh.length === 0) {
        const unpinned = observed.some((e) => !e.fingerprint);
        return refuse(CODES.CONTENT_CHANGED,
          `"${want.property}" was not measured on the content now on disk` +
          (unpinned
            ? ' — it records no fingerprint at all, so what it ran against cannot be established'
            : '; the content has moved since that run, and an uncommitted change is still a change'));
      }
    } else if (want.fresh && revision) {
      fresh = fresh.filter((e) => e.revision === revision);
      if (fresh.length === 0) {
        return refuse(CODES.STALE_EVIDENCE,
          `"${want.property}" was observed at another revision; the content it measured is not the content being transitioned`);
      }
    }

    const wanted = want.result ?? 'PASS';
    const right = fresh.filter((e) => e.result === wanted);
    if (right.length === 0) {
      const got = [...new Set(fresh.map((e) => e.result))].join(', ');
      return refuse(CODES.EVIDENCE_NOT_PASS,
        `"${want.property}" is ${got}, not ${wanted}` +
        (got.includes('INFRA_ERROR')
          ? ' — an infrastructure failure did not exercise the property, so it proves nothing either way'
          : ''));
    }

    // Some evidence is a claim about the Scenarios, not only about the code: pass 1 wrote its
    // tests from them, pass 2 attacked them. Adding an acceptance criterion with the code
    // untouched leaves that run describing a contract that no longer exists.
    let bound = right;
    if (want.contract && contractDigest) {
      bound = right.filter((e) => e.contract_digest === contractDigest);
      if (bound.length === 0) {
        const unbound = right.some((e) => !e.contract_digest);
        return refuse(CODES.CONTRACT_CHANGED,
          `"${want.property}" was produced against a different contract` +
          (unbound
            ? ' — it records no contract digest, so which Requirements it covered cannot be established'
            : '; the Requirements moved since that run, and the run cannot speak for the ones it never saw'));
      }
    }

    if (want.independentOf) {
      const independent = bound.some((e) =>
        want.independentOf.every((r) => (e.executor?.independent_of ?? []).includes(r)));
      if (!independent) {
        return refuse(CODES.NOT_INDEPENDENT,
          `"${want.property}" was not produced independently of ${want.independentOf.join(', ')}; ` +
          "a review that saw the builder's reasoning is not the independent pass this step assumes");
      }
    }
  }

  // The closure is prepared on the branch, BEFORE the merge — consolidated specs, archived
  // folder, one manifest — and authorising the integration is where that preparation has to
  // exist. Preparing early is what removes the second PR and the commits that only said the
  // previous run was green; requiring it here is what stops "prepared" from meaning "declared
  // integrated". A change that says `closure_mode: "legacy"` is exempt, and says so out loud.
  if (to === 'integration_approved' && change.closure_mode !== 'legacy') {
    if (!closure) {
      return refuse(CODES.CLOSURE_NOT_PREPARED,
        'no closure preparation was checked for this candidate; run `prepare-closure.mjs` on the branch, ' +
        'or declare the change `closure_mode: "legacy"` and close it the old way');
    }
    if (!closure.ok) {
      return refuse(CODES.CLOSURE_NOT_PREPARED, `${closure.code}: ${closure.message}`);
    }
  }

  return { ok: true, from: change.state, to };
}

/** Attempt budget. The key is the budget, not the mission's wording. */
export function canDispatch(dispatch, history = []) {
  const key = dispatch.budget_key ?? `${dispatch.change_id}:${dispatch.role}`;
  const used = history.filter((d) => (d.budget_key ?? `${d.change_id}:${d.role}`) === key).length;
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

/**
 * Capability gate. Only a capability that is `declared` or `verified` lets a dispatch
 * through. `unknown` is not permission: it is the absence of an answer, and a dispatch
 * that needs the capability would be running on a hope.
 */
export const USABLE_CAPABILITY = new Set(['declared', 'verified']);

export function canDispatchWithCapabilities(dispatch, capabilities = {}) {
  for (const need of dispatch.required_capabilities ?? []) {
    const state = capabilities[need];
    if (!USABLE_CAPABILITY.has(state)) {
      return refuse(CODES.CAPABILITY_UNAVAILABLE,
        `this dispatch requires "${need}" and the harness reports it as ${state ?? 'unknown'}` +
        (state === 'unknown' || state === undefined
          ? ' — unknown is the absence of an answer, not permission'
          : ''));
    }
  }
  return { ok: true };
}
