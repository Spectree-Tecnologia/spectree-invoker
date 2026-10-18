// Every write under `.spectree/` goes through here: the three ways a record is written, and the one
// lock, with the one order in which locks may be taken.
//
// - `writeAtomic` replaces a document whole: a reader sees the old bytes or the new, never half.
// - `writeOnce` creates a record that must not exist yet, and fails if it does.
// - `publishOnce` creates a record that must not exist yet AND must never be seen half-written:
//   complete bytes land in a temp file first, then are linked into place.
// - `withLock` runs a critical section under an exclusive-create lock file.
//
// LOCK ORDER is `LOCK_ORDER`, outermost first, and it is enforced, not described: a process that
// holds a lock may only take one that comes later in the list. Two writers that take the same
// pair of locks in opposite orders can wait on each other forever; refusing the second order at
// the moment it is attempted is what makes that impossible rather than unlikely.

import {
  writeFileSync, mkdirSync, renameSync, openSync, closeSync, unlinkSync, linkSync, readFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { stamp } from './time.mjs';

/**
 * The task executor owns the checkout, the closure control decides what may be written, the change
 * record is written under that decision, and the deferral ledger is the innermost.
 */
export const LOCK_ORDER = Object.freeze(['executor', 'lifecycle', 'change', 'deferred']);

/** Ranks of the locks this process holds right now, outermost first. */
const held = [];

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * Atomic: write a sibling temp file, then rename over the target.
 *
 * On Windows a rename over a file that another process has open — a reader, for the few
 * milliseconds of a readFileSync — fails with EPERM/EACCES/EBUSY. That is a sharing violation,
 * not a refusal: readers never take the lock, so the writer holding it must outlast them. It
 * crashed a reopening mid-operation under a busy suite, leaving it open at `intent`.
 */
export function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tmp, text, { flag: 'wx' });
  // ponytail: bounded by wall clock, not attempts — a reader starved of CPU holds its handle longer.
  const deadline = performance.now() + 10_000;
  for (let wait = 5; ; wait = Math.min(wait * 2, 100)) {
    try { return renameSync(tmp, file); } catch (e) {
      const transient = process.platform === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes(e.code);
      if (!transient || performance.now() > deadline) throw e;
      sleep(wait);
    }
  }
}

/**
 * Create a record that must not exist yet. An existing one is an `EEXIST` for the caller to name.
 * The directory is the caller's: a record that lands where nobody prepared a place is a refusal.
 */
export function writeOnce(file, text) {
  writeFileSync(file, text, { flag: 'wx' });
}

/**
 * Create a record that must not exist yet, and that no reader may ever find half-written. An
 * interrupted temp write never becomes the record; an existing one is an `EEXIST` from the link.
 */
export function publishOnce(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, text, { flag: 'wx' });
  try { linkSync(temp, file); }
  finally { try { unlinkSync(temp); } catch { /* an orphan temp is not a record */ } }
}

/**
 * Is the process that holds this lock gone?
 *
 * Only answerable on the machine that took it, and only for a pid this process may signal.
 * Anything else — another host, an unreadable lock, a pid that still answers — is "unknown", and
 * unknown leaves the lock alone. Signal 0 tests for existence without delivering anything.
 */
export function lockOwnerIsGone(file) {
  let owner;
  try { owner = JSON.parse(readFileSync(file, 'utf8')); } catch { return false; }
  if (!owner || typeof owner.pid !== 'number') return false;
  if (owner.host && owner.host !== hostname()) return false;
  if (owner.pid === process.pid) return false;
  try { process.kill(owner.pid, 0); return false; }
  catch (e) { return e.code === 'ESRCH'; }
}

/**
 * Run `fn` under an exclusive-create lock: `wx` fails when the file already exists, and that
 * failure IS the mutual exclusion. The lock records who holds it.
 *
 * A lock is never broken for being OLD — a slow consolidation is not an abandoned one. With
 * `breakAbandoned`, it is broken once, and announced, when its owner can be identified and is
 * demonstrably gone. Otherwise this waits `attempts` times and then calls `busy`, which throws.
 *
 * @param {string} kind     one of LOCK_ORDER
 * @param {string} file     the lock file
 * @param {Function} fn     the critical section
 * @param {object} [opts]
 * @param {number} [opts.attempts]
 * @param {number} [opts.waitMs]
 * @param {object} [opts.owner]           extra fields recorded in the lock
 * @param {string} [opts.breakAbandoned]  when set, the warning printed when a dead owner's lock is broken
 * @param {Function} [opts.busy]          receives the lock file and throws the refusal when it cannot be taken
 */
export function withLock(kind, file, fn, { attempts = 100, waitMs = 20, owner = {}, breakAbandoned, busy } = {}) {
  const rank = LOCK_ORDER.indexOf(kind);
  if (rank < 0) throw Object.assign(new Error(`unknown lock kind "${kind}": one of ${LOCK_ORDER.join(', ')}`), { code: 'E_LOCK_KIND' });
  const inner = held.at(-1);
  if (inner !== undefined && inner >= rank) {
    throw Object.assign(new Error(
      `lock order violated: the "${kind}" lock was requested while holding the "${LOCK_ORDER[inner]}" lock. ` +
      `Locks are taken in the order ${LOCK_ORDER.join(' -> ')}, never back.`), { code: 'E_LOCK_ORDER' });
  }
  mkdirSync(dirname(file), { recursive: true });
  let brokenOnce = false;
  for (let i = 0; i < attempts; i++) {
    let fd;
    try { fd = openSync(file, 'wx'); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (breakAbandoned && !brokenOnce && lockOwnerIsGone(file)) {
        brokenOnce = true;
        process.emitWarning(breakAbandoned, 'SpectreeLock');
        try { unlinkSync(file); } catch { /* somebody else got there first */ }
      }
      if (i + 1 < attempts) sleep(waitMs);
      continue;
    }
    held.push(rank);
    try {
      writeFileSync(fd, JSON.stringify({ pid: process.pid, host: hostname(), at: stamp(), ...owner }));
      return fn();
    } finally {
      held.pop();
      closeSync(fd);
      try { unlinkSync(file); } catch { /* already released */ }
    }
  }
  if (busy) busy(file);
  throw Object.assign(new Error(`could not acquire ${file}: another process is writing it`), { code: 'E_CONCURRENT_UPDATE' });
}
