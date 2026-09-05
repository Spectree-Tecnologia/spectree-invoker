// One change, driven end to end through the INSTALLED commands in a synthetic consumer.
//
// The unit tests call the functions directly, which is exactly how two defects survived
// them: the machine had grown a requirement the CLI never supplied, and the CLI wrote a
// block it could not undo. A cycle that only goes through the commands catches that class.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitRepo, cleanup, REPO, now } from './helpers.mjs';

/** A consumer project with the squad installed, exactly as a user would have it. */
function consumer() {
  const repo = gitRepo({ 'seed.txt': 'seed\n' });
  execFileSync(process.execPath, [join(REPO, 'scripts', 'install-codex.mjs'), repo.root, '--apply'], { encoding: 'utf8' });
  const state = join(repo.root, '.spectree/squad/scripts/state.mjs');
  // spawnSync, not execFileSync: the refusals are on stderr and every one of them is asserted.
  const cli = (...args) => {
    const r = spawnSync(process.execPath, [state, ...args], { cwd: repo.root, encoding: 'utf8' });
    return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
  };
  return { ...repo, cli };
}

const proposal = (text) => `# proposal\n\n${text}\n`;

test('a change runs the gate cycle through the installed CLI, and the digest is the CLI\'s own', () => {
  const c = consumer();
  try {
    assert.equal(c.cli('init', 'proj').code, 0);
    assert.equal(c.cli('open', 'c1', '--scope', 'the account module', '--paths', 'modules/account').code, 0);

    mkdirSync(join(c.root, 'docs/changes/c1'), { recursive: true });
    writeFileSync(join(c.root, 'docs/changes/c1/proposal.md'), proposal('one module, four Requirements'));

    // The CLI computes the digest from the artifact on disk. Nothing here reads an approval.
    const d = c.cli('digest', 'c1');
    assert.equal(d.code, 0);
    assert.match(d.out, /^sha256:[0-9a-f]{64}$/);
    assert.match(d.err, /docs\/changes\/c1/, 'it says which artifact it digested');

    assert.equal(c.cli('transition', 'c1', 'proposed').code, 0);

    const noApproval = c.cli('can', 'c1', 'scope_approved');
    assert.equal(noApproval.code, 1);
    assert.match(noApproval.err, /E_MISSING_APPROVAL/);

    // Record the approval the Founder gave, bound to that digest and that revision.
    const file = join(c.root, 'approval.json');
    writeFileSync(file, JSON.stringify({
      approval_id: 'ap1', change_id: 'c1', gate: 'scope',
      granted_by: { identity: 'founder', kind: 'human_in_session' },
      channel: 'session', scope_digest: d.out, revision: c.base, timestamp: now(),
    }));
    assert.equal(c.cli('record-approval', file).code, 0);

    const allowed = c.cli('can', 'c1', 'scope_approved');
    assert.equal(allowed.code, 0, `${allowed.err}`);
    assert.equal(c.cli('transition', 'c1', 'scope_approved').code, 0);

    // Now edit the approved artifact. Same revision, different content: the approval dies.
    writeFileSync(join(c.root, 'docs/changes/c1/proposal.md'), proposal('one module, and also a second one'));
    const drifted = c.cli('can', 'c1', 'isolated');
    assert.equal(drifted.code, 1);
    assert.match(drifted.err, /E_APPROVAL_DIGEST_MISMATCH/);
    assert.match(drifted.err, /current artifact: docs\/changes\/c1/, 'the refusal is actionable');

    // Put it back, and the same approval is good again — the binding is to content, not to a moment.
    writeFileSync(join(c.root, 'docs/changes/c1/proposal.md'), proposal('one module, four Requirements'));
    assert.match(c.cli('can', 'c1', 'isolated').err, /E_MISSING_EVIDENCE/, 'only the evidence is missing now');
  } finally { cleanup(c.root); }
});

test('the CLI blocks a change and can bring it back, without hand-editing JSON', () => {
  const c = consumer();
  try {
    c.cli('init', 'proj');
    c.cli('open', 'c1', '--scope', 'the account module', '--paths', 'modules/account');
    c.cli('transition', 'c1', 'proposed');

    const noReason = c.cli('transition', 'c1', 'blocked');
    assert.equal(noReason.code, 2, 'a block with no stated cause is refused');
    assert.match(noReason.err, /--reason/);

    assert.equal(c.cli('transition', 'c1', 'blocked', '--reason', 'the PSP webhook contract is unknown').code, 0);

    const r = c.cli('resume', 'c1');
    assert.match(r.out, /\[blocked\]/);
    assert.match(r.out, /recover to proposed/, 'resume says where recovery goes');

    const jump = c.cli('can', 'c1', 'scope_approved');
    assert.equal(jump.code, 1);
    assert.match(jump.err, /E_BLOCKED_RECOVERY/, 'a block is not a shortcut past the next gate');

    assert.equal(c.cli('transition', 'c1', 'proposed').code, 0, 'recovery goes back to where the block happened');
    const back = c.cli('resume', 'c1');
    assert.match(back.out, /\[proposed\]/);
    assert.doesNotMatch(back.out, /blocked/, 'the block is cleared, not left behind as a ghost');

    const stored = JSON.parse(readFileSync(join(c.root, '.spectree/changes/c1.json'), 'utf8'));
    assert.equal(stored.blocked_from, undefined);
    assert.equal(stored.blocked_reason, undefined);
    assert.deepEqual(c.cli('resume', 'c1', '--json').code, 0);
  } finally { cleanup(c.root); }
});
