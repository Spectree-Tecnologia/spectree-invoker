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

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
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
 */
function normalisedHashes(root, relPaths) {
  if (relPaths.length === 0) return [];
  const bad = relPaths.find((p) => /[\r\n]/.test(p));
  if (bad) throw unavailable(`"${posix(bad)}" contains a newline, and no path list can carry that unambiguously`);
  const absPaths = relPaths.map((p) => join(root, p));
  try {
    const out = execFileSync('git', ['hash-object', '--stdin-paths'], {
      cwd: root, encoding: 'utf8', input: `${absPaths.join('\n')}\n`,
      stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
    }).split(/\r?\n/).filter(Boolean);
    if (out.length === absPaths.length) return out;
    throw unavailable(`git hashed ${out.length} of ${absPaths.length} file(s); a partial answer is not an answer`);
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
  const git = (args, input) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  });
  const exclude = OPERATIONAL.map((p) => `:(exclude)${p}`);
  let revision, tree, paths, dirty;
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
    dirty = git(['status', '--porcelain', '-z', '--', '.', ...exclude]).length > 0;
  } catch (e) {
    throw unavailable(`the content under ${root} cannot be determined`, e.message);
  }

  // Content identity is git's own, asked per path for the file as it stands in the work tree.
  //
  // Two earlier answers were both wrong, in opposite directions. Hashing tree entries plus a
  // patch made the same bytes digest differently before and after a commit, so committing
  // finished work invalidated the evidence and the closure preparation covering it — friction
  // with no safety in it. Hashing the bytes on disk made the digest depend on the platform's
  // line-ending conversion, so the same commit checked out on Windows was "different content".
  // `git hash-object` applies the repository's own normalisation, which is the only definition
  // of "the same content" that both ends of a merge can agree on.
  const present = paths.filter((p) => existsSync(join(root, p)));
  const blobs = normalisedHashes(root, present);
  const byPath = new Map(present.map((p, i) => [p, blobs[i]]));
  const h = createHash('sha256');
  for (const rel of paths) {
    h.update(rel, 'utf8'); h.update('\0');
    // A tracked path that is not on disk is a deletion: a legitimate state, and not a read
    // failure to be papered over with a placeholder two versions could share.
    h.update(byPath.get(rel) ?? '<deleted>', 'utf8'); h.update('\0');
  }
  return { digest: sha(h), revision, tree, dirty };
}

/** What an integration-class gate authorises: the contract AND the code it will carry. */
export const gatedDigest = (contract, content) =>
  sha(createHash('sha256').update(`${contract}\n${content}`, 'utf8'));
