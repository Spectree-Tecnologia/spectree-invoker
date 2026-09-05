// Two digests, because a gate asks two different questions.
//
//   contractDigest — what the Founder approved: the proposal and the delta.
//   contentDigest  — what a check actually ran against: the commit PLUS the working tree.
//
// Neither is ever read out of an approval or a piece of evidence. Copying the recorded
// digest forward would make the comparison agree with itself, which is the one thing
// these checks exist to prevent.
//
// The split matters in both directions. Binding a scope approval to the whole change
// folder made ticking a checkbox in `tasks.md` revoke it — progress is not scope. And
// binding evidence to `HEAD` alone made an uncommitted edit invisible: the revision was
// the same, so a run from before the edit still counted for a gate after it.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const posix = (s) => s.split('\\').join('/');

/**
 * The squad's own bookkeeping. It changes constantly, on its own writes, and it is never
 * what a check measured — so it is outside both digests. Every other file counts.
 */
export const OPERATIONAL = ['.spectree', 'docs/changes/*/tasks.md'];

/**
 * The contractual half of a change folder, as a positive allowlist. Anything not named
 * here is operational: it may change all day without touching what was approved.
 */
export const CONTRACT = (rel) => rel === 'proposal.md' || rel.startsWith('specs/');

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, base, out);
    else out.push(posix(relative(base, abs)));
  }
  return out;
}

const sha = (h) => `sha256:${h.digest('hex')}`;

/**
 * What the human approved: `proposal.md` and the delta under `specs/`.
 * @returns {{ digest: string, source: string, files: string[] }}
 */
export function contractDigest(root, change, { artifactsDir } = {}) {
  const dir = artifactsDir ?? join(root, 'docs', 'changes', change.change_id);
  const h = createHash('sha256');

  if (existsSync(dir) && statSync(dir).isDirectory()) {
    const files = walk(dir).filter(CONTRACT).sort();
    if (files.length) {
      for (const rel of files) {
        h.update(rel, 'utf8'); h.update('\0');
        h.update(readFileSync(join(dir, rel))); h.update('\0');
      }
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
 * The content a check would run against right now: the commit, plus every uncommitted
 * change to anything that is not the squad's own bookkeeping.
 *
 * An unavailable comparison is unknown, never "nothing changed" — so this throws rather
 * than returning a digest it cannot stand behind.
 * @returns {{ digest: string, revision: string, dirty: boolean }}
 */
export function contentDigest(root) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  let revision, patch, untracked;
  try {
    revision = git(['rev-parse', 'HEAD']).trim();
    const exclude = OPERATIONAL.map((p) => `:(exclude)${p}`);
    patch = git(['diff', 'HEAD', '--', '.', ...exclude]);
    untracked = git(['ls-files', '--others', '--exclude-standard', '--', '.', ...exclude])
      .split('\n').map((s) => s.trim()).filter(Boolean).sort();
  } catch (e) {
    const err = new Error(
      `the content under ${root} cannot be determined (${e.message.trim().split('\n')[0]}); ` +
      'an unavailable comparison is unknown, not unchanged');
    err.code = 'E_CONTENT_UNAVAILABLE';
    throw err;
  }

  const h = createHash('sha256');
  h.update(revision, 'utf8'); h.update('\0');
  h.update(patch, 'utf8'); h.update('\0');
  for (const rel of untracked) {
    h.update(rel, 'utf8'); h.update('\0');
    try { h.update(readFileSync(join(root, rel))); } catch { h.update('<unreadable>', 'utf8'); }
    h.update('\0');
  }
  return { digest: sha(h), revision, dirty: patch.length > 0 || untracked.length > 0 };
}

/** What an integration-class gate authorises: the contract AND the code it will carry. */
export const gatedDigest = (contract, content) =>
  sha(createHash('sha256').update(`${contract}\n${content}`, 'utf8'));
