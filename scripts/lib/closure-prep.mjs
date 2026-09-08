// Closure preparation: the work that used to happen AFTER the merge, moved to before it.
//
// The waste it removes: a change merged, then a second commit to record the merge, then a
// second PR to consolidate the specs and archive the folder, then a third commit to record
// that this one was green too. Each of those is a CI run validating a note about the previous
// run. The delivery was finished at the first merge; everything after it was bookkeeping
// wearing a delivery's clothes.
//
// The rule that keeps it honest, and the reason this file writes no state:
//
//   preparing the closure before the merge is not declaring the integration before it happens.
//
// The consolidated specs and the archived folder can exist on the branch. `main` receives them
// at the merge like any other content, and the change is only closed once the integration is
// observed. Nothing here writes `integrated` or `closed`, and nothing here opens a second PR.
//
// Contract 2.0.0 adds an IDENTITY to a preparation — `preparation_id`, `generation` and
// `preparation_digest` — because content and contract were the only things an approval named,
// and the artifact record is in neither. An approval therefore kept matching across a reopening
// that replaced exactly that record. Authority itself lives in `lib/lifecycle.mjs`; this file
// builds and reads the documents.

import { createHash } from 'node:crypto';
import { normalisedHashes } from './digest.mjs';
import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import {
  PREP_CONTRACT_VERSION, preparationDigest, newPreparationId,
  approvalsInForce, currentPath, snapshotPath,
} from './lifecycle.mjs';

export { PREP_CONTRACT_VERSION, approvalsInForce, newPreparationId, preparationDigest };

/** Where the current preparation lives. Inside `.spectree/`, which every digest already
 *  excludes — so it is not part of the candidate it describes, and cannot be part of its own
 *  identity. */
export const manifestPath = (changeId) => currentPath(changeId);
export { snapshotPath };

const posix = (s) => String(s).split('\\').join('/');

const refuse = (code, message, detail) => ({ ok: false, code, message, ...(detail ? { detail } : {}) });

/**
 * What the consumer offers for consolidating a spec delta into the living spec. It is the
 * consumer's mechanism, declared by the consumer: nothing here edits `docs/specs/` by hand,
 * ever, because a spec written by the tool that also approves it proves nothing.
 *
 * @returns {{ ok: true, command: string[] } | { ok: false, code, message }}
 */
export function consolidationCommand(project) {
  const declared = project?.closure?.consolidate;
  if (!declared) {
    return refuse('E_NO_CONSOLIDATION',
      'this project declares no spec consolidation command (`closure.consolidate` in .spectree/project.json), ' +
      'so the delta cannot be merged into the living spec by any mechanism this squad is allowed to use. ' +
      'Hand-editing docs/specs/ is not the fallback — run the change through the legacy closure instead, ' +
      'and say in the report that it was legacy.');
  }
  // An array is the safe form and the one `state.mjs init -- …` writes. A string is accepted
  // for a hand-written project.json, and split on whitespace — which is why a path containing
  // a space has to be declared as an array.
  const command = Array.isArray(declared) ? declared : String(declared).split(/\s+/).filter(Boolean);
  if (command.length === 0) {
    return refuse('E_NO_CONSOLIDATION', '`closure.consolidate` is declared but empty, which is not a mechanism');
  }
  return { ok: true, command };
}

/**
 * Literal substitution of the two identities a consolidation command may need, per argument.
 *
 * `{change_id}` and `{change_dir}` and nothing else: no shell, no eval, no concatenation, no
 * guessing at a command from a convention. A declared command that names neither is passed
 * through untouched, which is what every existing project has.
 *
 * It exists because the folder MOVES. A command written for `docs/changes/<id>` cannot be
 * re-run once the preparation archived that folder, and a preparation that cannot be re-run is
 * one nobody can resume.
 */
export function resolveCommand(command, { changeId, changeDir }) {
  return command.map((arg) => String(arg)
    .split('{change_id}').join(changeId)
    .split('{change_dir}').join(posix(changeDir ?? '')));
}

/**
 * A stable identity for the command that was run, so a snapshot records WHICH consolidation
 * produced it rather than a retelling. Hashed rather than stored raw because a declared command
 * can carry an absolute path from the machine it was declared on.
 */
export const commandDigest = (command) =>
  `sha256:${createHash('sha256').update(JSON.stringify(command), 'utf8').digest('hex')}`;

