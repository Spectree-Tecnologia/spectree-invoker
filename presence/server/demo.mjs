import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { presenceAssets } from './assets.mjs';

// The demonstration without a harness: the static page and nothing else. It used to be a mode of
// the Console server, which made Presence depend on the Console to serve its own files.
export async function startPresenceDemo({ port = 0, ...rest } = {}) {
  if (Object.keys(rest).length) throw new Error('Presence P1 não abre projetos nem dados da Console.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Porta inválida.');
  const token = randomBytes(32).toString('hex');
  const files = presenceAssets();
  let origin;
  const server = createServer((req, res) => {
    const send = (code, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
        'Permissions-Policy': 'microphone=(), camera=()',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; media-src 'self'" });
      res.end(body);
    };
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) ||
        (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) return send(403, '{"error":"E_ORIGIN"}');
    if (req.method !== 'GET') return send(405, '{"error":"E_READ_ONLY"}');
    if (files.has(req.url)) { const { body, type } = files.get(req.url); return send(200, body, type); }
    return send(404, '{"error":"E_NOT_FOUND"}');
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  await new Promise((ok, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', ok); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, token, url: `${origin}/presence/` };
}
