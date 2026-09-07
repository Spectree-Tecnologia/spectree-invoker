#!/usr/bin/env node
// Install the squad into a Codex consumer project — or say exactly what it would do.
//
//   node scripts/install-codex.mjs <project-dir> [--apply] [--global] [--force]
//
// Default is a DRY RUN: it prints the plan and writes nothing. `--apply` performs it.
//
// What it guarantees, because an installer that gets these wrong is worse than none:
//
//   * idempotent — running it twice changes nothing the second time;
//   * contained — every destination is inside the project (or inside $HOME with --global);
//     a path that escapes is refused, not clamped;
//   * never overwrites the consumer's own instructions — an existing AGENTS.md gets an
//     appended pointer, once, and is never rewritten;
//   * nothing global by default, and no symlink anywhere: plain file copies, so Windows
//     needs no privilege;
//   * the scripts the skill calls travel with it, because a skill that tells the agent to
//     run a file that was never copied is a broken install that looks complete.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, cpSync } from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const pkg = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const global_ = argv.includes('--global');
const force = argv.includes('--force');
const target = argv.find((a) => !a.startsWith('--'));

if (!target) {
  console.error('usage: install-codex.mjs <project-dir> [--apply] [--global] [--force]');
  process.exit(2);
}

const projectRoot = resolve(target);
if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
  console.error(`not a directory: ${projectRoot}`);
  process.exit(1);
}

const skillRoot = global_ ? join(homedir(), '.agents', 'skills') : join(projectRoot, '.agents', 'skills');
const agentsRoot = global_ ? join(homedir(), '.codex', 'agents') : join(projectRoot, '.codex', 'agents');
const squadRoot = join(projectRoot, '.spectree', 'squad');

/** Containment: a destination that escapes its root is refused outright. */
function contained(root, p) {
  const rel = relative(root, p);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}
for (const [root, p] of [[global_ ? homedir() : projectRoot, skillRoot], [global_ ? homedir() : projectRoot, agentsRoot], [projectRoot, squadRoot]]) {
  if (!contained(root, p)) { console.error(`refusing: ${p} escapes ${root}`); process.exit(1); }
}

const dist = join(pkg, 'adapters', 'codex', 'dist');
if (!existsSync(dist)) { console.error('adapters/codex/dist is missing — run `node scripts/build.mjs` first'); process.exit(1); }

const plan = [];
const same = (a, b) => existsSync(b) && readFileSync(a, 'utf8') === readFileSync(b, 'utf8');

function planCopy(from, to, label) {
  if (same(from, to)) plan.push({ op: 'unchanged', to, label });
  else plan.push({ op: existsSync(to) ? 'overwrite' : 'create', from, to, label });
}

function planWrite(content, to, label) {
  if (existsSync(to) && readFileSync(to, 'utf8') === content) plan.push({ op: 'unchanged', to, label });
  else plan.push({ op: existsSync(to) ? 'overwrite' : 'create', content, to, label });
}

// 1. the protocol document and the scripts the skill actually calls
planCopy(join(dist, 'SQUAD.md'), join(squadRoot, 'SQUAD.md'), 'squad protocol');
for (const f of ['state.mjs', 'capabilities.mjs', 'verify-change.mjs']) {
  planCopy(join(pkg, 'scripts', f), join(squadRoot, 'scripts', f), 'script the skill calls');
}
for (const f of readdirSync(join(pkg, 'scripts', 'lib'))) {
  planCopy(join(pkg, 'scripts', 'lib', f), join(squadRoot, 'scripts', 'lib', f), 'library');
}
for (const f of readdirSync(join(pkg, 'schemas'))) {
  planCopy(join(pkg, 'schemas', f), join(squadRoot, 'schemas', f), 'schema');
}

// 1b. which build this is. A consumer carries no plugin.json and no protocol/, so without
// this file the installed squad cannot say which version of itself it is running — and a boot
// report that cannot name its own build is a report two different builds would write identically.
const stamp = JSON.stringify({
  package_version: JSON.parse(readFileSync(join(pkg, '.claude-plugin', 'plugin.json'), 'utf8')).version,
  protocol_version: JSON.parse(readFileSync(join(pkg, 'protocol', 'manifest.json'), 'utf8')).protocol_version,
  installed_by: 'scripts/install-codex.mjs',
}, null, 2) + '\n';
planWrite(stamp, join(squadRoot, 'installed.json'), 'which build this is');

// 2. the skill
planCopy(join(dist, 'skills', 'spectree-invoker', 'SKILL.md'), join(skillRoot, 'spectree-invoker', 'SKILL.md'), 'skill');

// 3. the specialists, where Codex actually looks for custom agents
for (const f of readdirSync(join(dist, 'agents'))) {
  planCopy(join(dist, 'agents', f), join(agentsRoot, f), 'specialist');
}

// 4. AGENTS.md — never rewritten
const POINTER_MARK = '<!-- spectree-invoker -->';
const POINTER = `\n${POINTER_MARK}\n## Spectree Invoker\n\nThe squad's protocol is \`.spectree/squad/SQUAD.md\` and its entrypoint is the \`spectree-invoker\`\nskill. Invoke it with \`$spectree-invoker\`. That document defines the squad; **this file defines\nthis project**, and the squad reads it as context, never as its own rules.\n`;
const agentsMd = join(projectRoot, 'AGENTS.md');
if (!existsSync(agentsMd)) plan.push({ op: 'create', to: agentsMd, label: 'AGENTS.md pointer (none existed)' });
else if (readFileSync(agentsMd, 'utf8').includes(POINTER_MARK)) plan.push({ op: 'unchanged', to: agentsMd, label: 'pointer already present' });
else plan.push({ op: 'append', to: agentsMd, label: 'pointer appended — the existing file is preserved in full' });

// --- report ------------------------------------------------------------------
const counts = plan.reduce((a, p) => ({ ...a, [p.op]: (a[p.op] ?? 0) + 1 }), {});
console.log(`${apply ? 'installing' : 'DRY RUN — nothing will be written'}  ->  ${projectRoot}`);
console.log(`  skill      ${skillRoot}`);
console.log(`  agents     ${agentsRoot}`);
console.log(`  protocol   ${squadRoot}\n`);
for (const p of plan) {
  if (p.op === 'unchanged') continue;
  console.log(`  ${p.op.padEnd(9)} ${relative(projectRoot, p.to) || p.to}   (${p.label})`);
}
console.log(`\n  ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);

const overwrites = plan.filter((p) => p.op === 'overwrite');
if (overwrites.length && !force) {
  console.error(`\nrefusing: ${overwrites.length} file(s) would be overwritten. Re-run with --force if that is intended:`);
  for (const o of overwrites) console.error(`  ${relative(projectRoot, o.to)}`);
  process.exit(1);
}

if (!apply) { console.log('\nnothing written. Re-run with --apply to perform this plan.'); process.exit(0); }

for (const p of plan) {
  if (p.op === 'unchanged') continue;
  mkdirSync(dirname(p.to), { recursive: true });
  if (p.op === 'append') writeFileSync(p.to, readFileSync(p.to, 'utf8').replace(/\s*$/, '\n') + POINTER);
  else if (p.content !== undefined) writeFileSync(p.to, p.content);
  else if (p.to === agentsMd && !p.from) writeFileSync(p.to, `# AGENTS.md\n${POINTER}`);
  else cpSync(p.from, p.to);
}
console.log('\ninstalled. Verify with: node .spectree/squad/scripts/capabilities.mjs');
