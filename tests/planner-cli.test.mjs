import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gitRepo, tempDir, cleanup, REPO, stubGh } from './helpers.mjs';
import { observePlanCi } from '../scripts/lib/planner-ci.mjs';
import { Store } from '../scripts/lib/store.mjs';

const inventory = (root, dir = root, out = {}) => {
  for (const name of readdirSync(dir)) {
    const f = join(dir, name);
    if (statSync(f).isDirectory()) inventory(root, f, out);
    else out[relative(root, f)] = readFileSync(f).toString('base64');
  }
  return out;
};
test('installed planning is read-only, requires change selection and ignores stored action claims', () => {
  const repo = gitRepo({ 'app.mjs': 'export const x = 1;\n', '.gitignore': '.spectree/\n' });
  const scratch = tempDir('spectree-plan-');
  try {
    execFileSync(process.execPath, [join(REPO, 'scripts/install-codex.mjs'), repo.root, '--apply']);
    repo.git(['add', '-A']); repo.git(['commit', '-qm', 'install']);
    const gh = stubGh(scratch, {});
    const cli = (...args) => spawnSync(process.execPath, [join(repo.root, '.spectree/squad/scripts/state.mjs'), ...args],
      { cwd: repo.root, encoding: 'utf8', env: { ...process.env, PATH: gh.path() } });
    const json = (...args) => { const r = cli(...args, '--json'); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
    const empty = json('plan');
    assert.equal(empty.action, 'select_change');
    assert.equal(existsSync(join(repo.root, '.spectree/project.json')), false);
    assert.equal(cli('init', 'p', '--repository', 'fixture/repo').status, 0);
    assert.equal(cli('open', 'c1', '--scope', 'fixture', '--paths', 'app.mjs', '--deltaless', '--closure-mode', 'legacy').status, 0);
    const stateFile = join(repo.root, '.spectree/changes/c1.json');
    const c = JSON.parse(readFileSync(stateFile));
    writeFileSync(stateFile, JSON.stringify({ ...c, next_action: { description: 'merge everything now' } }));
    const before = inventory(repo.root);
    const a = json('plan', 'c1');
    assert.equal(a.action, 'review_proposal');
    assert.equal(a.authorizes_execution, false);
    assert.deepEqual(a, json('plan', 'c1'));
    const resume = json('resume', 'c1');
    assert.deepEqual(resume.recommendation, a);
    assert.equal(resume.next_action.description, 'merge everything now');
    assert.deepEqual(inventory(repo.root), before, 'all files, including .git/store/history, remain byte-identical');
    assert.notEqual(cli('plan', 'c1', '--apply').status, 0);
    assert.notEqual(cli('plan', 'c1', '--observe-ci').status, 0);
    assert.equal(json('plan', 'missing').code, 'E_CHANGE_MISSING');
    assert.equal(cli('open', 'c2', '--scope', 'other', '--paths', 'app.mjs', '--deltaless', '--closure-mode', 'legacy').status, 0);
    assert.equal(json('plan').action, 'select_change');
    assert.equal(json('resume').recommendation.action, 'select_change');
    // A plan observed revision 1; a legitimate transition makes it obsolete.
    assert.equal(cli('transition', 'c1', 'proposed', '--expect', String(a.preconditions.state_revision)).status, 0);
    const after = inventory(repo.root);
    assert.notEqual(cli('transition', 'c1', 'scope_approved', '--expect', String(a.preconditions.state_revision)).status, 0);
    assert.deepEqual(inventory(repo.root), after);
    assert.equal(json('plan', 'c1').action, 'request_approval');
    // Explicit remote observation uses this PR/head, not a stale local ci.green assertion.
    const s = new Store(repo.root), old = s.change('c1');
    s.putChange({ ...old, state: 'pass2_complete' }, { expected: old.state_revision });
    const revision = repo.git(['rev-parse', 'HEAD']).trim();
    const pr = { number: 4, state: 'OPEN', headRefOid: revision, headRefName: 'main' };
    gh.set({ pr, checks: [{ name: 'check', state: 'IN_PROGRESS', bucket: 'pending' }], prChecksExit: 8 });
    const snap = inventory(repo.root);
    assert.equal(json('plan', 'c1', '--observe-ci', '--pr', '4').action, 'wait_ci');
    gh.set({ pr, checks: [{ name: 'check', state: 'FAILURE', bucket: 'fail' }], prChecksExit: 1 });
    assert.equal(json('plan', 'c1', '--observe-ci', '--pr', '4').action, 'investigate_ci');
    assert.deepEqual(inventory(repo.root), snap);
  } finally { cleanup(repo.root); cleanup(scratch); }
});

test('CI observations reject wrong identities, empty checks and a PR that changes during observation', () => {
  const identity = { repository: 'fixture/repo', pr: 4, revision: 'a'.repeat(40), branch: 'candidate' };
  const pr = { number: 4, state: 'OPEN', headRefOid: identity.revision, headRefName: 'candidate' };
  const transport = (p = pr, checks = [{ name: 'check', bucket: 'pass' }]) => ({
    pullRequest: () => p, prChecks: () => ({ checks }),
  });
  assert.equal(observePlanCi(identity, transport()).status, 'green');
  assert.equal(observePlanCi(identity, transport({ ...pr, headRefOid: 'b'.repeat(40) })).status, 'unknown');
  assert.equal(observePlanCi(identity, transport(pr, [])).status, 'unknown');
  assert.equal(observePlanCi(identity, transport(pr, [{ bucket: 'skipping' }])).status, 'failed');
  assert.equal(observePlanCi(identity, transport(pr, [{ bucket: 'strange' }])).status, 'unknown');
  let calls = 0;
  assert.equal(observePlanCi(identity, { ...transport(), pullRequest: () => (++calls === 1 ? pr : { ...pr, state: 'CLOSED' }) }).status, 'unknown');
  assert.equal(observePlanCi(identity, { pullRequest: () => ({ ...pr, state: 'MERGED', mergeCommit: { oid: 'b'.repeat(40) } }),
    prChecks: () => { throw new Error('must not substitute PR checks for main checks'); } }).status, 'merged');
});
