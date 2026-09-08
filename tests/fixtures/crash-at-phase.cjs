// Kill this process the moment the closure control reaches a named point.
//
// A REAL interruption: the child dies mid-sequence, exactly where a machine losing power would
// leave it. A test that simulates a crash by editing files afterwards is testing its own edit,
// and the phases exist precisely so that the difference is visible.
//
//   SPECTREE_CRASH_AT=<phase>        die when the operation records that phase
//   SPECTREE_CRASH_AT=receipt        die once the control points at a receipt (so the receipt
//                                    itself is already on disk, and the transitions are not)
const fs = require('node:fs');
const want = process.env.SPECTREE_CRASH_AT;
const original = fs.renameSync;
fs.renameSync = function renameSync(from, to, ...rest) {
  const result = original.call(this, from, to, ...rest);
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
require('node:module').syncBuiltinESMExports();
