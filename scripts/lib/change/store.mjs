// Persistence for the Invoker's state. Files, atomically written. No database.
//
// Layout, inside the consumer project:
//
//   .spectree/project.json                identity, protocol + schema versions
//   .spectree/changes/<id>.json           CURRENT state — small, rewritten
//   .spectree/history/<id>.jsonl          APPEND-ONLY — never rewritten, never re-interpreted
//   .spectree/evidence/<id>.json          one observation
//   .spectree/approvals/<id>.json         one human authorisation
//   .spectree/dispatches/<id>.json        one mission
//   .spectree/deferred.json               the ledger, stable ids
//
// Current state and history are separate on purpose: resume reads the first and never has to
// replay the second, and nothing that rewrites current state can rewrite what already happened.

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync,
  appendFileSync, renameSync, openSync, closeSync, unlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertValid, stamp } from '../shared/index.mjs';

export const SCHEMA_VERSION = '1.0.0';
const DIR = '.spectree';

const p = (root, ...rest) => join(root, DIR, ...rest);

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
  writeFileSync(tmp, text);
  // ponytail: bounded by wall clock, not attempts — a reader starved of CPU holds its handle longer.
  const deadline = performance.now() + 10_000;
  for (let wait = 5; ; wait = Math.min(wait * 2, 100)) {
    try { return renameSync(tmp, file); } catch (e) {
      const transient = process.platform === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes(e.code);
      if (!transient || performance.now() > deadline) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait);
    }
  }
}

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

/**
 * Read-modify-write is not atomic just because the final rename is. Two processes can read
 * the same `state_revision`, both find it acceptable, and both write — the second silently
 * winning. `renameSync` makes the file swap atomic; it does not make the *decision* atomic.
 *
 * So the whole critical section runs under an exclusive-create lock: `wx` fails when the file
 * already exists, and that failure IS the mutual exclusion. State and history are written
 * inside it, so a reader never finds one without the other.
 */
function withLock(lockFile, fn, { attempts = 100, waitMs = 20 } = {}) {
  mkdirSync(dirname(lockFile), { recursive: true });
  for (let i = 0; i < attempts; i++) {
    let fd;
    try {
      fd = openSync(lockFile, 'wx'); // atomic create-or-fail
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs); // short, synchronous
      continue;
    }
    try {
      writeFileSync(fd, String(process.pid));
      return fn();
    } finally {
      closeSync(fd);
      try { unlinkSync(lockFile); } catch { /* already released */ }
    }
  }
  const e = new Error(`could not acquire ${lockFile}: another process is writing this change`);
  e.code = 'E_CONCURRENT_UPDATE';
  throw e;
}

export class Store {
  constructor(root) { this.root = root; }

  get present() { return existsSync(p(this.root)); }

  init(project) {
    for (const d of ['changes', 'history', 'evidence', 'approvals', 'dispatches']) {
      mkdirSync(p(this.root, d), { recursive: true });
    }
    const doc = { schema_version: SCHEMA_VERSION, ...project };
    writeAtomic(p(this.root, 'project.json'), JSON.stringify(doc, null, 2) + '\n');
    if (!existsSync(p(this.root, 'deferred.json'))) {
      writeAtomic(p(this.root, 'deferred.json'), JSON.stringify({ schema_version: SCHEMA_VERSION, items: [] }, null, 2) + '\n');
    }
    return doc;
  }

  project() { return this.present && existsSync(p(this.root, 'project.json')) ? readJson(p(this.root, 'project.json')) : null; }

