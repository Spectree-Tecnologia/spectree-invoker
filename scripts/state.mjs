#!/usr/bin/env node
// The Invoker's state CLI. It validates the flow; it never performs the work.
//
//   node scripts/state.mjs init <project-id> [-- <spec consolidation command> [args...]]
//   node scripts/state.mjs resume [change-id]        the resume contract, human-readable
//   node scripts/state.mjs resume --json
//   node scripts/state.mjs plan [change-id] [--json] [--observe-ci --pr <number>]
//   node scripts/state.mjs open <change-id> --type <t> --base <rev> --scope <s> --paths a,b
//                                (--modules a,b | --deltaless) [--closure-mode prepared|legacy]
//   node scripts/state.mjs amend-paths <change-id> --add <path>[,<path>] --reason "<why>"
//   node scripts/state.mjs digest <change-id> [--gate scope|integration]
//   node scripts/state.mjs can <change-id> <to-state>
//   node scripts/state.mjs transition <change-id> <to-state> --expect <state_revision>
//   node scripts/state.mjs transition <change-id> blocked --reason "<why>"
//   node scripts/state.mjs run <change-id> <property> --role <r> [--independent-of a,b]
//                                [--expect-failing <test name> | --expect-from <file.json>] [--report]
//                                [--id <e>] -- <command> [args...]   ({report} is substituted)
//   node scripts/state.mjs record-evidence <file.json>
//   node scripts/state.mjs record-approval <file.json>
//   node scripts/state.mjs defer <file.json>
//   node scripts/state.mjs trail [change-id] [--json] [--export <file>]
//   node scripts/state.mjs validate                  every stored document against its schema
//
// Every command lives in `lib/closure/state.mjs`, one function each; this file only hands it the
// project root and the arguments, and turns its answer into the exit code.
//
// Exit codes: 0 allowed/valid, 1 refused/invalid, 2 usage.


import { stateCommand } from './lib/closure/index.mjs';

process.exitCode = stateCommand({
  root: process.env.SPECTREE_PROJECT_ROOT ?? process.cwd(),
  argv: process.argv.slice(2),
});
