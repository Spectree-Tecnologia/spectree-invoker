// Pass 1 as the squad actually runs it: many Scenarios red in one run, preserved regressions
// green beside them, and each red reaching the assertion that states its Scenario.
//
// The case that motivated it: a consumer on Vitest (sindy-agent, changes 1 and 2) needed a stub
// of the module surface before pass 1, because a test that calls code which does not exist yet
// fails on the import and not on the Scenario. The runner accepted that red; it no longer does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTap, judgePass1Run, judgeMutationRun } from '../scripts/lib/shared/tap.mjs';
import { consumer, upToImplemented } from './cli-cycle-fixture.mjs';

// `vitest run --reporter=tap-flat`, as Vitest 3 prints it (paths shortened).
const VITEST = [
  'TAP version 13',
  '1..5',
  'not ok 1 - t/a.test.ts > R > stub red # time=15.67ms',
  '    ---',
  '    error:',
  '        name: "AssertionError"',
  `        message: "expected { ok: false, error: 'NOT_IMPLEMENTED' } to deeply equal { ok: true }"`,
  '    at: "t/a.test.ts:4:41"',
  '    actual: "Object {',
  '  \\"error\\": \\"NOT_IMPLEMENTED\\",',
  '  \\"ok\\": false,',
  '}"',
  '    ...',
  'not ok 2 - t/a.test.ts > R > rejects instead # time=4.71ms',
  '    ---',
  '    error:',
  '        name: "AssertionError"',
  '        message: "promise rejected \\"Error: sql\\" instead of resolving"',
  '    ...',
  'not ok 3 - t/a.test.ts > R > crash # time=0.89ms',
  '    ---',
  '    error:',
  '        name: "TypeError"',
  `        message: "Cannot read properties of undefined (reading 'x')"`,
  '    ...',
  'not ok 4 - t/a.test.ts > R > missing import # time=7.19ms',
  '    ---',
  '    error:',
  '        name: "Error"',
  `        message: "Cannot find module './nope.ts'"`,
  '    ...',
  'ok 5 - t/a.test.ts > R > pinned # time=0.35ms',
].join('\n');

const V = (it) => `t/a.test.ts > R > ${it}`;

test('Vitest names lose their timing suffix, and its nested diagnostic is read', () => {
  const tap = parseTap(VITEST);
  const results = tap.groups.flatMap((g) => g.results);
  assert.deepEqual(results.map((r) => r.name), ['stub red', 'rejects instead', 'crash', 'missing import', 'pinned'].map(V));
  assert.deepEqual(results.map((r) => r.diagnostic.name), ['AssertionError', 'AssertionError', 'TypeError', 'Error', undefined]);
  // A killed mutant on Vitest is now provable: the assertion diagnostic is no longer invisible.
  assert.equal(judgeMutationRun(tap, V('stub red'), 1).result, 'PASS');
});

test('pass 1 accepts a red only where it reached its assertion', () => {
  const tap = parseTap(VITEST);
  const all = judgePass1Run(tap, { failing: [V('stub red'), V('rejects instead')], passing: [V('pinned')] }, 1);
  assert.equal(all.result, 'PASS', all.reason);
  assert.equal(all.failing.length, 2);
  assert.equal(all.passing.length, 1);

  for (const [it, kind] of [['crash', 'TypeError'], ['missing import', 'Error']]) {
    const v = judgePass1Run(tap, { failing: [V('stub red'), V(it)] }, 1);
    assert.equal(v.result, 'INFRA_ERROR', `${it} never reached its assertion`);
    assert.match(v.reason, new RegExp(`failed with ${kind} before reaching its assertion`));
    assert.match(v.reason, /stub the surface/);
  }
});

