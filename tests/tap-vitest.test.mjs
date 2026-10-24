// Vitest 5 prints a group's verdict BEFORE its children, wrapped in braces, and appends its timing
// to every line. Until v1.56.0 that shape was unreadable: every nested Vitest run judged INFRA_ERROR.
// The fixture is recorded from `vitest run --reporter=tap` (Vitest 5.0.5) over this file:
//   describe('account') > describe('name') > it('rejects a blank name') passing, it('fails on purpose') failing;
//   describe('account') > it.skip('later'); it('top level') passing. Only the absolute path was replaced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTap, judgeFailingRun, judgePass1Run, judgeNamedPasses } from '../scripts/lib/shared/tap.mjs';

const recorded = readFileSync(new URL('./fixtures/vitest-5.0.5-nested.tap', import.meta.url), 'utf8');

test('a recorded nested Vitest run is read as a tree, with names free of timing and braces', () => {
  const tap = parseTap(recorded);
  assert.deepEqual(tap.problems, []);
  assert.deepEqual(tap.groups.map((g) => [g.results.map((r) => r.name), g.parentResult?.name ?? null]), [
    [['a.test.mjs'], null],
    [['account', 'top level'], 'a.test.mjs'],
    [['name', 'later'], 'account'],
    [['rejects a blank name', 'fails on purpose'], 'name'],
  ]);
  assert.equal(judgeFailingRun(tap, 'fails on purpose', 1).result, 'PASS');
  assert.equal(judgePass1Run(tap, { failing: ['fails on purpose'], passing: ['rejects a blank name'] }, 1).result, 'PASS',
    'the diagnostic Vitest nests under error: is read as an assertion');
  assert.equal(judgeNamedPasses(tap, ['rejects a blank name', 'top level']).result, 'PASS');
});

test('the Vitest shape keeps every refusal: a group name, a skip, a failure and a cut run', () => {
  const tap = parseTap(recorded);
  assert.equal(judgeNamedPasses(tap, ['account']).result, 'FAIL', 'a group verdict is not a test');
  assert.equal(judgeNamedPasses(tap, ['later']).result, 'FAIL', 'skipped');
  assert.equal(judgeNamedPasses(tap, ['fails on purpose']).result, 'FAIL');
  const cut = recorded.split('\n').slice(0, 12).join('\n');
  assert.equal(judgeNamedPasses(parseTap(cut), ['rejects a blank name']).result, 'INFRA_ERROR', 'a run cut short judges nothing');
  const passingParent = recorded.replace('not ok 1 - name # time', 'ok 1 - name # time');
  assert.equal(judgeFailingRun(parseTap(passingParent), 'fails on purpose', 1).result, 'INFRA_ERROR',
    'a group that passed over a failing child describes two different runs');
});
