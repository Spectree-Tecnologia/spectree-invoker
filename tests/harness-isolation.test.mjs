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
import { detectHarness, isolationProbe, observedIsolationSignal, executionContext } from '../scripts/lib/harness.mjs';

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
  // The process digest is shared; the context isolation it does not measure is named beside it.
  assert.match(executionContext(a).isolation_signal, /^dispatch-probe \d{4}-\d{2}-\d{2}$/);
  assert.equal(executionContext({ CODEX_HOME: '/x' }).isolation_signal, 'none');
});

// --- isolation comes from a recorded dispatch probe, never from a word ---------------------------

const adapterWith = (caps, probe) => ({ capabilities: caps, ...(probe ? { context_isolation_probe: probe } : {}) });
const PROBE = {
  observed_at: '2026-10-04', dispatch: 'named subagent, not a fork',
  negative_arm: 'marker held only by the loop: NOT_VISIBLE', control_arm: 'marker in the dispatch: quoted back',
  source: 'https://code.claude.com/docs/en/sub-agents.md',
};

test('a recorded probe with both arms is an observation; a word without one is not', () => {
  assert.deepEqual(isolationProbe(adapterWith({ context_isolation: 'observed' }, PROBE)), PROBE);
  // The bare words that once unlocked the mode, and the new word with no record behind it.
  for (const word of ['declared', 'prompt_only', 'observed']) {
    assert.equal(isolationProbe(adapterWith({ context_isolation: word })), null, `"${word}" alone`);
  }
  // A probe missing its control arm is a negative result nobody showed could be positive.
  const { control_arm, ...noControl } = PROBE;
  assert.equal(isolationProbe(adapterWith({ context_isolation: 'observed' }, noControl)), null);
  const { negative_arm, ...noNegative } = PROBE;
  assert.equal(isolationProbe(adapterWith({ context_isolation: 'observed' }, noNegative)), null);
  // And a probe only counts under the word that claims it.
  assert.equal(isolationProbe(adapterWith({ context_isolation: 'declared' }, PROBE)), null);
});

test('only a verified harness identity selects a probe', () => {
  assert.ok(observedIsolationSignal({ CLAUDECODE: '1' }), 'Claude Code carries a recorded probe');
  assert.equal(observedIsolationSignal({ CODEX_HOME: '/x' }), null, 'Codex was never probed');
  // The squad's own variable is a claim: it must not borrow another harness's observation.
  assert.equal(observedIsolationSignal({ SPECTREE_HARNESS: 'claude-code' }), null);
  assert.equal(observedIsolationSignal({}), null);
});

test('the Claude Code probe is the one actually run, and says what it does not cover', () => {
  const adapter = JSON.parse(readFileSync(join(REPO, 'adapters/claude-code/adapter.json'), 'utf8'));
  const probe = isolationProbe(adapter);
  assert.ok(probe, 'the shipped adapter must carry a complete probe');
  assert.match(probe.dispatch, /not a fork/, 'a fork inherits the conversation and is never isolated');
  assert.match(probe.does_not_cover ?? '', /filesystem/, 'isolation of context is never reported as a sandbox');
});

test('Claude Code reaches "delegating-with-isolation" through the probe; Codex does not', () => {
  const claude = capabilities({ ...process.env, CLAUDECODE: '1' });
  assert.equal(factOf(claude, 'operating_mode').value, 'delegating-with-isolation');
  // A recorded observation, not something this script measured: DECLARED, never VERIFIED.
  assert.equal(factOf(claude, 'operating_mode').confidence, 'DECLARED');
  assert.match(factOf(claude, 'context_isolation.observed').value, /^yes — dispatch probe, \d{4}-\d{2}-\d{2}$/);

  const env = { ...process.env, CODEX_HOME: '/x' };
  delete env.CLAUDECODE; delete env.CLAUDE_PLUGIN_ROOT;
  const codex = capabilities(env);
  assert.equal(factOf(codex, 'operating_mode').value, 'delegating-without-proven-isolation');
  assert.equal(factOf(codex, 'operating_mode').confidence, 'UNKNOWN');
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
    assert.equal(consumerMode, 'delegating-with-isolation', 'the probe travels with the adapter into the install');
  } finally { cleanup(repo.root); }
});

// --- evidence carries the context it was produced in ----------------------------------------------

test('state.mjs run records the measured context beside the declared independence', () => {
  const repo = gitRepo({ 'seed.txt': 'seed\n', '.gitignore': '.spectree/\n' });
  const scratch = tempDir('spectree-ctx-');
  try {
    // The harness is pinned, so the expectation below does not depend on who runs the suite.
    const cli = (...args) => spawnSync(process.execPath, [join(REPO, 'scripts', 'state.mjs'), ...args],
      { cwd: repo.root, encoding: 'utf8', env: { ...process.env, CLAUDECODE: '1' } });

    assert.equal(cli('init', 'p').status, 0);
    assert.equal(cli('open', 'c1', '--scope', 's', '--paths', 'seed.txt', '--deltaless', '--closure-mode', 'legacy').status, 0);
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
    assert.match(doc.executor.context.isolation_signal, /^dispatch-probe \d{4}-\d{2}-\d{2}$/);

    // The record has to survive its own schema — an evidence document the validator rejects is
    // not a record, and `validate` is what the resume contract leans on.
    const v = cli('validate');
    assert.equal(v.status, 0, v.stderr);
  } finally { cleanup(repo.root); cleanup(scratch); }
});
