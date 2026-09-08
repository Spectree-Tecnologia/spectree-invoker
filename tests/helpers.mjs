// Synthetic fixtures. Nothing here reads a consumer project, needs a credential,
// touches the network, or depends on anything outside this repository.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

export const REPO = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

export function tempDir(prefix = 'spectree-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function writeFiles(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** A disposable git repository with one commit. Returns { root, base }. */
export function gitRepo(files = { 'seed.txt': 'seed\n' }) {
  const root = tempDir('spectree-git-');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.invalid']);
  git(root, ['config', 'user.name', 'test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  writeFiles(root, files);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'base']);
  return { root, base: git(root, ['rev-parse', 'HEAD']).trim(), git: (args) => git(root, args) };
}

export function commitAll(repo, message = 'change') {
  repo.git(['add', '-A']);
  repo.git(['commit', '-qm', message]);
  return repo.git(['rev-parse', 'HEAD']).trim();
}

export const cleanup = (dir) => rmSync(dir, { recursive: true, force: true });

export const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

export const evidence = (o) => ({
  schema_version: '1.0.0',
  evidence_id: o.evidence_id ?? 'e1',
  property: o.property,
  check: o.check ?? 'synthetic',
  executor: o.executor ?? { role: 'platform_engineer' },
  source_kind: o.source_kind ?? 'observed_execution',
  revision: o.revision,
  result: o.result ?? 'PASS',
  timestamp: o.timestamp ?? now(),
  ...(o.change_id ? { change_id: o.change_id } : {}),
  ...(o.fingerprint ? { fingerprint: o.fingerprint } : {}),
  ...(o.superseded_by ? { superseded_by: o.superseded_by } : {}),
});

export const approval = (o) => ({
  schema_version: '1.0.0',
  approval_id: o.approval_id ?? 'a1',
  gate: o.gate,
  granted_by: o.granted_by ?? { identity: 'founder', kind: 'human_in_session' },
  channel: o.channel ?? 'session',
  scope_digest: o.scope_digest ?? 'digest-0001',
  revision: o.revision,
  timestamp: o.timestamp ?? now(),
  ...(o.change_id ? { change_id: o.change_id } : {}),
  ...(o.expires_with_revision !== undefined ? { expires_with_revision: o.expires_with_revision } : {}),
});

export const change = (o = {}) => ({
  schema_version: '1.0.0',
  project_id: o.project_id ?? 'proj',
  change_id: o.change_id ?? 'c1',
  change_type: o.change_type ?? 'feature',
  protocol_version: '1.0.0',
  adapter: o.adapter ?? 'claude-code',
  base_revision: o.base_revision ?? 'a'.repeat(40),
  scope: o.scope ?? 'synthetic scope',
  allowed_paths: o.allowed_paths ?? ['src/'],
  state: o.state ?? 'draft',
  ...(o.deltaless !== undefined ? { deltaless: o.deltaless } : {}),
  ...(o.closure_mode ? { closure_mode: o.closure_mode } : {}),
  ...(o.modules_named ? { modules_named: o.modules_named } : {}),
  ...(o.state_revision !== undefined ? { state_revision: o.state_revision } : {}),
  ...(o.blocked_from ? { blocked_from: o.blocked_from } : {}),
});

// --- the closure lifecycle, as fixtures need it ------------------------------------------------

/**
 * The current preparation snapshot of a change, read the way every command reads it.
 * A fixture that hand-builds one is testing its own arithmetic; this reads what was written.
 */
export function preparationOf(root, changeId) {
  const f = join(root, '.spectree', 'closure', `${changeId}.json`);
  return JSON.parse(readFileSync(f, 'utf8'));
}

export function lifecycleOf(root, changeId) {
  const f = join(root, '.spectree', 'closure', `${changeId}.lifecycle.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}

/**
 * An integration approval as the contract now requires one: bound to the content, to the
 * preparation snapshot, and to the integration it authorises.
 *
 * Synthetic, and marked as such by the fixture identity. Nothing here is a human's consent; it
 * stands in for the record a human's consent would produce.
 */
export function integrationApproval({
  approvalId, changeId, scopeDigest, revision, manifest, target = {},
}) {
  return {
    schema_version: '1.0.0',
    approval_id: approvalId,
    change_id: changeId,
    gate: 'integration',
    granted_by: { identity: 'fixture', kind: 'human_in_session' },
    channel: 'session',
    scope_digest: scopeDigest,
    revision,
    timestamp: now(),
    ...(manifest?.preparation_id ? {
      preparation: {
        preparation_id: manifest.preparation_id,
        generation: manifest.generation,
        preparation_digest: manifest.preparation_digest,
      },
    } : {}),
    integration_target: {
      repository: target.repository ?? 'fixture/repo',
      pr: target.pr ?? 999,
      head_sha: target.headSha ?? revision,
      base_branch: target.baseBranch ?? 'main',
    },
  };
}

/** The v2 CI declaration a project needs before a confirmation can read anything. */
export const ciConfig = (jobs = ['classify', 'plugin']) => ({
  version: 2,
  required_runs: Object.fromEntries(['full', 'documented_closure', 'operational_trail'].map((t) => [
    t, { workflow: 'check', jobs, event: 'push', branch: 'main' },
  ])),
});

/**
 * A `gh` that answers from a file instead of the network.
 *
 * It is a TRANSPORT stub and nothing else: the digests, the ancestry, the aggregate, the receipt
 * and every transition around it are the real ones. It speaks the same sub-commands the code
 * calls — `repo view`, `pr view`, `pr checks`, `run list`, `run view` — and it honours `--commit`,
 * `--event`, `--branch` and `--workflow`, because a stub that ignored the filters would let a
 * query that never applied them look correct.
 *
 * `answers.json` holds { repo, pr, runs, jobs, checks, prChecksExit }.
 */
export function stubGh(dir, answers) {
  const shim = join(dir, 'shim');
  mkdirSync(shim, { recursive: true });
  writeFileSync(join(shim, 'answers.json'), JSON.stringify(answers));
  writeFileSync(join(shim, 'gh.cjs'), [
    "const { readFileSync } = require('node:fs');",
    "const a = JSON.parse(readFileSync(require('node:path').join(__dirname, 'answers.json'), 'utf8'));",
    'const argv = process.argv.slice(2);',
    'const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };',
    "const out = (x) => { process.stdout.write(JSON.stringify(x)); process.exit(0); };",
    "if (argv[0] === 'repo') out({ nameWithOwner: a.repo ?? 'fixture/repo' });",
    "if (argv[0] === 'pr' && argv[1] === 'view') out(a.pr);",
    "if (argv[0] === 'pr' && argv[1] === 'checks') {",
    '  process.stdout.write(JSON.stringify(a.checks ?? []));',
    '  process.exit(a.prChecksExit ?? 0);',
    '}',
    "if (argv[0] === 'run' && argv[1] === 'list') {",
    '  let runs = a.runs ?? [];',
    "  const commit = opt('--commit'); if (commit) runs = runs.filter((r) => r.headSha === commit);",
    "  const event = opt('--event'); if (event) runs = runs.filter((r) => !r.event || r.event === event);",
    "  const wf = opt('--workflow'); if (wf) runs = runs.filter((r) => String(r.workflowName) === String(wf) || String(r.workflowDatabaseId) === String(wf));",
    "  const limit = Number(opt('--limit') ?? 30);",
    '  out(runs.slice(0, limit));',
    '}',
    "if (argv[0] === 'run' && argv[1] === 'view') {",
    '  const id = argv[2];',
    '  const run = (a.runs ?? []).find((r) => String(r.databaseId) === String(id));',
    "  if (!run) { process.stderr.write('no such run'); process.exit(1); }",
    "  out({ ...run, jobs: (a.jobs ?? {})[String(id)] ?? [] });",
    '}',
    "process.stderr.write('unsupported gh invocation: ' + argv.join(' '));",
    'process.exit(2);',
  ].join('\n'));
  writeFileSync(join(shim, 'gh.cmd'), `@"${process.execPath}" "${join(shim, 'gh.cjs')}" %*\r\n`);
  writeFileSync(join(shim, 'gh'), `#!/bin/sh\nexec "${process.execPath}" "${join(shim, 'gh.cjs')}" "$@"\n`);
  try { chmodSync(join(shim, 'gh'), 0o755); } catch { /* Windows has no mode bit here */ }
  return {
    dir: shim,
    path: (p = process.env.PATH) => `${shim}${process.platform === 'win32' ? ';' : ':'}${p}`,
    set: (next) => writeFileSync(join(shim, 'answers.json'), JSON.stringify(next)),
  };
}

/** One successful workflow run of `check`, with the two jobs the policy requires. */
export const greenRun = (sha, { id = 1, attempt = 1, jobs = ['classify', 'plugin'], conclusion = 'success' } = {}) => ({
  run: {
    databaseId: id, name: 'check', workflowName: 'check', workflowDatabaseId: 77,
    status: 'completed', conclusion, headSha: sha, event: 'push', attempt,
    createdAt: new Date(2026, 0, 1, 0, 0, id).toISOString(), url: `https://example.invalid/run/${id}`,
  },
  jobs: jobs.map((name) => ({ name, status: 'completed', conclusion })),
});
