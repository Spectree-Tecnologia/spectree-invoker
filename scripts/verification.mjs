#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { verificationPlan, verificationChecks, baselineVerdict, verificationCi } from './lib/evidence/index.mjs';
import { Store } from './lib/change/index.mjs';
import { contentDigestAt } from './lib/shared/index.mjs';
const [command, file, extra] = process.argv.slice(2);
try {
  const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
  let result;
  if (command === 'plan' && file && !extra) result = verificationPlan(read(file));
  else if (command === 'checks' && file && extra) result = verificationChecks(read(file), readFileSync(extra, 'utf8'));
  else if (command === 'ci' && file && extra) result = verificationCi(read(file), read(extra));
  else if (command === 'baseline' && file && ['local', 'ci'].includes(extra)) {
    const root = process.env.SPECTREE_PROJECT_ROOT ?? process.cwd();
    const store = new Store(root); const change = store.change(file);
    if (!change) throw Error('Unknown structured change; do not manufacture baseline evidence for legacy history.');
    const base = contentDigestAt(root, change.base_revision);
    result = baselineVerdict(store.evidence(file), { revision: base.revision, fingerprint: base.digest, environment: extra });
  } else throw Error('usage: verification.mjs plan <plan.json> | checks <plan.json> <report.tap> | ci <plan.json> <job-results.json> | baseline <change-id> <local|ci>');
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} catch (e) { console.error(`${e.code ?? 'E_VERIFICATION'}: ${e.message}`); process.exitCode = 1; }
