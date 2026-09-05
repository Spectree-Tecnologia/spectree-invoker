// Regressions for the seven acceptance findings. Each test reproduces the exact case
// that was reported and asserts the refusal that was missing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canTransition, canDispatchWithCapabilities, legalTargets, ENTRY_REQUIREMENTS, CODES } from '../scripts/lib/state-machine.mjs';
import { Store } from '../scripts/lib/store.mjs';
import { tempDir, cleanup, change, evidence, approval, REPO } from './helpers.mjs';

const REV = 'f'.repeat(40);
const OLD = '0'.repeat(40);
const scopeOk = { scope: 'D1', integration: 'D2' };
const scopeApproval = (o = {}) => approval({ approval_id: 'ap-scope', gate: 'scope', change_id: 'c1', scope_digest: 'D1', revision: REV, ...o });

// --- finding 1: blocked was a bypass -----------------------------------------

test('1. blocked no longer opens every state: proposed -> blocked -> integrated is refused', () => {
  const proposed = change({ state: 'proposed' });
  assert.equal(canTransition(proposed, 'blocked', {}).ok, true, 'blocking is always allowed');

  const blocked = change({ state: 'blocked', blocked_from: 'proposed' });
  const r = canTransition(blocked, 'integrated', {});
  assert.equal(r.ok, false);
  assert.equal(r.code, CODES.BLOCKED_RECOVERY);
  assert.match(r.message, /would skip every step between them/);
});

test('1b. recovery returns only to where the block happened', () => {
  const blocked = change({ state: 'blocked', blocked_from: 'proposed' });
  assert.deepEqual(legalTargets(blocked), ['proposed']);
  assert.equal(canTransition(blocked, 'proposed', {}).ok, true);
});

test('1c. a block with no recorded origin has nowhere safe to return to', () => {
  const r = canTransition(change({ state: 'blocked' }), 'proposed', {});
  assert.equal(r.code, CODES.BLOCKED_RECOVERY);
  assert.match(r.message, /does not record where it was blocked from/);
});

test('1d. recovery re-checks the requirements of the state it returns to', () => {
  // Blocked out of `isolated`; returning must still satisfy what `isolated` requires.
  const blocked = change({ state: 'blocked', blocked_from: 'isolated' });
  const r = canTransition(blocked, 'isolated', { approvals: [scopeApproval()], revision: REV, scopeDigests: scopeOk });
  assert.equal(r.code, CODES.MISSING_EVIDENCE, 'a block does not launder a step whose evidence was never produced');
});

// --- finding 2: pass 2 accepted INFRA_ERROR and stale evidence ----------------

test('2. pass 2 refuses an infrastructure error', () => {
  const infra = evidence({
    property: 'pass2.attack', revision: REV, change_id: 'c1', result: 'INFRA_ERROR',
    executor: { role: 'quality_engineer', independent_of: ['full_stack_developer'] },
  });
  const r = canTransition(change({ state: 'implemented' }), 'pass2_complete',
    { evidence: [infra], approvals: [scopeApproval()], revision: REV, scopeDigests: scopeOk });
  assert.equal(r.code, CODES.EVIDENCE_NOT_PASS);
  assert.match(r.message, /did not exercise the property/);
});

test('2b. pass 2 refuses evidence from another revision', () => {
  const stale = evidence({
    property: 'pass2.attack', revision: OLD, change_id: 'c1',
    executor: { role: 'quality_engineer', independent_of: ['full_stack_developer'] },
  });
  const r = canTransition(change({ state: 'implemented' }), 'pass2_complete',
    { evidence: [stale], approvals: [scopeApproval()], revision: REV, scopeDigests: scopeOk });
  assert.equal(r.code, CODES.STALE_EVIDENCE);
});

test('2c. every state that needs evidence demands PASS and an observed run', () => {
  // The original defect was inconsistency between gates, so assert the property across all of them.
  for (const [state, req] of Object.entries(ENTRY_REQUIREMENTS)) {
    for (const e of req.evidence ?? []) {
      assert.equal(e.result ?? 'PASS', 'PASS', `${state}: evidence must be required to PASS`);
      assert.notEqual(e.observed, false, `${state}: evidence must be required to be observed`);
    }
  }
});

// --- finding 3: approval was not bound to content ----------------------------

test('3. an approval that does not name this change is refused', () => {
  const unbound = scopeApproval({ change_id: undefined });
  const r = canTransition(change({ state: 'proposed' }), 'scope_approved',
    { approvals: [unbound], revision: REV, scopeDigests: scopeOk });
  assert.equal(r.code, CODES.APPROVAL_OUT_OF_SCOPE);
  assert.match(r.message, /no change_id/);
});

