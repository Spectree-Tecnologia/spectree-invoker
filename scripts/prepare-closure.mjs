#!/usr/bin/env node
// Prepare a change's closure on its own branch, before the merge.
//
//   node scripts/prepare-closure.mjs <change-id>              plan only, writes nothing
//   node scripts/prepare-closure.mjs <change-id> --apply
//   node scripts/prepare-closure.mjs <change-id> --json
//
// It validates, runs the consumer's own consolidation command, archives the change folder,
// and writes one manifest. It never writes `integrated` or `closed`, never opens a second PR,
// and never edits `docs/specs/` by hand — a spec written by the tool that also approves it
// proves nothing.
//
// Exit codes: 0 prepared (or already prepared), 1 refused, 2 usage.

import { existsSync, mkdirSync, renameSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { Store, SCHEMA_VERSION } from './lib/store.mjs';
import { contractDigest, contentDigest, gatedDigest } from './lib/digest.mjs';
import { readDiff, classifyDiff, outsideAllowedPaths } from './lib/diff.mjs';
import { checkProposalDeltaContract } from './lib/closure.mjs';
import { launch } from './lib/launch.mjs';
import {
  PREP_CONTRACT_VERSION, manifestPath, consolidationCommand,
  artifactsUnder, buildManifest, comparePreparation, recordedArchive, approvalsInForce,
} from './lib/closure-prep.mjs';

const root = process.env.SPECTREE_PROJECT_ROOT ?? process.cwd();
const argv = process.argv.slice(2);
const changeId = argv[0];
const apply = argv.includes('--apply');
const asJson = argv.includes('--json');
const legacy = argv.includes('--legacy');
const reopen = argv.includes('--reopen');
const reopenReason = (() => {
  const i = argv.indexOf('--reason');
  return i >= 0 ? argv[i + 1] : undefined;
})();
const die = (msg, code = 2) => { console.error(msg); process.exit(code); };

if (!changeId || changeId.startsWith('--')) {
  die('usage: prepare-closure.mjs <change-id> [--apply] [--legacy] [--json] [--reopen --reason "<why>"]');
}

const store = new Store(root);
const change = store.change(changeId) ?? die(`no such change: ${changeId}`, 1);
const project = store.project();

const blocking = [];
const commands = [];
const note = (m) => blocking.push(m);

// --- 1. the change's own contract ---------------------------------------------------------
const contract = contractDigest(root, change);
let candidate;
try { candidate = contentDigest(root); } catch (e) { die(`${e.code}: ${e.message}`, 1); }

let diff = null;
try {
  diff = classifyDiff(readDiff(change.base_revision, 'HEAD', { cwd: root }));
} catch (e) {
  note(`the candidate cannot be compared against its base (${e.code}): an unavailable comparison is unknown, never "nothing changed"`);
}

// Ownership is checked over the WHOLE candidate: what is committed against the base, and what
// is sitting in the work tree uncommitted. The candidate includes both — the digests already
// say so — and checking only base..HEAD let an unowned file that had not been committed yet
// pass straight through.
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
    console.error(`${consolidation.code}: ${consolidation.message}`);
    console.error('\n  Re-run with --legacy to record that this change closes the legacy way. That is an');
    console.error('  explicit statement in the report, not a silent fallback, and it prepares nothing.');
    process.exit(1);
  }
  console.error(`${consolidation.code}: preparing nothing. This change closes the legacy way, and the report says so.`);
  if (asJson) console.log(JSON.stringify({ change_id: changeId, prepared: false, mode: 'legacy', reason: consolidation.code }, null, 2));
  process.exit(0);
}

