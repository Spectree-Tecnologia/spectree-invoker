#!/usr/bin/env node
// Collect the measured signals of one merged PR for its closure retro.
//
//   node scripts/retro.mjs collect <pr> [--repo owner/name]           prints, writes nothing
//   node scripts/retro.mjs collect <pr> [--repo owner/name] --apply   also records it in .spectree/retros/
//
// The reads and the matching live in `lib/evaluation/retro.mjs`; this file only hands it the
// project root and the arguments, and turns its answer into the exit code.
//
// Exit codes: 0 collected, 1 refused, 2 usage.

import { retroCommand } from './lib/evaluation/index.mjs';

process.exitCode = retroCommand({
  root: process.env.SPECTREE_PROJECT_ROOT ?? process.cwd(),
  argv: process.argv.slice(2),
});
