#!/usr/bin/env node
// The Invoker's state CLI. It validates the flow; it never performs the work.
//
//   node scripts/state.mjs init <project-id> [-- <spec consolidation command> [args...]]
//   node scripts/state.mjs resume [change-id]        the resume contract, human-readable
//   node scripts/state.mjs resume --json
//   node scripts/state.mjs open <change-id> --type <t> --base <rev> --scope <s> --paths a,b
//                                [--modules a,b] [--closure-mode prepared|legacy] [--deltaless]
//   node scripts/state.mjs digest <change-id> [--gate scope|integration]
//   node scripts/state.mjs can <change-id> <to-state>
//   node scripts/state.mjs transition <change-id> <to-state> --expect <state_revision>
//   node scripts/state.mjs transition <change-id> blocked --reason "<why>"
//   node scripts/state.mjs run <change-id> <property> --role <r> [--independent-of a,b]
//                                [--expect-failing <test name> [--report]]
//                                [--id <e>] -- <command> [args...]   ({report} is substituted)
//   node scripts/state.mjs record-evidence <file.json>
//   node scripts/state.mjs record-approval <file.json>
//   node scripts/state.mjs defer <file.json>
//   node scripts/state.mjs trail [change-id] [--json] [--export <file>]
//   node scripts/state.mjs validate                  every stored document against its schema
//
// Exit codes: 0 allowed/valid, 1 refused/invalid, 2 usage.

import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Store, SCHEMA_VERSION } from './lib/store.mjs';
import { canTransition, ASSERTS_FAILURE } from './lib/state-machine.mjs';
import { contractDigest, contentDigest, gatedDigest } from './lib/digest.mjs';
import { launch } from './lib/launch.mjs';
import { manifestPath, preparationCovers, approvalsInForce, readManifest } from './lib/closure-prep.mjs';
import {
  readLifecycle, readReceipt, receiptCovers, pendingOperation,
  approvalCoversPreparation, updateLifecycle, withAuthority, integrationExpectation,
} from './lib/lifecycle.mjs';
import { executionContext } from './lib/harness.mjs';
import { parseTap, judgeFailingRun } from './lib/tap.mjs';
import { validate } from './lib/validate.mjs';

// A gate is bound to what it authorises. Scope-class gates authorise the contract; the
// gates that put code somewhere authorise the contract AND the code that will travel with it.
const CONTRACT_GATES = ['scope', 'ambiguity'];
const CODE_GATES = ['integration', 'irreversible', 'exposure'];

const root = process.env.SPECTREE_PROJECT_ROOT ?? process.cwd();
const store = new Store(root);
const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);
const die = (msg, code = 2) => { console.error(msg); process.exit(code); };

function git(args, fallback = null) {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
  catch { return fallback; }
}

function gitSituation() {
  return {
    available: git(['rev-parse', '--is-inside-work-tree']) === 'true',
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown'),
    revision: git(['rev-parse', 'HEAD'], null),
    dirty: (git(['status', '--porcelain'], '') || '').length > 0,
  };
}

/**
 * What each gate is bound to, computed fresh from disk on every call.
 * `contentDigest` throws where it cannot establish the content; that refusal is the answer,
 * because an unavailable comparison is unknown and not "nothing changed".
 */
function digests(change) {
  const contract = contractDigest(root, change, { artifactsDir: flag('artifacts') });
  let content;
  try { content = contentDigest(root); }
  catch (e) { die(`${e.code}: ${e.message}`, 1); }
  const gated = gatedDigest(contract.digest, content.digest);
  return {
    contract, content,
    byGate: {
      ...Object.fromEntries(CONTRACT_GATES.map((gate) => [gate, contract.digest])),
      ...Object.fromEntries(CODE_GATES.map((gate) => [gate, gated])),
    },
  };
}

/**
 * Does a closure preparation on record cover the candidate being gated? Read from the manifest,
 * never from the presence of an archive folder: a folder that moved says a move happened, and
 * only the manifest says what was true when it happened.
 */
/** The closure manifest on disk, or null. Absence and corruption are different answers. */
function closureManifest(changeId) {
  const r = readManifest(root, changeId);
  if (r.present && !r.doc) return { corrupt: true, code: r.code, message: r.message };
  return r.doc;
}

/**
 * Everything the closure lifecycle knows about a change, read once and shared.
 *
 * Authority, the receipt and any half-finished operation come from here — never from a filter
 * a command writes for itself. A retirement honoured by one command and ignored by the next is
 * not a retirement, and that is exactly how `transition ... integrated` walked past a refusal
 * the confirmation had already issued.
 */
