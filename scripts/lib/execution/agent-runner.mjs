import { supervisedLaunch, refuse, inside, resolveOnPath, launchSpec, writeOnce } from '../shared/index.mjs';
import { outcome } from '../change/index.mjs';
import { accessSync, constants, statSync } from 'node:fs';
import { resolve, delimiter, basename } from 'node:path';

export function preflightAgent(root, config) {
  const command = agentCommand(root, config);
  const candidates = process.platform === 'win32' ? [resolveOnPath(command[0], { cwd: root })]
    : /[\\/]/.test(command[0]) ? [resolve(root, command[0])]
      : (process.env.PATH ?? '').split(delimiter).map(p => resolve(root, p, command[0]));
  const executable = candidates.find(p => {
    if (!p) return false;
    try { accessSync(p, constants.X_OK); return statSync(p).isFile(); } catch { return false; }
  });
  if (!executable) refuse('E_AGENT_PREREQUISITE', 'Agent launcher is missing or not executable; no attempt was consumed.');
  // A direct Node bridge entrypoint is observable without executing its code.
  if (config.kind === 'bridge' && /^node(?:\.exe)?$/i.test(basename(executable)) && command[1] && !command[1].startsWith('-')) {
    let present = false;
    try { present = statSync(resolve(root, command[1])).isFile(); } catch { /* missing entrypoint */ }
    if (!present) refuse('E_AGENT_PREREQUISITE', 'Node bridge entrypoint is missing; no attempt was consumed.');
  }
  launchSpec(command, { cwd: root }); // Refuse untransportable Windows shim arguments too.
  return { ok: true, executable, command, checks: ['launcher_available', 'arguments_transportable'],
    authentication: 'unverified', quota: 'unverified', nested_tools: 'unverified', authorizes_execution: false };
}

function jsonEvents(stdout) {
  const events = stdout.split(/\r?\n/).filter(s => s.trim()).map(s => JSON.parse(s));
  if (events.some(e => !e || Array.isArray(e) || typeof e !== 'object' || typeof e.type !== 'string')) throw Error('Invalid event shape.');
  return events;
}
function unreadableEvents(result, harness) {
  const interrupted = Boolean(result.error || result.signal);
  return { status: interrupted ? 'interrupted' : 'unknown',
    classification: interrupted ? classification(result, '', 'interrupted') : 'protocol_error',
    reason: `Malformed JSONL from ${harness}.` };
}

const LIMIT = /rate.?limit|quota|session limit|usage limit/i;
const isMission = (doc) => doc?.spectree_result === 1 && ['completed', 'blocked', 'failed', 'interrupted'].includes(doc.status) &&
  typeof doc.reason === 'string' && doc.reason.trim();
/**
 * The structured claim is the object that ends the final message. Prose before it, or a code fence
 * around it, is narration: it neither hides the claim nor gets read as one.
 */
