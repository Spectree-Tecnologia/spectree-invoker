// Gate 1 by standing policy. The Founder marks a roadmap item `policy: scope` and the changes
// inside it stop waiting on him one by one — but only where the runtime can see that the item was
// marked and that no module is being born. Every refusal below is one of those fences.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, tempDir, writeFiles, cleanup, approval, change, now } from './helpers.mjs';
import { Store } from '../scripts/lib/store.mjs';
import { checkPolicyApproval } from '../scripts/lib/scope-policy.mjs';

const ROADMAP = '# Roadmap\n\n1. `billing-retry` — retry failed charges · policy: scope\n2. `billing-refund` — refunds, after retry\n';

function project(files = {}) {
  return writeFiles(tempDir('spectree-policy-'), {
    'docs/ROADMAP.md': ROADMAP,
    'docs/specs/billing/spec.md': '# billing\n',
    ...files,
  });
}

const policy = (o = {}) => approval({
  gate: 'scope', change_id: 'c1', revision: 'a'.repeat(40),
  granted_by: { identity: 'founder', kind: 'founder_policy', reference: 'docs/ROADMAP.md#billing-retry' },
  channel: 'roadmap approval', ...o,
});

test('a change inside a marked roadmap item, on existing modules, passes', () => {
  const root = project();
  try {
    const v = checkPolicyApproval(root, policy(), change({ modules_named: ['billing'] }));
    assert.equal(v.ok, true, v.message);
    assert.match(v.entry, /billing-retry/);
    assert.equal(checkPolicyApproval(root, policy(), change({ deltaless: true })).ok, true, 'a deltaless change creates no module');
  } finally { cleanup(root); }
});

test('the policy never reaches past the scope gate, a bootstrap, an unmarked item or a new module', () => {
  const root = project();
  const cases = [
    [policy({ gate: 'integration' }), change({ modules_named: ['billing'] }), 'E_POLICY_GATE'],
    [policy({ gate: 'exposure' }), change({ modules_named: ['billing'] }), 'E_POLICY_GATE'],
    [policy(), null, 'E_POLICY_CHANGE'],
    [policy(), change({ change_type: 'bootstrap', modules_named: ['billing'] }), 'E_POLICY_BOOTSTRAP'],
    [policy({ granted_by: { identity: 'founder', kind: 'founder_policy' } }), change({ modules_named: ['billing'] }), 'E_POLICY_REFERENCE'],
    [policy({ granted_by: { identity: 'founder', kind: 'founder_policy', reference: 'policy.md' } }), change({ modules_named: ['billing'] }), 'E_POLICY_REFERENCE'],
    // Named in the roadmap, but the Founder never marked it: sequencing is not a delegation.
    [policy({ granted_by: { identity: 'founder', kind: 'founder_policy', reference: 'docs/ROADMAP.md#billing-refund' } }), change({ modules_named: ['billing'] }), 'E_POLICY_ROADMAP'],
    // A prefix of a marked item is not the item.
    [policy({ granted_by: { identity: 'founder', kind: 'founder_policy', reference: 'docs/ROADMAP.md#billing' } }), change({ modules_named: ['billing'] }), 'E_POLICY_ROADMAP'],
    [policy(), change({}), 'E_POLICY_MODULES'],
    [policy(), change({ modules_named: ['billing', 'payouts'] }), 'E_POLICY_NEW_MODULE'],
  ];
  try {
    for (const [doc, ch, code] of cases) assert.equal(checkPolicyApproval(root, doc, ch).code, code, `${doc.gate}/${doc.granted_by.reference}`);
    const bare = tempDir('spectree-policy-');
    try { assert.equal(checkPolicyApproval(bare, policy(), change({ modules_named: ['billing'] })).code, 'E_POLICY_ROADMAP', 'no roadmap, no policy'); }
    finally { cleanup(bare); }
  } finally { cleanup(root); }
});

test('record-approval enforces the policy before writing, and leaves other kinds alone', () => {
  const root = project();
  try {
    const store = new Store(root);
    store.init({ project_id: 'proj', protocol_version: '1.0.0' });
    store.putChange(change({ modules_named: ['billing', 'payouts'] }));
    const record = (name, doc) => {
      const f = join(root, `${name}.json`);
      writeFileSync(f, JSON.stringify(doc));
      const r = spawnSync(process.execPath, [join(REPO, 'scripts', 'state.mjs'), 'record-approval', f],
        { cwd: root, encoding: 'utf8', env: { ...process.env, SPECTREE_PROJECT_ROOT: root } });
      return { code: r.status, err: r.stderr };
    };
    const refused = record('p1', policy({ approval_id: 'p1' }));
    assert.equal(refused.code, 1);
    assert.match(refused.err, /E_POLICY_NEW_MODULE/);
    assert.equal(store.approvals().some((a) => a.approval_id === 'p1'), false, 'a refused policy approval writes nothing');

    store.putChange({ ...store.change('c1'), modules_named: ['billing'] });
    const accepted = record('p2', policy({ approval_id: 'p2', timestamp: now() }));
    assert.equal(accepted.code, 0, accepted.err);
    assert.equal(store.approvals().find((a) => a.approval_id === 'p2').granted_by.kind, 'founder_policy');

    // A human's own approval is not second-guessed by the roadmap.
    assert.equal(record('h1', approval({ approval_id: 'h1', gate: 'scope', change_id: 'c1', revision: 'a'.repeat(40) })).code, 0);
  } finally { cleanup(root); }
});
