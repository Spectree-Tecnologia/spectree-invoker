// §15.19 idempotent resume · §15.20 concurrent update · §15.21 read-only mode
// §8.2 deltaless closure · §8.3 scenario loss and stale delta · §6 persistence
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { Store, writeAtomic } from '../scripts/lib/change/store.mjs';
import {
  checkDeltaless, checkProposalDeltaContract, checkModifiedScenarioLoss,
  checkRemovals, applyOrder, evidenceStillValid, DELTA_OPS,
} from '../scripts/lib/closure/closure.mjs';
import { KIND } from '../scripts/lib/evidence/diff.mjs';
import { tempDir, cleanup, change, evidence, approval } from './helpers.mjs';

const code = (fs) => fs.map((f) => f.code);

// --- deltaless ---------------------------------------------------------------

test('declaring deltaless while shipping a delta is a contradiction', () => {
  const f = checkDeltaless({ tests: [] }, { declaredDeltaless: true, hasSpecFolder: true });
  assert.ok(code(f).includes('E_DELTALESS_CONTRADICTION'));
});

test('an empty specs/ folder nobody declared is refused', () => {
  const f = checkDeltaless({ tests: [] }, { declaredDeltaless: false, hasSpecFolder: false });
  assert.ok(code(f).includes('E_UNDECLARED_EMPTY_SPECS'));
});

test('an edited test under a deltaless change is a review item, not an automatic error', () => {
  const f = checkDeltaless({ tests: [{ path: 'src/a.test.ts', status: 'M' }] },
    { declaredDeltaless: true, hasSpecFolder: false });
  const item = f.find((x) => x.code === 'W_DELTALESS_TESTS_TOUCHED');
  assert.ok(item, 'the old rule made this an error; it is a question for a reader');
  assert.equal(item.severity, 'review');
  assert.equal(item.mechanical, false);
  assert.ok(item.review_questions.some((q) => /weakened/.test(q)));
  assert.equal(f.filter((x) => x.severity === 'error').length, 0);
});

test('untouched tests are reported as what they are: not a proof of equivalence', () => {
  const f = checkDeltaless({ tests: [] }, { declaredDeltaless: true, hasSpecFolder: false });
  const info = f.find((x) => x.code === 'I_TESTS_UNTOUCHED');
  assert.ok(info);
  assert.match(info.message, /does not by itself demonstrate behavioural equivalence/);
});

// --- proposal ↔ delta --------------------------------------------------------

test('the modules named and the delta files present must be the same set', () => {
  assert.deepEqual(code(checkProposalDeltaContract(['a', 'b'], ['a', 'b'])), []);
  assert.ok(code(checkProposalDeltaContract(['a', 'b'], ['a'])).includes('E_NAMED_WITHOUT_DELTA'));
  assert.ok(code(checkProposalDeltaContract(['a'], ['a', 'b'])).includes('E_DELTA_WITHOUT_NAME'));
});

// --- scenario loss and stale delta ------------------------------------------

test('a MODIFIED block that drops a Scenario is refused, and the missing ones are named', () => {
  const f = checkModifiedScenarioLoss({
    requirement: 'Account rejects empty name',
    livingScenarios: ['blank name', 'rename to empty', 'valid name'],
    blockScenarios: ['blank name', 'valid name'],
    baseScenarios: ['blank name', 'rename to empty', 'valid name'],
  });
  const e = f.find((x) => x.code === 'E_SCENARIO_DROPPED');
  assert.ok(e);
  assert.deepEqual(e.detail, ['rename to empty']);
  assert.match(e.remedy, /copy these back/);
});

test('the same comparison detects a delta written before another change landed', () => {
  const f = checkModifiedScenarioLoss({
    requirement: 'R',
    livingScenarios: ['old one', 'added by change A'],
    blockScenarios: ['old one'],
    baseScenarios: ['old one'],
  });
  const e = f.find((x) => x.code === 'E_DELTA_STALE');
  assert.ok(e, 'git sees no conflict here: the deltas are different files');
  assert.match(e.remedy, /re-derive/);
});

