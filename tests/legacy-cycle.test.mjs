import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gitRepo, tempDir, cleanup, REPO, now, stubGh, greenRun } from './helpers.mjs';

test('installed legacy cycle retains durable authority and closes only with observed integration', () => {
  const repo = gitRepo({ 'app.mjs': 'export const x = 1;\n', '.gitignore': '.spectree/\n' });
  const scratch = tempDir('spectree-legacy-');
  try {
    execFileSync(process.execPath, [join(REPO, 'scripts/install-codex.mjs'), repo.root, '--apply']);
    repo.git(['add', '-A']); repo.git(['commit', '-qm', 'install']);
    const gh = stubGh(scratch, {});
    const cli = (script, ...args) => spawnSync(process.execPath,
      [join(repo.root, '.spectree/squad/scripts', script), ...args],
      { cwd: repo.root, encoding: 'utf8', env: { ...process.env, PATH: gh.path() } });
    const state = (...args) => cli('state.mjs', ...args);
    const ok = (r) => { assert.equal(r.status, 0, `${r.stderr}\n${r.stdout}`); return r.stdout.trim(); };
    const record = (id, gate) => {
      const doc = { approval_id: id, change_id: 'c1', gate,
        granted_by: { identity: 'fixture', kind: 'human_in_session' }, channel: 'synthetic test',
        scope_digest: ok(state('digest', 'c1', '--gate', gate)),
        revision: repo.git(['rev-parse', 'HEAD']).trim(), timestamp: now() };
      const file = join(scratch, `${id}.json`);
      writeFileSync(file, JSON.stringify(doc));
      ok(state('record-approval', file));
    };
    ok(state('init', 'legacy-test', '--repository', 'fixture/repo',
      '--ci-workflow', 'check', '--ci-jobs', 'classify,plugin', '--ci-event', 'push', '--ci-branch', 'main'));
    ok(state('open', 'c1', '--scope', 'fixture', '--paths', 'app.mjs', '--deltaless', '--closure-mode', 'legacy'));
    record('scope', 'scope');
    ok(state('transition', 'c1', 'proposed')); ok(state('transition', 'c1', 'scope_approved'));
    repo.git(['checkout', '-qb', 'candidate']);
    for (const [property, target] of [['branch.isolated', 'isolated'], ['suite.baseline', 'baselined'],
      [null, 'implemented'], ['pass2.attack', 'pass2_complete'], ['ci.green', 'ci_green']]) {
      if (property) ok(state('run', 'c1', property, '--role', 'quality_engineer',
        '--independent-of', 'full_stack_developer', '--', process.execPath, '-e', 'process.exit(0)'));
      ok(state('transition', 'c1', target));
    }
    const changeFile = join(repo.root, '.spectree/changes/c1.json');
    const before = readFileSync(changeFile);
    assert.notEqual(state('transition', 'c1', 'integration_approved').status, 0);
    assert.deepEqual(readFileSync(changeFile), before);
    record('integration', 'integration');
    // The CLI wrote BOTH halves. No preparation is invented to make legacy work.
    const controlFile = join(repo.root, '.spectree/closure/c1.lifecycle.json');
    assert.ok(existsSync(controlFile), 'legacy approval requires a durable control too');
    const control = JSON.parse(readFileSync(controlFile));
    assert.ok(control.approved.some((a) => a.approval_id === 'integration'));
    assert.equal(existsSync(join(repo.root, '.spectree/closure/c1.json')), false);
    writeFileSync(controlFile, JSON.stringify({ ...control, approved: [] }));
    assert.notEqual(state('can', 'c1', 'integration_approved').status, 0,
      'the document alone must not become authority in legacy mode either');
    // Retirement still applies, including when the original approval file remains on disk.
    writeFileSync(controlFile, JSON.stringify({ ...control,
      retired_approvals: [{ approval_id: 'integration', reason: 'test retirement' }] }));
    assert.notEqual(state('can', 'c1', 'integration_approved').status, 0);
    assert.notEqual(state('transition', 'c1', 'integration_approved').status, 0);
    record('integration-new', 'integration');
    ok(state('transition', 'c1', 'integration_approved'));
    assert.notEqual(state('transition', 'c1', 'integrated').status, 0);
    const head = repo.git(['rev-parse', 'HEAD']).trim();
    repo.git(['checkout', '-q', 'main']); repo.git(['merge', '--no-ff', '-qm', 'merge', 'candidate']);
    const merge = repo.git(['rev-parse', 'HEAD']).trim();
    const green = greenRun(merge);
    gh.set({ repo: 'fixture/repo', pr: { number: 1, state: 'MERGED', mergedAt: now(),
      mergeCommit: { oid: merge }, headRefOid: head, baseRefName: 'main' },
      runs: [green.run], jobs: { '1': green.jobs } });
    ok(cli('post-merge.mjs', 'c1', '--pr', '1', '--apply', '--json'));
    assert.equal(JSON.parse(readFileSync(changeFile)).state, 'closed');
    ok(cli('post-merge.mjs', 'c1', '--pr', '1', '--apply', '--json'));
    assert.equal(repo.git(['rev-parse', 'HEAD']).trim(), merge);
  } finally { cleanup(repo.root); cleanup(scratch); }
});
