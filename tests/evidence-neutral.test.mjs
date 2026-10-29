// Documentation and the platform log do not invalidate a measurement of the code. In the SYND C3a
// a DEFERRED line and a README edit each cost a full suite and pass 2 again, and every Platform
// Engineer action appends to `.log/platform.log`. A run is carried forward only when the content
// differs from it in declared evidence-neutral paths alone; approvals still bind the whole content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentDigest } from '../scripts/lib/shared/index.mjs';
import { neutralPaths } from '../scripts/lib/evidence/index.mjs';
import { canTransition, measuredOn, CODES } from '../scripts/lib/change/state-machine.mjs';
import { stateCommand } from '../scripts/lib/closure/state.mjs';
import { Store } from '../scripts/lib/change/store.mjs';
import { gitRepo, cleanup, change, evidence, approval } from './helpers.mjs';

const files = { 'src/a.js': 'export const a = 1;\n', '.log/platform.log': 'start\n', '.log/run.js': '1;\n',
  'docs/DEFERRED.md': '# D\n', 'README.md': '# R\n' };
const digestAfter = (edit, declared) => {
  const r = gitRepo(files);
  try {
    const { neutral } = neutralPaths(declared);
    const before = contentDigest(r.root, { neutral });
    appendFileSync(join(r.root, edit), 'more\n');
    const after = contentDigest(r.root, { neutral });
    assert.notEqual(before.digest, after.digest, 'the content itself always moves');
    return before.code_digest === after.code_digest;
  } finally { cleanup(r.root); }
};

test('only declared documentation is neutral: the log by default, nothing that is code', () => {
  assert.equal(digestAfter('.log/platform.log'), true, 'the platform log is neutral by default');
  assert.equal(digestAfter('docs/DEFERRED.md'), false, 'documentation is not neutral until declared');
  assert.equal(digestAfter('docs/DEFERRED.md', ['.log/', 'docs/DEFERRED.md', 'README.md']), true);
  assert.equal(digestAfter('src/a.js', ['.log/', 'src/']), false, 'declaring source neutral neutralises nothing');
  assert.equal(digestAfter('.log/run.js'), false, 'a script under .log/ is still code');
  const r = gitRepo(files);
  try { assert.equal(contentDigest(r.root).code_digest, undefined, 'no predicate, no code digest'); } finally { cleanup(r.root); }
});

test('a malformed neutral list is a refusal, not an empty list', () => {
  for (const bad of ['docs/', [''], [3], {}]) assert.throws(() => neutralPaths(bad), { code: 'E_NEUTRAL_PATHS' });
});

const REV = 'f'.repeat(40);
const scope = approval({ approval_id: 'ap-scope', gate: 'scope', change_id: 'c1', scope_digest: 'D-scope', revision: REV });
const run = (o = {}) => ({ ...evidence({ property: 'ci.green', revision: REV, change_id: 'c1', fingerprint: 'content-then', ...o }),
  code_fingerprint: o.code ?? 'code-same', neutral_paths: o.list ?? ['.log/'] });
const gate = (ev, o = {}) => canTransition(change({ state: 'pass2_complete' }), 'ci_green', {
  approvals: [scope], revision: REV, scopeDigests: { scope: 'D-scope' }, evidence: ev,
  contentDigest: 'content-now', codeDigest: 'code-same', neutralPaths: ['.log/'], ...o });

test('a run that differs from now only in neutral paths is carried forward, and says so', () => {
  const r = gate([run()]);
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(r.carried_forward, [{ property: 'ci.green', evidence_ids: ['e1'], neutral_paths: ['.log/'] }]);
  assert.equal(gate([run({ fingerprint: 'content-now' })]).carried_forward, undefined, 'an exact run is not carried');
});

test('changed code, a widened list or a newer red on the exact content refuse the carry', () => {
  assert.equal(gate([run({ code: 'code-other' })]).code, CODES.CONTENT_CHANGED);
  assert.equal(gate([run()], { neutralPaths: ['.log/', 'README.md'] }).code, CODES.CONTENT_CHANGED);
  const red = run({ evidence_id: 'e2', fingerprint: 'content-now', result: 'FAIL' });
  assert.equal(gate([run(), red]).code, CODES.EVIDENCE_NOT_PASS, 'a red measured on the content now outranks a carried green');
  assert.equal(measuredOn({ fingerprint: 'x' }, { contentDigest: 'y' }), null, 'a run with no code fingerprint is never carried');
});

test('state.mjs records the code fingerprint and reports a carried run as valid after a log line', () => {
  const r = gitRepo({ 'ok.test.cjs': "require('node:test')('ok', () => {});\n", '.log/platform.log': 'start\n' });
  const quiet = { out: () => {}, err: () => {} };
  try {
    const cli = (...argv) => stateCommand({ root: r.root, argv, ...quiet });
    assert.equal(cli('init', 'synthetic'), 0);
    r.git(['add', '-A']); r.git(['commit', '-qm', 'init']);
    const base = r.git(['rev-parse', 'HEAD']).trim();
    assert.equal(cli('open', 'c1', '--type', 'feature', '--base', base, '--deltaless', '--scope', 'neutral paths', '--paths', 'ok.test.cjs', '--closure-mode', 'legacy'), 0);
    // The run inherits this process's environment, and a nested runner reports to its parent.
    const context = process.env.NODE_TEST_CONTEXT; delete process.env.NODE_TEST_CONTEXT;
    try { assert.equal(cli('run', 'c1', 'suite.baseline', '--role', 'platform_engineer', '--', process.execPath, '--test', 'ok.test.cjs'), 0); }
    finally { if (context !== undefined) process.env.NODE_TEST_CONTEXT = context; }
    const [ev] = new Store(r.root).evidence('c1');
    assert.ok(ev.code_fingerprint); assert.deepEqual(ev.neutral_paths, ['.log/']);
    writeFileSync(join(r.root, '.log/platform.log'), 'start\nbaseline recorded\n');
    let printed = '';
    stateCommand({ root: r.root, argv: ['resume', 'c1', '--json'], out: (s) => { printed += s; }, err: () => {} });
    const view = JSON.parse(printed);
    assert.deepEqual(view.evidence_valid_here.map((e) => e.carried_forward), [true]);
    assert.equal(view.evidence_stale.length, 0);
  } finally { cleanup(r.root); }
});
