#!/usr/bin/env node
// The Invoker's state CLI. It validates the flow; it never performs the work.
//
//   node scripts/state.mjs init <project-id>
//   node scripts/state.mjs resume [change-id]        the resume contract, human-readable
//   node scripts/state.mjs resume --json
//   node scripts/state.mjs open <change-id> --type <t> --base <rev> --scope <s> --paths a,b [--deltaless]
//   node scripts/state.mjs can <change-id> <to-state>
//   node scripts/state.mjs transition <change-id> <to-state> --expect <state_revision>
//   node scripts/state.mjs record-evidence <file.json>
//   node scripts/state.mjs record-approval <file.json>
//   node scripts/state.mjs defer <file.json>
//   node scripts/state.mjs validate                  every stored document against its schema
//
// Exit codes: 0 allowed/valid, 1 refused/invalid, 2 usage.

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Store, SCHEMA_VERSION } from './lib/store.mjs';
import { canTransition } from './lib/state-machine.mjs';
import { validate } from './lib/validate.mjs';

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

/** The resume contract: everything needed to pick work back up, read from artifacts. */
function resume(changeId) {
  const g = gitSituation();
  const project = store.project();
  const changes = store.present ? store.changes() : [];
  const open = changes.filter((c) => c.state !== 'closed');
  const change = changeId ? store.change(changeId) : (open.find((c) => c.state !== 'blocked') ?? open[0] ?? null);

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
        }
      : null,
    approvals: change ? store.approvals(change.change_id).map((a) => ({ gate: a.gate, by: a.granted_by?.identity, kind: a.granted_by?.kind, revision: a.revision })) : [],
    evidence_valid_here: change
      ? store.evidence(change.change_id)
          .filter((e) => !e.superseded_by && (!g.revision || e.revision === g.revision))
          .map((e) => ({ property: e.property, result: e.result, source: e.source_kind }))
      : [],
    evidence_stale: change
      ? store.evidence(change.change_id)
          .filter((e) => !e.superseded_by && g.revision && e.revision !== g.revision)
          .map((e) => ({ property: e.property, observed_at: e.revision.slice(0, 8) }))
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
    if (r.change.blocked_reason) L.push(`blocked        ${r.change.blocked_reason}`);
    L.push(`owns paths     ${r.change.allowed_paths.join(', ')}`);
  }
  L.push(`approvals      ${r.approvals.length ? r.approvals.map((a) => `${a.gate} by ${a.by} (${a.kind})`).join('; ') : 'none'}`);
  L.push(`evidence here  ${r.evidence_valid_here.length ? r.evidence_valid_here.map((e) => `${e.property}=${e.result}`).join('; ') : 'none at this revision'}`);
  if (r.evidence_stale.length) L.push(`evidence stale ${r.evidence_stale.map((e) => `${e.property}@${e.observed_at}`).join('; ')}`);
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

  case 'can':
  case 'transition': {
    const id = argv[1] ?? die('usage: state.mjs can|transition <change-id> <to-state>');
    const to = argv[2] ?? die('usage: state.mjs can|transition <change-id> <to-state>');
    const change = store.change(id) ?? die(`no such change: ${id}`, 1);
    const g = gitSituation();
    const verdict = canTransition(change, to, {
      evidence: store.evidence(id),
      approvals: store.approvals(id),
      revision: g.revision,
      expectedStateRevision: has('expect') ? Number(flag('expect')) : undefined,
    });
    if (!verdict.ok) {
      console.error(`REFUSED ${change.state} -> ${to}`);
      console.error(`  ${verdict.code}: ${verdict.message}`);
      process.exit(1);
    }
    if (cmd === 'can') { console.log(`allowed ${change.state} -> ${to}`); break; }
    const saved = store.putChange({ ...change, state: to, evaluated_revision: g.revision ?? change.evaluated_revision },
      { event: { type: 'transition', from: change.state, to }, expected: change.state_revision });
    console.log(`${change.state} -> ${to}  (state_revision ${saved.state_revision})`);
    break;
  }

  case 'record-evidence':
  case 'record-approval':
  case 'defer': {
    const f = argv[1] ?? die(`usage: state.mjs ${cmd} <file.json>`);
    if (!existsSync(f)) die(`no such file: ${f}`);
    const doc = JSON.parse(readFileSync(f, 'utf8'));
    doc.schema_version ??= SCHEMA_VERSION;
    try {
      if (cmd === 'record-evidence') { store.putEvidence(doc); console.log(`recorded evidence ${doc.evidence_id}: ${doc.property} = ${doc.result}`); }
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
    die(`usage: state.mjs <init|resume|open|can|transition|record-evidence|record-approval|defer|validate>`);
}
