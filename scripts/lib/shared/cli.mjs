// Command-line flags, read one way by every CLI.
//
// A value that is itself a flag is a missing value, not a value: `--reason --apply` once recorded
// "--apply" as the justification for retiring a human's approval. Nine CLIs each re-implemented
// that rule by hand, and one of them forgot it. Reading flags here is how the rule stays written once.
//
// Deliberately not node:util.parseArgs: its strict mode refuses unknown flags and its loose mode
// takes `--reason --apply` as a value — either one would change what every existing command accepts.

/**
 * @param {string[]} argv the arguments to read, usually `process.argv.slice(2)` or the part before `--`
 * @param {{ emptyIsValue?: boolean }} [options] `emptyIsValue` keeps `--name ""` as the value `""`
 *   instead of treating it as missing — for callers that already distinguished the two.
 */
export function flags(argv, { emptyIsValue = false } = {}) {
  const has = (name) => argv.includes(`--${name}`);
  const value = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    if (i < 0) return fallback;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return fallback;
    if (v === '' && !emptyIsValue) return fallback;
    return v;
  };
  return { has, value };
}
