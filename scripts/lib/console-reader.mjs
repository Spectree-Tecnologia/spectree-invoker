// Read-only projection: never evaluates gates, executes commands or follows artifact refs.
import { openSync, readSync, closeSync, fstatSync, readdirSync, statSync, lstatSync, constants } from 'node:fs';
import { basename } from 'node:path';
import { inside } from './work.mjs';
import { validate } from './validate.mjs';
import { ORDER, ENTRY_REQUIREMENTS } from './state-machine.mjs';

export const roles = [
  ['solutions_architect', 'Solutions architect', 'Arquitetura & especificação', 'SA'],
  ['full_stack_developer', 'Full-stack developer', 'Implementação & cenários', 'FS'],
  ['quality_engineer', 'Quality engineer', 'Verificação adversarial', 'QA'],
  ['platform_engineer', 'Platform engineer', 'Plataforma & entrega', 'PE'],
  ['integration_engineer', 'Integration engineer', 'Contratos & integrações', 'IE'],
  ['typesafe_engineer', 'Typesafe engineer', 'Tipos & invariantes', 'TS'],
].map(([id, name, purpose, short]) => ({ id, name, purpose, short }));
export const pipeline = ORDER.map(id => ({ id, requirements: ENTRY_REQUIREMENTS[id] }));
const pick = (doc, fields) => Object.fromEntries(fields.filter(k => doc[k] !== undefined).map(k => [k, doc[k]]));
const fields = {
  change: ['change_id', 'project_id', 'scope', 'state', 'state_revision', 'adapter', 'updated_at', 'blocked_reason', 'blocked_from', 'next_action', 'allowed_paths', 'base_revision', 'change_type'],
  evidence: ['evidence_id', 'change_id', 'property', 'check', 'executor', 'source_kind', 'revision', 'fingerprint', 'result', 'timestamp', 'exit_code', 'artifact_ref', 'limitations', 'superseded_by'],
  dispatch: ['dispatch_id', 'change_id', 'role', 'mission', 'exit_criteria', 'attempt', 'max_attempts', 'created_at', 'input_revision'],
  approval: ['approval_id', 'change_id', 'gate', 'decision', 'timestamp', 'revision'],
};

