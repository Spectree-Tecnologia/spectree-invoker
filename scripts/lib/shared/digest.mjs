// Two digests, because a gate asks two different questions.
//
//   contractDigest — what the Founder approved: the proposal and the delta.
//   contentDigest  — what a check actually ran against: the committed TREE plus every
//                    uncommitted change to it.
//
// Neither is ever read out of an approval or a piece of evidence. Copying the recorded
// digest forward would make the comparison agree with itself, which is the one thing
// these checks exist to prevent.
//
// The unit of "content" is the tree, not the commit. A `--no-ff` merge writes a new commit
// over an identical tree: the code being integrated is the code that was reviewed, and a
// digest built on the commit sha would call that a different candidate and demand the whole
// gate again. A commit that changes the tree is a different candidate, and that one is
// exactly what must be caught.

import { git as gitIn } from './git.mjs';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, statSync, lstatSync } from 'node:fs';
import { join, relative } from 'node:path';

const posix = (s) => s.split('\\').join('/');

/**
 * The squad's own bookkeeping. It changes on the squad's own writes — a state file, a ticked
 * task, a change folder moved to the archive — and none of that is what a check measured.
 * `docs/changes/` is here in full: its contractual half is covered by the contract digest,
 * and covering it twice would make archiving a change look like changing the code.
 */
export const OPERATIONAL = ['.spectree', 'docs/changes'];

/**
 * The contractual half of a change folder, as a positive allowlist. Anything not named here
 * is operational: it may change all day without touching what was approved.
 */
export const CONTRACT = (rel) => rel === 'proposal.md' || rel.startsWith('specs/');

const excluded = (p) => OPERATIONAL.some((e) => p === e || p.startsWith(`${e}/`));

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, base, out);
    else out.push(posix(relative(base, abs)));
  }
  return out;
}

const sha = (h) => `sha256:${h.digest('hex')}`;

const unavailable = (message, cause) => {
  const e = new Error(`${message}${cause ? ` (${String(cause).trim().split('\n')[0]})` : ''}`);
  e.code = 'E_CONTENT_UNAVAILABLE';
  return e;
};

/**
 * One content hash per file, the way the repository itself would store it.
 *
 * `git hash-object` applies the repo's own line-ending and filter rules, so the same file
 * digests identically whether it was just written or checked out on a platform that converts
 * line endings. Where git cannot answer — no repository, no git — it falls back to the raw
 * bytes, which is consistent within that project and is the only thing left to be consistent
 * about. The two are never mixed inside one digest.
 *
 * A tracked file git itself reports unmodified is answered with the blob already in the index.
 * `hash-object` does not consult the index, so under `core.autocrlf=true` — Git for Windows'
 * default — it converted CRLF to LF even for a file the repository stores WITH CRLF, and the
 * checkout and the merge tree named the same bytes differently. `ls-files -m` decides
 * "unmodified" with the index in hand, the same way `git status` does.
 */
export function normalisedHashes(root, relPaths) {
  if (relPaths.length === 0) return [];
  const bad = relPaths.find((p) => /[\r\n]/.test(p));
  if (bad) throw unavailable(`"${posix(bad)}" contains a newline, and no path list can carry that unambiguously`);
  const absPaths = relPaths.map((p) => join(root, p));
  try {
    const git = (args, input) => gitIn(root, args, { input });
    const indexed = new Map(git(['ls-files', '-s', '-z']).split('\0').filter(Boolean).map((line) => {
      const tab = line.indexOf('\t');
      return [line.slice(tab + 1), line.slice(0, tab).split(' ')[1]];
    }));
    for (const p of git(['ls-files', '-m', '-z']).split('\0')) indexed.delete(p);
    // ponytail: a MODIFIED file stored with CRLF still goes through hash-object and digests as LF;
    // it is uncommitted, so no merge tree is compared against it until it is committed.
    const rel = relPaths.map(posix);
    const ask = rel.filter((p) => !indexed.has(p));
    const out = ask.length
      ? git(['hash-object', '--stdin-paths'], `${ask.map((p) => join(root, p)).join('\n')}\n`).split(/\r?\n/).filter(Boolean)
      : [];
    if (out.length !== ask.length) {
      throw unavailable(`git hashed ${out.length} of ${ask.length} file(s); a partial answer is not an answer`);
    }
    const hashed = new Map(ask.map((p, i) => [p, out[i]]));
    return rel.map((p) => indexed.get(p) ?? hashed.get(p));
  } catch (e) {
    if (e.code === 'E_CONTENT_UNAVAILABLE') throw e;
    return absPaths.map((p, i) => {
      try { return `raw:${createHash('sha256').update(readFileSync(p)).digest('hex')}`; }
      catch (err) { throw unavailable(`"${posix(relPaths[i])}" is part of the content and cannot be read`, err.message); }
    });
  }
}

