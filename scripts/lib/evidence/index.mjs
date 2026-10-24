// What proves a change: verification plans, mutation probes, diff classification, CI policy and
// the delivery contract and ledger.
// This is the published entry: other modules and the CLIs import only from here.

export { REQUIRED_JOBS, aggregate, resolveCi, treatmentFor } from './ci-policy.mjs';
export { DELIVERY_STATES, ledgerView } from './delivery-ledger.mjs';
export {
  closureDeliveryPreflight,
  deliveryGate,
  deliveryMetrics,
  deliveryPlan,
  deliveryPreflight,
  recoverDelivery,
  runDelivery,
} from './delivery.mjs';
export { DEFAULT_NEUTRAL_PATHS, KIND, classifyDiff, neutralPaths, outsideAllowedPaths, readDiff } from './diff.mjs';
export { runMutation } from './mutation.mjs';
export { baselineVerdict, verificationChecks, verificationCi, verificationPlan } from './verification.mjs';