// --- 3. the plan ----------------------------------------------------------------------------
// The slot this change occupies under archive/. Today's date names a NEW one; a change that was
// already archived keeps the slot it went into, whichever day that was. Recomputing the name
// from the clock made every re-run after midnight look at a folder that does not exist — and
// then report zero artifacts for a change whose artifacts were sitting right there.
const archiveRoot = join(root, 'docs', 'changes', 'archive');
const slot = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${changeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
const occupied = listDirs(archiveRoot).filter((d) => slot.test(d));
if (occupied.length > 1) {
  note(`this change occupies ${occupied.length} archive slots (${occupied.join(', ')}); which one is the preparation is not a question this tool may answer by guessing`);
}
const archiveName = occupied[0] ?? `${new Date().toISOString().slice(0, 10)}-${changeId}`;
const archiveRel = join('docs', 'changes', 'archive', archiveName);
const archiveDest = join(root, archiveRel);
const alreadyArchived = !existsSync(changeDir) && existsSync(archiveDest);

// A destination that is already occupied is known NOW — before the consolidation runs, and in
// the dry run too. Discovering it afterwards meant the command had already written and the
// report still said it refused.
if (existsSync(changeDir) && existsSync(archiveDest)) {
  note(`E_PREP_COLLISION: ${archiveRel.split('\\').join('/')} already exists; two preparations would occupy the same archive slot`);
}
const plan = [
  { op: 'run', what: consolidation.command.join(' '), why: "the consumer's own spec consolidation" },
  ...(existsSync(changeDir)
    ? [{ op: 'archive', what: `docs/changes/${changeId} -> ${archiveRel.split('\\').join('/')}`, why: 'the change folder moves; its contents do not change' }]
    : alreadyArchived
      ? [{ op: 'note', what: 'the change folder is already under archive/', why: 'a folder that moved is not proof a preparation was valid — the manifest is' }]
      : [{ op: 'note', what: 'no change folder on disk', why: 'nothing to archive' }]),
  { op: 'write', what: manifestPath(changeId).split('\\').join('/'), why: 'what was prepared, and for which candidate' },
];

const existing = (() => {
  const f = join(root, manifestPath(changeId));
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
})();

const draft = buildManifest({
  changeId, baseRevision: change.base_revision,
  contractDigest: contract.digest, candidateDigest: candidate.digest,
  preparedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
});
const verdict = comparePreparation(existing, draft);

// --- 3b. the record freezes where it is relied on, on EVERY path -----------------------------
//
// The freeze belongs to the RECORD, not to one branch of this script. Attached to the refresh
// path alone it was walked around in four commands: alter the code so the preparation reads
// `stale`, re-prepare — which rewrites the artifact list from whatever is on disk — restore the
// code, re-prepare again. The manifest comes back to the approved digests carrying a substituted
// artifact record, with no reopening and no new approval anywhere. Same defect, other door.
//
// Frozen means: an integration approval names exactly what this manifest records. The condition
// is about coverage, not about a state name or a code path — an approval that no longer matches
// covers nothing, and freezes nothing.
// Through the shared rule. An approval this preparation already retired covers nothing — it was
// retired precisely because the record it was granted over no longer exists — and counting it
// would freeze every change that was ever reopened, permanently, at the digests it had before.
const integrationApprovals = approvalsInForce(store.approvals(changeId), existing)
  .inForce.filter((a) => a.gate === 'integration');
const covering = existing
  ? integrationApprovals.filter((a) => a.scope_digest === gatedDigest(existing.contract_digest, existing.candidate_digest))
  // No manifest, but an approval on record: the record that was approved is gone. Preparing over
  // that writes a new one under an approval nobody granted for it.
  : integrationApprovals;
const frozen = covering.length > 0;
const frozenBy = covering.map((a) => a.approval_id).join(', ');

if (reopen && !frozen) {
  die('--reopen is only meaningful for a preparation an integration approval covers; this one is not frozen', 2);
}
if (reopen && !reopenReason) {
  die('--reopen requires --reason "<why>": reopening retires an approval, and an approval is not retired anonymously', 2);
}

// Refused BEFORE the consolidation runs and before anything is written. `unchanged` is the one
// outcome that changes nothing, so it is allowed to reach its own check below — which refuses
// the moment the artifact record on disk differs from the approved one.
if (frozen && !reopen && verdict.state !== 'unchanged') {
  const how = existing
    ? `integration approval ${frozenBy} names exactly what it records`
    : `integration approval ${frozenBy} is on record and the manifest it approved is gone`;
  console.error(`E_PREP_FROZEN: this preparation may not be replaced — ${how}`);
  console.error(`  ${verdict.code ?? verdict.state}: ${verdict.message ?? 'a different preparation would be written'}`);
  console.error('  Nothing was run and nothing was written. The approved record is the reference the merge is');
  console.error('  checked against; re-preparing over it substitutes that reference without anyone approving');
  console.error('  the substitution. Reopen deliberately instead:');
  console.error(`    node scripts/prepare-closure.mjs ${changeId} --apply --reopen --reason "<why>"`);
  console.error('  which keeps the approved record, retires the approval that covered it, and requires a new');
  console.error('  integration approval before the merge can be confirmed.');
  process.exit(1);
}

// An incompatible manifest is refused outright, `--apply` included. It is not this run's to
// overwrite: whatever it records was written under a contract this build does not speak, or for
// another change, and running the consolidation over it would destroy the only account of what
// that preparation did. A STALE manifest is different in kind — same change, same contract
// version, content that moved — and re-preparing it is exactly the intended repair.
if (verdict.state === 'incompatible') {
  console.error(`${verdict.code}: ${verdict.message}`);
  console.error(`  Nothing was run and nothing was written. Move or remove ${manifestPath(changeId).split('\\').join('/')} deliberately if that is what you mean to do.`);
  process.exit(1);
}
if (verdict.state === 'stale') {
  console.error(`${verdict.code}: ${verdict.message}`);
  console.error('  Re-run the preparation: what was prepared no longer describes what would be integrated.');
  if (!apply) process.exit(1);
}

// --- 3c. the artifact record, read before either mode acts -----------------------------------
//
// A pure read, so the dry run answers exactly what `--apply` would do. Computed here rather than
// inside the refresh branch because both of its refusals are about the RECORD, and a rule that
// only fires on one path is a rule with a door next to it.
const record = (() => {
  if (verdict.state !== 'unchanged' || !existing) return null;
  const recorded = existing.artifacts ?? [];
  const where = recordedArchive(existing);

  // The folder the preparation NAMED, never one recomputed from today's date. Ambiguous, absent
  // or gone is a refusal: an empty artifact list written over a real one is the record of what
  // was prepared being deleted by the command whose whole job is to keep it accurate.
  if (!where.ok && recorded.length) {
    return { fatal: `${where.code}: ${where.message}`, why: 'The recorded artifacts stay as they are: an empty list is not a safe default, it is the confirmation after the merge losing everything it had to compare against.' };
  }
  if (where.ok && !existsSync(join(root, where.dir))) {
    return { fatal: `E_PREP_MISSING: the preparation archived ${where.dir}, and it is not there now`, why: 'Restore the folder, or re-prepare deliberately — the record is not updated to agree with a directory that disappeared.' };
  }
  const current = where.ok ? artifactsUnder(root, where.dir, 'archived') : [];
  return { recorded, current, same: JSON.stringify(current) === JSON.stringify(recorded) };
})();

if (record?.fatal) {
  console.error(record.fatal);
  console.error(`  Nothing was run and nothing was written. ${record.why}`);
  process.exit(1);
}

// The record freezes at the integration approval. Before it, a ticked box is progress and the
// record catching up is maintenance. After it, that same write updates the reference using the
// very thing it exists to compare against — a merge that altered a prepared artifact was
// refused, refreshed, then accepted, with the tool having erased its own evidence.
if (frozen && !reopen && record && !record.same) {
  console.error(`E_PREP_FROZEN: this preparation is covered by integration approval ${frozenBy}, so its artifact record is final`);
  console.error(`  ${record.current.length} artifact(s) on disk differ from the ${record.recorded.length} recorded. Nothing was run and nothing was written.`);
  console.error('  The record is the reference the merge is checked against; refreshing it here would make');
  console.error(`  any alteration self-approving. Reopen it deliberately instead:`);
  console.error(`    node scripts/prepare-closure.mjs ${changeId} --apply --reopen --reason "<why>"`);
  process.exit(1);
}

// Everything that blocks integration is known BEFORE anything runs. The consolidation writes to
// the project; running it and then reporting a blocker leaves the work half-done and the report
// saying it refused.
if (blocking.length && apply) {
  console.error(`REFUSED — ${blocking.length} blocking item(s), and nothing was run:`);
  for (const b of blocking) console.error(`  - ${b}`);
  console.error('\nFix these first. A preparation that writes and then refuses is worse than one that refuses.');
  process.exit(1);
}

// --- 4. report, then act --------------------------------------------------------------------
if (!apply) {
  if (asJson) {
    console.log(JSON.stringify({
      change_id: changeId, apply: false, state: verdict.state,
      contract_digest: contract.digest, candidate_digest: candidate.digest, plan, blocking,
    }, null, 2));
  } else {
    console.log(`DRY RUN — nothing will be written  ->  ${changeId}`);
    console.log(`  contract   ${contract.digest.slice(0, 22)}...  (${contract.source})`);
    console.log(`  candidate  ${candidate.digest.slice(0, 22)}...  ${candidate.dirty ? '(with uncommitted changes)' : '(clean)'}`);
    console.log(`  state      ${verdict.state}\n`);
    for (const p of plan) console.log(`  ${p.op.padEnd(8)} ${p.what}\n           ${p.why}`);
    if (blocking.length) {
      console.log('\n  blocking:');
      for (const b of blocking) console.log(`    - ${b}`);
    }
    console.log('\nnothing written. Re-run with --apply to perform this plan.');
  }
  process.exit(blocking.length ? 1 : 0);
}

// A reopening is a deliberate re-preparation, so it never takes the refresh shortcut: the whole
// consolidation runs again and the record is rebuilt, with the approval it replaced retired.
if (verdict.state === 'unchanged' && !blocking.length && !reopen) {
  // The preparation is still valid: same contract, same candidate. But the RECORD of what it
  // produced can fall behind it — ticking a box in `tasks.md` changes a prepared artifact
  // without changing either digest, and the confirmation after the merge then refuses an
  // artifact that is exactly as it should be.
  //
  // So the record is refreshed and nothing else is: no consolidation is re-run, no folder is
  // moved, and neither digest moves — which is why no evidence and no approval is invalidated.
  // Progress is not scope, and it is not a candidate either.
  //
  // Two things bound it, and without either one the refresh becomes a way of erasing the record
  // it exists to maintain.
  if (record.same) {
    console.log(`unchanged — ${changeId} is already prepared for this candidate and this contract.`);
    process.exit(0);
  }
  const { current } = record;
  const refreshed = {
    ...existing,
    artifacts: current,
    artifacts_refreshed_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  };
  writeFileSync(join(root, manifestPath(changeId)), `${JSON.stringify(refreshed, null, 2)}\n`);
  store.appendHistory(changeId, {
    type: 'closure_artifacts_refreshed',
    at: refreshed.artifacts_refreshed_at,
    contract_digest: refreshed.contract_digest,
    candidate_digest: refreshed.candidate_digest,
    artifacts: current.length,
    schema_version: SCHEMA_VERSION,
  });
  console.log(`refreshed — ${changeId} keeps its preparation; only the record of ${current.length} artifact(s) was brought up to date.`);
  console.log('  The contract and the candidate did not move, so nothing that was proven about them was invalidated.');
  process.exit(0);
}

// Run the consumer's consolidation. Its exit code is the answer; nothing here interprets its
// output, and nothing here edits a spec when it fails.
const ran = launch(consolidation.command, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const output = `${ran.stdout ?? ''}${ran.stderr ?? ''}`;
if (output) process.stderr.write(output.endsWith('\n') ? output : `${output}\n`);
commands.push({
  check: consolidation.command.join(' '),
  exit_code: ran.status ?? null,
  result: ran.error ? 'INFRA_ERROR' : ran.status === 0 ? 'PASS' : 'FAIL',
});
if (ran.error || ran.status !== 0) {
  note(`spec consolidation failed (${ran.error ? ran.error.message : `exit ${ran.status}`}); the delta was not merged into the living spec`);
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

if (blocking.length) {
  console.error(`REFUSED after running the consolidation — ${blocking.length} blocking item(s):`);
  for (const b of blocking) console.error(`  - ${b}`);
  // Nothing is archived and nothing is deleted. What the command wrote stays where it is: it is
  // work, and removing it automatically would destroy something nobody chose to destroy.
  console.error('\nNothing was archived and nothing was removed. Whatever the command wrote — or committed —');
  console.error('is still there, for you to keep or revert deliberately.');
  process.exit(1);
}

// Archive only once everything above holds: moving the folder first would leave a change whose
// delta is nowhere and whose living spec never received it.
const artifacts = [];
if (existsSync(changeDir)) {
  mkdirSync(dirname(archiveDest), { recursive: true });
  renameSync(changeDir, archiveDest);
}
artifacts.push(...artifactsUnder(root, archiveRel.split('\\').join('/'), 'archived'));

// The deferrals this change is leaving behind, read from the ledger rather than remembered.
const deferred = store.present
  ? store.deferred().items.filter((i) => i.status === 'open').map((i) => `#${i.stable_id} ${i.title ?? i.impact ?? ''}`.trim())
  : [];

const manifest = buildManifest({
  changeId, baseRevision: change.base_revision,
  contractDigest: contract.digest,
  candidateDigest: (() => {
    // Recomputed AFTER the writes: the candidate is what would be integrated, and the archival
    // is part of it. No fallback to the pre-write digest — that would file this preparation
    // against a candidate that no longer exists, which is the exact confusion it exists to stop.
    try { return contentDigest(root).digest; }
    catch (e) { die(`${e.code}: the content could not be re-read after preparing (${e.message}); nothing may be recorded about a candidate that cannot be established`, 1); }
  })(),
  archivePath: existsSync(archiveDest) ? archiveRel : undefined,
  // Carried forward until a new approval is granted: a reopening that let the next ordinary
  // re-preparation drop the list would retire an approval for exactly one run.
  supersedesApproval: [...new Set([
    ...(existing?.supersedes_approval ?? []),
    ...(reopen ? covering.map((a) => a.approval_id) : []),
  ])],
  artifacts, commands, blocking, deferred,
  preparedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
});

const file = join(root, manifestPath(changeId));
mkdirSync(dirname(file), { recursive: true });

// The approved record is KEPT, not overwritten. A reopening that destroyed it would leave no
// account of what the retired approval was granted over — which is the whole thing the freeze
// exists to protect.
if (reopen && existing) {
  const keptRel = join('.spectree', 'closure', `${changeId}.superseded.${manifest.prepared_at.replace(/[:.]/g, '-')}.json`);
  writeFileSync(join(root, keptRel), `${JSON.stringify(existing, null, 2)}\n`);
  store.appendHistory(changeId, {
    type: 'closure_reopened',
    at: manifest.prepared_at,
    reason: reopenReason,
    superseded_approvals: covering.map((a) => a.approval_id),
    kept_at: keptRel.split('\\').join('/'),
    schema_version: SCHEMA_VERSION,
  });
  console.error(`REOPENED — ${covering.length} integration approval(s) retired: ${frozenBy}`);
  console.error(`  The record they covered is kept at ${keptRel.split('\\').join('/')}.`);
  console.error('  A new integration approval is required before the merge can be confirmed.');
}

writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);

store.appendHistory(changeId, {
  type: 'closure_prepared',
  at: manifest.prepared_at,
  contract_digest: manifest.contract_digest,
  candidate_digest: manifest.candidate_digest,
  blocking: manifest.blocking.length,
  schema_version: SCHEMA_VERSION,
});

if (asJson) console.log(JSON.stringify(manifest, null, 2));
else {
  console.log(`prepared ${changeId}  (contract ${manifest.contract_digest.slice(0, 18)}…, candidate ${manifest.candidate_digest.slice(0, 18)}…)`);
  console.log(`  ${artifacts.length} artifact(s) archived, ${commands.length} command(s) run, ${deferred.length} deferral(s) carried`);
  if (blocking.length) for (const b of blocking) console.error(`  BLOCKING  ${b}`);
  console.log(`  contract version ${PREP_CONTRACT_VERSION}. Nothing was marked integrated or closed: that is the merge's job.`);
}
process.exit(blocking.length ? 1 : 0);
