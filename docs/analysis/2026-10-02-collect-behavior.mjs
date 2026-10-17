// Read-only source inspection. Writes only the derived JSON beside this script.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// usage: node 2026-10-02-collect-behavior.mjs <project-dir> <claude-session-dir>
const [project, sessionRoot] = process.argv.slice(2);
if (!project || !sessionRoot) { console.error('usage: <project-dir> <claude-session-dir>'); process.exit(2); }
const sessionId = '813b6a11-e77e-4817-988b-ef804ff1b04b';
const from = '2026-09-27T12:17:19.000Z';
const through = '2026-10-02T15:33:05.050Z';
const readRows = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
  .flatMap((s) => { try { return [JSON.parse(s)]; } catch { return []; } });
const inWindow = (r) => r.timestamp >= from && r.timestamp <= through;
const main = readRows(`${sessionRoot}/${sessionId}.jsonl`).filter(inWindow);
const blocks = (r) => Array.isArray(r.message?.content) ? r.message.content : [];
const texts = (r) => typeof r.message?.content === 'string' ? [r.message.content]
  : blocks(r).filter((c) => c.type === 'text').map((c) => c.text);
const words = (s) => s?.trim() ? s.trim().split(/\s+/).length : 0;
const summary = (a) => {
  const b = [...a].sort((x, y) => x - y);
  return { n: b.length, min: b[0] ?? null,
    median: b.length ? (b[Math.floor((b.length - 1) / 2)] + b[Math.floor(b.length / 2)]) / 2 : null,
    max: b.at(-1) ?? null, sum: b.reduce((s, x) => s + x, 0) };
};
const agentCalls = main.flatMap((r) => blocks(r).filter((c) => c.type === 'tool_use' && c.name === 'Agent')
  .map((c) => ({ timestamp: r.timestamp, id: c.id, role: c.input.subagent_type,
    description: c.input.description, background: c.input.run_in_background === true,
    prompt_words: words(c.input.prompt), protocol_package: c.input.prompt?.match(/spectree\/(1\.[45]\.0)\//)?.[1] ?? null })));
const dispatchResults = main.filter((r) => r.toolUseResult?.agentId).map((r) => ({
  timestamp: r.timestamp, agent_id: r.toolUseResult.agentId, status: r.toolUseResult.status,
  role: r.toolUseResult.agentType ?? null, model: r.toolUseResult.resolvedModel,
  harness_duration_ms: r.toolUseResult.totalDurationMs ?? null,
}));
const agentIds = new Set(dispatchResults.map((x) => x.agent_id));
for (const r of main) for (const c of blocks(r)) {
  if (c.type === 'tool_use' && c.name === 'SendMessage') {
    for (const value of Object.values(c.input ?? {})) if (typeof value === 'string' && /^a[0-9a-f]{16}$/.test(value)) agentIds.add(value);
  }
}
const agentSummaries = [];
const usageSummary = (rows) => {
  const byId = new Map();
  for (const r of rows) {
    if (r.type !== 'assistant' || !r.message?.id || r.message.model === '<synthetic>') continue;
    const old = byId.get(r.message.id) ?? { model: r.message.model, input_tokens: 0,
      cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 };
    // Streaming records repeat a request; take the largest field reported for each ID.
    for (const k of ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens']) {
      old[k] = Math.max(old[k], r.message.usage?.[k] ?? 0);
    }
    byId.set(r.message.id, old);
  }
  const values = [...byId.values()]; const totals = {}; const models = {};
  for (const v of values) {
    models[v.model] = (models[v.model] ?? 0) + 1;
    for (const [k, n] of Object.entries(v)) if (typeof n === 'number') totals[k] = (totals[k] ?? 0) + n;
  }
  return { unique_message_ids: values.length, models, totals,
    input_per_request_including_cache: summary(values.map((v) => v.input_tokens + v.cache_creation_input_tokens + v.cache_read_input_tokens)) };
};
for (const id of agentIds) {
  const p = `${sessionRoot}/${sessionId}/subagents/agent-${id}.jsonl`;
  if (!fs.existsSync(p)) continue;
  const rows = readRows(p).filter(inWindow);
  agentSummaries.push({ agent_id: id, event_count: rows.length,
    first: rows[0]?.timestamp, last: rows.at(-1)?.timestamp,
    rate_limit_events: rows.filter((r) => r.error === 'rate_limit').map((r) => r.timestamp),
    usage: usageSummary(rows) });
}
const deferredText = fs.readFileSync(`${project}/docs/DEFERRED.md`, 'utf8');
// The introduction contains numbered historical summaries, not backlog entries.
const entryStart = deferredText.indexOf('\n## Blockers on the first deploy');
if (entryStart < 0) throw new Error('Deferred entry section was not found; refusing an ambiguous count.');
const entries = [...deferredText.slice(entryStart).matchAll(/^(\d+)\.\s+((?:~~)?\*\*.*)$/gm)]
  .map((m) => ({ id: Number(m[1]), closed: m[2].startsWith('~~') }));
const fileStats = [];
for (const f of ['.log/platform.log', 'docs/DEFERRED.md', 'docs/roles/spectree.role.md',
  'docs/changes/archive/2026-10-02-settlement-totals/proposal.md',
  'docs/changes/archive/2026-10-02-settlement-totals/tasks.md']) {
  const s = fs.readFileSync(`${project}/${f}`, 'utf8');
  fileStats.push({ file: f, bytes: Buffer.byteLength(s), words: words(s), lines: s.split('\n').length });
}
const gitRead = (...args) => execFileSync('git', ['-c', `safe.directory=${project}`, '--no-optional-locks', ...args], {
  cwd: project, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
}).trim();
const stateCollections = Object.fromEntries(['changes', 'dispatches', 'approvals', 'evidence', 'history'].map((name) =>
  [name, fs.readdirSync(path.join(project, '.spectree', name)).length]));
const result = {
  observed_at_utc: new Date().toISOString(), from_utc: from, through_utc: through,
  source: { project, session_id: sessionId, session_file: `${sessionRoot}/${sessionId}.jsonl` },
  limits: ['Source project read only; no test/build/migration/deploy executed by this analysis.',
    'Log usage is not billing. Cached tokens are repeated input; no monetary cost is inferred.',
    'Agent durations include tools and waits; do not sum them as wall-clock elapsed time.',
    'Child logs are limited to agent IDs found in this main-session window; not an account-wide census.',
    'Consumer file state is a live snapshot, separate from the fixed session-event cutoff.'],
  git: { head: gitRead('rev-parse', 'HEAD'), branch: gitRead('branch', '--show-current'), status: gitRead('status', '--short') },
  state_collections: stateCollections,
  deferred: { count: entries.length, max_id: Math.max(...entries.map((x) => x.id)),
    closed: entries.filter((x) => x.closed).length, open: entries.filter((x) => !x.closed).length,
    duplicate_ids: entries.filter((x, i) => entries.findIndex((y) => y.id === x.id) !== i).map((x) => x.id),
    structured_items: JSON.parse(fs.readFileSync(`${project}/.spectree/deferred.json`, 'utf8')).items.length },
  files: fileStats,
  main: { event_count: main.length, usage: usageSummary(main),
    rate_limit_events: main.filter((r) => r.error === 'rate_limit').map((r) => r.timestamp),
    human_explicit_limit_reports: main.filter((r) => r.type === 'user' && texts(r).some((s) =>
      !s.startsWith('Another Claude session') && /(?:sess[aã]o atingiu o limite|limite de sess[aã]o atingido)/i.test(s)))
      .map((r) => ({ timestamp: r.timestamp, uuid: r.uuid })),
    dispatch_count: agentCalls.length, dispatch_prompt_words: summary(agentCalls.map((x) => x.prompt_words)),
    background_dispatch_count: agentCalls.filter((x) => x.background).length,
    agent_calls: agentCalls, dispatch_results: dispatchResults },
  children: agentSummaries,
};
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '2026-10-02-squad-behavior-metrics.json');
fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ output: out, deferred: result.deferred, state: stateCollections,
  files: fileStats, main: { usage: result.main.usage, dispatch_count: agentCalls.length,
    prompt_words: result.main.dispatch_prompt_words, rate_limits: result.main.rate_limit_events },
  child_logs: agentSummaries.length }, null, 2));
