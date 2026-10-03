#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { runMutation } from './lib/mutation.mjs';
const [file, ...flags] = process.argv.slice(2);
try {
  if (!file || flags.some((f) => f !== '--apply')) throw Error('usage: mutation-probe.mjs <plan.json> [--apply]');
  const result = runMutation(process.env.SPECTREE_PROJECT_ROOT ?? process.cwd(), JSON.parse(readFileSync(file, 'utf8')), { apply: flags.includes('--apply') });
  console.log(JSON.stringify(result, null, 2));
  if (!result.dry_run && result.result !== 'PASS') process.exitCode = 1;
} catch (e) { console.error(`${e.code ?? 'E_MUTATION'}: ${e.message}`); process.exitCode = 1; }