test('a MODIFIED block carrying everything passes', () => {
  assert.deepEqual(checkModifiedScenarioLoss({
    requirement: 'R', livingScenarios: ['a', 'b'], blockScenarios: ['a', 'b', 'c'], baseScenarios: ['a', 'b'],
  }), []);
});

// --- removals and order ------------------------------------------------------

test('a removal must be identified, justified and in scope', () => {
  assert.ok(code(checkRemovals([{ reason: 'obsolete' }])).includes('E_REMOVAL_UNIDENTIFIED'));
  assert.ok(code(checkRemovals([{ requirement: 'R' }])).includes('E_REMOVAL_UNJUSTIFIED'));
  assert.ok(code(checkRemovals([{ requirement: 'R', reason: 'x', in_approved_scope: false }])).includes('E_REMOVAL_OUT_OF_SCOPE'));
  assert.deepEqual(code(checkRemovals([{ requirement: 'R', reason: 'x', in_approved_scope: true }])), []);
});

test('delta operations apply RENAMED, REMOVED, MODIFIED, ADDED in that order', () => {
  assert.deepEqual(DELTA_OPS, ['RENAMED', 'REMOVED', 'MODIFIED', 'ADDED']);
  const ordered = applyOrder([{ op: 'ADDED' }, { op: 'MODIFIED' }, { op: 'RENAMED' }, { op: 'REMOVED' }]);
  assert.deepEqual(ordered.map((o) => o.op), DELTA_OPS);
});

// --- evidence reuse ----------------------------------------------------------

test('evidence survives an administrative-only diff and dies on anything executable', () => {
  assert.equal(evidenceStillValid({}, { kinds: [KIND.ADMINISTRATIVE] }).valid, true);
  assert.equal(evidenceStillValid({}, { kinds: [KIND.ADMINISTRATIVE, KIND.SOURCE] }).valid, false);
  assert.equal(evidenceStillValid({}, { kinds: [KIND.DEPENDENCY] }).valid, false, 'a lockfile change is executable content');
  assert.equal(evidenceStillValid({}, { kinds: [KIND.PROTOCOL] }).valid, false, 'the protocol is behaviour here');
});

// --- store: atomicity, concurrency, resume idempotence -----------------------

test('the store refuses a concurrent update instead of merging it', () => {
  const dir = tempDir();
  try {
    const s = new Store(dir);
    s.init({ project_id: 'p', protocol_version: '1.0.0' });
    s.putChange(change({ state: 'draft' }));
    s.putChange({ ...s.change('c1'), state: 'proposed' }, { expected: 1 });
    assert.throws(
      () => s.putChange({ ...s.change('c1'), state: 'scope_approved' }, { expected: 1 }),
      (e) => e.code === 'E_CONCURRENT_UPDATE');
  } finally { cleanup(dir); }
});

