#!/usr/bin/env node
import { deliveryPlan, deliveryPreflight, runDelivery, deliveryGate, deliveryMetrics, recoverDelivery } from './lib/delivery.mjs';
import { readFileSync } from 'node:fs';
import { ledgerView } from './lib/delivery-ledger.mjs';
const [command, id, ...extra] = process.argv.slice(2);
const root = process.env.SPECTREE_PROJECT_ROOT ?? process.cwd();
try {
  let result;
  if (command === 'ledger' && (!id || id === '--apply') && !extra.length) {
    const view = ledgerView(root, { apply: id === '--apply' });
    result = { ok: view.ok, changed: view.changed, code: view.code };
  } else if (id && !extra.length && command === 'plan') {
    const entry = deliveryPlan(root, id);
    result = { ok: true, advisory: true, authorizes_execution: false, path: entry.path, digest: entry.digest };
  } else if (id && !extra.length && command === 'preflight') result = deliveryPreflight(root, id);
  else if (id && !extra.length && command === 'metrics') result = deliveryMetrics(root, id);
  else if (id && command === 'check' && extra.length <= 1) result = deliveryGate(root, id, extra[0] ?? 'implemented');
  else if (id && command === 'recover' && extra.length === 3 && extra[2] === '--apply')
    result = recoverDelivery(root, id, extra[0], JSON.parse(readFileSync(extra[1], 'utf8')));
  else if (id && command === 'run' && extra.length === 1 && extra[0] === '--apply') {
    result = runDelivery(root, id); result = { ...result, ok: result.result === 'PASS' };
  } else throw Error('usage: delivery.mjs plan|preflight|metrics <change> | check <change> [state] | run <change> --apply | recover <change> <run> <inspection.json> --apply | ledger [--apply]');
  console.log(JSON.stringify(result, null, 2));
  if (result.ok === false) process.exitCode = 1;
} catch (e) { console.error(`${e.code ?? 'E_DELIVERY'}: ${e.message}`); process.exitCode = 1; }
