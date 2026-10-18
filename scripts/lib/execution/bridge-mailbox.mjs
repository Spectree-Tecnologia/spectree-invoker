// Durable handoff for trusted local integrations. This is a mailbox, not an
// agent scheduler or a process boundary for agents launched by another harness.
import { readFileSync, writeFileSync, mkdirSync, linkSync, unlinkSync, existsSync, lstatSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { identifier, bounded, references } from '../change/index.mjs';
import { inside, refuse } from '../shared/index.mjs';
import { hash } from './context.mjs';

const path = (root, id, name) => inside(root, `.spectree/bridge-mailbox/${identifier(id)}/${name}.json`);
function read(file) {
  if (!lstatSync(file).isFile() || lstatSync(file).size > 1024 * 1024) refuse('E_BRIDGE_RECORD', 'Mailbox record exceeds limits or is not a regular file.');
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { refuse('E_BRIDGE_RECORD', 'Incomplete mailbox record.'); }
}
function publish(file, doc) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(doc) + '\n', { flag: 'wx' });
  // Publish complete bytes without replacing an existing terminal observation.
  try { linkSync(temp, file); }
  catch (e) { if (e.code === 'EEXIST') refuse('E_BRIDGE_CONFLICT', 'A record already exists; inspect it instead of replacing it.'); throw e; }
  finally { unlinkSync(temp); }
}
export function createBridgeRequest(root, packet, timeoutSeconds = 240) {
  identifier(packet?.dispatch_id);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 1700) refuse('E_BRIDGE_TIMEOUT', 'Mailbox deadline must be 1..1700 seconds and shorter than the runner timeout.');
  if (Buffer.byteLength(JSON.stringify(packet)) > 900 * 1024) refuse('E_BRIDGE_RECORD', 'Packet exceeds mailbox budget.');
  const request = { version: 1, request_id: packet.dispatch_id, packet, packet_digest: hash(packet),
    created_at: new Date().toISOString(), deadline: new Date(Date.now() + timeoutSeconds * 1000).toISOString(),
    authorizes_execution: false, external_processes: 'not_supervised_by_mailbox' };
  publish(path(root, request.request_id, 'request'), request);
  return request;
}
export function inspectBridgeRequest(root, id) {
  const request = read(path(root, id, 'request'));
  if (request.version !== 1 || request.request_id !== id || request.packet?.dispatch_id !== id ||
      hash(request.packet) !== request.packet_digest || !Number.isFinite(Date.parse(request.deadline))) refuse('E_BRIDGE_RECORD', 'Request identity or packet changed.');
  const terminalPath = path(root, id, 'terminal');
  const terminal = existsSync(terminalPath) ? read(terminalPath) : null;
  if (terminal) {
    if (terminal.version !== 1 || terminal.request_id !== id || terminal.packet_digest !== request.packet_digest ||
        !['completed', 'failed', 'interrupted'].includes(terminal.status) || terminal.source !== 'agent_final' ||
        !Number.isFinite(Date.parse(terminal.observed_at)) || !terminal.refs?.length ||
        hash(references(root, terminal.refs.map(r => r.path))) !== hash(terminal.refs)) refuse('E_BRIDGE_RECORD', 'Terminal identity or source evidence changed.');
    bounded(terminal.agent_id, 'agent identity'); bounded(terminal.summary, 'terminal summary');
  }
  const late = terminal ? Date.parse(terminal.observed_at) > Date.parse(request.deadline) : false;
  return { request, terminal, late, state: terminal ? late ? 'late' : 'received' : Date.now() > Date.parse(request.deadline) ? 'expired' : 'waiting', authorizes_execution: false };
}
export function publishBridgeResult(root, id, result) {
  const { request, terminal } = inspectBridgeRequest(root, id);
  if (terminal) refuse('E_BRIDGE_CONFLICT', 'A terminal result already exists.');
  if (result.request_id !== id || result.packet_digest !== request.packet_digest || result.source !== 'agent_final' ||
      !['completed', 'failed', 'interrupted'].includes(result.status) || !result.refs?.length) refuse('E_BRIDGE_RESULT', 'Bind the actual agent final result to the request and packet, with source evidence.');
  bounded(result.agent_id, 'agent identity'); bounded(result.summary, 'terminal summary');
  if (result.error != null) bounded(result.error, 'terminal error code', 80);
  const observation = { version: 1, request_id: id, packet_digest: request.packet_digest, source: 'agent_final',
    agent_id: result.agent_id, status: result.status, summary: result.summary, error: result.error ?? null,
    refs: references(root, result.refs), observed_at: new Date().toISOString(), authorizes_execution: false };
  publish(path(root, id, 'terminal'), observation);
  return inspectBridgeRequest(root, id);
}
export async function waitBridgeResult(root, id) {
  while (true) {
    const observed = inspectBridgeRequest(root, id);
    if (observed.state === 'received') return { ...observed.terminal, content: observed.terminal.summary };
    if (['late', 'expired'].includes(observed.state)) return { status: 'interrupted', error: 'timeout', request_id: id,
      summary: 'Mailbox deadline expired. Inspect external agent state and reconcile; do not replay.' };
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
