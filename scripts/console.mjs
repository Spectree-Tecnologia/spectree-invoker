#!/usr/bin/env node
import { startConsole } from './lib/console-server.mjs';

const args = process.argv.slice(2);
const roots = []; let port = 0, demo = false;
try {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project' && args[i + 1] && !args[i + 1].startsWith('--')) roots.push(args[++i]);
    else if (args[i] === '--port' && /^\d+$/.test(args[i + 1] ?? '')) port = Number(args[++i]);
    else if (args[i] === '--demo') demo = true;
    else if (args[i] === '--help') {
      console.log('Spectree Console\nnode scripts/console.mjs --project <path> [--project <path>] [--port 4319]\nnode scripts/console.mjs --demo');
      process.exit(0);
    } else throw new Error(`Argumento inválido: ${args[i]}`);
  }
  const { server, url } = await startConsole({ roots, demo, port });
  console.log(`\n  spectree / console\n  ${demo ? 'DEMONSTRAÇÃO · dados sintéticos' : 'OBSERVAÇÃO LOCAL · somente leitura'}\n\n  ${url}\n\n  Abra o endereço no navegador. Ctrl+C para encerrar.\n`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { server.close(); server.closeAllConnections(); });
} catch (e) { console.error(`Console: ${e.message}`); process.exitCode = 1; }
