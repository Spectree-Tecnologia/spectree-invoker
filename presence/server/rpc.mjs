import { spawn } from 'node:child_process';
import { launchSpec } from '../../scripts/lib/launch.mjs';

export const rpcError = code => Object.assign(new Error(code), { code });

// Private stdio transport: no raw stderr, account payloads or RPC errors leave it.
export function createCodexRpc({ cwd, executable, onNotification = () => {}, onFailure = () => {},
  spawnProcess = spawn, timeoutMs = 30000, environment = process.env } = {}) {
  // An ordinary terminal may not inherit the desktop app's private CLI PATH.
  // This server-side setting is a filename, never a shell command or browser input.
  executable ??= environment.SPECTREE_CODEX_EXECUTABLE?.trim() || 'codex';
  const overrides = ['web_search=disabled', 'mcp_servers={}', 'hooks={}', 'notify=[]',
    ...['shell_tool', 'apps', 'plugins', 'memories', 'multi_agent', 'browser_use', 'computer_use',
      'request_permissions_tool', 'shell_snapshot'].map(key => `features.${key}=false`)];
  const spec = launchSpec([executable, 'app-server', '--listen', 'stdio://', ...overrides.flatMap(v => ['-c', v])],
    { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      // The audio API credential belongs only to the audio adapter, never the harness.
      env: Object.fromEntries(Object.entries(environment).filter(([key]) => key.toUpperCase() !== 'OPENAI_API_KEY')) });
  const child = spawnProcess(spec.file, spec.args, spec.options);
  const pending = new Map(); let sequence = 0, buffer = '', closed = false;
  const close = (code = 'E_CLOSED', notify = false) => {
    if (closed) return; closed = true;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(rpcError(code)); }
    pending.clear(); child.stdin.destroy(); child.kill();
    if (notify) onFailure(code);
  };
  const write = message => {
    if (closed) throw rpcError('E_CLOSED');
    child.stdin.write(JSON.stringify(message) + '\n');
  };
  child.stdin.on('error', () => close('E_TRANSPORT', true));
  child.on('error', () => close('E_CODEX_UNAVAILABLE', true));
  child.on('exit', () => close('E_CODEX_EXIT', true));
  child.stderr.on('data', () => {}); // Drain; never expose possibly sensitive diagnostic text.
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    if (closed) return;
    buffer += chunk;
    if (buffer.length > 2 * 1024 * 1024) return close('E_PROTOCOL_LIMIT', true);
    let end;
    while (!closed && (end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        if (!message || typeof message !== 'object') throw rpcError('E_PROTOCOL');
        if (message.method && Object.hasOwn(message, 'id')) {
          // P2 has no approval UI and grants no permission to tools, logins or elicitation.
          write({ id: message.id, error: { code: -32601, message: 'Unsupported in Presence P2' } });
          close('E_APPROVAL_UNSUPPORTED', true);
        } else if (Object.hasOwn(message, 'id')) {
          const request = pending.get(message.id); if (!request) continue;
          pending.delete(message.id); clearTimeout(request.timer);
          if (message.error) request.reject(Object.assign(rpcError('E_CODEX_REQUEST'), { method: request.method, rpcCode: message.error.code }));
          else if (Object.hasOwn(message, 'result')) request.resolve(message.result);
          else { request.reject(rpcError('E_PROTOCOL')); throw rpcError('E_PROTOCOL'); }
        } else if (typeof message.method === 'string') onNotification(message.method, message.params ?? {});
        else throw rpcError('E_PROTOCOL');
      } catch { close('E_PROTOCOL', true); }
    }
  });
  return {
    request(method, params = {}) {
      if (closed) return Promise.reject(rpcError('E_CLOSED'));
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => close('E_CODEX_TIMEOUT', true), timeoutMs);
        pending.set(id, { resolve, reject, timer, method });
        try { write({ id, method, params }); } catch { close('E_TRANSPORT', true); }
      });
    }, notify(method, params = {}) { write({ method, params }); }, close,
  };
}
