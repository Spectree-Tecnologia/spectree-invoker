// A second pass 2 round on the same change attacks what moved since the first, not the whole
// change again. Coverage is recorded per round, bound to bytes; it never stands for evidence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitRepo, writeFiles, cleanup, change, writePass2Brief } from './helpers.mjs';
import { Store } from '../scripts/lib/change/store.mjs';
import { startWork, finishWork, reconcileWork, envelopeUsage } from '../scripts/lib/change/work.mjs';
import { rmSync } from 'node:fs';
import { contentDigest } from '../scripts/lib/shared/digest.mjs';
import { recordPass2Round, pass2Scope, pass2Command } from '../scripts/lib/evidence/pass2.mjs';
import { consumer, upToImplemented } from './cli-cycle-fixture.mjs';

function repo() {
  const r = gitRepo({ 'src/a.cjs': 'module.exports = 1;\n', 'src/b.cjs': 'module.exports = 2;\n' });
  r.git(['checkout', '-qb', 'feature']);
  const s = new Store(r.root); s.init({ project_id: 'proj', protocol_version: '1.0.0' });
  s.putChange(change({ base_revision: r.base, state: 'implemented', allowed_paths: ['src/'] }));
  writeFiles(r.root, { 'src/a.cjs': 'module.exports = 10;\n', 'src/b.cjs': 'module.exports = 20;\n', 'src/c.cjs': 'module.exports = 3;\n' });
  r.git(['add', '-A']); r.git(['commit', '-qm', 'implementation']);
  return r;
}
function round(r, op, report, envelope = { status: 'completed', toolUseResult: { totalDurationMs: 3_600_000, totalTokens: 391_000, totalToolUseCount: 161 } }) {
  startWork(r.root, 'c1', op, { phase: 'pass2', task: 'attack the prepared closure', next: 'Record the round.', brief: writePass2Brief(r.root, op) });
  finishWork(r.root, 'c1', op, { result: envelope, next: 'Repair what it found.' });
  return recordPass2Round(r.root, 'c1', report, { operation: op });
}
function probe(r, mutations) {
  // Saved under .spectree/, outside the content it measured: a report in the tree would move it.
  writeFiles(r.root, { '.spectree/probe.json': JSON.stringify({ version: 1, source_digest: contentDigest(r.root).digest, result: 'PASS', mutations }) });
  return '.spectree/probe.json';
}

test('with no round recorded, the first round attacks the whole change', () => {
  const r = repo();
  try {
    const scope = pass2Scope(r.root, 'c1');
    assert.deepEqual(scope.attack.map((a) => a.path), ['src/a.cjs', 'src/b.cjs', 'src/c.cjs']);
    assert.equal(scope.authorizes_execution, false);
  } finally { cleanup(r.root); }
});

test('after a fix, the next round attacks only what moved, and carries the kills whose target did not', () => {
  const r = repo();
  try {
    const first = round(r, 'pass2-r1', { attacked: ['src/a.cjs', 'src/b.cjs', 'src/c.cjs'], mutation_report: probe(r, [
      { id: 'm-a', target: 'src/a.cjs', test_name: 'A', result: 'PASS' },
      { id: 'm-b', target: 'src/b.cjs', test_name: 'B', result: 'PASS' }]) });
    assert.equal(first.round, 1);
    assert.deepEqual(first.operation.usage, { duration_ms: 3_600_000, total_tokens: 391_000, tool_uses: 161 });
    assert.equal(typeof first.operation.elapsed_ms, 'number');
    // The repair of what round 1 found touches one file.
    writeFiles(r.root, { 'src/b.cjs': 'module.exports = 21;\n' });
    r.git(['add', '-A']); r.git(['commit', '-qm', 'repair']);
    const scope = pass2Scope(r.root, 'c1');
    assert.deepEqual(scope.attack.map((a) => a.path), ['src/b.cjs']);
    assert.deepEqual(scope.covered.map((c) => c.path), ['src/a.cjs', 'src/c.cjs']);
    assert.deepEqual(scope.mutations.carried.map((m) => m.id), ['m-a']);
    assert.deepEqual(scope.mutations.rerun.map((m) => m.id), ['m-b']);
    assert.equal(scope.rounds[0].usage.total_tokens, 391_000);
  } finally { cleanup(r.root); }
});

