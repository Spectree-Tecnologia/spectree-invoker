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

/** The artifacts a preparation produced, each with the digest of what it actually wrote. */
export function artifactsUnder(root, dir, op) {
  const abs = join(root, dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
  return walk(abs, join(root, dir)).map((rel) => ({
    path: posix(join(dir, rel)),
    op,
    digest: `sha256:${createHash('sha256').update(readFileSync(join(abs, rel))).digest('hex')}`,
  }));
}

/**
 * The manifest. Compact on purpose: it is read by the next step and by a human deciding whether
 * to approve integration, and a manifest nobody reads is a file, not a control.
 */
export function buildManifest({
  changeId, baseRevision, contractDigest, candidateDigest,
  artifacts = [], commands = [], blocking = [], deferred = [], preparedAt,
}) {
  return {
    manifest_version: PREP_CONTRACT_VERSION,
    change_id: changeId,
    base_revision: baseRevision,
    contract_digest: contractDigest,
    candidate_digest: candidateDigest,
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
 * A prepared closure is only proof for the candidate it was prepared against. An archived
 * folder is not proof: the folder says a move happened, the manifest says what was true when
 * it happened, and only the second one can be compared against what is on disk now.
 */
export function preparationCovers(manifest, { contractDigest, candidateDigest }) {
  if (!manifest) return refuse('E_PREP_MISSING', 'no closure preparation is on record for this change');
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
