import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodexRpc, rpcError } from './presence-rpc.mjs';

const busy = new Set(['connecting', 'running', 'interrupting']);
const terminal = new Set(['completed', 'interrupted', 'failed']);
const instructions = `Você é o Invoker do Spectree, numa sessão conversacional P2.
Converse em português, com clareza. Ajude a formular intenção, especificações e critérios
de aceite. Esta sessão não executa trabalho no runtime: não há acesso a ambientes,
ferramentas, arquivos, voz ou especialistas. Não afirme ter executado ações, aprovado
gates ou delegado trabalho. Explique esses limites quando relevante. Não exponha
raciocínio interno. Não transforme texto ou animação em evidência de execução.`;

export function createPresenceSession({ rpcFactory = createCodexRpc, now = Date.now,
  leaseMs = 45000, turnTimeoutMs = 180000, executable, voice = false } = {}) {
  let rpc, threadId, cwd, generation = 0, active, deadline, lastSeen = now();
  let revision = 0, id = randomUUID(), status = 'disconnected', error = null, model = null;
  let messages = [], sequence = 0;
  const seenTurns = new Set();
  const publish = () => { revision++; };
  const snapshot = () => ({ version: 1, origin: 'codex', sessionId: id, revision, status, error,
    model, speaker: null, canInterrupt: status === 'running' && !!active?.turnId, messages: messages.map(m => ({ ...m })) });
  function release() {
    generation++; clearTimeout(deadline); deadline = undefined; active = undefined;
    const old = rpc; rpc = undefined; threadId = undefined; old?.close();
    // Only remove the empty directory created by mkdtemp; never recurse into any path.
    if (cwd) { try { rmdirSync(cwd); } catch {} cwd = undefined; }
  }
  function fail(code) { release(); status = 'error'; error = code; publish(); }
  function notification(method, params, epoch) {
    if (epoch !== generation || !threadId || params.threadId !== threadId || !active) return;
    if (method === 'turn/started') {
      const turnId = params.turn?.id;
      if (typeof turnId !== 'string' || seenTurns.has(turnId)) return;
      if (active.turnId && active.turnId !== turnId) return fail('E_TURN_ID');
      active.turnId = turnId; publish(); return;
    }
    const turnId = method === 'turn/completed' ? params.turn?.id : params.turnId;
    if (!active.turnId || turnId !== active.turnId || seenTurns.has(turnId)) return;
    if (method === 'item/agentMessage/delta' || (method === 'item/completed' && params.item?.type === 'agentMessage')) {
      const itemId = params.itemId ?? params.item?.id;
      const text = method === 'item/completed' ? params.item.text : params.delta;
      if (typeof itemId !== 'string' || itemId.length > 256 || typeof text !== 'string') return fail('E_PROTOCOL');
      let message = messages.find(m => m.turnId === turnId && m.id === itemId && m.role === 'assistant');
      const nextText = method === 'item/completed' ? text : (message?.text ?? '') + text;
      if (nextText.length > 32000 || (!message && messages.length >= 100) ||
        messages.reduce((n, m) => n + m.text.length, 0) - (message?.text.length ?? 0) + nextText.length > 200000) return fail('E_HISTORY_LIMIT');
      if (!message) { message = { id: itemId, turnId, role: 'assistant', text: '' }; messages.push(message); }
      message.text = nextText;
      publish();
    } else if (method === 'item/started' && !['agentMessage', 'userMessage', 'reasoning'].includes(params.item?.type)) {
      fail('E_TOOL_UNSUPPORTED');
    } else if (method === 'turn/completed') {
      if (!terminal.has(params.turn.status)) return fail('E_PROTOCOL');
      if (params.turn.status === 'failed') return fail('E_TURN_FAILED');
      seenTurns.add(turnId); active = undefined; clearTimeout(deadline);
      status = params.turn.status; error = null; publish();
    }
    // Raw reasoning, tool arguments, account info and unrelated notifications are never projected.
  }
  const lease = setInterval(() => {
    if (rpc && now() - lastSeen > leaseMs) fail('E_CONTACT_LOST');
  }, Math.min(5000, leaseMs)); lease.unref();
  return {
    snapshot() { return snapshot(); },
    touch() { lastSeen = now(); },
    async connect() {
      if (busy.has(status) || rpc) throw rpcError('E_BUSY');
      release(); id = randomUUID(); messages = []; seenTurns.clear(); model = null; sequence = 0;
      status = 'connecting'; error = null; lastSeen = now(); publish();
      const epoch = generation;
      try {
        cwd = mkdtempSync(join(tmpdir(), 'spectree-presence-'));
        rpc = rpcFactory({ cwd, executable, onNotification: (m, p) => notification(m, p, epoch),
          onFailure: code => { if (epoch === generation) fail(code); } });
        const current = rpc;
        await current.request('initialize', { clientInfo: { name: 'spectree_presence', title: 'Spectree Presence', version: '1.15.0' },
          capabilities: { experimentalApi: true } });
        current.notify('initialized');
        const account = await current.request('account/read', { refreshToken: false });
        if (account.account?.type !== 'chatgpt') throw rpcError('E_CHATGPT_LOGIN');
        const { config } = await current.request('config/read', { includeLayers: false });
        if (!config || Object.values(config.hooks ?? {}).some(v => Array.isArray(v) && v.length)) throw rpcError('E_HOOKS_UNSUPPORTED');
        for (const feature of ['shell_tool', 'apps', 'plugins', 'multi_agent']) {
          if (config.features?.[feature] !== false) throw rpcError('E_CONFIGURATION');
        }
        const mcpNames = Object.keys(config.mcp_servers ?? {});
        if (mcpNames.some(name => !/^[a-zA-Z0-9_-]+$/.test(name))) throw rpcError('E_CONFIGURATION');
        const mcp = Object.fromEntries(mcpNames.map(name => [`mcp_servers.${name}.enabled`, false]));
        const result = await current.request('thread/start', { cwd, ephemeral: true, sandbox: 'read-only',
          approvalPolicy: 'never', approvalsReviewer: 'user', environments: [], selectedCapabilityRoots: [],
          modelProvider: 'openai', config: mcp, developerInstructions: voice ? instructions.replace('arquivos, voz ou especialistas', 'arquivos ou especialistas') +
            '\nA interface pode transcrever e sintetizar áudio por um serviço separado. Responda de forma conversacional e breve, preferindo até três frases; amplie quando o usuário pedir. Não alegue ouvir emoção: você recebe somente a transcrição textual.' : instructions });
        if (epoch !== generation) throw rpcError('E_STALE_SESSION');
        if (!result.thread?.id || result.thread.ephemeral !== true || !Array.isArray(result.thread.environments) || result.thread.environments.length ||
          result.approvalPolicy !== 'never' || result.approvalsReviewer !== 'user' || result.cwd !== cwd ||
          result.sandbox?.type !== 'readOnly' || result.sandbox.networkAccess || result.modelProvider !== 'openai') throw rpcError('E_CONFIGURATION');
        threadId = result.thread.id; model = result.model; status = 'ready'; publish(); return snapshot();
      } catch (e) { if (epoch === generation) fail(e.code ?? 'E_CONNECT'); throw rpcError(e.code ?? 'E_CONNECT'); }
    },
    async send(sessionId, text) {
      if (sessionId !== id) throw rpcError('E_STALE_SESSION');
      if (!rpc || busy.has(status)) throw rpcError('E_NOT_READY');
      if (typeof text !== 'string' || !text.trim() || text.length > 8000) throw rpcError('E_INPUT');
      if (messages.length >= 98 || sequence >= 40 || messages.reduce((n, m) => n + m.text.length, 0) + text.trim().length > 200000) throw rpcError('E_HISTORY_LIMIT');
      status = 'running'; error = null; active = { turnId: null }; const turn = active, epoch = generation, current = rpc;
      messages.push({ id: `user-${++sequence}`, role: 'user', text: text.trim() }); publish();
      deadline = setTimeout(() => { if (epoch === generation && active === turn) fail('E_TURN_TIMEOUT'); }, turnTimeoutMs);
      try {
        const result = await current.request('turn/start', { threadId, input: [{ type: 'text', text: text.trim() }] });
        if (epoch !== generation) throw rpcError('E_STALE_SESSION');
        if (active === turn) {
          if (!result.turn?.id || (turn.turnId && turn.turnId !== result.turn.id)) throw rpcError('E_TURN_ID');
          turn.turnId = result.turn.id; publish();
        }
        return snapshot();
      } catch (e) { if (epoch === generation) fail(e.code ?? 'E_SEND'); throw rpcError(e.code ?? 'E_SEND'); }
    },
    async interrupt(sessionId) {
      if (sessionId !== id) throw rpcError('E_STALE_SESSION');
      if (!rpc || !active?.turnId || status !== 'running') throw rpcError('E_NOT_RUNNING');
      const epoch = generation, turn = active; status = 'interrupting'; publish();
      clearTimeout(deadline);
      deadline = setTimeout(() => { if (epoch === generation && active === turn) fail('E_INTERRUPT_TIMEOUT'); }, 10000);
      try { await rpc.request('turn/interrupt', { threadId, turnId: active.turnId }); return snapshot(); }
      catch (e) { if (epoch === generation) fail(e.code ?? 'E_INTERRUPT'); throw rpcError(e.code ?? 'E_INTERRUPT'); }
    },
    disconnect(sessionId) {
      if (sessionId !== id) throw rpcError('E_STALE_SESSION');
      release(); status = 'disconnected'; error = null; messages = []; model = null; publish(); return snapshot();
    },
    close() { clearInterval(lease); release(); status = 'disconnected'; messages = []; publish(); },
  };
}
