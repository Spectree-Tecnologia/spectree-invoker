#!/usr/bin/env node
// Confirm an integration that already happened, and close the change. Nothing else.
//
//   node scripts/post-merge.mjs <change-id> --pr <number> [--base main] [--apply] [--json]
//
// This phase is finite by design. It is not a place for a fresh architecture review, a rewrite
// of the role files, a manual recount of the backlog, an investigation of an auxiliary tool, or
// an opportunistic fix — every one of those turned a confirmation into a second delivery, and
// each second delivery cost another PR and another CI run validating a note about the previous.
//
// What it will not do: hide a failure to make the sequence short, and — the defect that made
// this file worth rewriting — it will not confirm the LOCAL CHECKOUT. The checkout is whatever
// the operator happens to have. The question is what landed in the merge the PR names, so every
// content comparison here is against that commit's tree.
//
// Exit codes: 0 confirmed (or planned), 1 refused, 2 usage.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Store, SCHEMA_VERSION } from './lib/store.mjs';
import { contractDigestAt, contentDigestAt, gatedDigest } from './lib/digest.mjs';
import { readDiff, classifyDiff } from './lib/diff.mjs';
import { treatmentFor, aggregate } from './lib/ci-policy.mjs';
import { manifestPath, preparationCovers, approvalsInForce } from './lib/closure-prep.mjs';
import { canTransition, ORDER } from './lib/state-machine.mjs';
import { pullRequest, runsForSha } from './lib/gh.mjs';

const root = process.env.SPECTREE_PROJECT_ROOT ?? process.cwd();
const argv = process.argv.slice(2);
const changeId = argv[0];
const apply = argv.includes('--apply');
const asJson = argv.includes('--json');
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const die = (msg, code = 2) => { console.error(msg); process.exit(code); };

if (!changeId || changeId.startsWith('--')) die('usage: post-merge.mjs <change-id> --pr <number> [--base main] [--apply] [--json]');
const prNumber = flag('pr') ?? die('--pr <number> is required: the confirmation is about one merge, and it has to name it');
const expectedBase = flag('base', 'main');

const store = new Store(root);
const change = store.change(changeId) ?? die(`no such change: ${changeId}`, 1);
const project = store.project();

const steps = [];
const impediments = [];
const step = (name, ok, detail) => { steps.push({ name, ok, detail }); if (!ok) impediments.push(`${name}: ${detail}`); };
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

// --- 1. what the merge actually did, asked once, for the fields gh actually has -------------
let pr = null;
try { pr = pullRequest(prNumber, { cwd: root }); step('merge result read', true, `PR #${pr.number} is ${pr.state}`); }
catch (e) { step('merge result read', false, `${e.code}: ${e.message}`); }

// --- 2. the right PR, on the right base ------------------------------------------------------
const mergeOid = pr?.mergeCommit?.oid ?? null;
if (pr) {
  const merged = pr.state === 'MERGED' && Boolean(pr.mergedAt);
  step('merged', merged,
    merged ? `at ${pr.mergedAt}, merge commit ${String(mergeOid ?? '').slice(0, 8)}`
      : pr.state === 'MERGED' ? 'the PR says MERGED but reports no mergedAt, so when it merged cannot be established'
        : `PR #${pr.number} is ${pr.state}, not merged`);
  step('base branch', pr.baseRefName === expectedBase, `merged into "${pr.baseRefName}", expected "${expectedBase}"`);
  step('merge commit named', Boolean(mergeOid), mergeOid ? mergeOid.slice(0, 12) : 'the PR reports no merge commit, so there is nothing to compare against');
}

// The manifest is read before the approvals, because it says which approvals are retired.
const manifest = (() => { try { return JSON.parse(readFileSync(join(root, manifestPath(changeId)), 'utf8')); } catch { return null; } })();

