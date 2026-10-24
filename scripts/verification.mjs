#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { verificationPlan, verificationChecks, baselineVerdict, verificationCi, ciRunBaseline } from './lib/evidence/index.mjs';
import { Store, SCHEMA_VERSION } from './lib/change/index.mjs';
import { contentDigestAt, runView, repository } from './lib/shared/index.mjs';
const [command, file, extra, ...rest] = process.argv.slice(2);
const USAGE = 'usage: verification.mjs plan <plan.json> | checks <plan.json> <report.tap> | ci <plan.json> <job-results.json> | baseline <change-id> <local|ci> [--from-run <run-id>]';
try {
  const read = (f) => JSON.parse(readFileSync(f, 'utf8'));
  let result;
  if (command === 'plan' && file && !extra) result = verificationPlan(read(file));
  else if (command === 'checks' && file && extra) result = verificationChecks(read(file), readFileSync(extra, 'utf8'));
  else if (command === 'ci' && file && extra) result = verificationCi(read(file), read(extra));
  else if (command === 'baseline' && file && ['local', 'ci'].includes(extra) &&
      (!rest.length || (extra === 'ci' && rest.length === 2 && rest[0] === '--from-run' && /^\d+$/.test(rest[1])))) {
    const root = process.env.SPECTREE_PROJECT_ROOT ?? process.cwd();
    const store = new Store(root); const change = store.change(file);
    if (!change) throw Error('Unknown structured change; do not manufacture baseline evidence for legacy history.');
    const base = contentDigestAt(root, change.base_revision);
    if (rest.length) {
      // The run the project already paid for, read by its id over the REST API. It records one
      // observation of the base and judges the baseline the same way a fresh run would be judged.
      const project = store.project();
      const repo = project?.repository ?? repository({ cwd: root });
      const observed = ciRunBaseline(runView(rest[1], { cwd: root, repo, jobs: true }), {
        project, changeId: file, revision: base.revision, fingerprint: base.digest,
        at: new Date().toISOString().replace(/\.\d+Z$/, 'Z') });
      if (!observed.ok) { const e = Error(observed.message); e.code = observed.code; throw e; }
      store.putEvidence({ schema_version: SCHEMA_VERSION, ...observed.evidence });
      console.error(`recorded ${observed.evidence.evidence_id}: suite.baseline = ${observed.result} from run ${rest[1]} (observed_ci_run)`);
    }
    result = baselineVerdict(store.evidence(file), { revision: base.revision, fingerprint: base.digest, environment: extra });
  } else throw Error(USAGE);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} catch (e) { console.error(`${e.code ?? 'E_VERIFICATION'}: ${e.message}`); process.exitCode = 1; }
