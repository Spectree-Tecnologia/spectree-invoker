// The recorded state of a change: its store, state machine, scope policy, planner, operation
// checkpoints, run events and the closure control's lock and authority (lifecycle).
// This is the published entry: other modules and the CLIs import only from here.

export { coreModulesTouched } from './core-domain.mjs';
export {
  LIFECYCLE_VERSION,
  PHASE,
  PREP_CONTRACT_VERSION,
  RESUMABLE,
  abandonOperation,
  advanceOperation,
  approvalCoversPreparation,
  approvalCoversTarget,
  approvalsInForce,
  beginOperation,
  buildReceipt,
  completeOperation,
  currentPath,
  emptyLifecycle,
  integrationExpectation,
  lifecyclePath,
  newOperationId,
  newPreparationId,
  pendingOperation,
  preparationDigest,
  readLifecycle,
  readReceipt,
  receiptCovers,
  receiptDigest,
  receiptPath,
  snapshotPath,
  updateLifecycle,
  withAuthority,
  writeReceipt,
} from './lifecycle.mjs';
export { moduleOfPath, planPathAmendment } from './path-amendment.mjs';
export { observePlanCi } from './planner-ci.mjs';
export { nextTarget, planNext } from './planner.mjs';
export { RETRO_PENDING, RETRO_PROPERTY, pendingRetros, retroRecorded } from './retro-gate.mjs';
export { agentMetrics, appendRunEvent, runEvents, validRunEvent } from './run-events.mjs';
export { POLICY_KIND, checkPolicyApproval } from './scope-policy.mjs';
export {
  ASSERTS_FAILURE,
  ENTRY_REQUIREMENTS,
  ORDER,
  canDispatch,
  canTransition,
  measuredOn,
} from './state-machine.mjs';
export { SCHEMA_VERSION, Store } from './store.mjs';
export {
  bounded,
  doctor,
  finishWork,
  identifier,
  outcome,
  pendingWork,
  reconcileWork,
  references,
  snapshot,
  startWork,
  workPacket,
  workRecords,
} from './work.mjs';
