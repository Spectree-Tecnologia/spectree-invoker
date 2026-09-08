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
// What it PRODUCES is a receipt: which repository, which PR, which merge commit, which
// preparation, which approval, which runs and attempts, observed when. `integrated` and `closed`
// require it, so a `state transition` cannot assert an integration nobody observed.
//
// Exit codes: 0 confirmed (or planned), 1 refused, 2 usage.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Store, SCHEMA_VERSION } from './lib/store.mjs';
import { contractDigestAt, contentDigestAt, gatedDigest } from './lib/digest.mjs';
import { readDiff, classifyDiff } from './lib/diff.mjs';
import { treatmentFor, aggregate, resolveCi } from './lib/ci-policy.mjs';
import { preparationCovers, approvalsInForce, readManifest, compareArtifacts } from './lib/closure-prep.mjs';
import { canTransition, ORDER } from './lib/state-machine.mjs';
import {
  readLifecycle, pendingOperation, beginOperation, advanceOperation, completeOperation,
  buildReceipt, writeReceipt, readReceipt, receiptCovers,
  approvalCoversPreparation, approvalCoversTarget, newOperationId, PHASE,
} from './lib/lifecycle.mjs';
import { pullRequest, runsForCommit, latestRun, runView, repository } from './lib/gh.mjs';

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

const started = Number(process.hrtime.bigint() / 1000000n);
const metrics = { gh_calls: 0, git_calls: 0, log_bytes: 0 };
const steps = [];
const impediments = [];
const step = (name, ok, detail) => { steps.push({ name, ok, detail }); if (!ok) impediments.push(`${name}: ${detail}`); };
const git = (args) => {
  metrics.git_calls += 1;
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
};

// --- 0. the durable control ------------------------------------------------------------------
const lc = readLifecycle(root, changeId);
if (lc.present && !lc.doc) {
  step('the closure control is readable', false, `${lc.code}: ${lc.message}`);
}
const lifecycle = lc.doc;
const open = pendingOperation(lifecycle);
if (open && open.kind !== 'confirm') {
  step('no unfinished write is open', false,
    `a ${open.kind} operation (${open.operation_id}) stopped at "${open.phase}": ${open.recovery}`);
}

const manifestRead = readManifest(root, changeId);
if (manifestRead.present && !manifestRead.doc) step('the preparation is readable', false, `${manifestRead.code}: ${manifestRead.message}`);
const manifest = manifestRead.doc;

// --- 1. what the merge actually did, asked once, for the fields gh actually has -------------
let repo = project?.repository ?? null;
if (!repo) {
  try { repo = repository({ cwd: root }); metrics.gh_calls += 1; }
  catch { /* the query still works without --repo; it is just less precise, and that is said */ }
}
let pr = null;
try {
  pr = pullRequest(prNumber, { cwd: root, repo });
  metrics.gh_calls += 1;
  step('merge result read', true, `PR #${pr.number} is ${pr.state}${repo ? ` in ${repo}` : ''}`);
} catch (e) { step('merge result read', false, `${e.code}: ${e.message}`); }

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

const authority = approvalsInForce(store.approvals(changeId), manifest, {
  lifecycle,
  lifecycleError: lc.present && !lc.doc ? { code: lc.code, message: lc.message } : null,
});
if (!authority.ok) step('authority can be established', false, `${authority.code}: ${authority.message}`);

