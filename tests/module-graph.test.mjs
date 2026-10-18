// The runtime's own modules: each folder under scripts/lib/ is one module, its index.mjs is the
// only file another module or a CLI may import, and the graph between modules has no cycle.
// Each guard is first shown rejecting the import or graph it exists to keep out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { REPO } from './helpers.mjs';

const LIB = join(REPO, 'scripts', 'lib');
const MODULES = readdirSync(LIB, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();

function files(dir) {
  return readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : files(rel);
    return e.name.endsWith('.mjs') ? [rel] : [];
  });
}
const imports = (text) => [...text.matchAll(/\bfrom\s*['"](\.[^'"]+)['"]|\bimport\s*\(?\s*['"](\.[^'"]+)['"]/g)].map((m) => m[1] ?? m[2]);

// Where a relative import lands: { module, file } inside scripts/lib/, or null outside it.
function landing(fromFile, spec) {
  const rel = relative(LIB, resolve(REPO, dirname(fromFile), spec));
  if (rel.startsWith('..')) return null;
  const [module, ...rest] = rel.split(sep);
  return { module, file: rest.join('/') };
}
function deepImports(fromFile, text, ownModule) {
  return imports(text).filter((spec) => {
    const to = landing(fromFile, spec);
    return to && to.module !== ownModule && to.file !== 'index.mjs';
  }).map((spec) => `${fromFile} -> ${spec}`);
}
function cycle(graph) {
  const state = new Map();
  const visit = (n, path) => {
    if (state.get(n) === 'done') return null;
    if (state.get(n) === 'open') return [...path.slice(path.indexOf(n)), n];
    state.set(n, 'open');
    for (const m of graph.get(n) ?? []) { const c = visit(m, [...path, n]); if (c) return c; }
    state.set(n, 'done');
    return null;
  };
  for (const n of graph.keys()) { const c = visit(n, []); if (c) return c; }
  return null;
}

const libFiles = MODULES.flatMap((m) => files(join('scripts', 'lib', m)).map((path) => ({ path, module: m, text: readFileSync(join(REPO, path), 'utf8') })));
const graph = new Map(MODULES.map((m) => [m, new Set()]));
for (const f of libFiles) {
  for (const spec of imports(f.text)) {
    const to = landing(f.path, spec);
    if (to && to.module !== f.module) graph.get(f.module).add(to.module);
  }
}

test('the guards recognise a deep import and a cycle', () => {
  const from = join('scripts', 'lib', 'evidence', 'delivery.mjs');
  assert.deepEqual(deepImports(from, "import { withAuthority } from '../change/lifecycle.mjs';", 'evidence'),
    [`${from} -> ../change/lifecycle.mjs`]);
  assert.deepEqual(deepImports(from, "import { withAuthority } from '../change/index.mjs';\nimport { x } from './diff.mjs';", 'evidence'), []);
  const cli = join('scripts', 'state.mjs');
  assert.equal(deepImports(cli, "import { Store } from './lib/change/store.mjs';", null).length, 1);
  assert.deepEqual(cycle(new Map([['closure', ['evidence']], ['evidence', ['closure']]])), ['closure', 'evidence', 'closure']);
  assert.equal(cycle(new Map([['closure', ['evidence']], ['evidence', ['shared']], ['shared', []]])), null);
});

test('scripts/lib is made of modules, each with a published index', () => {
  assert.deepEqual(readdirSync(LIB, { withFileTypes: true }).filter((e) => !e.isDirectory()).map((e) => e.name), [],
    'no library file lives outside a module');
  assert.ok(MODULES.length >= 7);
  for (const m of MODULES) assert.ok(libFiles.some((f) => f.path === join('scripts', 'lib', m, 'index.mjs')), `${m} has index.mjs`);
});

test('an index re-exports only its own module', () => {
  for (const f of libFiles.filter((x) => x.path.endsWith(`${sep}index.mjs`))) {
    for (const spec of imports(f.text)) assert.match(spec, /^\.\/[\w-]+\.mjs$/, `${f.path} -> ${spec}`);
  }
});

test('no module reaches into another past its index', () => {
  assert.deepEqual(libFiles.flatMap((f) => deepImports(f.path, f.text, f.module)), []);
});

test('the CLIs, Presence, the benchmark and the evals import the runtime only through an index', () => {
  const consumers = [...files('scripts').filter((p) => !p.startsWith(join('scripts', 'lib'))), ...files(join('presence', 'server')), ...files('bench'), ...files('evals')];
  assert.ok(consumers.some((p) => p.endsWith('state.mjs')));
  assert.deepEqual(consumers.flatMap((p) => deepImports(p, readFileSync(join(REPO, p), 'utf8'), null)), []);
});

test('the module graph is acyclic and shared depends on no other module', () => {
  assert.ok([...graph.values()].some((s) => s.size > 0), 'the graph has edges to check');
  assert.equal(cycle(new Map([...graph].map(([k, v]) => [k, [...v]]))), null);
  assert.deepEqual([...graph.get('shared')], []);
});
