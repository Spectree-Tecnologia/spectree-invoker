// Running specialist work: phase context, the task executor, agent runners and the bridge mailbox.
// This is the published entry: other modules and the CLIs import only from here.

export { preflightAgent, runAgent } from './agent-runner.mjs';
export {
  createBridgeRequest,
  inspectBridgeRequest,
  publishBridgeResult,
  waitBridgeResult,
} from './bridge-mailbox.mjs';
export { hash, packageRoot, phaseContext } from './context.mjs';
export {
  applyTaskBudget,
  initTasks,
  planTaskBudget,
  recoverTask,
  requireTasksComplete,
  runTask,
  taskStatus,
  verifyTasks,
} from './task-executor.mjs';
