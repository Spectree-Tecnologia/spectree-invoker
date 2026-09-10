// Kill this process the moment the closure control reaches a named point, or the moment a named
// file's bytes land.
//
// A REAL interruption: the child dies mid-sequence, exactly where a machine losing power would
// leave it. A test that simulates a crash by editing files afterwards is testing its own edit,
// and the phases exist precisely so that the difference is visible.
//
//   SPECTREE_CRASH_AT=<phase>     die when the operation records that phase
//   SPECTREE_CRASH_AT=receipt     die once the control points at a receipt (so the receipt itself
//                                 is already on disk, and the transitions are not)
//   SPECTREE_CRASH_ON_WRITE=<s>   die once a path ending in <s> has been written — a boundary the
//                                 phases do not name, which is where a partial persistence lives
const fs = require('node:fs');
const want = process.env.SPECTREE_CRASH_AT;
const onWrite = process.env.SPECTREE_CRASH_ON_WRITE;
const posix = (p) => String(p).split('\\').join('/');

const originalRename = fs.renameSync;
fs.renameSync = function renameSync(from, to, ...rest) {
  const result = originalRename.call(this, from, to, ...rest);
  if (want && String(to).endsWith('.lifecycle.json')) {
    let doc = null;
    try { doc = JSON.parse(fs.readFileSync(to, 'utf8')); } catch { /* mid-write */ }
    if (doc) {
      const hit = want === 'receipt' ? Boolean(doc.receipt) : doc.operation && doc.operation.phase === want;
      if (hit) process.exit(86);
    }
  }
  return result;
};

if (onWrite) {
  const originalWrite = fs.writeFileSync;
  fs.writeFileSync = function writeFileSync(path, ...rest) {
    const result = originalWrite.call(this, path, ...rest);
    if (posix(path).endsWith(onWrite)) process.exit(86);
    return result;
  };
}
require('node:module').syncBuiltinESMExports();
