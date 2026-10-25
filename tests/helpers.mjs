// Suite-only fixtures over the shared ones in support/fixtures.mjs. Nothing here reads a consumer
// project, needs a credential, touches the network, or depends on anything outside this repository.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { format, inspect } from 'node:util';
import * as storeModule from '../scripts/lib/change/store.mjs';
import * as lifecycleModule from '../scripts/lib/change/lifecycle.mjs';
import { REPO, tempDir, writeFiles, gitRepo, cleanup, now, preparationOf, stubGh, greenRun } from '../support/fixtures.mjs';

export { REPO, tempDir, writeFiles, gitRepo, cleanup, now, preparationOf, stubGh, greenRun };

export function commitAll(repo, message = 'change') {
  repo.git(['add', '-A']);
  repo.git(['commit', '-qm', message]);
  return repo.git(['rev-parse', 'HEAD']).trim();
}

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
 * Record an integration approval the way `state.mjs record-approval` does: the document AND the
 * durable entry in the closure control.
 *
 * A fixture that wrote only the file was building a state no real project can be in — an approval
 * with no durable record is half an approval, and the runtime now refuses to read it as whole
 * authority. Fixtures that construct impossible states prove things about impossible states.
 */
export function recordIntegrationApproval(root, changeId, doc) {
  const { Store } = storeModule;
  new Store(root).putApproval(doc);
  const f = join(root, '.spectree', 'closure', `${changeId}.lifecycle.json`);
  mkdirSync(dirname(f), { recursive: true });
  const cur = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : lifecycleModule.emptyLifecycle(changeId, null);
  const next = {
    ...cur,
    revision: (cur.revision ?? 0) + 1,
    approved: [
      ...(cur.approved ?? []).filter((r) => r.approval_id !== doc.approval_id),
      ...(doc.preparation ? [{
        approval_id: doc.approval_id,
        preparation_id: doc.preparation.preparation_id,
        generation: doc.preparation.generation,
        preparation_digest: doc.preparation.preparation_digest,
        at: doc.timestamp,
      }] : []),
    ],
  };
  writeFileSync(f, `${JSON.stringify(next, null, 2)}\n`);
  return doc;
}

/**
 * The library function behind each closure CLI. The CLI is a thin facade — it hands the project
 * root and argv to this function and turns the returned code into the exit code — so calling the
 * function answers with the same code and the same text, without paying for a process.
 */
const FACADES = { 'state.mjs': 'stateCommand', 'prepare-closure.mjs': 'prepareClosure', 'post-merge.mjs': 'confirmMerge' };
const load = createRequire(import.meta.url);

/**
 * Run a closure CLI — the repository's own or an installed copy — as `{ code, out, err }`.
 *
 * In process when nothing about the process is under test. As a real process when `env` loads a
 * shim through NODE_OPTIONS (a clock, a crash, a barrier), since only a new process can load one,
 * for any script that is not one of the three facades, and when `spawn` asks for the process.
 * `env` is applied for the call only. tests/closure-facades.test.mjs holds the two ways equal.
 */
export function closureCli(script, argv, { cwd, env = {}, spawn = false } = {}) {
  const name = FACADES[basename(script)];
  if (spawn || !name || env.NODE_OPTIONS !== undefined) {
    const r = spawnSync(process.execPath, [script, ...argv], { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
    return answer(r.status, r.stdout ?? '', r.stderr ?? '');
  }
  const fn = load(join(dirname(script), 'lib', 'closure', 'index.mjs'))[name];
  const out = []; const err = [];
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  let code;
  try {
    code = fn({ root: process.env.SPECTREE_PROJECT_ROOT ?? cwd, argv, out: (s) => out.push(format(s)), err: (s) => err.push(format(s)) });
  } catch (e) {
    // What node does with an uncaught throw: the error, with its code, on stderr; exit code 1.
    code = 1; err.push(inspect(e));
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  const text = (lines) => lines.map((l) => `${l}\n`).join('');
  return answer(code ?? 0, text(out), text(err));
}

/** Both spellings the suite reads: trimmed `code/out/err`, and spawnSync's `status/stdout/stderr`. */
const answer = (status, stdout, stderr) => ({ code: status, out: stdout.trim(), err: stderr.trim(), status, stdout, stderr });


/** The brief a pass 2 operation starts with: independence and the final scope, under .spectree/. */
export function writePass2Brief(root, name = 'brief', over = {}) {
  const path = `.spectree/pass2/${name}.json`;
  writeFiles(root, { [path]: JSON.stringify({ version: 1, independent_of: ['full_stack_developer'], fork: false,
    withheld: ['builder_report', 'builder_reasoning', 'pull_request'], scope: { attack: ['src/'], excluded: [] }, ...over }) });
  return path;
}