// --- 3. is what LANDED the candidate that was authorised? ------------------------------------
// Against the merge commit's tree, never the checkout. The two are different questions, and the
// checkout answers the one nobody asked.
let contract = null, landed = null, gated = null, authorising = null;
if (mergeOid) {
  try { landed = contentDigestAt(root, mergeOid); }
  catch (e) { step('the merge is readable here', false, `${e.code}: ${e.message}`); }
}
if (landed) {
  // The CONTRACT is read from the merge too. `docs/changes/` is outside the code digest by
  // design, so a merge that quietly rewrote a proposal changes nothing the code comparison can
  // see — and reading it from the checkout answers a question about the operator's disk.
  try { contract = contractDigestAt(root, landed.revision, change); }
  catch (e) { step('the contract in the merge is readable', false, `${e.code}: ${e.message}`); }
}
if (landed && contract) {
  gated = gatedDigest(contract.digest, landed.digest);
  // Through the shared rule, like every other consumer: an approval the current preparation
  // retired was granted over a record that no longer exists, so it cannot authorise the one
  // replacing it. Same definition here, in the gates, in `resume` and in the preparation.
  const { inForce, retired } = approvalsInForce(store.approvals(changeId), manifest);
  const approvals = inForce.filter((a) => a.gate === 'integration' && a.change_id === changeId);
  if (retired.length) {
    step('the approval in force is not one this preparation retired', approvals.length > 0,
      approvals.length
        ? `${retired.length} retired by the reopening, ${approvals.length} still standing`
        : `every integration approval on record (${retired.map((a) => a.approval_id).join(', ')}) was retired when the closure was reopened; a new one is required`);
  }

  // ONE approval has to satisfy every criterion. Checking the content against whichever approval
  // matches and the ancestry against whichever happens to be first lets two different documents
  // each supply half an authorisation, and the order of files on disk decide the verdict.
  const candidates = approvals.filter((a) => a.scope_digest === gated);
  authorising = candidates.find((a) => {
    if (!a.revision) return false;
    try { execFileSync('git', ['merge-base', '--is-ancestor', a.revision, landed.revision], { cwd: root, stdio: 'ignore' }); return true; }
    catch { return false; }
  }) ?? null;

  step('what landed is what was authorised', candidates.length > 0,
    candidates.length
      ? `approval ${candidates[0].approval_id} names the contract and the tree of ${landed.revision.slice(0, 8)}`
      : approvals.length
        ? `no integration approval names ${gated.slice(0, 18)}… — ${approvals.length} on record name ${approvals.map((a) => String(a.scope_digest).slice(0, 14)).join(', ')}; a merge that changed the tree or the contract is a different candidate`
        : 'no integration approval names this change');

  step('one approval covers both the content and the history', Boolean(authorising),
    authorising
      ? `${authorising.approval_id} at ${authorising.revision.slice(0, 8)}, an ancestor of ${landed.revision.slice(0, 8)}`
      : candidates.length
        ? `${candidates.length} approval(s) name this content, and none of them was granted at a commit inside ${landed.revision.slice(0, 8)}`
        : 'no approval names this content, so there is none whose history to check');
}

// --- 4. the checks the policy required, for THAT commit --------------------------------------
let treatment = null;
if (landed) {
  try { treatment = treatmentFor(classifyDiff(readDiff(change.base_revision, landed.revision, { cwd: root }))); }
  catch (e) { step('candidate classified', false, `${e.code}: ${e.message}`); }
}
if (treatment) {
  // `gh` reports workflow runs; the policy speaks in check names. Nothing can bridge those two
  // by guessing, so the project declares the mapping — and a project that has not is UNKNOWN,
  // which is never permission.
  const declared = project?.ci?.required_runs;
  const wanted = Array.isArray(declared) ? declared : declared?.[treatment.treatment];
  if (!wanted || wanted.length === 0) {
    step('CI mapping declared', false,
      'E_CI_MAP_MISSING: this project does not declare which workflow runs satisfy the policy ' +
      '(`ci.required_runs` in .spectree/project.json, a list or one list per treatment). ' +
      'A check nobody mapped is a check nobody observed.');
  } else {
    let observed = {};
    try {
      const runs = runsForSha(landed.revision, { cwd: root });
      observed = Object.fromEntries(wanted.map((name) => {
        const hit = runs.find((r) => r.workflowName === name || r.name === name);
        if (!hit) return [name, undefined];
        return [name, hit.status === 'completed' ? (hit.conclusion ?? 'unknown') : hit.status];
      }).filter(([, v]) => v !== undefined));
    } catch (e) { step('post-merge checks read', false, `${e.code}: ${e.message}`); }
    const verdict = aggregate(treatment.treatment, observed, wanted);
    step(`required runs for "${treatment.treatment}"`, verdict.ok,
      verdict.ok ? `${wanted.join(', ')} succeeded on ${landed.revision.slice(0, 8)}` : `${verdict.code}: ${verdict.message}`);
  }
}

// --- 5. the artifacts the preparation said it produced ---------------------------------------
if (change.closure_mode === 'legacy') {
  step('closure preparation', true, 'this change closes the legacy way, and said so before integration');
} else if (contract && landed) {
  const covers = preparationCovers(manifest, { contractDigest: contract.digest, candidateDigest: landed.digest, changeId });
  step('closure preparation covers what landed', covers.ok === true, covers.ok ? `manifest ${manifest.manifest_version}` : `${covers.code}: ${covers.message}`);
  // Present is not enough: an artifact whose CONTENT changed in the merge is a different
  // artifact, and existence was the weakest possible question to ask about it.
  const wrong = (manifest?.artifacts ?? []).filter((a) => {
    let blob = null;
    try { blob = git(['rev-parse', `${landed.revision}:${a.path}`]); } catch { return true; }
    return blob !== a.digest;
  });
  step('prepared artifacts are in the merge, unchanged', wrong.length === 0,
    wrong.length ? `${wrong.length} missing or altered in ${landed.revision.slice(0, 8)}: ${wrong.slice(0, 3).map((a) => a.path).join(', ')}`
      : `${manifest?.artifacts?.length ?? 0} present and identical`);
}

