// Regressions for the seven acceptance findings. Each test reproduces the exact case
// that was reported and asserts the refusal that was missing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
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

test('6. two concurrent processes race for the same state revision, and one is refused', async () => {
  const dir = tempDir('spectree-race-');
  try {
    const s = new Store(dir);
    s.init({ project_id: 'p', protocol_version: '1.0.0' });
    s.putChange(change({ state: 'draft' }));

    // Sequential processes only prove that a stale revision is rejected. The lock is about
    // SIMULTANEOUS writers, so both children park on a barrier and are released together.
    // On Windows an absolute ESM specifier must be a file:// URL, so build one.
    const storeUrl = pathToFileURL(join(REPO, 'scripts/lib/store.mjs')).href;
    const script = `
      import { Store } from ${JSON.stringify(storeUrl)};
      import { writeFileSync, existsSync } from 'node:fs';
      import { join } from 'node:path';
      // With \`node -e <script> a b\`, argv is [execPath, a, b] — there is no script path.
      const [, state, dir] = process.argv;
      const s = new Store(dir);
      const c = s.change('c1');                       // both read the same revision first
      writeFileSync(join(dir, 'ready-' + state), '');
      const spin = new Int32Array(new SharedArrayBuffer(4));
      while (!existsSync(join(dir, 'go'))) Atomics.wait(spin, 0, 0, 1);
      try { s.putChange({ ...c, state }, { expected: 1, event: { type: 'transition', to: state } }); console.log('WROTE'); }
      catch (e) { console.log(e.code ?? ('ERR ' + e.message)); }
    `;
    const child = (state) => new Promise((resolve, reject) => {
      const c = spawn(process.execPath, ['--input-type=module', '-e', script, state, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', err = '';
      c.stdout.on('data', (d) => { out += d; });
      c.stderr.on('data', (d) => { err += d; });
      c.on('error', reject);
      c.on('close', (code) => resolve({ state, out: out.trim(), err: err.trim(), code }));
    });

    const running = [child('proposed'), child('pass1_complete')];
    // Release only once BOTH are parked: that is what makes the writes contend.
    const parked = () => existsSync(join(dir, 'ready-proposed')) && existsSync(join(dir, 'ready-pass1_complete'));
    for (let i = 0; i < 600 && !parked(); i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(parked(), 'both processes reached the barrier');
    writeFileSync(join(dir, 'go'), '');

    const results = await Promise.all(running);           // both results are collected
    for (const r of results) assert.equal(r.code, 0, `child ${r.state} exited ${r.code}: ${r.err}`);
    assert.deepEqual(results.map((r) => r.out).sort(), ['E_CONCURRENT_UPDATE', 'WROTE'],
      'exactly one writer lands; the other is refused, not merged');

    const winner = results.find((r) => r.out === 'WROTE').state;
    const final = s.change('c1');
    assert.equal(final.state_revision, 2, 'exactly one write landed');
    assert.equal(final.state, winner, 'the state on disk belongs to the winner, not to a blend');
    assert.deepEqual(s.history('c1').map((e) => e.to), [winner], 'only the winner appended a history event');
    assert.equal(existsSync(join(dir, '.spectree/changes/c1.lock')), false, 'the lock is released');
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

// --- second round, finding 8: the revision is not the content ----------------

test('8. fresh evidence must match the content on disk, not only the revision', async () => {
  const { contentDigest, contractDigest, OPERATIONAL } = await import('../scripts/lib/digest.mjs');
  const c = change({ state: 'implemented' });
  const qe = { role: 'quality_engineer', independent_of: ['full_stack_developer'] };
  const ctxOn = (contentDigest) => ({
    approvals: [scopeApproval()], revision: REV, scopeDigests: scopeOk, contentDigest,
  });

  const measured = evidence({ property: 'pass2.attack', revision: REV, change_id: 'c1', executor: qe, fingerprint: 'CONTENT-A' });
  assert.equal(canTransition(c, 'pass2_complete', { ...ctxOn('CONTENT-A'), evidence: [measured] }).ok, true);

  const moved = canTransition(c, 'pass2_complete', { ...ctxOn('CONTENT-B'), evidence: [measured] });
  assert.equal(moved.code, CODES.CONTENT_CHANGED);
  assert.match(moved.message, /uncommitted change is still a change/);

  const unpinned = evidence({ property: 'pass2.attack', revision: REV, change_id: 'c1', executor: qe });
  const r = canTransition(c, 'pass2_complete', { ...ctxOn('CONTENT-A'), evidence: [unpinned] });
  assert.equal(r.code, CODES.CONTENT_CHANGED);
  assert.match(r.message, /records no fingerprint at all/, 'evidence that cannot say what it ran against proves nothing');

  assert.ok(OPERATIONAL.includes('.spectree'), 'the squad\'s own records are outside the content digest');
  assert.equal(typeof contentDigest, 'function');
  assert.equal(typeof contractDigest, 'function');
});

test('8b. evidence that is not required to be fresh is unaffected by the content', () => {
  // A baseline is a fact about a past revision. Pinning it to today's work tree would be wrong.
  const past = evidence({ property: 'suite.baseline', revision: OLD, change_id: 'c1', fingerprint: 'CONTENT-A' });
  const r = canTransition(change({ state: 'isolated' }), 'baselined',
    { evidence: [past], approvals: [scopeApproval()], revision: REV, scopeDigests: scopeOk, contentDigest: 'CONTENT-B' });
  assert.equal(r.ok, true);
});

// --- second round, finding 9: progress is not scope --------------------------

test('9. the contract digest covers the proposal and the delta, and nothing else', async () => {
  const { contractDigest, CONTRACT } = await import('../scripts/lib/digest.mjs');
  assert.equal(CONTRACT('proposal.md'), true);
  assert.equal(CONTRACT('specs/account/spec.md'), true);
  assert.equal(CONTRACT('tasks.md'), false, 'ticking a checkbox is not a change of scope');
  assert.equal(CONTRACT('notes.md'), false);

  const dir = tempDir('spectree-contract-');
  try {
    mkdirSync(join(dir, 'specs'), { recursive: true });
    writeFileSync(join(dir, 'proposal.md'), '# proposal\n');
    writeFileSync(join(dir, 'specs/spec.md'), '### Requirement: x\n');
    writeFileSync(join(dir, 'tasks.md'), '- [ ] build it\n');
    const c = change();
    const before = contractDigest(dir, c, { artifactsDir: dir });
    assert.deepEqual(before.files, ['proposal.md', 'specs/spec.md']);

    writeFileSync(join(dir, 'tasks.md'), '- [x] build it\n');
    assert.equal(contractDigest(dir, c, { artifactsDir: dir }).digest, before.digest, 'progress moved, scope did not');

    writeFileSync(join(dir, 'proposal.md'), '# proposal\n\nand a second module\n');
    assert.notEqual(contractDigest(dir, c, { artifactsDir: dir }).digest, before.digest, 'scope moved, and the digest says so');
  } finally { cleanup(dir); }
});

test('9b. the content digest ignores the squad\'s own records and notices everything else', async () => {
  const { contentDigest } = await import('../scripts/lib/digest.mjs');
  const { gitRepo } = await import('./helpers.mjs');
  const repo = gitRepo({ 'src/app.js': 'export const a = 1;\n' });
  try {
    const clean = contentDigest(repo.root);
    assert.equal(clean.dirty, false);

    mkdirSync(join(repo.root, '.spectree/changes'), { recursive: true });
    writeFileSync(join(repo.root, '.spectree/changes/c1.json'), '{"state":"draft"}');
    mkdirSync(join(repo.root, 'docs/changes/c1'), { recursive: true });
    writeFileSync(join(repo.root, 'docs/changes/c1/tasks.md'), '- [x] done\n');
    assert.equal(contentDigest(repo.root).digest, clean.digest, 'the squad writing its own records is not a code change');

    writeFileSync(join(repo.root, 'src/app.js'), 'export const a = 2;\n');
    const edited = contentDigest(repo.root);
    assert.notEqual(edited.digest, clean.digest, 'an uncommitted edit moves the content digest');
    assert.equal(edited.revision, clean.revision, 'while the revision stays exactly where it was');
    assert.equal(edited.dirty, true);

    writeFileSync(join(repo.root, 'src/new.js'), 'export const b = 3;\n');
    assert.notEqual(contentDigest(repo.root).digest, edited.digest, 'a new untracked file counts too');
  } finally { cleanup(repo.root); }
});

test('9c. content that cannot be established is refused, never read as unchanged', async () => {
  const { contentDigest } = await import('../scripts/lib/digest.mjs');
  const dir = tempDir('spectree-nogit-');
  try {
    assert.throws(() => contentDigest(dir), (e) => e.code === 'E_CONTENT_UNAVAILABLE');
  } finally { cleanup(dir); }
});
