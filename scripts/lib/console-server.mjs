import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readProject, roles, pipeline } from './console-reader.mjs';
import { demoProject } from './console-demo.mjs';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const assetRoot = fileURLToPath(new URL('../../console/', import.meta.url));

export async function startConsole({ roots = [], demo = false, port = 0 } = {}) {
  if (demo && roots.length) throw new Error('Use --demo ou --project, separadamente.');
  if (!demo && !roots.length) throw new Error('Informe ao menos um --project ou use --demo.');
  if (roots.length > 12) throw new Error('Máximo de 12 projetos por sessão.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Porta inválida.');
  const projects = [...new Set(roots.map(r => realpathSync(resolve(r))))].map((root, i) => {
    if (!statSync(root).isDirectory()) throw new Error('O projeto deve ser um diretório.');
    return { root, id: `project-${i + 1}` };
  });
  const token = randomBytes(32).toString('hex');
  // Only immutable package assets are served, never a path supplied by the browser.
  const files = new Map([...assets].map(([url, [name, type]]) => [url, { type, body: readFileSync(resolve(assetRoot, name)) }]));
  let origin;
  let cache, cachedAt = 0;
  const server = createServer((req, res) => {
    const send = (code, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" });
      res.end(body);
    };
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) ||
        (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) return send(403, '{"error":"E_ORIGIN"}');
    if (req.method !== 'GET') return send(405, '{"error":"E_READ_ONLY"}');
    if (files.has(req.url)) { const { body, type } = files.get(req.url); return send(200, body, type); }
    if (req.url !== '/api/snapshot') return send(404, '{"error":"E_NOT_FOUND"}');
    const credential = req.headers.authorization ?? '';
    const expected = `Bearer ${token}`;
    if (Buffer.byteLength(credential) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(credential), Buffer.from(expected))) return send(401, '{"error":"E_SESSION"}');
    try {
      if (!cache || Date.now() - cachedAt >= 2000) {
        cache = JSON.stringify({ version: 1, mode: demo ? 'demo' : 'live', roles, pipeline,
          projects: demo ? [demoProject()] : projects.map(p => readProject(p.root, p.id)) });
        cachedAt = Date.now();
      }
      return send(200, cache);
    } catch { return send(503, '{"error":"E_SOURCE_UNAVAILABLE"}'); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  await new Promise((ok, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', ok); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, token, url: `${origin}/#session=${token}` };
}
