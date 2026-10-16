#!/usr/bin/env node
import { startConsole } from './lib/console-server.mjs';
import { startPresence } from './lib/presence-server.mjs';
try {
  const args = process.argv.slice(2); let port = 0, live = false, voice = false, budgetUsd = 0;
  if (args.length === 1 && args[0] === '--help') {
    console.log('Spectree Presence\nnode scripts/presence.mjs [--codex] [--port 4319] [--voice --budget-usd 2]\n--codex: conversa em canário com login ChatGPT local.\n--voice: áudio OpenAI separado, requer OPENAI_API_KEY; reserva local de US$ 0,10 por chamada, até US$ 2 por processo.');
  } else {
    const seen = new Set();
    for (let i = 0; i < args.length; i++) {
      const flag = args[i]; if (seen.has(flag)) throw new Error('Argumento duplicado.'); seen.add(flag);
      if (flag === '--codex') live = true;
      else if (flag === '--voice') voice = true;
      else if (flag === '--budget-usd' && /^(?:0|1|2)(?:\.\d{1,2})?$/.test(args[i + 1] ?? '')) budgetUsd = Number(args[++i]);
      else if (flag === '--port' && /^\d+$/.test(args[i + 1] ?? '')) port = Number(args[++i]);
      else throw new Error('Use --codex e/ou --port <porta>. Presence não abre projetos consumidores.');
    }
    if ((voice && (!live || budgetUsd < .1 || budgetUsd > 2)) || (!voice && budgetUsd)) throw new Error('Voz exige --codex --voice --budget-usd <0.10 a 2.00>.');
    const { server, url } = await (live ? startPresence({ port, voice, budgetUsd }) : startConsole({ presence: true, port }));
    console.log(`\n  spectree / presence\n  ${live ? voice ? 'CODEX LOCAL · áudio OpenAI · canário · voz sintética' : 'CODEX LOCAL · texto · canário · sem voz' : 'DEMONSTRAÇÃO · sem microfone ou harness'}\n\n  ${url}\n\n  Ctrl+C para encerrar.\n`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); server.closeAllConnections(); });
  }
} catch (error) {
  console.error(`Presence: ${error.code === 'ENOENT' ? 'Recurso local ausente. Execute npm ci na raiz do spectree-invoker.' : error.message}`);
  process.exitCode = 1;
}