test('a surviving mutant is never carried, not even behind an older kill, and a probe from other content is refused', () => {
  const r = repo();
  try {
    round(r, 'pass2-r0', { attacked: ['src/a.cjs'], mutation_report: probe(r, [{ id: 'm-a', target: 'src/a.cjs', test_name: 'A', result: 'PASS' }]) });
    const report = probe(r, [{ id: 'm-a', target: 'src/a.cjs', test_name: 'A', result: 'FAIL' }]);
    round(r, 'pass2-r1', { attacked: ['src/a.cjs'], mutation_report: report });
    assert.deepEqual(pass2Scope(r.root, 'c1').mutations, { carried: [], rerun: [{ id: 'm-a', target: 'src/a.cjs', round: 2 }] });
    writeFileSync(join(r.root, '.spectree/probe.json'), JSON.stringify({ version: 1, source_digest: 'sha256:' + '0'.repeat(64), mutations: [] }));
    startWork(r.root, 'c1', 'pass2-r2', { phase: 'pass2', task: 'attack', next: 'Record.', brief: writePass2Brief(r.root) });
    finishWork(r.root, 'c1', 'pass2-r2', { result: { status: 'completed' }, next: 'Record.' });
    assert.throws(() => recordPass2Round(r.root, 'c1', { attacked: ['src/a.cjs'], mutation_report: '.spectree/probe.json' }, { operation: 'pass2-r2' }), { code: 'E_PASS2_PROBE_STALE' });
  } finally { cleanup(r.root); }
});

test('a round is bound to the bytes it finished on, and recorded once', () => {
  const r = repo();
  try {
    startWork(r.root, 'c1', 'pass2-r1', { phase: 'pass2', task: 'attack', next: 'Record.', brief: writePass2Brief(r.root) });
    finishWork(r.root, 'c1', 'pass2-r1', { result: { status: 'completed' }, next: 'Record.' });
    // A repair lands before anyone records the round: recording it would mark the repair as attacked.
    writeFiles(r.root, { 'src/b.cjs': 'module.exports = 21;\n' });
    assert.throws(() => recordPass2Round(r.root, 'c1', { attacked: ['src/b.cjs'] }, { operation: 'pass2-r1' }), { code: 'E_PASS2_STALE' });
    writeFiles(r.root, { 'src/b.cjs': 'module.exports = 20;\n' });
    recordPass2Round(r.root, 'c1', { attacked: ['src/b.cjs'] }, { operation: 'pass2-r1' });
    assert.throws(() => recordPass2Round(r.root, 'c1', { attacked: ['src/b.cjs'] }, { operation: 'pass2-r1' }), { code: 'E_PASS2_DUPLICATE' });
    startWork(r.root, 'c1', 'pass2-r2', { phase: 'pass2', task: 'attack', next: 'Record.', brief: writePass2Brief(r.root) });
    finishWork(r.root, 'c1', 'pass2-r2', { result: { status: 'completed', error: 'rate_limit' }, next: 'Resume.' });
    assert.throws(() => recordPass2Round(r.root, 'c1', { attacked: ['src/a.cjs'] }, { operation: 'pass2-r2' }), { code: 'E_PASS2_UNFINISHED' });
    startWork(r.root, 'c1', 'implement-1', { phase: 'implement', task: 'B', next: 'Verify.' });
    finishWork(r.root, 'c1', 'implement-1', { result: { status: 'completed' }, next: 'Verify.' });
    assert.throws(() => recordPass2Round(r.root, 'c1', { attacked: ['src/b.cjs'] }, { operation: 'implement-1' }), { code: 'E_PASS2_OPERATION' });
  } finally { cleanup(r.root); }
});

test('a mutant is its id on its target: a reused id never hides a survivor on another file', () => {
  const r = repo();
  try {
    round(r, 'pass2-r1', { attacked: ['src/a.cjs'], mutation_report: probe(r, [{ id: 'm1', target: 'src/a.cjs', test_name: 'A', result: 'FAIL' }]) });
    round(r, 'pass2-r2', { attacked: ['src/b.cjs'], mutation_report: probe(r, [{ id: 'm1', target: 'src/b.cjs', test_name: 'B', result: 'PASS' }]) });
    const { carried, rerun } = pass2Scope(r.root, 'c1').mutations;
    assert.deepEqual(carried.map((m) => m.target), ['src/b.cjs']);
    assert.deepEqual(rerun.map((m) => m.target), ['src/a.cjs']);
  } finally { cleanup(r.root); }
});

