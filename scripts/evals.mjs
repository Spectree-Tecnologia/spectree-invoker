#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { evaluationCases, runEvaluations, runFlowEvaluation } from './lib/evaluation/index.mjs';
try {
  const args = process.argv.slice(2); const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') opts.apply = true;
    else if (['--adapter', '--output', '--case', '--mode', '--suite'].includes(args[i]) && args[i + 1]) opts[args[i].slice(2)] = args[++i];
    else throw Error('usage: evals.mjs [--case <id>] --adapter <config.json> --output <directory> [--mode live|transport-test] --apply');
  }
  if (opts.suite && !['decisions', 'flow'].includes(opts.suite)) throw Error('Unknown suite; select decisions or flow.');
  if (opts.suite === 'flow' && opts.case) throw Error('The flow suite is one complete scenario; --case applies to decisions only.');
  if (!opts.apply) console.log(JSON.stringify({ dry_run: true, cases: opts.suite === 'flow' ? ['operational-flow'] : evaluationCases().cases.map((c) => c.id),
    meaning: 'Use --apply to spend model usage in newly created disposable projects. No agent was run.' }, null, 2));
  else {
    if (!opts.adapter || !opts.output) throw Error('Specify --adapter and --output.');
    const result = (opts.suite === 'flow' ? runFlowEvaluation : runEvaluations)({ config: JSON.parse(readFileSync(opts.adapter, 'utf8')), output: opts.output, caseId: opts.case, mode: opts.mode });
    console.log(JSON.stringify(result, null, 2)); if (!result.passed) process.exitCode = 1;
  }
} catch (e) { console.error(`${e.code ?? 'E_EVAL'}: ${e.message}`); process.exitCode = 1; }
