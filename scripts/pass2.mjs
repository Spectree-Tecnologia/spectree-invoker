#!/usr/bin/env node
// Pass 2 coverage between rounds on the same change.
//
//   node scripts/pass2.mjs record <change> <report.json> --operation <id>   binds what one finished round attacked
//   node scripts/pass2.mjs scope <change>                                   what the next round attacks
//
// The rules live in `lib/evidence/pass2.mjs`; this file only hands it the project root and the
// arguments, and turns its answer into the exit code.
//
// Exit codes: 0 done, 1 refused, 2 usage.

import { pass2Command } from './lib/evidence/index.mjs';

process.exitCode = pass2Command({
  root: process.env.SPECTREE_PROJECT_ROOT ?? process.cwd(),
  argv: process.argv.slice(2),
});
