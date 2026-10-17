// Accidental-edit isolation, not a security sandbox for arbitrary executable code.
import { git as gitIn } from './shared/git.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, lstatSync, chmodSync } from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { contentDigest } from './digest.mjs';
import { launch } from './launch.mjs';
import { parseTap, judgePassingRun, judgeMutationRun } from './tap.mjs';
import { bounded } from './work.mjs';
import { inside, refuse } from './shared/guard.mjs';

function command(value, label) {
  if (!Array.isArray(value) || !value.length || value.some((x) => typeof x !== 'string' || !x || x.includes('\0'))) refuse('E_MUTATION_PLAN', `${label} must be an argv array.`);
}
export function mutationPlan(root, plan) {
  if (!plan || typeof plan !== 'object') refuse('E_MUTATION_PLAN', 'A plan object is required.');
  const keys = ['target', 'before', 'after', 'test_name', 'command', 'setup_command', 'timeout_seconds'];
  if (Object.keys(plan).some((k) => !keys.includes(k))) refuse('E_MUTATION_PLAN', 'Unknown plan field.');
  bounded(plan.target, 'target', 500); bounded(plan.before, 'before', 100000);
  if (typeof plan.after !== 'string' || plan.after === plan.before || plan.after.length > 100000) refuse('E_MUTATION_PLAN', 'after must change the target fragment.');
  bounded(plan.test_name, 'test_name', 500); command(plan.command, 'command');
  if (plan.setup_command) command(plan.setup_command, 'setup_command');
  if (!Number.isInteger(plan.timeout_seconds) || plan.timeout_seconds < 1 || plan.timeout_seconds > 3600) refuse('E_MUTATION_PLAN', 'timeout_seconds must be 1..3600.');
  const text = readFileSync(inside(root, plan.target), 'utf8');
  if (text.split(plan.before).length !== 2) refuse('E_MUTATION_MATCH', 'The original fragment must occur exactly once.');
  return plan;
}
const excluded = (p) => p.split('/').some((part) => ['.git', '.spectree', '.log', 'node_modules'].includes(part) ||
  /^\.env(?:\.|$)/i.test(part) || /\.(pem|key|p12|pfx)$/i.test(part)) ||
  /^(?:\.aws|\.ssh|\.claude|\.codex)\//.test(p) || /(?:^|\/)\.npmrc$/.test(p);

