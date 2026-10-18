// Closing a change: preparation, the closure itself, reconciliation, adoption and diagnostics.
// This is the published entry: other modules and the CLIs import only from here.

export { applyAdoption, planAdoption } from './adoption.mjs';
export {
  PREP_CONTRACT_VERSION,
  approvalsInForce,
  artifactsUnder,
  buildManifest,
  commandDigest,
  compareArtifacts,
  comparePreparation,
  consolidationCommand,
  manifestPath,
  preparationCovers,
  preparationDigest,
  readManifest,
  recordedArchive,
  resolveCommand,
  snapshotPath,
  validArchivePath,
} from './closure-prep.mjs';
export { checkDeltaless, checkProposalDeltaContract } from './closure.mjs';
export { closureStrategy, diagnoseProject, selectClosureMode } from './project-diagnostics.mjs';
export {
  applyReconciliation,
  planReconciliation,
  resumeReconciliation,
} from './reconciliation.mjs';
