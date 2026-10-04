import { supervisedLaunch } from './process-supervisor.mjs';
import { outcome, refuse } from './work.mjs';

export function codexEvents(stdout, result) {
  let events;
  try { events = stdout.split(/\r?\n/).filter((s) => s.trim()).map((s) => JSON.parse(s)); }
  catch { return { status: 'unknown', reason: 'Malformed JSONL from Codex.' }; }
  const failed = events.find((e) => e.type === 'turn.failed' || e.type === 'error');
  const completed = events.filter((e) => e.type === 'turn.completed');
  const messages = events.filter((e) => e.type === 'item.completed' && e.item?.type === 'agent_message').map((e) => e.item.text);
  const limit = /rate.?limit|quota|session limit|usage limit/i.test(JSON.stringify(failed ?? {}) + messages.join('\n'));
  const status = result.error || result.signal || limit ? 'interrupted' : failed || result.status !== 0 ? 'failed'
    : completed.length ? 'reported_success' : 'unknown';
  return { status, events, messages, usage: completed.at(-1)?.usage ?? null };
}
export function claudeEvents(stdout, result) {
  let events;
  try { events = stdout.split(/\r?\n/).filter((s) => s.trim()).map((s) => JSON.parse(s)); }
  catch { return { status: 'unknown', reason: 'Malformed JSONL from Claude Code.' }; }
  const terminal = events.filter((e) => e.type === 'result');
  const last = terminal.at(-1);
  const limit = /rate.?limit|quota|usage limit|session limit/i.test(JSON.stringify(last?.errors ?? []) + (last?.result ?? ''));
  const failed = events.some((e) => e.type === 'error') || last?.is_error || (last?.permission_denials?.length ?? 0) > 0;
  const status = result.error || result.signal || limit ? 'interrupted' : result.status !== 0 || failed ? 'failed'
    : terminal.length === 1 && events.at(-1) === last && last.subtype === 'success' && last.is_error === false ? 'reported_success' : 'unknown';
  return { status, events, messages: last?.result ? [last.result] : [], usage: last?.usage ?? null,
    model_usage: last?.modelUsage ?? null, cost_usd: last?.total_cost_usd ?? null };
}
export function agentCommand(root, config) {
  const timeout = config.timeout_seconds ?? 300;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 1800) refuse('E_AGENT_CONFIG', 'Timeout must be 1..1800 seconds.');
  if (config.kind === 'codex') {
    const command = [config.executable ?? 'codex', 'exec', '--json', '--ephemeral', '--sandbox', config.read_only ? 'read-only' : 'workspace-write', '-C', root];
    if (config.model) command.push('--model', config.model);
    return [...command, '-'];
  }
  if (config.kind === 'claude-code') {
    const allowed = config.allowed_tools ?? (config.read_only ? ['Read', 'Glob', 'Grep'] : ['Read', 'Glob', 'Grep', 'Edit', 'Write']);
    if (!Array.isArray(allowed) || !allowed.length || allowed.some((s) => !['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash'].includes(s)) ||
        (config.read_only && allowed.some((s) => !['Read', 'Glob', 'Grep'].includes(s)))) refuse('E_AGENT_CONFIG', 'Invalid Claude tool allowlist.');
    const command = [config.executable ?? 'claude', '-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence',
      '--safe-mode', '--permission-mode', 'dontAsk', '--tools', allowed.join(','), '--allowedTools', allowed.join(',')];
    if (config.model) command.push('--model', config.model);
    return command;
  }
  if (config.kind === 'bridge' && Array.isArray(config.command) && config.command.length && config.command.every((a) => typeof a === 'string' && a.length)) return config.command;
  refuse('E_AGENT_CONFIG', 'Select codex, claude-code or an explicit trusted bridge command array.');
}
export function runAgent(root, packet, config = {}) {
  const timeout = config.timeout_seconds ?? 300;
  const command = agentCommand(root, config);
  const start = performance.now();
  const result = supervisedLaunch(command, { cwd: root, input: JSON.stringify(packet), process_ref: config.process_ref, encoding: 'utf8', timeout: timeout * 1000,
    maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  const stdout = result.stdout ?? ''; const stderr = result.stderr ?? '';
  let parsed;
  if (config.kind === 'codex') parsed = codexEvents(stdout, result);
  else if (config.kind === 'claude-code') parsed = claudeEvents(stdout, result);
  else {
    let envelope;
    try { envelope = JSON.parse(stdout); } catch { /* unknown, never successful */ }
    parsed = { status: result.error || result.signal ? 'interrupted' : result.status !== 0 ? 'failed' : outcome(envelope), envelope };
  }
  return { ...parsed, command, elapsed_ms: Math.round(performance.now() - start), exit_code: result.status,
    error: result.error?.code ?? null, process: result.process, stdout, stderr };
}