function closureContext(changeId) {
  const lc = readLifecycle(root, changeId);
  const manifest = closureManifest(changeId);
  const corruptManifest = manifest?.corrupt ? manifest : null;
  const snapshot = corruptManifest ? null : manifest;
  const authority = approvalsInForce(store.approvals(changeId), snapshot, {
    lifecycle: lc.doc,
    lifecycleError: lc.present && !lc.doc ? { code: lc.code, message: lc.message } : null,
  });
  return {
    lifecycle: lc.doc,
    manifest: snapshot,
    manifestError: corruptManifest,
    generation: lc.doc?.generation ?? null,
    authority,
    receipt: readReceipt(root, changeId),
    pending: pendingOperation(lc.doc),
    // The one place the v2 integration bindings are assembled. Every gate reads this, so none of
    // them can omit a comparison by not having built it.
    // A gate has no confirmation to hand it an approval, but it has the receipt — which names the
    // one the integration was observed under. Resolving THAT one is the reading that ordering
    // cannot decide; where there is no receipt and more than one approval covers the preparation,
    // the expectation says so and the gate refuses rather than picking.
    expectation: integrationExpectation({
      changeId, manifest: snapshot, authority, lifecycle: lc.doc,
      legacy: store.change(changeId)?.closure_mode === 'legacy',
      receipt: readReceipt(root, changeId),
    }),
  };
}

/** The approvals with authority right now. */
function inForce(changeId) {
  return closureContext(changeId).authority;
}

function closureVerdict(change, d, cc) {
  if (change.closure_mode === 'legacy') return { ok: true, legacy: true };
  if (cc.manifestError) return { ok: false, code: cc.manifestError.code, message: cc.manifestError.message };
  return preparationCovers(cc.manifest, {
    contractDigest: d.contract.digest, candidateDigest: d.content.digest,
    changeId: change.change_id, generation: cc.generation,
  });
}

/** The resume contract: everything needed to pick work back up, read from artifacts. */
function resume(changeId) {
  const g = gitSituation();
  const project = store.project();
  const changes = store.present ? store.changes() : [];
  const open = changes.filter((c) => c.state !== 'closed');
  const change = changeId ? store.change(changeId) : (open.find((c) => c.state !== 'blocked') ?? open[0] ?? null);
  const live = change ? store.evidence(change.change_id).filter((e) => !e.superseded_by) : [];
  const cc = change ? closureContext(change.change_id) : null;
  let here = null;
  try { here = contentDigest(root).digest; } catch { /* no work tree: fall back to the revision */ }

  const out = {
    project: project ? { project_id: project.project_id, protocol_version: project.protocol_version } : null,
    state_directory: store.present,
    git: g,
    change: change
      ? {
          change_id: change.change_id, state: change.state, change_type: change.change_type,
          deltaless: change.deltaless === true, base_revision: change.base_revision,
          evaluated_revision: change.evaluated_revision ?? null,
          state_revision: change.state_revision ?? 0,
          allowed_paths: change.allowed_paths,
          blocked_reason: change.blocked_reason ?? null,
          blocked_from: change.blocked_from ?? null,
        }
      : null,
    approvals: change ? (cc?.authority.inForce ?? []).map((a) => ({ approval_id: a.approval_id, gate: a.gate, by: a.granted_by?.identity, kind: a.granted_by?.kind, revision: a.revision })) : [],
    // Retired by a reopening: still in the trail, no longer authority. Resume that showed them
    // beside the ones in force answered "is this change approved" with a list, not an answer.
    approvals_retired: change ? (cc?.authority.retired ?? []).map((a) => ({ approval_id: a.approval_id, gate: a.gate, by: a.granted_by?.identity, revision: a.revision })) : [],
    // An integration approval whose durable record is missing: history, never authority, and a
    // specific enough problem to name rather than fold into "no approval on record".
    approvals_unrecorded: change ? (cc?.authority.unrecorded ?? []).map((a) => ({ approval_id: a.approval_id, gate: a.gate })) : [],
    authority_available: change ? (cc?.authority.ok !== false) : null,
    authority_problem: change && cc?.authority.ok === false ? { code: cc.authority.code, message: cc.authority.message } : null,
    closure: change ? {
      generation: cc?.generation ?? null,
      preparation_id: cc?.manifest?.preparation_id ?? null,
      preparation_digest: cc?.manifest?.preparation_digest ?? null,
      problem: cc?.manifestError ? { code: cc.manifestError.code, message: cc.manifestError.message } : null,
    } : null,
    // A write that stopped part way is a fact resume has to state, with the recovery for it.
    // Silence there is how a half-applied set gets authorised over.
    pending_operation: cc?.pending
      ? { operation_id: cc.pending.operation_id, kind: cc.pending.kind, phase: cc.pending.phase, uncertain: cc.pending.uncertain, recovery: cc.pending.recovery }
      : null,
    // The last integration observed. A historical receipt is not a claim that a later re-run of
    // the CI is green; it says what was seen, when, and about which merge.
    receipt: cc?.receipt && !cc.receipt.corrupt
      ? { pr: cc.receipt.pr, merge_commit: cc.receipt.merge_commit, generation: cc.receipt.generation, approval_id: cc.receipt.approval_id, observed_at: cc.receipt.observed_at }
      : cc?.receipt?.corrupt ? { corrupt: true } : null,
    // Valid HERE means: measured on the content that is on disk now. A revision match is the
    // fallback for evidence carrying no fingerprint, and it is the weaker claim -- saying
    // otherwise is how resume kept presenting runs from before an uncommitted edit as current.
    evidence_valid_here: change
      ? live.filter((e) => (e.fingerprint ? e.fingerprint === here : !g.revision || e.revision === g.revision))
          .map((e) => ({ property: e.property, result: e.result, source: e.source_kind, pinned: Boolean(e.fingerprint) }))
      : [],
    evidence_stale: change
      ? live.filter((e) => (e.fingerprint ? e.fingerprint !== here : g.revision && e.revision !== g.revision))
          .map((e) => ({
            property: e.property,
            observed_at: e.revision.slice(0, 8),
            why: e.fingerprint ? 'measured on other content' : 'observed at another revision',
          }))
      : [],
    actionable_deferrals: store.present
      ? store.deferred().items.filter((i) => i.status === 'open').map((i) => ({ id: i.stable_id, owner: i.owner, impact: i.impact, trigger: i.reevaluation_trigger ?? null }))
      : [],
    next_action: change?.next_action ?? null,
    other_open_changes: open.filter((c) => c.change_id !== change?.change_id).map((c) => c.change_id),
  };
  return out;
}

