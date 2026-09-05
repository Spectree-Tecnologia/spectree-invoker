// The digest of what is actually on the table at a gate.
//
// It is computed from the artifact as it stands NOW, and it never reads the approval —
// copying the approved digest forward would make the comparison agree with itself, which
// is the one thing this check exists to prevent.
//
// The artifact submitted to a gate is the change folder: the proposal, and the delta when
// there is one. Code moving under an unchanged proposal is caught by the other half of the
// binding — an approval expires with the revision unless it says otherwise.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const posix = (s) => s.split('\\').join('/');

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, base, out);
    else out.push(posix(relative(base, abs)));
  }
  return out;
}

/**
 * @returns {{ digest: string, source: string, files: number }}
 */
export function artifactDigest(root, change, { artifactsDir } = {}) {
  const dir = artifactsDir ?? join(root, 'docs', 'changes', change.change_id);
  const h = createHash('sha256');

  if (existsSync(dir) && statSync(dir).isDirectory()) {
    const files = walk(dir).sort();
    if (files.length) {
      for (const rel of files) {
        h.update(rel, 'utf8'); h.update('\0');
        h.update(readFileSync(join(dir, rel))); h.update('\0');
      }
      return { digest: `sha256:${h.digest('hex')}`, source: posix(relative(root, dir)) || '.', files: files.length };
    }
  }

  // No folder, or an empty one: what was submitted is the scope the change itself declares.
  // Digesting that is still a digest of the artifact, and it still changes when the artifact does.
  h.update(JSON.stringify({
    scope: change.scope,
    deltaless: change.deltaless === true,
    named_absences: change.named_absences ?? [],
    modules_named: change.modules_named ?? [],
    allowed_paths: [...(change.allowed_paths ?? [])].sort(),
  }), 'utf8');
  return { digest: `sha256:${h.digest('hex')}`, source: "the change's declared scope (no change folder on disk)", files: 0 };
}