if (landed && contract && authority.ok) {
  gated = gatedDigest(contract.digest, landed.digest);
  const approvals = authority.inForce.filter((a) => a.gate === 'integration' && a.change_id === changeId);
  if (authority.retired.length) {
    step('the approval in force is not one this preparation retired', approvals.length > 0,
      approvals.length
        ? `${authority.retired.length} retired by a reopening, ${approvals.length} still standing`
        : `every integration approval on record (${authority.retired.map((a) => a.approval_id).join(', ')}) was retired when the closure was reopened; a new one is required`);
  }

  // ONE approval has to satisfy EVERY criterion. Checking the content against whichever approval
  // matches and the ancestry against whichever happens to be first lets two different documents
  // each supply half an authorisation, and the order of files on disk decide the verdict.
  const legacyMode = change.closure_mode === 'legacy';
  const reasons = new Map();
  const candidates = approvals.filter((a) => {
    if (a.scope_digest !== gated) { reasons.set(a.approval_id, 'names other content'); return false; }
    if (!legacyMode) {
      const p = approvalCoversPreparation(a, manifest);
      if (!p.ok) { reasons.set(a.approval_id, p.message); return false; }
      const t = approvalCoversTarget(a, {
        repository: repo, pr: Number(prNumber), headSha: pr?.headRefOid, baseBranch: pr?.baseRefName,
      });
      if (!t.ok) { reasons.set(a.approval_id, t.message); return false; }
    }
    return true;
  });
  authorising = candidates.find((a) => {
    if (!a.revision) return false;
    try { execFileSync('git', ['merge-base', '--is-ancestor', a.revision, landed.revision], { cwd: root, stdio: 'ignore' }); return true; }
    catch { return false; }
  }) ?? null;

  step('what landed is what was authorised', candidates.length > 0,
    candidates.length
      ? `approval ${candidates[0].approval_id} names this contract, this tree, this preparation and this PR`
      : approvals.length
        ? `no integration approval covers this integration — ${[...reasons.entries()].map(([id, why]) => `${id}: ${why}`).slice(0, 3).join('; ')}`
        : 'no integration approval names this change');

  step('one approval covers the content and the history', Boolean(authorising),
    authorising
      ? `${authorising.approval_id} at ${authorising.revision.slice(0, 8)}, an ancestor of ${landed.revision.slice(0, 8)}`
      : candidates.length
        ? `${candidates.length} approval(s) cover this integration, and none of them was granted at a commit inside ${landed.revision.slice(0, 8)}`
        : 'no approval covers this integration, so there is none whose history to check');
}

// --- 4. the checks the policy required, for THAT commit --------------------------------------
let treatment = null;
const observedRuns = [];
if (landed) {
  try { treatment = treatmentFor(classifyDiff(readDiff(change.base_revision, landed.revision, { cwd: root }))); }
  catch (e) { step('candidate classified', false, `${e.code}: ${e.message}`); }
}
if (treatment) {
  const ci = resolveCi(project, treatment.treatment);
  if (!ci.ok) {
    step('CI mapping declared', false, `${ci.code}: ${ci.message}`);
  } else {
    let observed = {};
    let discovery = null;
    try {
      discovery = runsForCommit(landed.revision, {
        cwd: root, repo, event: ci.event, branch: ci.branch, workflow: ci.workflowId ?? ci.workflow,
      });
      metrics.gh_calls += 1;
      // The most recent run of that workflow on that commit, and its latest attempt. An older
      // attempt that had been green is not evidence about the re-run that replaced it.
      const chosen = latestRun(discovery.runs, { workflowName: ci.workflow, workflowId: ci.workflowId });
      if (!chosen) {
        step('the required run was found', false, discovery.complete
          ? `no run of "${ci.workflow}" on ${landed.revision.slice(0, 8)}${ci.event ? ` for event ${ci.event}` : ''}`
          : `the run list came back full (${discovery.limit}) and the run of "${ci.workflow}" was not in it; an incomplete answer is not "it did not run"`);
      } else {
        const view = runView(chosen.databaseId, { cwd: root, repo, jobs: true });
        metrics.gh_calls += 1;
        observedRuns.push({
          workflow: view.workflowName ?? chosen.workflowName,
          workflow_id: view.workflowDatabaseId ?? chosen.workflowDatabaseId ?? null,
          run_id: view.databaseId, attempt: view.attempt ?? chosen.attempt ?? null,
          status: view.status, conclusion: view.conclusion ?? null,
          head_sha: view.headSha ?? chosen.headSha, event: view.event ?? chosen.event ?? null,
          url: view.url ?? chosen.url ?? null,
          jobs: (view.jobs ?? []).map((j) => ({ name: j.name, conclusion: j.conclusion ?? null, status: j.status ?? null })),
        });
        // A job that is still running is neither a pass nor a failure, and it must not fall into
        // the same bucket as one that never reported.
        const byJob = new Map((view.jobs ?? []).map((j) => [j.name, j.status === 'completed' ? (j.conclusion ?? 'unknown') : (j.status ?? 'unknown')]));
        observed = Object.fromEntries(ci.jobs.map((name) => [name, byJob.get(name)]));
      }
    } catch (e) { step('post-merge checks read', false, `${e.code ?? 'E_GH_FAILED'}: ${e.message}`); }

    if (observedRuns.length) {
      const verdict = aggregate(treatment.treatment, observed, ci.jobs);
      step(`required jobs for "${treatment.treatment}"`, verdict.ok,
        verdict.ok
          ? `${ci.jobs.join(', ')} succeeded in ${observedRuns[0].workflow} run ${observedRuns[0].run_id} attempt ${observedRuns[0].attempt} on ${landed.revision.slice(0, 8)}`
          : `${verdict.code}: ${verdict.message}`);
    }
  }
}

