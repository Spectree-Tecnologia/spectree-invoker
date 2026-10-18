// The core domain owes a killed mutation. Which modules are core is read from `docs/DOMAIN.md`;
// a change naming one of them, with a delta, cannot leave pass 2 on a green suite alone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, requirementsFor, ENTRY_REQUIREMENTS, CODES } from '../scripts/lib/change/state-machine.mjs';
import { coreModules, coreModulesTouched } from '../scripts/lib/change/core-domain.mjs';
import { planNext } from '../scripts/lib/change/planner.mjs';
import { tempDir, writeFiles, cleanup, change, evidence, approval } from './helpers.mjs';

const REV = 'f'.repeat(40);
const ctx = (o = {}) => ({
  approvals: [approval({ approval_id: 'ap', gate: 'scope', change_id: 'c1', scope_digest: 'D', revision: REV })],
  revision: REV, scopeDigests: { scope: 'D' }, closure: { ok: true }, ...o,
});
const attack = (property, id) => evidence({
  evidence_id: id, property, revision: REV, change_id: 'c1',
  executor: { role: 'quality_engineer', independent_of: ['full_stack_developer'] },
});

test('DOMAIN.md names the core modules on one line, and only the ones a change names count', () => {
  const root = writeFiles(tempDir('spectree-core-'), {
    'docs/DOMAIN.md': '# Domain\n\nPayroll for small firms.\n\n- **Core modules:** `payroll`, ledger\n- Supporting: accounts\n',
  });
  try {
    assert.deepEqual(coreModules(root), ['payroll', 'ledger']);
    assert.deepEqual(coreModulesTouched(root, change({ modules_named: ['accounts', 'ledger'] })), ['ledger']);
    assert.deepEqual(coreModulesTouched(root, change({ modules_named: ['accounts'] })), []);
    assert.deepEqual(coreModulesTouched(root, change({})), []);
    const bare = tempDir('spectree-core-');
    try { assert.deepEqual(coreModules(bare), [], 'no DOMAIN.md, no core: nothing is invented'); }
    finally { cleanup(bare); }
  } finally { cleanup(root); }
});

test('the mutation is owed from pass 2 to integrated, only on the core, never on a deltaless change', () => {
  const core = { coreModules: ['ledger'] };
  for (const to of ['pass2_complete', 'integration_approved', 'integrated']) {
    assert.ok(requirementsFor(change(), to, core).evidence.some((e) => e.property === 'mutation.killed'), to);
    assert.equal(requirementsFor(change(), to, {}), ENTRY_REQUIREMENTS[to], `${to}: supporting modules keep the base`);
    assert.equal(requirementsFor(change({ deltaless: true }), to, core), ENTRY_REQUIREMENTS[to], `${to}: no new rule to break`);
  }
  assert.equal(requirementsFor(change(), 'ci_green', core), ENTRY_REQUIREMENTS.ci_green);
});

test('a core change cannot close pass 2 on the attack alone; the killed mutation lets it through', () => {
  const c = change({ state: 'implemented' });
  const pass2 = attack('pass2.attack', 'e1');
  assert.equal(canTransition(c, 'pass2_complete', ctx({ evidence: [pass2] })).ok, true, 'a supporting module needs no probe');

  const refused = canTransition(c, 'pass2_complete', ctx({ evidence: [pass2], coreModules: ['ledger'] }));
  assert.equal(refused.code, CODES.MISSING_EVIDENCE);
  assert.equal(refused.detail.property, 'mutation.killed');

  const byBuilder = evidence({ evidence_id: 'e3', property: 'mutation.killed', revision: REV, change_id: 'c1',
    executor: { role: 'full_stack_developer', independent_of: [] } });
  assert.equal(canTransition(c, 'pass2_complete', ctx({ evidence: [pass2, byBuilder], coreModules: ['ledger'] })).code,
    CODES.NOT_INDEPENDENT, 'the builder cannot prove its own rule');

  const killed = attack('mutation.killed', 'e2');
  assert.equal(canTransition(c, 'pass2_complete', ctx({ evidence: [pass2, killed], coreModules: ['ledger'] })).ok, true);
});

test('the planner sends a missing mutation to the Quality Engineer', () => {
  const c = change({ state: 'implemented', closure_mode: 'legacy' });
  const plan = planNext(c, ctx({ evidence: [attack('pass2.attack', 'e1')], coreModules: ['ledger'] }), { isolationSignal: true });
  assert.equal(plan.property, 'mutation.killed');
  assert.equal(plan.role, 'quality_engineer');
});
