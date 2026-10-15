import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { presenceAssets } from './console-server.mjs';
import { createPresenceSession } from './presence-session.mjs';

export async function startPresence({ port = 0, session = createPresenceSession() } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Porta inválida.');
  const files = presenceAssets(true), token = randomBytes(32).toString('hex'), requests = new Map();
  let origin;
  const server = createServer(async (req, res) => {
    const send = (code, data, type = 'application/json; charset=utf-8') => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
        'Permissions-Policy': 'microphone=(), camera=()',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; media-src 'self'" });
      res.end(typeof data === 'object' && !Buffer.isBuffer(data) ? JSON.stringify(data) : data);
    };
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) ||
      (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) return send(403, { error: 'E_ORIGIN' });
    if (req.method === 'GET' && files.has(req.url)) { const file = files.get(req.url); return send(200, file.body, file.type); }
    if (!['/presence/api/snapshot', '/presence/api/action'].includes(req.url)) return send(404, { error: 'E_NOT_FOUND' });
    const credential = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${token}`);
    if (credential.length !== expected.length || !timingSafeEqual(credential, expected)) return send(401, { error: 'E_SESSION' });
    if (req.method === 'GET' && req.url === '/presence/api/snapshot') { session.touch(); return send(200, session.snapshot()); }
    if (req.method !== 'POST' || req.url !== '/presence/api/action') return send(405, { error: 'E_METHOD' });
    if (req.headers.origin !== origin) return send(403, { error: 'E_ORIGIN' });
    if (req.headers['content-type'] !== 'application/json') return send(415, { error: 'E_CONTENT_TYPE' });
    try {
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 40000) return send(413, { error: 'E_BODY_LIMIT' }); chunks.push(chunk); }
      // Buffer decoding preserves UTF-8 across arbitrary transport chunks.
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!input || Array.isArray(input) || Object.keys(input).some(k => !['action', 'sessionId', 'requestId', 'text'].includes(k)) ||
        !['connect', 'send', 'interrupt', 'disconnect'].includes(input.action) ||
        typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(input.requestId) ||
        typeof input.sessionId !== 'string' || input.action !== 'send' && input.text !== undefined ||
        input.action === 'send' && (typeof input.text !== 'string' || input.text.length > 8000 || !input.text.trim())) return send(400, { error: 'E_INPUT' });
      const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const prior = requests.get(input.requestId);
      if (prior) {
        if (prior.digest !== digest) return send(409, { error: 'E_REQUEST_CONFLICT' });
        const result = await prior.result; return send(result.code, result.code === 200 ? session.snapshot() : result.body);
      }
      if (input.sessionId !== session.snapshot().sessionId) return send(409, { error: 'E_STALE_SESSION' });
      if (requests.size >= 256) return send(429, { error: 'E_REQUEST_LIMIT' });
      session.touch();
      const result = (async () => {
        try {
          await (input.action === 'connect' ? session.connect() :
            input.action === 'send' ? await session.send(input.sessionId, input.text) :
            input.action === 'interrupt' ? await session.interrupt(input.sessionId) : session.disconnect(input.sessionId));
          // Remember the operation outcome, not a second copy of private conversation text.
          return { code: 200 };
        } catch (e) { return { code: 409, body: { error: /^E_[A-Z_]+$/.test(e.code ?? '') ? e.code : 'E_ACTION' } }; }
      })();
      requests.set(input.requestId, { digest, result }); const response = await result;
      send(response.code, response.code === 200 ? session.snapshot() : response.body);
    } catch { if (!res.writableEnded) send(400, { error: 'E_INPUT' }); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  server.on('close', () => session.close());
  try { await new Promise((ok, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', ok); }); }
  catch (e) { session.close(); throw e; }
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, session, origin, token, url: `${origin}/presence/#session=${token}` };
}
