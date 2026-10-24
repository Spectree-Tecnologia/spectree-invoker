// A closed change owes its retro. The retro is a document the Invoker writes after the merge; what
// the runtime holds is the observed check that the document exists and names the change, recorded
// as `retro.recorded` by `state.mjs run`. Until that evidence exists the planner points at the
// retro instead of answering "nothing to do", and no new change opens over it unless a person
// waives it with a reason that is kept.

export const RETRO_PROPERTY = 'retro.recorded';
export const RETRO_PENDING = 'E_RETRO_PENDING';

/** Is there an observed, non-superseded PASS of `retro.recorded` for this change? */
export function retroRecorded(evidence) {
  return evidence.some((e) => e.property === RETRO_PROPERTY && e.result === 'PASS'
    && e.source_kind === 'observed_execution' && !e.superseded_by);
}

/**
 * The closed changes that still owe a retro: no recorded retro, and not named by a waiver that
 * another change carries. `evidenceOf(id)` returns that change's evidence.
 */
export function pendingRetros(changes, evidenceOf) {
  const waived = new Set(changes.flatMap((c) => c.retro_waiver?.changes ?? []));
  return changes.filter((c) => c.state === 'closed' && !waived.has(c.change_id) && !retroRecorded(evidenceOf(c.change_id)))
    .map((c) => c.change_id);
}
