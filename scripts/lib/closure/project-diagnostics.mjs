// Read-only inventory. A script name or archived directory never proves closure.
import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assertValid, inside, refuse } from '../shared/index.mjs';
import { identifier, readLifecycle, pendingOperation, currentPath, receiptPath } from '../change/index.mjs';
import { consolidationCommand } from './closure-prep.mjs';

export function readDiagnosticJson(root, path) {
  const file = inside(root, path);
  if (!existsSync(file)) return null;
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > 512 * 1024) refuse('E_DIAGNOSTIC_LIMIT', `Unsupported diagnostic file: ${path}`);
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { refuse('E_DIAGNOSTIC_DOCUMENT', `Invalid JSON: ${path}`); }
}
export function closureStrategy(project) {
  const configured = consolidationCommand(project);
  const supported = configured.ok && configured.command.every(arg => typeof arg === 'string' && arg.trim());
  return { prepared_supported: Boolean(supported), consolidation: supported ? configured.command : null,
    selection: supported ? 'prepared_available' : 'explicit_legacy_or_configuration_required',
    command_executed: false };
}
export function selectClosureMode(project, requested) {
  const strategy = closureStrategy(project);
  if (requested !== undefined && !['prepared', 'legacy'].includes(requested)) refuse('E_CLOSURE_MODE', 'Choose prepared or legacy.');
  if (!requested && !strategy.prepared_supported) refuse('E_CLOSURE_SELECTION', 'No consolidation mechanism is configured. Inspect reconcile.mjs diagnose and explicitly choose --closure-mode legacy or configure closure.consolidate.');
  const mode = requested ?? 'prepared';
  if (mode === 'prepared' && !strategy.prepared_supported) refuse('E_CLOSURE_MECHANISM', 'Prepared closure requires a declared closure.consolidate command; script names are not proof of this contract.');
  return mode;
}
export function correctionStage(change) {
  return ['draft', 'proposed', 'scope_approved', 'isolated', 'baselined', 'pass1_complete', 'implemented']
    .includes(change.state === 'blocked' ? change.blocked_from : change.state);
}

export function diagnoseProject(root, selectedId) {
  if (selectedId) identifier(selectedId);
  const project = readDiagnosticJson(root, '.spectree/project.json');
  const pkg = readDiagnosticJson(root, 'package.json');
  const installed = readDiagnosticJson(root, '.spectree/squad/package.json');
  const inspector = JSON.parse(readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'));
  const strategy = closureStrategy(project);
  const scripts = Object.entries(pkg?.scripts ?? {}).filter(([name, value]) => typeof value === 'string' && /spec|clos|consolidat|archiv/i.test(name)).slice(0, 50)
    .map(([name, command]) => ({ name, command }));
  const changeDir = inside(root, '.spectree/changes');
  const names = selectedId ? [`${selectedId}.json`] : existsSync(changeDir) ? readdirSync(changeDir).filter(n => n.endsWith('.json')).sort() : [];
  if (names.length > 500) refuse('E_DIAGNOSTIC_LIMIT', 'Too many registered changes. Select one change explicitly.');
  const archiveDir = inside(root, 'docs/changes/archive');
  const archives = existsSync(archiveDir) ? readdirSync(archiveDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name) : [];
  if (archives.length > 2000) refuse('E_DIAGNOSTIC_LIMIT', 'Archive inventory exceeds the observation limit.');
  const changes = names.flatMap(name => {
    const c = readDiagnosticJson(root, `.spectree/changes/${name}`);
    if (!c) { if (selectedId) refuse('E_CHANGE_MISSING', 'Select an existing registered change.'); return []; }
    identifier(c.change_id);
    assertValid('spectree/change', c);
    if (name !== `${c.change_id}.json` || c.schema_version !== '1.0.0') refuse('E_DIAGNOSTIC_DOCUMENT', 'Unsupported change identity or schema.');
    const id = c.change_id, issues = [];
    const add = (code, message, next, command) => issues.push({ code, message, next, ...(command ? { command } : {}) });
    const matches = archives.filter(n => n === id || n.endsWith(`-${id}`));
    for (const name of matches) inside(root, `docs/changes/archive/${name}`);
    const open = existsSync(inside(root, `docs/changes/${id}`));
    for (const path of [currentPath(id), receiptPath(id), `.spectree/closure/${id}.lifecycle.json`]) inside(root, path.replaceAll('\\', '/'));
    const control = readLifecycle(root, id), pending = pendingOperation(control.doc);
    const canPlan = correctionStage(c) && !pending && !(control.present && !control.doc)
      && !control.doc?.current_preparation && !control.doc?.receipt
      && !existsSync(inside(root, currentPath(id).replaceAll('\\', '/')))
      && !existsSync(inside(root, receiptPath(id).replaceAll('\\', '/')))
      && matches.length <= 1 && !(open && matches.length);
    if (control.present && !control.doc) add(control.code, control.message, 'Inspect the control; do not overwrite it.');
    if (pending) add('E_OPERATION_PENDING', pending.recovery,
      pending.kind === 'reconcile_closure' ? 'Resume the persisted reconciliation without rerunning external commands.' : 'Recover the pending operation first.',
      pending.kind === 'reconcile_closure' ? ['reconcile.mjs', 'resume', id, pending.operation_id, '--apply'] : undefined);
    if ((c.closure_mode ?? 'prepared') === 'prepared' && !strategy.prepared_supported)
      add('E_CLOSURE_MECHANISM', 'Prepared closure is recorded without a declared consolidation mechanism.',
        canPlan ? 'Review project commands and prepare a closure-mode reconciliation plan; do not infer legacy from script names.'
          : 'Inspect pending operations, artifacts and existing closure authority first. Mode correction is limited to pre-integration work through implemented, without preparation or receipt.',
        canPlan ? ['reconcile.mjs', 'plan', '<request.json>'] : undefined);
    if (matches.length > 1 || (open && matches.length)) add('E_ARTIFACT_AMBIGUOUS', 'Multiple artifact locations match this change.', 'Resolve the artifact identity before reconciliation.');
    else if (matches.length && c.state !== 'closed') add('W_ARCHIVE_STATE_DIVERGENCE', 'Artifacts are archived but the runtime has not recorded valid closure.', 'Inspect merge, CI and approvals using the existing lifecycle. An archive is not closure evidence.');
    if (c.state === 'blocked') add('E_CHANGE_BLOCKED', c.blocked_reason ?? 'Change is blocked.', `After resolving the cause, use state.mjs plan ${id}; recovery must pass the normal gates.`);
    return [{ change_id: id, state: c.state, blocked_from: c.blocked_from ?? null, closure_mode: c.closure_mode ?? 'prepared',
      mode_explicit: Boolean(c.closure_mode), artifacts: { open, archives: matches }, issues }];
  });
  return { version: 1, authorizes_execution: false, project_id: project?.project_id ?? null,
    runtime: { inspector_version: inspector.version, installed_version: installed?.version ?? null,
      active_consumer_version: null, active_version_basis: 'not_observed',
      installed_matches_inspector: installed?.version ? installed.version === inspector.version : null },
    closure: strategy, script_candidates: scripts, scripts_are: 'Inventory only; neither executed nor interpreted as authority.', changes };
}
