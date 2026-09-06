#!/usr/bin/env node
// The Invoker's state CLI. It validates the flow; it never performs the work.
//
//   node scripts/state.mjs init <project-id>
//   node scripts/state.mjs resume [change-id]        the resume contract, human-readable
//   node scripts/state.mjs resume --json
//   node scripts/state.mjs open <change-id> --type <t> --base <rev> --scope <s> --paths a,b [--deltaless]
//   node scripts/state.mjs digest <change-id> [--gate scope|integration]
//   node scripts/state.mjs can <change-id> <to-state>
//   node scripts/state.mjs transition <change-id> <to-state> --expect <state_revision>
//   node scripts/state.mjs transition <change-id> blocked --reason "<why>"
//   node scripts/state.mjs run <change-id> <property> --role <r> [--independent-of a,b]
//                                [--expect-nonzero --expect-signal <text>] [--id <e>]
//                                -- <command> [args...]
//   node scripts/state.mjs record-evidence <file.json>
//   node scripts/state.mjs record-approval <file.json>
//   node scripts/state.mjs defer <file.json>
//   node scripts/state.mjs validate                  every stored document against its schema
//
// Exit codes: 0 allowed/valid, 1 refused/invalid, 2 usage.

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Store, SCHEMA_VERSION } from './lib/store.mjs';
import { canTransition, INVERTIBLE } from './lib/state-machine.mjs';
import { contractDigest, contentDigest, gatedDigest } from './lib/digest.mjs';
import { launch } from './lib/launch.mjs';
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

