// Infrastructure every module may use: CLI flags, git, digests, process launch and supervision,
// persistence and locks under `.spectree/`, TAP parsing, schema validation, harness declarations. It depends on no other module.
// This is the published entry: other modules and the CLIs import only from here.

export { flags } from './cli.mjs';
export {
  contentDigest,
  contentDigestAt,
  contractDigest,
  contractDigestAt,
  gatedDigest,
  normalisedHashes,
} from './digest.mjs';
export { latestRun, prChecks, pullRequest, pullRequestRecord, repository, runView, runsForCommit } from './gh.mjs';
export { git } from './git.mjs';
export { inside, refuse } from './guard.mjs';
export { detectHarness, executionContext, observedIsolationSignal } from './harness.mjs';
export { launch, launchSpec, resolveOnPath } from './launch.mjs';
export { LOCK_ORDER, lockOwnerIsGone, publishOnce, withLock, writeAtomic, writeOnce } from './persistence.mjs';
export { satisfiesFloor } from './runtime.mjs';
export { inspectProcesses, observeProcesses, supervisedLaunch } from './process-supervisor.mjs';
export { judgeFailingRun, judgeMutationRun, judgeNamedPasses, judgePass1Run, judgePassingRun, parseTap } from './tap.mjs';
export { stamp } from './time.mjs';
export { assertValid, validate } from './validate.mjs';