function printResume(r) {
  const L = [];
  L.push(`project        ${r.project?.project_id ?? '(no .spectree — state is unknown, not empty)'}`);
  L.push(`git            ${r.git.available ? `${r.git.branch} @ ${(r.git.revision ?? '').slice(0, 8)}${r.git.dirty ? ' (dirty)' : ''}` : 'not a work tree'}`);
  if (!r.change) { L.push('change         none open'); }
  else {
    L.push(`change         ${r.change.change_id}  [${r.change.state}]${r.change.deltaless ? '  deltaless' : ''}`);
    L.push(`base revision  ${r.change.base_revision.slice(0, 8)}   state_revision ${r.change.state_revision}`);
    if (r.change.blocked_reason) L.push(`blocked        ${r.change.blocked_reason}${r.change.blocked_from ? `  (recover to ${r.change.blocked_from})` : ''}`);
    L.push(`owns paths     ${r.change.allowed_paths.join(', ')}`);
  }
  L.push(`approvals      ${r.approvals.length ? r.approvals.map((a) => `${a.gate} by ${a.by} (${a.kind})`).join('; ') : 'none in force'}`);
  if (r.approvals_retired?.length) L.push(`  retired      ${r.approvals_retired.map((a) => `${a.approval_id} (${a.gate}) — replaced record, no authority`).join('; ')}`);
  if (r.approvals_unrecorded?.length) {
    L.push(`  unrecorded   ${r.approvals_unrecorded.map((a) => `${a.approval_id} (${a.gate}) — the closure control never recorded it, so it is not authority`).join('; ')}`);
  }
  if (r.authority_problem) L.push(`authority      UNAVAILABLE — ${r.authority_problem.code}: ${r.authority_problem.message}`);
  if (r.closure) {
    L.push(`closure        generation ${r.closure.generation ?? '?'}${r.closure.preparation_id ? `, ${r.closure.preparation_id}` : ', not prepared'}${r.closure.problem ? `  [${r.closure.problem.code}]` : ''}`);
  }
  // A write that stopped part way is a fact resume states, with the recovery for it. Silence
  // there is how a half-applied set gets authorised over.
  if (r.pending_operation) {
    L.push(`recovery       ${r.pending_operation.kind} ${r.pending_operation.operation_id} stopped at "${r.pending_operation.phase}"`);
    L.push(`               ${r.pending_operation.recovery}`);
  }
  // A historical receipt says what was seen about one merge. It is not a claim that a later
  // re-run of the CI is green.
  if (r.receipt) {
    L.push(r.receipt.corrupt
      ? 'receipt        corrupt — the integration observation cannot be read, which is not the same as absent'
      : `receipt        PR #${r.receipt.pr}, merge ${String(r.receipt.merge_commit).slice(0, 8)}, generation ${r.receipt.generation}, observed ${r.receipt.observed_at}`);
  }
  L.push(`evidence here  ${r.evidence_valid_here.length ? r.evidence_valid_here.map((e) => `${e.property}=${e.result}`).join('; ') : 'none at this revision'}`);
  if (r.evidence_stale.length) L.push(`evidence stale ${r.evidence_stale.map((e) => `${e.property} (${e.why})`).join('; ')}`);
  L.push(`deferrals open ${r.actionable_deferrals.length ? r.actionable_deferrals.map((d) => `#${d.id} ${d.impact}/${d.owner}`).join('; ') : 'none'}`);
  L.push(`next action    ${r.next_action?.description ?? 'not recorded — decide it and write it down'}`);
  if (r.other_open_changes.length) L.push(`also open      ${r.other_open_changes.join(', ')}`);
  return L.join('\n');
}

switch (cmd) {
  case 'init': {
    const id = argv[1] ?? die('usage: state.mjs init <project-id>');
    // The consolidation command is the CONSUMER's, declared once here. Nothing in this squad
    // edits `docs/specs/` by hand, so a project that declares none closes the legacy way and
    // says so — it never gets a spec merge improvised on its behalf.
    // The command comes after `--`, argument by argument, exactly as `run` takes one. Splitting
    // a command string on whitespace breaks the first path that contains a space — and on
    // Windows the most likely command there is the node executable under "Program Files".
    const sep = argv.indexOf('--');
    const consolidate = sep >= 0 && argv.length > sep + 1 ? argv.slice(sep + 1) : null;
    // Which workflow and which jobs certify a merge is the project's to declare, and it is
    // declared as an identity — a workflow plus the jobs inside it — never as a bare list of
    // names. A run title, a job name and a workflow identity are three different things, and the
    // moment they disagree the wrong one is green.
    const ciWorkflow = flag('ci-workflow');
    const ciJobs = (flag('ci-jobs') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const doc = store.init({
      project_id: id, protocol_version: '1.0.0',
      created_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      ...(flag('repository') ? { repository: flag('repository') } : {}),
      ...(consolidate ? { closure: { consolidate } } : {}),
      ...(ciWorkflow && ciJobs.length ? {
        ci: {
          version: 2,
          required_runs: Object.fromEntries(['full', 'documented_closure', 'operational_trail'].map((t) => [
            t, { workflow: ciWorkflow, jobs: ciJobs, event: flag('ci-event', 'push'), branch: flag('ci-branch', 'main') },
          ])),
        },
      } : {}),
    });
    console.log(`initialised .spectree for ${doc.project_id} (schema ${SCHEMA_VERSION})`);
    if (!doc.ci) console.error('  no CI declared: `--ci-workflow <name> --ci-jobs a,b` before a merge can be confirmed');
    break;
  }

  case 'resume': {
    const id = argv[1] && !argv[1].startsWith('--') ? argv[1] : undefined;
    const r = resume(id);
    console.log(has('json') ? JSON.stringify(r, null, 2) : printResume(r));
    break;
  }

  case 'open': {
    const id = argv[1] ?? die('usage: state.mjs open <change-id> ...');
    const g = gitSituation();
    const change = {
      schema_version: SCHEMA_VERSION,
      project_id: store.project()?.project_id ?? die('run `state.mjs init` first'),
      change_id: id,
      change_type: flag('type', 'feature'),
      protocol_version: '1.0.0',
      adapter: flag('adapter', 'claude-code'),
      base_revision: flag('base', g.revision) ?? die('no base revision: pass --base <rev>'),
      scope: flag('scope', '') || die('--scope is required: a change with no stated scope cannot be gated'),
      allowed_paths: (flag('paths', '') || die('--paths is required: ownership is not optional')).split(',').map((s) => s.trim()).filter(Boolean),
      state: 'draft',
      // The modules the proposal names. The set here and the set of delta files on disk must be
      // the same set, and nothing can check that if nobody wrote down what was named.
      ...(flag('modules') ? { modules_named: flag('modules').split(',').map((m) => m.trim()).filter(Boolean) } : {}),
      ...(flag('closure-mode') ? { closure_mode: flag('closure-mode') } : {}),
      ...(has('deltaless') ? { deltaless: true } : {}),
    };
    const saved = store.putChange(change, { event: { type: 'opened', state: 'draft' } });
    console.log(`opened ${saved.change_id} at base ${saved.base_revision.slice(0, 8)} (state_revision ${saved.state_revision})`);
    break;
  }

  case 'digest': {
    const id = argv[1] ?? die('usage: state.mjs digest <change-id> [--gate scope|integration]');
    const change = store.change(id) ?? die(`no such change: ${id}`, 1);
    const gate = flag('gate', 'scope');
    const d = digests(change);
    if (!(gate in d.byGate)) die(`unknown gate "${gate}": one of ${Object.keys(d.byGate).join(', ')}`);
    console.log(d.byGate[gate]);
    console.error(`  gate "${gate}" — ${CODE_GATES.includes(gate) ? 'the contract AND the code it will carry' : 'the contract alone'}`);
    console.error(`  contract: ${d.contract.source}${d.contract.files.length ? ` (${d.contract.files.join(', ')})` : ''}`);
    if (CODE_GATES.includes(gate)) console.error(`  content:  ${d.content.revision.slice(0, 8)}${d.content.dirty ? ' + uncommitted changes' : ' (clean)'}`);
    console.error("  record it as the approval's scope_digest");
    break;
  }

  case 'can':
  case 'transition': {
    const id = argv[1] ?? die('usage: state.mjs can|transition <change-id> <to-state>');
    const to = argv[2] ?? die('usage: state.mjs can|transition <change-id> <to-state>');
    const change = store.change(id) ?? die(`no such change: ${id}`, 1);
    const g = gitSituation();
    // Both digests of what is on the table right now — computed from the artifact and the
    // work tree, never copied from an approval or a record, or the comparison would only
    // ever agree with itself.
    const d = digests(change);
    const cc = closureContext(id);
    const verdict = canTransition(change, to, {
      evidence: store.evidence(id),
      // Retired approvals are history, not authority. Passing them here let a reopened
      // closure walk to `integrated` on the approval its own reopening had retired.
      approvals: cc.authority.inForce,
      authority: cc.authority,
      pendingOperation: cc.pending,
      revision: g.revision,
      contentDigest: d.content.digest,
      contractDigest: d.contract.digest,
      closure: closureVerdict(change, d, cc),
      // The merge is OBSERVED by post-merge.mjs, never asserted here — and the receipt is checked
      // against the COMPLETE expectation, built once from the approved reference. Assembling the
      // expectation field by field at each call site is how this gate came to ask about the change,
      // the generation and the preparation while never asking about the repository, the PR, the
      // head or the candidate digest: a receipt with all four rewritten passed.
      //
      // The expectation comes from the manifest and the approval in force, never from the local
      // checkout — which candidate was observed is a question the approved reference answers.
      receipt: ['integrated', 'closed'].includes(to)
        ? receiptCovers(cc.receipt, {
          ...cc.expectation,
          legacy: change.closure_mode === 'legacy',
          expectation: cc.expectation,
        })
        : undefined,
      preparation: (a) => change.closure_mode === 'legacy'
        ? { ok: true, legacy: true } : approvalCoversPreparation(a, cc.manifest),
      scopeDigests: d.byGate,
      expectedStateRevision: has('expect') ? Number(flag('expect')) : undefined,
    });
    if (!verdict.ok) {
      console.error(`REFUSED ${change.state} -> ${to}`);
      console.error(`  ${verdict.code}: ${verdict.message}`);
      if (verdict.code === 'E_APPROVAL_DIGEST_MISMATCH') console.error(`  current contract: ${d.contract.source} -> ${d.contract.digest}`);
      if (verdict.code === 'E_CLOSURE_NOT_PREPARED') console.error(`  prepare it on the branch: node <squad>/scripts/prepare-closure.mjs ${id} --apply`);
      if (verdict.code === 'E_CONTRACT_CHANGED') console.error(`  current contract: ${d.contract.source} -> ${d.contract.digest}`);
      if (verdict.code === 'E_CONTENT_CHANGED') console.error(`  current content:  ${d.content.revision.slice(0, 8)}${d.content.dirty ? ' + uncommitted changes' : ' (clean)'} -> ${d.content.digest}`);
      process.exit(1);
    }
    if (cmd === 'can') { console.log(`allowed ${change.state} -> ${to}`); break; }

    const next = { ...change, state: to, evaluated_revision: g.revision ?? change.evaluated_revision };
    if (to === 'blocked') {
      // Record where to come back to as the block is written. A block whose origin nobody
      // wrote down has nowhere safe to return to, and the machine refuses to guess.
      next.blocked_from = change.state;
      next.blocked_reason = flag('reason') ?? die('blocking requires --reason "<why>": a block with no stated cause is unreadable at resume');
    } else if (change.state === 'blocked') {
      delete next.blocked_from;
      delete next.blocked_reason;
    }
    // The write happens INSIDE the closure's authority boundary, against the control revision this
    // decision was computed at. A second read just before the write only narrows the window: a
    // reopening that returns the change to the state it was already in does not move
    // `state_revision`, so the change store's own check sees nothing, and the transition landed on
    // top of an operation that was still running.
    //
    // Lock order is lifecycle then change, everywhere, so the two cannot cycle.
    let saved;
    try {
      saved = withAuthority(root, id, { expectedRevision: cc.lifecycle?.revision ?? null, requireIdle: to !== 'blocked' }, () =>
        store.putChange(next, { event: { type: 'transition', from: change.state, to }, expected: change.state_revision }));
    } catch (e) {
      console.error(`REFUSED ${change.state} -> ${to}`);
      console.error(`  ${e.code ?? 'E_REFUSED'}: ${e.message}`);
      console.error('  Nothing was written. Read it again and decide against what is there now.');
      process.exit(1);
    }
    console.log(`${change.state} -> ${to}  (state_revision ${saved.state_revision})`);
    break;
  }

  case 'run': {
    // Evidence is produced here, not asserted here. The content is measured before and after
    // the command, and a run that moved the content it was measuring proves nothing about it.
    const id = argv[1] ?? die('usage: state.mjs run <change-id> <property> --role <r> -- <command> [args...]');
    const property = argv[2] ?? die('usage: state.mjs run <change-id> <property> --role <r> -- <command> [args...]');
    const sep = argv.indexOf('--');
    if (sep === -1 || sep === argv.length - 1) die('the command goes after `--`: state.mjs run c1 ci.green --role platform_engineer -- npm test');
    const pre = argv.slice(0, sep);
    const opt = (name, fallback) => {
      const i = pre.indexOf(`--${name}`);
      return i >= 0 && pre[i + 1] && !pre[i + 1].startsWith('--') ? pre[i + 1] : fallback;
    };
    const cmd = argv.slice(sep + 1);
    const change = store.change(id) ?? die(`no such change: ${id}`, 1);
    const role = opt('role') ?? die('--role is required: evidence that cannot say who produced it is not evidence');
    const independent = (opt('independent-of', '') || '').split(',').map((x) => x.trim()).filter(Boolean);

    // What a property means is not a flag. `pass1.tests_failing` PASSES only when a named test
    // ran and failed, and no other property may be satisfied by a run that failed — both
    // directions are mandatory, so neither can be turned off by omitting an option.
    for (const gone of ['expect-nonzero', 'expect-signal']) {
      if (pre.includes(`--${gone}`)) {
        die(`--${gone} is gone: it made the semantics of a property optional. Failure-asserting properties ` +
            `(${[...ASSERTS_FAILURE].join(', ')}) require --expect-failing "<test name>" and a machine-readable result.`);
      }
    }
    const assertsFailure = ASSERTS_FAILURE.has(property);
    const expectFailing = opt('expect-failing');
    if (assertsFailure && !expectFailing) {
      die(`"${property}" is satisfied only by a named test that ran and failed. Pass --expect-failing "<test name>" ` +
          'and let the command emit TAP (or point --report at the TAP it writes).');
    }
    if (!assertsFailure && expectFailing) {
      die(`--expect-failing is not available for "${property}": it asserts success, and a command that failed ` +
          'is not evidence that it succeeded.');
    }

    // `--report` reads the TAP the command WRITES, and the destination is this run's own: a
    // fresh path, outside the work tree, that did not exist a moment ago. Pointing at a path
    // the operator chooses lets a report from an earlier, genuinely red run stand in for a
    // command that never ran at all — which is the hole the last three rounds were closing.
    const wantsReport = pre.includes('--report');
    if (wantsReport && opt('report')) {
      die(`--report takes no path: the destination is this run's own, and "${opt('report')}" would be a file this run did not write. ` +
          'Put {report} in the command instead, and the runner substitutes the path it will read.');
    }
    if (wantsReport && !assertsFailure) {
      die(`--report is only read for ${[...ASSERTS_FAILURE].join(', ')}: no other property is judged from a test report.`);
    }
    let reportDir = null, reportPath = null;
    if (wantsReport) {
      reportDir = mkdtempSync(join(tmpdir(), 'spectree-tap-'));
      reportPath = join(reportDir, 'report.tap');
      // Substituted into the command, so the destination cannot be anything but this one — and
      // it sits outside the project, so writing it is not a change to the content being measured.
      const substituted = cmd.map((a) => a.split('{report}').join(reportPath));
      if (substituted.every((a, i) => a === cmd[i])) {
        rmSync(reportDir, { recursive: true, force: true });
        die('--report needs {report} somewhere in the command: that token is replaced with the path this run will read, ' +
            'and a report the run did not write is not a report of this run.');
      }
      cmd.splice(0, cmd.length, ...substituted);
    }

    let before;
    try { before = { content: contentDigest(root), contract: contractDigest(root, change, { artifactsDir: opt('artifacts') }) }; }
    catch (e) { die(`${e.code}: ${e.message}`, 1); }
    let r;
    try { r = launch(cmd, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
    catch (e) {
      // The command could not be delivered as written. That is an invocation to fix, not a
      // result to record: running a DIFFERENT command and filing the outcome would be worse.
      die(`${e.code ?? 'E_LAUNCH'}: ${e.message}`);
    }
    let after;
    try { after = { content: contentDigest(root), contract: contractDigest(root, change, { artifactsDir: opt('artifacts') }) }; }
    catch (e) { die(`${e.code}: ${e.message}`, 1); }
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    if (output) process.stderr.write(output.endsWith('\n') ? output : `${output}\n`);

    // Both bindings are captured BEFORE and checked after. Computing the contract digest at
    // the end attributed to the run whatever the run itself had just written.
    const movedContent = before.content.digest !== after.content.digest;
    const movedContract = before.contract.digest !== after.contract.digest;
    const moved = movedContent || movedContract;

    let tapVerdict = null;
    if (assertsFailure && !r.error && !moved) {
      let report = output;
      if (wantsReport) {
        report = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : null;
      }
      tapVerdict = report === null
        ? { result: 'INFRA_ERROR', reason: 'the command wrote no report at the path it was given, so it produced no results to read', matched: null }
        : judgeFailingRun(parseTap(report), expectFailing, r.status);
    }
    if (reportDir) rmSync(reportDir, { recursive: true, force: true });

    const result = r.error ? 'INFRA_ERROR'
      : moved ? 'INCONCLUSIVE'
      : tapVerdict ? tapVerdict.result
      : (r.status === 0 ? 'PASS' : 'FAIL');

    const doc = {
      schema_version: SCHEMA_VERSION,
      evidence_id: opt('id') ?? `ev-${randomUUID().slice(0, 8)}`,
      change_id: id,
      property,
      check: cmd.join(' ') + (assertsFailure ? `  (expecting "${expectFailing}" to run and fail)` : ''),
      // `independent_of` is what the CALLER typed; `context` is what was measured while the
      // command ran. They are stored side by side because they are different kinds of claim, and
      // only one of them was observed. Where two records assert independence and carry the same
      // digest, they ran in one context and the assertion is the only thing separating them —
      // which is the state of every harness known today, and is M4.
      executor: {
        role,
        ...(independent.length ? { independent_of: independent } : {}),
        context: executionContext(),
      },
      source_kind: 'observed_execution',
      revision: before.content.revision,
      fingerprint: before.content.digest,
      contract_digest: before.contract.digest,
      environment: { os: process.platform, runtime: `node ${process.versions.node}` },
      timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      result,
      ...(typeof r.status === 'number' ? { exit_code: r.status } : {}),
      ...(assertsFailure
        ? { negative_control: {
            input: cmd.join(' '),
            expected_signal: `the test "${expectFailing}" reported as failing in a completed run`,
            ...(tapVerdict?.matched ? { observed_signal: `not ok - ${tapVerdict.matched.name}` } : {}),
          } }
        : {}),
      ...(moved
        ? { limitations: [movedContract && !movedContent
            ? 'the command changed the contract it was being measured against, so the Requirements it exercised cannot be established'
            : 'the command changed the content it was measuring, so what it exercised cannot be established'] }
        : {}),
      ...(r.error ? { limitations: [`the command could not be executed: ${r.error.message}`] } : {}),
      ...(tapVerdict && tapVerdict.result !== 'PASS' ? { limitations: [tapVerdict.reason] } : {}),
    };
    try { store.putEvidence(doc); } catch (e) { die(e.message, 1); }
    console.error(`recorded evidence ${doc.evidence_id}: ${property} = ${result}`);
    console.error(`  content ${before.content.digest.slice(0, 22)}...${before.content.dirty ? ' (with uncommitted changes)' : ''}`);
    if (movedContent) console.error('  the content moved DURING the run: recorded INCONCLUSIVE, and it satisfies no gate');
    if (movedContract) console.error('  the CONTRACT moved during the run: the run cannot be credited with Requirements it wrote itself');
    if (tapVerdict && tapVerdict.result !== 'PASS') console.error(`  ${tapVerdict.reason}`);
    process.exit(result === 'PASS' ? 0 : 1);
  }

  case 'record-evidence':
  case 'record-approval':
  case 'defer': {
    const f = argv[1] ?? die(`usage: state.mjs ${cmd} <file.json>`);
    if (!existsSync(f)) die(`no such file: ${f}`);
    const doc = JSON.parse(readFileSync(f, 'utf8'));
    doc.schema_version ??= SCHEMA_VERSION;
    try {
      if (cmd === 'record-evidence') {
        // This command IMPORTS a document. It does not observe anything, so it neither stamps
        // a content binding nor accepts one: a fingerprint is a statement about a run, and a
        // document cannot acquire the authority of an execution by describing itself as one.
        // The only thing that writes those fields is the runner that watched the command.
        for (const field of ['fingerprint', 'contract_digest']) {
          if (doc[field]) {
            die(`${field} is written by \`state.mjs run\`, which watches the command and measures what it ran against. ` +
                `An imported document carrying it is claiming an observation this command did not make — drop the field, ` +
                `or produce the evidence with \`state.mjs run\`.`, 1);
          }
        }
        store.putEvidence(doc);
        console.log(`recorded evidence ${doc.evidence_id}: ${doc.property} = ${doc.result}`);
        console.error('  imported, not observed here: this satisfies only gates that do not require fresh evidence');
      }
      else if (cmd === 'record-approval') {
        // An INTEGRATION approval names what it authorises, and the artifact record is part of
        // that. Content and contract were the only things it used to name, so the same approval
        // kept matching across a reopening that replaced exactly that record.
        //
        // Nothing here grants anything. Filling in a reference is bookkeeping; `granted_by` is
        // the claim about a human, and this command records it, never makes it.
        // ONE read for the whole command: the revision this reservation uses is the revision that
        // validated the preparation being approved. A second, newer read taken just before the
        // write would reserve against a world the decision never saw.
        const cc = doc.gate === 'integration' && doc.change_id ? closureContext(doc.change_id) : null;
        if (doc.gate === 'integration' && doc.change_id) {
          if (cc.authority.ok === false) die(`${cc.authority.code}: ${cc.authority.message}`, 1);
          // An unfinished write comes FIRST: whatever is on disk is half of two different states,
          // and approving over it approves neither of them. It is also the sharper diagnosis —
          // "there is no preparation to name" is true and sends the operator looking in the wrong
          // place when the reason there is none is a write that stopped part way.
          if (cc.pending) {
            die(`E_OPERATION_PENDING: ${doc.change_id} has an unfinished ${cc.pending.kind} operation ` +
                `(${cc.pending.operation_id}) at phase "${cc.pending.phase}". ${cc.pending.recovery}`, 1);
          }
          const legacyMode = store.change(doc.change_id)?.closure_mode === 'legacy';
          if (!legacyMode) {
            if (!doc.preparation) {
              die('an integration approval must name the preparation it authorises: ' +
                  '{ "preparation": { "preparation_id", "generation", "preparation_digest" } }. ' +
                  `Read them from ${manifestPath(doc.change_id).split('\\').join('/')}.`, 1);
            }
            if (!doc.integration_target) {
              die('an integration approval must name the integration it authorises: ' +
                  '{ "integration_target": { "repository", "pr", "head_sha", "base_branch" } }. ' +
                  'A merge is confirmed against the PR that was approved, not against any PR whose tree happens to match.', 1);
            }
            const covers = approvalCoversPreparation(doc, cc.manifest);
            if (!covers.ok) die(`${covers.code}: ${covers.message}`, 1);
          }
        }
        // ONE transaction for an integration approval: the durable entry and the document itself
        // are written inside the same critical section, reserved against the control revision this
        // decision was taken at. Two separate boundaries left half an approval readable as whole
        // authority, and let a refresh that had already decided overwrite the record being
        // approved a moment later.
        if (doc.gate === 'integration' && doc.change_id) {
          try {
            updateLifecycle(root, doc.change_id, (cur) => ({
              ...cur,
              approved: [
                ...cur.approved.filter((r) => r.approval_id !== doc.approval_id),
                {
                  approval_id: doc.approval_id,
                  ...(doc.preparation ? {
                    preparation_id: doc.preparation.preparation_id,
                    generation: doc.preparation.generation,
                    preparation_digest: doc.preparation.preparation_digest,
                  } : { closure_mode: 'legacy' }),
                  at: doc.timestamp,
                },
              ],
            }), {
              expectedRevision: cc.lifecycle?.revision ?? 0,
              after: () => store.putApproval(doc),
            });
          } catch (e) {
            die(`${e.code ?? 'E_APPROVAL_NOT_RECORDED'}: ${e.message}` +
                (e.code === 'E_CONCURRENT_UPDATE'
                  ? '\n  The closure moved between reading the preparation and recording the approval. Nothing was written; read it again.'
                  : ''), 1);
          }
          store.appendHistory(doc.change_id, {
            event_id: `integration_approved_record:${doc.approval_id}`,
            type: 'integration_approval_recorded',
            at: doc.timestamp,
            approval_id: doc.approval_id,
            preparation_id: doc.preparation?.preparation_id,
            generation: doc.preparation?.generation,
            schema_version: SCHEMA_VERSION,
          });
        } else {
          store.putApproval(doc);
        }
        console.log(`recorded approval ${doc.approval_id} for gate ${doc.gate}`);
      }
      else { const it = store.putDeferred(doc); console.log(`deferred #${it.stable_id} [${it.status}] ${it.title ?? ''}`); }
    } catch (e) { die(e.message, 1); }
    break;
  }

  case 'trail': {
    // The operational trail: what happened, kept apart from the content it describes. This is
    // why closing a change needs no commit — an event about a revision is not part of it.
    //
    // Retention: append-only, one file per change under `.spectree/history/`, kept for as long
    // as the project keeps `.spectree/`. It is LOCAL, and a consumer that gitignores `.spectree/`
    // has no durable copy off this machine — say so rather than calling it an audit trail. Use
    // `--export` to hand it to whatever does keep records.
    const id = argv[1] && !argv[1].startsWith('--') ? argv[1] : null;
    if (!store.present) die('no .spectree directory here', 1);
    const ids = id ? [id] : store.changes().map((c) => c.change_id);
    const events = ids.flatMap((cid) => store.history(cid).map((e) => ({ change_id: cid, ...e })));
    const out = flag('export');
    if (out) {
      writeFileSync(out, events.map((e) => `${JSON.stringify(e)}\n`).join(''));
      console.log(`exported ${events.length} event(s) for ${ids.length} change(s) -> ${out}`);
      break;
    }
    if (has('json')) { console.log(JSON.stringify(events, null, 2)); break; }
    for (const e of events) {
      console.log(`${e.at ?? '?'}  ${e.change_id}  ${e.type}${e.to ? ` -> ${e.to}` : ''}${e.pr ? `  PR #${e.pr}` : ''}`);
    }
    console.log(`\n${events.length} event(s). Local to this machine: nothing here is a durable audit record on its own.`);
    break;
  }

  case 'validate': {
    if (!store.present) die('no .spectree directory here', 1);
    let bad = 0, seen = 0;
    const check = (id, docs, label) => {
      for (const d of docs) {
        seen++;
        const r = validate(id, d);
        if (!r.valid) { bad++; console.error(`${label}: ${r.errors.map((e) => `${e.code} ${e.path}`).join(', ')}`); }
      }
    };
    check('spectree/change', store.changes(), 'change');
    check('spectree/evidence', store.evidence(), 'evidence');
    check('spectree/approval', store.approvals(), 'approval');
    check('spectree/dispatch', store.dispatches(), 'dispatch');
    check('spectree/deferred', store.deferred().items, 'deferred');
    // The closure documents too. They carry their own semantic checks where they are read; this
    // is the cheap structural pass over everything the project has stored.
    const closureDir = join(root, '.spectree', 'closure');
    if (existsSync(closureDir)) {
      const preparations = [], receipts = [];
      for (const name of readdirSync(closureDir)) {
        if (!name.endsWith('.json')) continue;
        let doc;
        try { doc = JSON.parse(readFileSync(join(closureDir, name), 'utf8')); } catch { continue; }
        if (name.endsWith('.receipt.json')) receipts.push(doc);
        else if (name.endsWith('.lifecycle.json')) continue;
        else if (doc.manifest_version) preparations.push(doc);
      }
      check('spectree/preparation', preparations, 'preparation');
      check('spectree/receipt', receipts, 'receipt');
    }
    if (bad) { console.error(`\nstate validate FAILED — ${bad} of ${seen} document(s) invalid`); process.exit(1); }
    console.log(`state validate OK -- ${seen} document(s).`);
    break;
  }

  default:
    die(`usage: state.mjs <init|resume|open|digest|can|transition|run|record-evidence|record-approval|defer|trail|validate>`);
}