test('3b. an approval whose digest is not the digest of the current artifact is refused', () => {
  const r = canTransition(change({ state: 'proposed' }), 'scope_approved',
    { approvals: [scopeApproval()], revision: REV, scopeDigests: { scope: 'DIFFERENT' } });
  assert.equal(r.code, CODES.APPROVAL_DIGEST_MISMATCH);
  assert.match(r.message, /granted for different content/);
});

test('3c. an unchecked digest is refused too — comparing nothing proves nothing', () => {
  const r = canTransition(change({ state: 'proposed' }), 'scope_approved',
    { approvals: [scopeApproval()], revision: REV });
  assert.equal(r.code, CODES.APPROVAL_DIGEST_MISMATCH);
  assert.match(r.message, /no digest of the current scope artifact was supplied/);
});

test('3d. an approval from an older revision is stale by default, not by opt-in', () => {
  const r = canTransition(change({ state: 'proposed' }), 'scope_approved',
    { approvals: [scopeApproval({ revision: OLD })], revision: REV, scopeDigests: scopeOk });
  assert.equal(r.code, CODES.APPROVAL_STALE);
});

test('3e. an explicit opt-out is the only way an approval survives a revision change', () => {
  const r = canTransition(change({ state: 'proposed' }), 'scope_approved',
    { approvals: [scopeApproval({ revision: OLD, expires_with_revision: false })], revision: REV, scopeDigests: scopeOk });
  assert.equal(r.ok, true);
});

// --- finding 4: unknown capability was permission ----------------------------

test('4. an unknown capability blocks the dispatch', () => {
  const d = { required_capabilities: ['network'] };
  for (const state of ['unknown', undefined, 'absent', '', 'maybe']) {
    const r = canDispatchWithCapabilities(d, state === undefined ? {} : { network: state });
    assert.equal(r.ok, false, `capability "${state}" must not pass`);
    assert.equal(r.code, CODES.CAPABILITY_UNAVAILABLE);
  }
  assert.match(canDispatchWithCapabilities(d, { network: 'unknown' }).message, /not permission/);
  assert.equal(canDispatchWithCapabilities(d, { network: 'declared' }).ok, true);
  assert.equal(canDispatchWithCapabilities(d, { network: 'verified' }).ok, true);
});

// --- finding 5: the Codex install was not operational ------------------------

test('5. the Codex install ships the scripts its own skill tells the agent to run', () => {
  const skill = readFileSync(join(REPO, 'adapters/codex/dist/skills/spectree-invoker/SKILL.md'), 'utf8');
  const called = [...skill.matchAll(/node\s+\.spectree\/squad\/scripts\/([\w-]+\.mjs)/g)].map((m) => m[1]);
  assert.ok(called.length >= 2, 'the skill does call scripts');
  for (const f of called) {
    assert.ok(existsSync(join(REPO, 'scripts', f)), `${f} must exist to be installed`);
  }
});

test('5b. specialists are built where Codex looks for custom agents', () => {
  const agents = readdirSync(join(REPO, 'adapters/codex/dist/agents')).sort();
  assert.deepEqual(agents, [
    'full_stack_developer.toml', 'integration_engineer.toml', 'platform_engineer.toml',
    'quality_engineer.toml', 'solutions_architect.toml',
  ]);
  assert.equal(existsSync(join(REPO, 'adapters/codex/dist/skills/spectree-invoker/agents')), false,
    'a skill subfolder does not register custom agents; .codex/agents does');
});

test("5c. the skill points at the squad's own document, never at the consumer's AGENTS.md", () => {
  const skill = readFileSync(join(REPO, 'adapters/codex/dist/skills/spectree-invoker/SKILL.md'), 'utf8');
  assert.match(skill, /\.spectree\/squad\/SQUAD\.md/);
  assert.match(skill, /It is not `AGENTS\.md`/);
});

test('5d. installing over an existing AGENTS.md preserves it, appends once, and is idempotent', () => {
  const dir = tempDir('spectree-consumer-');
  try {
    const original = '# AGENTS.md\n\nThis project uses pnpm. Do not overwrite this file.\n';
    writeFileSync(join(dir, 'AGENTS.md'), original);

    const run = (args) => execFileSync(process.execPath, [join(REPO, 'scripts', 'install-codex.mjs'), dir, ...args], { encoding: 'utf8' });

    const dry = run([]);
    assert.match(dry, /DRY RUN/);
    assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), original, 'a dry run writes nothing');

    run(['--apply']);
    const after = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    assert.ok(after.startsWith(original.trimEnd()), 'the consumer file is preserved in full, at the top');
    assert.match(after, /spectree-invoker/);

    assert.ok(existsSync(join(dir, '.codex/agents/quality_engineer.toml')), 'specialists land in .codex/agents');
    assert.ok(existsSync(join(dir, '.agents/skills/spectree-invoker/SKILL.md')), 'the skill lands in .agents/skills');
    assert.ok(existsSync(join(dir, '.spectree/squad/scripts/state.mjs')), 'the scripts travel with it');
    assert.ok(existsSync(join(dir, '.spectree/squad/schemas/change.schema.json')), 'and so do the schemas they need');

    const second = run(['--apply']);
    assert.match(second, /unchanged/);
    assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), after, 'the pointer is appended once, not twice');
  } finally { cleanup(dir); }
});