/** Where the change folder is now: open, or already moved into the archive. */
function changeFolder(root, changeId) {
  const open = join(root, 'docs', 'changes', changeId);
  if (existsSync(open) && statSync(open).isDirectory()) return open;
  const archive = join(root, 'docs', 'changes', 'archive');
  if (!existsSync(archive)) return null;
  const hits = readdirSync(archive).filter((d) => d === changeId || d.endsWith(`-${changeId}`)).sort();
  if (hits.length > 1) {
    throw unavailable(`"${changeId}" is archived more than once (${hits.join(', ')}); which one is the contract cannot be decided here`);
  }
  return hits.length ? join(archive, hits[0]) : null;
}

/**
 * What the human approved: `proposal.md` and the delta under `specs/`. Archiving the change
 * moves those files; it does not change them, and the digest follows them.
 * @returns {{ digest: string, source: string, files: string[] }}
 */
export function contractDigest(root, change, { artifactsDir } = {}) {
  const dir = artifactsDir ?? changeFolder(root, change.change_id);
  const h = createHash('sha256');

  if (dir && existsSync(dir) && statSync(dir).isDirectory()) {
    const files = walk(dir).filter(CONTRACT).sort();
    if (files.length) {
      // Normalised the same way the content digest is, and for the same reason: archiving the
      // change writes these files, and checking the branch out again re-materialises them with
      // the platform's line endings. Raw bytes made that read as a changed contract.
      const hashes = normalisedHashes(root, files.map((rel) => posix(relative(root, join(dir, rel)))));
      files.forEach((rel, i) => {
        h.update(rel, 'utf8'); h.update('\0');
        h.update(hashes[i], 'utf8'); h.update('\0');
      });
      return { digest: sha(h), source: posix(relative(root, dir)) || '.', files };
    }
  }

  // No contractual file on disk: what was submitted is the scope the change itself declares.
  h.update(JSON.stringify({
    scope: change.scope,
    deltaless: change.deltaless === true,
    named_absences: change.named_absences ?? [],
    modules_named: change.modules_named ?? [],
    allowed_paths: [...(change.allowed_paths ?? [])].sort(),
  }), 'utf8');
  return { digest: sha(h), source: "the change's declared scope (no contractual file on disk)", files: [] };
}

/** Is this tree path the change's contract folder, open or archived? */
const contractPathIn = (path, changeId) => {
  const open = `docs/changes/${changeId}/`;
  if (path.startsWith(open)) return path.slice(open.length);
  const m = /^docs\/changes\/archive\/([^/]+)\/(.*)$/.exec(path);
  if (m && (m[1] === changeId || m[1].endsWith(`-${changeId}`))) return m[2];
  return null;
};

/**
 * The contract as it stands IN a commit — the merge, say.
 *
 * `docs/changes/` is outside the content digest on purpose, so a merge that quietly rewrote a
 * proposal changes nothing the code digest can see. Reading the contract from the local checkout
 * then answers a question about the operator's disk, not about what was integrated: a merge that
 * flipped "reject an invalid account" to "accept" would close clean. The contract has to be read
 * from the same immutable tree the code is read from.
 *
 * @returns {{ digest: string, source: string, files: string[] }}
 */
