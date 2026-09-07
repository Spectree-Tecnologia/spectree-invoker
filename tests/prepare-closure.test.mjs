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
function fixture({ allowed = ['src', 'docs'], baseFiles = {} } = {}) {
  const repo = gitRepo({ 'src/app.js': 'export const x = 1;\n', '.gitignore': '.spectree/\n', ...baseFiles });
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

  const run = (args, env) => {
    const r = spawnSync(process.execPath, [join(REPO, 'scripts/prepare-closure.mjs'), 'c1', ...args],
      { cwd: repo.root, encoding: 'utf8', env: { ...process.env, ...env } });
    return { code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
  };
  const prep = (...args) => run(args);
  /** The same run, a day later on the wall clock. Nothing on disk moves. */
  const prepTomorrow = (...args) => run(args, {
    SPECTREE_CLOCK_AHEAD_DAYS: '1',
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${join(REPO, 'tests/fixtures/clock-ahead.cjs').split('\\').join('/')}`.trim(),
  });
  return {
    ...repo, store, change, prep, prepTomorrow,
    writeManifest: (m) => writeFileSync(join(repo.root, '.spectree/closure/c1.json'), `${JSON.stringify(m, null, 2)}\n`),
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

// --- what the check has to see, and when it has to see it --------------------

test('a staged rename is read as two paths, and its source is checked for ownership', () => {
  for (const commit of [false, true]) {
    // The unowned file exists in the BASE, so renaming it away really is this change removing
    // something it does not own.
    const f = fixture({ baseFiles: { 'badsrc/file.js': 'export const y = 1;\n' } });
    try {
      // `git status --porcelain -z` writes a rename as "XY <to>\0<from>": the second field has
      // no status prefix. Slicing three characters off every field turned `badsrc/file.js` into
      // `src/file.js` — and a rename REMOVING a file outside the change walked through.
      f.git(['mv', 'badsrc/file.js', 'src/file.js']);
      if (commit) f.git(['commit', '-qm', 'move it in']);

      const r = f.prep('--apply');
      assert.equal(r.code, 1, commit ? 'a committed rename must be caught' : 'a staged one too');
      assert.match(r.err, /badsrc\/file\.js/, 'the source of the rename is named, not a truncation of it');
      assert.equal(f.ran(), false);
    } finally { f.drop(); }
  }
});

test('an occupied archive slot is a preflight refusal, in the dry run too', () => {
  const f = fixture();
  try {
    const slot = join(f.root, 'docs/changes/archive', `${new Date().toISOString().slice(0, 10)}-c1`);
    mkdirSync(slot, { recursive: true });
    writeFileSync(join(slot, 'proposal.md'), '# somebody else got here first\n');

    const dry = f.prep();
    assert.equal(dry.code, 1, 'the plan must say so before anything is written');
    assert.match(`${dry.out}${dry.err}`, /E_PREP_COLLISION/);

    const r = f.prep('--apply');
    assert.equal(r.code, 1);
    assert.match(r.err, /nothing was run/);
    assert.equal(f.ran(), false, 'discovering the collision after the consolidation is discovering it too late');
    assert.equal(f.manifest(), null);
  } finally { f.drop(); }
});

test('the consolidation command is itself held to the change\'s ownership', () => {
  const repo = gitRepo({ 'src/app.js': 'export const x = 1;\n', '.gitignore': '.spectree/\n' });
  try {
    const store = new Store(repo.root);
    store.init({
      project_id: 'fixture', protocol_version: '1.0.0',
      // A command that succeeds and writes outside the change's declared paths.
      closure: { consolidate: [process.execPath, '-e', "require('fs').writeFileSync('outside.txt','written by the command')"] },
    });
    store.putChange({
      schema_version: '1.0.0', project_id: 'fixture', change_id: 'c1', change_type: 'feature',
      protocol_version: '1.0.0', adapter: 'codex', base_revision: repo.base, scope: 'fixture',
      allowed_paths: ['src', 'docs'], deltaless: true, state: 'implemented',
    }, { event: { type: 'opened' } });
    mkdirSync(join(repo.root, 'docs/changes/c1'), { recursive: true });
    writeFileSync(join(repo.root, 'docs/changes/c1/proposal.md'), '# proposal\n');
    repo.git(['add', '-A']); repo.git(['commit', '-qm', 'the proposal']);

    const r = spawnSync(process.execPath, [join(REPO, 'scripts/prepare-closure.mjs'), 'c1', '--apply'],
      { cwd: repo.root, encoding: 'utf8' });
    assert.equal(r.status, 1, 'running a command is not approving whatever it writes');
    assert.match(r.stderr, /left 1 path\(s\) outside this change's declared ownership/);
    assert.doesNotMatch(r.stderr, /spec consolidation failed/, 'the refusal is the ownership one, not a broken script');
    assert.match(r.stderr, /outside\.txt/);
    assert.equal(existsSync(join(repo.root, '.spectree/closure/c1.json')), false, 'and no manifest says it was prepared');
    assert.equal(existsSync(join(repo.root, 'docs/changes/c1')), true, 'nothing was archived');
    assert.equal(existsSync(join(repo.root, 'outside.txt')), true,
      'and the file the command wrote is left alone: removing it automatically would destroy work nobody chose to destroy');
  } finally { cleanup(repo.root); }
});

// --- progress is not a candidate, and a commit is not an escape --------------

test('ticking a task refreshes the artifact record without re-preparing anything', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'docs/changes/c1/tasks.md'), '- [ ] build it\n');
    f.git(['add', '-A']); f.git(['commit', '-qm', 'a task list']);
    assert.equal(f.prep('--apply').code, 0);
    const first = f.manifest();
    const archive = `docs/changes/archive/${new Date().toISOString().slice(0, 10)}-c1`;
    assert.ok(first.artifacts.some((a) => a.path.endsWith('tasks.md')), 'the record covers the whole folder');

    // Pass 2 finished; the box gets ticked. Neither digest moves — the task list is in neither.
    writeFileSync(join(f.root, `${archive}/tasks.md`), '- [x] build it\n');
    const again = f.prep('--apply');
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, /refreshed/);

    const second = f.manifest();
    assert.equal(second.contract_digest, first.contract_digest, 'the contract did not move');
    assert.equal(second.candidate_digest, first.candidate_digest, 'and neither did the candidate');
    assert.ok(second.artifacts_refreshed_at, 'the record says when it was brought up to date');
    assert.notDeepEqual(second.artifacts, first.artifacts, 'and it now describes what is on disk');

    // Which is the property the confirmation after the merge actually checks.
    const onDisk = execFileSync('git', ['hash-object', `${archive}/tasks.md`], { cwd: f.root, encoding: 'utf8' }).trim();
    assert.equal(second.artifacts.find((a) => a.path.endsWith('tasks.md')).digest, onDisk);

    // Nothing was re-run and nothing was moved a second time.
    const trail = readFileSync(join(f.root, '.spectree/history/c1.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(trail.filter((e) => e.type === 'closure_prepared').length, 1);
    assert.equal(trail.filter((e) => e.type === 'closure_artifacts_refreshed').length, 1);
  } finally { f.drop(); }
});

test('a consolidation that COMMITS its trespass is still a trespass', () => {
  const repo = gitRepo({ 'src/app.js': 'export const x = 1;\n', '.gitignore': '.spectree/\n' });
  try {
    const store = new Store(repo.root);
    // A command that writes outside the change's paths and commits it, then exits 0. Looking
    // only at the uncommitted half let exactly this pass: committing emptied the list.
    const script = [
      "const { writeFileSync } = require('node:fs');",
      "const { execFileSync } = require('node:child_process');",
      "writeFileSync('outside.txt', 'outside declared ownership');",
      "execFileSync('git', ['add', 'outside.txt']);",
      "execFileSync('git', ['commit', '-qm', 'the command commits its own trespass']);",
    ].join('');
    store.init({
      project_id: 'fixture', protocol_version: '1.0.0',
      closure: { consolidate: [process.execPath, '-e', script] },
    });
    store.putChange({
      schema_version: '1.0.0', project_id: 'fixture', change_id: 'c1', change_type: 'feature',
      protocol_version: '1.0.0', adapter: 'codex', base_revision: repo.base, scope: 'fixture',
      allowed_paths: ['src', 'docs'], deltaless: true, state: 'implemented',
    }, { event: { type: 'opened' } });
    mkdirSync(join(repo.root, 'docs/changes/c1'), { recursive: true });
    writeFileSync(join(repo.root, 'docs/changes/c1/proposal.md'), '# proposal\n');
    repo.git(['add', '-A']); repo.git(['commit', '-qm', 'the proposal']);

    const r = spawnSync(process.execPath, [join(REPO, 'scripts/prepare-closure.mjs'), 'c1', '--apply'],
      { cwd: repo.root, encoding: 'utf8' });
    assert.equal(r.status, 1, 'committing a trespass does not launder it');
    // The refusal has to be the OWNERSHIP one. A broken consolidation script also mentions the
    // path — in the syntax error it echoes — and that is not this test passing.
    assert.match(r.stderr, /left 1 path\(s\) outside this change's declared ownership: outside\.txt/);
    assert.doesNotMatch(r.stderr, /spec consolidation failed/);
    assert.equal(existsSync(join(repo.root, '.spectree/closure/c1.json')), false);
    assert.equal(existsSync(join(repo.root, 'docs/changes/c1')), true, 'nothing was archived');
    // The commit stays: reverting somebody's work is theirs to decide, not this command's.
    assert.match(repo.git(['show', '--name-only', '--format=', 'HEAD']), /outside\.txt/);
  } finally { cleanup(repo.root); }
});

// --- the record is read where it was written, and frozen where it is relied on ---------------

test('resuming the next day refreshes the folder that was prepared, not the one today names', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'docs/changes/c1/tasks.md'), '- [ ] build it\n');
    f.git(['add', '-A']); f.git(['commit', '-qm', 'a task list']);
    assert.equal(f.prep('--apply').code, 0);
    const first = f.manifest();
    const archive = first.archive_path;
    assert.ok(archive, 'the preparation records where the folder went');
    assert.equal(first.artifacts.length, 2);

    // Nothing moved and nothing was touched — only the calendar.
    const quiet = f.prepTomorrow('--apply');
    assert.equal(quiet.code, 0, quiet.err);
    assert.match(quiet.out, /unchanged/);
    assert.equal(f.manifest().artifacts.length, 2, 'a day passing does not empty the record');

    // And a box ticked the next day still refreshes against the real folder.
    writeFileSync(join(f.root, `${archive}/tasks.md`), '- [x] build it\n');
    const again = f.prepTomorrow('--apply');
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, /refreshed/);
    const second = f.manifest();
    assert.equal(second.artifacts.length, 2, 'the record still covers the whole folder');
    assert.equal(second.archive_path, archive, 'and still points at the folder that was prepared');
    const onDisk = execFileSync('git', ['hash-object', `${archive}/tasks.md`], { cwd: f.root, encoding: 'utf8' }).trim();
    assert.equal(second.artifacts.find((a) => a.path.endsWith('tasks.md')).digest, onDisk);
  } finally { f.drop(); }
});

test('a location that is gone or cannot be named refuses instead of recording an empty list', () => {
  for (const [what, mangle] of [
    ['a folder that is not there', (m) => ({ ...m, archive_path: 'docs/changes/archive/1999-01-01-c1' })],
    ['a record that names no folder', (m) => {
      const { archive_path: _, ...rest } = m;
      return { ...rest, artifacts: [
        { path: 'docs/changes/archive/2020-01-01-c1/proposal.md', op: 'archived', digest: 'sha1:a' },
        { path: 'docs/changes/archive/2020-01-02-c1/tasks.md', op: 'archived', digest: 'sha1:b' },
      ] };
    }],
  ]) {
    const f = fixture();
    try {
      writeFileSync(join(f.root, 'docs/changes/c1/tasks.md'), '- [ ] build it\n');
      f.git(['add', '-A']); f.git(['commit', '-qm', 'a task list']);
      assert.equal(f.prep('--apply').code, 0);
      const before = mangle(f.manifest());
      f.writeManifest(before);

      const r = f.prep('--apply');
      assert.equal(r.code, 1, `${what}: refused`);
      assert.match(r.err, /E_PREP_(MISSING|MALFORMED)/);
      assert.deepEqual(f.manifest().artifacts, before.artifacts, `${what}: the record is left exactly as it was`);
      assert.equal(f.manifest().artifacts.length > 0, true, `${what}: and it is not emptied`);
    } finally { f.drop(); }
  }
});

test('the artifact record freezes at the integration approval', () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'docs/changes/c1/tasks.md'), '- [ ] build it\n');
    f.git(['add', '-A']); f.git(['commit', '-qm', 'a task list']);
    assert.equal(f.prep('--apply').code, 0);
    const archive = f.manifest().archive_path;

    // Before the approval: progress is progress, and the record catches up.
    writeFileSync(join(f.root, `${archive}/tasks.md`), '- [x] build it\n');
    assert.match(f.prep('--apply').out, /refreshed/);
    const approved = f.manifest();

    f.store.putApproval({
      schema_version: '1.0.0', approval_id: 'ap-integration', change_id: 'c1', gate: 'integration',
      granted_by: { identity: 'fixture', kind: 'human_in_session' }, channel: 'session',
      scope_digest: gatedDigest(f.manifest().contract_digest, f.manifest().candidate_digest),
      revision: f.git(['rev-parse', 'HEAD']).trim(), timestamp: now(),
    });

    // After it, the same edit is the merge altering a prepared artifact — and refreshing the
    // record here would update the reference using the very thing it exists to compare against.
    writeFileSync(join(f.root, `${archive}/tasks.md`), '- [ ] actually it was never built\n');
    const r = f.prep('--apply');
    assert.equal(r.code, 1, 'an approved record is not updated to agree with what changed under it');
    assert.match(r.err, /E_PREP_FROZEN/);
    assert.match(r.err, /ap-integration/);
    assert.deepEqual(f.manifest().artifacts, approved.artifacts, 'the reference is untouched');
  } finally { f.drop(); }
});
