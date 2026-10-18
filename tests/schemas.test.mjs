// §15.1 valid and invalid documents · §15.16 approval scope · §15.13 empty required set
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../scripts/lib/shared/validate.mjs';
import { change, evidence, approval } from './helpers.mjs';

const codes = (r) => r.errors.map((e) => e.code);

test('a well-formed change validates', () => {
  assert.equal(validate('spectree/change', change()).valid, true);
});

test('a change missing base_revision is refused', () => {
  const c = change(); delete c.base_revision;
  const r = validate('spectree/change', c);
  assert.equal(r.valid, false);
  assert.ok(codes(r).includes('E_REQUIRED'));
});

test('a change with an unknown state is refused', () => {
  const r = validate('spectree/change', change({ state: 'almost_done' }));
  assert.equal(r.valid, false);
  assert.ok(codes(r).includes('E_ENUM'));
});

test('a change with an unknown property is refused, not ignored', () => {
  const r = validate('spectree/change', { ...change(), looks_fine: true });
  assert.equal(r.valid, false);
  assert.ok(codes(r).includes('E_ADDITIONAL'));
});

test('allowed_paths may not be empty — ownership is not optional', () => {
  const r = validate('spectree/change', change({ allowed_paths: [] }));
  assert.equal(r.valid, false);
  assert.ok(codes(r).includes('E_MIN_ITEMS'));
});

test('evidence accepts every one of the six results, and nothing else', () => {
  for (const result of ['PASS', 'FAIL', 'EXPECTED_REJECTION', 'INFRA_ERROR', 'NOT_RUN', 'INCONCLUSIVE']) {
    assert.equal(validate('spectree/evidence', evidence({ property: 'p', revision: 'r'.repeat(40), result })).valid, true, result);
  }
  assert.equal(validate('spectree/evidence', evidence({ property: 'p', revision: 'r'.repeat(40), result: 'GREEN' })).valid, false);
});

test('evidence must say what revision it measured', () => {
  const e = evidence({ property: 'p', revision: 'r'.repeat(40) }); delete e.revision;
  assert.equal(validate('spectree/evidence', e).valid, false);
});

test('source_kind has no "verified" value — an agent report is its own kind', () => {
  assert.equal(validate('spectree/evidence', evidence({ property: 'p', revision: 'r'.repeat(40), source_kind: 'agent_report' })).valid, true);
  assert.equal(validate('spectree/evidence', evidence({ property: 'p', revision: 'r'.repeat(40), source_kind: 'verified' })).valid, false);
});

test('an approval cannot be granted by an agent: the kind enum has no such value', () => {
  const a = approval({ gate: 'scope', revision: 'r'.repeat(40) });
  assert.equal(validate('spectree/approval', a).valid, true);
  a.granted_by = { identity: 'the invoker', kind: 'agent' };
  assert.equal(validate('spectree/approval', a).valid, false);
});

test('an approval names a gate from the closed list', () => {
  assert.equal(validate('spectree/approval', approval({ gate: 'vibes', revision: 'r'.repeat(40) })).valid, false);
});

test('a closed deferral must name what closed it', () => {
  const open = { schema_version: '1.0.0', stable_id: 1, owner: 'architect', status: 'open', impact: 'defect', current_decision: 'left for its own change' };
  assert.equal(validate('spectree/deferred', open).valid, true);
  const closed = { ...open, status: 'closed' };
  const r = validate('spectree/deferred', closed);
  assert.equal(r.valid, false, 'marking it closed is not closing it');
  assert.ok(codes(r).includes('E_REQUIRED'));
});

test('a security deferral must carry a reevaluation trigger', () => {
  const s = { schema_version: '1.0.0', stable_id: 2, owner: 'first_deploy', status: 'open', impact: 'security', current_decision: 'safe while unreachable' };
  assert.equal(validate('spectree/deferred', s).valid, false, 'the exposure gate cannot act on a trigger nobody wrote');
  assert.equal(validate('spectree/deferred', { ...s, reevaluation_trigger: 'first internet-reachable environment' }).valid, true);
});

test('a dispatch needs at least one exit criterion', () => {
  const d = {
    schema_version: '1.0.0', dispatch_id: 'd1', change_id: 'c1', role: 'full_stack_developer',
    mission: 'build it', exit_criteria: [], allowed_paths: ['src/'], attempt: 1, max_attempts: 3,
    input_revision: 'r'.repeat(40),
  };
  assert.equal(validate('spectree/dispatch', d).valid, false);
  assert.equal(validate('spectree/dispatch', { ...d, exit_criteria: ['npm test exits 0'] }).valid, true);
});

test('the validator refuses a schema keyword it cannot enforce', () => {
  // Guards against the quiet failure: a keyword nobody implemented approving everything.
  const r = validate('spectree/change', change());
  assert.deepEqual(r.errors.filter((e) => e.code === 'E_SCHEMA_KEYWORD'), []);
});
