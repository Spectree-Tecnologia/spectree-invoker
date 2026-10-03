import { launch } from './launch.mjs';
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
export function runAgent(root, packet, config = {}) {
  const timeout = config.timeout_seconds ?? 300;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 1800) refuse('E_AGENT_CONFIG', 'Timeout must be 1..1800 seconds.');
  let command;
  if (config.kind === 'codex') {
    command = [config.executable ?? 'codex', 'exec', '--json', '--ephemeral', '--sandbox', config.read_only ? 'read-only' : 'workspace-write', '-C', root];
    if (config.model) command.push('--model', config.model);
    command.push('-');
  } else if (config.kind === 'bridge' && Array.isArray(config.command) && config.command.length && config.command.every((a) => typeof a === 'string' && a.length)) {
    command = config.command;
  } else refuse('E_AGENT_CONFIG', 'Select codex or an explicit trusted bridge command array.');
  const start = performance.now();
  const result = launch(command, { cwd: root, input: JSON.stringify(packet), encoding: 'utf8', timeout: timeout * 1000,
    maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  const stdout = result.stdout ?? ''; const stderr = result.stderr ?? '';
  let parsed;
  if (config.kind === 'codex') parsed = codexEvents(stdout, result);
  else {
    let envelope;
    try { envelope = JSON.parse(stdout); } catch { /* unknown, never successful */ }
    parsed = { status: result.error || result.signal ? 'interrupted' : result.status !== 0 ? 'failed' : outcome(envelope), envelope };
  }
  return { ...parsed, command, elapsed_ms: Math.round(performance.now() - start), exit_code: result.status,
    error: result.error?.code ?? null, stdout, stderr };
}
