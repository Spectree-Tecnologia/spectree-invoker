// Synthetic fixtures. Nothing here reads a consumer project, needs a credential,
// touches the network, or depends on anything outside this repository.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
  ...(o.modules_named ? { modules_named: o.modules_named } : {}),
  ...(o.state_revision !== undefined ? { state_revision: o.state_revision } : {}),
});
