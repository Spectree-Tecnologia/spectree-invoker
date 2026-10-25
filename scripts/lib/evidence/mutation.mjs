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
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, lstatSync, chmodSync, cpSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve, relative, isAbsolute, delimiter, posix } from 'node:path';
import { homedir, tmpdir } from 'node:os';
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
  const keys = batch ? ['mutations', 'command', 'mutant_command', 'setup_command', 'setup_cache', 'timeout_seconds']
    : ['target', 'before', 'after', 'test_name', 'command', 'setup_command', 'setup_cache', 'timeout_seconds'];
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
  if (plan.setup_cache !== undefined) {
    const c = plan.setup_cache; const relativePath = (p) => typeof p === 'string' && p && !isAbsolute(p) && !p.split(/[\\/]/).includes('..');
    if (!plan.setup_command || !c || typeof c !== 'object' || Object.keys(c).some((k) => !['key_files', 'paths'].includes(k)) ||
        !Array.isArray(c.key_files) || !c.key_files.length || c.key_files.length > 20 || !c.key_files.every(relativePath) ||
        !Array.isArray(c.paths) || !c.paths.length || c.paths.length > 10 || !c.paths.every(relativePath)) {
      refuse('E_MUTATION_PLAN', 'setup_cache needs setup_command, 1..20 relative key_files and 1..10 relative paths.');
    }
  }
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
// The install cache: what a successful setup produced under the declared paths, keyed by everything
// that decides it. A hit is copied into the disposable copy, never linked; the baseline still runs.
function cacheEntry(root, plan, originals) {
  const { key_files: keyFiles, paths } = plan.setup_cache;
  const h = createHash('sha256').update(JSON.stringify({ setup: plan.setup_command, paths,
    platform: process.platform, arch: process.arch, node: process.versions.node }));
  for (const f of keyFiles) {
    const bytes = originals.get(f.replaceAll('\\', '/'));
    if (!bytes) refuse('E_MUTATION_PLAN', `setup_cache key file is not a candidate file: ${f}`);
    h.update(`\0${f}\0`); h.update(bytes);
  }
  // Per user by default: a shared temporary folder would let another local user plant an entry.
  const cacheRoot = resolve(process.env.SPECTREE_PROBE_CACHE || join(homedir(), '.cache', 'spectree-probe'));
  if (containedBy(root, cacheRoot)) refuse('E_MUTATION_TEMP', 'The probe cache must be outside the source checkout.');
  const key = h.digest('hex');
  return { key, dir: join(cacheRoot, key), root: cacheRoot, paths };
}
const COMPLETE = '.spectree-cache-complete';
// An entry runs as the probe's own code, so the root and the entry must be this user's alone: a real
// folder, owned by the caller, with no group or other permission bits. Where there is no uid (Windows),
// only the symlink and folder checks apply.
function privateFolder(dir) {
  const st = lstatSync(dir);
  const uid = process.getuid?.();
  if (st.isSymbolicLink() || !st.isDirectory() || (uid !== undefined && (st.uid !== uid || (st.mode & 0o077))))
    refuse('E_MUTATION_TEMP', `The probe cache folder is not private to this user: ${dir}`);
}
function cacheRootReady(entry) {
  mkdirSync(entry.root, { recursive: true, mode: 0o700 });
  privateFolder(entry.root);
}
function restoreCache(entry, copy) {
  if (!existsSync(entry.root)) return false;
  privateFolder(entry.root);
  if (!existsSync(join(entry.dir, COMPLETE))) return false;
  privateFolder(entry.dir);
  for (const p of entry.paths) if (existsSync(join(entry.dir, p))) cpSync(join(entry.dir, p), join(copy, p), { recursive: true, verbatimSymlinks: true });
  return true;
}
/** Stores what setup produced; returns `stored` or `miss` with why. */
function storeCache(entry, copy) {
  if (!entry.paths.some((p) => existsSync(join(copy, p)))) return { cache: 'miss', cache_error: 'NO_DECLARED_PATH' };
  cacheRootReady(entry);
  let temp;
  try {
    temp = mkdtempSync(join(entry.root, 'incoming-'));
    for (const p of entry.paths) if (existsSync(join(copy, p))) cpSync(join(copy, p), join(temp, p), { recursive: true, verbatimSymlinks: true });
    writeFileSync(join(temp, COMPLETE), `${entry.key}\n`);
    try { renameSync(temp, entry.dir); } catch (e) {
      // Another probe stored it first; a folder without the marker is a broken entry, replaced once.
      if (existsSync(join(entry.dir, COMPLETE))) { rmSync(temp, { recursive: true, force: true }); return { cache: 'miss', cache_error: 'STORED_CONCURRENTLY' }; }
      if (!existsSync(entry.dir)) throw e;
      rmSync(entry.dir, { recursive: true, force: true });
      renameSync(temp, entry.dir);
    }
    return { cache: 'stored' };
  } catch (e) {
    if (temp) rmSync(temp, { recursive: true, force: true });
    return { cache: 'miss', cache_error: e.code ?? 'UNKNOWN' };
  }
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
    command: plan.command, setup_command: plan.setup_command ?? null, setup_cache: plan.setup_cache ?? null,
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
    const entry = plan.setup_cache ? cacheEntry(root, plan, originals) : null;
    const covers = (p, f) => { const n = posix.normalize(p.replaceAll('\\', '/')).replace(/\/$/, ''); return n === '.' || f === n || f.startsWith(`${n}/`); };
    if (entry && files.some((f) => entry.paths.some((p) => covers(p, f)))) {
      refuse('E_MUTATION_PLAN', 'A setup_cache path covers a candidate file; cache only what setup produces.');
    }
    if (entry && restoreCache(entry, copy)) {
      record.setup = { cache: 'hit', cache_key: entry.key };
    } else if (plan.setup_command) {
      const setup = run(plan.setup_command);
      record.setup = { exit_code: setup.exit_code, error: setup.error, signal: setup.signal };
      if (setup.error || setup.signal || setup.exit_code !== 0) return { ...record, reason: 'Setup did not complete successfully.' };
      if (entry) Object.assign(record.setup, storeCache(entry, copy), { cache_key: entry.key });
    }
    assertCandidate();
    // One baseline for the whole batch: every named test runs once and passes in a complete run.
    const baseline = run(plan.command);
    const tap = baseline.error || baseline.signal ? null : parseTap(baseline.output);
    const controls = names.map((name) => (tap ? judgePassingRun(tap, name, baseline.exit_code)
      : { result: 'INFRA_ERROR', reason: baseline.error ?? baseline.signal }));
    record.baseline = controls.find((c) => c.result !== 'PASS') ?? controls[0];
    if (record.baseline.result !== 'PASS') return { ...record, baseline: record.baseline, reason: record.setup?.cache === 'hit'
      ? `The unmutated copy did not prove the named test green, over the cached setup ${record.setup.cache_key}; remove that entry to rule it out.`
      : 'The unmutated copy did not prove the named test green.' };
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