/** The resume contract: everything needed to pick work back up, read from artifacts. */
function resume(changeId) {
  const g = gitSituation();
  const project = store.project();
  const changes = store.present ? store.changes() : [];
  const open = changes.filter((c) => c.state !== 'closed');
  const change = changeId ? store.change(changeId) : (open.find((c) => c.state !== 'blocked') ?? open[0] ?? null);
  const live = change ? store.evidence(change.change_id).filter((e) => !e.superseded_by) : [];
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
    approvals: change ? store.approvals(change.change_id).map((a) => ({ gate: a.gate, by: a.granted_by?.identity, kind: a.granted_by?.kind, revision: a.revision })) : [],
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
  L.push(`approvals      ${r.approvals.length ? r.approvals.map((a) => `${a.gate} by ${a.by} (${a.kind})`).join('; ') : 'none'}`);
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
    const doc = store.init({ project_id: id, protocol_version: '1.0.0', created_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z') });
    console.log(`initialised .spectree for ${doc.project_id} (schema ${SCHEMA_VERSION})`);
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
    const verdict = canTransition(change, to, {
      evidence: store.evidence(id),
      approvals: store.approvals(id),
      revision: g.revision,
      contentDigest: d.content.digest,
      contractDigest: d.contract.digest,
      scopeDigests: d.byGate,
      expectedStateRevision: has('expect') ? Number(flag('expect')) : undefined,
    });
    if (!verdict.ok) {
      console.error(`REFUSED ${change.state} -> ${to}`);
      console.error(`  ${verdict.code}: ${verdict.message}`);
      if (verdict.code === 'E_APPROVAL_DIGEST_MISMATCH') console.error(`  current contract: ${d.contract.source} -> ${d.contract.digest}`);
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
    const saved = store.putChange(next, { event: { type: 'transition', from: change.state, to }, expected: change.state_revision });
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

    // Inverting the result is only meaningful where the property IS a failure: pass 1's
    // delivery is failing tests. Allowing it anywhere turned a red CI into a green gate with
    // one flag, so the permission is an allowlist and everything else is refused by name.
    const expectNonzero = pre.includes('--expect-nonzero');
    if (expectNonzero && !INVERTIBLE.has(property)) {
      die(`--expect-nonzero is not available for "${property}": it asserts success, and a command that failed is not evidence that it succeeded. ` +
          `Inversion exists for ${[...INVERTIBLE].join(', ')}.`);
    }
    // And a non-zero exit alone does not say a test failed — a crash, a missing file and a
    // syntax error all exit non-zero. The run has to show the signal it was looking for.
    const signal = opt('expect-signal');
    if (expectNonzero && !signal) {
      die('--expect-nonzero requires --expect-signal "<text the failing run must print>": ' +
          'a non-zero exit is also what a broken suite does, and the two are not the same finding');
    }

    let before;
    try { before = contentDigest(root); } catch (e) { die(`${e.code}: ${e.message}`, 1); }
    const r = launch(cmd, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    let after;
    try { after = contentDigest(root); } catch (e) { die(`${e.code}: ${e.message}`, 1); }
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    if (output) process.stderr.write(output.endsWith('\n') ? output : `${output}\n`);

    const moved = before.digest !== after.digest;
    const sawSignal = Boolean(signal) && output.includes(signal);
    const result = r.error ? 'INFRA_ERROR'
      : moved ? 'INCONCLUSIVE'
      : expectNonzero
        ? (r.status === 0 ? 'FAIL' : sawSignal ? 'PASS' : 'INFRA_ERROR')
        : (r.status === 0 ? 'PASS' : 'FAIL');

    const doc = {
      schema_version: SCHEMA_VERSION,
      evidence_id: opt('id') ?? `ev-${randomUUID().slice(0, 8)}`,
      change_id: id,
      property,
      check: cmd.join(' ') + (expectNonzero ? '  (expected to exit non-zero)' : ''),
      executor: { role, ...(independent.length ? { independent_of: independent } : {}) },
      source_kind: 'observed_execution',
      revision: before.revision,
      fingerprint: before.digest,
      contract_digest: contractDigest(root, change, { artifactsDir: opt('artifacts') }).digest,
      environment: { os: process.platform, runtime: `node ${process.versions.node}` },
      timestamp: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      result,
      ...(typeof r.status === 'number' ? { exit_code: r.status } : {}),
      ...(signal ? { negative_control: { input: cmd.join(' '), expected_signal: signal, ...(sawSignal ? { observed_signal: signal } : {}) } } : {}),
      ...(moved ? { limitations: ['the command changed the content it was measuring, so what it exercised cannot be established'] } : {}),
      ...(r.error ? { limitations: [`the command could not be executed: ${r.error.message}`] } : {}),
      ...(expectNonzero && !sawSignal && r.status !== 0 && !moved && !r.error
        ? { limitations: [`exited ${r.status} without printing "${signal}": a crash, a missing file and a syntax error also exit non-zero, so nothing was exercised`] }
        : {}),
    };
    try { store.putEvidence(doc); } catch (e) { die(e.message, 1); }
    console.error(`recorded evidence ${doc.evidence_id}: ${property} = ${result}`);
    console.error(`  content ${before.digest.slice(0, 22)}...${before.dirty ? ' (with uncommitted changes)' : ''}`);
    if (moved) console.error('  the content moved DURING the run: recorded INCONCLUSIVE, and it satisfies no gate');
    if (expectNonzero && !sawSignal && r.status !== 0) console.error(`  it failed, but never printed "${signal}" — that is a broken run, not a red test`);
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
      else if (cmd === 'record-approval') { store.putApproval(doc); console.log(`recorded approval ${doc.approval_id} for gate ${doc.gate}`); }
      else { const it = store.putDeferred(doc); console.log(`deferred #${it.stable_id} [${it.status}] ${it.title ?? ''}`); }
    } catch (e) { die(e.message, 1); }
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
    if (bad) { console.error(`\nstate validate FAILED — ${bad} of ${seen} document(s) invalid`); process.exit(1); }
    console.log(`state validate OK -- ${seen} document(s).`);
    break;
  }

  default:
    die(`usage: state.mjs <init|resume|open|digest|can|transition|run|record-evidence|record-approval|defer|validate>`);
}
