#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createBridgeRequest, inspectBridgeRequest, publishBridgeResult, waitBridgeResult } from './lib/bridge-mailbox.mjs';
const root = process.env.SPECTREE_PROJECT_ROOT ?? process.cwd();
const [command, id, input, apply, ...rest] = process.argv.slice(2);
try {
  let result;
  if (command === 'serve' && !input) {
    const request = createBridgeRequest(root, JSON.parse(readFileSync(0, 'utf8')), id === undefined ? 240 : Number(id));
    result = await waitBridgeResult(root, request.request_id);
  } else if (command === 'inspect' && id && !input) result = inspectBridgeRequest(root, id);
  else if (command === 'publish' && id && input && apply === '--apply' && !rest.length) result = publishBridgeResult(root, id, JSON.parse(readFileSync(input, 'utf8').replace(/^\uFEFF/, '')));
  else throw Error('usage: bridge.mjs serve [deadline-seconds] | inspect <dispatch-id> | publish <dispatch-id> <agent-final.json> --apply');
  console.log(JSON.stringify(result, null, 2));
} catch (e) { console.error(`${e.code ?? 'E_BRIDGE'}: ${e.message}`); process.exitCode = 1; }
