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

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
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

// --- 4b. the squad's method skills, on every harness ----------------------------
// Declared in the manifest, sourced once in protocol/skills/, rendered by each adapter. A skill a
// card points at and no harness ships is a pointer to nothing.
for (const name of manifest?.skills ?? []) {
  if (!has(`protocol/skills/${name}.md`)) fail(`protocol/skills/${name}.md`, 'declared squad skill has no source');
  for (const id of adapters) {
    const dir = readJson(`adapters/${id}/adapter.json`)?.targets?.skills_dir;
    if (!dir) { fail(`adapters/${id}/adapter.json`, 'targets.skills_dir missing; the squad skills ship nowhere'); continue; }
    const f = `${dir}/${name}/SKILL.md`;
    if (!has(f)) { fail(f, 'squad skill not rendered for this harness'); continue; }
    const fm = frontmatter(join(root, f));
    if (!fm?.description) fail(f, 'frontmatter missing "description"');
    if (fm?.name !== name) fail(f, `frontmatter name "${fm?.name}" does not match "${name}"`);
    for (const [k, v] of Object.entries(readJson(`adapters/${id}/adapter.json`)?.skill_frontmatter ?? {}))
      if (fm?.[k] !== String(v)) fail(f, `frontmatter "${k}" is "${fm?.[k]}", the adapter declares "${v}"`);
  }
}
// Only /spectree:invoker belongs in the Founder's slash menu. A squad skill is loaded by the agent
// whose phase reaches it; hidden with user-invocable, never with disable-model-invocation, which
// would keep the agents from loading it.
if (adapters.includes('claude-code')) {
  const fmExtra = readJson('adapters/claude-code/adapter.json')?.skill_frontmatter ?? {};
  if (fmExtra['user-invocable'] !== false) fail('adapters/claude-code/adapter.json', 'skill_frontmatter must set "user-invocable": false; the squad skills would show in the slash menu');
  if ('disable-model-invocation' in fmExtra) fail('adapters/claude-code/adapter.json', 'skill_frontmatter must not set "disable-model-invocation"; the agents could not load the squad skills');
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
for (const f of ['work.mjs', 'mutation-probe.mjs', 'verification.mjs', 'pass2.mjs', 'lib/change/work.mjs', 'lib/evidence/mutation.mjs', 'lib/evidence/pass2.mjs', 'lib/evidence/verification.mjs']) {
  if (!has(`scripts/${f}`)) fail(`scripts/${f}`, 'required reliability command or library missing');
}

const REQUIRED_SCHEMAS = ['common.json', 'change.schema.json', 'dispatch.schema.json', 'evidence.schema.json', 'deferred.schema.json', 'approval.schema.json', 'preparation.schema.json', 'receipt.schema.json'];
for (const f of ['scripts/bridge.mjs', 'scripts/lib/execution/bridge-mailbox.mjs', 'docs/resilient-execution.md', 'scripts/delivery.mjs', 'scripts/lib/evidence/delivery.mjs', 'scripts/lib/evidence/delivery-contract.mjs', 'scripts/lib/evidence/delivery-ledger.mjs', 'docs/delivery-reliability.md']) {
  if (!has(f)) fail(f, 'required resilient execution artifact missing');
}
for (const f of ['tasks.mjs', 'reports.mjs', 'retro.mjs', 'lib/evaluation/retro.mjs', 'evals.mjs', 'adopt.mjs', 'lib/closure/adoption.mjs', 'lib/evaluation/flow-evals.mjs', 'lib/shared/process-supervisor.mjs', 'lib/shared/process-worker.mjs', 'lib/shared/process-job.ps1', 'lib/shared/process-job.cs', 'lib/execution/context.mjs', 'lib/execution/agent-runner.mjs', 'lib/execution/task-executor.mjs', 'lib/evaluation/engineering-reports.mjs', 'lib/evaluation/agent-evals.mjs']) {
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

// --- 8b. the rendered core carries every rule, within its size ceiling ------
// The rules were separated from their rationale to keep the core small enough to load on every
// session. What keeps that from losing a rule is this inventory, read off the protocol before the
// separation: a core that drops one fails here, and so does a core that grows past the ceiling.
const inventory = readJson('protocol/rules.json');
if (inventory) {
  const norm = (t) => t.replace(/\s+/g, ' ').trim();
  if (!Array.isArray(inventory.rules) || inventory.rules.length === 0) fail('protocol/rules.json', 'the rule inventory is empty');
  if (!has(inventory.rationale ?? '')) fail(inventory.rationale ?? 'protocol/rules.json', 'the protocol rationale is missing');
  for (const id of adapters) {
    const core = readJson(`adapters/${id}/adapter.json`)?.targets?.core;
    if (!core || !has(core)) continue;
    const raw = read(core);
    const text = norm(raw);
    if (Buffer.byteLength(raw) > inventory.core_ceiling_bytes) {
      fail(core, `is ${Buffer.byteLength(raw)} bytes, over the ${inventory.core_ceiling_bytes}-byte ceiling in protocol/rules.json`);
    }
    if (!raw.includes('protocol-rationale.md')) fail(core, 'does not point at the protocol rationale');
    for (const r of inventory.rules ?? []) {
      if (!text.includes(norm(r.text))) fail(core, `dropped the rule "${r.text}" (Section ${Number(r.section)})`);
    }
  }
  // The two longest cards went through the same separation, and are held to it the same way, in
  // the file each adapter actually ships.
  for (const [role, card] of Object.entries(inventory.cards ?? {})) {
    for (const id of adapters) {
      const targets = readJson(`adapters/${id}/adapter.json`)?.targets ?? {};
      const rel = targets.roles_dir
        ? `${targets.roles_dir}/${role}${targets.role_ext}`
        : targets.agents_dir && `${targets.agents_dir}/${readJson(`adapters/${id}/roles/${role}.json`)?.name}.toml`;
      if (!rel || !has(rel)) continue;
      const raw = read(rel);
      const text = norm(raw);
      if (Buffer.byteLength(raw) > card.ceiling_bytes) {
        fail(rel, `is ${Buffer.byteLength(raw)} bytes, over the ${card.ceiling_bytes}-byte ceiling in protocol/rules.json`);
      }
      if (!raw.includes('protocol-rationale.md')) fail(rel, 'does not point at the protocol rationale');
      for (const r of card.rules ?? []) {
        if (!text.includes(norm(r.text))) fail(rel, `dropped the rule "${r.text}" (${r.section})`);
      }
    }
  }
}

// --- 8c. no normative sentence leaves the core without being named -------------
// 8b holds each rule by its lead phrase, so a core that keeps every lead and empties the body
// beneath it passed — that is how task 8 (#76) moved a dozen binding sentences into the
// rationale, which binds nothing. Here every sentence of the core protocol that says never, must,
// only, refuse, at most, cannot, requires, always, shall, no or not is listed in
// protocol/rules.json. One that disappears fails; one that appears fails until it is listed.
// `--write-normative` rewrites the list, so a removal is always a visible line in the diff. A rule
// written without any of those words is not covered, and neither are the cards: that is review.
function normativeSentences(markdown) {
  const text = markdown.replace(/```[\s\S]*?```/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const out = [];
  for (const para of text.split(/\n\s*\n/)) {
    const flat = para.replace(/\s+/g, ' ').trim();
    for (const s of flat.split(/(?<=[.;])\s+(?=[A-Z*`(])/)) {
      if (/\b(never|must|only|refuses?|refused|at most|cannot|neither|nothing|no|not|requires?|required|always|shall)\b/i.test(s)) out.push(s.trim());
    }
  }
  return out;
}
if (inventory && manifest) {
  const source = (manifest.core ?? []).filter((f) => has(`protocol/${f}`)).map((f) => read(`protocol/${f}`)).join('\n\n');
  const found = normativeSentences(source);
  if (process.argv.includes('--write-normative')) {
    const raw = JSON.parse(read('protocol/rules.json'));
    raw.core_normative = found;
    writeFileSync(join(root, 'protocol/rules.json'), JSON.stringify(raw, null, 2) + '\n');
    console.log(`protocol/rules.json: core_normative rewritten with ${found.length} sentence(s)`);
  } else {
    const listed = inventory.core_normative;
    if (!Array.isArray(listed) || listed.length === 0) fail('protocol/rules.json', 'core_normative is empty; run check-plugin.mjs --write-normative');
    else {
      // Counted, not deduplicated: deleting one of two copies of a sentence is still a deletion.
      const tally = (list) => list.reduce((m, s) => m.set(s, (m.get(s) ?? 0) + 1), new Map());
      const have = tally(found);
      const known = tally(listed);
      for (const [s, n] of known) if ((have.get(s) ?? 0) < n) fail('protocol/', `dropped the normative sentence "${s.slice(0, 120)}"; remove it from core_normative in the same change and name it in the proposal`);
      for (const [s, n] of have) if ((known.get(s) ?? 0) < n) fail('protocol/', `normative sentence not in core_normative: "${s.slice(0, 120)}"; run check-plugin.mjs --write-normative`);
    }
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
