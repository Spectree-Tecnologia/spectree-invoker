#!/usr/bin/env node
// Confirm an integration that already happened, and close the change. Nothing else.
//
//   node scripts/post-merge.mjs <change-id> --pr <number> [--base main] [--apply] [--json]
//
// The confirmation lives in `lib/closure/post-merge.mjs`; this file only hands it the project root
// and the arguments, and turns its answer into the exit code.
//
// Exit codes: 0 confirmed (or planned), 1 refused, 2 usage.

import { confirmMerge } from './lib/closure/index.mjs';

process.exitCode = confirmMerge({
  root: process.env.SPECTREE_PROJECT_ROOT ?? process.cwd(),
  argv: process.argv.slice(2),
});
