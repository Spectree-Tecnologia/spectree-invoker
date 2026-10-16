#!/usr/bin/env node
import { startConsole } from './lib/console-server.mjs';
import { startPresence } from './lib/presence-server.mjs';
try {
  const args = process.argv.slice(2); let port = 0, live = false, voice = false, realtime = false, budgetUsd = 0;
  if (args.length === 1 && args[0] === '--help') {
    console.log('Spectree Presence\nnode scripts/presence.mjs [--codex] [--port 4319] [--voice | --realtime] [--budget-usd 1.7]\n--codex: conversa em canário com login ChatGPT local.\n--voice: gravações e síntese OpenAI; reserva US$ 0,10 por chamada.\n--realtime: conversa contínua OpenAI e ponte Codex; ensaio de até 60 s, reserva US$ 1 por sessão.\nÁudio requer OPENAI_API_KEY; orçamento local até US$ 2 por processo, não é extrato.');
  } else {
    const seen = new Set();
    for (let i = 0; i < args.length; i++) {
      const flag = args[i]; if (seen.has(flag)) throw new Error('Argumento duplicado.'); seen.add(flag);
      if (flag === '--codex') live = true;
      else if (flag === '--voice') voice = true;
      else if (flag === '--realtime') realtime = true;
      else if (flag === '--budget-usd' && /^(?:0|1|2)(?:\.\d{1,2})?$/.test(args[i + 1] ?? '')) budgetUsd = Number(args[++i]);
      else if (flag === '--port' && /^\d+$/.test(args[i + 1] ?? '')) port = Number(args[++i]);
      else throw new Error('Use --codex e/ou --port <porta>. Presence não abre projetos consumidores.');
    }
    if (realtime && (voice || !live || budgetUsd < 1 || budgetUsd > 2)) throw new Error('Realtime exige --codex --realtime --budget-usd <1.00 a 2.00>, sem --voice.');
    if (!realtime && ((voice && (!live || budgetUsd < .1 || budgetUsd > 2)) || (!voice && budgetUsd))) throw new Error('Voz exige --codex --voice --budget-usd <0.10 a 2.00>.');
    const { server, url } = await (live ? startPresence({ port, voice: voice || realtime, realtime, budgetUsd }) : startConsole({ presence: true, port }));
    console.log(`\n  spectree / presence\n  ${live ? realtime ? 'REALTIME OPENAI · ponte CODEX LOCAL · canário · ensaio de 60 s' : voice ? 'CODEX LOCAL · áudio OpenAI · canário · voz sintética' : 'CODEX LOCAL · texto · canário · sem voz' : 'DEMONSTRAÇÃO · sem microfone ou harness'}\n\n  ${url}\n\n  Ctrl+C para encerrar.\n`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); server.closeAllConnections(); });
  }
} catch (error) {
  console.error(`Presence: ${error.code === 'ENOENT' ? 'Recurso local ausente. Execute npm ci na raiz do spectree-invoker.' : error.message}`);
  process.exitCode = 1;
}