export function contractDigestAt(root, revision, change) {
  const git = (args) => gitIn(root, args);
  let entries;
  try {
    entries = git(['ls-tree', '-r', '-z', revision]).split('\0').filter(Boolean).map((line) => {
      const tab = line.indexOf('\t');
      const [mode, type, blob] = line.slice(0, tab).split(/\s+/);
      return { mode, type, blob, path: line.slice(tab + 1) };
    });
  } catch (e) {
    throw unavailable(`the contract in ${revision} cannot be read here`, String(e.stderr || e.message));
  }

  const found = [];
  for (const e of entries) {
    const rel = contractPathIn(e.path, change.change_id);
    if (rel === null || !CONTRACT(rel)) continue;
    if (e.type !== 'blob') throw unavailable(`"${e.path}" in ${revision} is a ${e.type}, not a file`);
    found.push({ rel, blob: e.blob, path: e.path });
  }
  found.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const h = createHash('sha256');
  if (found.length) {
    // The same shape as `contractDigest`: the path inside the change folder, then git's own
    // content hash. That is what makes a checkout and a commit comparable at all.
    for (const f of found) { h.update(f.rel, 'utf8'); h.update('\0'); h.update(f.blob, 'utf8'); h.update('\0'); }
    return { digest: sha(h), source: found[0].path.slice(0, found[0].path.length - found[0].rel.length - 1), files: found.map((f) => f.rel) };
  }

  h.update(JSON.stringify({
    scope: change.scope,
    deltaless: change.deltaless === true,
    named_absences: change.named_absences ?? [],
    modules_named: change.modules_named ?? [],
    allowed_paths: [...(change.allowed_paths ?? [])].sort(),
  }), 'utf8');
  return { digest: sha(h), source: `${revision.slice(0, 8)}: no contractual file in that tree`, files: [] };
}

/**
 * The content a check would run against right now: the committed tree, plus every
 * uncommitted change to anything that is not the squad's own bookkeeping.
 *
 * An unavailable comparison is unknown, never "nothing changed" — so every failure here
 * throws. A file that is present and cannot be read is the sharpest case: hashing a
 * placeholder in its place would give two different versions of it the same digest.
 * @returns {{ digest: string, revision: string, tree: string, dirty: boolean }}
 */
export function contentDigest(root) {
  const git = (args, input) => gitIn(root, args, { input });
  const exclude = OPERATIONAL.map((p) => `:(exclude)${p}`);
  let revision, tree, paths, indexModes, dirty;
  try {
    revision = git(['rev-parse', 'HEAD']).trim();
    tree = git(['rev-parse', 'HEAD^{tree}']).trim();
    // Every file in scope, tracked or not, ignored files excluded. -z everywhere: git quotes and
    // escapes non-ASCII paths in its default output, and a path read back through that escaping
    // is not the path on disk.
    paths = [...new Set(
      git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.', ...exclude])
        .split('\0').filter(Boolean),
    )].filter((p) => !excluded(p)).sort();
    // The mode git tracks, which is what a merge carries. Windows has no executable bit on the
    // filesystem, so asking the filesystem would answer a different question from the one the
    // other side of the merge is answering.
    indexModes = new Map(
      git(['ls-files', '-s', '-z', '--', '.', ...exclude]).split('\0').filter(Boolean).map((line) => {
        const tab = line.indexOf('\t');
        return [line.slice(tab + 1), line.slice(0, 6)];
      }),
    );
    dirty = git(['status', '--porcelain', '-z', '--', '.', ...exclude]).length > 0;
    // A conflicted index has more than one version of a path, so "the content" is not a
    // question with an answer yet. Digesting whichever stage happened to be on disk would
    // produce a number nobody could reproduce.
    if (git(['ls-files', '-u', '-z', '--', '.', ...exclude]).length > 0) {
      throw unavailable(`the index under ${root} has unmerged paths; resolve the conflict before anything is measured`);
    }
  } catch (e) {
    if (e.code === 'E_CONTENT_UNAVAILABLE') throw e;
    throw unavailable(`the content under ${root} cannot be determined`, e.message);
  }

  // Content identity is git's own, asked per path for the file as it stands in the work tree.
  //
  // Earlier answers were wrong in three ways, and all three are fixed by the same shape.
  // Hashing tree entries plus a patch made the same bytes digest differently before and after a
  // commit. Hashing the bytes on disk made the digest depend on the platform's line-ending
  // conversion. Hashing content without the mode let `chmod +x` — which changes what the file
  // DOES — pass as no change at all.
  //
  // So an entry is `path + mode + blob`, exactly what a tree entry is, and `contentDigestAt`
  // below produces the same shape from a commit. That is what makes a work tree and a merge
  // commit comparable at all.
  // Symlinks, sockets and anything else that is not a regular file are refused rather than
  // hashed: git stores a symlink as its TARGET STRING, so hashing one silently compares a
  // pointer with a file, and a junction on Windows has no honest reading at all.
  const present = [];
  for (const p of paths) {
    let st;
    try { st = lstatSync(join(root, p)); } catch { continue; }
    if (st.isSymbolicLink()) {
      throw unavailable(`"${p}" is a symbolic link, and this comparison only speaks about files`);
    }
    if (!st.isFile()) {
      throw unavailable(`"${p}" is not a regular file, and this comparison only speaks about files`);
    }
    present.push(p);
  }
  const blobs = normalisedHashes(root, present);
  const byPath = new Map(present.map((p, i) => [p, blobs[i]]));

  const h = createHash('sha256');
  // A path that is not on disk is simply not part of the content. Recording it as deleted made
  // the digest change again the moment the deletion was committed and the path left the index —
  // the same content, two answers, and evidence invalidated for nothing.
  for (const rel of present) {
    h.update(rel, 'utf8'); h.update('\0');
    h.update(modeOf(root, rel, indexModes), 'utf8'); h.update('\0');
    h.update(byPath.get(rel), 'utf8'); h.update('\0');
  }
  return { digest: sha(h), revision, tree, dirty };
}

