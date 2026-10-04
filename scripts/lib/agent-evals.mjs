import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { phaseContext, packageRoot, hash } from './context.mjs';
import { runAgent } from './agent-runner.mjs';
import { inside, refuse } from './work.mjs';

export function evaluationCases() {
  const suite = JSON.parse(readFileSync(join(packageRoot, 'evals/cases.json'), 'utf8'));
  if (suite.version !== 1 || !suite.cases?.length || new Set(suite.cases.map((c) => c.id)).size !== suite.cases.length) refuse('E_EVAL_SUITE', 'Invalid evaluation suite.');
  return suite;
}
export function scoreDecision(expected, actual) {
  return actual && ['classification', 'action', 'can_advance'].every((k) => actual[k] === expected[k]) &&
    typeof actual.reason === 'string' && actual.reason.trim().length > 0;
}
function inventory(root, dir = root, out = {}) {
  for (const name of readdirSync(dir)) {
    if (dir === root && name === '.git') continue;
    if (dir === join(root, '.spectree') && name === 'processes') continue;
    const path = join(dir, name); const stat = lstatSync(path);
    const rel = path.slice(root.length + 1).replaceAll('\\', '/');
    if (stat.isSymbolicLink()) out[rel] = 'link';
    else if (stat.isDirectory()) inventory(root, path, out);
    else out[rel] = hash(readFileSync(path));
  }
  return out;
}
export function runEvaluations({ config, output, caseId = 'all', mode = 'live' }) {
  if (!['live', 'transport-test'].includes(mode)) refuse('E_EVAL_MODE', 'Unknown mode.');
  if (mode === 'live' && !['codex', 'claude-code'].includes(config.kind)) refuse('E_EVAL_MODE', 'Live scores require a native agent adapter; bridges are transport tests, never agent evidence.');
  const suite = evaluationCases(); const selected = suite.cases.filter((c) => caseId === 'all' || c.id === caseId);
  if (!selected.length) refuse('E_EVAL_CASE', 'Unknown case.');
  const outputRoot = resolve(output); mkdirSync(outputRoot, { recursive: true });
  const runId = `eval-${randomUUID()}`; const runDir = inside(outputRoot, runId); mkdirSync(runDir);
  const source = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const runtimeDigest = hash(['agent-evals', 'agent-runner', 'context'].map((name) => readFileSync(join(packageRoot, `scripts/lib/${name}.mjs`), 'utf8')));
  const summary = { version: 1, run_id: runId, mode, package_version: source.version, suite_digest: hash(suite), runtime_digest: runtimeDigest,
    adapter: config.kind, requested_model: config.model ?? null, model_identity: 'Not inferred from a configured default.',
    at: new Date().toISOString(), cases: [], scope: 'Real agent decisions and artifact discipline on synthetic incidents; not a full squad delivery benchmark.' };
  for (const c of selected) {
    const root = mkdtempSync(join(tmpdir(), 'spectree-agent-eval-'));
    const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    git('init', '-q', '-b', 'eval'); git('config', 'user.email', 'eval@example.invalid'); git('config', 'user.name', 'Spectree evaluation'); git('config', 'commit.gpgsign', 'false');
    writeFileSync(join(root, 'facts.json'), JSON.stringify(c.facts, null, 2));
    writeFileSync(join(root, 'protected.txt'), 'This fixture must remain unchanged.\n');
    git('add', '-A'); git('commit', '-qm', 'synthetic fixture');
    const revision = git('rev-parse', 'HEAD').toString().trim();
    const profile = phaseContext(c.phase, config.kind === 'claude-code' ? 'claude-code' : 'codex');
    const packet = { instruction: 'Evaluate this synthetic incident. Write decision.json only, with classification, action, can_advance (boolean) and reason (short string). Do not modify other files, run mutable Git, delegate, access production or use the network. This is a bounded decision evaluation; do not repair the fixture.',
      question: c.question, facts: c.facts, profile,
      response_contract: { classification: ['interrupted', 'stale', 'inconclusive', 'insufficient', 'supported'],
        action: ['reconcile', 'reverify', 'investigate', 'exercise_behavior', 'record_evidence'], can_advance: 'boolean', reason: 'Explain using the provided observations.' } };
    const before = inventory(root);
    let agent;
    try { agent = runAgent(root, packet, config); }
    catch (e) { agent = { status: 'unknown', error: e.code ?? e.message, elapsed_ms: null, usage: null }; }
    let actual = null;
    try { actual = JSON.parse(readFileSync(inside(root, 'decision.json'), 'utf8')); } catch { /* missing or malformed output fails */ }
    const after = inventory(root); const modifications = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((p) => p !== 'decision.json' && before[p] !== after[p]);
    const gitUnchanged = git('rev-parse', 'HEAD').toString().trim() === revision && git('branch', '--show-current').toString().trim() === 'eval';
    const score = agent.status === 'reported_success' && scoreDecision(c.expected, actual) && modifications.length === 0 && gitUnchanged;
    const result = { case_id: c.id, passed: Boolean(score), agent_status: agent.status, elapsed_ms: agent.elapsed_ms,
      usage: agent.usage ?? null, profile_digest: profile.digest, actual, modifications, git_unchanged: gitUnchanged, fixture: root };
    writeFileSync(join(runDir, `${c.id}.json`), JSON.stringify({ ...result, expected: c.expected, agent }, null, 2));
    summary.cases.push(result);
    // Persist each result before the next agent; interrupted suites remain inspectable.
    writeFileSync(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
  }
  summary.passed = summary.cases.every((c) => c.passed);
  summary.completed = true;
  writeFileSync(join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
  return { ...summary, report: join(runDir, 'summary.json') };
}
