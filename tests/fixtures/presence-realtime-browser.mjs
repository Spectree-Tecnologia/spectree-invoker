// Manual opt-in only. Real WebRTC + Realtime + Codex in an empty canary, synthetic input.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { presenceAssets } from '../../scripts/lib/console-server.mjs';
import { createPresenceSession } from '../../presence/server/session.mjs';
import { createPresenceRealtime } from '../../presence/server/realtime.mjs';
const short = process.argv.includes('--short');
if (!['--live', '--live --short'].includes(process.argv.slice(2).join(' ')) || !process.env.OPENAI_API_KEY) throw new Error('Opt-in required: node --env-file=.env tests/fixtures/presence-realtime-browser.mjs --live [--short]');
const session = createPresenceSession({ voice: true });
try { await session.connect(); } catch (e) { session.close(); throw new Error(/^E_[A-Z_]+$/.test(e.code ?? '') ? e.code : 'E_CODEX_CONNECT'); }
const service = createPresenceRealtime({ session, budgetUsd: short ? .3 : 1, maxSessionMs: short ? 15000 : 60000 });
const token = randomBytes(32).toString('hex'), files = presenceAssets(true);
files.set('/presence/', { type: 'text/html; charset=utf-8', body: `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Canário Realtime</title>
<style>body{font:16px/1.7 system-ui;background:#0b1018;color:#edf2fa;max-width:900px;margin:40px auto;padding:24px}button{font:inherit;padding:12px;margin:6px}pre{white-space:pre-wrap}</style>
<h1>Canário Realtime · fala demonstrativa</h1><p>Sem microfone físico. Voz Realtime pela API, análise Codex em canário isolado. Reserva US$ ${short ? '0,30' : '1'}; limite de ${short ? '15' : '60'} segundos.</p>
<button data-start>Iniciar canário</button><button data-codex disabled>Consultar Codex</button><button data-interrupt disabled>Interromper com fala</button><button data-stop disabled>Encerrar</button>
<p role="status">Pronto</p><p data-energy>Energia máxima da fala: 0</p><p data-interruptions>Interrupções observadas: 0</p><p data-analysis>Análise Codex confirmada: não</p><pre></pre><script type="module" src="./realtime-canary.mjs"></script></html>` });
files.set('/presence/realtime-canary.mjs', { type: 'text/javascript; charset=utf-8', body: `
import { createRealtimeConversation } from './realtime.mjs';
const $ = value => document.querySelector(value), token = location.hash.slice(1);
let inputContext, buffer, destination, channel, peer, client, peak = 0, interruptCount = 0, priorPhase, interruptRequested = false;
const playInput = () => { const source = inputContext.createBufferSource(); source.buffer = buffer; source.connect(destination); source.start(); };
$('[data-start]').onclick = async () => {
  $('[data-start]').disabled = true;
  inputContext = new AudioContext(); await inputContext.resume(); destination = inputContext.createMediaStreamDestination();
  buffer = await inputContext.decodeAudioData(await (await fetch('./audio/invoker-return.mp3')).arrayBuffer());
  const value = await (await fetch('./bootstrap', { headers: { Authorization: 'Bearer ' + token } })).json();
  class Peer extends RTCPeerConnection { constructor() { super(); peer = this; } createDataChannel(...args) { channel = super.createDataChannel(...args); return channel; } }
  client = createRealtimeConversation({ token, environment: { navigator: { mediaDevices: { getUserMedia: async () => destination.stream } },
    AudioContext, Audio, RTCPeerConnection: Peer, MediaStream }, onState(view) {
      if (interruptRequested && priorPhase === 'speaking' && view.phase === 'listening' && view.active) { interruptCount++; interruptRequested = false; $('[data-interruptions]').textContent = 'Interrupções observadas: ' + interruptCount; }
      if (view.work === 'completed') $('[data-analysis]').textContent = 'Análise Codex confirmada: sim';
      priorPhase = view.phase; $('[role=status]').textContent = view.error ?? view.phase;
      $('pre').textContent = JSON.stringify(view, null, 2);
    } });
  client.sync(value); await client.start();
  if (channel?.readyState === 'open') { for (const name of ['codex','interrupt','stop']) $('[data-' + name + ']').disabled = false; playInput(); }
};
$('[data-codex]').onclick = () => {
  $('[data-codex]').disabled = true;
  channel.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Consulte o Codex agora: proponha dois critérios de aceite para uma lista de tarefas. Esta é uma análise em canário, sem execução.' }] } }));
  channel.send(JSON.stringify({ type: 'response.create' }));
};
$('[data-interrupt]').onclick = () => { interruptRequested = priorPhase === 'speaking'; playInput(); };
$('[data-stop]').onclick = () => { client.stop(); void inputContext.close(); };
setInterval(() => { if (!client || priorPhase !== 'speaking') return; peak = Math.max(peak, client.sample().energy); $('[data-energy]').textContent = 'Energia máxima da fala: ' + peak.toFixed(4); }, 50);
window.addEventListener('pagehide', () => { client?.dispose(); void inputContext?.close(); });` });
let origin;
const server = createServer(async (req, res) => {
  const send = (status, data, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Permissions-Policy': 'microphone=(), camera=()' });
    res.end(typeof data === 'object' && !Buffer.isBuffer(data) ? JSON.stringify(data) : data);
  };
  if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin) return send(403, { error: 'E_ORIGIN' });
  if (req.method === 'GET' && files.has(req.url)) { const f = files.get(req.url); return send(200, f.body, f.type); }
  if (req.headers.authorization !== 'Bearer ' + token) return send(401, { error: 'E_SESSION' });
  if (req.method === 'GET' && req.url === '/presence/bootstrap') { session.touch(); return send(200, session.snapshot()); }
  if (req.method === 'GET' && req.url === '/presence/api/realtime/snapshot') { session.touch(); service.touch(); return send(200, service.snapshot()); }
  if (req.method !== 'POST' || req.url !== '/presence/api/realtime/action' || req.headers.origin !== origin) return send(404, { error: 'E_NOT_FOUND' });
  try {
    let size = 0; const chunks = [];
    for await (const chunk of req) { size += chunk.length; if (size > 96000) return send(413, { error: 'E_BODY_LIMIT' }); chunks.push(chunk); }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (input.action === 'stop') return send(200, await service.stop(input.targetRequestId));
    return send(200, await service.start(input));
  } catch (e) { send(409, { error: /^E_[A-Z_]+$/.test(e.code ?? '') ? e.code : 'E_REALTIME_PROVIDER' }); }
});
server.on('close', () => { void service.close(); session.close(); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = 'http://127.0.0.1:' + server.address().port;
console.log('LIVE REALTIME CANARY ' + origin + '/presence/#' + token);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); server.closeAllConnections(); });
