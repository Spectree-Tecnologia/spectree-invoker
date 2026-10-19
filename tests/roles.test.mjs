// The roles under docs/roles/ describe the code that shipped. A role naming a file that no longer
// exists, or a code that breaks the naming in refusals.md, has drifted from that code. Each guard
// is first shown rejecting the drift it exists to catch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './helpers.mjs';

const ROLES = join(REPO, 'docs', 'roles');
const LIB = join(REPO, 'scripts', 'lib');
const roles = () => readdirSync(ROLES).filter((f) => f.endsWith('.md')).map((f) => [f, readFileSync(join(ROLES, f), 'utf8')]);

// A cited file is a backticked path to a .mjs file, read from the repository root, from scripts/ or
// from scripts/lib/. A relative import shown as an example (`../x.mjs`) is not a citation.
function missingCitations(docs, exists) {
  return docs.flatMap(([name, text]) => [...text.matchAll(/`([\w./-]+\/[\w.-]+\.mjs)`/g)]
    .map((m) => m[1]).filter((p) => !p.startsWith('..'))
    .filter((p) => ![p, `scripts/${p}`, `scripts/lib/${p}`].some((c) => exists(c)))
    .map((p) => `${name}: ${p}`));
}
// Links between roles and to the rest of docs/ resolve from the role's own folder.
function missingLinks(docs, exists) {
  return docs.flatMap(([name, text]) => [...text.matchAll(/\]\(([^)#:]+)(?:#[^)]*)?\)/g)]
    .map((m) => m[1]).filter((p) => !exists(join('docs', 'roles', p))).map((p) => `${name}: ${p}`));
}
const onDisk = (rel) => existsSync(join(REPO, rel));

test('the role citation guard recognises a file that no longer exists', () => {
  const doc = [['x.md', '**Example:** `scripts/lib/shared/gone.mjs`, `shared/guard.mjs`, `../change/store.mjs`. See [y](y.md).']];
  assert.deepEqual(missingCitations(doc, onDisk), ['x.md: scripts/lib/shared/gone.mjs']);
  assert.deepEqual(missingLinks(doc, onDisk), ['x.md: y.md']);
});

test('every file and link a role cites exists', () => {
  const docs = roles();
  assert.ok(docs.length >= 5, 'the roles are present');
  assert.deepEqual(missingCitations(docs, onDisk), []);
  assert.deepEqual(missingLinks(docs, onDisk), []);
});

// A code is the first argument of refuse(), or the value of a `code:` key, written as a literal.
const CODE = /\brefuse\(\s*['"]([^'"]+)['"]|\bcode:\s*['"]([^'"]+)['"]/g;
const NAMED = /^[EWI]_[A-Z0-9]+(?:_[A-Z0-9]+)*$/;
function misnamedCodes(files) {
  return files.flatMap(([rel, text]) => [...text.matchAll(CODE)].map((m) => m[1] ?? m[2])
    .filter((c) => !NAMED.test(c)).map((c) => `${rel}: ${c}`));
}

test('the code-name guard recognises a code without its severity prefix', () => {
  assert.deepEqual(misnamedCodes([['x.mjs', "refuse('E_OK', 'm'); refuse('NOT_FOUND', 'm'); return { ok: false, code: 'e_lower' };"]]),
    ['x.mjs: NOT_FOUND', 'x.mjs: e_lower']);
  assert.deepEqual(misnamedCodes([['x.mjs', "{ code: 'W_REVIEW' }, { code: 'I_NOTE' }"]]), []);
});

test('every code under scripts/lib is E_, W_ or I_ followed by upper snake case', () => {
  const files = readdirSync(LIB, { recursive: true }).filter((f) => f.endsWith('.mjs'))
    .map((f) => [f.split('\\').join('/'), readFileSync(join(LIB, f), 'utf8')]);
  assert.deepEqual(misnamedCodes(files), []);
});
