#!/usr/bin/env node
// Prepare a change's closure on its own branch, before the merge.
//
//   node scripts/prepare-closure.mjs <change-id>              plan only, writes nothing
//   node scripts/prepare-closure.mjs <change-id> --apply
//   node scripts/prepare-closure.mjs <change-id> --json
//   node scripts/prepare-closure.mjs <change-id> --apply --reopen --reason "<why>"
//
// The decision and every write live in `lib/closure/prepare.mjs`; this file only hands it the
// project root and the arguments, and turns its answer into the exit code.
//
// Exit codes: 0 prepared (or already prepared), 1 refused, 2 usage.

import { prepareClosure } from './lib/closure/index.mjs';

process.exitCode = prepareClosure({
  root: process.env.SPECTREE_PROJECT_ROOT ?? process.cwd(),
  argv: process.argv.slice(2),
});
