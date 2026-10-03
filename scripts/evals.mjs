#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { evaluationCases, runEvaluations } from './lib/agent-evals.mjs';
try {
  const args = process.argv.slice(2); const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') opts.apply = true;
    else if (['--adapter', '--output', '--case', '--mode'].includes(args[i]) && args[i + 1]) opts[args[i].slice(2)] = args[++i];
    else throw Error('usage: evals.mjs [--case <id>] --adapter <config.json> --output <directory> [--mode live|transport-test] --apply');
  }
  if (!opts.apply) console.log(JSON.stringify({ dry_run: true, cases: evaluationCases().cases.map((c) => c.id),
    meaning: 'Use --apply to spend model usage in newly created disposable projects. No agent was run.' }, null, 2));
  else {
    if (!opts.adapter || !opts.output) throw Error('Specify --adapter and --output.');
    const result = runEvaluations({ config: JSON.parse(readFileSync(opts.adapter, 'utf8')), output: opts.output, caseId: opts.case, mode: opts.mode });
    console.log(JSON.stringify(result, null, 2)); if (!result.passed) process.exitCode = 1;
  }
} catch (e) { console.error(`${e.code ?? 'E_EVAL'}: ${e.message}`); process.exitCode = 1; }