/** Every file under a directory, repo-relative and sorted. Refuses what it cannot compare. */
function walk(dir, base, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) {
      const e = new Error(`"${posix(relative(base, abs))}" is a symbolic link, and an artifact record only speaks about files`);
      e.code = 'E_UNSUPPORTED_TYPE';
      throw e;
    }
    if (st.isDirectory()) walk(abs, base, out);
    else if (st.isFile()) out.push(posix(relative(base, abs)));
    else {
      const e = new Error(`"${posix(relative(base, abs))}" is not a regular file`);
      e.code = 'E_UNSUPPORTED_TYPE';
      throw e;
    }
  }
  return out;
}

/**
 * Is this a location a change may archive into?
 *
 * Absolute paths, traversal, and a folder belonging to another change are all refused. A
 * preparation that could name any path could point its own record at somebody else's files.
 */
export function validArchivePath(rel, changeId) {
  const p = posix(rel ?? '');
  if (!p) return refuse('E_PREP_MALFORMED', 'the preparation records no archive location');
  if (isAbsolute(p) || /^[A-Za-z]:/.test(p)) return refuse('E_PREP_PATH', `"${p}" is an absolute path, and an archive slot is repo-relative`);
  if (p.split('/').includes('..')) return refuse('E_PREP_PATH', `"${p}" traverses out of the repository`);
  const m = /^docs\/changes\/archive\/([^/]+)$/.exec(p);
  if (!m) return refuse('E_PREP_PATH', `"${p}" is not a slot under docs/changes/archive/`);
  const slot = m[1];
  if (slot !== changeId && !slot.endsWith(`-${changeId}`)) {
    return refuse('E_PREP_PATH', `"${p}" is the archive slot of another change, not of "${changeId}"`);
  }
  return { ok: true, dir: p };
}

/**
 * The artifacts a preparation produced, each with the digest of what it actually wrote.
 *
 * The digest is git's own blob hash, not a hash of the raw bytes, so that a later confirmation
 * can compare it against `<merge>:<path>` directly. Checking only that the file EXISTS in the
 * merge says nothing about whether it is the file that was prepared.
 */
