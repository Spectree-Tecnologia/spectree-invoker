// Read-only advice over the SAME gate decision used by can/transition. Never authority.
import { canTransition, legalTargets, ENTRY_REQUIREMENTS } from './state-machine.mjs';

export function nextTarget(change) {
  return change.state === 'baselined' && change.deltaless ? 'implemented'
    : legalTargets(change).find((s) => s !== 'blocked');
}

export function planNext(change, ctx = {}, { isolationSignal = null, ci = null, controlRevision = null } = {}) {
  const base = { plan_version: 1, advisory: true, authorizes_execution: false,
    preconditions: { change_id: change?.change_id ?? null, state: change?.state ?? null,
      state_revision: change?.state_revision ?? 0, control_revision: controlRevision,
      revision: ctx.revision ?? null, content_digest: ctx.contentDigest ?? null,
      contract_digest: ctx.contractDigest ?? null,
      revalidate: 'Re-read before acting; the command rechecks its own gates. This plan is not a capability or approval.' } };
  const answer = (action, role, status, reason, extra = {}) => ({ ...base, action, role, status, reason, ...extra });
  if (!change) return answer('select_change', 'invoker', 'blocked', 'Choose an explicit existing change; no change is inferred.');
  if (ctx.authority?.ok === false) return answer('repair_authority', 'invoker', 'blocked', ctx.authority.message, { code: ctx.authority.code });
  if (ctx.pendingOperation) return answer('recover_operation', 'platform_engineer', 'blocked', ctx.pendingOperation.recovery,
    { code: 'E_OPERATION_PENDING', operation: ctx.pendingOperation, requires_human_decision: Boolean(ctx.pendingOperation.uncertain) });
  if (change.state === 'closed') return answer('none', 'invoker', 'complete', 'This change is closed; no new work is inferred.');
  if (change.state === 'blocked') return answer('resolve_blocker', 'invoker', 'blocked', change.blocked_reason ?? 'Resolve the recorded blocker before recovery.',
    { recovery_target: change.blocked_from ?? null });
  const to = nextTarget(change);
  if (!to) return answer('inspect_state', 'invoker', 'blocked', 'No legal forward target exists.');
  const gate = canTransition(change, to, ctx);
  base.target_state = to;
  base.gate = gate;
  const need = ENTRY_REQUIREMENTS[to];
  // Administrative scope approval is checked by the gate BEFORE any preparation advice.
  // Preparation belongs before QA, and before asking for integration approval over that record.
  const prepareFirst = change.closure_mode !== 'legacy' && !ctx.closure?.ok &&
    (change.state === 'implemented' || change.state === 'ci_green') &&
    (gate.ok || gate.detail?.property || gate.detail?.gate === 'integration' || gate.code === 'E_CLOSURE_NOT_PREPARED');
  if (prepareFirst) return answer('prepare_closure', 'platform_engineer', 'blocked',
    'Inspect closure preparation before QA/integration approval. The preparation command must perform its own preflight.',
    { command: ['prepare-closure.mjs', change.change_id], command_mode: 'dry-run', code: ctx.closure?.code ?? 'E_CLOSURE_NOT_PREPARED' });

  const usesIndependentQa = need.evidence?.some((e) => e.independentOf?.length);
  if (usesIndependentQa && !isolationSignal && (gate.ok || gate.detail?.property === 'pass2.attack' || gate.detail?.gate === 'integration')) {
    return answer('resolve_qa_independence', 'invoker', 'blocked',
      'M4: independent QA is not observed. A caller-supplied independent_of flag does not prove it. Do not advance on this recommendation.',
      { code: 'E_ISOLATION_UNPROVEN', requires_human_decision: true });
  }
  // CI is a live observation supplied only by an explicit read. It never manufactures ci.green.
  if (ci && ['pass2_complete', 'ci_green', 'integration_approved', 'integrated'].includes(change.state)) {
    if (ci.status === 'unknown') return answer('inspect_ci', 'platform_engineer', 'blocked', ci.reason, { ci });
    if (ci.status === 'pending') return answer('wait_ci', 'platform_engineer', 'waiting',
      'Required PR checks are pending. Wait for a state change; do not rerun or download unchanged logs.', { ci });
    if (ci.status === 'failed') return answer('investigate_ci', 'platform_engineer', 'blocked',
      'A required PR check is not passing. Diagnose the named check before changing or rerunning anything.', { ci });
  }
  if (!gate.ok) {
    if (gate.detail?.gate) return answer('request_approval', 'founder', 'blocked', gate.message,
      { code: gate.code, approval_gate: gate.detail.gate, requires_human_decision: true });
    if (gate.detail?.property) {
      const property = gate.detail.property;
      const role = property.startsWith('pass') ? 'quality_engineer' : 'platform_engineer';
      return answer('produce_evidence', role, 'blocked', gate.message, { code: gate.code, property,
        instruction: 'Choose the project check that exercises this property; do not invent a passing command or independence.' });
    }
    if (['integrated', 'closed'].includes(to) && gate.code === 'E_INTEGRATION_NOT_OBSERVED') {
      return answer('confirm_integration', 'platform_engineer', 'blocked', gate.message,
        { command: ['post-merge.mjs', change.change_id], command_mode: 'dry-run; supply the approved PR identity', ci });
    }
    return answer('resolve_gate', 'invoker', 'blocked', gate.message, { code: gate.code });
  }
  if (['integrated', 'closed'].includes(to)) return answer('confirm_integration', 'platform_engineer', 'ready',
    'Use post-merge to revalidate the actual integration; this local gate result does not observe GitHub.',
    { command: ['post-merge.mjs', change.change_id], command_mode: 'dry-run; supply the approved PR identity', ci });
  // States with no executable evidence gate still require real work, not an automatic checkbox.
  if (to === 'proposed') return answer('review_proposal', 'solutions_architect', 'ready', 'Review the proposal and delta before recording proposed.');
  if (to === 'implemented') return answer('implement_change', 'full_stack_developer', 'ready', 'Implement the approved scope; this gate does not prove that implementation is finished.');
  return answer('record_transition', 'invoker', 'ready', 'The local gate allows this transition. Verify task authorization and revalidate immediately before writing.',
    { command: ['state.mjs', 'transition', change.change_id, to, '--expect', String(change.state_revision ?? 0)] });
}
