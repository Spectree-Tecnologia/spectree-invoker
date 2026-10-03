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
import { join, extname, resolve } from 'node:path';

const WIN = process.platform === 'win32';

/** Where Windows would actually find this command, following PATH and PATHEXT. */
export function resolveOnPath(file, { platform = process.platform, env = process.env, cwd = process.cwd() } = {}) {
  if (platform !== 'win32') return null;
  if (/[\\/]/.test(file)) { const path = resolve(cwd, file); return existsSync(path) ? path : null; }
  const dirs = (env.PATH ?? env.Path ?? '').split(';').filter(Boolean).map((d) => resolve(cwd, d));
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

/**
 * What cannot be carried through `cmd.exe` intact, whatever quoting is applied.
 *
 * `%` is expanded before quoting is even considered, so `literal%FOO%end` arrives as whatever
 * `FOO` holds; `!` is expanded too when delayed expansion is on, which a ComSpec with `/V:ON`
 * turns on for us. There is no escape for either on a command line — only inside a batch file —
 * so the honest answer is to refuse the argument and say why, rather than to deliver a
 * different one and let the run report on something nobody asked for.
 */
export function untransportable(arg) {
  if (arg.includes('%')) return 'contains "%", which cmd.exe expands as a variable before any quoting applies';
  if (arg.includes('!')) return 'contains "!", which cmd.exe expands when delayed expansion is enabled';
  if (arg.includes('"')) {
    return 'contains a double quote: a .cmd shim forwards its arguments with %*, so cmd.exe parses the line ' +
      'a second time, and `\\"` is a C runtime escape that cmd does not honour';
  }
  if (/[\r\n\0]/.test(arg)) return 'contains a newline or a NUL, which a command line cannot carry';
  return null;
}

/**
 * Quote one token so it arrives byte for byte. An empty argument must be `""` or it disappears
 * entirely, and a trailing run of backslashes must be doubled or it escapes the closing quote.
 * Anything that cannot survive the trip is refused rather than delivered as something else.
 */
export function quoteForCmd(s) {
  const why = untransportable(s);
  if (why) {
    const e = new Error(`${JSON.stringify(s)} cannot be quoted for cmd.exe: it ${why}`);
    e.code = 'E_ARGUMENT_UNTRANSPORTABLE';
    throw e;
  }
  if (s === '') return '""';
  if (!/[\s&|<>^()]/.test(s)) return s;
  return `"${s.replace(/(\\+)$/, '$1$1')}"`;
}

/**
 * Run a command as given. Returns whatever spawnSync returns, so the caller keeps deciding
 * what a status or an error means.
 */
export function launch(cmd, options = {}) {
  const [file, ...args] = cmd;
  if (!WIN) return spawnSync(file, args, { ...options, shell: false });

  const resolved = resolveOnPath(file, { env: options.env ?? process.env, cwd: options.cwd ?? process.cwd() });
  // Not found: spawn it anyway, so the failure is the real one and says the real name.
  if (!resolved) return spawnSync(file, args, { ...options, shell: false });

  if (/\.(cmd|bat)$/i.test(resolved)) {
    for (const a of args) {
      const why = untransportable(a);
      if (why) {
        const e = new Error(
          `the argument ${JSON.stringify(a)} cannot be passed to "${file}" on Windows: it ${why}. ` +
          'Invoke the underlying executable directly, or move the value into a file the command reads.');
        e.code = 'E_ARGUMENT_UNTRANSPORTABLE';
        throw e;
      }
    }
    const line = [resolved, ...args].map(quoteForCmd).join(' ');
    return spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${line}"`],
      { ...options, shell: false, windowsVerbatimArguments: true });
  }
  return spawnSync(resolved, args, { ...options, shell: false });
}
