#!/usr/bin/env node
// Confirm an integration that already happened, and close the change. Nothing else.
//
//   node scripts/post-merge.mjs <change-id> --pr <number> [--apply] [--json]
//
// This phase is finite by design. It is not a place for a fresh architecture review, a rewrite
// of the role files, a manual recount of the backlog, an investigation of an auxiliary tool, or
// an opportunistic fix — every one of those turned a confirmation into a second delivery, and
// each second delivery cost another PR and another CI run that validated a note about the
// previous one.
//
// What it will not do: hide a failure to make the sequence short. A required check that failed,
// was cancelled, or never reported stops the closure and produces an impediment.
//
// Exit codes: 0 confirmed (or planned), 1 refused, 2 usage.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store, SCHEMA_VERSION } from './lib/store.mjs';
import { contractDigest, contentDigest, gatedDigest } from './lib/digest.mjs';
import { readDiff, classifyDiff } from './lib/diff.mjs';
import { treatmentFor, aggregate } from './lib/ci-policy.mjs';
import { manifestPath, preparationCovers } from './lib/closure-prep.mjs';
import { canTransition } from './lib/state-machine.mjs';
import { pullRequest, checksFor } from './lib/gh.mjs';

const root = process.env.SPECTREE_PROJECT_ROOT ?? process.cwd();
const argv = process.argv.slice(2);
const changeId = argv[0];
const apply = argv.includes('--apply');
const asJson = argv.includes('--json');
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const die = (msg, code = 2) => { console.error(msg); process.exit(code); };

if (!changeId || changeId.startsWith('--')) die('usage: post-merge.mjs <change-id> --pr <number> [--apply] [--json]');
const prNumber = flag('pr') ?? die('--pr <number> is required: the confirmation is about one merge, and it has to name it');

const store = new Store(root);
const change = store.change(changeId) ?? die(`no such change: ${changeId}`, 1);

const steps = [];
const impediments = [];
const step = (name, ok, detail) => { steps.push({ name, ok, detail }); if (!ok) impediments.push(`${name}: ${detail}`); };

// 1. what the merge actually did, asked once, for the fields that are read
let pr = null;
try { pr = pullRequest(prNumber, { cwd: root }); step('merge result read', true, `PR #${pr.number} ${pr.merged ? 'merged' : pr.state}`); }
catch (e) { step('merge result read', false, `${e.code}: ${e.message}`); }

// 2. the right PR, on the right base
if (pr) {
  step('merged', pr.merged === true, pr.merged ? `merge commit ${String(pr.mergeCommit?.oid ?? '').slice(0, 8)}` : `PR #${pr.number} is ${pr.state}, not merged`);
  const expectedBase = flag('base', 'main');
  step('base branch', pr.baseRefName === expectedBase, `merged into "${pr.baseRefName}", expected "${expectedBase}"`);
}

// 3. is what landed the candidate that was authorised?
let contract = null, content = null, gated = null;
try {
  contract = contractDigest(root, change);
  content = contentDigest(root);
  gated = gatedDigest(contract.digest, content.digest);
} catch (e) { step('content readable', false, `${e.code}: ${e.message}`); }

if (gated) {
  const approvals = store.approvals(changeId).filter((a) => a.gate === 'integration');
  const matching = approvals.find((a) => a.scope_digest === gated);
  step('integrated content equals the authorised candidate', Boolean(matching),
    matching
      ? `approval ${matching.approval_id} names this exact contract and content`
      : approvals.length
        ? `the integration approval names ${String(approvals[0].scope_digest).slice(0, 18)}… and what is here is ${gated.slice(0, 18)}… — a merge that changed the tree is a different candidate`
        : 'no integration approval is on record for this change');
}

// 4. the checks the policy required for this candidate, on the merge commit
let treatment = null;
if (content) {
  try {
    const diff = classifyDiff(readDiff(change.base_revision, 'HEAD', { cwd: root }));
    treatment = treatmentFor(diff);
  } catch (e) { step('candidate classified', false, `${e.code}: ${e.message}`); }
}
if (treatment) {
  let observed = {};
  try {
    const runs = checksFor(flag('base', 'main'), { cwd: root })
      .filter((r) => !pr?.mergeCommit?.oid || r.headSha === pr.mergeCommit.oid);
    observed = Object.fromEntries(runs.map((r) => [r.name, r.status === 'completed' ? (r.conclusion ?? 'unknown') : r.status]));
  } catch (e) { step('post-merge checks read', false, `${e.code}: ${e.message}`); }
  const verdict = aggregate(treatment.treatment, observed);
  step(`required checks for "${treatment.treatment}"`, verdict.ok, verdict.ok ? `all of ${verdict.required.join(', ')} succeeded` : `${verdict.code}: ${verdict.message}`);
}

