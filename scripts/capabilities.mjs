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
import { detectHarness, observedIsolationSignal, playwrightBrowsers, satisfiesFloor } from './lib/shared/index.mjs';

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
const detected = detectHarness(env);
const harness = detected.harness;
const how = detected.verified ? V : harness === 'unknown' ? U : D;
add('harness', harness, how, how === V ? 'inferred from an environment variable the harness sets' : 'no harness marker in the environment');
add('harness.version', env.CLAUDE_CODE_VERSION ?? env.CODEX_VERSION ?? 'unknown', env.CLAUDE_CODE_VERSION || env.CODEX_VERSION ? V : U);

// How this copy was INSTALLED, which is a filesystem fact and not the harness identity. A real
// Codex Desktop run reported `harness: unknown` because it sets none of the variables above,
// and a report that can only say "unknown" about where it is running is harder to read than it
// needs to be. The two are kept apart on purpose: the shape says which installer wrote these
// files, never which program is executing them.
const installShape =
  existsSync(join(pkgRoot, 'protocol', 'manifest.json')) ? 'package checkout'
  : existsSync(join(projectRoot, '.codex', 'agents')) && /[\\/]\.spectree[\\/]squad$/.test(pkgRoot) ? 'codex install'
  : existsSync(join(pkgRoot, '.claude-plugin', 'plugin.json')) ? 'claude-code plugin'
  : 'unknown';
add('install_shape', installShape, installShape === 'unknown' ? U : V,
  'the layout on disk, not the program running it — an installation shape never proves a harness identity');

// --- which build this is -----------------------------------------------------
// A boot report that cannot name its own build is a report two different builds would write
// identically — and the first question asked of every smoke was "which version was that?".
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const stamp = readJson(join(pkgRoot, 'installed.json'));
const pluginJson = readJson(join(pkgRoot, '.claude-plugin', 'plugin.json')) ?? readJson(join(pkgRoot, 'package.json'));
const manifest = readJson(join(pkgRoot, 'protocol', 'manifest.json'));
const packageVersion = pluginJson?.version ?? stamp?.package_version ?? 'unknown';
const protocolVersion = manifest?.protocol_version ?? stamp?.protocol_version ?? 'unknown';
add('package_version', packageVersion, packageVersion === 'unknown' ? U : V,
  packageVersion === 'unknown' ? 'no plugin.json, package.json or installed.json here — say so rather than guessing' : undefined);
add('protocol_version', protocolVersion, protocolVersion === 'unknown' ? U : V);

// --- roots -------------------------------------------------------------------
add('package_root', pkgRoot, V, 'resolved from this script, so it survives being installed outside the project');
add('project_root', projectRoot, V, env.SPECTREE_PROJECT_ROOT ? 'from SPECTREE_PROJECT_ROOT' : 'from the working directory');
add('package_root.has_space', /\s/.test(pkgRoot) ? 'yes' : 'no', V);
add('project_root.has_space', /\s/.test(projectRoot) ? 'yes' : 'no', V);

// --- local execution ---------------------------------------------------------
const node = tryRun(process.execPath, ['-v']);
add('shell', node ? 'available' : 'unavailable', node ? V : U, node ? 'a child process ran and returned' : 'could not spawn a child process');
add('runtime', `node ${process.versions.node}`, V);
// The floor is the package's own `engines.node`, raised when a Node.js release fixes a security
// flaw the squad is exposed to (2026-10-21: Brotli RCE, TLS hostname bypasses, the eMudhra keys).
// npm enforces it only on install; the scripts run on whatever Node the consumer has.
const floor = (readJson(join(pkgRoot, 'package.json')) ?? {}).engines?.node;
const meets = floor ? satisfiesFloor(process.versions.node, floor) : null;
add('runtime.floor',
  meets === true ? 'met' : meets === false ? 'BELOW FLOOR' : 'unknown',
  meets === null ? U : V,
  meets === false ? `node ${process.versions.node} does not satisfy engines "${floor}", the releases carrying the security fixes this package requires. Upgrade Node before running the squad.`
    : meets === null ? (floor ? `engines "${floor}" uses a comparator this does not understand` : 'no engines.node in the package; no floor to compare against')
    : `engines "${floor}"`);
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
// The build a browser test launches IS a filesystem fact. A missing one used to surface only when
// pass 2 ran the browser suite (SYND, passkeys): read it before the baseline instead.
const pw = playwrightBrowsers(projectRoot);
if (pw.status !== 'none') {
  add('browser.playwright_chromium', pw.status, pw.status === 'unknown' ? U : V,
    pw.status === 'absent' ? `missing ${pw.missing.join(', ')} under ${pw.root}. Install before the baseline: npx playwright install chromium`
      : pw.status === 'present' ? `${pw.wanted.join(', ')} under ${pw.root}` : pw.reason);
}

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
// Isolation is reached only through a recorded dispatch probe — never through a bare string in the
// adapter, which is how a field somebody typed once switched the closing NOTE off. Context
// isolation is observable only by dispatching, and this script cannot dispatch: so the probe is
// reported as a recorded observation (DECLARED), with its date, and this script never re-runs it.
const active = declared[harness] ?? {};
const isolation = active.context_isolation ?? 'unknown';
const subagents = active.subagents ?? 'unknown';
const signal = observedIsolationSignal();
add('context_isolation.observed',
  signal ? `yes — dispatch probe, ${signal.observed_at}` : 'no observation recorded for this harness',
  signal ? D : U,
  signal
    ? `${signal.agent ?? 'a specialist'} dispatched as a ${signal.dispatch}. Negative arm: ${signal.negative_arm}. `
      + `Control arm: ${signal.control_arm}. Recorded in the adapter; re-run it when the harness version changes.`
    : 'nobody has dispatched a probe on this harness and recorded it. What the adapter declares is not an observation.');
