// Durable observations, never lifecycle authority. One operation has one writer.
import { mkdirSync, readdirSync, readFileSync, lstatSync } from 'node:fs';
import { identifier } from './work.mjs';
import { inside, refuse, writeOnce } from '../shared/index.mjs';

const TYPES = new Set(['run.started', 'agent.finished', 'check.finished', 'run.finished', 'run.uncertain', 'run.reconciled']);
export function validRunEvent(event, change, operation, sequence) {
  if (!event || event.version !== 1 || event.sequence !== sequence || event.change_id !== change || event.operation_id !== operation ||
      !TYPES.has(event.type) || (sequence === 1) !== (event.type === 'run.started') || event.authorizes_execution !== false ||
      typeof event.at !== 'string' || !Number.isFinite(Date.parse(event.at))) return false;
  if (event.metrics != null) {
    const m = event.metrics;
    if (typeof m !== 'object' || Array.isArray(m) || !['adapter_report', 'synthetic_transport'].includes(m.provenance) ||
        (m.reported_models != null && (!Array.isArray(m.reported_models) || !m.reported_models.every(v => typeof v === 'string')))) return false;
    for (const field of ['elapsed_ms', 'input_tokens', 'output_tokens', 'cached_input_tokens', 'cache_creation_tokens', 'cost_usd'])
      if (m[field] != null && !(typeof m[field] === 'number' && Number.isFinite(m[field]) && m[field] >= 0)) return false;
    if (m.provenance === 'synthetic_transport' && ['input_tokens', 'output_tokens', 'cached_input_tokens', 'cache_creation_tokens', 'cost_usd'].some(k => m[k] != null)) return false;
  }
  return true;
}
export function runEvents(root, change, operation) {
  const relative = `.spectree/runs/${identifier(change)}/${identifier(operation)}`;
  const dir = inside(root, relative);
  let entries;
  try { entries = readdirSync(dir).sort(); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  if (entries.length > 1000) refuse('E_RUN_LIMIT', 'Run exceeds the event budget.');
  return entries.map((name, i) => {
    const path = inside(root, `${relative}/${name}`), stat = lstatSync(path);
    if (name !== `${String(i + 1).padStart(6, '0')}.json` || !stat.isFile() || stat.size > 128 * 1024) refuse('E_RUN_CORRUPT', 'Run sequence or file is invalid.');
    let event;
    try { event = JSON.parse(readFileSync(path, 'utf8')); } catch { refuse('E_RUN_CORRUPT', 'Incomplete run event.'); }
    if (!validRunEvent(event, change, operation, i + 1)) refuse('E_RUN_CORRUPT', 'Run identity or event is invalid.');
    return event;
  });
}
export function appendRunEvent(root, change, operation, type, details = {}) {
  if (!TYPES.has(type)) refuse('E_RUN_EVENT', 'Unsupported run event.');
  const previous = runEvents(root, change, operation);
  if ((!previous.length && type !== 'run.started') || (previous.length && type === 'run.started')) refuse('E_RUN_EVENT', 'Exactly one start must precede run observations.');
  const sequence = previous.length + 1;
  if (sequence > 1000) refuse('E_RUN_LIMIT', 'Run exceeds the event budget.');
  const dir = inside(root, `.spectree/runs/${identifier(change)}/${identifier(operation)}`);
  mkdirSync(dir, { recursive: true });
  const event = { ...details, version: 1, sequence, change_id: change, operation_id: operation, type, at: new Date().toISOString(), authorizes_execution: false };
  const text = JSON.stringify(event) + '\n';
  if (Buffer.byteLength(text) > 128 * 1024) refuse('E_RUN_LIMIT', 'Event exceeds 128 KiB.');
  writeOnce(inside(root, `.spectree/runs/${change}/${operation}/${String(sequence).padStart(6, '0')}.json`), text);
  return event;
}
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
export function agentMetrics(agent, config) {
  const native = ['codex', 'claude-code'].includes(config.kind);
  const usage = native ? agent.usage : null;
  const models = config.kind === 'claude-code' && agent.model_usage && typeof agent.model_usage === 'object'
    ? Object.keys(agent.model_usage).filter(m => m.length < 150) : [];
  return { adapter: config.kind, provenance: native ? 'adapter_report' : 'synthetic_transport',
    requested_model: config.model ?? null, reported_models: models.length ? models : null,
    elapsed_ms: number(agent.elapsed_ms), input_tokens: number(usage?.input_tokens), output_tokens: number(usage?.output_tokens),
    cached_input_tokens: number(usage?.cached_input_tokens ?? usage?.cache_read_input_tokens),
    cache_creation_tokens: number(usage?.cache_creation_input_tokens), cost_usd: native ? number(agent.cost_usd) : null };
}