export function readProject(root, id) {
  const issues = [];
  let remaining = 8 * 1024 * 1024;
  let reads = 0, listings = 0;
  const issue = (source, code) => { if (issues.length < 50) issues.push({ source, code }); };
  try { if (!statSync(root).isDirectory()) throw new Error(); } catch { issue('.', 'E_SOURCE_UNAVAILABLE'); }
  function read(path, optional = true) {
    let fd;
    try {
      if (++reads > 2000) throw Object.assign(new Error(), { code: 'E_READ_LIMIT' });
      const file = inside(root, path);
      if (!lstatSync(file).isFile()) throw Object.assign(new Error(), { code: 'E_NOT_REGULAR_FILE' });
      // Do not block on a FIFO, including a file replaced between the type check and open.
      fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > 512 * 1024 || stat.size > remaining) throw Object.assign(new Error(), { code: 'E_READ_LIMIT' });
      remaining -= stat.size;
      const buf = Buffer.alloc(stat.size + 1);
      let size = 0, n;
      while (size < buf.length && (n = readSync(fd, buf, size, buf.length - size, null)) > 0) size += n;
      if (size > stat.size) throw Object.assign(new Error(), { code: 'E_CHANGED_DURING_READ' });
      return buf.subarray(0, size).toString('utf8');
    } catch (e) { if (!optional || e.code !== 'ENOENT') issue(path, e.code ?? 'E_READ'); return null; }
    finally { if (fd !== undefined) closeSync(fd); }
  }
  function json(path, schema) {
    const text = read(path);
    if (text === null) return null;
    try {
      const doc = JSON.parse(text);
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error();
      if (schema && (doc.schema_version !== '1.0.0' || !validate(`spectree/${schema}`, doc).valid)) throw new Error();
      return doc;
    } catch { issue(path, 'E_DOCUMENT_INVALID'); return null; }
  }
  function list(path) {
    try {
      if (++listings > 1000) throw Object.assign(new Error(), { code: 'E_RECORD_LIMIT' });
      const entries = readdirSync(inside(root, path), { withFileTypes: true });
      if (entries.length > 500) issue(path, 'E_RECORD_LIMIT');
      return entries.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 500);
    } catch (e) { if (e.code !== 'ENOENT') issue(path, e.code ?? 'E_READ'); return []; }
  }
  function records(dir, schema) {
    return list(`.spectree/${dir}`).filter(e => e.name.endsWith('.json')).flatMap(e => {
      const source = `.spectree/${dir}/${e.name}`;
      const doc = json(source, schema);
      if (doc && doc[`${schema}_id`] !== e.name.slice(0, -5)) { issue(source, 'E_RECORD_IDENTITY'); return []; }
      return doc ? [{ ...pick(doc, fields[schema]), source }] : [];
    });
  }
  let project = json('.spectree/project.json');
  if (project && (project.schema_version !== '1.0.0' || typeof project.project_id !== 'string')) { issue('.spectree/project.json', 'E_SCHEMA_VERSION'); project = null; }
  const changes = records('changes', 'change');
  const evidence = records('evidence', 'evidence').sort((a, b) => String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? '')));
  const dispatches = records('dispatches', 'dispatch');
  const approvals = records('approvals', 'approval');
  const events = [], tasks = [];
  for (const change of changes) {
    const changeId = change.change_id;
    // Schema IDs also permit characters unsuitable for filenames. inside() remains the boundary.
    const source = `.spectree/history/${changeId}.jsonl`;
    const history = read(source);
    if (history) {
      const lines = history.split('\n').filter(l => l.trim());
      if (lines.length > 500) issue(source, 'E_RECORD_LIMIT');
      for (const line of lines.slice(-500)) {
        try {
          const doc = JSON.parse(line);
          if (!doc || typeof doc.type !== 'string') throw new Error();
          events.push({ ...pick(doc, ['event_id', 'type', 'at', 'from', 'to', 'state_revision', 'reason']), change_id: changeId, source });
        } catch { issue(source, 'E_EVENT_INVALID'); }
      }
    }
    const taskSource = `.spectree/tasks/${changeId}.json`;
    const doc = json(taskSource);
    if (doc) {
      if (doc.plan?.tasks?.length > 50) issue(taskSource, 'E_RECORD_LIMIT');
      if (doc.version !== 1 || doc.change_id !== changeId || !Array.isArray(doc.plan?.tasks) || !Array.isArray(doc.attempts) || !doc.results || typeof doc.results !== 'object') issue(taskSource, 'E_TASK_STORE');
      else for (const task of doc.plan.tasks.slice(0, 50)) {
        if (!task || typeof task.id !== 'string' || typeof task.mission !== 'string' || !Array.isArray(task.depends_on)) { issue(taskSource, 'E_TASK_STORE'); continue; }
        const attempts = doc.attempts.filter(a => a?.task_id === task.id);
        tasks.push({ ...pick(task, ['id', 'mission', 'depends_on', 'max_attempts', 'scenarios']), change_id: changeId,
          attempts: attempts.map(a => pick(a, ['id', 'status', 'task_id'])), result: doc.results[task.id] ? pick(doc.results[task.id], ['valid', 'evidence_ref', 'revision', 'content_digest']) : null,
          freshness: 'not_revalidated', source: taskSource });
      }
    }
    for (const op of list(`.spectree/work/${changeId}`)) {
      for (const name of ['started', 'finished', 'reconciled']) {
        const source = `.spectree/work/${changeId}/${op.name}/${name}.json`;
        const doc = json(source);
        if (!doc) continue;
        if (doc.version !== 1 || doc.change_id !== changeId || doc.operation_id !== op.name || doc.event !== name) { issue(source, 'E_WORK_CORRUPT'); continue; }
        events.push({ ...pick(doc, ['at', 'phase', 'task', 'next', 'status', 'note']), type: `work.${name}`, operation_id: op.name, change_id: changeId, source });
      }
    }
  }
  const legacy = list('docs/changes').filter(e => e.name !== 'archive' && e.isDirectory()).map(e => e.name);
  const archives = list('docs/changes/archive').filter(e => e.isDirectory()).length;
  if (events.length > 500) issue('.spectree/history', 'E_RECORD_LIMIT');
  return { id, name: project?.project_id ?? basename(root), mode: 'live', initialized: !!project,
    health: issues.length ? 'partial' : project ? 'readable' : 'uninitialized', observed_at: new Date().toISOString(),
    changes, evidence, dispatches, approvals, tasks, events: events.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? ''))).slice(0, 500),
    issues: issues.slice(0, 50), legacy: { proposals: legacy, archives },
    authorizes_execution: false, freshness: 'not_revalidated' };
}
