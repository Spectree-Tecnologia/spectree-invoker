#!/usr/bin/env node
// What this harness actually gives the squad — and how each answer was reached.
//
//   node scripts/capabilities.mjs [--json]
//
// Every line is tagged VERIFIED, DECLARED or UNKNOWN:
//
//   VERIFIED  observed here, without side effects
//   DECLARED  the adapter or the environment says so; nothing here confirmed it
//   UNKNOWN   not determinable without an action this refuses to take
//
// It runs nothing destructive, opens no network connection, and reads no secret.
// A permission is never tested by exercising it: "can I delete?" is not answered
// by deleting, and a capability probe that writes is a capability probe that broke
// something on the day it was wrong.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const pkgRoot = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const projectRoot = process.env.SPECTREE_PROJECT_ROOT ?? process.cwd();

const V = 'VERIFIED', D = 'DECLARED', U = 'UNKNOWN';
const facts = [];
const add = (name, value, confidence, note) => facts.push({ name, value, confidence, note });

function tryRun(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}

// --- harness -----------------------------------------------------------------
const env = process.env;
let harness = 'unknown', how = U;
if (env.CLAUDE_PLUGIN_ROOT || env.CLAUDECODE) { harness = 'claude-code'; how = V; }
else if (env.CODEX_HOME || env.CODEX_SANDBOX || env.OPENAI_CODEX) { harness = 'codex'; how = V; }
else if (env.SPECTREE_HARNESS) { harness = env.SPECTREE_HARNESS; how = D; }
add('harness', harness, how, how === V ? 'inferred from an environment variable the harness sets' : 'no harness marker in the environment');
add('harness.version', env.CLAUDE_CODE_VERSION ?? env.CODEX_VERSION ?? 'unknown', env.CLAUDE_CODE_VERSION || env.CODEX_VERSION ? V : U);

// --- roots -------------------------------------------------------------------
add('package_root', pkgRoot, V, 'resolved from this script, so it survives being installed outside the project');
add('project_root', projectRoot, V, env.SPECTREE_PROJECT_ROOT ? 'from SPECTREE_PROJECT_ROOT' : 'from the working directory');
add('package_root.has_space', /\s/.test(pkgRoot) ? 'yes' : 'no', V);
add('project_root.has_space', /\s/.test(projectRoot) ? 'yes' : 'no', V);

// --- local execution ---------------------------------------------------------
const node = tryRun(process.execPath, ['-v']);
add('shell', node ? 'available' : 'unavailable', node ? V : U, node ? 'a child process ran and returned' : 'could not spawn a child process');
add('runtime', `node ${process.versions.node}`, V);
add('platform', `${process.platform}/${process.arch}`, V);

// --- git ---------------------------------------------------------------------
const gitVer = tryRun('git', ['--version']);
let inWorkTree = null, branch = null, revision = null, remotes = null;
if (gitVer) {
  inWorkTree = tryRun('git', ['-C', projectRoot, 'rev-parse', '--is-inside-work-tree']) === 'true';
  if (inWorkTree) {
    branch = tryRun('git', ['-C', projectRoot, 'rev-parse', '--abbrev-ref', 'HEAD']);
    revision = tryRun('git', ['-C', projectRoot, 'rev-parse', 'HEAD']);
    remotes = (tryRun('git', ['-C', projectRoot, 'remote']) ?? '').split('\n').filter(Boolean).length;
  }
}
add('git', gitVer ? gitVer.replace('git version ', '') : 'unavailable', gitVer ? V : U);
add('git.work_tree', inWorkTree === null ? 'unknown' : String(inWorkTree), inWorkTree === null ? U : V);
add('git.branch', branch ?? 'unknown', branch ? V : U);
add('git.revision', revision ? revision.slice(0, 8) : 'unknown', revision ? V : U);
add('git.remotes', remotes === null ? 'unknown' : String(remotes), remotes === null ? U : V);
add('git.default_branch_protected', 'unknown', U,
  'not determinable without an authenticated API call this refuses to make. Where protection is absent, the gate is the only control.');

// --- network -----------------------------------------------------------------
add('network', 'unknown', U,
  'not probed: reaching a host to find out whether reaching hosts is allowed is the probe answering itself. The Integration Engineer is the only role that should hold it.');

// --- browser -----------------------------------------------------------------
add('browser', 'unknown', U, 'a browser driver is a harness tool, not a filesystem fact; the adapter declares it and nothing here confirms it');

