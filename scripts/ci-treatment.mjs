#!/usr/bin/env node
// How much validation this candidate has earned, from what it actually changed.
//
//   node scripts/ci-treatment.mjs --base <ref> [--head <ref>] [--json] [--github-output]
//
// It classifies the FULL candidate against its base, never the last commit: adding a commit
// that says "the run was green" on top of a code change would otherwise reclassify the code
// out of sight, which is the shortcut this exists to refuse.
//
// It decides nothing about merging and touches no protection. It prints a treatment and the
// checks that treatment owes; the workflow decides what to run, and the aggregate decides
// whether they all reported success.
//
// Exit codes: 0 classified, 1 the comparison is unavailable, 2 usage.

import { flags } from './lib/shared/index.mjs';
import { appendFileSync } from 'node:fs';
import { readDiff, classifyDiff, treatmentFor, REQUIRED_JOBS } from './lib/evidence/index.mjs';

const root = process.env.SPECTREE_PROJECT_ROOT ?? process.cwd();
const argv = process.argv.slice(2);
const flag = flags(argv).value;

const base = flag('base') ?? process.env.GITHUB_BASE_REF;
if (!base) {
  console.error('usage: ci-treatment.mjs --base <ref> [--head <ref>] [--json] [--github-output]');
  console.error('  Without a base there is no candidate, and an unclassified candidate gets the full suite.');
  process.exit(2);
}
const head = flag('head', 'HEAD');

let diff;
try {
  diff = classifyDiff(readDiff(base, head, { cwd: root }));
} catch (e) {
  // An unavailable comparison is unknown. Unknown is the full suite, and it says why.
  const answer = { treatment: 'full', reason: `${e.code}: ${e.message}`, checks: REQUIRED_JOBS.full, files: 0 };
  if (argv.includes('--json')) console.log(JSON.stringify(answer, null, 2));
  else console.error(`full — ${answer.reason}`);
  if (argv.includes('--github-output') && process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `treatment=full\nchecks=${answer.checks.join(',')}\n`);
  }
  process.exit(1);
}

const t = treatmentFor(diff);
const answer = {
  treatment: t.treatment,
  reason: t.reason,
  kinds: t.kinds,
  checks: REQUIRED_JOBS[t.treatment],
  files: diff.files.length,
  deciding: t.deciding.slice(0, 20).map((f) => ({ path: f.path, kinds: f.kinds, status: f.status })),
};

if (argv.includes('--github-output') && process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `treatment=${answer.treatment}\nchecks=${answer.checks.join(',')}\n`);
}
if (argv.includes('--json')) { console.log(JSON.stringify(answer, null, 2)); process.exit(0); }

console.log(`${answer.treatment} — ${answer.reason}`);
console.log(`  ${answer.files} file(s) compared ${base}..${head}; kinds: ${answer.kinds.join(', ') || 'none'}`);
console.log(`  required: ${answer.checks.join(', ')}`);
for (const f of answer.deciding) console.log(`  ${f.status}  ${f.path}  [${f.kinds.join(', ')}]`);
