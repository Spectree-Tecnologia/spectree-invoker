// POSIX process-group watchdog. Detached sessions/remote jobs are outside this boundary.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, openSync, closeSync, statSync } from 'node:fs';
import { join } from 'node:path';
const r = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const receipt = (state, pid, exit_code = null, error = null) => {
  const path = join(r.dir, 'receipt.json');
  writeFileSync(`${path}.tmp`, JSON.stringify({ id: r.id, state, pid, exit_code, error })); renameSync(`${path}.tmp`, path);
};
const fds = ['stdin', 'stdout', 'stderr'].map((n, i) => openSync(join(r.dir, n), i ? 'w' : 'r'));
const child = spawn(r.file, r.args, { cwd: r.cwd, env: process.env, detached: true, stdio: fds });
fds.forEach(closeSync);
let finished = false;
const alive = () => { try { process.kill(-child.pid, 0); return true; } catch(e) { return e.code !== 'ESRCH'; } };
async function finish(code, error) {
  if (finished) return; finished = true; clearInterval(watch);
  if (!error && ['stdout', 'stderr'].some((n) => statSync(join(r.dir, n)).size > r.max_buffer)) error = 'ENOBUFS';
  if (child.pid) {
    if (!error) for (let i = 0; i < 10 && alive(); i++) await new Promise((resolve) => setTimeout(resolve, 50));
    if (!error && alive()) error = 'E_PROCESS_DESCENDANTS';
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* inspect below */ }
    for (let i = 0; i < 100 && alive(); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  receipt(child.pid && alive() ? 'unknown' : 'stopped', child.pid ?? null, code, error);
}
const began = Date.now();
const watch = setInterval(() => {
  try { process.kill(r.owner_pid, 0); } catch (e) { if(e.code === 'ESRCH') { finish(null, 'E_OWNER_EXIT'); return; } }
  if (Date.now() - began >= r.timeout_ms) finish(null, 'ETIMEDOUT');
  else if (['stdout', 'stderr'].some((n) => statSync(join(r.dir, n)).size > r.max_buffer)) finish(null, 'ENOBUFS');
}, 30);
child.on('spawn', () => receipt('running', child.pid));
child.on('error', () => finish(null, 'E_PROCESS_LAUNCH'));
child.on('exit', (code, signal) => finish(code, signal ? 'E_PROCESS_SIGNAL' : null));
