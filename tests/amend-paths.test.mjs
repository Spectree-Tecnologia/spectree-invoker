// Amending the paths a change owns: recorded with its reason, and stopped only where the new path
// widens the scope into a module the change never named.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gitRepo, cleanup } from './helpers.mjs';
import { stateCommand } from '../scripts/lib/closure/index.mjs';
import { Store } from '../scripts/lib/change/store.mjs';
import { moduleOfPath, planPathAmendment } from '../scripts/lib/change/index.mjs';

const base = { state: 'isolated', allowed_paths: ['modules/account/', 'apps/backend/src/modules/account/'] };

test('a path belongs to the module of the folder it sits in, or to none', () => {
  assert.equal(moduleOfPath('modules/account/src/name.ts'), 'account');
  assert.equal(moduleOfPath('apps/web/src/modules/billing/page.tsx'), 'billing');
  assert.equal(moduleOfPath('docs/specs/auth/spec.md'), 'auth');
  assert.equal(moduleOfPath('apps/web/src/shared/theme.ts'), null);
  assert.equal(moduleOfPath('tests/fixtures/account.json'), null);
});

test('a path inside a module the change already owns is added without a gate', () => {
  const r = planPathAmendment({ ...base, modules_named: ['account'] }, ['apps/frontend/src/modules/account/form.tsx', 'tests/fixtures/a.json'], 'the form test needs a fixture');
  assert.deepEqual(r, { ok: true, added: ['apps/frontend/src/modules/account/form.tsx', 'tests/fixtures/a.json'], already: [], modules: ['account'] });
});

test('a path in a module the change does not name widens the scope, and is refused', () => {
  const named = planPathAmendment({ ...base, modules_named: ['account'] }, ['modules/billing/src/x.ts'], 'reuse');
  assert.equal(named.code, 'E_AMEND_NEW_MODULE');
  assert.match(named.message, /"billing"/);
  // With no modules recorded, the modules its paths already own are what the change names.
  const inferred = planPathAmendment(base, ['apps/web/src/modules/billing/'], 'reuse');
  assert.equal(inferred.code, 'E_AMEND_NEW_MODULE');
  assert.equal(planPathAmendment(base, ['modules/account/test/'], 'tests').ok, true);
});

test('no reason, a frozen change, or a path that is not the change\'s to own is refused', () => {
  assert.equal(planPathAmendment(base, ['tests/a.json'], '  ').code, 'E_AMEND_REASON');
  for (const state of ['integration_approved', 'integrated', 'closed']) {
    assert.equal(planPathAmendment({ ...base, state }, ['tests/a.json'], 'why').code, 'E_AMEND_STATE', state);
  }
  for (const p of ['../outside', '/etc/passwd', '.spectree/changes/c1.json', 'CLAUDE.md', 'a\\b']) {
    assert.equal(planPathAmendment(base, [p], 'why').code, 'E_AMEND_PATHS', p);
  }
  assert.equal(planPathAmendment(base, [], 'why').code, 'E_AMEND_PATHS');
});

test('the command writes the amendment and its reason on the trail, and repeating it is a no-op', () => {
  const repo = gitRepo({ 'seed.txt': 'seed\n', '.gitignore': '.spectree/\n' });
  try {
    const out = [], err = [];
    const cli = (...argv) => { out.length = 0; err.length = 0; return stateCommand({ root: repo.root, argv, out: (s) => out.push(s), err: (s) => err.push(s) }); };
    assert.equal(cli('init', 'proj'), 0);
    assert.equal(cli('open', 'c1', '--scope', 'account names', '--paths', 'modules/account/', '--modules', 'account', '--closure-mode', 'legacy'), 0);

    assert.equal(cli('amend-paths', 'c1', '--add', 'tests/fixtures/account.json', '--reason', 'the name test reads a fixture'), 0);
    const store = new Store(repo.root);
    assert.deepEqual(store.change('c1').allowed_paths, ['modules/account/', 'tests/fixtures/account.json']);
    const event = store.history('c1').at(-1);
    assert.equal(event.type, 'paths_amended');
    assert.deepEqual(event.added, ['tests/fixtures/account.json']);
    assert.equal(event.reason, 'the name test reads a fixture');
    // The proposal recorded no contractual file, so the paths are part of the scope digest.
    assert.match(err.join('\n'), /scope approval no longer covers it/);

    const revision = store.change('c1').state_revision;
    assert.equal(cli('amend-paths', 'c1', '--add', 'tests/fixtures/account.json', '--reason', 'again'), 0);
    assert.match(out.join('\n'), /nothing to amend/);
    assert.equal(store.change('c1').state_revision, revision, 'a no-op writes nothing');

    assert.equal(cli('amend-paths', 'c1', '--add', 'modules/billing/', '--reason', 'reuse'), 1);
    assert.match(err.join('\n'), /E_AMEND_NEW_MODULE/);
    assert.deepEqual(store.change('c1').allowed_paths, ['modules/account/', 'tests/fixtures/account.json'], 'a refusal writes nothing');
  } finally { cleanup(repo.root); }
});