test('a file name with glob characters reads its own mode, not a match', { skip: process.platform === 'win32' }, () => {
  const r = repo();
  try {
    writeFiles(r.root, { 'src/d.cjs': 'x\n' }); chmodSync(join(r.root, 'src/d.cjs'), 0o755);
    r.git(['add', '-A']); r.git(['commit', '-qm', 'executable d']);
    writeFiles(r.root, { 'src/[d].cjs': 'route\n' });
    round(r, 'pass2-r1', { attacked: ['src/[d].cjs'] });
    chmodSync(join(r.root, 'src/[d].cjs'), 0o755);
    assert.ok(pass2Scope(r.root, 'c1').attack.some((a) => a.path === 'src/[d].cjs'));
  } finally { cleanup(r.root); }
});

test('a file that cannot be fingerprinted is attacked as unknown, never listed as deleted', { skip: process.platform === 'win32' }, () => {
  const r = repo();
  try {
    writeFiles(r.root, { 'src/rule:v2.cjs': 'module.exports = 2;\n' });
    const scope = pass2Scope(r.root, 'c1');
    assert.deepEqual(scope.deleted, []);
    assert.match(scope.attack.find((a) => a.path === 'src/rule:v2.cjs').reason, /^unknown/);
  } finally { cleanup(r.root); }
});

test('rounds are recorded in the order they finished', () => {
  const r = repo();
  try {
    for (const op of ['pass2-a', 'pass2-b']) {
      startWork(r.root, 'c1', op, { phase: 'pass2', task: 'attack', next: 'Record.', brief: writePass2Brief(r.root) });
      finishWork(r.root, 'c1', op, { result: { status: 'completed' }, next: 'Record.' });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); // distinct finish times
    }
    recordPass2Round(r.root, 'c1', { attacked: ['src/a.cjs'] }, { operation: 'pass2-b' });
    assert.throws(() => recordPass2Round(r.root, 'c1', { attacked: ['src/a.cjs'] }, { operation: 'pass2-a' }), { code: 'E_PASS2_ORDER' });
  } finally { cleanup(r.root); }
});

test('a file whose only change is its execute bit is attacked again', { skip: process.platform === 'win32' }, () => {
  const r = repo();
  try {
    round(r, 'pass2-r1', { attacked: ['src/a.cjs', 'src/b.cjs', 'src/c.cjs'] });
    // Committed, as the content digest reads a tracked file's mode from the index.
    chmodSync(join(r.root, 'src/a.cjs'), 0o755); r.git(['add', 'src/a.cjs']); r.git(['commit', '-qm', 'executable']);
    assert.deepEqual(pass2Scope(r.root, 'c1').attack.map((a) => a.path), ['src/a.cjs']);
  } finally { cleanup(r.root); }
});

test('a renamed file leaves its old path listed as deleted, and the new one to attack', () => {
  const r = repo();
  try {
    r.git(['mv', 'src/a.cjs', 'src/renamed.cjs']); r.git(['commit', '-qm', 'rename']);
    const scope = pass2Scope(r.root, 'c1');
    assert.deepEqual(scope.attack.map((a) => a.path), ['src/b.cjs', 'src/c.cjs', 'src/renamed.cjs']);
    assert.deepEqual(scope.deleted, [{ path: 'src/a.cjs' }]);
  } finally { cleanup(r.root); }
});

test('a round is recorded only after its operation finished, and only over candidate files', () => {
  const r = repo();
  try {
    startWork(r.root, 'c1', 'pass2-open', { phase: 'pass2', task: 'attack', next: 'Finish it.', brief: writePass2Brief(r.root) });
    assert.throws(() => recordPass2Round(r.root, 'c1', { attacked: ['src/a.cjs'] }, { operation: 'pass2-open' }), { code: 'E_PASS2_OPERATION' });
    finishWork(r.root, 'c1', 'pass2-open', { result: { status: 'completed' }, next: 'Record.' });
    assert.throws(() => recordPass2Round(r.root, 'c1', { attacked: ['src/missing.cjs'] }, { operation: 'pass2-open' }), { code: 'E_PASS2_REPORT' });
    assert.throws(() => recordPass2Round(r.root, 'c1', { attacked: ['.spectree/state.json'] }, { operation: 'pass2-open' }), { code: 'E_PASS2_REPORT' });
    assert.throws(() => recordPass2Round(r.root, 'c1', { attacked: ['src/a.cjs'], verdict: 'all good' }, { operation: 'pass2-open' }), { code: 'E_PASS2_REPORT' });
    const lines = []; const code = pass2Command({ root: r.root, argv: ['record', 'c1', 'x.json'], err: (s) => lines.push(s) });
    assert.equal(code, 2); assert.match(lines[0], /usage/);
  } finally { cleanup(r.root); }
});

