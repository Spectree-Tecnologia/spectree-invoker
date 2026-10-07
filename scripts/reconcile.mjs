#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { diagnoseProject } from './lib/project-diagnostics.mjs';
import { planReconciliation, applyReconciliation, resumeReconciliation } from './lib/reconciliation.mjs';
const root = process.env.SPECTREE_PROJECT_ROOT ?? process.cwd();
const [command, input, flag, output, ...extra] = process.argv.slice(2);
const usage = 'usage: reconcile.mjs diagnose [change] | plan <request.json> [--output <file>] | apply <plan.json> --apply | resume <change> <operation> --apply';
try {
  let result;
  if (extra.length) throw Error(usage);
  if (command === 'diagnose' && !flag && !output) result = diagnoseProject(root, input);
  else if (command === 'resume' && input && flag && output === '--apply') result = resumeReconciliation(root, input, flag);
  else if (command === 'plan' && input && (!flag || (flag === '--output' && output))) {
    result = planReconciliation(root, JSON.parse(readFileSync(input, 'utf8')));
    if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' }); }
  } else if (command === 'apply' && input && flag === '--apply' && !output) result = applyReconciliation(root, JSON.parse(readFileSync(input, 'utf8')));
  else throw Error(usage);
  console.log(JSON.stringify(result, null, 2));
} catch (e) { console.error(`${e.code ?? 'E_RECONCILIATION'}: ${e.message}`); process.exitCode = 1; }
