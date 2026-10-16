import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { presenceAssets } from './console-server.mjs';
import { createPresenceSession } from './presence-session.mjs';
import { createPresenceVoice, createOpenAiAudio } from './presence-voice.mjs';
import { createPresenceRealtime } from './presence-realtime.mjs';

export async function startPresence({ port = 0, session, voice = false, budgetUsd = 0, audioProvider, realtime = false, realtimeFactory = createPresenceRealtime } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Porta inválida.');
  voice ||= realtime;
  session ??= createPresenceSession({ voice });
  const audio = voice && !realtime ? createPresenceVoice({ session, provider: audioProvider ?? createOpenAiAudio(), budgetUsd }) : undefined;
  const conversation = realtime ? realtimeFactory({ session, budgetUsd }) : undefined;
  const files = presenceAssets(true), token = randomBytes(32).toString('hex'), requests = new Map();
  let origin;
  const server = createServer(async (req, res) => {
    const send = (code, data, type = 'application/json; charset=utf-8') => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
        'Permissions-Policy': `microphone=${voice ? '(self)' : '()'}, camera=()`,
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; media-src 'self'" + (voice ? ' blob:' : '') });
      res.end(typeof data === 'object' && !Buffer.isBuffer(data) ? JSON.stringify(data) : data);
    };
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) ||
      (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) return send(403, { error: 'E_ORIGIN' });
    if (req.method === 'GET' && files.has(req.url)) { const file = files.get(req.url); return send(200, file.body, file.type); }
    if (!['/presence/api/snapshot', '/presence/api/action', '/presence/api/voice/config', '/presence/api/voice/action', '/presence/api/realtime/snapshot', '/presence/api/realtime/action'].includes(req.url)) return send(404, { error: 'E_NOT_FOUND' });
    const credential = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${token}`);
    if (credential.length !== expected.length || !timingSafeEqual(credential, expected)) return send(401, { error: 'E_SESSION' });
    if (req.method === 'GET' && req.url === '/presence/api/snapshot') { session.touch(); return send(200, session.snapshot()); }
    if (req.method === 'GET' && req.url === '/presence/api/voice/config') return send(200, conversation?.config() ?? audio?.config() ?? { enabled: false, reason: 'E_VOICE_DISABLED' });
    if (req.method === 'GET' && req.url === '/presence/api/realtime/snapshot') {
      if (!conversation) return send(404, { error: 'E_NOT_FOUND' });
      session.touch(); conversation.touch(); return send(200, conversation.snapshot());
    }
    if (req.method === 'POST' && req.url === '/presence/api/realtime/action') {
      if (!conversation) return send(404, { error: 'E_NOT_FOUND' });
      if (req.headers.origin !== origin) return send(403, { error: 'E_ORIGIN' });
      if (req.headers['content-type'] !== 'application/json') return send(415, { error: 'E_CONTENT_TYPE' });
      let startId;
      res.on('close', () => { if (startId && !res.writableEnded) void conversation.stop(startId); });
      try {
        const chunks = []; let bytes = 0;
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 96000) return send(413, { error: 'E_BODY_LIMIT' }); chunks.push(chunk); }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!input || !['start', 'stop'].includes(input.action) || typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(input.requestId)) return send(400, { error: 'E_INPUT' });
        if (input.sessionId !== session.snapshot().sessionId) return send(409, { error: 'E_STALE_SESSION' });
        session.touch();
        if (input.action === 'stop') {
          if (Object.keys(input).some(k => !['action', 'requestId', 'sessionId', 'targetRequestId'].includes(k)) ||
            typeof input.targetRequestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(input.targetRequestId)) return send(400, { error: 'E_INPUT' });
          return send(200, await conversation.stop(input.targetRequestId));
        }
        startId = input.requestId; return send(200, await conversation.start(input));
      } catch (e) { return send(409, { error: /^E_[A-Z_]+$/.test(e.code ?? '') ? e.code : 'E_INPUT' }); }
    }
    if (req.method === 'POST' && req.url === '/presence/api/voice/action') {
      if (!audio) return send(404, { error: 'E_VOICE_DISABLED' });
      if (req.headers.origin !== origin) return send(403, { error: 'E_ORIGIN' });
      if (req.headers['content-type'] !== 'application/json') return send(415, { error: 'E_CONTENT_TYPE' });
      let voiceRequestId;
      const disconnected = () => { if (!res.writableEnded && voiceRequestId) audio.cancel(voiceRequestId); };
      res.on('close', disconnected);
      try {
        const chunks = []; let count = 0;
        for await (const chunk of req) { count += chunk.length; if (count > 2000000) return send(413, { error: 'E_BODY_LIMIT' }); chunks.push(chunk); }
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        voiceRequestId = input?.requestId;
        const value = await audio.action(input); session.touch(); send(200, value);
      } catch (e) { if (!res.destroyed) send(409, { error: /^E_[A-Z_]+$/.test(e.code ?? '') ? e.code : 'E_INPUT', reservedUsd: audio.config().reservedUsd }); }
      finally { res.off('close', disconnected); }
      return;
    }
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
      audio?.cancel();
      const result = (async () => {
        try {
          await conversation?.end();
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
  server.on('close', () => { audio?.close(); void conversation?.close(); session.close(); });
  try { await new Promise((ok, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', ok); }); }
  catch (e) { audio?.close(); void conversation?.close(); session.close(); throw e; }
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, session, origin, token, url: `${origin}/presence/#session=${token}` };
}
