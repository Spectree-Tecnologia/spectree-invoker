// Behavioural evaluations — a DIFFERENT KIND of check from the rest of this suite.
//
// The deterministic tests assert what the code does. These assert only that each
// evaluation fixture is well formed and that the arithmetic inside one of them is
// what it claims. **They do not demonstrate how an agent behaves**, and a green here
// is not evidence about any agent: a mock cannot exhibit judgement.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './helpers.mjs';

const fixture = JSON.parse(readFileSync(join(REPO, 'tests/fixtures/evaluations.json'), 'utf8'));

test('every evaluation names the trap, the correct answer and the wrong one', () => {
  assert.ok(fixture.evaluations.length >= 6);
  for (const e of fixture.evaluations) {
    for (const k of ['id', 'situation', 'trap', 'correct', 'wrong', 'mechanised_by']) {
      assert.ok(e[k], `${e.id ?? '?'} missing ${k}`);
    }
  }
});

test('each evaluation says whether it is mechanised, and some honestly are not', () => {
  const unmechanised = fixture.evaluations.filter((e) => /^not mechanised/.test(e.mechanised_by));
  assert.ok(unmechanised.length > 0,
    'if every evaluation claimed a mechanism, the set would be hiding the judgements no check can make');
});

test('the accumulation fixture: the exact answer is 2, and naive accumulation loses it', () => {
  const values = [Number.MAX_SAFE_INTEGER, 2, -Number.MAX_SAFE_INTEGER];

  const exact = values.map((v) => BigInt(v)).reduce((a, b) => a + b, 0n);
  assert.equal(exact, 2n, 'the exact answer is 2');

  const declared = fixture.evaluations.find((e) => e.id === 'eval-accumulation-error');
  assert.equal(declared.exact_answer, 2, 'the fixture records the exact answer, not an accumulated one');

  // Measured, not assumed: the naive total is wrong AND depends on the order.
  const forward = values.reduce((a, b) => a + b, 0);
  const backward = [...values].reverse().reduce((a, b) => a + b, 0);
  assert.equal(forward, 1, 'left to right loses part of the 2 to rounding once the sum leaves the safe range');
  assert.equal(backward, 2, 'right to left never leaves the safe range and lands on the exact answer');
  assert.notEqual(forward, backward,
    'order dependence is the signal: a total that changes with the order of its inputs is not a total');
  assert.notEqual(BigInt(forward), exact, 'and the forward total simply disagrees with the exact one');
});

test('the fixture set is not presented as proof of agent behaviour', () => {
  assert.match(fixture.$comment, /NOT tests of an agent/);
  assert.match(fixture.$comment, /mock cannot demonstrate/);
});
