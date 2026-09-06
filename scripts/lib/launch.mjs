// Running the operator's command, on the platform the operator is actually on.
//
// On Windows the things people type — `npm`, `npx`, `pnpm`, `yarn` — are not executables.
// They are `.cmd` shims, and since the CVE-2024-27980 fix Node refuses to spawn one without
// a shell, so `spawnSync('npm', ...)` fails with a spawn error. Reading that as INFRA_ERROR
// is technically true and operationally useless: the command exists and the operator can run
// it in their own terminal.
//
// The fix is to resolve the launcher and run it deliberately, not to switch `shell: true` on
// for every string. `shell: true` hands the whole command line back to the interpreter, and
// then every argument that contains a space, a quote or an `&` means something else.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const WIN = process.platform === 'win32';

/** Where Windows would actually find this command, following PATH and PATHEXT. */
export function resolveOnPath(file, { platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return null;
  if (/[\\/]/.test(file)) return existsSync(file) ? file : null;
  const dirs = (env.PATH ?? env.Path ?? '').split(';').filter(Boolean);
  if (extname(file)) {
    for (const d of dirs) if (existsSync(join(d, file))) return join(d, file);
    return null;
  }
  const exts = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  for (const d of dirs) {
    for (const e of exts) {
      const p = join(d, file + e.toLowerCase());
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** Quote one token for `cmd.exe`. Conservative: anything unusual gets quoted. */
const quote = (s) => (/[\s"&|<>^()%!]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

/**
 * Run a command as given. Returns whatever spawnSync returns, so the caller keeps deciding
 * what a status or an error means.
 */
export function launch(cmd, options = {}) {
  const [file, ...args] = cmd;
  if (!WIN) return spawnSync(file, args, { ...options, shell: false });

  const resolved = resolveOnPath(file);
  // Not found: spawn it anyway, so the failure is the real one and says the real name.
  if (!resolved) return spawnSync(file, args, { ...options, shell: false });

  if (/\.(cmd|bat)$/i.test(resolved)) {
    const line = [resolved, ...args].map(quote).join(' ');
    return spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${line}"`],
      { ...options, shell: false, windowsVerbatimArguments: true });
  }
  return spawnSync(resolved, args, { ...options, shell: false });
}
