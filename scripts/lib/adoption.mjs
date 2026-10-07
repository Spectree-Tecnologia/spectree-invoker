// Adoption starts a new draft. Artifact location never becomes historical authority.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Store } from './store.mjs';
import { assertValid } from './validate.mjs';
import { doctor, inside, identifier, bounded, references, snapshot, refuse } from './work.mjs';
import { hash } from './context.mjs';
import { diagnoseProject, selectClosureMode } from './project-diagnostics.mjs';

function observed(root) {
  const files = [];
  function walk(rel) {
    const path = inside(root, rel); if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      const child = `${rel}/${entry.name}`; const resolved = inside(root, child);
      if (entry.isDirectory()) walk(child);
      else files.push([child, hash(readFileSync(resolved))]);
    }
  }
  walk('docs/changes');
  // Include ignored operational authority and artifact files, not just Git content.
  for (const folder of ['changes', 'history', 'approvals', 'evidence', 'closure', 'dispatches', 'tasks', 'work']) walk(`.spectree/${folder}`);
  for (const p of ['.spectree/project.json', '.spectree/deferred.json']) if (existsSync(inside(root, p))) files.push([p, hash(readFileSync(inside(root, p)))]);
  return { candidate: snapshot(root), state_digest: hash(files) };
}
export function planAdoption(root, request) {
  if (!request || request.version !== 1) refuse('E_ADOPTION_REQUEST', 'Expected a version 1 adoption request.');
  identifier(request.project_id); identifier(request.change_id); bounded(request.scope, 'scope', 4000);
  if (!Array.isArray(request.allowed_paths) || !request.allowed_paths.length) refuse('E_ADOPTION_REQUEST', 'Declare the new change paths.');
  for (const p of request.allowed_paths) {
    inside(root, p.endsWith('/') ? p.slice(0, -1) : p);
    if (/^\.spectree(?:\/|$)/i.test(p)) refuse('E_ADOPTION_REQUEST', 'Operational authority is not an implementation path.');
  }
  if (!['codex', 'claude-code'].includes(request.adapter) || !['prepared', 'legacy'].includes(request.closure_mode)) refuse('E_ADOPTION_REQUEST', 'Declare adapter and closure_mode explicitly.');
  if (request.deltaless !== undefined && typeof request.deltaless !== 'boolean') refuse('E_ADOPTION_REQUEST', 'deltaless must be an explicit boolean.');
  const report = doctor(root); const store = new Store(root);
  const diagnostic = diagnoseProject(root);
  if (report.project && (report.project.project_id !== request.project_id || report.project.schema_version !== '1.0.0')) refuse('E_ADOPTION_IDENTITY', 'Existing project identity/schema cannot be overwritten.');
  if (store.change(request.change_id)) refuse('E_ADOPTION_EXISTS', 'Change already registered; use its existing lifecycle.');
  const reading = references(root, request.refs ?? []);
  if (!reading.length) refuse('E_ADOPTION_REQUEST', 'Reference the reviewed legacy artifacts or new proposal.');
  const binding = observed(root);
  const project = report.project ?? { schema_version: '1.0.0', project_id: request.project_id, protocol_version: '1.0.0' };
  selectClosureMode(project, request.closure_mode);
  const change = { schema_version: '1.0.0', protocol_version: '1.0.0', project_id: request.project_id, change_id: request.change_id,
    adapter: request.adapter, change_type: request.change_type ?? 'feature', base_revision: binding.candidate.revision,
    scope: request.scope, allowed_paths: request.allowed_paths, state: 'draft', closure_mode: request.closure_mode,
    ...(request.deltaless !== undefined ? { deltaless: request.deltaless } : {}) };
  assertValid('spectree/change', change);
  const plan = { version: 1, request, binding, reading, inventory: report, diagnostic, project, create_project: !report.project, change,
    effects: ['Register a new draft and adoption provenance.', 'Preserve existing project configuration and legacy artifacts.'],
    outstanding: ['Review the proposal and approve the current scope through the normal lifecycle.',
      request.deltaless ? 'Observe branch isolation and baseline; deltaless skips only pass 1, never QA, CI or integration gates.'
        : 'Observe branch isolation, baseline and pass 1; historical artifacts are not evidence for these gates.',
      ...(request.closure_mode === 'legacy' ? ['Legacy closure was explicitly selected; observe consolidation, archive and integration through its existing gates.'] : []),
      ...(project.ci ? [] : ['Declare the consumer CI identity before integration.'])],
    authorizes_execution: false, historical_approvals_created: 0 };
  return { ...plan, plan_digest: hash(plan) };
}
export function applyAdoption(root, reviewed) {
  const fresh = planAdoption(root, reviewed.request);
  if (hash(fresh) !== hash(reviewed)) refuse('E_ADOPTION_STALE', 'Reviewed plan or candidate changed. Generate and review a new plan.');
  const id = identifier(fresh.change.change_id);
  const destinations = [`.spectree/changes/${id}.json`, `.spectree/history/${id}.jsonl`, `.spectree/adoptions/${id}.json`, `.spectree/adoptions/${id}-completed.json`,
    ...(fresh.create_project ? ['.spectree/project.json'] : [])];
  for (const rel of destinations) if (existsSync(inside(root, rel))) refuse('E_ADOPTION_EXISTS', `Refusing to replace ${rel}.`);
  // Persist the exact approved plan first. A crash leaves explicit partial adoption for inspection;
  // never resume by overwriting a potentially newer change or synthesizing a finished receipt.
  const put = (rel, value) => { const p = inside(root, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(value) + '\n', { flag: 'wx' }); };
  put(`.spectree/adoptions/${id}.json`, { version: 1, at: new Date().toISOString(), state: 'prepared', plan: fresh });
  if (fresh.create_project) put('.spectree/project.json', fresh.project);
  const change = { ...fresh.change, state_revision: 1, updated_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z') };
  put(`.spectree/history/${id}.jsonl`, { type: 'adopted_as_draft', event_id: `adopted_as_draft:${id}:${fresh.plan_digest}`,
    state: 'draft', state_revision: change.state_revision, plan_digest: fresh.plan_digest, at: change.updated_at });
  put(`.spectree/changes/${id}.json`, change);
  put(`.spectree/adoptions/${id}-completed.json`, { version: 1, plan_digest: fresh.plan_digest, state: 'completed', historical_approvals_created: 0 });
  return { applied: true, change_id: id, state: 'draft', authorizes_execution: false, outstanding: fresh.outstanding };
}
