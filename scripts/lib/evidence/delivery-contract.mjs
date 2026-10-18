import { parseTap, judgePassingRun } from '../shared/index.mjs';

const text = v => typeof v === 'string' && v.trim().length > 0;
const strings = v => Array.isArray(v) && v.length > 0 && v.every(text) && new Set(v).size === v.length;
export function deliveryContract(plan) {
  const errors = [], fail = message => errors.push({ code: 'E_DELIVERY_CONTRACT', message });
  const d = plan?.delivery;
  if (d?.version !== 1 || !Array.isArray(d.suites) || !d.suites.length || d.suites.length > 32)
    return { ok: false, errors: [{ code: 'E_DELIVERY_CONTRACT', message: 'Delivery version 1 requires 1..32 full suites.' }] };
  const ids = new Set(), covered = new Set();
  const scenarios = new Set((Array.isArray(plan.checks) ? plan.checks : []).filter(c => c?.kind === 'behavior')
    .flatMap(c => Array.isArray(c.scenario_refs) ? c.scenario_refs : []));
  for (const s of d.suites) {
    if (!s || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(s.id ?? '') || ids.has(s.id)) { fail('Every suite needs a unique safe ID.'); continue; }
    ids.add(s.id);
    if (s.format !== 'tap' || s.full_suite !== true || !Array.isArray(s.command) || !s.command.length || !s.command.every(text) ||
        !Number.isInteger(s.timeout_seconds) || s.timeout_seconds < 1 || s.timeout_seconds > 3600)
      fail(`${s.id}: declare a TAP full-suite argv command and a timeout of 1..3600 seconds.`);
    if (!Array.isArray(s.probe?.command) || !s.probe.command.length || !s.probe.command.every(text) || !text(s.probe.test))
      fail(`${s.id}: declare a reporter probe command and its exact test name.`);
    if (!strings(s.expected_tests) || s.expected_tests.length > 20000) fail(`${s.id}: declare the complete unique leaf-test inventory.`);
    if (!Array.isArray(s.scenarios)) { fail(`${s.id}: scenarios must be an array.`); continue; }
    for (const mapping of s.scenarios) {
      if (!scenarios.has(mapping?.ref) || !text(mapping?.test) || !Array.isArray(s.expected_tests) || !s.expected_tests.includes(mapping.test))
        fail(`${s.id}: each scenario must reference a behavior check and an inventoried test.`);
      else covered.add(mapping.ref);
    }
  }
  for (const ref of scenarios) if (!covered.has(ref)) fail(`Unmapped scenario: ${ref}`);
  return { ok: !errors.length, errors };
}

/** Exact inventory of leaf names; a suite/group result cannot stand in for its children. */
export function suiteVerdict(output, exitCode, suite) {
  const tap = parseTap(output);
  const parents = new Set(tap.groups.map(g => g.parentResult));
  const leaves = tap.groups.flatMap(g => g.results).filter(r => !parents.has(r));
  const names = leaves.map(r => r.name);
  const expected = new Set(suite.expected_tests), seen = new Set(), duplicates = [];
  for (const name of names) { if (seen.has(name)) duplicates.push(name); seen.add(name); }
  const missing = suite.expected_tests.filter(n => !seen.has(n));
  const unexpected = names.filter(n => !expected.has(n));
  if (missing.length || unexpected.length || duplicates.length)
    return { result: 'INFRA_ERROR', reason: 'The observed test inventory differs from the reviewed full-suite inventory.', missing, unexpected, duplicates };
  // Existing strict parser supplies completion, skipped-test and assertion-vs-crash semantics.
  const verdict = judgePassingRun(tap, suite.expected_tests[0], exitCode);
  return { result: verdict.result, reason: verdict.reason, tests: names.length,
    scenarios: suite.scenarios.map(s => s.ref) };
}
