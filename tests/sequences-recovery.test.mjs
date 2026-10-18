// The composed sequences, each one a family of defects that reached acceptance.
//
// They are here as whole flows rather than unit questions because every one of them passed a
// single-step check and failed the sequence: refresh alone was correct, `stale` alone was
// correct, the confirmation alone was correct, and together they let a substituted record close
// a change. A rule that only holds one step at a time is a rule with a door next to it.
//
// Everything is real except the GitHub transport: real repositories, the installed CLIs, real
// digests, real transitions.
//
// This file: interruptions that really interrupt, the authority boundary, and recovery.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { currentPath, readLifecycle, receiptPath, pendingOperation, preparationDigest } from '../scripts/lib/change/lifecycle.mjs';
import { cleanup, tempDir, now, REPO, preparationOf } from './helpers.mjs';
import { project, consolidationRuns, BARRIER, readyToTransition } from './sequences-fixture.mjs';

// --- interruptions that really interrupt ---------------------------------------------------------

test('an interruption after the command was observed resumes without running it again', () => {
  const p = project({ counting: true });
  try {
    // A REAL crash: the child process dies the instant the control records `observed`. Editing
    // files afterwards to simulate one would be testing the edit.
    const killed = p.prepCrashing('observed', '--apply');
    assert.equal(killed.code, 86, 'the child really died');
    assert.equal(consolidationRuns(p), 1, 'and the consolidation really ran');
    assert.equal(existsSync(join(p.root, 'docs/specs/account/spec.md')), true, 'it left its output');
    assert.equal(existsSync(join(p.root, currentPath('c1'))), false, 'and no preparation was written');

    const before = readLifecycle(p.root, 'c1').doc;
    assert.equal(before.operation.phase, 'observed');
    const plannedId = before.operation.plan.preparation_id;

    // A plain re-run refuses, and names the command that recovers — which is the whole complaint:
    // a message that recommended a re-run, beside a re-run that refused.
    const plain = p.prep('--apply', '--json');
    assert.equal(plain.code, 1);
    assert.equal(JSON.parse(plain.out).code, 'E_OPERATION_PENDING');
    assert.match(plain.err, /--resume/);
    assert.equal(consolidationRuns(p), 1, 'and it did not run the command again either');

    // The recommended command works, and finishes the operation that was interrupted.
    const resumed = p.prep('--apply', '--resume', '--json');
    assert.equal(resumed.code, 0, resumed.err);
    assert.equal(consolidationRuns(p), 1, 'a recovery finishes an operation; it does not execute one');
    const m = p.manifest();
    assert.equal(m.preparation_id, plannedId, 'and it finishes the SAME preparation that was reserved');
    assert.equal(m.preparation_digest, preparationDigest(m));
    const after = readLifecycle(p.root, 'c1').doc;
    assert.equal(pendingOperation(after), null, 'nothing is left open');
    assert.equal(after.current_preparation, m.preparation_id);
    const trail = readFileSync(join(p.root, '.spectree/history/c1.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(trail.filter((e) => e.type === 'closure_prepared').length, 1, 'one preparation, one event');
  } finally { p.drop(); }
});

test('an interruption during persistence finishes only the steps that are missing', () => {
  const p = project({ counting: true });
  try {
    const killed = p.prepCrashing('persisting', '--apply');
    assert.equal(killed.code, 86);
    assert.equal(consolidationRuns(p), 1);
    assert.equal(readLifecycle(p.root, 'c1').doc.operation.phase, 'persisting');

    const resumed = p.prep('--apply', '--resume', '--json');
    assert.equal(resumed.code, 0, resumed.err);
    assert.equal(consolidationRuns(p), 1);
    assert.equal(existsSync(join(p.root, 'docs/changes/c1')), false, 'the folder is archived');
    const m = p.manifest();
    assert.ok(m.artifacts.length, 'and the record describes it');
    assert.equal(pendingOperation(readLifecycle(p.root, 'c1').doc), null);

    // The whole cycle still closes on top of a resumed preparation.
    p.git(['add', '-A']); p.git(['commit', '-qm', 'the resumed preparation']);
    p.approve();
    p.merge();
    assert.equal(p.confirm('--pr', '999', '--apply').code, 0);
    assert.equal(p.stateNow(), 'closed');
  } finally { p.drop(); }
});

test('an interruption before the command was observed stays uncertain, and is resolved by a person', () => {
  const p = project({ counting: true });
  try {
    const killed = p.prepCrashing('started', '--apply');
    assert.equal(killed.code, 86, 'it died before the result was ever observed');
    // Whether the command ran is genuinely unknown here — the process died between launching it
    // and recording what it returned.
    const open = pendingOperation(readLifecycle(p.root, 'c1').doc);
    assert.equal(open.phase, 'started');
    assert.equal(open.uncertain, true);

    // `--resume` alone will NOT carry it: nothing may decide this on the tool's own authority.
    const attempted = p.prep('--apply', '--resume', '--json');
    assert.equal(attempted.code, 1);
    assert.equal(JSON.parse(attempted.out).code, 'E_OPERATION_PENDING');
    assert.match(attempted.err, /--consolidation-ran/);
    assert.match(attempted.err, /--abandon/);

    // A person looked. That is recorded, and it is what moves the operation on — the command is
    // still not run again.
    const before = consolidationRuns(p);
    const resolved = p.prep('--apply', '--resume', '--consolidation-ran', '--reason', 'the living spec has the delta', '--json');
    assert.equal(resolved.code, 0, resolved.err);
    assert.equal(consolidationRuns(p), before, 'the decision is not an execution');
    const trail = readFileSync(join(p.root, '.spectree/history/c1.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    const decision = trail.find((e) => e.type === 'closure_uncertainty_resolved');
    assert.equal(decision.reason, 'the living spec has the delta');
  } finally { p.drop(); }
});

test('an uncertain operation can be abandoned, and what it wrote is left alone', () => {
  const p = project({ counting: true });
  try {
    assert.equal(p.prepCrashing('started', '--apply').code, 86);
    const spec = join(p.root, 'docs/specs/account/spec.md');
    const wrote = existsSync(spec);

    assert.equal(p.prep('--apply', '--abandon').code, 2, 'abandoning is not anonymous either');
    const r = p.prep('--apply', '--abandon', '--reason', 'checked: the command never started', '--json');
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).state, 'abandoned');
    assert.equal(pendingOperation(readLifecycle(p.root, 'c1').doc), null, 'the operation is gone');
    assert.equal(readLifecycle(p.root, 'c1').doc.abandoned.length, 1, 'and it is still in the record');
    assert.equal(existsSync(spec), wrote, 'nothing the command wrote was reverted');

    // And the change can be prepared again from a clean slate.
    assert.equal(p.prep('--apply').code, 0);
    assert.ok(p.manifest());
  } finally { p.drop(); }
});

test('a confirmation interrupted between the receipt and the state is resumed, not restarted', () => {
  const p = project();
  try {
    assert.equal(p.prep('--apply').code, 0);
    p.git(['add', '-A']); p.git(['commit', '-qm', 'closure prepared']);
    p.approve();
    const { merge } = p.merge();

    // A REAL crash inside the confirmation, the instant the control reaches `persisting` — which
    // is after the receipt is written and before the transitions.
    // Crash once the control POINTS at the receipt: the receipt is on disk, the transitions are
    // not. That is the window the reviewer named, and it is where a resume has to be a resume.
    const killed = p.confirmCrashing('receipt', '--pr', '999', '--apply');
    assert.equal(killed.code, 86, 'the child really died mid-confirmation');
    assert.equal(existsSync(join(p.root, receiptPath('c1'))), true, 'the receipt was already written');
    assert.equal(p.stateNow(), 'integration_approved', 'and the change had not moved yet');
    const receiptBefore = readFileSync(join(p.root, receiptPath('c1')), 'utf8');

    const resumed = p.confirm('--pr', '999', '--apply');
    assert.equal(resumed.code, 0, resumed.err);
    assert.equal(p.stateNow(), 'closed');
    assert.equal(readFileSync(join(p.root, receiptPath('c1')), 'utf8'), receiptBefore,
      'one receipt, and the moment it recorded is not re-stamped');

    const trail = readFileSync(join(p.root, '.spectree/history/c1.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(trail.filter((e) => e.type === 'integration_observed').length, 1, 'one observation');
    assert.equal(trail.filter((e) => e.to === 'integrated').length, 1);
    assert.equal(trail.filter((e) => e.to === 'closed').length, 1);
    assert.equal(p.git(['rev-parse', 'HEAD']).trim(), merge, 'and no commit was made');
  } finally { p.drop(); }
});

// --- the transition inside the authority boundary -------------------------------------------------

test('a barrier timeout fails rather than releasing an unobserved interleaving', () => {
  const root = tempDir('spectree-barrier-');
  try {
    mkdirSync(join(root, '.spectree/closure'), { recursive: true });
    const r = spawnSync(process.execPath, ['--require', BARRIER, '-e',
      "const fs = require('node:fs'); fs.openSync('.spectree/closure/c1.lifecycle.lock', 'wx'); fs.writeFileSync('.spectree/released', 'bad');"],
    { cwd: root, encoding: 'utf8', env: { ...process.env,
      SPECTREE_BARRIER_LOCK: '/closure/c1.lifecycle.lock',
      SPECTREE_BARRIER_ARGV: JSON.stringify(['-e', 'process.exit(0)']),
      SPECTREE_BARRIER_UNTIL: 'reopen/started',
      SPECTREE_BARRIER_OUT: join(root, '.spectree/barrier.json'),
      SPECTREE_BARRIER_TIMEOUT_MS: '1000',
    } });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /E_TEST_BARRIER_TIMEOUT/);
    assert.equal(existsSync(join(root, '.spectree/released')), false);
    assert.equal(existsSync(join(root, '.spectree/closure/c1.lifecycle.lock')), false);
  } finally { cleanup(root); }
});

test('a transition decided before a reopening does not land after it', () => {
  const p = readyToTransition();
  try {
    const marker = join(p.root, '.spectree/barrier.json');
    const stateBefore = readFileSync(join(p.root, '.spectree/changes/c1.json'), 'utf8');
    const trailBefore = readFileSync(join(p.root, '.spectree/history/c1.jsonl'), 'utf8');

    // The barrier fires at the transition's FIRST attempt on the closure lock — after its
    // decision, before its write. A reopening runs to `started` while it waits.
    //
    // Held at the CHANGE lock, this same interleaving used to pass: a reopening that returns a
    // change to the state it was already in does not move `state_revision`, so the change store's
    // own optimistic check saw nothing to object to.
    const r = p.stateWith({
      SPECTREE_BARRIER_LOCK: '/closure/c1.lifecycle.lock',
      SPECTREE_BARRIER_ARGV: JSON.stringify([
        join(REPO, 'scripts/prepare-closure.mjs'), 'c1', '--apply', '--reopen', '--reason', 'a concurrent decision',
      ]),
      SPECTREE_BARRIER_UNTIL: 'reopen/started',
      SPECTREE_BARRIER_OUT: marker,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${BARRIER}`.trim(),
    }, 'transition', 'c1', 'pass2_complete');

    assert.ok(existsSync(marker), `the barrier never released:\n${r.err}`);
    const observed = JSON.parse(readFileSync(marker, 'utf8'));
    assert.equal(observed.kind, 'reopen', 'the barrier really did hold until the reopening started');
    assert.equal(observed.phase, 'started');

    assert.equal(r.code, 1, 'a transition does not land on top of an operation that is still running');
    assert.match(r.err, /E_OPERATION_PENDING|E_CONCURRENT_UPDATE/);
    assert.equal(readFileSync(join(p.root, '.spectree/changes/c1.json'), 'utf8'), stateBefore,
      'the state is byte for byte what it was');
    // The trail DOES grow — the reopening is writing its own events while this waits. What must
    // not be in it is a transition: comparing the whole file would be asserting that a concurrent
    // operation wrote nothing, which is a different and false claim.
    const trailNow = readFileSync(join(p.root, '.spectree/history/c1.jsonl'), 'utf8').trim().split(String.fromCharCode(10)).map(JSON.parse);
    assert.equal(trailNow.filter((e) => e.to === 'pass2_complete').length, 0, 'no transition event was written');
    assert.ok(trailNow.length > trailBefore.trim().split(String.fromCharCode(10)).length, 'and the reopening did get on with its own work');

    // And the reason it refused is still on record: the reopening's operation is open. Whether
    // that reopening then finishes is not this test's subject — the barrier's child does not
    // outlive the process holding it — and it is proven by the other ordering below, where the
    // barrier waits for `done` and therefore keeps it alive.
    const lc = readLifecycle(p.root, 'c1').doc;
    assert.equal(pendingOperation(lc).kind, 'reopen');
    assert.equal(lc.generation, 2, 'the reopening had already raised the generation');
  } finally { p.drop(); }
});

test('the other ordering too: a reopening that COMPLETED under the barrier refuses the decision', () => {
  const p = readyToTransition();
  try {
    const marker = join(p.root, '.spectree/barrier.json');
    const stateBefore = readFileSync(join(p.root, '.spectree/changes/c1.json'), 'utf8');

    // Same window, the other side of it: the reopening runs all the way to `done` while the
    // transition waits. There is then no pending operation to object to — the only thing that says
    // the world moved is the control's revision, which is what the reservation compares.
    const r = p.stateWith({
      SPECTREE_BARRIER_LOCK: '/closure/c1.lifecycle.lock',
      SPECTREE_BARRIER_ARGV: JSON.stringify([
        join(REPO, 'scripts/prepare-closure.mjs'), 'c1', '--apply', '--reopen', '--reason', 'a concurrent decision',
      ]),
      SPECTREE_BARRIER_UNTIL: 'reopen/done',
      SPECTREE_BARRIER_OUT: marker,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${BARRIER}`.trim(),
    }, 'transition', 'c1', 'pass2_complete');

    assert.ok(existsSync(marker), `the barrier never released:\n${r.err}`);
    const observed = JSON.parse(readFileSync(marker, 'utf8'));
    assert.equal(observed.kind, 'reopen');
    assert.equal(observed.phase, 'done', 'the reopening really did finish before the release');
    assert.equal(pendingOperation(readLifecycle(p.root, 'c1').doc), null, 'so nothing was pending');

    assert.equal(r.code, 1, 'and the decision still does not apply: it was taken against another world');
    assert.match(r.err, /E_CONCURRENT_UPDATE/);
    assert.equal(readFileSync(join(p.root, '.spectree/changes/c1.json'), 'utf8'), stateBefore);
    assert.equal(readLifecycle(p.root, 'c1').doc.generation, 2);

    // Deciding again, against what is there now, is the repair — and `pass2_complete` rests on the
    // scope approval and the QA evidence, neither of which a reopening retires, so it goes through.
    const again = p.state('transition', 'c1', 'pass2_complete');
    assert.equal(again.code, 0, again.err);
  } finally { p.drop(); }
});

test('with nobody competing, the same transition goes through', () => {
  const p = readyToTransition();
  try {
    const r = p.state('transition', 'c1', 'pass2_complete');
    assert.equal(r.code, 0, r.err);
    assert.equal(p.stateNow(), 'pass2_complete');
  } finally { p.drop(); }
});

// --- a recovery is bound to what the interrupted command actually ran against ---------------------

test('a contract that moved while the operation was interrupted refuses the resume', () => {
  const p = project({ counting: true });
  try {
    assert.equal(p.prepCrashing('observed', '--apply').code, 86);
    assert.equal(consolidationRuns(p), 1);

    // The delta is edited while the operation is stopped. The consolidation that ran consolidated
    // Requirement `x`; the delta on disk now says something else.
    writeFileSync(join(p.root, 'docs/changes/c1/specs/account/spec.md'),
      '## ADDED Requirements\n\n### Requirement: DIFFERENT\n');

    const r = p.prep('--apply', '--resume', '--json');
    assert.equal(r.code, 1, 'a resume finishes an operation; it does not re-decide it under another contract');
    const doc = JSON.parse(r.out);
    assert.equal(doc.code, 'E_RESUME_INPUTS_CHANGED');
    assert.match(JSON.stringify(doc.drift), /contract moved/);
    assert.equal(consolidationRuns(p), 1, 'and it did not run the command again');
    assert.equal(existsSync(join(p.root, currentPath('c1'))), false, 'no preparation was published');
    assert.equal(pendingOperation(readLifecycle(p.root, 'c1').doc).phase, 'observed',
      'the operation is still open, for a person to resolve');

    // Putting the delta back makes it resumable again — the refusal was about the drift, not a
    // door that closed for good.
    writeFileSync(join(p.root, 'docs/changes/c1/specs/account/spec.md'),
      '## ADDED Requirements\n\n### Requirement: x\n');
    const again = p.prep('--apply', '--resume', '--json');
    assert.equal(again.code, 0, again.err);
    assert.equal(consolidationRuns(p), 1);
  } finally { p.drop(); }
});

test('a resume with no recorded observation refuses instead of inventing one', () => {
  const p = project({ counting: true });
  try {
    assert.equal(p.prepCrashing('started', '--apply').code, 86);
    // `started` carries no consolidation result — that is what `started` means. The default that
    // used to fill one in was the tool asserting an observation nobody made.
    const open = pendingOperation(readLifecycle(p.root, 'c1').doc);
    assert.equal(open.detail?.consolidation, undefined);

    const r = p.prep('--apply', '--resume', '--json');
    assert.equal(r.code, 1);
    assert.match(JSON.stringify(JSON.parse(r.out).code), /E_OPERATION_PENDING|E_RESUME_NO_OBSERVATION/);

    // The operator's decision becomes a record with its OWN provenance, not an observation.
    assert.equal(p.prep('--apply', '--resume', '--consolidation-ran', '--reason', 'the living spec has the delta').code, 0);
    const m = preparationOf(p.root, 'c1');
    assert.equal(m.consolidation.source, 'operator_decision');
    assert.equal(m.consolidation.decided_because, 'the living spec has the delta');
    assert.notEqual(m.consolidation.source, 'observed_execution');
  } finally { p.drop(); }
});

// --- recovery is routed by the operation's kind ----------------------------------------------------

test('a refresh interrupted at persistence is finished, not replaced by a new one', () => {
  const p = project({ counting: true });
  try {
    assert.equal(p.prep('--apply').code, 0);
    p.git(['add', '-A']); p.git(['commit', '-qm', 'prepared']);
    const archive = preparationOf(p.root, 'c1').archive_path;
    writeFileSync(join(p.root, `${archive}/tasks.md`), '- [x] build it\n');

    assert.equal(p.prepCrashing('persisting', '--apply').code, 86);
    const open = pendingOperation(readLifecycle(p.root, 'c1').doc);
    assert.equal(open.kind, 'refresh');
    const reserved = open.plan.preparation_id;

    const r = p.prep('--apply', '--resume', '--json');
    assert.equal(r.code, 0, r.err);
    const doc = JSON.parse(r.out);
    assert.equal(doc.state, 'refreshed');
    assert.equal(doc.resumed_operation, open.operation_id, 'it finished THAT refresh, not a new one');
    assert.equal(doc.preparation_id, reserved, 'under the identity that refresh reserved');
    assert.equal(consolidationRuns(p), 1);

    const lc = readLifecycle(p.root, 'c1').doc;
    assert.equal(pendingOperation(lc), null);
    assert.equal(lc.current_preparation, preparationOf(p.root, 'c1').preparation_id,
      'the pointer names the document that exists');
    const trail = readFileSync(join(p.root, '.spectree/history/c1.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(trail.filter((e) => e.type === 'closure_artifacts_refreshed').length, 1, 'one event for one operation');
  } finally { p.drop(); }
});

test('a prepare that wrote its projection and nothing else is finished, not reported as done', () => {
  const p = project({ counting: true });
  try {
    // Crash the instant the projection's bytes land: the snapshot exists, the trail does not, and
    // the operation is open. The digests then match what was just written, so the `unchanged`
    // shortcut used to answer 0 and leave all of that as it was.
    const r0 = p.prepCrashingOnWrite('/closure/c1.json', '--apply');
    assert.equal(r0.code, 86);
    assert.equal(consolidationRuns(p), 1);
    const projection = readFileSync(join(p.root, currentPath('c1')), 'utf8');
    const open = pendingOperation(readLifecycle(p.root, 'c1').doc);
    assert.equal(open.phase, 'persisting');

    const r = p.prep('--apply', '--resume', '--json');
    assert.equal(r.code, 0, r.err);
    assert.equal(consolidationRuns(p), 1);
    assert.equal(readFileSync(join(p.root, currentPath('c1')), 'utf8'), projection,
      'the immutable snapshot is not re-stamped with a second `prepared_at`');

    const lc = readLifecycle(p.root, 'c1').doc;
    assert.equal(pendingOperation(lc), null, 'no pending operation behind a zero exit');
    assert.equal(lc.current_preparation, JSON.parse(projection).preparation_id);
    const trail = readFileSync(join(p.root, '.spectree/history/c1.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(trail.filter((e) => e.type === 'closure_prepared').length, 1);
  } finally { p.drop(); }
});
