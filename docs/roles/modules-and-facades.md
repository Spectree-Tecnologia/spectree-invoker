# Modules and facades

**Example:** `scripts/lib/closure/index.mjs` and `scripts/prepare-closure.mjs`.
**Guarded by:** `tests/module-graph.test.mjs`, `tests/closure-facades.test.mjs`,
`tests/app-boundaries.test.mjs`.

## Rules

- Runtime code lives in one of the module folders under `scripts/lib/`. The graph runs one way:
  `shared <- change <- evidence, execution <- closure <- console, evaluation`.
- A module's `index.mjs` is its published entry. Another module, a CLI, Presence or the benchmark
  imports from that file only. Files inside one module import each other directly.
- An `index.mjs` exports its own module's files. It never re-exports another module.
- `shared` holds infrastructure: flags, git, digests, persistence, process launch, TAP, schema
  validation. A concept with a name from the change lifecycle does not belong there.
- A CLI holds no rule. It reads `root` and `argv`, calls a module function and turns the answer
  into output and an exit code. The closure CLIs are the target shape: the whole command is one
  call, and the function returns the exit code.

  ```js
  process.exitCode = prepareClosure({
    root: process.env.SPECTREE_PROJECT_ROOT ?? process.cwd(),
    argv: process.argv.slice(2),
  });
  ```

  That function takes `out` and `err` callbacks for its output, so a test runs it in process and
  compares it with the spawned CLI. Their exit codes are `0` allowed or done, `1` refused and
  `2` usage.
- The other runtime CLIs, such as `tasks.mjs` and `delivery.mjs`, dispatch on `argv` in the file,
  print the function's JSON answer, and exit `1` on a refusal or on `ok: false`. A new CLI
  follows the closure shape.

## Never

- Never import a file inside another module, such as `../change/store.mjs` from `closure/`.
- Never let a lower module import a higher one. When `execution` needs an answer from `closure`,
  it runs the CLI as a process (the task executor spawns `state.mjs plan`).
- Never put a rule in the CLI file. A rule in the facade cannot be tested in process.
- Tests are white-box and may import any file directly; that freedom does not extend to `bench/`,
  which imports `support/` and never `tests/`.
