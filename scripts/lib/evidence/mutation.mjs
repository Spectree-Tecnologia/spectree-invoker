// Accidental-edit isolation, not a security sandbox for arbitrary executable code.
import {
  git as gitIn,
  contentDigest,
  launch,
  parseTap,
  judgePassingRun,
  judgeMutationRun,
  inside,
  refuse,
} from '../shared/index.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, lstatSync, chmodSync } from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { bounded } from '../change/index.mjs';

function command(value, label) {
  if (!Array.isArray(value) || !value.length || value.some((x) => typeof x !== 'string' || !x || x.includes('\0'))) refuse('E_MUTATION_PLAN', `${label} must be an argv array.`);
}
function mutationOf(root, m, label) {
  bounded(m.target, `${label}target`, 500); bounded(m.before, `${label}before`, 100000);
  if (typeof m.after !== 'string' || m.after === m.before || m.after.length > 100000) refuse('E_MUTATION_PLAN', `${label}after must change the target fragment.`);
  bounded(m.test_name, `${label}test_name`, 500);
  const text = readFileSync(inside(root, m.target), 'utf8');
  if (text.split(m.before).length !== 2) refuse('E_MUTATION_MATCH', `${label}The original fragment must occur exactly once.`);
}
/**
 * One mutation, or a batch: `mutations` shares one copy, one setup and one baseline, and each
 * mutant is applied to the pristine copy, run, and reverted before the next. `mutant_command`
 * may name `{test_name}` so a mutant runs only the test that must kill it.
 */
export function mutationPlan(root, plan) {
  if (!plan || typeof plan !== 'object') refuse('E_MUTATION_PLAN', 'A plan object is required.');
  const batch = plan.mutations !== undefined;
  const keys = batch ? ['mutations', 'command', 'mutant_command', 'setup_command', 'timeout_seconds']
    : ['target', 'before', 'after', 'test_name', 'command', 'setup_command', 'timeout_seconds'];
  if (Object.keys(plan).some((k) => !keys.includes(k))) refuse('E_MUTATION_PLAN', 'Unknown plan field.');
  if (batch) {
    if (!Array.isArray(plan.mutations) || !plan.mutations.length || plan.mutations.length > 200) refuse('E_MUTATION_PLAN', 'mutations must list 1..200 mutations.');
    const ids = new Set();
    for (const m of plan.mutations) {
      if (!m || typeof m !== 'object' || Object.keys(m).some((k) => !['id', 'target', 'before', 'after', 'test_name'].includes(k))) refuse('E_MUTATION_PLAN', 'Unknown mutation field.');
      bounded(m.id, 'id', 200);
      if (ids.has(m.id)) refuse('E_MUTATION_PLAN', `Mutation ids must be unique: ${m.id}`);
      ids.add(m.id); mutationOf(root, m, `${m.id}: `);
    }
    if (plan.mutant_command) command(plan.mutant_command, 'mutant_command');
  } else mutationOf(root, plan, '');
  command(plan.command, 'command');
  if (plan.setup_command) command(plan.setup_command, 'setup_command');
  if (!Number.isInteger(plan.timeout_seconds) || plan.timeout_seconds < 1 || plan.timeout_seconds > 3600) refuse('E_MUTATION_PLAN', 'timeout_seconds must be 1..3600.');
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
  const batch = plan.mutations !== undefined;
  const mutations = batch ? plan.mutations : [{ target: plan.target, before: plan.before, after: plan.after, test_name: plan.test_name }];
  for (const m of mutations) {
    if (!files.includes(m.target.replaceAll('\\', '/'))) refuse('E_MUTATION_TARGET', 'Target must be a non-sensitive, non-ignored candidate file.');
  }
  const names = [...new Set(mutations.map((m) => m.test_name))];
  const before = contentDigest(root);
  const base = resolve(tmpdir());
  if (containedBy(root, base)) refuse('E_MUTATION_TEMP', 'The temporary directory must be outside the source checkout.');
  if (!apply) return { dry_run: true, file_count: files.length, source_digest: before.digest,
    ...(batch ? { mutations: mutations.map((m) => ({ id: m.id, target: m.target, test_name: m.test_name })), mutant_command: plan.mutant_command ?? plan.command }
      : { target: plan.target }),
    command: plan.command, setup_command: plan.setup_command ?? null,
    limits: 'Fresh file copies, no shared dependencies or project credentials. Commands are trusted code, not OS-sandboxed.' };
  const scratch = mkdtempSync(join(base, 'spectree-probe-'));
  const copy = join(scratch, 'candidate'); const home = join(scratch, 'home');
  mkdirSync(copy); mkdirSync(home); writeFileSync(join(home, '.npmrc'), '');
  const record = { version: 1, source_digest: before.digest, source_revision: before.revision,
    ...(batch ? {} : { target: plan.target, test_name: plan.test_name }), result: 'INFRA_ERROR',
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
    assertCandidate();
    // One baseline for the whole batch: every named test runs once and passes in a complete run.
    const baseline = run(plan.command);
    const tap = baseline.error || baseline.signal ? null : parseTap(baseline.output);
    const controls = names.map((name) => (tap ? judgePassingRun(tap, name, baseline.exit_code)
      : { result: 'INFRA_ERROR', reason: baseline.error ?? baseline.signal }));
    record.baseline = controls.find((c) => c.result !== 'PASS') ?? controls[0];
    if (record.baseline.result !== 'PASS') return { ...record, reason: 'The unmutated copy did not prove the named test green.', baseline: record.baseline };
    assertCandidate();
    const results = [];
    for (const m of mutations) {
      const target = inside(copy, m.target);
      const original = readFileSync(target, 'utf8');
      if (original.split(m.before).length !== 2) refuse('E_MUTATION_MATCH', 'Baseline changed the target fragment.');
      writeFileSync(target, original.replace(m.before, m.after));
      const argv = (plan.mutant_command ?? plan.command).map((a) => a.split('{test_name}').join(m.test_name));
      const mutant = run(argv);
      writeFileSync(target, original);
      const verdict = mutant.error || mutant.signal ? { result: 'INFRA_ERROR', reason: mutant.error ?? mutant.signal }
        : judgeMutationRun(parseTap(mutant.output), m.test_name, mutant.exit_code);
      results.push({ ...(batch ? { id: m.id, target: m.target, test_name: m.test_name } : {}), ...verdict });
      assertCandidate();
    }
    if (!batch) {
      record.mutant = results[0];
      record.result = record.mutant.result;
      record.reason = record.mutant.reason;
      return record;
    }
    // A survivor is the finding, whatever else broke; an inconclusive mutant is never a kill.
    const survived = results.filter((r) => r.result === 'FAIL');
    const inconclusive = results.filter((r) => r.result === 'INFRA_ERROR');
    record.mutations = results;
    record.result = survived.length ? 'FAIL' : inconclusive.length ? 'INFRA_ERROR' : 'PASS';
    record.reason = survived.length ? `${survived.length} of ${results.length} mutation(s) survived: ${survived.map((r) => r.id).join(', ')}`
      : inconclusive.length ? `${inconclusive.length} of ${results.length} mutation(s) were inconclusive: ${inconclusive.map((r) => r.id).join(', ')}`
      : `${results.length} mutation(s) killed, over one copy, one setup and one baseline`;
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
