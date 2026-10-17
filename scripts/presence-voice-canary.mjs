#!/usr/bin/env node
// Opt-in provider probe. Uses only this fixed synthetic sentence, never a microphone.
import { createPresenceVoice, createOpenAiAudio } from '../presence/server/voice.mjs';
import { encodeWav } from '../presence/voice-format.mjs';

if (process.argv.slice(2).join(' ') !== '--live') {
  console.error('Use node scripts/presence-voice-canary.mjs --live. Faz duas chamadas de áudio OpenAI com conteúdo sintético; exige OPENAI_API_KEY.');
  process.exitCode = 1;
} else {
  const provider = createOpenAiAudio();
  if (!provider.ready) { console.error('E_AUDIO_KEY: configure OPENAI_API_KEY localmente; não envie a chave pelo chat.'); process.exitCode = 1; }
  else {
    const session = { snapshot: () => ({ sessionId: 'audio-canary', revision: 1, status: 'completed',
      messages: [{ id: 'answer', turnId: 'synthetic', role: 'assistant', text: 'Olá. Este é um teste de voz do Invoker. Vamos transformar uma ideia em uma especificação clara.' }] }) };
    const voice = createPresenceVoice({ session, provider, budgetUsd: .2 });
    const action = (type, extra) => voice.action({ action: type, sessionId: 'audio-canary', requestId: crypto.randomUUID(), ...extra });
    try {
      const speech = await action('speak', { messageId: 'answer', part: 0 });
      const bytes = Buffer.from(speech.audio, 'base64'), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const samples = new Float32Array(bytes.length / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
      const transcript = await action('transcribe', { audio: Buffer.from(encodeWav(samples, 24000)).toString('base64') });
      if (!/ideia/i.test(transcript.text) || !/especifica/i.test(transcript.text)) throw new Error('E_CANARY_TRANSCRIPT');
      console.log(JSON.stringify({ canary: 'passed', provider: 'OpenAI', synthetic: true, synthesisMs: speech.elapsedMs,
        transcriptionMs: transcript.elapsedMs, audioSeconds: samples.length / 24000, reservedUsd: .2,
        note: 'Reserva local, não custo faturado. Não valida microfone físico, percepção de emoção ou latência do Codex.' }));
    } catch (e) { console.error(/^E_[A-Z_]+$/.test(e.message) ? e.message : 'E_AUDIO_CANARY'); process.exitCode = 1; }
    finally { voice.close(); }
  }
}
