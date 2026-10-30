// The three findings of the first code audit (D-027, D-028, D-029), each pinned by a test that
// fails on the base of the fix (68e6aeb) and passes on the fix.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, symlinkSync, chmodSync, readdirSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tempDir, cleanup, gitRepo, REPO, now } from './helpers.mjs';
import { git } from '../scripts/lib/shared/git.mjs';
import { upToImplemented, consumer } from './cli-cycle-fixture.mjs';

const POSIX = process.platform !== 'win32';

test('D-027: a symlink committed in the consumer project is refused before the installer writes through it', { skip: !POSIX && 'symlinks need privilege on Windows' }, () => {
  const dir = tempDir('spectree-links-');
  try {
    const project = join(dir, 'project'), outside = join(dir, 'outside');
    mkdirSync(project); mkdirSync(join(outside, 'spectree'), { recursive: true });
    writeFileSync(join(outside, 'victim.txt'), 'SENTINEL\n');
    symlinkSync(join(outside, 'victim.txt'), join(project, 'AGENTS.md'));
    symlinkSync(join(outside, 'spectree'), join(project, '.spectree'));

    const r = spawnSync(process.execPath, [join(REPO, 'scripts', 'install-codex.mjs'), project, '--apply'], { encoding: 'utf8' });
    assert.equal(r.status, 1, 'the install is refused');
    assert.match(r.stderr, /symlink/);
    assert.match(r.stderr, /AGENTS\.md/);
    assert.match(r.stderr, /\.spectree/);
    assert.equal(readFileSync(join(outside, 'victim.txt'), 'utf8'), 'SENTINEL\n', 'the link target is untouched');
    assert.deepEqual(readdirSync(join(outside, 'spectree')), [], 'nothing was written through the directory link');

    // The dry run says the same thing, so the operator learns it before choosing --apply.
    const dry = spawnSync(process.execPath, [join(REPO, 'scripts', 'install-codex.mjs'), project], { encoding: 'utf8' });
    assert.equal(dry.status, 1);
    assert.match(dry.stderr, /symlink/);
  } finally { cleanup(dir); }
});

test('D-028: record-evidence refuses the run-written freshness binding, so an imported ci.green cannot pass as observed', () => {
  const c = consumer();
  try {
    upToImplemented(c);
    const run = c.cli('run', 'c1', 'probe.x', '--role', 'platform_engineer', '--', process.execPath, '-e', 'process.exit(1)');
    assert.equal(run.code, 1);
    const real = readdirSync(join(c.root, '.spectree/evidence')).map((f) => JSON.parse(readFileSync(join(c.root, '.spectree/evidence', f), 'utf8')))
      .find((e) => e.property === 'probe.x');
    assert.ok(real.code_fingerprint, 'a real run stamps the binding the import must not accept');

    for (const field of ['code_fingerprint', 'neutral_paths']) {
      const forged = {
        evidence_id: `e-${field}`, change_id: 'c1', property: 'ci.green', check: 'synthetic',
        executor: { role: 'platform_engineer' }, source_kind: 'observed_execution',
        revision: c.git(['rev-parse', 'HEAD']).trim(), result: 'PASS', timestamp: now(),
        code_fingerprint: real.code_fingerprint, neutral_paths: real.neutral_paths,
      };
      if (field === 'neutral_paths') delete forged.code_fingerprint;
      const r = c.cli('record-evidence', c.doc(forged.evidence_id, forged));
      assert.equal(r.code, 1, `an imported document cannot carry ${field}`);
      assert.match(r.err, /written by `state\.mjs run`/);
      assert.equal(existsSync(join(c.root, `.spectree/evidence/${forged.evidence_id}.json`)), false, 'and nothing was stored');
    }
  } finally { c.drop(); }
});

test('D-029: git is never resolved from the project directory, even when PATH names it', { skip: !POSIX && 'the fake executable is a shell script' }, () => {
  const { root: repo } = gitRepo();
  try {
    writeFileSync(join(repo, 'git'), `#!/bin/sh\necho planted > "${join(repo, 'planted.txt')}"\nexit 1\n`);
    chmodSync(join(repo, 'git'), 0o755);
    const env = { ...process.env, PATH: `.${delimiter}${process.env.PATH}` };
    const head = git(repo, ['rev-parse', 'HEAD'], { env }).trim();
    assert.match(head, /^[0-9a-f]{40}$/, 'the real git answered');
    assert.equal(existsSync(join(repo, 'planted.txt')), false, 'the planted binary never ran');

    // An absolute PATH entry that is a link into the project is the project too.
    const outside = tempDir('spectree-pathlink-');
    try {
      symlinkSync(repo, join(outside, 'bin'));
      const linked = { ...process.env, PATH: `${join(outside, 'bin')}${delimiter}${process.env.PATH}` };
      git(repo, ['rev-parse', 'HEAD'], { env: linked });
      assert.equal(existsSync(join(repo, 'planted.txt')), false, 'nor through a linked PATH entry');

      // Nor a git in an outside PATH entry that is itself a link to the planted one.
      mkdirSync(join(outside, 'real'));
      symlinkSync(join(repo, 'git'), join(outside, 'real', 'git'));
      const viaFile = { ...process.env, PATH: `${join(outside, 'real')}${delimiter}${process.env.PATH}` };
      git(repo, ['rev-parse', 'HEAD'], { env: viaFile });
      assert.equal(existsSync(join(repo, 'planted.txt')), false, 'nor through a linked git file');
    } finally { cleanup(outside); }
  } finally { cleanup(repo); }
});

test('D-029: the Console observation spawns git only through the resolved executable', () => {
  const src = readFileSync(join(REPO, 'scripts/lib/console/observation.mjs'), 'utf8');
  assert.doesNotMatch(src, /\b(?:execFileSync|execFile|spawnSync|spawn|execSync|exec)\(\s*['"`]git/, 'no bare git spawn left in the observation');
});
