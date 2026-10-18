// The governance runtime and the two local UIs. Presence and Console depend on the runtime; the
// runtime depends on neither, and Presence does not borrow the Console to serve itself. Each guard
// is first shown rejecting the import it exists to keep out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './helpers.mjs';

function sources(dir) {
  return readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sources(rel);
    return /\.(mjs|js)$/.test(e.name) ? [rel] : [];
  });
}
// Every module specifier, static or dynamic, and every path a module resolves next to itself.
function specifiers(text) {
  const found = [];
  for (const re of [/\bfrom\s*['"]([^'"]+)['"]/g, /\bimport\s*\(?\s*['"]([^'"]+)['"]/g, /new URL\(\s*['"`]([^'"`]+)['"`]/g]) {
    for (const m of text.matchAll(re)) found.push(m[1]);
  }
  return found;
}
const offenders = (files, forbidden) => files.flatMap((path) =>
  specifiers(readFileSync(join(REPO, path), 'utf8')).filter((s) => forbidden.test(s)).map((s) => `${path} -> ${s}`));

// The runtime: every script and library except the two UIs' own entries and modules.
const UI_ENTRY = /^scripts[\\/](presence[\w-]*|console)\.mjs$|^scripts[\\/]lib[\\/]console[\\/]/;
const runtime = [...sources('scripts')].filter((p) => !UI_ENTRY.test(p));
const RUNTIME_FORBIDDEN = /(^|[\\/])presence[\\/]|presence-[\w-]+\.mjs$|console-[\w-]+\.mjs$|(^|[\\/])console[\\/]|^(ws|three)(\/|$)/;
const PRESENCE_FORBIDDEN = /console-[\w-]+\.mjs$|(^|[\\/])console[\\/]/;
const BENCH_FORBIDDEN = /(^|[\\/])tests[\\/]/;

test('the guards recognise the imports they keep out', () => {
  assert.deepEqual(specifiers("import { x } from '../../presence/voice-format.mjs';\nconst y = await import('./console-server.mjs');"),
    ['../../presence/voice-format.mjs', './console-server.mjs']);
  assert.ok(RUNTIME_FORBIDDEN.test('../../presence/voice-format.mjs'));
  assert.ok(RUNTIME_FORBIDDEN.test('./presence-server.mjs'));
  assert.ok(RUNTIME_FORBIDDEN.test('./console-reader.mjs'));
  assert.ok(RUNTIME_FORBIDDEN.test('../console/index.mjs'));
  assert.ok(RUNTIME_FORBIDDEN.test('ws'));
  assert.ok(RUNTIME_FORBIDDEN.test('three'));
  assert.ok(!RUNTIME_FORBIDDEN.test('./shared/guard.mjs'), 'the runtime importing itself is not a crossing');
  assert.ok(PRESENCE_FORBIDDEN.test('../../scripts/lib/console/server.mjs'));
  assert.ok(!PRESENCE_FORBIDDEN.test('../../scripts/lib/shared/launch.mjs'), 'Presence reaching the runtime is the allowed direction');
  assert.ok(BENCH_FORBIDDEN.test('../tests/helpers.mjs'));
  assert.ok(UI_ENTRY.test('scripts/presence-voice-canary.mjs') && UI_ENTRY.test('scripts/lib/console/server.mjs') && !UI_ENTRY.test('scripts/state.mjs'));
});

test('the runtime imports neither Presence, nor the Console, nor their dependencies', () => {
  assert.ok(runtime.some((p) => p.endsWith('state.mjs')) && runtime.length > 40, 'the runtime inventory is not empty');
  assert.deepEqual(offenders(runtime, RUNTIME_FORBIDDEN), []);
});

test('Presence depends on the runtime only, never on the Console', () => {
  const presence = sources('presence');
  assert.ok(presence.some((p) => p.endsWith(join('server', 'server.mjs'))));
  assert.deepEqual(offenders(presence, PRESENCE_FORBIDDEN), []);
});

test('the benchmark does not import the suite', () => {
  assert.deepEqual(offenders(sources('bench'), BENCH_FORBIDDEN), []);
});

test('the root package has no dependencies; Presence declares its own', () => {
  const root = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) assert.equal(root[key], undefined, key);
  assert.deepEqual(root.workspaces, ['presence']);
  const presence = JSON.parse(readFileSync(join(REPO, 'presence', 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(presence.dependencies).sort(), ['three', 'ws']);
});