/** The mode git records: the index for a tracked file, the filesystem for one it has not seen. */
function modeOf(root, rel, indexModes) {
  const tracked = indexModes.get(rel);
  if (tracked) return tracked;
  try { return (statSync(join(root, rel)).mode & 0o111) ? '100755' : '100644'; }
  catch { return '100644'; }
}

/**
 * The same digest, for a commit that is not checked out — the merge, say.
 *
 * Comparing a merge against the local checkout answers the wrong question: the checkout is
 * whatever the operator happens to have, and a post-merge confirmation that trusts it will
 * close a change over a tree nobody approved.
 *
 * @returns {{ digest: string, revision: string, tree: string }}
 */
export function contentDigestAt(root, revision) {
  const git = (args) => gitIn(root, args);
  let resolved, tree, entries;
  try {
    resolved = git(['rev-parse', `${revision}^{commit}`]).trim();
    tree = git(['rev-parse', `${revision}^{tree}`]).trim();
    entries = git(['ls-tree', '-r', '-z', resolved]).split('\0').filter(Boolean).map((line) => {
      const tab = line.indexOf('\t');
      const [mode, type, blob] = line.slice(0, tab).split(/\s+/);
      return { mode, type, blob, path: line.slice(tab + 1) };
    });
  } catch (e) {
    throw unavailable(`the content of ${revision} cannot be read here — fetch it before confirming a merge you cannot see`, String(e.stderr || e.message));
  }

  const h = createHash('sha256');
  for (const e of entries.filter((x) => !excluded(x.path)).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    // A submodule (`commit`) or a symlink is not a file whose bytes this can compare. Refusing
    // is the honest answer: unknown is never equivalence.
    if (e.type !== 'blob') {
      throw unavailable(`"${e.path}" in ${revision} is a ${e.type}, and this comparison only speaks about files`);
    }
    h.update(e.path, 'utf8'); h.update('\0');
    h.update(e.mode, 'utf8'); h.update('\0');
    h.update(e.blob, 'utf8'); h.update('\0');
  }
  return { digest: sha(h), revision: resolved, tree };
}

/** What an integration-class gate authorises: the contract AND the code it will carry. */
export const gatedDigest = (contract, content) =>
  sha(createHash('sha256').update(`${contract}\n${content}`, 'utf8'));