// 5. the artifacts the preparation said it produced are here
const manifest = (() => { try { return JSON.parse(readFileSync(join(root, manifestPath(changeId)), 'utf8')); } catch { return null; } })();
if (change.closure_mode === 'legacy') {
  step('closure preparation', true, 'this change closes the legacy way, and said so before integration');
} else if (contract && content) {
  const covers = preparationCovers(manifest, { contractDigest: contract.digest, candidateDigest: content.digest });
  step('closure preparation covers what landed', covers.ok === true, covers.ok ? `manifest ${manifest.manifest_version}` : `${covers.code}: ${covers.message}`);
  const absent = (manifest?.artifacts ?? []).filter((a) => !existsSync(join(root, a.path)));
  step('prepared artifacts present', absent.length === 0, absent.length ? `${absent.length} missing: ${absent.slice(0, 3).map((a) => a.path).join(', ')}` : `${manifest?.artifacts?.length ?? 0} present`);
}

// --- report -----------------------------------------------------------------------------
const summary = {
  change_id: changeId,
  pr: pr ? { number: pr.number, url: pr.url, merge_commit: pr.mergeCommit?.oid ?? null, base: pr.baseRefName } : null,
  treatment: treatment?.treatment ?? null,
  steps, impediments,
  closed: false,
};

if (impediments.length) {
  if (asJson) console.log(JSON.stringify(summary, null, 2));
  else {
    console.error(`post-merge REFUSED for ${changeId}`);
    for (const s of steps) console.error(`  ${s.ok ? 'ok  ' : 'FAIL'}  ${s.name} — ${s.detail}`);
    console.error('\nA short confirmation is not a confirmation that skipped a failure. Fix the impediment;');
    console.error('do not close the change and do not open another PR to record that it is closed.');
  }
  process.exit(1);
}

if (!apply) {
  if (asJson) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`post-merge OK for ${changeId} — nothing written (add --apply to close)`);
    for (const s of steps) console.log(`  ok    ${s.name} — ${s.detail}`);
  }
  process.exit(0);
}

// 6, 7. record the operational result and close. Both are state, and neither is a commit: an
// event about a revision is not part of the content it describes.
store.appendHistory(changeId, {
  type: 'integration_observed', at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  pr: summary.pr?.number ?? null, merge_commit: summary.pr?.merge_commit ?? null,
  treatment: summary.treatment, schema_version: SCHEMA_VERSION,
});

// The merge was observed here, through `gh`, so this IS an observed execution — and recording
// it is what lets `closed` be reached without a commit whose only content is "it merged".
const g = { revision: content?.revision ?? change.evaluated_revision };
store.putEvidence({
  schema_version: SCHEMA_VERSION,
  evidence_id: `ev-merge-${changeId}`,
  change_id: changeId,
  property: 'closure.merged',
  check: `gh pr view ${prNumber} --json merged,mergeCommit,baseRefName`,
  executor: { role: 'platform_engineer' },
  source_kind: 'observed_execution',
  revision: g.revision,
  result: 'PASS',
  environment: { os: process.platform, runtime: `node ${process.versions.node}` },
  timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
});
for (const to of ['integrated', 'closed']) {
  const verdict = canTransition(store.change(changeId), to, {
    evidence: store.evidence(changeId), approvals: store.approvals(changeId),
    revision: g.revision, contentDigest: content?.digest, contractDigest: contract?.digest,
    closure: change.closure_mode === 'legacy' ? { ok: true, legacy: true } : preparationCovers(manifest, { contractDigest: contract.digest, candidateDigest: content.digest }),
    scopeDigests: { scope: contract.digest, ambiguity: contract.digest, integration: gated, irreversible: gated, exposure: gated },
  });
  if (!verdict.ok) {
    console.error(`post-merge stopped at ${to}: ${verdict.code}: ${verdict.message}`);
    process.exit(1);
  }
  const current = store.change(changeId);
  store.putChange({ ...current, state: to, evaluated_revision: g.revision },
    { event: { type: 'transition', from: current.state, to }, expected: current.state_revision });
}
summary.closed = true;

if (asJson) console.log(JSON.stringify(summary, null, 2));
else {
  for (const s of steps) console.log(`  ok    ${s.name} — ${s.detail}`);
  console.log(`\nclosed ${changeId}. PR #${summary.pr?.number}, merge ${String(summary.pr?.merge_commit ?? '').slice(0, 8)}, treatment ${summary.treatment}.`);
  console.log('No commit was made to record this: the event is in the trail, not in the content it describes.');
}
