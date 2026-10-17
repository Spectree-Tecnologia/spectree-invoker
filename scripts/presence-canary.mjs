#!/usr/bin/env node
// Explicit opt-in: uses the user's authenticated Codex subscription. Never run in CI.
import { createPresenceSession } from '../presence/server/session.mjs';
import { randomBytes } from 'node:crypto';
if (process.argv.slice(2).join(' ') !== '--live') {
  console.error('Use node scripts/presence-canary.mjs --live. Consome a sessão ChatGPT do Codex local.');
  process.exitCode = 1;
} else {
  const session = createPresenceSession(); let heartbeat;
  async function finish() {
    const deadline = Date.now() + 180000;
    while (['running', 'interrupting'].includes(session.snapshot().status) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    const value = session.snapshot();
    if (value.status === 'error') throw new Error(value.error);
    return value;
  }
  try {
    heartbeat = setInterval(() => session.touch(), 1000);
    const ready = await session.connect(), marker = `CORAL-${randomBytes(4).toString('hex')}`;
    await session.send(ready.sessionId, `Teste de canário da Presence. Memorize o marcador ${marker} apenas nesta conversa. Responda somente "Registrado". Não use ferramentas.`);
    const first = await finish(); if (first.status !== 'completed') throw new Error('E_CANARY_FIRST');
    await session.send(ready.sessionId, 'Qual é o marcador que acabei de fornecer? Responda somente o marcador, sem ferramentas.');
    const second = await finish();
    const answer = second.messages.filter(m => m.role === 'assistant').at(-1)?.text;
    if (second.status !== 'completed' || !answer?.includes(marker)) throw new Error('E_CANARY_CONTEXT');
    await session.send(ready.sessionId, 'Liste e explique 100 critérios de aceite de uma interface de conversa, somente em texto e sem ferramentas.');
    await session.interrupt(ready.sessionId); const interrupted = await finish();
    if (interrupted.status !== 'interrupted') throw new Error('E_CANARY_INTERRUPT');
    console.log(JSON.stringify({ canary: 'passed', model: ready.model, first: first.status, context: 'preserved', interrupt: interrupted.status,
      assistantMessages: second.messages.filter(m => m.role === 'assistant').length, origin: second.origin, speaker: second.speaker }));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  finally { clearInterval(heartbeat); session.close(); }
}
