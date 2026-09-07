// Closure preparation, driven through the CLI.
//
// Three defects these exist for, all of the same family — a check that ran too late to matter:
// the ownership check ran after the consolidation had already written; it looked only at
// base..HEAD, so an unowned file that was not committed yet passed; and an incompatible manifest
// printed its refusal and was then overwritten by the run that refused it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../scripts/lib/store.mjs';
import { contentDigest, contractDigest, gatedDigest } from '../scripts/lib/digest.mjs';
import { buildManifest } from '../scripts/lib/closure-prep.mjs';
import { classifyPath, KIND } from '../scripts/lib/diff.mjs';
import { gitRepo, cleanup, now, REPO } from './helpers.mjs';

/** A change at `implemented`, whose consolidation command leaves a mark when it runs. */
function fixture({ allowed = ['src', 'docs'] } = {}) {
  const repo = gitRepo({ 'src/app.js': 'export const x = 1;\n', '.gitignore': '.spectree/\n' });
  const store = new Store(repo.root);
  store.init({
    project_id: 'fixture', protocol_version: '1.0.0',
    closure: { consolidate: [process.execPath, '-e', "require('fs').writeFileSync('.spectree/ran','yes')"] },
  });
  const change = {
    schema_version: '1.0.0', project_id: 'fixture', change_id: 'c1', change_type: 'feature',
    protocol_version: '1.0.0', adapter: 'codex', base_revision: repo.base, scope: 'fixture',
    allowed_paths: allowed, deltaless: true, state: 'implemented',
  };
  store.putChange(change, { event: { type: 'opened' } });
  mkdirSync(join(repo.root, 'docs/changes/c1'), { recursive: true });
  writeFileSync(join(repo.root, 'docs/changes/c1/proposal.md'), '# proposal\n\nno delta\n');
  repo.git(['add', '-A']); repo.git(['commit', '-qm', 'the proposal']);

  const prep = (...args) => {
    const r = spawnSync(process.execPath, [join(REPO, 'scripts/prepare-closure.mjs'), 'c1', ...args],
      { cwd: repo.root, encoding: 'utf8' });
    return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
  };
  return {
    ...repo, store, change, prep,
    ran: () => existsSync(join(repo.root, '.spectree/ran')),
    manifest: () => { try { return JSON.parse(readFileSync(join(repo.root, '.spectree/closure/c1.json'), 'utf8')); } catch { return null; } },
    drop: () => cleanup(repo.root),
  };
}


/**
 * The same change, but at `ci_green` with every approval and every piece of evidence in order,
 * so that the ONLY thing a gate can still refuse is the closure preparation.
 */
function gateFixture(manifestBody) {
  const f = fixture();
  const contract = contractDigest(f.root, f.change);
  const content = contentDigest(f.root);
  const gated = gatedDigest(contract.digest, content.digest);
  for (const gate of ['scope', 'integration']) {
    f.store.putApproval({
      schema_version: '1.0.0', approval_id: `ap-${gate}`, change_id: 'c1', gate,
      granted_by: { identity: 'fixture', kind: 'human_in_session' }, channel: 'session',
      scope_digest: gate === 'scope' ? contract.digest : gated,
      revision: content.revision, timestamp: now(),
    });
  }
  for (const property of ['pass2.attack', 'ci.green']) {
    f.store.putEvidence({
      schema_version: '1.0.0', evidence_id: `ev-${property}`, change_id: 'c1', property,
      check: 'synthetic fixture', source_kind: 'observed_execution',
      executor: { role: property === 'pass2.attack' ? 'quality_engineer' : 'platform_engineer', independent_of: ['full_stack_developer'] },
      revision: content.revision, fingerprint: content.digest, contract_digest: contract.digest,
      result: 'PASS', timestamp: now(),
    });
  }
  const c = f.store.change('c1');
  f.store.putChange({ ...c, state: 'ci_green' }, { event: { type: 'transition', to: 'ci_green' }, expected: c.state_revision });

  mkdirSync(join(f.root, '.spectree/closure'), { recursive: true });
  writeFileSync(join(f.root, '.spectree/closure/c1.json'), JSON.stringify(
    typeof manifestBody === 'function' ? manifestBody({ contract, content }) : manifestBody));

  const can = () => spawnSync(process.execPath, [join(REPO, 'scripts/state.mjs'), 'can', 'c1', 'integration_approved'],
    { cwd: f.root, encoding: 'utf8' });
  return { ...f, can, contract, content };
}

