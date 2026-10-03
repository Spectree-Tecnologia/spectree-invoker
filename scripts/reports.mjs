#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { engineeringReport } from './lib/engineering-reports.mjs';
try {
  const [kind, file, ...extra] = process.argv.slice(2);
  if (!file || extra.length) throw Error('usage: reports.mjs diagnosis|review <report.json>');
  console.log(JSON.stringify(engineeringReport(process.env.SPECTREE_PROJECT_ROOT ?? process.cwd(), kind, JSON.parse(readFileSync(file, 'utf8'))), null, 2));
} catch (e) { console.error(`${e.code ?? 'E_REPORT'}: ${e.message}`); process.exitCode = 1; }
