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

// 3d and 3e were written when the revision was the expiry. The digest replaced it, and the
// rule now follows the gate: a contract gate dies when the contract changes, a code gate when
// the contract or the code changes. Revision expiry survives only as an explicit opt-IN,
// because as a default it was wrong in both directions — it revoked a scope approval over a
// commit that never touched the contract, and it survived an uncommitted edit that changed
// everything. What the approval is bound to is asserted in 3b and 3c, and now in 10.
test('3d. an approval outlives a commit that did not change what it approved', () => {
  const r = canTransition(change({ state: 'proposed' }), 'scope_approved',
    { approvals: [scopeApproval({ revision: OLD })], revision: REV, scopeDigests: scopeOk });
  assert.equal(r.ok, true, 'the contract is unchanged, so the approval still covers it');
});

test('3e. an approval that says it expires with the revision does expire with it', () => {
  const strict = scopeApproval({ revision: OLD, expires_with_revision: true });
  const r = canTransition(change({ state: 'proposed' }), 'scope_approved',
    { approvals: [strict], revision: REV, scopeDigests: scopeOk });
  assert.equal(r.code, CODES.APPROVAL_STALE);
  assert.equal(canTransition(change({ state: 'proposed' }), 'scope_approved',
    { approvals: [strict], revision: OLD, scopeDigests: scopeOk }).ok, true);
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

// --- third round, finding 11: escaped paths hashed as a placeholder ----------

test('11. an untracked path git would escape is still read, and its content still counts', async () => {
  const { contentDigest } = await import('../scripts/lib/digest.mjs');
  const { gitRepo } = await import('./helpers.mjs');
  const repo = gitRepo({ 'seed.txt': 'seed\n' });
  try {
    // git quotes non-ASCII in its default output: "src/a\303\247\303\243o nova.js".
    // Reading that literal string fails, and hashing a placeholder in its place gave every
    // version of the file the same digest — the file became invisible to the check.
    mkdirSync(join(repo.root, 'src'), { recursive: true });
    const weird = join(repo.root, 'src', 'ação nova.js');
    writeFileSync(weird, 'export const a = 1;\n');
    const first = contentDigest(repo.root);

    writeFileSync(weird, 'export const a = 2;\n');
    assert.notEqual(contentDigest(repo.root).digest, first.digest,
      'editing a file with an accented name must move the content digest');

    const spaced = join(repo.root, 'src', 'a "quoted" name.js');
    try { writeFileSync(spaced, 'export const b = 1;\n'); } catch { /* the filesystem refused the name */ }
    if (existsSync(spaced)) {
      const withIt = contentDigest(repo.root).digest;
      writeFileSync(spaced, 'export const b = 2;\n');
      assert.notEqual(contentDigest(repo.root).digest, withIt);
    }
  } finally { cleanup(repo.root); }
});

test('11b. content that is present and cannot be read is refused, not hashed as a placeholder', async () => {
  const { contentDigest } = await import('../scripts/lib/digest.mjs');
  const { gitRepo } = await import('./helpers.mjs');
  const repo = gitRepo({ 'seed.txt': 'seed\n' });
  try {
    assert.equal(typeof contentDigest(repo.root).digest, 'string');
    // A nested repository is listed by git as a single untracked entry — a directory, which
    // is exactly the case where reading the path fails while the path is genuinely there.
    execFileSync('git', ['init', '-q', 'vendor/thing'], { cwd: repo.root });
    assert.throws(() => contentDigest(repo.root), (e) => {
      assert.equal(e.code, 'E_CONTENT_UNAVAILABLE');
      assert.match(e.message, /vendor\/thing/);
      return true;
    });
  } finally { cleanup(repo.root); }
});

test('11c. a merge that keeps the tree keeps the content digest; one that changes it does not', async () => {
  const { contentDigest } = await import('../scripts/lib/digest.mjs');
  const { gitRepo } = await import('./helpers.mjs');
  const repo = gitRepo({ 'src/app.js': 'export const a = 1;\n' });
  const git = (...a) => execFileSync('git', a, { cwd: repo.root, encoding: 'utf8' });
  try {
    git('checkout', '-q', '-b', 'work');
    writeFileSync(join(repo.root, 'src/app.js'), 'export const a = 2;\n');
    git('add', '-A'); git('commit', '-qm', 'work');
    const candidate = contentDigest(repo.root);

    git('checkout', '-q', 'main');
    git('merge', '--no-ff', '-q', '-m', 'merge work', 'work');
    const merged = contentDigest(repo.root);
    assert.notEqual(merged.revision, candidate.revision, 'the commit is a new one');
    assert.equal(merged.digest, candidate.digest, 'and the code being integrated is the code that was reviewed');

    writeFileSync(join(repo.root, 'src/app.js'), 'export const a = 3;\n');
    git('add', '-A'); git('commit', '-qm', 'a fixup');
    assert.notEqual(contentDigest(repo.root).digest, candidate.digest, 'a merge that changes the tree is a different candidate');
  } finally { cleanup(repo.root); }
});

// --- fourth round, finding 12: the launcher Windows actually has -------------

test('12. a Windows launcher is resolved through PATH and PATHEXT, not assumed to be an exe', async () => {
  const { resolveOnPath } = await import('../scripts/lib/launch.mjs');
  const dir = tempDir('spectree-path-');
  try {
    writeFileSync(join(dir, 'npm.cmd'), '@echo off\n');
    writeFileSync(join(dir, 'node.exe'), '');
    const env = { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' };

    assert.equal(resolveOnPath('npm', { platform: 'win32', env }), join(dir, 'npm.cmd'),
      'the thing people type is a .cmd shim, and Node will not spawn one without a shell');
    assert.equal(resolveOnPath('node', { platform: 'win32', env }), join(dir, 'node.exe'));
    assert.equal(resolveOnPath('npm.cmd', { platform: 'win32', env }), join(dir, 'npm.cmd'));
    assert.equal(resolveOnPath('nothing-here', { platform: 'win32', env }), null,
      'not found stays not found: the failure must name the command the operator typed');
    assert.equal(resolveOnPath('npm', { platform: 'linux', env }), null, 'elsewhere the OS resolves it');
  } finally { cleanup(dir); }
});

// --- fourth round, finding 13: inversion, and what a non-zero exit proves ----

test('13. what a property means is not a flag', async () => {
  const { ASSERTS_FAILURE, ENTRY_REQUIREMENTS } = await import('../scripts/lib/state-machine.mjs');
  assert.deepEqual([...ASSERTS_FAILURE], ['pass1.tests_failing'],
    'one property, and it is the one whose delivery is a failing test');
  // The property that matters: nothing a gate requires to PASS may be satisfied by a failure.
  const asserted = new Set(Object.values(ENTRY_REQUIREMENTS).flatMap((r) => (r.evidence ?? []).map((e) => e.property)));
  for (const p of ['ci.green', 'pass2.attack', 'suite.baseline', 'closure.merged']) {
    assert.ok(asserted.has(p), `${p} is a gate requirement`);
    assert.equal(ASSERTS_FAILURE.has(p), false, `${p} asserts success, so a failed run is not evidence of it`);
  }
});

// --- fifth round, finding 14: a substring is not a failing test --------------

test('14. a plan, a numbered result and a matching count — not a substring', async () => {
  const { parseTap, judgeFailingRun } = await import('../scripts/lib/tap.mjs');
  const NAME = 'Scenario: creation with a blank name';
  const judge = (text, exit = 1) => judgeFailingRun(parseTap(text), NAME, exit);

  const red = judge(`TAP version 13\n1..1\nnot ok 1 - ${NAME}\n`);
  assert.equal(red.result, 'PASS');
  assert.equal(red.matched.name, NAME);

  // The exact output that satisfied substring matching: a syntax error echoing the source.
  const crash = judge(`SyntaxError: Unexpected token ';'\nconst ${NAME} = ;\n  at compileSourceTextModule\n`);
  assert.equal(crash.result, 'INFRA_ERROR');
  assert.match(crash.reason, /no test plan/);

  // A YAML diagnostic under a result line may contain anything, including the name.
  const diagnostic = judge([`TAP version 13`, `1..1`, `not ok 1 - some other test`, `  ---`,
    `  error: expected ${NAME}`, `  ...`].join('\n'));
  assert.equal(diagnostic.result, 'INFRA_ERROR');
  assert.match(diagnostic.reason, /never exercised/);

  assert.equal(judge(`TAP version 13\n1..3\nnot ok 1 - ${NAME}\n`).result, 'INFRA_ERROR', 'a truncated run did not finish');
  assert.equal(judge(`TAP version 13\n1..0\n`).result, 'INFRA_ERROR', 'an empty suite is not a failing suite');
  assert.equal(judge(`TAP version 13\n1..1\nnot ok 1 - ${NAME}\nBail out! the database is down\n`).result, 'INFRA_ERROR');
  assert.equal(judge(`TAP version 13\n1..1\nnot ok 1 - ${NAME} # SKIP\n`).result, 'INFRA_ERROR', 'a skipped test did not run');
  assert.equal(judge(`TAP version 13\n1..1\nok 1 - ${NAME}\n`, 0).result, 'FAIL', 'it ran and passed');
  assert.equal(judge(`TAP version 13\n1..1\nnot ok 1 - ${NAME}\n`, 0).result, 'INFRA_ERROR',
    'a failure reported alongside exit 0: the two disagree');

  // A Scenario is usually a subtest, and the plan still counts the file.
  const nested = judge([`TAP version 13`, `    1..1`, `    not ok 1 - ${NAME}`,
    `1..1`, `not ok 1 - account.test.mjs`].join('\n'));
  assert.equal(nested.result, 'PASS');
});

// --- fifth round, finding 15: arguments that reach the command unchanged -----

test('15. an empty argument survives, and one that cannot be carried is refused', async () => {
  const { quoteForCmd, untransportable } = await import('../scripts/lib/launch.mjs');

  assert.equal(quoteForCmd(''), '""', 'an unquoted empty argument disappears entirely');
  assert.equal(quoteForCmd('plain'), 'plain');
  assert.equal(quoteForCmd('two words'), '"two words"');
  assert.equal(quoteForCmd('back\\slash'), 'back\\slash');
  assert.equal(quoteForCmd('with space\\'), '"with space\\\\"', 'a trailing backslash must not escape the closing quote');
  assert.equal(quoteForCmd('a&b'), '"a&b"', 'cmd metacharacters are neutralised by quoting');
  assert.equal(quoteForCmd('a^b'), '"a^b"');

  // These cannot be carried at all, so they are refused rather than delivered as something else.
  assert.match(untransportable('literal%SPECTREE_PROBE%end'), /expands as a variable/);
  assert.match(untransportable('bang!'), /delayed expansion/);
  assert.match(untransportable('a"b'), /parses the line a second time/);
  assert.match(untransportable('two\nlines'), /newline/);
  assert.equal(untransportable('everything else'), null);
  assert.throws(() => quoteForCmd('a"b'), (e) => e.code === 'E_ARGUMENT_UNTRANSPORTABLE');
});

test('15b. arguments reach a .cmd shim byte for byte, or the run is refused', async (t) => {
  if (process.platform !== 'win32') return t.skip('cmd.exe transport is a Windows-only path');
  const { launch } = await import('../scripts/lib/launch.mjs');
  const dir = tempDir('spectree-shim-');
  try {
    // A shim that forwards with %*, exactly as npm.cmd, npx.cmd and pnpm.cmd do.
    writeFileSync(join(dir, 'probe.mjs'), 'console.log(JSON.stringify(process.argv.slice(2)));\n');
    writeFileSync(join(dir, 'probe.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0probe.mjs" %*\r\n`);
    const shim = join(dir, 'probe.cmd');

    const sent = ['', 'two words', 'a&b', 'back\\slash', 'trailing space\\', '(paren)', 'a^b',
      'semi;colon', 'a|b', 'x>y', 'tab\there', 'acentuação e ç', 'eq=sign'];
    const r = launch([shim, ...sent], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout.trim()), sent, 'every argument arrives byte for byte, together');

    for (const bad of ['literal%SPECTREE_PROBE%end', 'a"b', 'bang!']) {
      assert.throws(() => launch([shim, bad], { encoding: 'utf8' }),
        // The message quotes the argument, so compare against its quoted form.
        (e) => e.code === 'E_ARGUMENT_UNTRANSPORTABLE' && e.message.includes(JSON.stringify(bad).slice(1, -1)),
        `${bad} must be refused, not silently altered`);
    }
  } finally { cleanup(dir); }
});

// --- sixth round, finding 16: a diagnostic is not a result ------------------

test('16. a YAML diagnostic can say anything, and none of it is a result', async () => {
  const { parseTap, judgeFailingRun } = await import('../scripts/lib/tap.mjs');
  const TARGET = 'Scenario: creation with a blank name';
  const judge = (lines, exit = 1) => judgeFailingRun(parseTap(lines.join('\n')), TARGET, exit);

  // Real `node --test` shape: one unrelated test failed, and its error message happens to
  // contain a line that reads exactly like a result for the test we are asking about.
  const forged = judge([
    'TAP version 13',
    'not ok 1 - unrelated',
    '  ---',
    '  error: |-',
    `    not ok 1 - ${TARGET}`,
    '  code: ERR_TEST_FAILURE',
    '  ...',
    '1..1',
  ]);
  assert.equal(forged.result, 'INFRA_ERROR');
  assert.match(forged.reason, /never exercised/, 'the diagnostic is the failing test talking about itself');

  // A block that never closes leaves the rest unreadable, and unreadable is not passed.
  const unclosed = judge(['TAP version 13', '1..1', `not ok 1 - ${TARGET}`, '  ---', '  error: x']);
  assert.equal(unclosed.result, 'INFRA_ERROR');
  assert.match(unclosed.reason, /never closed/);
});

test('16b. numbering and per-level plans are checked, not assumed', async () => {
  const { parseTap, judgeFailingRun } = await import('../scripts/lib/tap.mjs');
  const TARGET = 'Scenario: creation with a blank name';
  const judge = (lines, exit = 1) => judgeFailingRun(parseTap(lines.join('\n')), TARGET, exit);

  const duplicated = judge(['TAP version 13', '1..2', `not ok 1 - ${TARGET}`, 'not ok 1 - other']);
  assert.equal(duplicated.result, 'INFRA_ERROR');
  assert.match(duplicated.reason, /same test number twice/);

  const unnumbered = judge(['TAP version 13', '1..1', `not ok - ${TARGET}`]);
  assert.equal(unnumbered.result, 'INFRA_ERROR');
  assert.match(unnumbered.reason, /no number/);

  // The outer plan is complete and the inner one is not: the subtests did not finish, and the
  // outer level cannot see that.
  const innerTruncated = judge([
    'TAP version 13',
    '    1..3',
    `    not ok 1 - ${TARGET}`,
    '1..1',
    'not ok 1 - account.test.mjs',
  ]);
  assert.equal(innerTruncated.result, 'INFRA_ERROR');
  assert.match(innerTruncated.reason, /planned 3 test\(s\) and reported 1/);

  const noPlanAtAll = judge(['TAP version 13', `not ok 1 - ${TARGET}`]);
  assert.equal(noPlanAtAll.result, 'INFRA_ERROR');
  assert.match(noPlanAtAll.reason, /no plan/);

  // Two tests with the same name: which one is the Scenario cannot be decided here.
  const ambiguous = judge(['TAP version 13', '1..2', `not ok 1 - ${TARGET}`, `ok 2 - ${TARGET}`]);
  assert.equal(ambiguous.result, 'INFRA_ERROR');
  assert.match(ambiguous.reason, /appears 2 times/);

  // And the name is matched exactly, so a longer test name is not the one we asked about.
  const nearMiss = judge(['TAP version 13', '1..1', `not ok 1 - ${TARGET} under load`]);
  assert.equal(nearMiss.result, 'INFRA_ERROR');
  assert.match(nearMiss.reason, /never exercised/);

  // What a real, complete nested run looks like.
  const good = judge([
    'TAP version 13',
    `    not ok 1 - ${TARGET}`,
    '    1..1',
    'not ok 1 - account.test.mjs',
    '1..1',
  ]);
  assert.equal(good.result, 'PASS');
  assert.equal(good.matched.name, TARGET);
});

// --- seventh round, finding 17: a group is a document, not an indent --------

test('17. two sibling groups from a real node --test run are two documents', async (t) => {
  const { parseTap, judgeFailingRun } = await import('../scripts/lib/tap.mjs');
  const TARGET = 'Scenario: creation with a blank name';
  const dir = tempDir('spectree-tap-real-');
  try {
    // Not a hand-written fixture: the parser is judged against what the runner actually emits.
    writeFileSync(join(dir, 'sample.test.mjs'), [
      "import { describe, it } from 'node:test';",
      "import assert from 'node:assert/strict';",
      `describe('account creation', () => {`,
      `  it(${JSON.stringify(TARGET)}, () => { assert.equal(1, 2); });`,
      '});',
      `describe('account listing', () => {`,
      `  it('Scenario: lists nothing when empty', () => { assert.ok(true); });`,
      '});',
    ].join('\n'));

    // The outer runner marks its children with NODE_TEST_*, which makes the inner run report
    // to it instead of emitting its own TAP. Drop those so this is a plain `node --test`.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('NODE_TEST')));
    let out = '', status = 0;
    try {
      out = execFileSync(process.execPath, ['--test', '--test-reporter=tap', 'sample.test.mjs'],
        { cwd: dir, encoding: 'utf8', env });
    } catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); status = e.status ?? 1; }
    assert.notEqual(status, 0, `the suite really did fail
${out}`);

    // Both groups sit at the same indentation and each carries its own `1..1`.
    const tap = parseTap(out);
    const nested = tap.groups.filter((g) => g.indent > 0);
    assert.ok(nested.length >= 2, `two sibling groups, not one merged level (saw ${nested.length})`);
    assert.ok(nested.every((g) => g.plan === 1), 'each group plans and reports itself');

    const verdict = judgeFailingRun(tap, TARGET, status);
    assert.equal(verdict.result, 'PASS', verdict.reason);
    assert.equal(verdict.matched.name, TARGET);
  } finally { cleanup(dir); }
});

test('17b. a sibling group can never complete another group\'s plan', async () => {
  const { parseTap, judgeFailingRun } = await import('../scripts/lib/tap.mjs');
  const TARGET = 'Scenario: creation with a blank name';
  // Two incomplete groups whose results, added together, look like one satisfied plan.
  const forged = [
    'TAP version 13',
    `    not ok 1 - ${TARGET}`,
    '    1..2',
    'not ok 1 - account creation',
    '    ok 1 - Scenario: lists nothing when empty',
    'ok 2 - account listing',
    '1..2',
  ].join('\n');
  const r = judgeFailingRun(parseTap(forged), TARGET, 1);
  assert.equal(r.result, 'INFRA_ERROR');
  assert.match(r.reason, /planned 2 test\(s\) and reported 1|no plan of its own/);
});

test('17c. a result numbered outside the plan is refused', async () => {
  const { parseTap, judgeFailingRun } = await import('../scripts/lib/tap.mjs');
  const TARGET = 'Scenario: creation with a blank name';
  const judge = (lines) => judgeFailingRun(parseTap(lines.join('\n')), TARGET, 1);

  const outside = judge(['TAP version 13', '1..1', `not ok 999 - ${TARGET}`]);
  assert.equal(outside.result, 'INFRA_ERROR');
  assert.match(outside.reason, /outside it/);

  const gap = judge(['TAP version 13', '1..3', `not ok 1 - ${TARGET}`, 'ok 2 - b', 'ok 4 - d']);
  assert.equal(gap.result, 'INFRA_ERROR');
  assert.match(gap.reason, /outside it|never reported test 3/);

  const unsupportedPlan = judge(['TAP version 13', '2..2', `not ok 2 - ${TARGET}`]);
  assert.equal(unsupportedPlan.result, 'INFRA_ERROR');
  assert.match(unsupportedPlan.reason, /only "1\.\.N" is supported/);
});

// --- eighth round, finding 18: a complete subtest is not a complete run ------

test('18. the top-level document must close, however tidy the subtests are', async () => {
  const { parseTap, judgeFailingRun } = await import('../scripts/lib/tap.mjs');
  const TARGET = 'Scenario: creation with a blank name';
  const dir = tempDir('spectree-tap-cut-');
  try {
    writeFileSync(join(dir, 'sample.test.mjs'), [
      "import { describe, it } from 'node:test';",
      "import assert from 'node:assert/strict';",
      `describe('account creation', () => {`,
      `  it(${JSON.stringify(TARGET)}, () => { assert.equal(1, 2); });`,
      '});',
    ].join('\n'));
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('NODE_TEST')));
    let out = '', status = 0;
    try {
      out = execFileSync(process.execPath, ['--test', '--test-reporter=tap', 'sample.test.mjs'], { cwd: dir, encoding: 'utf8', env });
    } catch (e) { out = (e.stdout ?? '') + (e.stderr ?? ''); status = e.status ?? 1; }
    assert.notEqual(status, 0);
    assert.equal(judgeFailingRun(parseTap(out), TARGET, status).result, 'PASS', 'the whole run is accepted');

    // Cut the stream right after the subtest's own plan: the subtest is complete and correct,
    // and the run it belongs to never reported anything at all.
    const lines = out.split('\n');
    const cut = lines.findIndex((l) => /^\s+1\.\.\d+\s*$/.test(l));
    assert.ok(cut > 0, 'the subtest does declare its own plan');
    const truncated = judgeFailingRun(parseTap(lines.slice(0, cut + 1).join('\n')), TARGET, status);
    assert.equal(truncated.result, 'INFRA_ERROR');
    assert.match(truncated.reason, /never closed|no result in its parent/);
  } finally { cleanup(dir); }
});

test('18b. a subtest with no result in its parent is refused, counts or no counts', async () => {
  const { parseTap, judgeFailingRun } = await import('../scripts/lib/tap.mjs');
  const TARGET = 'Scenario: creation with a blank name';
  const judge = (lines, exit = 1) => judgeFailingRun(parseTap(lines.join('\n')), TARGET, exit);

  // Every count adds up — the root plans 1 and reports 1, the subtest plans 1 and reports 1 —
  // and nothing in the root is the subtest's verdict.
  const dangling = judge([
    'TAP version 13',
    '1..1',
    'ok 1 - unrelated',
    `    not ok 1 - ${TARGET}`,
    '    1..1',
  ]);
  assert.equal(dangling.result, 'INFRA_ERROR');
  assert.match(dangling.reason, /no result in its parent/);

  // And a parent that answers for a failing subtest by recording it as passing is two
  // descriptions of different runs.
  const contradictory = judge([
    'TAP version 13',
    `    not ok 1 - ${TARGET}`,
    '    1..1',
    'ok 1 - account creation',
    '1..1',
  ]);
  assert.equal(contradictory.result, 'INFRA_ERROR');
  assert.match(contradictory.reason, /recorded it as passing/);
});
