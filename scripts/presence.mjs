#!/usr/bin/env node
import { startConsole } from './lib/console-server.mjs';
import { startPresence } from './lib/presence-server.mjs';
try {
  const args = process.argv.slice(2); let port = 0, live = false;
  if (args.length === 1 && args[0] === '--help') {
    console.log('Spectree Presence\nnode scripts/presence.mjs [--codex] [--port 4319]\n--codex: conversa por texto em canário, usando login ChatGPT do Codex local.');
  } else {
    const seen = new Set();
    for (let i = 0; i < args.length; i++) {
      const flag = args[i]; if (seen.has(flag)) throw new Error('Argumento duplicado.'); seen.add(flag);
      if (flag === '--codex') live = true;
      else if (flag === '--port' && /^\d+$/.test(args[i + 1] ?? '')) port = Number(args[++i]);
      else throw new Error('Use --codex e/ou --port <porta>. Presence não abre projetos consumidores.');
    }
    const { server, url } = await (live ? startPresence({ port }) : startConsole({ presence: true, port }));
    console.log(`\n  spectree / presence\n  ${live ? 'CODEX LOCAL · texto · canário · sem voz' : 'DEMONSTRAÇÃO · sem microfone ou harness'}\n\n  ${url}\n\n  Ctrl+C para encerrar.\n`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); server.closeAllConnections(); });
  }
} catch (error) {
  console.error(`Presence: ${error.code === 'ENOENT' ? 'Recurso local ausente. Execute npm ci na raiz do spectree-invoker.' : error.message}`);
  process.exitCode = 1;
}
