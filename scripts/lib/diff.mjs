// Diff classification against a recorded base revision.
//
// The rule this replaces was "no code found, therefore documentation". That is an
// allowlist by omission, and it approves whatever the matcher failed to recognise.
// Here the allowlist is POSITIVE: a path is administrative only if it matches a
// declared administrative pattern. Everything else needs the review its kind needs.
//
// Classification is not authorisation. Documentation changes policy too — that is
// why the caller gets kinds and reasons, never a verdict.

import { execFileSync } from 'node:child_process';

export const KIND = {
  ADMINISTRATIVE: 'administrative',
  SOURCE: 'source',
  TEST: 'test',
  DEPENDENCY: 'dependency',
  PIPELINE: 'pipeline',
  RUNTIME_CONFIG: 'runtime_config',
  PROTOCOL: 'protocol',
  UNKNOWN: 'unknown',
};

/** Positive allowlist. A path is administrative only by matching one of these. */
const ADMINISTRATIVE = [
  /^docs\/(?!specs\/).*\.(md|txt)$/i,
  /^README(\.[a-z]+)?\.md$/i,
  /^CHANGELOG\.md$/i,
  /^LICENSE(\.[a-z]+)?$/i,
  /^\.log\/[^/]+\.log$/i,
];

const DEPENDENCY = [
  /(^|\/)package\.json$/i, /(^|\/)package-lock\.json$/i, /(^|\/)pnpm-lock\.yaml$/i,
  /(^|\/)yarn\.lock$/i, /(^|\/)bun\.lock(b)?$/i, /(^|\/)requirements\.txt$/i,
  /(^|\/)pyproject\.toml$/i, /(^|\/)poetry\.lock$/i, /(^|\/)go\.(mod|sum)$/i,
  /(^|\/)Cargo\.(toml|lock)$/i, /(^|\/)Gemfile(\.lock)?$/i, /(^|\/)pnpm-workspace\.yaml$/i,
];

const PIPELINE = [
  /^\.github\/workflows\//i, /^\.gitlab-ci\.ya?ml$/i, /^(^|\/)Dockerfile$/i,
  /(^|\/)docker-compose\.ya?ml$/i, /^\.circleci\//i, /^\.githooks\//i,
];

const RUNTIME_CONFIG = [
  /(^|\/)tsconfig([.\w-]*)\.json$/i, /(^|\/)vite\.config\.[jt]s$/i, /(^|\/)next\.config\.[jt]s$/i,
  /(^|\/)eslint\.config\.[cm]?js$/i, /(^|\/)\.npmrc$/i, /(^|\/)\.env(\.[\w-]+)?$/i,
  /(^|\/)biome\.json$/i, /(^|\/)drizzle\.config\.[jt]s$/i, /(^|\/)vitest\.config\.[jt]s$/i,
];

/** Test files. Extensions and directories are both configurable by the caller. */
export const DEFAULT_TEST_PATTERNS = [
  /\.(test|spec|attack|e2e)\.[jt]sx?$/i,
  /\.(test|spec|attack|e2e)\.(py|rb|go|rs)$/i,
  /(^|\/)(tests?|__tests__|spec|e2e)\//i,
  /_test\.(go|py)$/i,
];

const PROTOCOL = [/^protocol\//, /^schemas\//, /^adapters\//];

/** Normalise a git path to POSIX, and refuse anything that escapes the repository. */
export function normalisePath(raw) {
  const p = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) {
    const e = new Error(`absolute path in diff: ${raw}`); e.code = 'E_PATH_ABSOLUTE'; throw e;
  }
  const parts = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      const e = new Error(`path escapes the repository: ${raw}`); e.code = 'E_PATH_TRAVERSAL'; throw e;
    }
    parts.push(seg);
  }
  return parts.join('/');
}

export function classifyPath(path, { testPatterns = DEFAULT_TEST_PATTERNS } = {}) {
  const p = normalisePath(path);
  if (testPatterns.some((r) => r.test(p))) return KIND.TEST;
  if (DEPENDENCY.some((r) => r.test(p))) return KIND.DEPENDENCY;
  if (PIPELINE.some((r) => r.test(p))) return KIND.PIPELINE;
  if (RUNTIME_CONFIG.some((r) => r.test(p))) return KIND.RUNTIME_CONFIG;
  if (PROTOCOL.some((r) => r.test(p))) return KIND.PROTOCOL;
  if (ADMINISTRATIVE.some((r) => r.test(p))) return KIND.ADMINISTRATIVE;
  return KIND.SOURCE;
}

/**
 * Read the diff between two revisions with `-z`, which is NUL-separated and therefore
 * safe for names containing spaces, quotes, newlines and non-ASCII. Arguments go to the
 * process directly; nothing is assembled into a shell string.
 *
 * @returns {{status:string, path:string, from?:string}[]}
 */
export function readDiff(base, head = 'HEAD', { cwd = process.cwd() } = {}) {
  let out;
  try {
    out = execFileSync('git', ['diff', '--name-status', '-M', '-z', base, head], {
      cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    const err = new Error(
      `cannot compare ${base}..${head}: ${String(e.stderr || e.message).trim()}. ` +
      'An unavailable comparison is unknown, never "no changes".');
    err.code = 'E_DIFF_UNAVAILABLE';
    throw err;
  }
  const fields = out.split('\0').filter((s) => s !== '');
  const entries = [];
  for (let i = 0; i < fields.length; ) {
    const status = fields[i++];
    if (/^[RC]\d*$/.test(status)) {
      const from = fields[i++], to = fields[i++];
      if (to === undefined) { const e = new Error('truncated rename record in git output'); e.code = 'E_DIFF_MALFORMED'; throw e; }
      entries.push({ status: status[0], path: normalisePath(to), from: normalisePath(from) });
    } else {
      const path = fields[i++];
      if (path === undefined) { const e = new Error('truncated record in git output'); e.code = 'E_DIFF_MALFORMED'; throw e; }
      entries.push({ status: status[0], path: normalisePath(path) });
    }
  }
  return entries;
}

/**
 * Classify a diff. A rename is classified on BOTH ends: moving a source file into a
 * documentation folder does not make it documentation, and moving a doc into src does
 * not make it source without review.
 */
export function classifyDiff(entries, opts = {}) {
  const files = entries.map((e) => {
    const kinds = new Set([classifyPath(e.path, opts)]);
    if (e.from) kinds.add(classifyPath(e.from, opts));
    return { ...e, kinds: [...kinds].sort() };
  });
  const kinds = new Set(files.flatMap((f) => f.kinds));
  const nonAdministrative = files.filter((f) => f.kinds.some((k) => k !== KIND.ADMINISTRATIVE));
  return {
    files,
    kinds: [...kinds].sort(),
    administrative_only: nonAdministrative.length === 0,
    non_administrative: nonAdministrative,
    deleted: files.filter((f) => f.status === 'D'),
    renamed: files.filter((f) => f.status === 'R'),
    tests: files.filter((f) => f.kinds.includes(KIND.TEST)),
  };
}

/** Paths outside the change's declared ownership. Containment is prefix-on-segment, not substring. */
export function outsideAllowedPaths(entries, allowed) {
  const prefixes = allowed.map((a) => normalisePath(a).replace(/\/+$/, ''));
  const contained = (p) => prefixes.some((a) => p === a || p.startsWith(a + '/'));
  const bad = [];
  for (const e of entries) {
    if (!contained(e.path)) bad.push({ path: e.path, status: e.status });
    if (e.from && !contained(e.from)) bad.push({ path: e.from, status: 'R(from)' });
  }
  return bad;
}