  /**
   * Reading a document whose schema_version differs is a refusal, never a silent fixup.
   * Migration is an explicit, separate act.
   */
  #checked(doc, file) {
    if (doc.schema_version !== SCHEMA_VERSION) {
      const e = new Error(
        `${file} is schema_version ${doc.schema_version}, this build speaks ${SCHEMA_VERSION}. ` +
        `Run the migration explicitly; nothing here rewrites a document it cannot read.`);
      e.code = 'E_SCHEMA_VERSION';
      throw e;
    }
    return doc;
  }

  change(id) {
    const f = p(this.root, 'changes', `${id}.json`);
    if (!existsSync(f)) return null;
    return this.#checked(readJson(f), `changes/${id}.json`);
  }

  changes() {
    const d = p(this.root, 'changes');
    if (!existsSync(d)) return [];
    return readdirSync(d).filter((f) => f.endsWith('.json')).sort()
      .map((f) => this.#checked(readJson(join(d, f)), `changes/${f}`));
  }

  /**
   * Writes current state and appends one history event. Optimistic concurrency:
   * `expected` must equal the stored state_revision, or the write is refused.
   */
  putChange(change, { event, expected } = {}) {
    assertValid('spectree/change', change, `change ${change.change_id}`);
    return withLock(p(this.root, 'changes', `${change.change_id}.lock`), () => {
      // Re-read INSIDE the lock. Reading before taking it is what made this a race.
      const existing = this.change(change.change_id);
      const current = existing?.state_revision ?? 0;
      if (existing && expected !== undefined && expected !== current) {
        const e = new Error(`concurrent update on ${change.change_id}: expected state_revision ${expected}, found ${current}`);
        e.code = 'E_CONCURRENT_UPDATE';
        throw e;
      }
      const next = { ...change, state_revision: current + 1, updated_at: stamp() };
      assertValid('spectree/change', next, `change ${change.change_id}`);
      // History first, so a reader that sees the new state always finds its event recorded.
      if (event) this.appendHistory(change.change_id, { ...event, at: next.updated_at, state_revision: next.state_revision });
      writeAtomic(p(this.root, 'changes', `${change.change_id}.json`), JSON.stringify(next, null, 2) + '\n');
      return next;
    });
  }

  /** Append-only. Idempotent on event_id: replaying a resume never duplicates an event. */
  appendHistory(changeId, event) {
    const f = p(this.root, 'history', `${changeId}.jsonl`);
    const id = event.event_id ?? `${event.type}:${event.state_revision ?? ''}:${event.at ?? ''}`;
    if (existsSync(f)) {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { if (JSON.parse(line).event_id === id) return false; } catch { /* a corrupt line is not a match */ }
      }
    }
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, JSON.stringify({ ...event, event_id: id }) + '\n');
    return true;
  }

  history(changeId) {
    const f = p(this.root, 'history', `${changeId}.jsonl`);
    if (!existsSync(f)) return [];
    return readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  }

  #putDoc(kind, schemaId, idField, doc, { immutable = false } = {}) {
    assertValid(schemaId, doc, `${kind} ${doc[idField]}`);
    const file = p(this.root, kind, `${doc[idField]}.json`);
    const text = JSON.stringify(doc, null, 2) + '\n';
    // An id is a name for one document, not a slot. Writing the same bytes again is idempotent —
    // a resume replaying its own work — but a DIFFERENT document under an id that already exists
    // silently rewrites what somebody authorised. A new authorisation gets a new id.
    if (immutable && existsSync(file)) {
      const before = readFileSync(file, 'utf8');
      if (before !== text) {
        const e = new Error(
          `${kind}/${doc[idField]}.json already exists with different content. An id names one document: ` +
          'repeating it byte for byte is idempotent, replacing it is not. Record a new one under a new id.');
        e.code = 'E_DOCUMENT_CONFLICT';
        throw e;
      }
      return doc;
    }
    writeAtomic(file, text);
    return doc;
  }

  #listDocs(kind, changeId) {
    const d = p(this.root, kind);
    if (!existsSync(d)) return [];
    const all = readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => readJson(join(d, f)));
    return changeId ? all.filter((x) => !x.change_id || x.change_id === changeId) : all;
  }

  putEvidence(doc) { return this.#putDoc('evidence', 'spectree/evidence', 'evidence_id', doc); }
  evidence(changeId) { return this.#listDocs('evidence', changeId); }

  putApproval(doc) { return this.#putDoc('approvals', 'spectree/approval', 'approval_id', doc, { immutable: true }); }
  approvals(changeId) { return this.#listDocs('approvals', changeId); }

  putDispatch(doc) { return this.#putDoc('dispatches', 'spectree/dispatch', 'dispatch_id', doc); }
  dispatches(changeId) { return this.#listDocs('dispatches', changeId); }

  deferred() {
    const f = p(this.root, 'deferred.json');
    if (!existsSync(f)) return { schema_version: SCHEMA_VERSION, items: [] };
    return this.#checked(readJson(f), 'deferred.json');
  }

  /** Stable ids: the next id is one past the highest ever used, closed items included. */
  putDeferred(item) {
    return withLock(p(this.root, 'deferred.lock'), () => this.#putDeferredLocked(item));
  }

  #putDeferredLocked(item) {
    const led = this.deferred();
    const next = { ...item, schema_version: SCHEMA_VERSION };
    if (next.stable_id === undefined) next.stable_id = Math.max(0, ...led.items.map((i) => i.stable_id)) + 1;
    assertValid('spectree/deferred', next, `deferred item ${next.stable_id}`);
    const idx = led.items.findIndex((i) => i.stable_id === next.stable_id);
    if (idx >= 0) led.items[idx] = next; else led.items.push(next);
    led.items.sort((a, b) => a.stable_id - b.stable_id);
    writeAtomic(p(this.root, 'deferred.json'), JSON.stringify(led, null, 2) + '\n');
    return next;
  }
}