export function candidateFiles(root) {
  const git = (args) => gitIn(root, ['--no-optional-locks', ...args]);
  if (git(['ls-files', '-u', '-z']).length) refuse('E_MUTATION_CONFLICT', 'Resolve the conflicted index before copying the candidate.');
  const files = [...new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean))]
    .map((p) => p.replaceAll('\\', '/')).filter((p) => !excluded(p)).sort();
  return files.filter((p) => {
    const f = inside(root, p);
    if (!existsSync(f)) return false; // A deletion in the candidate stays deleted.
    if (!lstatSync(f).isFile()) refuse('E_MUTATION_FILE', `Not a regular candidate file: ${p}`);
    return true;
  });
}
function containedBy(base, target) {
  const rel = relative(resolve(base), resolve(target));
  return !rel || (!rel.startsWith('..') && !isAbsolute(rel));
}
function cleanEnvironment(home, root) {
  const env = {};
  // Deliberately no database URLs, cloud credentials, NODE_OPTIONS or inherited project variables.
  for (const k of ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL']) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  for (const key of ['PATH', 'Path']) {
    if (env[key]) env[key] = env[key].split(delimiter).filter((p) => p && isAbsolute(p) && !containedBy(root, p)).join(delimiter);
  }
  return { ...env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home,
    npm_config_userconfig: join(home, '.npmrc'), CI: 'true', FORCE_COLOR: '0' };
}
export function runMutation(root, input, { apply = false } = {}) {
  const plan = mutationPlan(root, input); const files = candidateFiles(root);
  if (!files.includes(plan.target.replaceAll('\\', '/'))) refuse('E_MUTATION_TARGET', 'Target must be a non-sensitive, non-ignored candidate file.');
  const before = contentDigest(root);
  const base = resolve(tmpdir());
  if (containedBy(root, base)) refuse('E_MUTATION_TEMP', 'The temporary directory must be outside the source checkout.');
  if (!apply) return { dry_run: true, file_count: files.length, source_digest: before.digest, target: plan.target,
    command: plan.command, setup_command: plan.setup_command ?? null,
    limits: 'Fresh file copies, no shared dependencies or project credentials. Commands are trusted code, not OS-sandboxed.' };
  const scratch = mkdtempSync(join(base, 'spectree-probe-'));
  const copy = join(scratch, 'candidate'); const home = join(scratch, 'home');
  mkdirSync(copy); mkdirSync(home); writeFileSync(join(home, '.npmrc'), '');
  const record = { version: 1, source_digest: before.digest, source_revision: before.revision,
    target: plan.target, test_name: plan.test_name, result: 'INFRA_ERROR',
    isolation: 'file-copy; no OS security boundary', at: new Date().toISOString() };
  const run = (argv) => {
    if (isAbsolute(argv[0]) && containedBy(root, argv[0])) refuse('E_MUTATION_COMMAND', 'The command executable points into the source checkout; use the copied executable instead.');
    if (!isAbsolute(argv[0]) && /[\\/]/.test(argv[0]) && !containedBy(copy, resolve(copy, argv[0]))) refuse('E_MUTATION_COMMAND', 'A relative executable must stay inside the copy.');
    const r = launch(argv, { cwd: copy, env: cleanEnvironment(home, root), encoding: 'utf8',
      timeout: plan.timeout_seconds * 1000, maxBuffer: 8 * 1024 * 1024 });
    return { exit_code: r.status, error: r.error?.code ?? null, signal: r.signal ?? null,
      output: (r.stdout ?? '') + '\n' + (r.stderr ?? '') };
  };
  try {
    const originals = new Map();
    for (const p of files) {
      const src = inside(root, p); const dest = inside(copy, p);
      const bytes = readFileSync(src);
      originals.set(p, bytes);
      mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, bytes);
      chmodSync(dest, lstatSync(src).mode & 0o777);
    }
    const assertCandidate = () => {
      for (const [p, bytes] of originals) {
        const path = inside(copy, p);
        if (!existsSync(path) || !readFileSync(path).equals(bytes)) refuse('E_MUTATION_SETUP_CHANGED', `Setup or baseline changed candidate file: ${p}`);
      }
    };
    if (contentDigest(root).digest !== before.digest) refuse('E_MUTATION_SOURCE_CHANGED', 'Source changed during copying; no test was run.');
    if (plan.setup_command) {
      const setup = run(plan.setup_command);
      record.setup = { exit_code: setup.exit_code, error: setup.error, signal: setup.signal };
      if (setup.error || setup.signal || setup.exit_code !== 0) return { ...record, reason: 'Setup did not complete successfully.' };
    }
    const target = inside(copy, plan.target);
    assertCandidate();
    const baseline = run(plan.command);
    record.baseline = baseline.error || baseline.signal ? { result: 'INFRA_ERROR', reason: baseline.error ?? baseline.signal }
      : judgePassingRun(parseTap(baseline.output), plan.test_name, baseline.exit_code);
    if (record.baseline.result !== 'PASS') return { ...record, reason: 'The unmutated copy did not prove the named test green.', baseline: record.baseline };
    assertCandidate();
    const original = readFileSync(target, 'utf8');
    if (original.split(plan.before).length !== 2) refuse('E_MUTATION_MATCH', 'Baseline changed the target fragment.');
    writeFileSync(target, original.replace(plan.before, plan.after));
    const mutant = run(plan.command);
    record.mutant = mutant.error || mutant.signal ? { result: 'INFRA_ERROR', reason: mutant.error ?? mutant.signal }
      : judgeMutationRun(parseTap(mutant.output), plan.test_name, mutant.exit_code);
    record.result = record.mutant.result;
    record.reason = record.mutant.reason;
    return record;
  } finally {
    // Verify the exact resolved deletion target, and never follow an exchanged symlink.
    if (dirname(resolve(scratch)) !== base || !resolve(scratch).startsWith(join(base, 'spectree-probe-')) || lstatSync(scratch).isSymbolicLink()) {
      refuse('E_MUTATION_CLEANUP', 'Unsafe scratch path; retained for inspection.');
    }
    rmSync(scratch, { recursive: true, force: true });
    if (contentDigest(root).digest !== before.digest) refuse('E_MUTATION_SOURCE_CHANGED', 'Source changed during the probe; result is not usable.');
  }
}
