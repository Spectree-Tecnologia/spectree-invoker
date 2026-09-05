#!/usr/bin/env node
// Scope and closure verification for one change, against its recorded base revision.
//
//   node scripts/verify-change.mjs <change-id> [--head HEAD] [--json]
//
// Reads the change from .spectree, compares the working head against the change's
// IMMUTABLE base_revision, and reports findings. Errors exit 1; review items exit 0
// and are listed, because they need a reader, not a matcher.

import { existsSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from './lib/store.mjs';
import { readDiff, classifyDiff, outsideAllowedPaths } from './lib/diff.mjs';
import { checkDeltaless, checkProposalDeltaContract } from './lib/closure.mjs';

const root = process.env.SPECTREE_PROJECT_ROOT ?? process.cwd();
const argv = process.argv.slice(2);
const changeId = argv[0];
const asJson = argv.includes('--json');
const headArg = argv.indexOf('--head');
const head = headArg >= 0 ? argv[headArg + 1] : 'HEAD';

if (!changeId) { console.error('usage: verify-change.mjs <change-id> [--head <rev>] [--json]'); process.exit(2); }

const store = new Store(root);
const change = store.change(changeId);
if (!change) { console.error(`no such change: ${changeId}`); process.exit(1); }

let diff;
try {
  diff = classifyDiff(readDiff(change.base_revision, head, { cwd: root }));
} catch (e) {
  // An unavailable comparison is unknown. It is never "nothing changed".
  console.error(`${e.code ?? 'E_DIFF'}: ${e.message}`);
  process.exit(1);
}

const findings = [];

for (const bad of outsideAllowedPaths(diff.files, change.allowed_paths)) {
  findings.push({
    code: 'E_OUTSIDE_OWNERSHIP', severity: 'error', mechanical: true,
    message: `${bad.path} (${bad.status}) is outside this change's declared paths`,
  });
}

const changeDir = join(root, 'docs', 'changes', changeId);
const specsDir = join(changeDir, 'specs');
const hasSpecFolder = existsSync(specsDir) && readdirSync(specsDir).length > 0;
findings.push(...checkDeltaless(diff, { declaredDeltaless: change.deltaless === true, hasSpecFolder }));

if (hasSpecFolder && Array.isArray(change.modules_named)) {
  const deltaModules = readdirSync(specsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  findings.push(...checkProposalDeltaContract(change.modules_named, deltaModules));
}

const errors = findings.filter((f) => f.severity === 'error');
const report = {
  change_id: changeId,
  base_revision: change.base_revision,
  head,
  kinds: diff.kinds,
  administrative_only: diff.administrative_only,
  files: diff.files.length,
  findings,
  verdict: errors.length ? 'REFUSED' : 'NO_MECHANICAL_OBJECTION',
};

if (asJson) { console.log(JSON.stringify(report, null, 2)); process.exit(errors.length ? 1 : 0); }

console.log(`change ${changeId}  base ${change.base_revision.slice(0, 8)}..${head}`);
console.log(`  ${diff.files.length} file(s); kinds: ${diff.kinds.join(', ') || 'none'}`);
console.log(`  administrative only: ${diff.administrative_only}`);
for (const f of findings) {
  const tag = f.severity === 'error' ? 'ERROR ' : f.severity === 'review' ? 'REVIEW' : 'INFO  ';
  console.log(`  ${tag} ${f.code}: ${f.message}`);
  for (const q of f.review_questions ?? []) console.log(`         - ${q}`);
  if (f.detail) for (const d of f.detail.slice(0, 10)) console.log(`         · ${typeof d === 'string' ? d : `${d.status} ${d.path}`}`);
}
console.log(`  verdict: ${report.verdict}` + (errors.length ? '' : '  (no mechanical objection is not an approval)'));
process.exit(errors.length ? 1 : 0);