test('a blocker stops the preparation before anything runs — committed or not', () => {
  for (const commit of [true, false]) {
    const f = fixture();
    try {
      writeFileSync(join(f.root, 'outside.txt'), 'not owned by this change\n');
      if (commit) { f.git(['add', '-A']); f.git(['commit', '-qm', 'a file outside the change']); }

      const r = f.prep('--apply');
      assert.equal(r.code, 1, commit ? 'committed and unowned must block' : 'uncommitted and unowned must block too');
      assert.match(r.err, /outside this change's declared ownership/);
      assert.match(r.err, /nothing was run/);
      assert.equal(f.ran(), false, 'the consolidation command must not have written anything');
      assert.equal(f.manifest(), null, 'and no manifest may claim the change was prepared');
    } finally { f.drop(); }
  }
});

test('the squad\'s own records are not a blocker: it writes those itself', () => {
  const f = fixture();
  try {
    // `.spectree/` is written by the squad on every transition, and is never part of a change's
    // ownership. Treating it as unowned would block every preparation there has ever been.
    const r = f.prep('--apply');
    assert.equal(r.code, 0, r.err);
    assert.equal(f.ran(), true);
    assert.ok(f.manifest());
  } finally { f.drop(); }
});

test('an incompatible manifest is refused and left exactly where it was', () => {
  const f = fixture();
  try {
    const contract = contractDigest(f.root, f.change);
    const content = contentDigest(f.root);
    const foreign = {
      ...buildManifest({
        changeId: 'some-other-change', baseRevision: f.base,
        contractDigest: contract.digest, candidateDigest: content.digest, preparedAt: now(),
      }),
      manifest_version: '99.0.0',
    };
    mkdirSync(join(f.root, '.spectree/closure'), { recursive: true });
    writeFileSync(join(f.root, '.spectree/closure/c1.json'), JSON.stringify(foreign));

    const r = f.prep('--apply');
    assert.equal(r.code, 1);
    assert.match(r.err, /E_PREP_CONTRACT_VERSION|E_PREP_COLLISION/);
    assert.match(r.err, /Nothing was run and nothing was written/);
    assert.equal(f.ran(), false, 'refusing is not a licence to run the consolidation');
    assert.equal(f.manifest().manifest_version, '99.0.0', 'and the record it refused to read is still there');
  } finally { f.drop(); }
});

test('the gate refuses that manifest too, however well the digests match', () => {
  // The digests are the RIGHT ones. Matching digests on a document written under a contract this
  // build does not speak is not agreement — it is a coincidence between two dialects.
  const f = gateFixture(({ contract, content }) => ({
    ...buildManifest({
      changeId: 'c1', baseRevision: contract.digest && content.revision,
      contractDigest: contract.digest, candidateDigest: content.digest, preparedAt: now(),
    }),
    manifest_version: '99.0.0',
  }));
  try {
    const can = f.can();
    assert.equal(can.status, 1);
    assert.match(can.stderr, /E_CLOSURE_NOT_PREPARED/);
    assert.match(can.stderr, /E_PREP_CONTRACT_VERSION/);
  } finally { f.drop(); }
});

test('a manifest belonging to another change is refused by the gate as well', () => {
  const f = gateFixture(({ contract, content }) => buildManifest({
    changeId: 'some-other-change', baseRevision: content.revision,
    contractDigest: contract.digest, candidateDigest: content.digest, preparedAt: now(),
  }));
  try {
    const can = f.can();
    assert.equal(can.status, 1);
    assert.match(can.stderr, /E_PREP_COLLISION/);
  } finally { f.drop(); }
});

test('a preparation that covers this candidate lets the gate through', () => {
  const f = gateFixture(({ contract, content }) => buildManifest({
    changeId: 'c1', baseRevision: content.revision,
    contractDigest: contract.digest, candidateDigest: content.digest, preparedAt: now(),
  }));
  try {
    const can = f.can();
    assert.equal(can.status, 0, can.stderr);
  } finally { f.drop(); }
});

test('a stale preparation is a repair, not a collision: re-preparing is allowed', () => {
  const f = fixture();
  try {
    assert.equal(f.prep('--apply').code, 0);
    const first = f.manifest();

    writeFileSync(join(f.root, 'src/app.js'), 'export const x = 2;\n');
    const dry = f.prep();
    assert.equal(dry.code, 1, 'the plan says the preparation no longer describes this candidate');
    assert.match(dry.err, /E_PREP_STALE/);

    const again = f.prep('--apply');
    assert.equal(again.code, 0, again.err);
    assert.notEqual(f.manifest().candidate_digest, first.candidate_digest, 'and it now names the candidate on disk');
  } finally { f.drop(); }
});

test('a manifest missing the fields it is read for is malformed, not merely stale', () => {
  const f = gateFixture({ manifest_version: '1.0.0', change_id: 'c1' });
  try {
    const can = f.can();
    assert.equal(can.status, 1);
    assert.match(can.stderr, /E_PREP_MALFORMED/);
  } finally { f.drop(); }
});

// --- the digest, where the preparation's identity comes from ------------------

test('committing a deletion does not change the content: it was already gone', () => {
  const repo = gitRepo({ 'src/app.js': 'export const x = 1;\n', 'src/keep.js': 'export const k = 1;\n' });
  try {
    unlinkSync(join(repo.root, 'src/app.js'));
    const before = contentDigest(repo.root).digest;
    repo.git(['add', '-A']); repo.git(['commit', '-qm', 'delete it']);
    assert.equal(contentDigest(repo.root).digest, before,
      'the file is absent both times; recording it as deleted made the same content digest twice');
  } finally { cleanup(repo.root); }
});

test('the executable bit is part of the content, because it changes what the file does', () => {
  const repo = gitRepo({ 'run.sh': '#!/bin/sh\necho hi\n' });
  try {
    const before = contentDigest(repo.root);
    repo.git(['update-index', '--chmod=+x', 'run.sh']);
    repo.git(['commit', '-qm', 'make it executable']);
    const after = contentDigest(repo.root);
    assert.notEqual(after.tree, before.tree, 'git sees a different tree');
    assert.notEqual(after.digest, before.digest, 'and so must the digest — the bytes are the same, the file is not');
  } finally { cleanup(repo.root); }
});

test('a commit and the work tree that produced it digest the same', () => {
  const repo = gitRepo({ 'src/a.js': 'export const a = 1;\n' });
  try {
    writeFileSync(join(repo.root, 'src/a.js'), 'export const a = 2;\n');
    const uncommitted = contentDigest(repo.root).digest;
    repo.git(['add', '-A']); repo.git(['commit', '-qm', 'commit it']);
    const committed = contentDigest(repo.root).digest;
    assert.equal(committed, uncommitted, 'committing finished work must not invalidate what covered it');
  } finally { cleanup(repo.root); }
});

// --- a contract is a contract wherever it is filed ---------------------------

test('a proposal and a delta are behavioural contracts, open or archived', () => {
  for (const path of [
    'docs/changes/c1/proposal.md',
    'docs/changes/c1/specs/account/spec.md',
    'docs/changes/archive/2026-09-07-c1/proposal.md',
    'docs/changes/archive/2026-09-07-c1/specs/account/spec.md',
    'docs/specs/account/spec.md',
  ]) {
    assert.equal(classifyPath(path), KIND.PROTOCOL, `${path} is what a gate was granted against`);
  }
  // The progress note beside them is not.
  assert.equal(classifyPath('docs/changes/c1/tasks.md'), KIND.ADMINISTRATIVE);
});