// --- report ----------------------------------------------------------------------------------
const summary = {
  change_id: changeId,
  state_before: change.state,
  pr: pr ? { number: pr.number, url: pr.url, merge_commit: mergeOid, base: pr.baseRefName } : null,
  treatment: treatment?.treatment ?? null,
  steps, impediments, closed: change.state === 'closed',
};

if (impediments.length) {
  if (asJson) console.log(JSON.stringify(summary, null, 2));
  else {
    console.error(`post-merge REFUSED for ${changeId}`);
    for (const s of steps) console.error(`  ${s.ok ? 'ok  ' : 'FAIL'}  ${s.name} — ${s.detail}`);
    console.error('\nA short confirmation is not one that skipped a failure. Fix the impediment; do not close');
    console.error('the change, and do not open another PR to record that it is closed.');
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

// --- 6, 7. record the result and close, from wherever this change actually is -----------------
// Resumable by step. Re-running after a crash — or after success — repeats no event and refuses
// nothing that already happened: the remaining work is computed from the state on disk.
const closure = change.closure_mode === 'legacy'
  ? { ok: true, legacy: true }
  : preparationCovers(manifest, { contractDigest: contract.digest, candidateDigest: landed.digest, changeId });

store.appendHistory(changeId, {
  // A stable id, so the same confirmation twice is one event and not two.
  event_id: `integration_observed:pr-${prNumber}:${mergeOid}`,
  type: 'integration_observed',
  at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  pr: Number(prNumber), merge_commit: mergeOid, treatment: summary.treatment,
  schema_version: SCHEMA_VERSION,
});

if (!store.evidence(changeId).some((e) => e.property === 'closure.merged' && !e.superseded_by)) {
  // The merge was observed here, through `gh` and through git. Recording it is what lets `closed`
  // be reached without a commit whose only content is "it merged".
  store.putEvidence({
    schema_version: SCHEMA_VERSION,
    evidence_id: `ev-merge-${changeId}`,
    change_id: changeId,
    property: 'closure.merged',
    check: `gh pr view ${prNumber} --json state,mergedAt,mergeCommit,baseRefName + git merge-base --is-ancestor`,
    executor: { role: 'platform_engineer' },
    source_kind: 'observed_execution',
    revision: landed.revision,
    result: 'PASS',
    environment: { os: process.platform, runtime: `node ${process.versions.node}` },
    timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  });
}

const ctx = () => ({
  evidence: store.evidence(changeId), approvals: store.approvals(changeId),
  revision: landed.revision, contentDigest: landed.digest, contractDigest: contract.digest, closure,
  scopeDigests: {
    scope: contract.digest, ambiguity: contract.digest,
    integration: gated, irreversible: gated, exposure: gated,
  },
});

const target = ORDER.indexOf('closed');
for (;;) {
  const current = store.change(changeId);
  const at = ORDER.indexOf(current.state);
  if (at >= target) break;
  const to = ORDER[at + 1];
  if (to !== 'integrated' && to !== 'closed') {
    step('reachable from here', false, `the change is at "${current.state}", and a post-merge confirmation does not carry it forward from there`);
    break;
  }
  const verdict = canTransition(current, to, ctx());
  if (!verdict.ok) {
    console.error(`post-merge stopped at ${to}: ${verdict.code}: ${verdict.message}`);
    process.exit(1);
  }
  store.putChange({ ...current, state: to, evaluated_revision: landed.revision },
    { event: { type: 'transition', from: current.state, to }, expected: current.state_revision });
}

const final = store.change(changeId);
summary.closed = final.state === 'closed';
if (!summary.closed) {
  console.error(`post-merge did not close ${changeId}: it is at "${final.state}"`);
  for (const s of steps.filter((x) => !x.ok)) console.error(`  ${s.name} — ${s.detail}`);
  process.exit(1);
}

if (asJson) console.log(JSON.stringify(summary, null, 2));
else {
  for (const s of steps) console.log(`  ok    ${s.name} — ${s.detail}`);
  console.log(`\n${change.state === 'closed' ? 'already closed' : 'closed'} ${changeId}. PR #${prNumber}, merge ${String(mergeOid).slice(0, 8)}, treatment ${summary.treatment}.`);
  console.log('No commit was made to record this: the event is in the trail, not in the content it describes.');
}
