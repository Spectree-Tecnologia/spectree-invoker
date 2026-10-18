// Manual browser fixture: synthetic tone and scripted text, no Codex/API/microphone.
import { startPresence } from '../../presence/server/server.mjs';
let revision = 1, counter = 0, timer;
const state = { version: 1, origin: 'codex', sessionId: 'synthetic-browser', status: 'ready', error: null,
  model: 'CANÁRIO SINTÉTICO — sem Codex/API', speaker: null, canInterrupt: false, messages: [] };
const session = { snapshot: () => structuredClone({ ...state, revision }), touch() {}, close() { clearTimeout(timer); },
  send(id, text) {
    if (id !== state.sessionId || state.status === 'running') throw new Error('fixture state');
    const turnId = `turn-${++counter}`; state.messages.push({ id: `u-${counter}`, role: 'user', text }); state.status = 'running'; revision++;
    timer = setTimeout(() => { state.messages.push({ id: `a-${counter}`, turnId, role: 'assistant', text: 'Teste sintético de reprodução e interrupção. O áudio é um tom, não uma voz real.' }); state.status = 'completed'; revision++; }, 300);
  }, disconnect() { state.status = 'disconnected'; state.messages = []; revision++; },
};
const audioProvider = { ready: true, name: 'Fixture sintética',
  async speak() {
    const bytes = Buffer.alloc(24000 * 2 * 8);
    for (let i = 0; i < bytes.length / 2; i++) bytes.writeInt16LE(Math.round(Math.sin(i / 24000 * Math.PI * 440) * .15 * (Math.sin(i / 24000 * Math.PI * 3) ** 2) * 32767), i * 2);
    return bytes;
  }, transcribe() { throw new Error('Physical microphone is not part of this fixture'); },
};
const { server, url } = await startPresence({ session, audioProvider, voice: true, budgetUsd: .2 });
console.log(`SYNTHETIC BROWSER FIXTURE — no API, no Codex. ${url}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); server.closeAllConnections(); });
