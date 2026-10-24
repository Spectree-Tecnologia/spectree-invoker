import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gitRepo, cleanup, writeFiles } from './helpers.mjs';
import { runMutation, candidateFiles } from '../scripts/lib/evidence/mutation.mjs';
import { resolveOnPath, launch } from '../scripts/lib/shared/launch.mjs';

function fixture() {
  return gitRepo({ 'math.cjs': 'module.exports = (n) => n + 1;\n',
    'math.test.cjs': "const {test}=require('node:test');const assert=require('node:assert/strict');test('preserves value',()=>assert.equal(require('./math.cjs')(1),2));\n",
    '.gitignore': '.spectree/\nnode_modules/\n.env\n' });
}
const plan = () => ({ target: 'math.cjs', before: 'n + 1', after: 'n + 2', test_name: 'preserves value',
  command: [process.execPath, '--test', '--test-reporter=tap', 'math.test.cjs'], timeout_seconds: 10 });
test('dry run writes nothing and a killed mutant leaves the original bytes and index intact', () => {
  const r = fixture();
  try {
    const before = readFileSync(join(r.root, 'math.cjs'), 'utf8'); const status = r.git(['status', '--porcelain']);
    assert.equal(runMutation(r.root, plan()).dry_run, true);
    assert.equal(r.git(['status', '--porcelain']), status);
    const result = runMutation(r.root, plan(), { apply: true });
    assert.doesNotThrow(() => JSON.stringify(result), 'CLI output must not contain circular TAP group references');
    assert.equal(result.baseline.result, 'PASS'); assert.equal(result.result, 'PASS');
    assert.equal(readFileSync(join(r.root, 'math.cjs'), 'utf8'), before);
    assert.equal(r.git(['status', '--porcelain']), status);
  } finally { cleanup(r.root); }
});
test('surviving mutation is a failed discrimination check', () => {
  const r = fixture();
  try { assert.equal(runMutation(r.root, { ...plan(), after: '1 + n' }, { apply: true }).result, 'FAIL'); }
  finally { cleanup(r.root); }
});
test('a crash or truncated TAP is not a killed mutant', () => {
  const r = fixture();
  try { assert.equal(runMutation(r.root, { ...plan(), after: '!' }, { apply: true }).result, 'INFRA_ERROR'); }
  finally { cleanup(r.root); }
});
test('baseline must contain the exact named test and be green', () => {
  const r = fixture();
  try {
    assert.equal(runMutation(r.root, { ...plan(), test_name: 'missing test' }, { apply: true }).result, 'INFRA_ERROR');
    writeFileSync(join(r.root, 'math.cjs'), 'module.exports = (n) => n + 2;\n');
    assert.equal(runMutation(r.root, { ...plan(), before: 'n + 2', after: 'n + 3' }, { apply: true }).result, 'INFRA_ERROR');
  } finally { cleanup(r.root); }
});
test('copies the dirty candidate while excluding local environment files and operational state', () => {
  const r = fixture();
  try {
    writeFiles(r.root, { '.env': 'DO_NOT_COPY=secret', '.spectree/local.json': '{}', 'extra.txt': 'untracked candidate' });
    assert.ok(candidateFiles(r.root).includes('extra.txt'));
    assert.ok(!candidateFiles(r.root).includes('.env'));
    const p = { ...plan(), setup_command: [process.execPath, '-e', "const fs=require('node:fs');if(fs.existsSync('.env')||fs.existsSync('.spectree')||process.env.SPECTREE_TEST_SECRET)process.exit(1);if(!fs.existsSync('extra.txt'))process.exit(2)"] };
    process.env.SPECTREE_TEST_SECRET = 'do-not-inherit';
    try { assert.equal(runMutation(r.root, p, { apply: true }).result, 'PASS'); }
    finally { delete process.env.SPECTREE_TEST_SECRET; }
    assert.equal(existsSync(join(r.root, '.env')), true);
  } finally { cleanup(r.root); }
});
test('rejects ambiguous patches, traversal and commands with no timeout', () => {
  const r = fixture();
  try {
    assert.throws(() => runMutation(r.root, { ...plan(), before: 'missing' }), { code: 'E_MUTATION_MATCH' });
    assert.throws(() => runMutation(r.root, { ...plan(), target: '../math.cjs' }), { code: 'E_WORK_PATH' });
    assert.throws(() => runMutation(r.root, { ...plan(), timeout_seconds: undefined }), { code: 'E_MUTATION_PLAN' });
    assert.throws(() => runMutation(r.root, { ...plan(), after: plan().before }), { code: 'E_MUTATION_PLAN' });
  } finally { cleanup(r.root); }
});
test('timeout in a discarded copy leaves the source untouched', () => {
  const r = fixture();
  try {
    const before = readFileSync(join(r.root, 'math.cjs'), 'utf8');
    const result = runMutation(r.root, { ...plan(), command: [process.execPath, '-e', 'setTimeout(()=>{},60000)'], timeout_seconds: 1 }, { apply: true });
    assert.equal(result.result, 'INFRA_ERROR');
    assert.equal(readFileSync(join(r.root, 'math.cjs'), 'utf8'), before);
  } finally { cleanup(r.root); }
});

