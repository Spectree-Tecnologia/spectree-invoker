// What the harness actually exposes about the context a command ran in — and what may be claimed
// from it.
//
// These exist because the same script answered `single-context` inside a consumer and
// `delegating-with-isolation` inside the package, on one machine, about one harness. The second
// answer came from a JSON field somebody typed, and it switched off the very NOTE that stops
// `pass2_complete` closing on an independence nobody observed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gitRepo, tempDir, cleanup, REPO } from './helpers.mjs';
import { detectHarness, observedIsolationSignal, executionContext } from '../scripts/lib/harness.mjs';

const capabilities = (env) => {
  const r = spawnSync(process.execPath, [join(REPO, 'scripts', 'capabilities.mjs'), '--json'],
    { cwd: REPO, encoding: 'utf8', env });
  return JSON.parse(r.stdout);
};
const factOf = (report, name) => report.facts.find((f) => f.name === name);

// --- the harness is read from the environment, and it is read in ONE place -----------------------

test('detectHarness separates what the environment proves from what it merely asserts', () => {
  assert.deepEqual(detectHarness({ CLAUDECODE: '1' }), { harness: 'claude-code', verified: true });
  assert.deepEqual(detectHarness({ CODEX_HOME: '/x' }), { harness: 'codex', verified: true });
  // A variable the squad itself defines is a claim, never a proof — the distinction the whole
  // VERIFIED/DECLARED split rests on.
  assert.deepEqual(detectHarness({ SPECTREE_HARNESS: 'acme' }), { harness: 'acme', verified: false });
  assert.deepEqual(detectHarness({}), { harness: 'unknown', verified: false });
});

// --- the digest discriminates, in both directions -------------------------------------------------

test('executionContext yields one digest per context, and a different one per context', () => {
  const a = { CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's-1', CLAUDE_PID: '10', AI_AGENT: 'x' };
  const b = { ...a, CLAUDE_CODE_SESSION_ID: 's-2' };

  // Same context twice: the same digest. This is the arm that matters for M4 — two dispatches on a
  // harness with no isolation signal land HERE, agreeing they came from one context.
  assert.equal(executionContext(a).digest, executionContext(a).digest);
  assert.match(executionContext(a).digest, /^[0-9a-f]{16}$/);

  // And a different context: a different digest. Without this arm the equality above would pass
  // just as well on a function that returned a constant, and would prove nothing.
  assert.notEqual(executionContext(a).digest, executionContext(b).digest);

  assert.equal(executionContext(a).harness, 'claude-code');
  assert.equal(executionContext(a).isolation_signal, 'none');
});

// --- no harness proves isolation, and the mode may not say otherwise ------------------------------

test('no harness measured so far exposes an isolation signal', () => {
  // Stated outright rather than implied, so that the day this returns a marker the change is
  // deliberate and every claim downstream of it is revisited in the same commit.
  assert.equal(observedIsolationSignal(), null);
});

test('a declared context_isolation does not reach "delegating-with-isolation"', () => {
  const declared = JSON.parse(readFileSync(join(REPO, 'adapters/claude-code/adapter.json'), 'utf8'));
  assert.equal(declared.capabilities.subagents, 'declared',
    'this test is only meaningful while the adapter claims subagents');

  const report = capabilities({ ...process.env, CLAUDECODE: '1' });
  const mode = factOf(report, 'operating_mode');
  assert.notEqual(mode.value, 'delegating-with-isolation');
  assert.equal(mode.value, 'delegating-without-proven-isolation');
  assert.equal(mode.confidence, 'UNKNOWN');
  // The declaration is still reported — it is a fact about the adapter. It is just not the fact
  // the mode is computed from.
  assert.equal(factOf(report, 'adapter.claude-code.context_isolation').value, 'prompt_only');
  assert.equal(factOf(report, 'context_isolation.observed').confidence, 'UNKNOWN');
});

// --- and a consumer gets the same answer as the package -------------------------------------------

test('an installed consumer reports the same operating mode as the package', () => {
  const repo = gitRepo({ 'seed.txt': 'seed\n', '.gitignore': '.spectree/\n' });
  try {
    execFileSync(process.execPath, [join(REPO, 'scripts', 'install-codex.mjs'), repo.root, '--apply'],
      { encoding: 'utf8' });

    const adapters = join(repo.root, '.spectree/squad/adapters');
    assert.ok(existsSync(adapters), 'the installer must ship the adapter declarations');
    assert.ok(readdirSync(adapters).includes('claude-code'));

    const r = spawnSync(process.execPath, [join(repo.root, '.spectree/squad/scripts/capabilities.mjs'), '--json'],
      { cwd: repo.root, encoding: 'utf8', env: { ...process.env, CLAUDECODE: '1' } });
    const consumerMode = factOf(JSON.parse(r.stdout), 'operating_mode').value;
    const packageMode = factOf(capabilities({ ...process.env, CLAUDECODE: '1' }), 'operating_mode').value;

    // One harness, one machine, one answer. It used to be `single-context` here and
    // `delegating-with-isolation` there, and a reader had no way to tell which was the lie.
    assert.equal(consumerMode, packageMode);
    assert.equal(consumerMode, 'delegating-without-proven-isolation');
  } finally { cleanup(repo.root); }
});

// --- evidence carries the context it was produced in ----------------------------------------------

test('state.mjs run records the measured context beside the declared independence', () => {
  const repo = gitRepo({ 'seed.txt': 'seed\n', '.gitignore': '.spectree/\n' });
  const scratch = tempDir('spectree-ctx-');
  try {
    const cli = (...args) => spawnSync(process.execPath, [join(REPO, 'scripts', 'state.mjs'), ...args],
      { cwd: repo.root, encoding: 'utf8' });

    assert.equal(cli('init', 'p').status, 0);
    assert.equal(cli('open', 'c1', '--scope', 's', '--paths', 'seed.txt', '--deltaless').status, 0);
    const run = cli('run', 'c1', 'pass2.attack', '--role', 'quality_engineer',
      '--independent-of', 'full_stack_developer', '--', process.execPath, '-e', '0');
    assert.equal(run.status, 0, run.stderr);

    const dir = join(repo.root, '.spectree/evidence');
    const doc = JSON.parse(readFileSync(join(dir, readdirSync(dir)[0]), 'utf8'));

    // The declaration is still there, unchanged: removing it would be a different decision.
    assert.deepEqual(doc.executor.independent_of, ['full_stack_developer']);
    // And beside it, what was actually measured.
    assert.equal(typeof doc.executor.context.harness, 'string');
    assert.match(doc.executor.context.digest, /^[0-9a-f]{16}$/);
    assert.equal(doc.executor.context.isolation_signal, 'none');

    // The record has to survive its own schema — an evidence document the validator rejects is
    // not a record, and `validate` is what the resume contract leans on.
    const v = cli('validate');
    assert.equal(v.status, 0, v.stderr);
  } finally { cleanup(repo.root); cleanup(scratch); }
});