const mode =
  subagents !== 'declared' ? 'single-context'
  : signal ? 'delegating-with-isolation'
  : 'delegating-without-proven-isolation';
add('operating_mode', mode, signal ? D : U,
  isolation !== 'unknown' && !signal
    ? `the adapter declares context_isolation "${isolation}" with no recorded probe; a declaration does not reach `
      + '"delegating-with-isolation"'
    : undefined);

// --- role matrix -------------------------------------------------------------
// responsibility -> capability -> real restriction -> how it is verified -> residual limit
const MATRIX = [
  { role: 'invoker', needs: ['shell', 'git'], restriction: 'writes no project file by protocol',
    enforced_by: 'protocol only', residual: 'nothing in the harness prevents the Invoker from writing; the restriction is behavioural' },
  { role: 'solutions_architect', needs: [], restriction: 'writes only docs/changes/<slug>/, docs/ROADMAP.md, docs/DOMAIN.md and docs/DECISIONS.md',
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
  { role: 'typesafe_engineer', needs: ['shell', 'network'],
    restriction: 'network to TypeSafe only; writes only the adapter and evaluation files its mission assigns; the credential is read from the environment and never written',
    enforced_by: 'protocol; path ownership verified after the fact; the adapter tool list',
    residual: 'no harness measured scopes the network by host, so "TypeSafe only" is behavioural. The role holds a shell and a paid credential: nothing but the card stops a command from printing the key or spending past the budget.' },
  { role: 'integration_engineer', needs: ['network'], restriction: 'reads external systems; writes nothing anywhere',
    enforced_by: 'protocol; adapter tool list',
    residual: 'network is UNKNOWN here, so this role may be undeliverable on this harness' },
];

// --- checkers ----------------------------------------------------------------
// Two sets, because they answer different questions in different places. The runtime tools go
// wherever the squad runs; `check-plugin.mjs` and `build.mjs` check the PACKAGE against
// `protocol/`, which a consumer install deliberately does not carry. Reporting those two as
// "missing" in a consumer made a correct install read as a broken one, and a real smoke had to
// stop and explain that the absence was by design. An absence by design is not a finding.
const RUNTIME_CHECKERS = ['state.mjs', 'verify-change.mjs', 'capabilities.mjs'];
const PACKAGE_CHECKERS = ['check-plugin.mjs', 'build.mjs'];
const present = (f) => existsSync(join(pkgRoot, 'scripts', f));

const missing = RUNTIME_CHECKERS.filter((f) => !present(f));
add('checkers.missing', missing.length ? missing.join(', ') : 'none', V,
  missing.length ? 'the squad cannot run without these' : undefined);

const absentPackage = PACKAGE_CHECKERS.filter((f) => !present(f));
add('checkers.package_only',
  absentPackage.length === 0 ? 'present'
    : installShape === 'package checkout' ? `MISSING: ${absentPackage.join(', ')}`
    : `not shipped here (${absentPackage.join(', ')})`,
  V,
  installShape === 'package checkout'
    ? 'these check the package against protocol/, and this IS the package'
    : 'these check the package against protocol/, which a consumer install does not carry — expected, not a finding');

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
} else {
  // The isolation is real and it is of CONTEXT. What it does not cover stays in the report, so
  // "isolated" is never read as "sandboxed".
  console.log(`\n  NOTE  context isolation observed (${signal.observed_at}): a dispatched specialist does not receive this`);
  console.log('        conversation. It is not a sandbox — it shares the user, the filesystem, the git history and the');
  console.log('        session transcript on disk; its prompt is written by the Invoker; it is the same model as the');
  console.log('        builder. Dispatch it as a named agent, never a fork, and keep the builder\'s reasoning out of');
  console.log('        the prompt — the prompt stays in the session record and can be audited.');
}
if (meets === false) {
  console.log(`\n  NOTE  node ${process.versions.node} is below this package's floor (${floor}). The squad runs on it, but`);
  console.log('        without the security fixes the floor exists for. Upgrade Node before trusting this session.');
}