// --- adapters: what they declare ---------------------------------------------
const declared = {};
const adaptersDir = join(pkgRoot, 'adapters');
if (existsSync(adaptersDir)) {
  for (const id of readdirSync(adaptersDir).sort()) {
    const f = join(adaptersDir, id, 'adapter.json');
    if (!existsSync(f)) continue;
    const a = JSON.parse(readFileSync(f, 'utf8'));
    declared[id] = a.capabilities ?? {};
    for (const [k, v] of Object.entries(a.capabilities ?? {})) {
      add(`adapter.${id}.${k}`, v, v === 'unknown' ? U : D, 'declared by the adapter, not confirmed here');
    }
  }
}

// --- the operating mode this adds up to --------------------------------------
const active = declared[harness] ?? {};
const isolation = active.context_isolation ?? 'unknown';
const subagents = active.subagents ?? 'unknown';
const mode =
  subagents !== 'declared' ? 'single-context'
  : isolation === 'declared' ? 'delegating-with-isolation'
  : 'delegating-without-proven-isolation';
add('operating_mode', mode, isolation === 'declared' ? D : U);

// --- role matrix -------------------------------------------------------------
// responsibility -> capability -> real restriction -> how it is verified -> residual limit
const MATRIX = [
  { role: 'invoker', needs: ['shell', 'git'], restriction: 'writes no project file by protocol',
    enforced_by: 'protocol only', residual: 'nothing in the harness prevents the Invoker from writing; the restriction is behavioural' },
  { role: 'solutions_architect', needs: [], restriction: 'writes only docs/changes/<slug>/ and docs/ROADMAP.md',
    enforced_by: 'protocol; adapter tool list where the harness supports one', residual: 'a card-level tool list narrows tools, not paths' },
  { role: 'full_stack_developer', needs: ['shell'], restriction: 'writes only its module\'s paths; no mutable git',
    enforced_by: 'protocol; path ownership checked after the fact by verify-change',
    residual: 'the Developer HAS shell and file write. Nothing stops a destructive command at the moment it runs; ownership is verified afterwards, not prevented.' },
  { role: 'quality_engineer', needs: ['shell'], restriction: 'writes only test files; never fixes',
    enforced_by: 'protocol; verified after the fact by the diff classifier',
    residual: 'the Quality Engineer HAS shell and file write, same as the Developer' },
  { role: 'platform_engineer', needs: ['shell', 'git'], restriction: 'the only role with git, database and deploy',
    enforced_by: 'protocol; gates for irreversible operations',
    residual: 'largest blast radius, and the only one whose restriction is a gate rather than a boundary' },
  { role: 'integration_engineer', needs: ['network'], restriction: 'reads external systems; writes nothing anywhere',
    enforced_by: 'protocol; adapter tool list',
    residual: 'network is UNKNOWN here, so this role may be undeliverable on this harness' },
];

// --- missing checkers --------------------------------------------------------
const expected = ['check-plugin.mjs', 'build.mjs', 'state.mjs', 'verify-change.mjs', 'capabilities.mjs'];
const missing = expected.filter((f) => !existsSync(join(pkgRoot, 'scripts', f)));
add('checkers.missing', missing.length ? missing.join(', ') : 'none', V);

// --- output ------------------------------------------------------------------
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ facts, role_matrix: MATRIX, declared }, null, 2));
  process.exit(0);
}

const w = Math.max(...facts.map((f) => f.name.length));
console.log('capabilities — VERIFIED observed here · DECLARED asserted, not confirmed · UNKNOWN not determinable without acting\n');
for (const f of facts) {
  console.log(`  ${f.name.padEnd(w)}  ${String(f.value).padEnd(28)} ${f.confidence}`);
  if (f.note) console.log(`  ${' '.repeat(w)}  ${f.note}`);
}
console.log('\nrole matrix — responsibility · restriction · what enforces it · what remains\n');
for (const m of MATRIX) {
  console.log(`  ${m.role}`);
  console.log(`    needs      ${m.needs.join(', ') || '—'}`);
  console.log(`    restricted ${m.restriction}`);
  console.log(`    enforced   ${m.enforced_by}`);
  console.log(`    residual   ${m.residual}`);
}
if (mode !== 'delegating-with-isolation') {
  console.log(`\n  NOTE  operating mode is "${mode}". A Quality Engineer dispatched without proven context isolation`);
  console.log('        is not the independent adversary the pipeline assumes. Say so in the report, and do not');
  console.log('        close a gate whose precondition is that independence.');
}