test('node --test diagnostics are judged the same way', () => {
  const tap = parseTap([
    'TAP version 13',
    'not ok 1 - a',
    '  ---',
    "  failureType: 'testCodeFailure'",
    "  code: 'ERR_ASSERTION'",
    "  name: 'AssertionError'",
    '  ...',
    'not ok 2 - b',
    '  ---',
    "  code: 'ERR_TEST_FAILURE'",
    "  name: 'TypeError'",
    '  ...',
    '1..2',
  ].join('\n'));
  assert.equal(judgePass1Run(tap, { failing: ['a'] }, 1).result, 'PASS');
  assert.equal(judgePass1Run(tap, { failing: ['b'] }, 1).result, 'INFRA_ERROR');
});

test('a runner that gives no reason is taken at its word, as before', () => {
  const tap = parseTap('TAP version 13\n1..1\nnot ok 1 - Scenario: x\n');
  const v = judgePass1Run(tap, { failing: ['Scenario: x'] }, 1);
  assert.equal(v.result, 'PASS');
  assert.equal(v.reason, '"Scenario: x" ran and failed');
});

test('a preserved regression that went red fails pass 1, and a missing one is not a pass', () => {
  const tap = parseTap(VITEST);
  const red = judgePass1Run(tap, { failing: [V('stub red')], passing: [V('rejects instead')] }, 1);
  assert.equal(red.result, 'FAIL');
  assert.match(red.reason, /preserved regression .* failed/);
  const absent = judgePass1Run(tap, { failing: [V('stub red')], passing: [V('never written')] }, 1);
  assert.equal(absent.result, 'INFRA_ERROR');
  assert.equal(judgePass1Run(tap, { failing: [] }, 1).result, 'INFRA_ERROR', 'nothing red validates nothing');
  assert.equal(judgePass1Run(tap, { failing: [V('pinned')], passing: [V('pinned')] }, 1).result, 'INFRA_ERROR', 'one name cannot be both');
});

test('state.mjs run records the whole of pass 1 from --expect-from, and refuses mixing it with --expect-failing', () => {
  const c = consumer();
  try {
    upToImplemented(c);
    writeFileSync(join(c.root, 'pass1.json'), JSON.stringify({ failing: [V('stub red'), V('rejects instead')], passing: [V('pinned')] }));
    writeFileSync(join(c.root, 'pass1.tap'), VITEST);
    c.git(['add', '-A']); c.git(['commit', '-qm', 'pass 1 expectation']);
    const print = ['--', process.execPath, '-e', "process.stdout.write(require('fs').readFileSync('pass1.tap','utf8'));process.exit(1)"];

    const ok = c.cli('run', 'c1', 'pass1.tests_failing', '--role', 'quality_engineer', '--expect-from', 'pass1.json', '--id', 'e-list', ...print);
    assert.equal(ok.code, 0, ok.err);
    const ev = JSON.parse(readFileSync(join(c.root, '.spectree/evidence/e-list.json'), 'utf8'));
    assert.equal(ev.result, 'PASS');
    assert.deepEqual(ev.expected_tests.passing, [V('pinned')]);
    assert.equal(ev.negative_control.observed_signal.split('\n').length, 2);

    writeFileSync(join(c.root, 'pass1.json'), JSON.stringify({ failing: [V('stub red'), V('crash')] }));
    c.git(['add', '-A']); c.git(['commit', '-qm', 'a red that never reached its assertion']);
    const crash = c.cli('run', 'c1', 'pass1.tests_failing', '--role', 'quality_engineer', '--expect-from', 'pass1.json', '--id', 'e-crash', ...print);
    assert.equal(crash.code, 1);
    assert.match(crash.err, /TypeError before reaching its assertion/);

    const both = c.cli('run', 'c1', 'pass1.tests_failing', '--role', 'quality_engineer', '--expect-from', 'pass1.json',
      '--expect-failing', V('stub red'), ...print);
    assert.equal(both.code, 2);
    assert.match(both.err, /pass one of them/);

    const wrong = c.cli('run', 'c1', 'ci.green', '--role', 'platform_engineer', '--expect-from', 'pass1.json', ...print);
    assert.equal(wrong.code, 2);
    assert.match(wrong.err, /--expect-from is not available/);
  } finally { c.drop(); }
});
