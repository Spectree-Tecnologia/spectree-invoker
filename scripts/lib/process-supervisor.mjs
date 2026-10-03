// Synchronous facade; the independent supervisor owns the process boundary and watchdog.
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, openSync, closeSync, readSync, fstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { spawnSync } from 'node:child_process';
import { launchSpec } from './launch.mjs';
import { inside, refuse } from './work.mjs';

const lib = dirname(fileURLToPath(import.meta.url));
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
export function supervisedLaunch(command, options = {}) {
  const root = options.cwd ?? process.cwd();
  const relative = options.process_ref ?? `.spectree/processes/${randomUUID()}`;
  const dir = inside(root, relative); mkdirSync(dir, { recursive: true });
  const spec = launchSpec(command, options);
  const request = { version: 1, id: randomUUID(), host: hostname(), owner_pid: process.pid,
    file: spec.file, args: spec.args, verbatim: spec.options.windowsVerbatimArguments === true,
    cwd: root, timeout_ms: options.timeout ?? 300000, max_buffer: options.maxBuffer ?? 16 * 1024 * 1024,
    dir, platform: process.platform };
  writeFileSync(join(dir, 'request.json'), JSON.stringify(request), { flag: 'wx' });
  writeFileSync(join(dir, 'stdin'), options.input ?? '', { flag: 'wx' });
  const executable = process.platform === 'win32' ? powershell : process.execPath;
  const args = process.platform === 'win32'
    ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(lib, 'process-job.ps1'), join(dir, 'request.json')]
    : [join(lib, 'process-worker.mjs'), join(dir, 'request.json')];
  // No spawnSync timeout: it could kill the only supervisor before it records cleanup.
  // The independent worker enforces the deadline and detects a dead owner.
  const worker = spawnSync(executable, args, { cwd: root, env: options.env ?? process.env, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
  let receipt;
  try { receipt = read(join(dir, 'receipt.json')); } catch { /* fail closed */ }
  const quiescent = receipt?.state === 'stopped';
  const errorCode = !quiescent ? 'E_PROCESS_UNKNOWN' : receipt.error;
  const output = (name) => {
    const path = join(dir, name); if (!existsSync(path)) return '';
    const fd = openSync(path, 'r');
    try { const buffer = Buffer.alloc(Math.min(fstatSync(fd).size, request.max_buffer));
      const size = readSync(fd, buffer, 0, buffer.length, 0); return buffer.subarray(0, size).toString('utf8');
    } finally { closeSync(fd); }
  };
  return { status: receipt?.exit_code ?? null, signal: null,
    error: errorCode ? Object.assign(new Error(errorCode), { code: errorCode }) : worker.error,
    stdout: output('stdout'), stderr: output('stderr') || (worker.status !== 0 ? worker.stderr : ''),
    process: { ref: relative, quiescent, boundary: process.platform === 'win32' ? 'windows-job' : 'posix-process-group', receipt } };
}

// Operator testimony cannot override an active or unobservable managed process boundary.
export function inspectProcesses(root, relative) {
  const dir = inside(root, relative);
  if (!existsSync(dir)) refuse('E_PROCESS_UNKNOWN', 'Missing process receipts; inspect the interrupted launch.');
  const dirs = existsSync(join(dir, 'request.json')) ? [dir] : readdirSync(dir).map((n) => inside(root, `${relative}/${n}`));
  if (!dirs.length) refuse('E_PROCESS_UNKNOWN', 'No process receipt was persisted.');
  return dirs.map((d) => {
    let req, receipt;
    try { req = read(join(d, 'request.json')); receipt = read(join(d, 'receipt.json')); }
    catch { refuse('E_PROCESS_UNKNOWN', 'Incomplete process receipt; no automatic recovery.'); }
    if (req.host !== hostname() || req.platform !== process.platform || receipt.id !== req.id) refuse('E_PROCESS_UNKNOWN', 'Process receipt belongs to another host or launch.');
    if (receipt.state === 'stopped') return { id: req.id, stopped: true, observation: 'supervisor observed empty boundary' };
    if (process.platform === 'win32' && receipt.state === 'running') {
      const probe = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(lib, 'process-job.ps1'), join(d, 'request.json'), '-Inspect'],
        { encoding: 'utf8', windowsHide: true, timeout: 15000 });
      if (probe.status === 0 && probe.stdout.trim() === 'stopped') return { id: req.id, stopped: true, observation: 'job empty or destroyed after containment was recorded' };
    }
    refuse('E_PROCESS_ACTIVE', 'The managed process boundary is active or unobservable; recovery remains blocked.');
  });
}
