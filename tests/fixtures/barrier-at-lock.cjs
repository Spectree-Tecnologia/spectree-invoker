// Hold this process at its FIRST attempt on a named lock, run something else until it reaches a
// named phase, and only then let it through.
//
// A barrier, not a sleep: the interleaving is the point, and a test that waits a fixed time proves
// whatever the machine's mood was that run. The hook fires BEFORE the lock is acquired, so the
// other process can take it — which is what makes the window real rather than simulated.
//
//   SPECTREE_BARRIER_LOCK   the lock path suffix to hold at
//   SPECTREE_BARRIER_ARGV   JSON argv of the process to run while held
//   SPECTREE_BARRIER_UNTIL  wait until the closure control shows this operation kind/phase
//   SPECTREE_BARRIER_OUT    where to record what was observed at the barrier
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const want = process.env.SPECTREE_BARRIER_LOCK;
const posix = (p) => String(p).split('\\').join('/');
const original = fs.openSync;
let fired = false;

fs.openSync = function openSync(path, ...rest) {
  if (!fired && want && posix(path).endsWith(want)) {
    fired = true;
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    delete env.SPECTREE_BARRIER_LOCK;
    const child = spawn(process.execPath, JSON.parse(process.env.SPECTREE_BARRIER_ARGV), {
      cwd: process.cwd(), env, stdio: 'ignore', windowsHide: true,
    });
    child.unref();
    const [kind, phase] = String(process.env.SPECTREE_BARRIER_UNTIL || 'reopen/started').split('/');
    const control = '.spectree/closure/c1.lifecycle.json';
    let seen = null;
    for (let i = 0; i < 2000; i++) {
      try { seen = JSON.parse(fs.readFileSync(control, 'utf8')); } catch { seen = null; }
      if (seen && seen.operation && seen.operation.kind === kind && seen.operation.phase === phase) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
    if (process.env.SPECTREE_BARRIER_OUT) {
      fs.writeFileSync(process.env.SPECTREE_BARRIER_OUT, JSON.stringify((seen && seen.operation) || null));
    }
  }
  return original.call(this, path, ...rest);
};
require('node:module').syncBuiltinESMExports();
