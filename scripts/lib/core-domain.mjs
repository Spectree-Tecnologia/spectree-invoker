// Which modules serve the core domain, read from the project's own memory of the business.
//
// The core domain is the subdomain the product exists for, and it is where a wrong rule costs
// the most. So a change that touches a core module owes one more proof than any other: a
// mutation the suite killed. Where the classification lives is `docs/DOMAIN.md`, the file the
// Architect already keeps; this module only reads the one line that makes it countable.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LINE = /^\s*(?:[-*]\s*)?(?:\*\*)?Core modules?(?:\*\*)?\s*:\s*(.+)$/im;

/** The modules `docs/DOMAIN.md` names on its `Core modules:` line, or [] where it names none. */
export function coreModules(root) {
  const f = join(root, 'docs', 'DOMAIN.md');
  if (!existsSync(f)) return [];
  const m = LINE.exec(readFileSync(f, 'utf8'));
  if (!m) return [];
  return m[1].split(',').map((s) => s.replace(/[`*]/g, '').trim()).filter(Boolean);
}

/** The core modules this change names. A change that names no modules touches none it declared. */
export function coreModulesTouched(root, change) {
  const core = new Set(coreModules(root));
  return (change?.modules_named ?? []).filter((m) => core.has(m));
}