// --- 5. the artifacts the preparation said it produced ---------------------------------------
if (change.closure_mode === 'legacy') {
  step('closure preparation', true, 'this change closes the legacy way, and said so before integration');
} else if (contract && landed) {
  const covers = preparationCovers(manifest, {
    contractDigest: contract.digest, candidateDigest: landed.digest, changeId,
    generation: lifecycle?.generation ?? null,
  });
  step('closure preparation covers what landed', covers.ok === true,
    covers.ok ? `snapshot ${manifest.preparation_id} (generation ${manifest.generation}, contract ${manifest.manifest_version})` : `${covers.code}: ${covers.message}`);

  // Present is not enough, and neither is "every recorded artifact is there": a file ADDED
  // inside the frozen folder during the merge belongs to nobody's record, and walking only the
  // record could never see it.
  const treePaths = (() => {
    try {
      return git(['ls-tree', '-r', '--name-only', '-z', landed.revision]).split('\0').filter(Boolean);
    } catch { return null; }
  })();
  const cmp = compareArtifacts(manifest, (p) => {
    try { return git(['rev-parse', `${landed.revision}:${p}`]); } catch { return null; }
  }, treePaths);
  step('prepared artifacts are in the merge, unchanged and alone', cmp.ok, cmp.message);
}

// --- report ----------------------------------------------------------------------------------
const elapsed = () => Number(process.hrtime.bigint() / 1000000n) - started;
const summary = {
  change_id: changeId,
  state_before: change.state,
  repository: repo,
  pr: pr ? { number: pr.number, url: pr.url, merge_commit: mergeOid, base: pr.baseRefName, head: pr.headRefOid } : null,
  treatment: treatment?.treatment ?? null,
  runs: observedRuns,
  steps, impediments, closed: change.state === 'closed',
  metrics: { ...metrics, elapsed_ms: elapsed() },
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

// --- 6. the receipt, then the states, as one resumable operation ------------------------------
// Every precondition above has already held. Nothing below observes anything new: it records
// what was observed and moves the change, and re-running it after a crash repeats no event.
const operationId = (() => {
  const existing = readReceipt(root, changeId);
  if (existing && !existing.corrupt && existing.merge_commit === mergeOid && existing.operation_id) return existing.operation_id;
  return newOperationId('confirm');
})();

try {
  beginOperation(root, changeId, {
    kind: 'confirm', operationId, projectId: project?.project_id,
    detail: { pr: Number(prNumber), merge_commit: mergeOid },
  });
} catch (e) { die(`${e.code}: ${e.message}`, 1); }
advanceOperation(root, changeId, operationId, PHASE.OBSERVED, { runs: observedRuns.length });

// A resume observes the same integration again; it does not produce a second observation of it.
// Re-stamping the moment would make two runs of the same confirmation disagree about when the
// merge was seen, and the later one would win for no reason at all.
const existingReceipt = readReceipt(root, changeId);
const sameIntegration = existingReceipt && !existingReceipt.corrupt
  && existingReceipt.merge_commit === mergeOid
  && existingReceipt.preparation_id === (manifest?.preparation_id ?? null)
  && existingReceipt.approval_id === (authorising?.approval_id ?? null);

const receipt = sameIntegration ? existingReceipt : buildReceipt({
  changeId, repository: repo, pr: prNumber, headSha: pr?.headRefOid, mergeCommit: mergeOid,
  baseBranch: pr?.baseRefName,
  preparationId: manifest?.preparation_id, generation: manifest?.generation,
  preparationDigest: manifest?.preparation_digest,
  approvalId: authorising?.approval_id,
  contractDigest: contract.digest, candidateDigest: landed.digest,
  runs: observedRuns, operationId,
});
advanceOperation(root, changeId, operationId, PHASE.PERSISTING);
if (!sameIntegration) writeReceipt(root, changeId, receipt);

store.appendHistory(changeId, {
  // A stable id, so the same confirmation twice is one event and not two.
  event_id: `integration_observed:pr-${prNumber}:${mergeOid}`,
  type: 'integration_observed',
  at: receipt.observed_at,
  operation_id: operationId,
  pr: Number(prNumber), merge_commit: mergeOid, treatment: summary.treatment,
  approval_id: authorising?.approval_id ?? null,
  preparation_id: manifest?.preparation_id ?? null,
  generation: manifest?.generation ?? null,
  runs: observedRuns.map((r) => ({ workflow: r.workflow, run_id: r.run_id, attempt: r.attempt })),
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
    timestamp: receipt.observed_at,
  });
}

