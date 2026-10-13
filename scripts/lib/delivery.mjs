// Delivery observations live outside the candidate. No caller-supplied green report is imported.
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, lstatSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { performance } from 'node:perf_hooks';
import { Store } from './store.mjs';
import { inside, identifier, refuse, references } from './work.mjs';
import { contentDigest, contractDigest } from './digest.mjs';
import { launchSpec } from './launch.mjs';
import { supervisedLaunch, observeProcesses, inspectProcesses } from './process-supervisor.mjs';
import { withAuthority } from './lifecycle.mjs';
import { verificationPlan } from './verification.mjs';
import { deliveryContract, suiteVerdict } from './delivery-contract.mjs';
import { ledgerGate, deliveryLedger, DELIVERY_STATES } from './delivery-ledger.mjs';

const sha = v => createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(v)).digest('hex');
const json = (root, path) => JSON.parse(readFileSync(inside(root, path), 'utf8'));
const put = (root, path, value) => writeFileSync(inside(root, path), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

/** Discover by identity, including archive. Ambiguity is never resolved by choosing the last file. */
export function deliveryPlan(root, changeId) {
  identifier(changeId);
  const base = inside(root, 'docs/changes'), found = [];
  function walk(relative, depth = 0) {
    if (depth > 12) refuse('E_DELIVERY_PLAN', 'Plan discovery exceeds its depth bound.');
    for (const name of readdirSync(inside(root, relative)).sort()) {
      const rel = `${relative}/${name}`, file = inside(root, rel), stat = lstatSync(file);
      if (stat.isDirectory()) walk(rel, depth + 1);
      else if (name === 'verification.json') {
        const plan = json(root, rel);
        if (plan.change === changeId) found.push({ path: rel, plan });
      }
    }
  }
  if (existsSync(base)) walk('docs/changes');
  if (found.length !== 1) refuse('E_DELIVERY_PLAN', `Expected one verification plan for ${changeId}, found ${found.length}.`);
  const entry = found[0], check = verificationPlan(entry.plan), delivery = deliveryContract(entry.plan);
  if (!check.ok || !delivery.ok) refuse('E_DELIVERY_PLAN', JSON.stringify([...check.errors, ...delivery.errors]));
  return { ...entry, digest: sha(entry.plan) };
}
export function deliveryIdentity(root, changeId) {
  const store = new Store(root), change = store.change(identifier(changeId));
  if (!change) refuse('E_DELIVERY_CHANGE', 'Unknown structured change.');
  const entry = deliveryPlan(root, changeId);
  const content = contentDigest(root);
  const contract = contractDigest(root, change);
  const mapped = new Set(entry.plan.delivery.suites.flatMap(s => s.scenarios.map(m => m.ref)));
  // A removed requirement creates no new scenario obligation. ADDED/MODIFIED scenarios do.
  for (const file of contract.files.filter(p => /^specs\/[^/]+\/spec\.md$/.test(p))) {
    const module = file.split('/')[1];
    let requirement = null, removed = false;
    for (const line of readFileSync(inside(root, `${contract.source}/${file}`), 'utf8').split(/\r?\n/)) {
      if (/^## /.test(line)) { removed = /^## REMOVED Requirements/.test(line); requirement = null; }
      const req = /^### Requirement:\s*(.+)$/.exec(line); if (req) requirement = req[1].trim();
      const scenario = /^#### Scenario:\s*(.+)$/.exec(line);
      if (!removed && requirement && scenario && !mapped.has(`${module} / ${requirement} / ${scenario[1].trim()}`))
        refuse('E_DELIVERY_SCENARIO', `Delta scenario has no delivery mapping: ${module} / ${requirement} / ${scenario[1].trim()}`);
    }
  }
  return { change, ...entry, binding: { change_id: changeId, candidate: content.digest,
    contract: contract.digest, plan: entry.digest }, revision: content.revision };
}
export function deliveryRuns(root, changeId) {
  const base = `.spectree/delivery/${identifier(changeId)}`;
  if (!existsSync(inside(root, base))) return [];
  return readdirSync(inside(root, base)).map(id => {
    identifier(id);
    const relative = `${base}/${id}`, start = json(root, `${relative}/started.json`);
    if (start.version !== 1 || start.change_id !== changeId || start.run_id !== id || !Number.isFinite(Date.parse(start.started_at)))
      refuse('E_DELIVERY_REPORT', 'Invalid delivery start record.');
    const file = `${relative}/finished.json`, end = existsSync(inside(root, file)) ? json(root, file) : null;
    if (end && (end.version !== 1 || end.run_id !== id || end.change_id !== changeId || !Array.isArray(end.suites)))
      refuse('E_DELIVERY_REPORT', 'Invalid delivery result record.');
    const recovery = existsSync(inside(root, `${relative}/recovery.json`)) ? json(root, `${relative}/recovery.json`) : null;
    if (recovery && (recovery.version !== 1 || recovery.run_id !== id || recovery.authorizes_execution !== false || !recovery.refs?.length))
      refuse('E_DELIVERY_REPORT', 'Invalid recovery observation.');
    return { relative, start, end, recovery };
  }).sort((a, b) => a.start.started_at.localeCompare(b.start.started_at) || a.start.run_id.localeCompare(b.start.run_id));
}
export function deliveryPreflight(root, changeId) {
  const current = deliveryIdentity(root, changeId);
  const runs = deliveryRuns(root, changeId);
  const pending = runs.filter(r => !r.end && !r.recovery);
  if (pending.length) refuse('E_DELIVERY_PENDING', `Unfinished delivery observations need inspection: ${pending.map(r => r.start.run_id).join(', ')}`);
  for (const run of runs) if (run.start.process_ref && !run.recovery && observeProcesses(root, run.start.process_ref).state !== 'stopped')
    refuse('E_DELIVERY_PROCESSES', 'A previous managed process boundary is not proven stopped.');
  const ledger = ledgerGate(root, changeId, 'implemented');
  if (!ledger.ok) refuse(ledger.code, ledger.message);
  for (const suite of current.plan.delivery.suites) {
    launchSpec(suite.command, { cwd: root }); launchSpec(suite.probe.command, { cwd: root });
  }
  return { ok: true, advisory: true, authorizes_execution: false, binding: current.binding,
    plan_path: current.path, suites: current.plan.delivery.suites.map(s => ({ id: s.id, tests: s.expected_tests.length })),
    limitations: ['Launcher transport checked; environment, credentials and consumer reporter compatibility require an observed run.',
      'The consumer must use SPECTREE_TEST_NAMESPACE to isolate its database/resources.'] };
}
export function runDelivery(root, changeId) {
  const { before, runId, relative, started } = withAuthority(root, identifier(changeId), { requireIdle: true }, () => {
    deliveryPreflight(root, changeId);
    const before = deliveryIdentity(root, changeId), runId = `run-${randomUUID()}`;
    const relative = `.spectree/delivery/${changeId}/${runId}`;
    mkdirSync(inside(root, relative), { recursive: true });
    const started = { version: 1, run_id: runId, change_id: changeId, binding: before.binding,
      process_ref: `.spectree/processes/delivery-${runId}`,
      revision: before.revision, started_at: new Date().toISOString(), pid: process.pid, host: hostname(),
      environment: { os: process.platform, runtime: process.version, ci: Boolean(process.env.CI) } };
    put(root, `${relative}/started.json`, started);
    return { before, runId, relative, started };
  });
  const startedClock = performance.now(), suites = [];
  let error = null;
  try {
    for (const suite of before.plan.delivery.suites) {
      const namespace = `spectree_${randomUUID().replaceAll('-', '')}`, clock = performance.now();
      const env = { ...process.env, SPECTREE_TEST_NAMESPACE: namespace };
      delete env.NODE_TEST_CONTEXT;
      const probes = [];
      for (const mode of ['pass', 'fail']) {
        const p = supervisedLaunch(suite.probe.command, { cwd: root, encoding: 'utf8', timeout: suite.timeout_seconds * 1000,
          maxBuffer: 1024 * 1024, env: { ...env, SPECTREE_DELIVERY_PROBE: mode },
          process_ref: `${started.process_ref}/${suite.id}-probe-${mode}` });
        const text = p.stdout ?? '';
        writeFileSync(inside(root, `${relative}/${suite.id}-probe-${mode}.tap`), text, { flag: 'wx' });
        const verdict = suiteVerdict(text, p.status, { expected_tests: [suite.probe.test], scenarios: [] });
        probes.push({ mode, exit_code: p.status, output_sha256: sha(text), verdict, process: p.process });
        if (p.error || !p.process.quiescent || verdict.result !== (mode === 'pass' ? 'PASS' : 'FAIL'))
          refuse('E_DELIVERY_PROBE', `${suite.id}: reporter ${mode} control did not produce the expected completed assertion result.`);
      }
      delete env.SPECTREE_DELIVERY_PROBE;
      const run = supervisedLaunch(suite.command, { cwd: root, encoding: 'utf8', timeout: suite.timeout_seconds * 1000,
        maxBuffer: 16 * 1024 * 1024, env, process_ref: `${started.process_ref}/${suite.id}-suite` });
      const output = run.stdout ?? '', stderr = run.stderr ?? '';
      writeFileSync(inside(root, `${relative}/${suite.id}.tap`), output, { flag: 'wx' });
      writeFileSync(inside(root, `${relative}/${suite.id}.stderr`), stderr, { flag: 'wx' });
      const verdict = run.error || run.signal || run.status === null
        ? { result: 'INFRA_ERROR', reason: run.error?.message ?? `Process did not finish normally: ${run.signal}` }
        : suiteVerdict(output, run.status, suite);
      suites.push({ id: suite.id, command: suite.command, namespace, probes, process: run.process, output_sha256: sha(output),
        stderr_sha256: sha(stderr), exit_code: run.status, elapsed_ms: performance.now() - clock, verdict });
      if (!run.process.quiescent) refuse('E_DELIVERY_PROCESSES', 'Suite process boundary could not be observed stopped.');
    }
    if (JSON.stringify(before.binding) !== JSON.stringify(deliveryIdentity(root, changeId).binding))
      refuse('E_DELIVERY_STALE', 'Candidate, contract or plan changed while the suite ran.');
  } catch (e) { error = { code: e.code ?? 'E_DELIVERY_RUN', message: e.message }; }
  const result = { version: 1, run_id: runId, change_id: changeId, binding: before.binding, suites,
    result: !error && suites.length === before.plan.delivery.suites.length && suites.every(s => s.verdict.result === 'PASS') ? 'PASS' : 'FAIL',
    error, elapsed_ms: performance.now() - startedClock, finished_at: new Date().toISOString() };
  put(root, `${relative}/finished.json`, result);
  return result;
}
export function deliveryGate(root, changeId, target) {
  if (!DELIVERY_STATES.includes(target)) return { ok: false, code: 'E_DELIVERY_TARGET', message: 'Unknown delivery milestone.' };
  const enabled = new Store(root).project()?.delivery;
  if (enabled === undefined) return { ok: true, enabled: false };
  if (enabled?.version !== 1) return { ok: false, code: 'E_DELIVERY_VERSION', message: 'Unsupported delivery policy.' };
  try {
    const ledger = ledgerGate(root, changeId, target);
    if (!ledger.ok) return ledger;
    const current = deliveryIdentity(root, changeId), runs = deliveryRuns(root, changeId);
    if (runs.some(r => !r.end && !r.recovery)) refuse('E_DELIVERY_PENDING', 'An unfinished delivery run cannot be replaced by an older success.');
    const last = runs.at(-1);
    if (!last) refuse('E_DELIVERY_MISSING', 'Run the complete delivery suite on this candidate.');
    const { start, end, relative } = last;
    if (!end) refuse('E_DELIVERY_MISSING', 'An inspected interruption still needs a fresh complete suite run.');
    if (JSON.stringify(start.binding) !== JSON.stringify(current.binding) || JSON.stringify(end.binding) !== JSON.stringify(current.binding))
      refuse('E_DELIVERY_STALE', 'Delivery evidence belongs to another candidate, contract or plan.');
    if (end.result !== 'PASS' || end.error || end.suites.length !== current.plan.delivery.suites.length)
      refuse('E_DELIVERY_FAILED', 'The latest full-suite run did not pass.');
    for (const suite of current.plan.delivery.suites) {
      const matched = end.suites.filter(s => s.id === suite.id);
      if (matched.length !== 1) refuse('E_DELIVERY_REPORT', 'Suite result missing or duplicated.');
      const record = matched[0], output = readFileSync(inside(root, `${relative}/${suite.id}.tap`), 'utf8');
      if (sha(output) !== record.output_sha256 || JSON.stringify(record.command) !== JSON.stringify(suite.command) ||
          suiteVerdict(output, record.exit_code, suite).result !== 'PASS')
        refuse('E_DELIVERY_REPORT', 'Captured suite output does not support the recorded verdict.');
      if (!record.process?.quiescent || observeProcesses(root, start.process_ref).state !== 'stopped')
        refuse('E_DELIVERY_PROCESSES', 'Managed suite processes are not proven stopped.');
      for (const mode of ['pass', 'fail']) {
        const probe = record.probes?.filter(p => p.mode === mode);
        if (probe?.length !== 1) refuse('E_DELIVERY_REPORT', 'Reporter controls are missing or duplicated.');
        const text = readFileSync(inside(root, `${relative}/${suite.id}-probe-${mode}.tap`), 'utf8');
        if (sha(text) !== probe[0].output_sha256 || suiteVerdict(text, probe[0].exit_code, { expected_tests: [suite.probe.test], scenarios: [] }).result !== (mode === 'pass' ? 'PASS' : 'FAIL'))
          refuse('E_DELIVERY_REPORT', 'Reporter controls no longer support this delivery.');
      }
    }
    return { ok: true, enabled: true, run_id: start.run_id };
  } catch (e) { return { ok: false, code: e.code ?? 'E_DELIVERY_REPORT', message: e.message }; }
}

export function recoverDelivery(root, changeId, runId, inspection) {
  return withAuthority(root, identifier(changeId), { requireIdle: true }, () => {
    const run = deliveryRuns(root, changeId).find(r => r.start.run_id === identifier(runId));
    if (!run || run.recovery || run.end?.result === 'PASS') refuse('E_DELIVERY_RECOVERY', 'Choose an unresolved or failed run, never a successful one.');
    if (run.start.host !== hostname()) refuse('E_DELIVERY_RECOVERY', 'Inspect the launch on its original host.');
    let dead = false;
    try { process.kill(run.start.pid, 0); } catch (e) { dead = e.code === 'ESRCH'; }
    if (!dead) refuse('E_DELIVERY_RECOVERY', 'The delivery writer is active or unobservable.');
    if (typeof inspection?.reason !== 'string' || !inspection.reason.trim() || !Array.isArray(inspection.refs) || !inspection.refs.length)
      refuse('E_DELIVERY_RECOVERY', 'Record the inspected effects, a reason and evidence references.');
    const processes = inspectProcesses(root, run.start.process_ref);
    const recovered = { version: 1, run_id: runId, authorizes_execution: false, at: new Date().toISOString(),
      reason: inspection.reason, refs: references(root, inspection.refs), processes };
    put(root, `${run.relative}/recovery.json`, recovered);
    return recovered;
  });
}

export function closureDeliveryPreflight(root, changeId) {
  // A malformed ledger never becomes an empty manifest, including legacy consumers.
  deliveryLedger(root, { resolveEvidence: false });
  if (new Store(root).project()?.delivery === undefined) return { ok: true, enabled: false };
  deliveryPreflight(root, changeId);
  return { ok: true, enabled: true };
}

export function deliveryMetrics(root, changeId) {
  const runs = deliveryRuns(root, changeId), complete = runs.filter(r => r.end);
  const groups = new Map();
  for (const r of runs) { const key = JSON.stringify(r.start.binding); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); }
  const samples = [...groups.values()];
  const historyFile = `.spectree/history/${identifier(changeId)}.jsonl`;
  const history = existsSync(inside(root, historyFile)) ? readFileSync(inside(root, historyFile), 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
  const implementation = history.find(e => e.type === 'transition' && e.to === 'implemented');
  const integration = history.find(e => e.type === 'transition' && e.to === 'integrated');
  const preparations = history.filter(e => e.type === 'closure_prepared');
  const span = (a, b) => a && b && Date.parse(b.at) >= Date.parse(a.at) ? Date.parse(b.at) - Date.parse(a.at) : null;
  return { version: 1, advisory: true, authorizes_execution: false, change_id: changeId,
    suite_runs: runs.length, incomplete_runs: runs.length - complete.length,
    candidates_observed: samples.length, first_attempt_passes: samples.filter(rs => rs[0].end?.result === 'PASS').length,
    infrastructure_failures: complete.filter(r => r.end.error || r.end.suites.some(s => s.verdict.result === 'INFRA_ERROR')).length,
    suite_elapsed_ms: complete.reduce((n, r) => n + r.end.elapsed_ms, 0),
    closure_preparations: preparations.length, closure_repreparations: Math.max(0, preparations.length - 1),
    closure_preparation_span_ms: span(preparations[0], preparations.at(-1)),
    implementation_to_integration_elapsed_ms: span(implementation, integration),
    model_cost_usd: null, human_wait_ms: null, queue_wait_ms: null,
    meaning: 'Observed suite attempts per candidate/contract/plan. Elapsed lifecycle time includes waits; it is not model processing time or a squad success rate.' };
}
