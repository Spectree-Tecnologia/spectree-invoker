// Explicit browser probe: demo MP3 -> MediaStream -> real AudioWorklet -> WAV -> STT.
// Never accesses a physical microphone. --live permits one paid transcription.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { presenceAssets } from '../../scripts/lib/console/server.mjs';
import { createOpenAiAudio, createPresenceVoice } from '../../presence/server/voice.mjs';
import { wavDuration } from '../../presence/voice-format.mjs';

const args = process.argv.slice(2);
if (args.length && args.join(' ') !== '--live') throw new Error('Use no arguments (synthetic), or --live (one paid STT call).');
const live = args.includes('--live'), token = randomBytes(32).toString('hex');
const voice = createPresenceVoice({ budgetUsd: .1,
  session: { snapshot: () => ({ sessionId: 'capture-canary', revision: 1, status: 'ready', messages: [] }) },
  provider: live ? createOpenAiAudio() : { ready: true, name: 'fake', transcribe: async bytes => {
    if (wavDuration(bytes) < 2) throw new Error('E_AUDIO_SHORT'); return 'Invoker — vamos planejar sua ideia. Transcrição simulada.';
  } } });
const files = presenceAssets(true);
files.set('/presence/', { type: 'text/html; charset=utf-8', body: `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Canário de captura</title>
<style>body{font:16px/1.7 system-ui;background:#0b1018;color:#edf2fa;max-width:800px;margin:60px auto;padding:24px}button{font:inherit;padding:12px}pre{white-space:pre-wrap}</style>
<h1>Canário do capturador real</h1><p>Fala demonstrativa do projeto. Sem microfone físico ou Codex. ${live ? 'Uma transcrição OpenAI paga; reserva US$ 0,10.' : 'Transcrição simulada; nenhuma chamada paga.'}</p>
<button>Capturar fala demonstrativa</button><p role="status">Pronto</p><pre></pre><script type="module" src="./capture-canary.mjs"></script></html>` });
files.set('/presence/capture-canary.mjs', { type: 'text/javascript; charset=utf-8', body: `
import { createVoiceCapture } from './voice-capture.mjs';
import { toBase64 } from './voice.mjs';
const button = document.querySelector('button'), status = document.querySelector('[role=status]'), result = document.querySelector('pre');
button.onclick = async () => {
  button.disabled = true;
  const ctx = new AudioContext(); await ctx.resume();
  const buffer = await ctx.decodeAudioData(await (await fetch('./audio/invoker-intro.mp3')).arrayBuffer());
  const source = ctx.createBufferSource(), destination = ctx.createMediaStreamDestination(); source.buffer = buffer; source.connect(destination);
  const capture = createVoiceCapture({
    environment: { navigator: { mediaDevices: { getUserMedia: async () => destination.stream } }, AudioWorkletNode,
      AudioContext: class { constructor() { return ctx; } } },
    onState: value => { status.textContent = value; },
    onError: code => { status.textContent = code; capture.dispose(); },
    async onComplete(bytes) {
      status.textContent = 'Transcrevendo';
      try {
        const response = await fetch('./capture-result', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + location.hash.slice(1) },
          body: JSON.stringify({ action: 'transcribe', sessionId: 'capture-canary', requestId: crypto.randomUUID(), audio: toBase64(bytes) }) });
        const value = await response.json();
        result.textContent = JSON.stringify(value, null, 2);
        status.textContent = response.ok && /Invoker/i.test(value.text) && /ideia/i.test(value.text) ? 'Canário passou' : value.error ?? 'E_CANARY_TRANSCRIPT';
      } catch { status.textContent = 'E_CANARY_NETWORK'; }
      finally { capture.dispose(); }
    }
  });
  await capture.start(); source.onended = () => setTimeout(() => capture.finish(), 100); source.start();
};` });
let origin;
const server = createServer(async (req, res) => {
  const send = (status, value, type = 'application/json; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store',
      'Permissions-Policy': 'microphone=(), camera=()', 'X-Content-Type-Options': 'nosniff' });
    res.end(typeof value === 'object' && !Buffer.isBuffer(value) ? JSON.stringify(value) : value);
  };
  if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin) return send(403, { error: 'E_ORIGIN' });
  if (req.method === 'GET' && files.has(req.url)) { const file = files.get(req.url); return send(200, file.body, file.type); }
  if (req.method !== 'POST' || req.url !== '/presence/capture-result') return send(404, { error: 'E_NOT_FOUND' });
  if (req.headers.authorization !== `Bearer ${token}` || req.headers.origin !== origin) return send(403, { error: 'E_SESSION' });
  try {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 2000000) return send(413, { error: 'E_BODY_LIMIT' }); chunks.push(chunk); }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const result = await voice.action(input);
    console.log(JSON.stringify({ canary: 'capture', live, wavSeconds: wavDuration(Buffer.from(input.audio, 'base64')),
      transcriptionMs: result.elapsedMs, nonempty: !!result.text?.trim(), reservedUsd: result.reservedUsd }));
    send(200, result);
  } catch (e) { const error = /^E_[A-Z_]+$/.test(e.code ?? '') ? e.code : 'E_CANARY'; console.log(error); send(409, { error }); }
});
server.on('close', () => voice.close());
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;
console.log(`${live ? 'LIVE STT' : 'SYNTHETIC'} CAPTURE CANARY ${origin}/presence/#${token}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); server.closeAllConnections(); });
