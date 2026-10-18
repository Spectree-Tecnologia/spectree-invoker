// The one persistence layer under `.spectree/`: the three ways a record is written, the lock, and
// the one order in which locks may be taken. The order is enforced, so each test that relies on it
// first shows it refusing the opposite order.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, tempDir, cleanup } from './helpers.mjs';
import { LOCK_ORDER, publishOnce, withLock, writeAtomic, writeOnce } from '../scripts/lib/shared/persistence.mjs';

const withTemp = (fn) => { const dir = tempDir(); try { return fn(dir); } finally { cleanup(dir); } };

test('the lock order is executor, closure control, change, deferral ledger', () => {
  assert.deepEqual([...LOCK_ORDER], ['executor', 'lifecycle', 'change', 'deferred']);
});

test('a lock may only be taken inside one that comes before it in the order', () => withTemp((dir) => {
  const lock = (kind) => join(dir, `${kind}.lock`);
  assert.throws(
    () => withLock('change', lock('change'), () => withLock('lifecycle', lock('lifecycle'), () => 'inverted')),
    { code: 'E_LOCK_ORDER' });
  assert.throws(
    () => withLock('change', lock('change'), () => withLock('change', join(dir, 'other.lock'), () => 'nested')),
    { code: 'E_LOCK_ORDER' }, 'the same kind twice is a second writer of the same thing');
  const nested = withLock('executor', lock('executor'), () =>
    withLock('lifecycle', lock('lifecycle'), () => withLock('change', lock('change'), () =>
      withLock('deferred', lock('deferred'), () => 'in order'))));
  assert.equal(nested, 'in order');
  assert.deepEqual(readdirSync(dir), [], 'every lock released');
}));

test('an unknown lock kind is refused before anything is written', () => withTemp((dir) => {
  assert.throws(() => withLock('ledger', join(dir, 'x.lock'), () => 1), { code: 'E_LOCK_KIND' });
  assert.equal(existsSync(join(dir, 'x.lock')), false);
}));

test('a throwing critical section releases its lock and the order it held', () => withTemp((dir) => {
  const file = join(dir, 'change.lock');
  assert.throws(() => withLock('change', file, () => { throw new Error('boom'); }), /boom/);
  assert.equal(existsSync(file), false);
  assert.equal(withLock('lifecycle', join(dir, 'lifecycle.lock'), () => 'outer again'), 'outer again');
}));

test('a held lock is waited on, then refused through the caller\'s own refusal', () => withTemp((dir) => {
  const file = join(dir, 'change.lock');
  writeFileSync(file, JSON.stringify({ pid: process.pid }));
  let seen;
  assert.throws(() => withLock('change', file, () => 'never', {
    attempts: 2, waitMs: 1, busy: (f) => { seen = f; throw Object.assign(new Error('busy'), { code: 'E_MINE' }); },
  }), { code: 'E_MINE' });
  assert.equal(seen, file);
  assert.throws(() => withLock('change', file, () => 'never', { attempts: 1 }), { code: 'E_CONCURRENT_UPDATE' });
  assert.ok(existsSync(file), 'a lock another owner holds is never removed');
}));

test('the lock records who holds it', () => withTemp((dir) => {
  const file = join(dir, 'executor.lock');
  const owner = withLock('executor', file, () => JSON.parse(readFileSync(file, 'utf8')), { owner: { change_id: 'c1' } });
  assert.equal(owner.pid, process.pid);
  assert.equal(owner.change_id, 'c1');
  assert.ok(owner.host && owner.at);
}));

test('writeOnce refuses an existing record and leaves it as it was', () => withTemp((dir) => {
  const file = join(dir, 'event.json');
  writeOnce(file, 'first');
  assert.throws(() => writeOnce(file, 'second'), { code: 'EEXIST' });
  assert.equal(readFileSync(file, 'utf8'), 'first');
}));

test('publishOnce refuses an existing record and never leaves a temp file behind', () => withTemp((dir) => {
  const file = join(dir, 'nested', 'record.json');
  publishOnce(file, 'first');
  assert.throws(() => publishOnce(file, 'second'), { code: 'EEXIST' });
  assert.equal(readFileSync(file, 'utf8'), 'first');
  assert.deepEqual(readdirSync(join(dir, 'nested')), ['record.json']);
}));

test('writeAtomic replaces a document whole and leaves no temp file', () => withTemp((dir) => {
  const file = join(dir, 'state.json');
  writeAtomic(file, 'before');
  writeAtomic(file, 'after');
  assert.equal(readFileSync(file, 'utf8'), 'after');
  assert.deepEqual(readdirSync(dir), ['state.json']);
}));

// Raw exclusive-create, link and rename are how a record is written outside this layer. The one
// rename left is the archive of a change folder under docs/, which is not a `.spectree/` record.
const LIB = join(REPO, 'scripts', 'lib');
const RAW = /\{\s*flag:\s*'wx'\s*\}|openSync\([^)]*'wx'\)|\blinkSync\(|\brenameSync\(/;
const ALLOWED = new Set(['shared/persistence.mjs', 'closure/prepare.mjs:renameSync']);
function rawWriters(files) {
  return files.flatMap(([rel, text]) => text.split('\n').flatMap((line, i) => {
    const m = line.match(RAW);
    if (!m || ALLOWED.has(rel) || (ALLOWED.has(`${rel}:renameSync`) && m[0].startsWith('renameSync'))) return [];
    return [`${rel}:${i + 1}`];
  }));
}

test('the raw-writer guard recognises a write that bypasses the layer', () => {
  assert.deepEqual(rawWriters([['change/x.mjs', "writeFileSync(f, t, { flag: 'wx' });"]]), ['change/x.mjs:1']);
  assert.deepEqual(rawWriters([['closure/prepare.mjs', 'linkSync(a, b);']]), ['closure/prepare.mjs:1']);
  assert.deepEqual(rawWriters([['closure/prepare.mjs', 'renameSync(a, b);']]), []);
});

test('nothing under scripts/lib writes a record past the persistence layer', () => {
  const files = readdirSync(LIB, { recursive: true }).filter((f) => f.endsWith('.mjs'))
    .map((f) => [f.split('\\').join('/'), readFileSync(join(LIB, f), 'utf8')]);
  assert.deepEqual(rawWriters(files), []);
});
