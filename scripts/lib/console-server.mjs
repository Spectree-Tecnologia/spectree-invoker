import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, statSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { readProject, roles, pipeline } from './console-reader.mjs';
import { demoProject } from './console-demo.mjs';
import { observeRuntime } from './console-observation.mjs';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.mjs', ['app.mjs', 'text/javascript; charset=utf-8']],
  ['/runtime.mjs', ['runtime.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const assetRoot = fileURLToPath(new URL('../../console/', import.meta.url));
const runtimeVersion = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

export async function startConsole({ roots = [], demo = false, port = 0, presence = false } = {}) {
  if (presence && (roots.length || demo)) throw new Error('Presence P1 não abre projetos nem dados da Console.');
  if (demo && roots.length) throw new Error('Use --demo ou --project, separadamente.');
  if (!presence && !demo && !roots.length) throw new Error('Informe ao menos um --project ou use --demo.');
  if (roots.length > 12) throw new Error('Máximo de 12 projetos por sessão.');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Porta inválida.');
  const projects = [...new Set(roots.map(r => realpathSync(resolve(r))))].map((root, i) => {
    if (!statSync(root).isDirectory()) throw new Error('O projeto deve ser um diretório.');
    return { root, id: `project-${i + 1}` };
  });
  const token = randomBytes(32).toString('hex');
  // Only immutable package assets are served, never a path supplied by the browser.
  const files = presence ? presenceAssets() : new Map([...assets].map(([url, [name, type]]) => [url, { type, body: readFileSync(resolve(assetRoot, name)) }]));
  let origin;
  let cache, cachedAt = 0;
  let inspecting = false;
  const server = createServer(async (req, res) => {
    const send = (code, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin',
        ...(presence ? { 'Permissions-Policy': 'microphone=(), camera=()' } : {}),
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" + (presence ? "; media-src 'self'" : '') });
      res.end(body);
    };
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin) ||
        (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) return send(403, '{"error":"E_ORIGIN"}');
    if (req.method !== 'GET') return send(405, '{"error":"E_READ_ONLY"}');
    if (files.has(req.url)) { const { body, type } = files.get(req.url); return send(200, body, type); }
    if (presence) return send(404, '{"error":"E_NOT_FOUND"}');
    let url;
    try { url = new URL(req.url, origin); } catch { return send(400, '{"error":"E_URL"}'); }
    if (req.url !== '/api/snapshot' && url.pathname !== '/api/observation') return send(404, '{"error":"E_NOT_FOUND"}');
    const credential = req.headers.authorization ?? '';
    const expected = `Bearer ${token}`;
    if (Buffer.byteLength(credential) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(credential), Buffer.from(expected))) return send(401, '{"error":"E_SESSION"}');
    try {
      if (url.pathname === '/api/observation') {
        if (demo) return send(409, '{"error":"E_DEMO_ONLY"}');
        const project = projects.find(p => p.id === url.searchParams.get('project'));
        const change = url.searchParams.get('change');
        if ([...url.searchParams.keys()].some(k => !['project', 'change'].includes(k)) || !project || (change !== null && !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(change))) return send(400, '{"error":"E_SELECTION"}');
        const current = readProject(project.root, project.id);
        if (change && (current.health !== 'readable' || !current.changes.some(c => c.change_id === change))) return send(409, '{"error":"E_SOURCE_INCOMPLETE"}');
        if (inspecting) return send(429, '{"error":"E_OBSERVATION_BUSY"}');
        inspecting = true;
        try { return send(200, JSON.stringify(await observeRuntime(project.root, change))); }
        finally { inspecting = false; }
      }
      if (!cache || Date.now() - cachedAt >= 2000) {
        cache = JSON.stringify({ version: 1, runtime_version: runtimeVersion, mode: demo ? 'demo' : 'live', roles, pipeline,
          projects: demo ? [demoProject()] : projects.map(p => readProject(p.root, p.id)) });
        cachedAt = Date.now();
      }
      return send(200, cache);
    } catch { return send(503, '{"error":"E_SOURCE_UNAVAILABLE"}'); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  await new Promise((ok, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', ok); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, token, url: presence ? `${origin}/presence/` : `${origin}/#session=${token}` };
}

// Fixed package resources only. No generic file serving or consumer paths.
export function presenceAssets(live = false) {
  const files = new Map();
  const add = (route, relative, type) => files.set(route, { type, body: readFileSync(new URL(relative, import.meta.url)) });
  add('/presence/', live ? '../../presence/live.html' : '../../presence/index.html', 'text/html; charset=utf-8');
  if (live) {
    for (const name of ['live', 'client', 'voice', 'voice-format', 'voice-capture', 'voice-player', 'voice-worklet', 'realtime']) add(`/presence/${name}.mjs`, `../../presence/${name}.mjs`, 'text/javascript; charset=utf-8');
    add('/presence/live.css', '../../presence/live.css', 'text/css; charset=utf-8');
  }
  add('/presence/style.css', '../../presence/style.css', 'text/css; charset=utf-8');
  for (const name of ['app', 'state', 'audio', 'renderer', 'renderer-core', 'lifecycle']) add(`/presence/${name}.mjs`, `../../presence/${name}.mjs`, 'text/javascript; charset=utf-8');
  for (const name of ['invoker-intro', 'architect', 'invoker-return']) add(`/presence/audio/${name}.mp3`, `../../presence/audio/${name}.mp3`, 'audio/mpeg');
  for (const name of ['three.module.js', 'three.core.js']) add(`/presence/vendor/${name}`, `../../node_modules/three/build/${name}`, 'text/javascript; charset=utf-8');
  return files;
}
