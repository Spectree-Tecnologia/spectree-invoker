#!/usr/bin/env node
// Integrity of the package itself.
//
//   node scripts/check-plugin.mjs [rootDir]
//
// It checks REQUIRED CONTENT, not merely whatever files happen to be present.
// Deleting every specialist must fail loudly — "zero cards checked, OK" is the
// failure mode this file exists to make impossible.
//
// Scope, stated so nobody reads more into a green than it carries:
//   this is structural integrity only. It does not run the protocol's rules, it
//   does not observe an agent's behaviour, and it does not prove the plugin works
//   inside a harness. Those are three different checks and only one of them is here.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const problems = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);

const has = (p) => existsSync(join(root, p));
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const readJson = (p) => {
  if (!has(p)) { fail(p, 'missing'); return null; }
  try { return JSON.parse(read(p)); } catch (e) { fail(p, `invalid JSON — ${e.message}`); return null; }
};
const listMd = (dir) => (has(dir) ? readdirSync(join(root, dir)).filter((f) => f.endsWith('.md')).sort() : []);

function frontmatter(abs) {
  const text = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const out = {};
  for (const line of text.slice(3, end).split('\n')) {
    const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

// --- 1. required directories -------------------------------------------------
const REQUIRED_DIRS = ['protocol', 'protocol/roles', 'adapters', 'schemas', 'scripts', 'agents', 'commands', 'tests'];
for (const d of REQUIRED_DIRS) {
  if (!has(d) || !statSync(join(root, d)).isDirectory()) fail(d, 'required directory missing');
}

// --- 2. the protocol is the source, and it must be complete ------------------
const manifest = readJson('protocol/manifest.json');
const REQUIRED_ROLES = [
  'solutions-architect', 'full-stack-developer', 'quality-engineer',
  'platform-engineer', 'integration-engineer', 'typesafe-engineer',
];

if (manifest) {
  if (manifest.core?.length !== 14) fail('protocol/manifest.json', `core lists ${manifest.core?.length ?? 0} fragments; the protocol has 14`);
  for (const f of manifest.core ?? []) if (!has(`protocol/${f}`)) fail('protocol/manifest.json', `core names "${f}", which does not exist`);
  const declared = new Set(manifest.roles ?? []);
  for (const r of REQUIRED_ROLES) {
    if (!declared.has(r)) fail('protocol/manifest.json', `does not declare the required specialist "${r}"`);
    if (!has(`protocol/roles/${r}.md`)) fail(`protocol/roles/${r}.md`, 'required specialist body missing');
  }
  // The count is the required list, not a literal: a type is added by naming it above, never by a
  // number someone forgot to update. And an extra is named, because "declares 7" says nothing
  // about which one entered without passing through here.
  for (const r of declared) {
    if (!REQUIRED_ROLES.includes(r)) fail('protocol/manifest.json', `declares "${r}", which is not a specialist the squad has`);
  }
}

// --- 3. every adapter renders every required role ----------------------------
const adapters = has('adapters')
  ? readdirSync(join(root, 'adapters'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
  : [];
if (adapters.length === 0) fail('adapters/', 'no adapter present; the package ships for no harness');
for (const id of adapters) {
  const a = readJson(`adapters/${id}/adapter.json`);
  if (!a) continue;
  for (const k of ['adapter_id', 'display_name', 'entrypoint', 'capabilities', 'targets']) {
    if (!(k in a)) fail(`adapters/${id}/adapter.json`, `missing "${k}"`);
  }
  if (a.adapter_id !== id) fail(`adapters/${id}/adapter.json`, `adapter_id "${a.adapter_id}" does not match its directory`);
  for (const r of REQUIRED_ROLES) {
    if (!has(`adapters/${id}/roles/${r}.json`)) fail(`adapters/${id}/roles/${r}.json`, 'required specialist metadata missing for this adapter');
  }
}

// --- 4. Claude Code entrypoint and rendered cards ----------------------------
if (!has('CLAUDE.md')) fail('CLAUDE.md', "missing — it is the Invoker's definition and ships inside the plugin");
if (!has('commands/invoker.md')) fail('commands/invoker.md', 'the Claude Code entrypoint is missing');

const cards = listMd('agents');
for (const r of REQUIRED_ROLES) {
  if (!cards.includes(`${r}.md`)) fail(`agents/${r}.md`, 'required specialist card missing');
}
for (const file of cards) {
  const where = `agents/${file}`;
  const fm = frontmatter(join(root, 'agents', file));
  if (!fm) { fail(where, 'no frontmatter block'); continue; }
  for (const k of ['name', 'description']) if (!fm[k]) fail(where, `frontmatter missing "${k}"`);
  const stem = basename(file, '.md');
  if (fm.name && fm.name !== stem) fail(where, `frontmatter name "${fm.name}" does not match the filename "${stem}"`);
}

for (const file of has('commands') ? readdirSync(join(root, 'commands')).filter((f) => f.endsWith('.md')) : []) {
  const fm = frontmatter(join(root, 'commands', file));
  if (!fm) fail(`commands/${file}`, 'no frontmatter block');
  else if (!fm.description) fail(`commands/${file}`, 'frontmatter missing "description"');
}

// --- 5. Codex entrypoint and specialists -------------------------------------
if (adapters.includes('codex')) {
  const a = readJson('adapters/codex/adapter.json');
  const skill = a?.targets?.skill_dir;
  const agentsDir = a?.targets?.agents_dir;
  if (!has(a?.targets?.core ?? 'nope')) fail(a?.targets?.core ?? 'codex core', 'the Codex squad document is missing');
  if (skill) {
    if (!has(`${skill}/SKILL.md`)) fail(`${skill}/SKILL.md`, 'the Codex skill is missing');
    for (const r of REQUIRED_ROLES) {
      const t = `${agentsDir}/${r.replace(/-/g, '_')}.toml`;
      if (!has(t)) fail(t, 'required Codex specialist missing');
      else {
        const body = read(t);
        for (const key of ['name =', 'description =', 'developer_instructions =']) {
          if (!body.includes(key)) fail(t, `missing "${key.replace(' =', '')}"`);
        }
      }
    }
  }
}

// --- 6. manifests ------------------------------------------------------------
const plugin = readJson('.claude-plugin/plugin.json');
if (plugin) {
  for (const k of ['name', 'description', 'version']) if (!plugin[k]) fail('.claude-plugin/plugin.json', `missing "${k}"`);
  if (plugin.version && !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(plugin.version)) {
    fail('.claude-plugin/plugin.json', `version "${plugin.version}" is not semver`);
  }
}
const marketplace = readJson('.claude-plugin/marketplace.json');
if (marketplace) {
  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) fail('.claude-plugin/marketplace.json', 'plugins[] missing or empty');
  else for (const entry of marketplace.plugins) {
    if (!entry.source) fail('.claude-plugin/marketplace.json', `entry "${entry.name}" has no source`);
    else if (!existsSync(resolve(root, entry.source))) fail('.claude-plugin/marketplace.json', `source "${entry.source}" does not exist`);
    if (plugin && entry.name && entry.name !== plugin.name) {
      fail('.claude-plugin/marketplace.json', `entry name "${entry.name}" does not match plugin.json name "${plugin.name}"`);
    }
  }
}

// --- 7. schemas parse and carry an $id ---------------------------------------
for (const f of ['work.mjs', 'mutation-probe.mjs', 'verification.mjs', 'lib/work.mjs', 'lib/mutation.mjs', 'lib/verification.mjs']) {
  if (!has(`scripts/${f}`)) fail(`scripts/${f}`, 'required reliability command or library missing');
}

const REQUIRED_SCHEMAS = ['common.json', 'change.schema.json', 'dispatch.schema.json', 'evidence.schema.json', 'deferred.schema.json', 'approval.schema.json', 'preparation.schema.json', 'receipt.schema.json'];
for (const f of ['tasks.mjs', 'reports.mjs', 'evals.mjs', 'lib/context.mjs', 'lib/agent-runner.mjs', 'lib/task-executor.mjs', 'lib/engineering-reports.mjs', 'lib/agent-evals.mjs']) {
  if (!has(`scripts/${f}`)) fail(`scripts/${f}`, 'required evolution command or library missing');
}
for (const id of ['codex', 'claude-code']) for (const phase of ['core', 'implement', 'diagnose', 'review']) {
  if (!has(`protocol/runtime/${phase}.md`)) fail(`protocol/runtime/${phase}.md`, 'required phase source missing');
  if (!has(`adapters/${id}/dist/context/${phase}.md`)) fail(`adapters/${id}/dist/context/${phase}.md`, 'required generated context missing');
}
if (!has('evals/cases.json')) fail('evals/cases.json', 'required live evaluation cases missing');
for (const s of REQUIRED_SCHEMAS) {
  const doc = readJson(`schemas/${s}`);
  if (doc && !doc.$id) fail(`schemas/${s}`, 'missing $id');
}

// --- 8. cross-references into the rendered core ------------------------------
if (has('CLAUDE.md')) {
  const claude = read('CLAUDE.md');
  const sections = new Set([...claude.matchAll(/^## (\d+)\. /gm)].map((m) => Number(m[1])));
  const prose = ['CLAUDE.md', ...(has('AGENTS.md') ? ['AGENTS.md'] : []),
    ...cards.map((f) => `agents/${f}`),
    ...(has('commands') ? readdirSync(join(root, 'commands')).filter((f) => f.endsWith('.md')).map((f) => `commands/${f}`) : [])];
  for (const rel of prose) {
    for (const m of read(rel).matchAll(/Section (\d+)\b/g)) {
      if (!sections.has(Number(m[1]))) fail(rel, `refers to "Section ${m[1]}", which the rendered core does not have`);
    }
  }
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const claim = /^([A-Z][a-z]+) invariants\./m.exec(claude);
  if (claim) {
    const claimed = words[claim[1].toLowerCase()];
    const listed = (claude.match(/^\*\*5\.\d+ — /gm) ?? []).length;
    if (claimed !== undefined && claimed !== listed) fail('CLAUDE.md', `says "${claim[1]} invariants" but lists ${listed} under 5.x`);
  }
}

// --- 9. the required test set is not empty -----------------------------------
const testFiles = has('tests') ? readdirSync(join(root, 'tests')).filter((f) => /\.test\.mjs$/.test(f)) : [];
if (testFiles.length === 0) fail('tests/', 'no test file — an empty suite is not a passing suite');

// --- report ------------------------------------------------------------------
if (problems.length > 0) {
  console.error(`check:plugin FAILED -- ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ${p}`);
  console.error('');
  process.exit(1);
}
console.log(
  `check:plugin OK -- ${adapters.length} adapter(s), ${REQUIRED_ROLES.length} required specialist(s), ` +
  `${REQUIRED_SCHEMAS.length} schema(s), ${testFiles.length} test file(s). Structural integrity only.`);
