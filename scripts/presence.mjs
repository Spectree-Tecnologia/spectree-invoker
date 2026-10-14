#!/usr/bin/env node
import { startConsole } from './lib/console-server.mjs';
try {
  const args = process.argv.slice(2); let port = 0;
  if (args.length === 1 && args[0] === '--help') {
    console.log('Spectree Presence · demonstração local\nnode scripts/presence.mjs [--port 4319]');
  } else {
    if (args.length) {
      if (args.length !== 2 || args[0] !== '--port' || !/^\d+$/.test(args[1])) throw new Error('Use apenas --port <porta>. Presence P1 não abre projetos.');
      port = Number(args[1]);
    }
    const { server, url } = await startConsole({ presence: true, port });
    console.log(`\n  spectree / presence\n  DEMONSTRAÇÃO · sem microfone ou harness\n\n  ${url}\n\n  Ctrl+C para encerrar.\n`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); server.closeAllConnections(); });
  }
} catch (error) {
  console.error(`Presence: ${error.code === 'ENOENT' ? 'Recurso local ausente. Execute npm ci na raiz do spectree-invoker.' : error.message}`);
  process.exitCode = 1;
}
