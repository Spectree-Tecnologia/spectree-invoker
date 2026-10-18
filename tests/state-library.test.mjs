// The state commands, called as a function in this process — no child process, no exit.
//
// `scripts/state.mjs` is only `stateCommand({ root, argv })` and an exit code, so every command
// must be reachable from here. The project root is a temporary repository and NOT the working
// directory of this process, so anything that still read `process.cwd()` would act on the wrong
// project.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../scripts/lib/change/store.mjs';
import { stateCommand } from '../scripts/lib/closure/index.mjs';
import { gitRepo, tempDir, cleanup } from './helpers.mjs';

function fixture() {
  const repo = gitRepo({ 'src/app.js': 'export const x = 1;\n', '.gitignore': '.spectree/\n' });
  const state = (...argv) => {
    const out = [];
    const err = [];
    const code = stateCommand({ root: repo.root, argv, out: (s) => out.push(s), err: (s) => err.push(s) });
    return { code, out: out.join('\n'), err: err.join('\n') };
  };
  const scratch = tempDir('spectree-scratch-');
  return {
    root: repo.root, state, store: () => new Store(repo.root),
    file: (name, doc) => { const f = join(scratch, name); writeFileSync(f, JSON.stringify(doc)); return f; },
    drop: () => { cleanup(repo.root); cleanup(scratch); },
  };
}

test('init reads its own flags only before `--`: the consolidation command keeps its arguments', () => {
  const f = fixture();
  try {
    const r = f.state('init', 'proj', '--repository', 'org/real', '--',
      'node', 'consolidate.mjs', '--repository', 'org/other', '--ci-workflow', 'w', '--ci-jobs', 'a,b', '--delivery');
    assert.equal(r.code, 0, r.err);
    const project = f.store().project();
    assert.equal(project.repository, 'org/real');
    assert.equal(project.ci, undefined);
    assert.equal(project.delivery, undefined);
    assert.deepEqual(project.closure.consolidate,
      ['node', 'consolidate.mjs', '--repository', 'org/other', '--ci-workflow', 'w', '--ci-jobs', 'a,b', '--delivery']);
  } finally { f.drop(); }
});

test('init without `--` still reads every flag it is given', () => {
  const f = fixture();
  try {
    const r = f.state('init', 'proj', '--repository', 'org/real', '--ci-workflow', 'check', '--ci-jobs', 'a,b', '--delivery');
    assert.equal(r.code, 0, r.err);
    const project = f.store().project();
    assert.equal(project.repository, 'org/real');
    assert.deepEqual(project.ci.required_runs.full.jobs, ['a', 'b']);
    assert.deepEqual(project.delivery, { version: 1 });
  } finally { f.drop(); }
});

test('an unknown command is a usage error, answered and not exited', () => {
  const f = fixture();
  try {
    const r = f.state('nope');
    assert.equal(r.code, 2);
    assert.match(r.err, /^usage: state\.mjs </);
  } finally { f.drop(); }
});

test('a change opens, blocks and shows up in the trail, all in the given root', () => {
  const f = fixture();
  try {
    assert.equal(f.state('init', 'proj').code, 0);
    const opened = f.state('open', 'c1', '--scope', 'fixture', '--paths', 'src', '--deltaless', '--closure-mode', 'legacy');
    assert.equal(opened.code, 0, opened.err);
    assert.match(opened.out, /^opened c1 at base /);
    assert.equal(f.state('can', 'c1', 'blocked').code, 0);
    assert.equal(f.state('transition', 'c1', 'blocked').code, 2);
    const blocked = f.state('transition', 'c1', 'blocked', '--reason', 'waiting');
    assert.equal(blocked.code, 0, blocked.err);
    assert.equal(f.store().change('c1').state, 'blocked');

    const trail = f.state('trail', 'c1', '--json');
    assert.equal(trail.code, 0, trail.err);
    assert.deepEqual(JSON.parse(trail.out).map((e) => e.type), ['opened', 'transition']);
    const resume = f.state('resume', 'c1', '--json');
    assert.equal(resume.code, 0, resume.err);
    assert.equal(JSON.parse(resume.out).project.project_id, 'proj');
    const valid = f.state('validate');
    assert.equal(valid.code, 0, valid.err);
    assert.match(valid.out, /^state validate OK/);
  } finally { f.drop(); }
});

test('a refusal inside an import keeps its own message instead of being swallowed', () => {
  const f = fixture();
  try {
    assert.equal(f.state('init', 'proj').code, 0);
    assert.equal(f.state('open', 'c1', '--scope', 'fixture', '--paths', 'src', '--closure-mode', 'legacy').code, 0);
    const doc = f.file('ev.json', { evidence_id: 'ev-1', change_id: 'c1', property: 'ci.green', result: 'PASS', fingerprint: 'sha256:x' });
    const r = f.state('record-evidence', doc);
    assert.equal(r.code, 1);
    assert.match(r.err, /^fingerprint is written by `state\.mjs run`/);
    assert.equal(r.err.split('\n').length, 1);
    assert.deepEqual(f.store().evidence('c1'), []);
  } finally { f.drop(); }
});
