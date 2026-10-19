import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { gitRepo, tempDir, cleanup, REPO, now, stubGh, greenRun, closureCli } from './helpers.mjs';

test('installed adoption, interrupted mode reconciliation and legacy closure retain durable authority', () => {
  const repo = gitRepo({ 'app.mjs': 'export const x = 1;\n', '.gitignore': '.spectree/\n' });
  const scratch = tempDir('spectree-legacy-');
  try {
    execFileSync(process.execPath, [join(REPO, 'scripts/install-codex.mjs'), repo.root, '--apply']);
    repo.git(['add', '-A']); repo.git(['commit', '-qm', 'install']);
    const gh = stubGh(scratch, {});
    const cli = (script, ...args) => closureCli(join(repo.root, '.spectree/squad/scripts', script), args,
      { cwd: repo.root, env: { PATH: gh.path() } });
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
    const adoptionRequest = join(scratch, 'adoption-request.json'), adoptionPlan = join(scratch, 'adoption-plan.json');
    writeFileSync(adoptionRequest, JSON.stringify({ version: 1, project_id: 'legacy-test', change_id: 'c1', scope: 'fixture',
      allowed_paths: ['app.mjs'], refs: ['app.mjs'], adapter: 'codex', closure_mode: 'legacy', deltaless: true }));
    writeFileSync(adoptionPlan, ok(cli('adopt.mjs', 'plan', adoptionRequest)));
    ok(cli('adopt.mjs', 'apply', adoptionPlan, '--apply'));
    record('scope', 'scope');
    ok(state('transition', 'c1', 'proposed')); ok(state('transition', 'c1', 'scope_approved'));
    repo.git(['checkout', '-qb', 'candidate']);
    for (const [property, target] of [['branch.isolated', 'isolated'], ['suite.baseline', 'baselined'],
      [null, 'implemented'], ['pass2.attack', 'pass2_complete'], ['ci.green', 'ci_green']]) {
      if (property) ok(state('run', 'c1', property, '--role', 'quality_engineer',
        '--independent-of', 'full_stack_developer', '--', process.execPath, '-e', 'process.exit(0)'));
      ok(state('transition', 'c1', target));
      if (target === 'implemented') {
        // Reproduce a record written by an older runtime, without weakening the new open/adopt contract.
        const file = join(repo.root, '.spectree/changes/c1.json');
        const old = JSON.parse(readFileSync(file));
        writeFileSync(file, JSON.stringify({ ...old, closure_mode: 'prepared' }));
        ok(state('transition', 'c1', 'blocked', '--reason', 'Incorrect closure mode in older runtime'));
        const diagnosis = JSON.parse(ok(cli('reconcile.mjs', 'diagnose', 'c1')));
        assert.ok(diagnosis.changes[0].issues.some(i => i.code === 'E_CLOSURE_MECHANISM'));
        const requestFile = join(scratch, 'correction-request.json'), planFile = join(scratch, 'correction-plan.json');
        writeFileSync(requestFile, JSON.stringify({ version: 1, change_id: 'c1', closure_mode: 'legacy',
          actor: { kind: 'human_in_session', identity: 'synthetic operator' }, reason: 'Reviewed project has no prepared consolidation mechanism',
          refs: ['.spectree/project.json'] }));
        const plan = JSON.parse(ok(cli('reconcile.mjs', 'plan', requestFile, '--output', planFile)));
        const op = `reconcile-${plan.plan_digest}`;
        const obstruction = join(repo.root, '.spectree/reconciliations/c1', op, 'receipt.json');
        mkdirSync(obstruction, { recursive: true });
        assert.notEqual(cli('reconcile.mjs', 'apply', planFile, '--apply').status, 0);
        assert.notEqual(state('transition', 'c1', 'implemented').status, 0);
        rmdirSync(obstruction);
        ok(cli('reconcile.mjs', 'resume', 'c1', op, '--apply'));
        assert.equal(JSON.parse(readFileSync(file)).state, 'blocked');
        ok(state('transition', 'c1', 'implemented'));
      }
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
