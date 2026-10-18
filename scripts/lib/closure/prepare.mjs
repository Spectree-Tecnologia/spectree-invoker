// Preparing a change's closure on its own branch, before the merge — the whole decision and every
// write, as a function. `scripts/prepare-closure.mjs` is only its command line.
//
// It validates, runs the consumer's own consolidation command, archives the change folder,
// and writes one immutable snapshot. It never writes `integrated` or `closed`, never opens a
// second PR, and never edits `docs/specs/` by hand — a spec written by the tool that also
// approves it proves nothing.
//
// Every decision is taken BEFORE anything runs, and the dry run answers exactly what `--apply`
// would: a plan nobody may execute is not a plan. Every write goes through the closure
// lifecycle's boundary, so an interrupted run is recoverable rather than ambiguous.
//
// Exit codes: 0 prepared (or already prepared), 1 refused, 2 usage.

import { flags, contractDigest, contentDigest, launch } from '../shared/index.mjs';
import { existsSync, mkdirSync, renameSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import {
  Store,
  SCHEMA_VERSION,
  writeAtomic,
  ORDER,
  readLifecycle,
  updateLifecycle,
  beginOperation,
  advanceOperation,
  completeOperation,
  abandonOperation,
  pendingOperation,
  newPreparationId,
  newOperationId,
  PHASE,
  RESUMABLE,
} from '../change/index.mjs';
import {
  closureDeliveryPreflight,
  readDiff,
  classifyDiff,
  outsideAllowedPaths,
} from '../evidence/index.mjs';
import { checkProposalDeltaContract } from './closure.mjs';
import {
  PREP_CONTRACT_VERSION,
  manifestPath,
  snapshotPath,
  consolidationCommand,
  resolveCommand,
  commandDigest,
  artifactsUnder,
  buildManifest,
  comparePreparation,
  recordedArchive,
  readManifest,
  validArchivePath,
  approvalsInForce,
  preparationDigest,
} from './closure-prep.mjs';

/** How a flow ends: thrown, caught at the function's boundary, returned as the exit code. */
class Exit {
  constructor(code) { this.code = code; }
}

/**
 * Runs one invocation of the preparation and returns its exit code. `out` receives what the
 * command line prints on stdout, `err` what it prints on stderr, one line per call.
 */
export function prepareClosure({ root, argv, out = (s) => console.log(s), err = (s) => console.error(s) }) {
  try {
    run({ root, argv, out, err });
    return 0;
  } catch (e) {
    if (e instanceof Exit) return e.code;
    throw e;
  }
}

function run({ root, argv, out, err }) {
  const changeId = argv[0];
  const apply = argv.includes('--apply');
  const asJson = argv.includes('--json');
  const legacy = argv.includes('--legacy');
  const reopen = argv.includes('--reopen');
  // `--reason ""` stays an empty reason, refused below as one, rather than reading as no flag at all.
  const flagValue = flags(argv, { emptyIsValue: true }).value;
  const reopenReason = flagValue('reason');
  const resume = argv.includes('--resume');
  const abandon = argv.includes('--abandon');
  // The one honest escape from `started`: the operator looked and says the command did run, so the
  // operation carries on from `observed` WITHOUT running it again. It is a recorded human decision,
  // not a repair, which is why it needs a reason like a reopening does.
  const consolidationRan = argv.includes('--consolidation-ran');
  // The token a dry run hands back. Applying a plan means applying it against the world the plan was
  // computed in — without it, `--apply` re-reads and reserves against whatever is there NOW, so a
  // plan taken before a reopening would be applied after it as if nothing had happened. Same idea as
  // `state.mjs transition --expect`.
  const expectControl = flagValue('expect-control');

  const USAGE = 'usage: prepare-closure.mjs <change-id> [--apply] [--legacy] [--json] [--reopen --reason "<why>"]\n                                     [--resume [--consolidation-ran]] [--abandon --reason "<why>"]';

  /** One structured document on every path — `--json` never prints a plan on one and prose on another. */
  function answer(doc, { code = 0 } = {}) {
    if (asJson) out(JSON.stringify(doc, null, 2));
    throw new Exit(code);
  }
  const die = (msg, code = 2) => {
    err(msg);
    if (asJson) out(JSON.stringify({ change_id: changeId ?? null, apply, state: 'usage_error', message: msg }, null, 2));
    throw new Exit(code);
  };

  if (!changeId || changeId.startsWith('--')) die(USAGE);

  const store = new Store(root);
  const change = store.change(changeId) ?? die(`no such change: ${changeId}`, 1);
  const project = store.project();

  if (!abandon) try {
    const check = closureDeliveryPreflight(root, changeId);
    if (!check.ok) throw Object.assign(new Error(check.message), { code: check.code });
  } catch (e) {
    err(`${e.code ?? 'E_DELIVERY_PREFLIGHT'}: ${e.message}`);
    throw new Exit(1);
  }

  const blocking = [];
  const commands = [];
  const note = (m) => blocking.push(m);

  /** A refusal: the same shape on `--json` and on stderr, and it exits 1. */
  function refuse(code, message, lines = [], extra = {}) {
    err(`${code}: ${message}`);
    for (const l of lines) err(`  ${l}`);
    answer({ change_id: changeId, apply, state: 'refused', code, message, detail: lines, ...extra }, { code: 1 });
  }

  // --- 0. the durable control, before anything is decided ---------------------------------------
  const lc = readLifecycle(root, changeId);
  if (lc.present && !lc.doc) {
    refuse(lc.code, lc.message, [
      'Nothing was run and nothing was written. A closure control that cannot be read is not an empty one:',
      'reading it as "nothing was ever retired" is exactly the substitution this record exists to refuse.',
      'Recover it, or run the closure migration explicitly.',
    ]);
  }
  const lifecycle = lc.doc;
  const generation = lifecycle?.generation ?? 1;

  // A plan is applied against the world it was computed in. Checked HERE, before any branch —
  // `unchanged` writes nothing and would have exited cleanly, reporting that a stale plan had been
  // applied when what actually happened is that it was never applied at all.
  if (expectControl !== undefined && Number(expectControl) !== (lifecycle?.revision ?? 0)) {
    refuse('E_CONCURRENT_UPDATE',
      `the closure control moved underneath this write: expected revision ${expectControl}, found ${lifecycle?.revision ?? 0}`,
      [
        'This plan was computed against a closure that has since moved — an approval, a refresh or a',
        'reopening landed in between. Nothing was run and nothing was written.',
        'Read it again and decide against what is there now.',
      ]);
  }

  const open = pendingOperation(lifecycle);

  // Abandoning is decided about an operation, so it is handled before anything else is computed.
  if (abandon) {
    if (!open) die('--abandon needs an unfinished operation to abandon; there is none', 2);
    if (!reopenReason || !reopenReason.trim()) {
      die('--abandon requires --reason "<why>": abandoning records that a person looked and decided, and that is not done anonymously', 2);
    }
    if (!apply) die('--abandon writes; add --apply', 2);
    abandonOperation(root, changeId, open.operation_id, reopenReason);
    store.appendHistory(changeId, {
      event_id: `closure_operation_abandoned:${open.operation_id}`,
      type: 'closure_operation_abandoned',
      at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      operation_id: open.operation_id, kind: open.kind, phase: open.phase, reason: reopenReason,
      schema_version: SCHEMA_VERSION,
    });
    err(`abandoned ${open.kind} operation ${open.operation_id} (was at "${open.phase}")`);
    err('  Whatever it wrote is still there, untouched. Nothing was reverted.');
    answer({ change_id: changeId, apply, state: 'abandoned', operation_id: open.operation_id, phase: open.phase, reason: reopenReason });
  }

  if (open && !(reopen && open.kind === 'reopen')) {
    // `started` is the one phase nothing resolves on its own: the command may or may not have run.
    // `--consolidation-ran` is the operator saying they looked — recorded, and it moves the
    // operation to `observed` rather than running anything.
    if (open.phase === PHASE.STARTED && resume && consolidationRan && apply) {
      if (!reopenReason || !reopenReason.trim()) {
        die('--consolidation-ran requires --reason "<why>": it records a human decision about a command whose result nobody observed', 2);
      }
      // The decision becomes a RECORD with its own provenance. It is not an observation: nobody
      // watched the command finish, a person looked at what it should have produced and said so.
      // Recording it as `observed_execution` would be exactly the fabrication that removing the
      // default PASS was about, so the source travels with it into the snapshot.
      // The reference point is the disk AT THE MOMENT OF THE DECISION: the operator looked at this
      // and said the command had run. Recording it is what lets a later resume tell "finishing what
      // was decided" from "finishing something that changed since".
      let contractNow = null;
      let candidateNow = null;
      try { contractNow = contractDigest(root, change).digest; } catch { /* named below if it matters */ }
      try { candidateNow = contentDigest(root).digest; } catch { /* named below if it matters */ }
      advanceOperation(root, changeId, open.operation_id, PHASE.OBSERVED, {
        resolved_by_operator: reopenReason,
        consolidation: {
          command_digest: open.plan?.inputs?.command_digest ?? null,
          exit_code: null,
          result: 'PASS',
          source: 'operator_decision',
          decided_because: reopenReason,
        },
        observed: { contract_digest: contractNow, candidate_digest: candidateNow },
      });
      store.appendHistory(changeId, {
        event_id: `closure_uncertainty_resolved:${open.operation_id}`,
        type: 'closure_uncertainty_resolved',
        at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
        operation_id: open.operation_id, reason: reopenReason, schema_version: SCHEMA_VERSION,
      });
      err(`recorded: the consolidation of ${open.operation_id} did run — ${reopenReason}`);
    } else if (!(resume && RESUMABLE.has(open.phase) && apply)) {
      refuse('E_OPERATION_PENDING',
        `${changeId} has an unfinished ${open.kind} operation (${open.operation_id}) at phase "${open.phase}"`,
        [
          open.recovery,
          open.uncertain
            ? `Either:  --apply --resume --consolidation-ran --reason "<what you checked>"   (it ran; continue without running it again)`
            : `Recover it with:  node scripts/prepare-closure.mjs ${changeId} --apply --resume`,
          open.uncertain
            ? `or:      --apply --abandon --reason "<why>"                                   (drop the operation; what it wrote stays)`
            : `or drop it with:  node scripts/prepare-closure.mjs ${changeId} --apply --abandon --reason "<why>"`,
          'Nothing was run and nothing was written.',
        ],
        { pending_operation: open });
    }
  }

  /** The operation this run is finishing, re-read after any resolution above. */
  const resuming = resume && apply ? pendingOperation(readLifecycle(root, changeId).doc) : null;
  if (resume && apply && !resuming) {
    die(`--resume needs an unfinished operation to resume; ${changeId} has none`, 2);
  }
  if (resuming && !RESUMABLE.has(resuming.phase)) {
    refuse('E_OPERATION_PENDING',
      `${changeId}: an operation at "${resuming.phase}" is not resumable on its own`,
      [resuming.recovery, 'Nothing was run and nothing was written.'], { pending_operation: resuming });
  }

  // --- 1. the change's own contract ---------------------------------------------------------
  const contract = contractDigest(root, change);
  let candidate;
  try { candidate = contentDigest(root); } catch (e) { refuse(e.code ?? 'E_CONTENT_UNAVAILABLE', e.message); }

  let diff = null;
  try {
    diff = classifyDiff(readDiff(change.base_revision, 'HEAD', { cwd: root }));
  } catch (e) {
    note(`the candidate cannot be compared against its base (${e.code}): an unavailable comparison is unknown, never "nothing changed"`);
  }

  /**
   * `git status --porcelain -z`, read as records.
   *
   * The format is "XY <path>\0" — except for a rename or a copy, which is "XY <to>\0<from>\0":
   * the SECOND field carries no status prefix. Slicing three characters off every field turned
   * `badsrc/file.js` into `src/file.js`, and a rename that removed a file outside the change's
   * ownership walked straight through the check that exists to catch it.
   */
  function uncommittedPaths() {
    const fields = execFileSync('git', ['status', '--porcelain', '-z'], { cwd: root, encoding: 'utf8' })
      .split('\0');
    const out = [];
    for (let i = 0; i < fields.length; i++) {
      const entry = fields[i];
      if (!entry) continue;
      const xy = entry.slice(0, 2);
      const path = entry.slice(3);
      if (path) out.push({ status: `L${xy.trim()}`, path });
      if (xy.includes('R') || xy.includes('C')) {
        const from = fields[++i];
        // The source of a rename is a path this change is REMOVING, and ownership applies to it.
        if (from) out.push({ status: 'L(from)', path: from });
      }
    }
    return out;
  }

  const localChanges = (() => {
    try { return uncommittedPaths(); }
    catch (e) {
      note(`the uncommitted part of the candidate cannot be read (${e.message.split('\n')[0]})`);
      return [];
    }
  })();

  /** Paths this change is touching that it does not own. `.spectree/` is the squad's own. */
  function trespasses(files) {
    return [...new Set(
      outsideAllowedPaths(files, change.allowed_paths)
        .map((o) => o.path)
        .filter((p) => !p.startsWith('.spectree/')),
    )];
  }

  const outside = trespasses([...(diff?.files ?? []), ...localChanges]);
  if (outside.length) {
    note(`${outside.length} path(s) outside this change's declared ownership: ${outside.slice(0, 5).join(', ')}`);
  }

  // The modules a proposal named and the deltas on disk must be the same set. A module named with
  // no delta is work that was dropped; a delta nobody named is scope that entered without a gate.
  const listDirs = (dir) => {
    try { return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); }
    catch { return []; }
  };

  const changeDir = join(root, 'docs', 'changes', changeId);
  // Where the contract actually IS — which after a first preparation is the archive. Looking for
  // the delta at the open path only would report "a module was named with no delta" the moment
  // the folder moved, turning an idempotent re-run into a blocking finding.
  const deltaModules = listDirs(join(root, contract.source, 'specs'));
  if ((change.modules_named ?? []).length || deltaModules.length) {
    for (const f of checkProposalDeltaContract(change.modules_named ?? [], deltaModules)) note(f.message);
  }

  // --- 2. the consumer's consolidation mechanism ---------------------------------------------
  const consolidation = consolidationCommand(project);
  if (!consolidation.ok) {
    if (!legacy) {
      refuse(consolidation.code, consolidation.message, [
        'Re-run with --legacy to record that this change closes the legacy way. That is an',
        'explicit statement in the report, not a silent fallback, and it prepares nothing.',
      ]);
    }
    err(`${consolidation.code}: preparing nothing. This change closes the legacy way, and the report says so.`);
    answer({ change_id: changeId, apply, state: 'legacy', prepared: false, code: consolidation.code });
  }

  // --- 3. the archive slot, resolved once and the same way by every reader --------------------
  // Today's date names a NEW slot; a change already archived keeps the slot it went into, whichever
  // day that was. Recomputing the name from the clock made every re-run after midnight look at a
  // folder that does not exist — and then report zero artifacts for a change whose artifacts were
  // sitting right there.
  const archiveRoot = join(root, 'docs', 'changes', 'archive');
  const slotPattern = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${changeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  const occupied = listDirs(archiveRoot).filter((d) => slotPattern.test(d) || d === changeId);
  if (occupied.length > 1) {
    note(`this change occupies ${occupied.length} archive slots (${occupied.join(', ')}); which one is the preparation is not a question this tool may answer by guessing`);
  }
  const archiveName = occupied[0] ?? `${new Date().toISOString().slice(0, 10)}-${changeId}`;
  const archiveRel = `docs/changes/archive/${archiveName}`;
  const archiveOk = validArchivePath(archiveRel, changeId);
  if (!archiveOk.ok) note(`${archiveOk.code}: ${archiveOk.message}`);
  const archiveDest = join(root, archiveRel);
  const alreadyArchived = !existsSync(changeDir) && existsSync(archiveDest);

  // A destination that is already occupied is known NOW — before the consolidation runs, and in
  // the dry run too. Discovering it afterwards meant the command had already written and the
  // report still said it refused.
  if (existsSync(changeDir) && existsSync(archiveDest)) {
    note(`E_PREP_COLLISION: ${archiveRel} already exists; two preparations would occupy the same archive slot`);
  }

  const existingRead = readManifest(root, changeId);
  if (existingRead.present && !existingRead.doc) {
    refuse(existingRead.code, existingRead.message, [
      `Nothing was run and nothing was written. Move or remove ${manifestPath(changeId).split('\\').join('/')} deliberately if that is what you mean to do.`,
    ]);
  }
  const existing = existingRead.doc;

  // Identity is decided by what this run IS.
  //
  // A resumed operation keeps the identity it reserved before its first effect — minting a new one
  // would finish a different preparation from the one that was interrupted, under the same words.
  // Everything else that reaches this point WRITES A NEW SNAPSHOT (a first preparation, a stale
  // re-preparation, a reopening), so it reserves a new identity. `unchanged` never gets here, and a
  // refresh has its own route with its own reservation.
  //
  // Reusing the existing id for a stale re-preparation left the projection and the snapshot that id
  // names holding different documents: one immutable reference designating two things, depending on
  // which file the reader happened to open.
  const preparationId = resuming?.plan?.preparation_id ?? newPreparationId();
  const nextGeneration = resuming?.plan?.generation ?? (reopen ? generation + 1 : generation);

  const draft = buildManifest({
    changeId, projectId: project?.project_id, generation: nextGeneration, preparationId,
    baseRevision: change.base_revision,
    contractDigest: contract.digest, candidateDigest: candidate.digest,
    archivePath: archiveRel,
    preparedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  });
  const verdict = comparePreparation(existing, draft);

  const plan = [
    { op: 'run', what: consolidation.command.join(' '), why: "the consumer's own spec consolidation" },
    ...(existsSync(changeDir)
      ? [{ op: 'archive', what: `docs/changes/${changeId} -> ${archiveRel}`, why: 'the change folder moves; its contents do not change' }]
      : alreadyArchived
        ? [{ op: 'note', what: 'the change folder is already under archive/', why: 'a folder that moved is not proof a preparation was valid — the snapshot is' }]
        : [{ op: 'note', what: 'no change folder on disk', why: 'nothing to archive' }]),
    { op: 'write', what: manifestPath(changeId).split('\\').join('/'), why: 'what was prepared, and for which candidate' },
  ];

  // An incompatible manifest is refused outright, `--apply` included. It is not this run's to
  // overwrite: whatever it records was written under a contract this build does not speak, or for
  // another change, and running the consolidation over it would destroy the only account of what
  // that preparation did. A STALE manifest is different in kind — same change, same contract
  // version, content that moved — and re-preparing it is exactly the intended repair.
  if (verdict.state === 'incompatible') {
    refuse(verdict.code, verdict.message, [
      `Nothing was run and nothing was written. Move or remove ${manifestPath(changeId).split('\\').join('/')} deliberately if that is what you mean to do.`,
    ]);
  }

  // --- 3b. the record freezes where it is relied on, on EVERY path -----------------------------
  //
  // The freeze belongs to the RECORD, not to one branch of this script. Attached to the refresh
  // path alone it was walked around in four commands: alter the code so the preparation reads
  // `stale`, re-prepare — which rewrites the artifact list from whatever is on disk — restore the
  // code, re-prepare again. The manifest comes back to the approved digests carrying a substituted
  // artifact record, with no reopening and no new approval anywhere.
  //
  // Frozen means: an integration approval names exactly what this snapshot records. Authority
  // comes from the durable control, never from the manifest alone — that is the document a
  // restore replaces.
  const authority = approvalsInForce(store.approvals(changeId), existing, { lifecycle, lifecycleError: null });
  if (!authority.ok) {
    refuse(authority.code, authority.message, ['Nothing was run and nothing was written.']);
  }
  const integrationApprovals = authority.inForce.filter((a) => a.gate === 'integration');
  const covering = existing
    ? integrationApprovals.filter((a) => a.preparation?.preparation_id === existing.preparation_id
        || a.preparation?.preparation_digest === existing.preparation_digest)
    // No manifest, but an approval on record: the record that was approved is gone. Preparing
    // over that writes a new one under an approval nobody granted for it.
    : integrationApprovals;
  const frozen = covering.length > 0;
  const frozenBy = covering.map((a) => a.approval_id).join(', ');

  if (reopen && !frozen) {
    die('--reopen is only meaningful for a preparation an integration approval covers; this one is not frozen', 2);
  }
  if (reopen && (!reopenReason || !reopenReason.trim())) {
    die('--reopen requires --reason "<why>": reopening retires an approval, and an approval is not retired anonymously', 2);
  }
  // A change that already integrated is not reopened: the merge happened, and a correction after
  // it is a new change. Editing history to pretend otherwise is the one thing a trail may not do.
  if (reopen && (change.state === 'integrated' || change.state === 'closed')) {
    refuse('E_REOPEN_TERMINAL',
      `${changeId} is "${change.state}"; a closure that has already been integrated is not reopened`,
      ['The merge exists and this does not undo it. A correction after integration is a new change.']);
  }

  if (frozen && !reopen && verdict.state !== 'unchanged') {
    refuse('E_PREP_FROZEN',
      `this preparation may not be replaced — integration approval ${frozenBy} names exactly what it records`,
      [
        `${verdict.code ?? verdict.state}: ${verdict.message ?? 'a different preparation would be written'}`,
        'Nothing was run and nothing was written. The approved record is the reference the merge is checked',
        'against; re-preparing over it substitutes that reference without anyone approving the substitution.',
        `Reopen deliberately instead:  node scripts/prepare-closure.mjs ${changeId} --apply --reopen --reason "<why>"`,
        'which keeps the approved record, retires the approval that covered it, and requires a new',
        'integration approval before the merge can be confirmed.',
      ], { frozen_by: covering.map((a) => a.approval_id) });
  }

  // --- 3c. the artifact record, read before either mode acts -----------------------------------
  //
  // A pure read, so the dry run answers exactly what `--apply` would do. Computed here rather than
  // inside the refresh branch because both of its refusals are about the RECORD, and a rule that
  // only fires on one path is a rule with a door next to it.
  const record = (() => {
    if (verdict.state !== 'unchanged' || !existing) return null;
    const recorded = existing.artifacts ?? [];
    const where = recordedArchive(existing, changeId);

    // The folder the preparation NAMED, never one recomputed from today's date. Ambiguous, absent
    // or gone is a refusal: an empty artifact list written over a real one is the record of what
    // was prepared being deleted by the command whose whole job is to keep it accurate.
    if (!where.ok && recorded.length) {
      return { fatal: where.code, message: where.message, why: 'The recorded artifacts stay as they are: an empty list is not a safe default, it is the confirmation after the merge losing everything it had to compare against.' };
    }
    if (where.ok && !existsSync(join(root, where.dir))) {
      return { fatal: 'E_PREP_MISSING', message: `the preparation archived ${where.dir}, and it is not there now`, why: 'Restore the folder, or re-prepare deliberately — the record is not updated to agree with a directory that disappeared.' };
    }
    let current = [];
    try { current = where.ok ? artifactsUnder(root, where.dir, 'archived') : []; }
    catch (e) { return { fatal: e.code ?? 'E_PREP_MALFORMED', message: e.message, why: 'The record is left exactly as it was.' }; }
    return { recorded, current, same: JSON.stringify(current) === JSON.stringify(recorded) };
  })();

  if (record?.fatal) {
    refuse(record.fatal, record.message, [`Nothing was run and nothing was written. ${record.why}`]);
  }

  // The record freezes at the integration approval. Before it, a ticked box is progress and the
  // record catching up is maintenance. After it, that same write updates the reference using the
  // very thing it exists to compare against — a merge that altered a prepared artifact was
  // refused, refreshed, then accepted, with the tool having erased its own evidence.
  if (frozen && !reopen && record && !record.same) {
    refuse('E_PREP_FROZEN',
      `this preparation is covered by integration approval ${frozenBy}, so its artifact record is final`,
      [
        `${record.current.length} artifact(s) on disk differ from the ${record.recorded.length} recorded. Nothing was run and nothing was written.`,
        'The record is the reference the merge is checked against; refreshing it here would make any',
        'alteration self-approving.',
        `Reopen it deliberately instead:  node scripts/prepare-closure.mjs ${changeId} --apply --reopen --reason "<why>"`,
      ], { frozen_by: covering.map((a) => a.approval_id) });
  }

  // Everything that blocks integration is known BEFORE anything runs. The consolidation writes to
  // the project; running it and then reporting a blocker leaves the work half-done and the report
  // saying it refused.
  if (blocking.length && apply) {
    err(`REFUSED — ${blocking.length} blocking item(s), and nothing was run:`);
    for (const b of blocking) err(`  - ${b}`);
    err('\nFix these first. A preparation that writes and then refuses is worse than one that refuses.');
    answer({ change_id: changeId, apply, state: 'refused', code: 'E_PREP_BLOCKED', message: `${blocking.length} blocking item(s)`, blocking }, { code: 1 });
  }

  if (verdict.state === 'stale' && !apply) {
    err(`${verdict.code}: ${verdict.message}`);
    err('  Re-run the preparation: what was prepared no longer describes what would be integrated.');
  }

  // --- 4. report, then act --------------------------------------------------------------------
  const snapshotOf = (state, extra = {}) => ({
    change_id: changeId, apply, state,
    generation: nextGeneration,
    preparation_id: preparationId,
    contract_digest: contract.digest,
    candidate_digest: candidate.digest,
    archive_path: archiveRel,
    blocking,
    ...extra,
  });

  if (!apply) {
    if (!asJson) {
      out(`DRY RUN — nothing will be written  ->  ${changeId}`);
      out(`  contract   ${contract.digest.slice(0, 22)}...  (${contract.source})`);
      out(`  candidate  ${candidate.digest.slice(0, 22)}...  ${candidate.dirty ? '(with uncommitted changes)' : '(clean)'}`);
      out(`  generation ${nextGeneration}${reopen ? '  (a reopening)' : ''}`);
      out(`  state      ${record && record.same ? 'unchanged' : record ? 'refreshed' : verdict.state}\n`);
      for (const p of plan) out(`  ${p.op.padEnd(8)} ${p.what}\n           ${p.why}`);
      if (blocking.length) {
        out('\n  blocking:');
        for (const b of blocking) out(`    - ${b}`);
      }
      out(`\nnothing written. Re-run with --apply to perform this plan${lifecycle ? ` (expected control revision ${lifecycle.revision})` : ''}.`);
    }
    // A stale preparation exits 1 in the dry run and repairs itself under `--apply`. The DECISION
    // is the same on both — `state: "stale"` in the same document — and the exit code says whether
    // anything needs attention, which for a plan-only run it does.
    answer(snapshotOf(record && record.same ? 'unchanged' : record ? 'refreshed' : verdict.state, {
      plan, expected_control_revision: lifecycle?.revision ?? null,
    }), { code: blocking.length || verdict.state === 'stale' ? 1 : 0 });
  }

  // --- 4b. a recovery is routed by the operation's KIND, before any normal shortcut --------------
  //
  // Two ways this went wrong. A refresh interrupted at `persisting` was met by a run that tried to
  // reserve a NEW refresh and refused its own predecessor. And a prepare that had already written
  // the projection was met by the `unchanged` shortcut — the digests matched the bytes it had just
  // written — so the run reported success with the operation still open and no event in the trail.
  //
  // `unchanged` is a statement about content. It is not a statement that an operation finished.
  if (resuming && resuming.kind === 'refresh') {
    const plan = resuming.plan ?? {};
    const where = plan.archive_path ? { ok: true, dir: plan.archive_path } : recordedArchive(existing, changeId);
    if (!where.ok) refuse(where.code, where.message, ['The interrupted refresh names no archive location; nothing was written.']);
    let current = [];
    try { current = artifactsUnder(root, where.dir, 'archived'); }
    catch (e) { refuse(e.code ?? 'E_PREP_MALFORMED', e.message, ['Nothing was written.']); }

    // The same identity the interrupted refresh reserved, so the resume finishes THAT refresh.
    const refreshed = buildManifest({
      ...toBuildArgs(existing),
      preparationId: plan.preparation_id ?? existing.preparation_id,
      generation: plan.generation ?? existing.generation,
      artifacts: current,
      preparedAt: existing.prepared_at,
    });
    const at = existing.artifacts_refreshed_at ?? new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const body = `${JSON.stringify({ ...refreshed, artifacts_refreshed_at: at }, null, 2)}\n`;
    const snap = join(root, snapshotPath(changeId, refreshed.preparation_id));
    mkdirSync(dirname(snap), { recursive: true });
    if (!existsSync(snap)) writeAtomic(snap, body);
    writeAtomic(join(root, manifestPath(changeId)), existsSync(snap) ? readFileSync(snap, 'utf8') : body);
    store.appendHistory(changeId, {
      event_id: `closure_artifacts_refreshed:${resuming.operation_id}`,
      type: 'closure_artifacts_refreshed',
      at,
      operation_id: resuming.operation_id,
      from_preparation: resuming.detail?.from_preparation ?? null,
      preparation_id: refreshed.preparation_id,
      preparation_digest: refreshed.preparation_digest,
      contract_digest: refreshed.contract_digest,
      candidate_digest: refreshed.candidate_digest,
      artifacts: current.length,
      schema_version: SCHEMA_VERSION,
    });
    completeOperation(root, changeId, resuming.operation_id, (cur) => ({ ...cur, current_preparation: refreshed.preparation_id }));
    if (!asJson) out(`resumed and refreshed — ${changeId} keeps its preparation; the record of ${current.length} artifact(s) is up to date.`);
    answer(snapshotOf('refreshed', {
      preparation_id: refreshed.preparation_id,
      preparation_digest: refreshed.preparation_digest,
      artifacts: current.length,
      resumed_operation: resuming.operation_id,
    }));
  }

  // A reopening is a deliberate re-preparation, so it never takes the refresh shortcut: the whole
  // consolidation runs again and the record is rebuilt, with the approval it replaced retired.
  // And a RESUME never takes it either: an interrupted operation is finished, not short-circuited.
  if (verdict.state === 'unchanged' && !blocking.length && !reopen && !resuming) {
    if (record.same) {
      if (!asJson) out(`unchanged — ${changeId} is already prepared for this candidate and this contract.`);
      answer(snapshotOf('unchanged', { artifacts: record.recorded.length }));
    }
    // The preparation is still valid: same contract, same candidate. But the RECORD of what it
    // produced can fall behind it — ticking a box in `tasks.md` changes a prepared artifact
    // without changing either digest, and the confirmation after the merge then refuses an
    // artifact that is exactly as it should be. So the record is refreshed and nothing else is:
    // no consolidation is re-run, no folder is moved, and neither digest moves — which is why
    // no evidence and no approval is invalidated. Progress is not scope, and it is not a
    // candidate either.
    // A refresh mints a NEW preparation id, because the artifact record is part of the identity:
    // keeping the id would leave two different documents claiming to be one immutable snapshot,
    // and an approval naming that id could no longer say which of them it covered.
    const refreshedId = newPreparationId();
    const refreshed = buildManifest({
      ...toBuildArgs(existing),
      preparationId: refreshedId,
      artifacts: record.current,
      preparedAt: existing.prepared_at,
    });
    const at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const opId = newOperationId('refresh');
    try {
      beginOperation(root, changeId, {
        kind: 'refresh', operationId: opId, projectId: project?.project_id,
        detail: { from_preparation: existing.preparation_id },
        plan: { preparation_id: refreshedId, generation: existing.generation, archive_path: existing.archive_path, reopen: false, superseded: [] },
        // The decision above was computed at this control revision. An approval landing between the
        // two is exactly the race that let a refresh rewrite a record approved a moment earlier.
        expectedRevision: expectControl === undefined ? lifecycle?.revision : Number(expectControl),
      });
    } catch (e) {
      refuse(e.code ?? 'E_OPERATION_PENDING', e.message, [
        e.code === 'E_CONCURRENT_UPDATE'
          ? 'The closure moved between this refresh\'s decision and its reservation — an approval or a reopening landed in between. Nothing was written; re-read and decide again.'
          : 'Nothing was written.',
      ]);
    }
    advanceOperation(root, changeId, opId, PHASE.PERSISTING);
    const body = `${JSON.stringify({ ...refreshed, artifacts_refreshed_at: at }, null, 2)}\n`;
    mkdirSync(dirname(join(root, snapshotPath(changeId, refreshedId))), { recursive: true });
    writeAtomic(join(root, snapshotPath(changeId, refreshedId)), body);
    writeAtomic(join(root, manifestPath(changeId)), body);
    store.appendHistory(changeId, {
      event_id: `closure_artifacts_refreshed:${opId}`,
      type: 'closure_artifacts_refreshed',
      at,
      operation_id: opId,
      from_preparation: existing.preparation_id,
      preparation_id: refreshed.preparation_id,
      preparation_digest: refreshed.preparation_digest,
      contract_digest: refreshed.contract_digest,
      candidate_digest: refreshed.candidate_digest,
      artifacts: record.current.length,
      schema_version: SCHEMA_VERSION,
    });
    completeOperation(root, changeId, opId, (cur) => ({ ...cur, current_preparation: refreshed.preparation_id }));
    if (!asJson) {
      out(`refreshed — ${changeId} keeps its preparation; only the record of ${record.current.length} artifact(s) was brought up to date.`);
      out('  The contract and the candidate did not move, so nothing that was proven about them was invalidated.');
    }
    answer(snapshotOf('refreshed', {
      preparation_id: refreshed.preparation_id,
      preparation_digest: refreshed.preparation_digest,
      artifacts: record.current.length,
    }));
  }

  /** The fields of a snapshot that survive a refresh unchanged. */
  function toBuildArgs(m) {
    return {
      changeId: m.change_id, projectId: m.project_id, generation: m.generation,
      preparationId: m.preparation_id, baseRevision: m.base_revision,
      contractDigest: m.contract_digest, candidateDigest: m.candidate_digest,
      archivePath: m.archive_path, archiveAbsentReason: m.archive_absent_reason,
      commands: m.commands, blocking: m.blocking, deferred: m.deferred,
      consolidation: m.consolidation, supersedesApproval: m.supersedes_approval ?? [],
    };
  }

  // --- 5. the write. One operation, phases recorded before the effects. -------------------------
  //
  // The reservation carries `expectedRevision`: the control revision this run's DECISION was
  // computed against. If anything moved in between — an approval landing, a reopening — the
  // reservation fails and nothing is applied. A lock taken at write time does not make a decision
  // taken before it fresh, and that is how a refresh overwrote a record approved a moment earlier.
  const operationId = resuming?.operation_id ?? newOperationId(reopen ? 'reopen' : 'prepare');
  if (!resuming) {
    try {
      beginOperation(root, changeId, {
        kind: reopen ? 'reopen' : 'prepare',
        operationId,
        projectId: project?.project_id,
        detail: { reason: reopenReason ?? null },
        // Written before the first effect and never replaced, so a recovery finishes the operation
        // that was interrupted instead of guessing at what it had planned.
        plan: {
          preparation_id: preparationId,
          generation: nextGeneration,
          archive_path: archiveRel,
          reopen,
          superseded: covering.map((a) => a.approval_id),
          // The INPUTS this consolidation is about to run against. A recovery compares the disk to
          // these, rather than recomputing a fresh truth and filing it under the old result: a delta
          // edited while the operation was interrupted otherwise vanished from every comparison, and
          // the resumed preparation claimed a contract that command never consolidated.
          inputs: {
            contract_digest: contract.digest,
            contract_source: contract.source,
            candidate_digest: candidate.digest,
            // The DECLARED command, before substitution. `{change_dir}` resolves differently once
            // the folder is archived — which this very operation does — so comparing the resolved
            // form would report drift for the archive having happened. What this catches is the
            // project changing `closure.consolidate` while the operation was interrupted.
            command_digest: commandDigest(consolidation.command),
          },
        },
        expectedRevision: expectControl === undefined ? lifecycle?.revision : Number(expectControl),
      });
    } catch (e) {
      refuse(e.code ?? 'E_OPERATION_PENDING', e.message, [
        e.code === 'E_CONCURRENT_UPDATE'
          ? 'The closure moved between this run\'s decision and its reservation. Nothing was applied; re-read and decide again.'
          : 'Nothing was run and nothing was written.',
      ]);
    }
  }

  // A reopening SUSPENDS the previous authority before any effect. Interrupted half way, the old
  // approval must already be unusable — otherwise a crash in the middle leaves a retired record
  // still authorising a merge.
  if (reopen && !resuming) {
    const at = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    updateLifecycle(root, changeId, (cur) => ({
      ...cur,
      generation: nextGeneration,
      retired_approvals: [
        ...cur.retired_approvals,
        ...covering.map((a) => ({ approval_id: a.approval_id, generation: cur.generation, at, reason: reopenReason })),
      ],
    }));
    // The approved record is KEPT, byte for byte. Re-serialising it would preserve the meaning and
    // lose the document, and what a retired approval was granted over is the document.
    if (existingRead.bytes) {
      const kept = join(root, snapshotPath(changeId, `${existing.preparation_id}.approved`));
      mkdirSync(dirname(kept), { recursive: true });
      writeAtomic(kept, existingRead.bytes);
    }
    store.appendHistory(changeId, {
      event_id: `closure_reopened:${operationId}`,
      type: 'closure_reopened',
      at,
      operation_id: operationId,
      reason: reopenReason,
      from_generation: generation,
      to_generation: nextGeneration,
      superseded_approvals: covering.map((a) => a.approval_id),
      kept_at: existingRead.bytes ? snapshotPath(changeId, `${existing.preparation_id}.approved`).split('\\').join('/') : null,
      schema_version: SCHEMA_VERSION,
    });
    // The change goes back to the working point, by a recorded lifecycle operation rather than a
    // generic regressive transition. `ci_green` and `integration_approved` describe a candidate
    // that no longer has an approved preparation behind it, and leaving the change parked in one
    // of them would let the next gate read a state that stopped being true.
    const at2 = store.change(changeId);
    if (at2.state !== 'implemented' && ORDER.indexOf(at2.state) > ORDER.indexOf('implemented')) {
      store.putChange({ ...at2, state: 'implemented' }, {
        expected: at2.state_revision,
        event: { type: 'closure_reopened_state', from: at2.state, to: 'implemented', operation_id: operationId, reason: reopenReason },
      });
    }
    err(`REOPENED — ${covering.length} integration approval(s) retired: ${frozenBy}`);
    err(`  Generation ${generation} -> ${nextGeneration}. The record they covered is kept.`);
    err(`  The change returns to "implemented"; a new integration approval is required.`);
  }

  // Run the consumer's consolidation. Its exit code is the answer; nothing here interprets its
  // output, and nothing here edits a spec when it fails. `{change_id}` and `{change_dir}` are
  // substituted literally, per argument — the folder moves, and a command that cannot name the
  // folder cannot be re-run after it moved.
  const changeDirNow = existsSync(changeDir) ? `docs/changes/${changeId}` : (alreadyArchived ? archiveRel : `docs/changes/${changeId}`);
  const resolved = resolveCommand(consolidation.command, { changeId, changeDir: changeDirNow });

  let consolidationRecord;
  if (resuming) {
    // Observed once, recorded once. Re-running a command whose result is already on record would
    // make a recovery an execution, and the whole point of recording the phase is that it is not.
    //
    // There is no default. "The process reached `observed`" is not "the consolidation succeeded", and
    // inventing a PASS where the observation is missing is inventing the observation.
    consolidationRecord = resuming.detail?.consolidation ?? null;
    if (!consolidationRecord) {
      refuse('E_RESUME_NO_OBSERVATION',
        `${operationId} reached "${resuming.phase}" with no recorded consolidation result`,
        [
          'A resume finishes an operation from what was observed. Nothing here invents that observation:',
          '"the command ran" is not "the command consolidated", and the difference is the whole point',
          'of recording the phase.',
          `Decide it explicitly:  --apply --resume --consolidation-ran --reason "<what you checked>"`,
          `or drop it:            --apply --abandon --reason "<why>"`,
        ], { pending_operation: resuming });
    }

    // The world the interrupted command ran in, compared against the world now. A delta edited
    // during the pause changes the contract, and pinning the old result under the new contract is a
    // preparation for something that was never consolidated.
    const inputs = resuming.plan?.inputs ?? null;
    if (!inputs) {
      refuse('E_RESUME_NO_INPUTS',
        `${operationId} recorded no inputs, so what it ran against cannot be established`,
        ['Nothing was written. Abandon it deliberately and prepare again:',
          `  --apply --abandon --reason "<why>"`], { pending_operation: resuming });
    }
    const drift = [];
    if (contract.digest !== inputs.contract_digest) {
      drift.push(`the contract moved (ran against ${String(inputs.contract_digest).slice(0, 18)}…, now ${contract.digest.slice(0, 18)}…)`);
    }
    const observedAfter = resuming.detail?.observed?.contract_digest ?? null;
    if (observedAfter && contract.digest !== observedAfter) {
      drift.push(`the contract moved after the command was observed (observed ${String(observedAfter).slice(0, 18)}…, now ${contract.digest.slice(0, 18)}…)`);
    }
    // And the RESULT. This is the half the contract comparison cannot see: the delta untouched, the
    // living spec replaced, and every other check agreeing.
    const producedAfter = resuming.detail?.observed?.candidate_digest ?? null;
    if (producedAfter && candidate.digest !== producedAfter) {
      drift.push(`what the command produced is not what is here now (observed ${String(producedAfter).slice(0, 18)}…, now ${candidate.digest.slice(0, 18)}…)`);
    }
    if (!producedAfter) {
      drift.push('the operation recorded no identity for what the command produced, so there is nothing to compare it against');
    }
    if (inputs.command_digest && commandDigest(consolidation.command) !== inputs.command_digest) {
      drift.push('the consolidation command the project declares is not the one that ran');
    }
    if (drift.length) {
      refuse('E_RESUME_INPUTS_CHANGED',
        `${operationId} cannot be resumed: what it ran against is not what is here now`,
        [
          ...drift,
          'Nothing was written and the consolidation was NOT run again. A recovery finishes the',
          'operation that was interrupted; it does not re-decide it under a different contract.',
          `Abandon it and prepare again:  --apply --abandon --reason "<why>"`,
        ], { pending_operation: resuming, drift });
    }

    commands.push({ check: resolved.join(' '), exit_code: consolidationRecord.exit_code, result: consolidationRecord.result });
    err(`resuming ${operationId} from "${resuming.phase}" — the consolidation is NOT run again.`);
  } else {
    advanceOperation(root, changeId, operationId, PHASE.STARTED, { command: commandDigest(resolved) });
    const ran = launch(resolved, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const output = `${ran.stdout ?? ''}${ran.stderr ?? ''}`;
    if (output) err(output.endsWith('\n') ? output.slice(0, -1) : output);
    consolidationRecord = {
      command_digest: commandDigest(resolved),
      argv_length: resolved.length,
      exit_code: ran.status ?? null,
      result: ran.error ? 'INFRA_ERROR' : ran.status === 0 ? 'PASS' : 'FAIL',
    };
    // What the command left behind, recorded in the same write that records the observation.
    //
    // The contract alone was half the obligation. It says what the consolidation was asked to
    // consolidate; it says nothing about what came out. With the delta untouched and the living
    // spec replaced during the pause, every contract comparison agreed and the resumed preparation
    // pinned the old PASS to content that command never produced.
    //
    // The candidate digest is the result's identity: `docs/specs/` is content, while the archive,
    // the trail and the squad's own records are excluded from it by construction — so the archival
    // this operation is about to perform does not read as drift, and administrative progress does
    // not either. It is taken AFTER the command, so a consolidation that legitimately rewrites its
    // own output is recorded as it actually ended.
    let observedContract = null;
    let observedCandidate = null;
    try { observedContract = contractDigest(root, change).digest; } catch { /* reported below */ }
    try { observedCandidate = contentDigest(root).digest; } catch { /* reported below */ }
    advanceOperation(root, changeId, operationId, PHASE.OBSERVED, {
      consolidation: consolidationRecord,
      observed: { contract_digest: observedContract, candidate_digest: observedCandidate },
    });
    commands.push({ check: resolved.join(' '), exit_code: ran.status ?? null, result: consolidationRecord.result });
    if (ran.error || ran.status !== 0) {
      note(`spec consolidation failed (${ran.error ? ran.error.message : `exit ${ran.status}`}); the delta was not merged into the living spec`);
    }
  }
  if (consolidationRecord.result !== 'PASS' && resuming) {
    note(`the recorded consolidation of this operation ${consolidationRecord.result === 'FAIL' ? 'failed' : 'did not run'}; a resume finishes an operation, it does not repair one`);
  }

  // What the consolidation itself did goes through the same ownership check. It is a command the
  // project supplied and this squad ran; a preparation that lets it write outside the change's
  // declared paths has approved, by running it, exactly what the check exists to refuse.
  if (!blocking.length) {
    try {
      // The WHOLE candidate again, recomputed: base..HEAD as it stands now, plus what is
      // uncommitted. Looking only at the uncommitted half let a consolidation command that
      // COMMITTED its trespass pass clean — the files were outside the change and outside the
      // check, because committing them emptied the only list being read.
      const committed = classifyDiff(readDiff(change.base_revision, 'HEAD', { cwd: root })).files;
      const after = trespasses([...committed, ...uncommittedPaths()]);
      if (after.length) {
        note(`the consolidation command left ${after.length} path(s) outside this change's declared ownership: ${after.slice(0, 5).join(', ')}`);
      }
    } catch (e) {
      note(`the candidate could not be re-read after the consolidation (${e.message.split('\n')[0]})`);
    }
  }

  // An exit code of zero is a claim about the command, not about the contract. If the consolidation
  // moved a Requirement, pinning the snapshot under the digest computed before it ran would file
  // this preparation against a contract nobody consolidated.
  let contractAfter = contract;
  if (!blocking.length) {
    try {
      contractAfter = contractDigest(root, change);
      if (contractAfter.digest !== contract.digest) {
        note('the consolidation changed the contract while it ran; the scope that was approved is not the scope that would be integrated, and that is not something a preparation may pin over');
      }
    } catch (e) {
      note(`the contract could not be re-read after the consolidation (${e.message.split('\n')[0]})`);
    }
  }

  if (blocking.length) {
    completeOperation(root, changeId, operationId);
    err(`REFUSED after running the consolidation — ${blocking.length} blocking item(s):`);
    for (const b of blocking) err(`  - ${b}`);
    // Nothing is archived and nothing is deleted. What the command wrote stays where it is: it is
    // work, and removing it automatically would destroy something nobody chose to destroy.
    err('\nNothing was archived and nothing was removed. Whatever the command wrote — or committed —');
    err('is still there, for you to keep or revert deliberately.');
    answer({ change_id: changeId, apply, state: 'refused', code: 'E_PREP_BLOCKED', message: `${blocking.length} blocking item(s) after the consolidation`, blocking, commands }, { code: 1 });
  }

  advanceOperation(root, changeId, operationId, PHASE.PERSISTING);

  // Archive only once everything above holds: moving the folder first would leave a change whose
  // delta is nowhere and whose living spec never received it.
  const artifacts = [];
  if (existsSync(changeDir)) {
    mkdirSync(dirname(archiveDest), { recursive: true });
    renameSync(changeDir, archiveDest);
  }
  try { artifacts.push(...artifactsUnder(root, archiveRel, 'archived')); }
  catch (e) {
    completeOperation(root, changeId, operationId);
    refuse(e.code ?? 'E_PREP_MALFORMED', e.message, ['The folder was archived; the record was not written.']);
  }

  const deferred = (() => {
    try {
      return store.deferred().items
        .filter((i) => i.status === 'open' && i.opened_by_change === changeId)
        .map((i) => ({ stable_id: i.stable_id, owner: i.owner, impact: i.impact }));
    } catch (e) { throw Object.assign(new Error(`Deferred ledger could not be read: ${e.message}`), { code: 'E_DELIVERY_LEDGER' }); }
  })();

  const manifest = buildManifest({
    changeId, projectId: project?.project_id, generation: nextGeneration, preparationId,
    baseRevision: change.base_revision,
    contractDigest: contractAfter.digest,
    candidateDigest: (() => {
      // Recomputed AFTER the writes: the candidate is what would be integrated, and the archival
      // is part of it. No fallback to the pre-write digest — that would file this preparation
      // against a candidate that no longer exists, which is the exact confusion it exists to stop.
      try { return contentDigest(root).digest; }
      catch (e) {
        completeOperation(root, changeId, operationId);
        refuse(e.code ?? 'E_CONTENT_UNAVAILABLE', `the content could not be re-read after preparing (${e.message}); nothing may be recorded about a candidate that cannot be established`);
        return null;
      }
    })(),
    archivePath: existsSync(archiveDest) ? archiveRel : undefined,
    archiveAbsentReason: existsSync(archiveDest) ? undefined : 'no change folder was on disk to archive, and none was recorded before',
    // Carried forward until a new approval is granted: a reopening that let the next ordinary
    // re-preparation drop the list would retire an approval for exactly one run. The durable
    // record is the closure control; this stays as a projection.
    supersedesApproval: [
      ...(existing?.supersedes_approval ?? []),
      ...(reopen ? covering.map((a) => a.approval_id) : []),
    ],
    consolidation: consolidationRecord,
    artifacts, commands, blocking, deferred,
    preparedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  });

  const file = join(root, manifestPath(changeId));
  mkdirSync(dirname(file), { recursive: true });
  // The immutable snapshot first, then the projection: a reader that finds the pointer always
  // finds the document it points at. Both atomically — the snapshot is written once and never
  // again, so a torn one would be read back by the resume as the record itself.
  //
  // And on a RESUME the snapshot that already exists IS the record — rewriting it would stamp a new
  // `prepared_at` over an immutable document, so a resumed persistence produces the same bytes it
  // was interrupted writing rather than a second version of one preparation.
  const snapFile = join(root, snapshotPath(changeId, preparationId));
  mkdirSync(dirname(snapFile), { recursive: true });
  const body = resuming && existsSync(snapFile)
    ? readFileSync(snapFile, 'utf8')
    : `${JSON.stringify(manifest, null, 2)}\n`;
  if (!existsSync(snapFile)) writeAtomic(snapFile, body);
  writeAtomic(file, body);
  const recorded = JSON.parse(body);

  // The event first, then the close. A crash between them would otherwise lose the trail entry for
  // a write that had already happened, and an operation reported as finished with nothing recorded
  // about it is the one shape a trail may not take.
  store.appendHistory(changeId, {
    event_id: `closure_prepared:${operationId}`,
    type: 'closure_prepared',
    at: recorded.prepared_at,
    operation_id: operationId,
    generation: nextGeneration,
    preparation_id: preparationId,
    preparation_digest: recorded.preparation_digest,
    contract_digest: recorded.contract_digest,
    candidate_digest: recorded.candidate_digest,
    archive_path: recorded.archive_path,
    artifacts: artifacts.length,
    commands: commands.length,
    deferred: deferred.length,
    schema_version: SCHEMA_VERSION,
  });

  const control = completeOperation(root, changeId, operationId, (cur) => ({
    ...cur,
    generation: nextGeneration,
    current_preparation: preparationId,
    project_id: cur.project_id ?? project?.project_id ?? null,
  }));

  // Nothing is reported as prepared until the projection, the snapshot that identity names, the
  // durable pointer and the digest about to be printed all say the same thing. Success announced
  // while any of them disagreed is how one reference came to designate two documents.
  {
    const disagreements = [];
    const onDisk = readFileSync(file, 'utf8');
    if (onDisk !== readFileSync(snapFile, 'utf8')) disagreements.push('the projection and the snapshot differ');
    if (recorded.preparation_id !== preparationId) disagreements.push('the snapshot names another preparation');
    if (control.current_preparation !== preparationId) disagreements.push('the durable pointer names another preparation');
    if (recorded.preparation_digest !== preparationDigest(recorded)) disagreements.push('the snapshot does not digest to what it records');
    if (disagreements.length) {
      refuse('E_PREP_INCONSISTENT',
        `${changeId} was written inconsistently: ${disagreements.join('; ')}`,
        ['The files are left as they are for inspection. Nothing here overwrites a snapshot to make',
          'the disagreement go away — that would discard the record it is disagreeing about.']);
    }
  }

  if (!asJson) {
    out(`${resuming ? 'resumed and prepared' : 'prepared'} ${changeId}  (generation ${nextGeneration}, ${preparationId})`);
    out(`  contract   ${recorded.contract_digest.slice(0, 22)}...`);
    out(`  candidate  ${recorded.candidate_digest.slice(0, 22)}...`);
    out(`  identity   ${recorded.preparation_digest.slice(0, 22)}...`);
    out(`  ${artifacts.length} artifact(s) archived, ${commands.length} command(s) run, ${deferred.length} deferral(s) carried`);
    out(`  contract version ${PREP_CONTRACT_VERSION}. Nothing was marked integrated or closed: that is the merge's job.`);
    if (reopen) out('  This preparation is NOT approved: the approval that covered the previous one was retired.');
  }
  answer({
    ...snapshotOf(reopen ? 'reopened' : 'prepared'),
    preparation_digest: recorded.preparation_digest,
    artifacts: recorded.artifacts.length,
    commands,
    deferred,
    ...(resuming ? { resumed_operation: resuming.operation_id } : {}),
    manifest: recorded,
  });
}