test('setup cannot rewrite a copied test to manufacture a positive control', () => {
  const r = fixture();
  try {
    const before = readFileSync(join(r.root, 'math.test.cjs'), 'utf8');
    const p = { ...plan(), setup_command: [process.execPath, '-e', "require('node:fs').writeFileSync('math.test.cjs','// replaced')"] };
    assert.throws(() => runMutation(r.root, p, { apply: true }), { code: 'E_MUTATION_SETUP_CHANGED' });
    assert.equal(readFileSync(join(r.root, 'math.test.cjs'), 'utf8'), before);
  } finally { cleanup(r.root); }
});

test('Windows shims resolve from the command cwd and supplied environment', () => {
  const r = fixture();
  try {
    writeFiles(r.root, { 'tools/probe.cmd': '@echo off\r\necho copied-command\r\n' });
    assert.equal(resolveOnPath('./tools/probe.cmd', { platform: 'win32', cwd: r.root }), join(r.root, 'tools/probe.cmd'));
    if (process.platform === 'win32') {
      const result = launch(['probe'], { cwd: r.root, env: { ...process.env, PATH: join(r.root, 'tools'), PATHEXT: '.CMD' }, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /copied-command/);
    }
  } finally { cleanup(r.root); }
});

// A batch shares one copy, one setup and one baseline. The SYND C3a pass 2 ran 75 mutations as 75
// copies, 75 setups and 150 suites.
const batch = (mutations, extra = {}) => ({ command: plan().command, timeout_seconds: 10, mutations, ...extra });
const m = (id, after, before = 'n + 1') => ({ id, target: 'math.cjs', before, after, test_name: 'preserves value' });
test('a batch kills each mutant over one baseline, reverting the copy between mutants', () => {
  const r = fixture();
  try {
    const before = readFileSync(join(r.root, 'math.cjs'), 'utf8');
    // The second mutant reads the fragment the first one replaced: it only applies if the copy was reverted.
    const result = runMutation(r.root, batch([m('plus-two', 'n + 2'), m('minus-one', 'n - 1')]), { apply: true });
    assert.equal(result.result, 'PASS', result.reason);
    assert.equal(result.baseline.result, 'PASS');
    assert.deepEqual(result.mutations.map((x) => [x.id, x.result]), [['plus-two', 'PASS'], ['minus-one', 'PASS']]);
    assert.equal(readFileSync(join(r.root, 'math.cjs'), 'utf8'), before);
  } finally { cleanup(r.root); }
});
test('one survivor fails the batch and is named; a mutant command may run only the killing test', () => {
  const r = fixture();
  try {
    const survived = runMutation(r.root, batch([m('plus-two', 'n + 2'), m('commuted', '1 + n')]), { apply: true });
    assert.equal(survived.result, 'FAIL'); assert.match(survived.reason, /1 of 2 mutation\(s\) survived: commuted/);
    const narrowed = batch([m('plus-two', 'n + 2')], {
      mutant_command: [process.execPath, '--test', '--test-reporter=tap', '--test-name-pattern={test_name}', 'math.test.cjs'] });
    assert.equal(runMutation(r.root, narrowed, { apply: true }).result, 'PASS');
  } finally { cleanup(r.root); }
});
test('a batch refuses repeated ids, unknown fields and an empty list before copying anything', () => {
  const r = fixture();
  try {
    assert.throws(() => runMutation(r.root, batch([m('a', 'n + 2'), m('a', 'n - 1')])), { code: 'E_MUTATION_PLAN' });
    assert.throws(() => runMutation(r.root, batch([{ ...m('a', 'n + 2'), extra: 1 }])), { code: 'E_MUTATION_PLAN' });
    assert.throws(() => runMutation(r.root, batch([])), { code: 'E_MUTATION_PLAN' });
    assert.throws(() => runMutation(r.root, { ...batch([m('a', 'n + 2')]), target: 'math.cjs' }), { code: 'E_MUTATION_PLAN' });
    assert.throws(() => runMutation(r.root, batch([m('a', 'n + 2', 'absent')])), { code: 'E_MUTATION_MATCH' });
  } finally { cleanup(r.root); }
});