export function artifactsUnder(root, dir, op) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  const st = lstatSync(abs);
  if (st.isSymbolicLink()) {
    const e = new Error(`"${posix(dir)}" is a symbolic link; an archive slot must be a real directory`);
    e.code = 'E_UNSUPPORTED_TYPE';
    throw e;
  }
  if (!st.isDirectory()) return [];
  const rels = walk(abs, abs);
  const paths = rels.map((rel) => posix(join(dir, rel)));
  const hashes = normalisedHashes(root, paths);
  return rels.map((rel, i) => ({
    path: paths[i],
    type: 'blob',
    op,
    digest: hashes[i],
  })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * One preparation snapshot. Immutable once approved; identified by `preparation_id` and pinned
 * by `preparation_digest`, which covers identity, contract, candidate, base, archive location
 * and the canonical artifact inventory — and deliberately excludes timestamps, so the same
 * preparation run twice is the same preparation.
 */
export function buildManifest({
  changeId, projectId, generation = 1, preparationId,
  baseRevision, contractDigest, candidateDigest, archivePath, archiveAbsentReason,
  artifacts = [], commands = [], blocking = [], deferred = [], preparedAt,
  consolidation = null, supersedesApproval = [],
}) {
  const snapshot = {
    manifest_version: PREP_CONTRACT_VERSION,
    project_id: projectId ?? null,
    change_id: changeId,
    generation,
    preparation_id: preparationId ?? newPreparationId(),
    base_revision: baseRevision,
    contract_digest: contractDigest,
    candidate_digest: candidateDigest,
    // Where the folder actually went. Recorded because it is not recomputable: the name carries
    // the date the preparation ran, and anything deriving it from `new Date()` later is asking
    // about a different folder the moment the clock passes midnight. A declared absence is an
    // assertion somebody made; it is never inferred from a read that failed.
    archive_path: archivePath ? posix(archivePath) : null,
    archive_absent_reason: archivePath ? null : (archiveAbsentReason ?? null),
    artifacts: [...artifacts].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    consolidation,
    commands,
    blocking,
    deferred,
    // The approvals a reopening replaced. This is a PROJECTION: the durable record lives in the
    // closure control, because a document that a restore can replace cannot be the only place a
    // retirement is written down.
    supersedes_approval: [...new Set(supersedesApproval)].sort(),
    prepared_at: preparedAt,
  };
  return { ...snapshot, preparation_digest: preparationDigest(snapshot) };
}

/**
 * Is an existing manifest the same preparation, a collision, or stale?
 *
 * Idempotent for the same candidate and the same contract. A manifest describing different
 * content is not "already done" — it is a preparation for something else sitting where this
 * one goes, and overwriting it silently would erase the record of what was approved.
 */
export function comparePreparation(existing, next) {
  if (!existing) return { state: 'new' };
  if (existing.manifest_version !== next.manifest_version) {
    return {
      state: 'incompatible',
      code: 'E_PREP_CONTRACT_VERSION',
      message: `the recorded preparation follows contract ${existing.manifest_version} and this build speaks ${next.manifest_version}`,
    };
  }
  if (existing.change_id !== next.change_id) {
    return { state: 'incompatible', code: 'E_PREP_COLLISION', message: `that manifest belongs to "${existing.change_id}"` };
  }
  const sameContract = existing.contract_digest === next.contract_digest;
  const sameCandidate = existing.candidate_digest === next.candidate_digest;
  if (sameContract && sameCandidate) return { state: 'unchanged' };
  return {
    state: 'stale',
    code: 'E_PREP_STALE',
    message: [
      !sameContract ? `the contract moved (prepared ${short(existing.contract_digest)}, now ${short(next.contract_digest)})` : null,
      !sameCandidate ? `the candidate moved (prepared ${short(existing.candidate_digest)}, now ${short(next.candidate_digest)})` : null,
    ].filter(Boolean).join('; '),
  };
}

const short = (d) => String(d ?? '').slice(0, 18);

/**
 * Where a recorded preparation put the change folder.
 *
 * Read off the record, never recomputed. The archive name is `<YYYY-MM-DD>-<change-id>`, so a
 * re-run on a later day computes a folder that does not exist — and a refresh that looked there
 * found nothing, wrote an EMPTY artifact list over the real one, and left the confirmation after
 * the merge comparing the merge against nothing at all.
 *
 * `archive_path` is authoritative. For a manifest written before that field existed the location
 * is derived from the artifacts themselves, and only when they agree on one: two folders, or
 * none, is an answer nobody can give, so it is refused rather than guessed.
 *
 * @returns {{ ok: true, dir: string } | { ok: false, code: string, message: string }}
 */
export function recordedArchive(manifest, changeId) {
  const id = changeId ?? manifest?.change_id;
  if (manifest?.archive_path) return validArchivePath(manifest.archive_path, id);
  if (manifest?.archive_absent_reason) {
    return refuse('E_PREP_NO_ARCHIVE', `the preparation declares no archive: ${manifest.archive_absent_reason}`);
  }
  const dirs = [...new Set(
    (manifest?.artifacts ?? [])
      .map((a) => /^(docs\/changes\/archive\/[^/]+)\//.exec(posix(String(a?.path ?? '')))?.[1])
      .filter(Boolean),
  )];
  if (dirs.length === 1) return validArchivePath(dirs[0], id);
  return refuse('E_PREP_MALFORMED', dirs.length
    ? `the preparation's artifacts span ${dirs.length} archive folders (${dirs.join(', ')}), so it records no single location`
    : 'the preparation records no archive location, and none can be derived from its artifacts');
}

/** Read one snapshot or the current projection, telling absence from corruption. */
export function readManifest(root, changeId, preparationId) {
  const f = join(root, preparationId ? snapshotPath(changeId, preparationId) : currentPath(changeId));
  if (!existsSync(f)) return { present: false, doc: null };
  let text;
  try { text = readFileSync(f, 'utf8'); }
  catch (e) { return { present: true, doc: null, code: 'E_PREP_UNREADABLE', message: `the preparation cannot be read (${e.code ?? e.message})` }; }
  try { return { present: true, doc: JSON.parse(text), bytes: text }; }
  catch { return { present: true, doc: null, code: 'E_PREP_CORRUPT', message: 'the preparation is not valid JSON; corrupt is not the same as absent' }; }
}

/**
 * A prepared closure is only proof for the candidate it was prepared against. An archived
 * folder is not proof: the folder says a move happened, the manifest says what was true when
 * it happened, and only the second one can be compared against what is on disk now.
 */
export function preparationCovers(manifest, { contractDigest, candidateDigest, changeId, generation } = {}) {
  if (!manifest) return refuse('E_PREP_MISSING', 'no closure preparation is on record for this change');

  // Identity and shape first. A manifest whose contract version this build does not speak, or
  // that belongs to another change, is not made acceptable by two digests happening to match —
  // the digests only mean anything once it is established that this document is the one being
  // talked about. The writer refuses to overwrite such a manifest, and the gate refuses to
  // read it: both halves, or the refusal is only half a refusal.
  if (manifest.manifest_version !== PREP_CONTRACT_VERSION) {
    return refuse('E_PREP_CONTRACT_VERSION',
      `the preparation follows contract ${manifest.manifest_version ?? '(none)'} and this build speaks ${PREP_CONTRACT_VERSION}. ` +
      'Run the closure migration explicitly; a v1 record is history, and history is not authority.');
  }
  if (changeId && manifest.change_id !== changeId) {
    return refuse('E_PREP_COLLISION', `that preparation belongs to "${manifest.change_id}", not to "${changeId}"`);
  }
  for (const field of ['change_id', 'base_revision', 'contract_digest', 'candidate_digest', 'prepared_at', 'preparation_id', 'preparation_digest']) {
    if (!manifest[field]) return refuse('E_PREP_MALFORMED', `the preparation records no ${field}`);
  }
  if (typeof manifest.generation !== 'number') return refuse('E_PREP_MALFORMED', 'the preparation records no generation');
  for (const field of ['artifacts', 'commands', 'blocking', 'deferred']) {
    if (!Array.isArray(manifest[field])) return refuse('E_PREP_MALFORMED', `the preparation's ${field} is not a list`);
  }
  // Its own identity has to hold: a snapshot edited by hand is not the snapshot that was pinned.
  const recomputed = preparationDigest(manifest);
  if (recomputed !== manifest.preparation_digest) {
    return refuse('E_PREP_TAMPERED',
      `the preparation does not digest to what it records (${short(manifest.preparation_digest)}… vs ${short(recomputed)}…); it was edited after it was written`);
  }
  if (manifest.archive_path) {
    const where = validArchivePath(manifest.archive_path, manifest.change_id);
    if (!where.ok) return where;
  } else if (!manifest.archive_absent_reason) {
    return refuse('E_PREP_MALFORMED',
      'the preparation records neither an archive location nor a declared reason for there being none; ' +
      'an absence that nobody asserted is indistinguishable from a read that failed');
  }

  if (manifest.blocking?.length) {
    return refuse('E_PREP_BLOCKED', `the preparation recorded ${manifest.blocking.length} blocking item(s): ${manifest.blocking.join('; ')}`);
  }
  if (generation !== undefined && generation !== null && Number(manifest.generation) !== Number(generation)) {
    return refuse('E_PREP_STALE',
      `the preparation is generation ${manifest.generation} and this change is at generation ${generation}; a reopening replaced it`);
  }
  if (manifest.contract_digest !== contractDigest) {
    return refuse('E_PREP_STALE', 'the contract changed after the closure was prepared, so the consolidation was computed from Requirements that are no longer the ones being integrated');
  }
  if (manifest.candidate_digest !== candidateDigest) {
    return refuse('E_PREP_STALE', 'the candidate changed after the closure was prepared; a fix after preparation invalidates it, and the same branch name is not the same content');
  }
  return { ok: true };
}

/**
 * Compare the frozen artifact inventory against what a tree actually carries.
 *
 * Three failures, told apart: missing, altered, and an ADDITION nobody recorded. The third one
 * used to be invisible — the comparison walked the record and asked whether each entry was
 * present, so a file appearing inside the archived folder during the merge passed unseen.
 *
 * @param {(path: string) => string|null} blobAt  the blob a tree holds at that path, or null
 */
export function compareArtifacts(manifest, blobAt, treePaths) {
  const recorded = manifest?.artifacts ?? [];
  const missing = [], altered = [];
  for (const a of recorded) {
    const blob = blobAt(a.path);
    if (blob === null || blob === undefined) missing.push(a.path);
    else if (blob !== a.digest) altered.push(a.path);
  }
  // Additions can only be judged where the caller can enumerate the tree; a caller that cannot
  // says so by passing nothing, and gets the two comparisons it can actually make.
  let added = [];
  if (treePaths) {
    const known = new Set(recorded.map((a) => a.path));
    const under = manifest?.archive_path ? `${posix(manifest.archive_path)}/` : null;
    added = under ? treePaths.filter((p) => p.startsWith(under) && !known.has(p)) : [];
  }
  const ok = missing.length === 0 && altered.length === 0 && added.length === 0;
  return {
    ok, missing, altered, added,
    message: ok
      ? `${recorded.length} artifact(s) present and identical`
      : [
        missing.length ? `${missing.length} missing (${missing.slice(0, 3).join(', ')})` : null,
        altered.length ? `${altered.length} altered (${altered.slice(0, 3).join(', ')})` : null,
        added.length ? `${added.length} added to the frozen set (${added.slice(0, 3).join(', ')})` : null,
      ].filter(Boolean).join('; '),
  };
}