test('an atomic write outlasts a reader that has the target open', { skip: process.platform !== 'win32' && 'a Windows sharing violation' }, () => {
  const dir = tempDir();
  try {
    const target = join(dir, 'control.json');
    const ready = join(dir, 'reader-ready');
    writeFileSync(target, 'before');
    // A reader in ANOTHER process — the barrier's poll, an unlocked decision read — holding the
    // handle for a moment. The writer is synchronous, so the reader cannot be in this one.
    const reader = spawn(process.execPath, ['-e',
      `const fs = require('node:fs'); const fd = fs.openSync(${JSON.stringify(target)}, 'r');
       fs.writeFileSync(${JSON.stringify(ready)}, ''); setTimeout(() => fs.closeSync(fd), 300);`]);
    const until = performance.now() + 30_000;
    while (!existsSync(ready)) {
      assert.ok(performance.now() < until, 'the reader never opened the target');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
    // The window is real: a bare rename fails while the handle is held. Without this, a pass
    // below would prove nothing about the retry.
    writeFileSync(`${target}.bare`, 'bare');
    assert.throws(() => renameSync(`${target}.bare`, target), (e) => ['EPERM', 'EACCES', 'EBUSY'].includes(e.code));
    writeAtomic(target, 'after');
    assert.equal(readFileSync(target, 'utf8'), 'after');
    reader.kill();
  } finally { cleanup(dir); }
});

test('history is append-only and replaying a resume does not duplicate an event', () => {
  const dir = tempDir();
  try {
    const s = new Store(dir);
    s.init({ project_id: 'p', protocol_version: '1.0.0' });
    s.putChange(change(), { event: { type: 'opened', event_id: 'ev-1' } });
    const first = s.history('c1').length;
    assert.equal(s.appendHistory('c1', { type: 'opened', event_id: 'ev-1' }), false, 'a repeat is a no-op');
    assert.equal(s.history('c1').length, first);
    assert.equal(s.appendHistory('c1', { type: 'other', event_id: 'ev-2' }), true);
    assert.equal(s.history('c1').length, first + 1);
  } finally { cleanup(dir); }
});

test('current state and history are separate files', () => {
  const dir = tempDir();
  try {
    const s = new Store(dir);
    s.init({ project_id: 'p', protocol_version: '1.0.0' });
    s.putChange(change(), { event: { type: 'opened' } });
    assert.ok(existsSync(join(dir, '.spectree/changes/c1.json')));
    assert.ok(existsSync(join(dir, '.spectree/history/c1.jsonl')));
    const before = readFileSync(join(dir, '.spectree/history/c1.jsonl'), 'utf8');
    s.putChange({ ...s.change('c1'), state: 'proposed' }, { event: { type: 'transition' } });
    assert.ok(readFileSync(join(dir, '.spectree/history/c1.jsonl'), 'utf8').startsWith(before),
      'history is only ever appended to');
  } finally { cleanup(dir); }
});

test('a document from another schema version is refused, never silently fixed', () => {
  const dir = tempDir();
  try {
    const s = new Store(dir);
    s.init({ project_id: 'p', protocol_version: '1.0.0' });
    s.putChange(change());
    const f = join(dir, '.spectree/changes/c1.json');
    const doc = JSON.parse(readFileSync(f, 'utf8'));
    require$writeFileSync(f, JSON.stringify({ ...doc, schema_version: '0.9.0' }, null, 2));
    assert.throws(() => s.change('c1'), (e) => e.code === 'E_SCHEMA_VERSION');
  } finally { cleanup(dir); }
});

test('a deferral gets a stable id past the highest ever used, closed items included', () => {
  const dir = tempDir();
  try {
    const s = new Store(dir);
    s.init({ project_id: 'p', protocol_version: '1.0.0' });
    const a = s.putDeferred({ owner: 'architect', status: 'open', impact: 'defect', current_decision: 'later' });
    const b = s.putDeferred({
      owner: 'architect', status: 'closed', impact: 'defect', current_decision: 'done',
      closure_evidence: { kind: 'evidence', id: 'e1' }, closed_by_change: 'c1',
    });
    const c = s.putDeferred({ owner: 'architect', status: 'open', impact: 'ceiling', current_decision: 'later' });
    assert.deepEqual([a.stable_id, b.stable_id, c.stable_id], [1, 2, 3]);
    assert.equal(s.deferred().items.length, 3, 'a closed item keeps its place');
  } finally { cleanup(dir); }
});

test('the store writes nothing when only read', () => {
  const dir = tempDir();
  try {
    const s = new Store(dir);
    assert.equal(s.present, false);
    assert.equal(s.project(), null);
    assert.deepEqual(s.changes(), []);
    assert.equal(s.change('nope'), null);
    assert.equal(existsSync(join(dir, '.spectree')), false, 'reading must not create the directory');
  } finally { cleanup(dir); }
});

// node:fs import used only by the schema-version test above
import { writeFileSync as require$writeFileSync } from 'node:fs';
