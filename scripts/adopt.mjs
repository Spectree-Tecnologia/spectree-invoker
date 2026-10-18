#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { planAdoption, applyAdoption } from './lib/closure/index.mjs';
const root = process.env.SPECTREE_PROJECT_ROOT ?? process.cwd();
const [command, input, flag, output] = process.argv.slice(2);
try {
  if (!input || process.argv.length > 6) throw Error('usage: adopt.mjs plan <request.json> [--output <file>] | apply <reviewed-plan.json> --apply');
  const doc = JSON.parse(readFileSync(input, 'utf8')); let result;
  if (command === 'plan' && (!flag || (flag === '--output' && output))) {
    result = planAdoption(root, doc);
    if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' }); }
  } else if (command === 'apply' && flag === '--apply' && !output) result = applyAdoption(root, doc);
  else throw Error('Apply requires an explicit --apply; planning writes only a requested output file.');
  console.log(JSON.stringify(result, null, 2));
} catch (e) { console.error(`${e.code ?? 'E_ADOPTION'}: ${e.message}`); process.exitCode = 1; }