function missionResult(messages) {
  const text = String(messages.at(-1) ?? '').trim().replace(/\n?```\s*$/, '').trimEnd();
  if (!text.endsWith('}')) return null;
  // A claim is a flat object with a few fields; a bound on the openings tried keeps a deeply nested
  // message from costing a parse per brace.
  for (let i = text.lastIndexOf('{'), tries = 0; i >= 0 && tries < 64; i = text.lastIndexOf('{', i - 1), tries++) {
    try { const doc = JSON.parse(text.slice(i)); return isMission(doc) ? doc : null; }
    catch { /* Not the start of the trailing object yet. */ }
    if (i === 0) break;
  }
  return null;
}
/**
 * What may say "quota": the harness's own failure records, the reason of a claim the agent itself
 * marked interrupted, and prose only where no claim was made. Never tool output, never the reason of
 * a completed, failed or blocked claim: a task about rate limits names them while it works.
 */
function limitText(failures, mission, finalText) {
  return JSON.stringify(failures) + (mission ? mission.status === 'interrupted' ? mission.reason : '' : finalText ?? '');
}
function classification(result, text, status, mission = null, limits = text) {
  if (!['reported_success', 'turn_completed'].includes(status) && LIMIT.test(limits)) return 'quota';
  if (result.error?.code === 'ETIMEDOUT' || /"(?:error|status)":"(?:timeout|timed_out)"/.test(text)) return 'timeout';
  if (result.signal) return 'interruption';
  if (/helper_unknown_error|trusted tool process.*died|tool_unavailable/.test(text)) return 'tool_unavailable';
  if (result.error) return 'infrastructure';
  if (mission?.status === 'blocked') return 'blocked';
  return status === 'turn_completed' ? 'transport_completed' : status === 'reported_success' ? 'delivery_reported'
    : status === 'unknown' ? 'unknown' : status === 'interrupted' ? 'interruption' : 'agent_failure';
}

export function codexEvents(stdout, result) {
  let events;
  try { events = jsonEvents(stdout); }
  catch { return unreadableEvents(result, 'Codex'); }
  const failed = events.find((e) => e.type === 'turn.failed' || e.type === 'error');
  const completed = events.filter((e) => e.type === 'turn.completed');
  const messages = events.filter((e) => e.type === 'item.completed' && e.item?.type === 'agent_message').map((e) => e.item.text);
  // Successful tool output can quote this protocol (including words like quota).
  // Classify only failure observations and the final agent message, not source text.
  const errors = events.filter(e => e.type === 'error' || e.type === 'turn.failed' || e.item?.error ||
    e.item?.status === 'failed' || (Number.isInteger(e.item?.exit_code) && e.item.exit_code !== 0));
  const mission = missionResult(messages);
  const failureText = JSON.stringify(errors) + (mission?.status === 'completed' ? '' : messages.at(-1) ?? '');
  // A failed command is the agent's work (a red test may be named "rate limit"), not the harness's.
  const limits = limitText(events.filter(e => e.type === 'error' || e.type === 'turn.failed'), mission, messages.at(-1));
  const limit = LIMIT.test(limits);
  let status = result.error || result.signal || limit ? 'interrupted' : failed || result.status !== 0 ? 'failed'
    : completed.length === 1 && events.at(-1)?.type === 'turn.completed' ? 'turn_completed' : 'unknown';
  const kind = classification(result, failureText, status, mission, limits);
  if (['quota', 'timeout'].includes(kind)) status = 'interrupted';
  if (kind === 'tool_unavailable') status = 'failed';
  if (status === 'turn_completed' && mission) status = mission.status === 'completed' ? 'reported_success'
    : mission.status === 'interrupted' ? 'interrupted' : 'failed';
  return { status, classification: classification(result, failureText, status, mission, limits), mission,
    events, messages, usage: completed.at(-1)?.usage ?? null };
}
export function claudeEvents(stdout, result) {
  let events;
  try { events = jsonEvents(stdout); }
  catch { return unreadableEvents(result, 'Claude Code'); }
  const terminal = events.filter((e) => e.type === 'result');
  const last = terminal.at(-1);
  const mission = missionResult(last?.result ? [last.result] : []);
  const errors = events.filter(e => e.type === 'error');
  const failureText = JSON.stringify([errors, last?.errors ?? [], last?.permission_denials ?? []]) +
    (mission?.status === 'completed' ? '' : last?.result ?? '');
  // A denied tool call quotes its input, which can name anything; it fails the run, it is no quota.
  const limits = limitText([errors, last?.errors ?? []], mission, last?.result);
  const limit = LIMIT.test(limits);
  const failed = errors.length > 0 || last?.is_error || (last?.permission_denials?.length ?? 0) > 0;
  // Claude Code 2.1.302 emits system events (task_summary) after the result;
  // any other event after it still leaves the run unknown.
  const settled = events.slice(events.indexOf(last) + 1).every((e) => e.type === 'system');
  const status = result.error || result.signal || limit ? 'interrupted' : result.status !== 0 || failed ? 'failed'
    : terminal.length === 1 && settled && last.subtype === 'success' && last.is_error === false ? 'reported_success' : 'unknown';
  let finalStatus = status === 'reported_success' && mission && mission.status !== 'completed'
    ? mission.status === 'interrupted' ? 'interrupted' : 'failed' : status;
  const kind = classification(result, failureText, finalStatus, mission, limits);
  if (kind === 'tool_unavailable' && finalStatus === 'reported_success') finalStatus = 'failed';
  return { status: finalStatus, classification: kind, mission,
    events, messages: last?.result ? [last.result] : [], usage: last?.usage ?? null,
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
    const observed = outcome(envelope);
    let status = result.error || result.signal || observed === 'interrupted' ? 'interrupted' : result.status !== 0 ? 'failed' : observed;
    const kind = classification(result, JSON.stringify(envelope), status);
    if (['quota', 'timeout'].includes(kind)) status = 'interrupted';
    parsed = { status, classification: kind, envelope };
  }
  const observation = { ...parsed, command, elapsed_ms: Math.round(performance.now() - start), exit_code: result.status,
    error: result.error?.code ?? null, process: result.process, stdout, stderr };
  // Persist the transport observation before any acceptance checks or caller code.
  // After a crash it is inspectable; it never authorizes replay or completion.
  if (result.process?.ref) writeOnce(inside(root, `${result.process.ref}/agent-result.json`), JSON.stringify(observation) + '\n');
  return observation;
}
