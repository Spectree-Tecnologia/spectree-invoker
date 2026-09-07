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

import { createHash } from 'node:crypto';
import { normalisedHashes } from './digest.mjs';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const PREP_CONTRACT_VERSION = '1.0.0';

/** Where the manifest lives. Inside `.spectree/`, which every digest already excludes — so the
 *  manifest is not part of the candidate it describes, and cannot be part of its own identity. */
export const manifestPath = (changeId) => join('.spectree', 'closure', `${changeId}.json`);

const posix = (s) => s.split('\\').join('/');

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

/** Every file under a directory, repo-relative and sorted. */
function walk(dir, base, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, base, out);
    else out.push(posix(relative(base, abs)));
  }
  return out;
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
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
  const rels = walk(abs, abs);
  const hashes = normalisedHashes(root, rels.map((rel) => posix(join(dir, rel))));
  return rels.map((rel, i) => ({ path: posix(join(dir, rel)), op, digest: hashes[i] }));
}


/**
 * The manifest. Compact on purpose: it is read by the next step and by a human deciding whether
 * to approve integration, and a manifest nobody reads is a file, not a control.
 */
export function buildManifest({
  changeId, baseRevision, contractDigest, candidateDigest, archivePath,
  artifacts = [], commands = [], blocking = [], deferred = [], preparedAt,
  supersedesApproval = [],
}) {
  return {
    manifest_version: PREP_CONTRACT_VERSION,
    change_id: changeId,
    base_revision: baseRevision,
    contract_digest: contractDigest,
    candidate_digest: candidateDigest,
    // Where the folder actually went. Recorded because it is not recomputable: the name carries
    // the date the preparation ran, and anything that derives it from `new Date()` later is
    // asking about a different folder the moment the clock passes midnight.
    ...(archivePath ? { archive_path: posix(archivePath) } : {}),
    // The approvals this preparation replaced. An integration approval named here was granted
    // over a record that no longer exists, so it cannot authorise this one: a reopening that
    // left the old approval usable would be a substitution wearing a reopening's clothes.
    ...(supersedesApproval.length ? { supersedes_approval: [...supersedesApproval].sort() } : {}),
    artifacts,
    commands,
    blocking,
    deferred,
    prepared_at: preparedAt,
  };
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
export function recordedArchive(manifest) {
  if (manifest?.archive_path) return { ok: true, dir: posix(manifest.archive_path) };
  const dirs = [...new Set(
    (manifest?.artifacts ?? [])
      .map((a) => /^(docs\/changes\/archive\/[^/]+)\//.exec(posix(String(a?.path ?? '')))?.[1])
      .filter(Boolean),
  )];
  if (dirs.length === 1) return { ok: true, dir: dirs[0] };
  return refuse('E_PREP_MALFORMED', dirs.length
    ? `the preparation's artifacts span ${dirs.length} archive folders (${dirs.join(', ')}), so it records no single location`
    : 'the preparation records no archive location, and none can be derived from its artifacts');
}

/**
 * A prepared closure is only proof for the candidate it was prepared against. An archived
 * folder is not proof: the folder says a move happened, the manifest says what was true when
 * it happened, and only the second one can be compared against what is on disk now.
 */
export function preparationCovers(manifest, { contractDigest, candidateDigest, changeId }) {
  if (!manifest) return refuse('E_PREP_MISSING', 'no closure preparation is on record for this change');

  // Identity and shape first. A manifest whose contract version this build does not speak, or
  // that belongs to another change, is not made acceptable by two digests happening to match —
  // the digests only mean anything once it is established that this document is the one being
  // talked about. The writer refuses to overwrite such a manifest, and the gate refuses to
  // read it: both halves, or the refusal is only half a refusal.
  if (manifest.manifest_version !== PREP_CONTRACT_VERSION) {
    return refuse('E_PREP_CONTRACT_VERSION',
      `the preparation follows contract ${manifest.manifest_version ?? '(none)'} and this build speaks ${PREP_CONTRACT_VERSION}`);
  }
  if (changeId && manifest.change_id !== changeId) {
    return refuse('E_PREP_COLLISION', `that preparation belongs to "${manifest.change_id}", not to "${changeId}"`);
  }
  for (const field of ['change_id', 'base_revision', 'contract_digest', 'candidate_digest', 'prepared_at']) {
    if (!manifest[field]) return refuse('E_PREP_MALFORMED', `the preparation records no ${field}`);
  }
  for (const field of ['artifacts', 'commands', 'blocking', 'deferred']) {
    if (!Array.isArray(manifest[field])) return refuse('E_PREP_MALFORMED', `the preparation's ${field} is not a list`);
  }

  if (manifest.blocking?.length) {
    return refuse('E_PREP_BLOCKED', `the preparation recorded ${manifest.blocking.length} blocking item(s): ${manifest.blocking.join('; ')}`);
  }
  if (manifest.contract_digest !== contractDigest) {
    return refuse('E_PREP_STALE', 'the contract changed after the closure was prepared, so the consolidation was computed from Requirements that are no longer the ones being integrated');
  }
  if (manifest.candidate_digest !== candidateDigest) {
    return refuse('E_PREP_STALE', 'the candidate changed after the closure was prepared; a fix after preparation invalidates it, and the same branch name is not the same content');
  }
  return { ok: true };
}
