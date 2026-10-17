// Refusals and path containment: infrastructure every module uses, owned by none of them.
import { lstatSync } from 'node:fs';
import { resolve, relative, isAbsolute, join } from 'node:path';

export function refuse(code, message) { throw Object.assign(new Error(message), { code }); }

/** Reject traversal and symlink/junction ancestors, for both reads and writes. */
export function inside(root, rel) {
  if (typeof rel !== 'string' || !rel || isAbsolute(rel) || /[:\0]/.test(rel)) refuse('E_WORK_PATH', 'Expected a repository-relative path.');
  const parts = rel.replaceAll('\\', '/').split('/');
  if (parts.some((p) => !p || p === '.' || p === '..')) refuse('E_WORK_PATH', 'Path traversal or empty segments are not allowed.');
  const base = resolve(root); const target = resolve(base, ...parts);
  const r = relative(base, target);
  if (!r || r.startsWith('..') || isAbsolute(r)) refuse('E_WORK_PATH', 'Path escapes the project.');
  let current = base;
  for (const part of ['', ...parts]) {
    if (part) current = join(current, part);
    let stat;
    try { stat = lstatSync(current); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (stat?.isSymbolicLink()) refuse('E_WORK_PATH', `Symlink/junction refused: ${current}`);
  }
  return target;
}
