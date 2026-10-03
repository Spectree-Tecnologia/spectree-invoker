#!/usr/bin/env node
// Renders every adapter's files from protocol/ — the single authoritative source.
//
//   node scripts/build.mjs            write the generated files
//   node scripts/build.mjs --check    fail if any generated file is stale (CI)
//
// Determinism: the output is a pure function of protocol/ + adapters/*/adapter.json.
// No timestamps, no host paths, no ordering that depends on the filesystem.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const json = (p) => JSON.parse(read(p));

const GENERATED_MD = (src) =>
  `<!-- GENERATED FILE — do not edit.\n     Source: ${src}\n     Rebuild: node scripts/build.mjs   ·   Verify: node scripts/build.mjs --check -->\n\n`;

/** Replace every {{TOKEN}}. An unresolved token is a build failure, never a silent gap. */
function render(text, tokens, where) {
  return text.replace(/\{\{([A-Z_]+)\}\}/g, (_, name) => {
    if (!(name in tokens)) throw new Error(`${where}: no value for token {{${name}}}`);
    return tokens[name];
  });
}

const manifest = json('protocol/manifest.json');

/** Every file an adapter owns, as { path, content }. Pure; writes nothing. */
export function renderAdapter(adapterId) {
  const a = json(`adapters/${adapterId}/adapter.json`);
  const out = [];
  const coreTokens = { ...a.tokens };


  const core = manifest.core
    .map((f) => render(read(`protocol/${f}`), coreTokens, `protocol/${f}`).replace(/\n+$/, ''))
    .join('\n\n') + '\n';

  const roleBodies = {};
  for (const role of manifest.roles) {
    const meta = json(`adapters/${adapterId}/roles/${role}.json`);
    const tokens = { ...coreTokens, ROLE_TOOLS: (meta.tools_body ?? '').replace(/\n+$/, '') };
    roleBodies[role] = render(read(`protocol/roles/${role}.md`), tokens, `protocol/roles/${role}.md`);
  }

  for (const phase of ['core', 'implement', 'diagnose', 'review']) {
    // The native implementation runner must receive the real role contract too.
    const role = phase === 'implement' ? '\n' + roleBodies['full-stack-developer'] : '';
    out.push({ path: `adapters/${adapterId}/dist/context/${phase}.md`,
      content: GENERATED_MD(`protocol/runtime/${phase}.md${role ? ' + protocol/roles/full-stack-developer.md' : ''}`) + read(`protocol/runtime/${phase}.md`) + role });
  }

  if (adapterId === 'claude-code') {
    out.push({ path: a.targets.core, content: GENERATED_MD('protocol/ + adapters/claude-code/') + core });
    for (const role of manifest.roles) {
      const meta = json(`adapters/claude-code/roles/${role}.json`);
      const fm = ['---', `name: ${meta.name}`, `description: ${meta.description}`];
      if (meta.tools) fm.push(`tools: ${meta.tools}`);
      fm.push('---', '');
      out.push({ path: `${a.targets.roles_dir}/${role}${a.targets.role_ext}`, content: fm.join('\n') + roleBodies[role] });
    }
  }

  if (adapterId === 'codex') {
    out.push({ path: a.targets.core, content: GENERATED_MD('protocol/ + adapters/codex/') + core });
    const skill = a.targets.skill_dir;
    const sk = json('adapters/codex/skill.json');
    out.push({
      path: `${skill}/SKILL.md`,
      content:
        `---\nname: ${sk.name}\ndescription: ${sk.description}\n---\n\n` +
        GENERATED_MD('protocol/ + adapters/codex/') +
        read('adapters/codex/skill-body.md'),
    });
    for (const role of manifest.roles) {
      const meta = json(`adapters/codex/roles/${role}.json`);
      const body = roleBodies[role].trim();
      if (body.includes("'''")) throw new Error(`${role}: body contains ''' and cannot be a TOML literal block`);
      const lines = [
        `# GENERATED FILE — do not edit. Source: protocol/roles/${role}.md + adapters/codex/roles/${role}.json`,
        `# Rebuild: node scripts/build.mjs`,
        `name = ${JSON.stringify(meta.name)}`,
        `description = ${JSON.stringify(meta.description)}`,
      ];
      if (meta.model_reasoning_effort) lines.push(`model_reasoning_effort = ${JSON.stringify(meta.model_reasoning_effort)}`);
      lines.push(`developer_instructions = '''`, body, `'''`, '');
      // Codex loads custom agents from `.codex/agents/` (project) or `~/.codex/agents/`
      // (global) — NOT from a skill's own agents/ subfolder. The installer places them there.
      out.push({ path: `${a.targets.agents_dir}/${meta.name}.toml`, content: lines.join('\n') });
    }
  }

  return out;
}

export function adapterIds() {
  return readdirSync(join(root, 'adapters'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

// --- CLI ---------------------------------------------------------------------

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const mode = process.argv[2] ?? '--write';

  let stale = 0, written = 0;
  for (const id of adapterIds()) {
    for (const f of renderAdapter(id)) {
      const abs = join(root, f.path);
      const current = existsSync(abs) ? readFileSync(abs, 'utf8').replace(/\r\n/g, '\n') : null;
      if (current === f.content) continue;
      if (mode === '--check') { stale++; console.error(`stale: ${f.path}`); continue; }
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, f.content);
      written++;
      console.log(`wrote ${f.path}`);
    }
  }
  if (mode === '--check') {
    if (stale) { console.error(`\nbuild --check FAILED — ${stale} generated file(s) do not match protocol/. Run: node scripts/build.mjs`); process.exit(1); }
    console.log('build --check OK -- every generated file matches protocol/.');
  } else {
    console.log(written ? `\n${written} file(s) written.` : 'already up to date.');
  }
}
