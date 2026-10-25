// The probe's install cache: a successful setup's declared paths, keyed by what decides them, copied
// (never linked) into the next disposable copy. The baseline runs either way.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gitRepo, cleanup, writeFiles } from './helpers.mjs';
import { runMutation } from '../scripts/lib/evidence/mutation.mjs';

function fixture() {
  const r = gitRepo({ 'math.cjs': "module.exports = (n) => require('dep')(n) + 1;\n",
    'package-lock.json': '{"lockfileVersion":3}\n',
    'math.test.cjs': "const {test}=require('node:test');const assert=require('node:assert/strict');test('preserves value',()=>{require('node:fs').appendFileSync('node_modules/dep/touched','x');assert.equal(require('./math.cjs')(1),2)});\n",
    '.gitignore': 'node_modules/\n' });
  const outside = mkdtempSync(join(tmpdir(), 'spectree-cache-test-'));
  process.env.SPECTREE_PROBE_CACHE = join(outside, 'cache');
  const count = join(outside, 'setups');
  writeFileSync(count, '');
  // The setup installs the dependency and counts itself, outside the copy.
  const setup = [process.execPath, '-e', `const fs=require('node:fs');fs.mkdirSync('node_modules/dep',{recursive:true});fs.writeFileSync('node_modules/dep/index.js','module.exports=(n)=>n');fs.appendFileSync(${JSON.stringify(count)},'x')`];
  const plan = { target: 'math.cjs', before: '+ 1', after: '+ 2', test_name: 'preserves value', setup_command: setup,
    setup_cache: { key_files: ['package-lock.json'], paths: ['node_modules'] },
    command: [process.execPath, '--test', '--test-reporter=tap', 'math.test.cjs'], timeout_seconds: 20 };
  const setups = () => readFileSync(count, 'utf8').length;
  const entries = () => readdirSync(process.env.SPECTREE_PROBE_CACHE).filter((d) => !d.startsWith('incoming-'));
  const drop = () => { cleanup(r.root); rmSync(outside, { recursive: true, force: true }); delete process.env.SPECTREE_PROBE_CACHE; };
  return { ...r, plan, setups, entries, drop };
}

test('a stored setup is copied into the next probe, and its baseline still runs', () => {
  const f = fixture();
  try {
    const first = runMutation(f.root, f.plan, { apply: true });
    assert.equal(first.result, 'PASS', first.reason); assert.equal(first.setup.cache, 'stored');
    const second = runMutation(f.root, f.plan, { apply: true });
    assert.equal(second.result, 'PASS', second.reason); assert.equal(second.setup.cache, 'hit');
    assert.equal(second.setup.cache_key, first.setup.cache_key);
    assert.equal(second.baseline.result, 'PASS');
    assert.equal(f.setups(), 1, 'the second probe did not run the setup');
  } finally { f.drop(); }
});

test('a hit is a copy: what the probe writes under the cached paths never reaches the entry', () => {
  const f = fixture();
  try {
    runMutation(f.root, f.plan, { apply: true });
    const [entry] = f.entries();
    // The test itself writes node_modules/dep/touched in the copy, on the baseline and on the mutant.
    assert.deepEqual(readdirSync(join(process.env.SPECTREE_PROBE_CACHE, entry, 'node_modules/dep')), ['index.js']);
    runMutation(f.root, f.plan, { apply: true });
    assert.deepEqual(readdirSync(join(process.env.SPECTREE_PROBE_CACHE, entry, 'node_modules/dep')), ['index.js']);
  } finally { f.drop(); }
});

test('a changed key file is another key, and the setup runs again', () => {
  const f = fixture();
  try {
    const first = runMutation(f.root, f.plan, { apply: true });
    writeFiles(f.root, { 'package-lock.json': '{"lockfileVersion":3,"packages":{}}\n' });
    const second = runMutation(f.root, f.plan, { apply: true });
    assert.equal(second.setup.cache, 'stored'); assert.notEqual(second.setup.cache_key, first.setup.cache_key);
    assert.equal(f.setups(), 2);
  } finally { f.drop(); }
});