test('an envelope without usage numbers leaves usage unknown, never zero', () => {
  assert.equal(envelopeUsage({ status: 'completed' }), null);
  assert.deepEqual(envelopeUsage({ toolUseResult: { totalTokens: 12 } }), { duration_ms: null, total_tokens: 12, tool_uses: null });
});

test('evidence records when its command started and how long it ran', () => {
  const c = consumer();
  try {
    upToImplemented(c);
    const r = c.cli('run', 'c1', 'pass2.attack', '--role', 'quality_engineer', '--independent-of', 'full_stack_developer',
      '--id', 'e-timed', '--', process.execPath, '-e', 'setTimeout(() => {}, 50)');
    assert.equal(r.code, 0, r.err);
    const stored = JSON.parse(readFileSync(join(c.root, '.spectree/evidence/e-timed.json'), 'utf8'));
    assert.match(stored.started_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    assert.ok(stored.elapsed_ms >= 40, `elapsed_ms ${stored.elapsed_ms}`);
  } finally { c.drop(); }
});

test('a finished round must be recorded before any repair starts, and a new round may start meanwhile', () => {
  const r = repo();
  const repair = (op) => () => startWork(r.root, 'c1', op, { phase: 'implement', task: 'repair a pass 2 finding', next: 'Verify.' });
  try {
    startWork(r.root, 'c1', 'pass2-r1', { phase: 'pass2', task: 'attack', next: 'Record the round.', brief: writePass2Brief(r.root, 'pass2-r1') });
    finishWork(r.root, 'c1', 'pass2-r1', { result: { status: 'completed' }, next: 'Record the round.' });
    assert.throws(repair('fix-1'), { code: 'E_PASS2_UNRECORDED' });
    startWork(r.root, 'c1', 'pass2-r2', { phase: 'pass2', task: 'attack again', next: 'Record the round.', brief: writePass2Brief(r.root, 'pass2-r2') });
    recordPass2Round(r.root, 'c1', { attacked: ['src/a.cjs'] }, { operation: 'pass2-r1' });
    repair('fix-1')();
    // A round whose content already moved can no longer be recorded: reconciling it unblocks the repair.
    finishWork(r.root, 'c1', 'pass2-r2', { result: { status: 'completed' }, next: 'Record the round.' });
    assert.throws(repair('fix-2'), { code: 'E_PASS2_UNRECORDED' });
    writeFiles(r.root, { '.spectree/inspected.txt': 'the repair already moved the attacked bytes' });
    reconcileWork(r.root, 'c1', 'pass2-r2', { note: 'content moved before the record', next: 'Attack the whole change again.', refs: ['.spectree/inspected.txt'] });
    repair('fix-2')();
  } finally { cleanup(r.root); }
});

test('a round recorded before its operation was marked is marked on a second record, never recorded twice', () => {
  const r = repo();
  try {
    const first = round(r, 'pass2-r1', { attacked: ['src/a.cjs'] });
    rmSync(join(r.root, '.spectree/work/c1/pass2-r1/recorded.json'));
    assert.throws(() => startWork(r.root, 'c1', 'fix-1', { phase: 'implement', task: 'repair', next: 'Verify.' }), { code: 'E_PASS2_UNRECORDED' });
    assert.equal(recordPass2Round(r.root, 'c1', { attacked: ['src/a.cjs'] }, { operation: 'pass2-r1' }).round, first.round);
    assert.throws(() => recordPass2Round(r.root, 'c1', { attacked: ['src/a.cjs'] }, { operation: 'pass2-r1' }), { code: 'E_PASS2_DUPLICATE' });
    startWork(r.root, 'c1', 'fix-1', { phase: 'implement', task: 'repair', next: 'Verify.' });
  } finally { cleanup(r.root); }
});
