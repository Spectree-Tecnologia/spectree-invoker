#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { initTasks, taskStatus, runTask, verifyTasks, recoverTask } from './lib/task-executor.mjs';
const [command, change, arg, ...rest] = process.argv.slice(2);
const root = process.env.SPECTREE_PROJECT_ROOT ?? process.cwd();
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
try {
  let result;
  if (command === 'init' && arg && !rest.length) result = initTasks(root, change, read(arg));
  else if (command === 'status' && change && !arg) result = taskStatus(root, change);
  else if (command === 'verify' && arg === '--apply' && !rest.length) result = verifyTasks(root, change);
  else if (command === 'run' && arg && rest[0] === '--adapter' && rest[1] && rest[2] === '--apply' && rest.length === 3) result = runTask(root, change, arg, read(rest[1]));
  else if (command === 'recover' && arg && rest.length === 2 && rest[0] === '--inspection') result = recoverTask(root, change, arg, read(rest[1]));
  else throw Error('usage: tasks.mjs init <change> <plan.json> | status <change> | run <change> <task> --adapter <config.json> --apply | verify <change> --apply | recover <change> <attempt> --inspection <json>');
  console.log(JSON.stringify(result, null, 2)); if (result.ok === false) process.exitCode = 1;
} catch (e) { console.error(`${e.code ?? 'E_TASK'}: ${e.message}`); process.exitCode = 1; }
