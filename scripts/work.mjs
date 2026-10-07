#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { doctor, startWork, finishWork, reconcileWork, workPacket } from './lib/work.mjs';
import { diagnoseProject } from './lib/project-diagnostics.mjs';

const [command, change, operation, ...rest] = process.argv.slice(2);
const root = process.env.SPECTREE_PROJECT_ROOT ?? process.cwd();
const options = {};
try {
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--phase', '--task', '--next', '--refs', '--result', '--note'].includes(rest[i]) || !rest[i + 1]) throw Error('Unknown or incomplete option.');
    options[rest[i].slice(2)] = rest[i + 1];
  }
  if (options.refs) options.refs = options.refs.split(',');
  let value;
  if (command === 'doctor' && !change) value = { ...doctor(root), diagnostic: diagnoseProject(root) };
  else if (command === 'resume' && change && !operation) value = workPacket(root, change);
  else if (command === 'start' && change && operation) value = startWork(root, change, operation, options);
  else if (command === 'finish' && change && operation && options.result) {
    value = finishWork(root, change, operation, { ...options, result: JSON.parse(readFileSync(options.result, 'utf8')) });
  } else if (command === 'reconcile' && change && operation) value = reconcileWork(root, change, operation, options);
  else throw Error('usage: work.mjs doctor | resume <change> | start <change> <operation> --phase <phase> --task <task-ref> --next <action> [--refs a,b] | finish <change> <operation> --result <json> --next <action> [--refs a,b] | reconcile <change> <operation> --note <observed-effects> --next <action> --refs a,b');
  console.log(JSON.stringify(value, null, 2));
} catch (e) { console.error(`${e.code ?? 'E_WORK'}: ${e.message}`); process.exitCode = 1; }