test('a spoiled entry shows as a red baseline that names the cached setup', () => {
  const f = fixture();
  try {
    runMutation(f.root, f.plan, { apply: true });
    const [entry] = f.entries();
    writeFileSync(join(process.env.SPECTREE_PROBE_CACHE, entry, 'node_modules/dep/index.js'), 'module.exports=(n)=>n*10');
    const spoiled = runMutation(f.root, f.plan, { apply: true });
    assert.equal(spoiled.setup.cache, 'hit'); assert.notEqual(spoiled.result, 'PASS');
    assert.match(spoiled.reason, new RegExp(`cached setup ${entry}`));
  } finally { f.drop(); }
});

test('the cache is declared with a setup, never covers a candidate file and never lives in the checkout', () => {
  const f = fixture();
  try {
    const { setup_command: _, ...noSetup } = f.plan;
    assert.throws(() => runMutation(f.root, noSetup), { code: 'E_MUTATION_PLAN' });
    assert.throws(() => runMutation(f.root, { ...f.plan, setup_cache: { key_files: ['package-lock.json'], paths: ['../outside'] } }), { code: 'E_MUTATION_PLAN' });
    for (const paths of [['.'], ['math.cjs'], ['./']]) {
      assert.throws(() => runMutation(f.root, { ...f.plan, setup_cache: { key_files: ['package-lock.json'], paths } }, { apply: true }), { code: 'E_MUTATION_PLAN' });
    }
    assert.throws(() => runMutation(f.root, { ...f.plan, setup_cache: { key_files: ['missing.json'], paths: ['node_modules'] } }, { apply: true }), { code: 'E_MUTATION_PLAN' });
    process.env.SPECTREE_PROBE_CACHE = join(f.root, 'cache');
    assert.throws(() => runMutation(f.root, f.plan, { apply: true }), { code: 'E_MUTATION_TEMP' });
  } finally { f.drop(); }
});

test('a folder without the marker is never a hit, and the next store replaces it', () => {
  const f = fixture();
  try {
    const first = runMutation(f.root, f.plan, { apply: true });
    const dir = join(process.env.SPECTREE_PROBE_CACHE, first.setup.cache_key);
    rmSync(join(dir, '.spectree-cache-complete'));
    const second = runMutation(f.root, f.plan, { apply: true });
    assert.equal(second.setup.cache, 'stored', JSON.stringify(second.setup));
    assert.equal(runMutation(f.root, f.plan, { apply: true }).setup.cache, 'hit');
    assert.equal(f.setups(), 2);
  } finally { f.drop(); }
});

test('a setup that produced none of the declared paths stores nothing', () => {
  const f = fixture();
  try {
    const plan = { ...f.plan, setup_cache: { key_files: ['package-lock.json'], paths: ['node_module'] } };
    const run = runMutation(f.root, plan, { apply: true });
    assert.deepEqual([run.setup.cache, run.setup.cache_error], ['miss', 'NO_DECLARED_PATH']);
    assert.equal(runMutation(f.root, plan, { apply: true }).setup.cache, 'miss');
  } finally { f.drop(); }
});

test('a cache folder open to others is refused before any hit', { skip: process.getuid === undefined }, () => {
  const f = fixture();
  try {
    runMutation(f.root, f.plan, { apply: true });
    chmodSync(process.env.SPECTREE_PROBE_CACHE, 0o777);
    assert.throws(() => runMutation(f.root, f.plan, { apply: true }), { code: 'E_MUTATION_TEMP' });
  } finally { f.drop(); }
});

test('a setup that leaves a link outside its declared path stores nothing', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  try {
    const setup = [...f.plan.setup_command.slice(0, 2), `${f.plan.setup_command[2]};fs.symlinkSync(require('node:os').tmpdir(),'node_modules/escape')`];
    const run = runMutation(f.root, { ...f.plan, setup_command: setup }, { apply: true });
    assert.deepEqual([run.setup.cache, run.setup.cache_error], ['miss', 'LINK_ESCAPES']);
    assert.deepEqual(f.entries(), []);
  } finally { f.drop(); }
});
