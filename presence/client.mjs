// Snapshots replace the complete projection; a skipped revision never loses text.
export function createPresenceClient({ token, onUpdate, fetcher = fetch, intervalMs = 500 }) {
  let current, timer, disposed = false, polling = false, online = false;
  const controllers = new Set();
  function accept(value) {
    if (value?.version !== 1 || value.origin !== 'codex' || typeof value.sessionId !== 'string' ||
      !Number.isSafeInteger(value.revision) || !Array.isArray(value.messages) || value.speaker !== null) throw new Error('E_PROTOCOL');
    if (current && value.revision < current.revision) return;
    current = value; online = true; onUpdate({ snapshot: current, online });
  }
  async function request(path, body, keepalive = false) {
    const controller = new AbortController(); controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), body ? 35000 : 10000);
    try {
      const response = await fetcher(`/presence/api/${path}`, { method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal, keepalive });
      const value = await response.json(); if (!response.ok) throw Object.assign(new Error(value.error ?? 'E_HTTP'), { answered: true });
      return value;
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  }
  async function poll() {
    if (disposed || polling) return;
    polling = true;
    try { const value = await request('snapshot'); if (!disposed) accept(value); }
    catch { if (!disposed) { online = false; onUpdate({ snapshot: current, online, error: 'E_CONTACT_LOST' }); } }
    finally { polling = false; if (!disposed && online) timer = setTimeout(poll, intervalMs); }
  }
  return {
    refresh() { clearTimeout(timer); return poll(); },
    async action(action, text) {
      if (disposed || !current || !online) throw new Error('E_NOT_READY');
      const body = { action, sessionId: current.sessionId, requestId: crypto.randomUUID(), ...(text === undefined ? {} : { text }) };
      // Never retry a mutation: a lost response does not prove the command was unreceived.
      try { const value = await request('action', body); if (!disposed) accept(value); return value; }
      catch (error) {
        if (!disposed && !error.answered) {
          online = false; clearTimeout(timer);
          onUpdate({ snapshot: current, online, error: 'E_ACTION_UNKNOWN' });
        }
        throw error;
      }
    },
    dispose() {
      if (disposed) return; disposed = true; clearTimeout(timer);
      for (const controller of controllers) controller.abort();
      if (current && !['disconnected', 'error'].includes(current.status)) {
        void fetcher('/presence/api/action', { method: 'POST', keepalive: true,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'disconnect', sessionId: current.sessionId, requestId: crypto.randomUUID() }),
        }).catch(() => {});
      }
    },
  };
}