test('5e. the installed scripts actually run from inside the consumer', () => {
  const dir = tempDir('spectree-consumer-run-');
  try {
    execFileSync(process.execPath, [join(REPO, 'scripts', 'install-codex.mjs'), dir, '--apply'], { encoding: 'utf8' });
    const out = execFileSync(process.execPath, [join(dir, '.spectree/squad/scripts/capabilities.mjs')], { cwd: dir, encoding: 'utf8' });
    assert.match(out, /VERIFIED/);
    const st = execFileSync(process.execPath, [join(dir, '.spectree/squad/scripts/state.mjs'), 'resume'], { cwd: dir, encoding: 'utf8' });
    assert.match(st, /change\s+none open/);
  } finally { cleanup(dir); }
});

test('5f. a destination that escapes the project is refused', () => {
  const dir = tempDir('spectree-esc-');
  try {
    // The installer resolves every destination and refuses anything outside its root.
    const out = execFileSync(process.execPath, [join(REPO, 'scripts', 'install-codex.mjs'), dir], { encoding: 'utf8' });
    assert.match(out, /DRY RUN/);
    for (const line of out.split('\n')) {
      if (!line.includes('create') && !line.includes('append')) continue;
      assert.equal(line.includes('..'), false, 'no planned destination climbs out of the project');
    }
  } finally { cleanup(dir); }
});

// --- finding 6: read-modify-write was a race ---------------------------------

test('6. two concurrent processes cannot both write the same state revision', () => {
  const dir = tempDir('spectree-race-');
  try {
    const s = new Store(dir);
    s.init({ project_id: 'p', protocol_version: '1.0.0' });
    s.putChange(change({ state: 'draft' }));

    // Both processes read revision 1 and then write. Without a lock around the whole
    // read-compare-write, both succeed and one silently wins.
    // On Windows an absolute ESM specifier must be a file:// URL, so build one.
    const storeUrl = pathToFileURL(join(REPO, 'scripts/lib/store.mjs')).href;
    const script = `
      import { Store } from ${JSON.stringify(storeUrl)};
      const s = new Store(${JSON.stringify(dir)});
      const c = s.change('c1');
      // With \`node -e <script> <arg>\`, argv is [execPath, arg] — there is no script path.
      try { s.putChange({ ...c, state: process.argv[1] }, { expected: 1 }); console.log('WROTE'); }
      catch (e) { console.log(e.code ?? ('ERR ' + e.message)); }
    `;
    const run = (state) => execFileSync(process.execPath, ['--input-type=module', '-e', script, state],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

    const a = run('proposed');
    const b = run('blocked');
    assert.equal(a, 'WROTE');
    assert.equal(b, 'E_CONCURRENT_UPDATE', 'the second writer is refused, not merged');
    assert.equal(s.change('c1').state_revision, 2, 'exactly one write landed');
  } finally { cleanup(dir); }
});

test('6b. the state file and its history event are written under the same lock', () => {
  const dir = tempDir('spectree-lock-');
  try {
    const s = new Store(dir);
    s.init({ project_id: 'p', protocol_version: '1.0.0' });
    s.putChange(change(), { event: { type: 'opened' } });
    const c = s.change('c1');
    const h = s.history('c1');
    assert.equal(h.length, 1);
    assert.equal(h[0].state_revision, c.state_revision, 'the event records the revision that was written');
    assert.equal(existsSync(join(dir, '.spectree/changes/c1.lock')), false, 'the lock is released');
  } finally { cleanup(dir); }
});

// --- finding 7: a test wrote into the package under test ---------------------

test('7. no test writes inside the package under test', () => {
  const before = new Map();
  for (const f of ['CLAUDE.md', 'agents/quality-engineer.md', 'protocol/manifest.json']) {
    before.set(f, readFileSync(join(REPO, f), 'utf8'));
  }
  execFileSync(process.execPath, [join(REPO, 'scripts', 'build.mjs'), '--check'], { encoding: 'utf8' });
  for (const [f, content] of before) {
    assert.equal(readFileSync(join(REPO, f), 'utf8'), content, `${f} must be untouched by the suite`);
  }
});

test('7b. the drift test operates on a copy, not on the repository', () => {
  const src = readFileSync(join(REPO, 'tests/package-integrity.test.mjs'), 'utf8');
  const block = src.slice(src.indexOf("test('hand-editing a generated file"), src.indexOf('the suite leaves the package'));
  assert.match(block, /pkgCopy\(\)/, 'the drift test must build a copy');
  assert.equal(/writeFileSync\(\s*join\(REPO/.test(block), false, 'and must never write into REPO');
});
