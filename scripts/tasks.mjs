#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { initTasks, taskStatus, runTask, verifyTasks, recoverTask, planTaskBudget, applyTaskBudget } from './lib/task-executor.mjs';
import { preflightAgent } from './lib/agent-runner.mjs';
import { hash } from './lib/context.mjs';
const [command, change, arg, ...rest] = process.argv.slice(2);
const root = process.env.SPECTREE_PROJECT_ROOT ?? process.cwd();
const read = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
try {
  let result;
  if (command === 'init' && arg && !rest.length) result = initTasks(root, change, read(arg));
  else if (command === 'status' && change && !arg) result = taskStatus(root, change);
  else if (command === 'preflight' && change && !arg) result = preflightAgent(root, read(change));
  else if (command === 'budget-plan' && arg && rest.length === 2 && rest[0] === '--inspection') {
    const plan = planTaskBudget(root, change, arg, read(rest[1])); result = { plan, plan_digest: hash(plan) };
  }
  else if (command === 'budget-apply' && arg && rest.length === 3 && rest[0] === '--decision' && rest[2] === '--apply') result = applyTaskBudget(root, change, read(arg).plan, read(rest[1]));
  else if (command === 'verify' && arg === '--apply' && !rest.length) result = verifyTasks(root, change);
  else if (command === 'run' && arg && rest[0] === '--adapter' && rest[1] && rest[2] === '--apply' && rest.length === 3) result = runTask(root, change, arg, read(rest[1]));
  else if (command === 'repair' && arg && rest[0] === '--adapter' && rest[1] && rest[2] === '--inspection' && rest[3] && rest[4] === '--apply' && rest.length === 5) result = runTask(root, change, arg, read(rest[1]), read(rest[3]));
  else if (command === 'recover' && arg && rest.length === 2 && rest[0] === '--inspection') result = recoverTask(root, change, arg, read(rest[1]));
  else throw Error('usage: tasks.mjs init <change> <plan.json> | status <change> | preflight <config.json> | budget-plan <change> <task> --inspection <json> | budget-apply <change> <plan.json> --decision <json> --apply | run <change> <task> --adapter <config.json> --apply | repair <change> <task> --adapter <config.json> --inspection <json> --apply | verify <change> --apply | recover <change> <attempt> --inspection <json>');
  console.log(JSON.stringify(result, null, 2)); if (result.ok === false) process.exitCode = 1;
} catch (e) { console.error(`${e.code ?? 'E_TASK'}: ${e.message}`); process.exitCode = 1; }
