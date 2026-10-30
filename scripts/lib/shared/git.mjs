// One way to ask git for text. Output is captured whole (64 MiB) and stderr is piped, so a failure
// throws with git's own message instead of leaking it onto the caller's terminal.
import { execFileSync } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * The git executable, found only in absolute PATH entries outside the working tree. A bare
 * `git` with `cwd` in a project lets that project answer for git: a relative PATH entry such
 * as `.` resolves against it everywhere, and on Windows the current directory is searched
 * before PATH. A repository opened for reading must never choose the binary that reads it.
 */
const found = new Map();
export function gitExecutable(root, env = process.env) {
  const win = process.platform === 'win32';
  const tree = resolve(root);
  const key = `${tree}\0${env.PATH ?? env.Path ?? ''}\0${env.PATHEXT ?? ''}`;
  if (found.has(key)) return found.get(key);
  const names = win ? (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => `git${e.toLowerCase()}`) : ['git'];
  for (const dir of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;
    const rel = relative(tree, resolve(dir));
    if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)) continue;
    for (const name of names) {
      const file = join(dir, name);
      try {
        if (!statSync(file).isFile()) continue;
        if (!win) accessSync(file, constants.X_OK);
        else if (!['.exe', '.com'].includes(extname(file).toLowerCase())) continue;
        found.set(key, file);
        return file;
      } catch { /* not here */ }
    }
  }
  const e = new Error('git was not found in an absolute PATH entry outside the project');
  e.code = 'E_GIT_UNAVAILABLE';
  throw e;
}

/**
 * @param {string} root the working tree the command runs in
 * @param {string[]} args git's arguments
 * @param {import('node:child_process').ExecFileSyncOptions} [options] overrides, e.g. `{ input }`
 * @returns {string} stdout, untrimmed
 */
export function git(root, args, options = {}) {
  return execFileSync(gitExecutable(root, options.env), args, {
    cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...options,
  });
}