const closure = change.closure_mode === 'legacy'
  ? { ok: true, legacy: true }
  : preparationCovers(manifest, {
    contractDigest: contract.digest, candidateDigest: landed.digest, changeId,
    generation: lifecycle?.generation ?? null,
  });

const ctx = () => ({
  evidence: store.evidence(changeId),
  approvals: authority.inForce,
  authority,
  revision: landed.revision, contentDigest: landed.digest, contractDigest: contract.digest, closure,
  receipt: receiptCovers(receipt, {
    changeId, mergeCommit: mergeOid,
    generation: manifest?.generation ?? null,
    preparationId: manifest?.preparation_id ?? null,
  }),
  preparation: (a) => (change.closure_mode === 'legacy' ? { ok: true } : approvalCoversPreparation(a, manifest)),
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
    { event: { type: 'transition', from: current.state, to, operation_id: operationId }, expected: current.state_revision });
}

completeOperation(root, changeId, operationId, (cur) => ({
  ...cur,
  receipt: { pr: receipt.pr, merge_commit: receipt.merge_commit, generation: receipt.generation, observed_at: receipt.observed_at },
}));

const final = store.change(changeId);
summary.closed = final.state === 'closed';
summary.receipt = receipt;
summary.metrics.elapsed_ms = elapsed();
if (!summary.closed) {
  console.error(`post-merge did not close ${changeId}: it is at "${final.state}"`);
  for (const s of steps.filter((x) => !x.ok)) console.error(`  ${s.name} — ${s.detail}`);
  process.exit(1);
}

if (asJson) console.log(JSON.stringify(summary, null, 2));
else {
  for (const s of steps) console.log(`  ok    ${s.name} — ${s.detail}`);
  console.log(`\n${change.state === 'closed' ? 'already closed' : 'closed'} ${changeId}. PR #${prNumber}, merge ${String(mergeOid).slice(0, 8)}, treatment ${summary.treatment}.`);
  console.log(`  receipt: generation ${receipt.generation}, approval ${receipt.approval_id}, ${observedRuns.length} run(s) observed.`);
  console.log(`  ${metrics.gh_calls} gh call(s), ${metrics.git_calls} git call(s), ${summary.metrics.elapsed_ms}ms, 0 log bytes downloaded.`);
  console.log('No commit was made to record this: the event is in the trail, not in the content it describes.');
}
