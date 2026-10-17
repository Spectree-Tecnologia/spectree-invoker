// One way to ask git for text. Output is captured whole (64 MiB) and stderr is piped, so a failure
// throws with git's own message instead of leaking it onto the caller's terminal.
import { execFileSync } from 'node:child_process';

/**
 * @param {string} root the working tree the command runs in
 * @param {string[]} args git's arguments
 * @param {import('node:child_process').ExecFileSyncOptions} [options] overrides, e.g. `{ input }`
 * @returns {string} stdout, untrimmed
 */
export function git(root, args, options = {}) {
  return execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...options,
  });
}
