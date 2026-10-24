// `retro.mjs collect` measures one merged PR for its closure retro. The merge is a real one in a
// disposable repository; only the GitHub reads are replaced. Each signature is first shown firing on
// the shape of the incident it names, and the clean shape is shown matching none.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitRepo, writeFiles, cleanup } from './helpers.mjs';
import { frictionSection, retroCommand, SIGNATURES } from '../scripts/lib/evaluation/index.mjs';

// A branch that archives `archivedSlug`, bumps to `version`, and merges into main with `subjects`
// as its commits. Returns the repository and the merge commit.
function merged({ archivedSlug, proposal, version, subjects }) {
  const r = gitRepo({ 'package.json': '{"version":"1.0.0"}\n' });
  r.git(['checkout', '-qb', 'work']);
  subjects.forEach((subject, i) => {
    writeFiles(r.root, { [`f${i}.txt`]: subject });
    if (i === subjects.length - 1) {
      writeFiles(r.root, { 'package.json': `{"version":"${version}"}\n`, [`docs/changes/archive/2026-10-24-${archivedSlug}/proposal.md`]: proposal });
    }
    r.git(['add', '-A']); r.git(['commit', '-qm', subject]);
  });
  r.git(['checkout', '-q', 'main']);
  r.git(['merge', '-q', '--no-ff', '-m', 'Merge pull request #9', 'work']);
  return { ...r, merge: r.git(['rev-parse', 'HEAD']).trim() };
}

const pr = (merge, over = {}) => ({
  number: 9, title: 't', html_url: 'u', created_at: '2026-10-24T00:00:00Z', merged_at: '2026-10-24T00:30:00Z',
  merge_commit_sha: merge, review_comments: 0, comments: 0, body: '## O quê\n\nx\n\n## Atrito\n\nNenhum.\n', ...over,
});
const green = () => ({ runs: [{ conclusion: 'success', databaseId: 1 }], complete: true });

function collect(r, { prOver = {}, runs = green, argv = [] } = {}) {
  const lines = []; const errors = [];
  const code = retroCommand({
    root: r.root, argv: ['collect', '9', ...argv], out: (s) => lines.push(s), err: (s) => errors.push(s),
    source: { git: r.git, pullRequest: () => pr(r.merge, prOver), runs },
  });
  return { code, result: lines.length ? JSON.parse(lines.join('\n')) : null, errors };
}

test('a PR that lost its version, archived the change before it and left no trail matches each signature', () => {
  const r = merged({ archivedSlug: 'previous', proposal: 'Release v1.0.9', version: '1.1.0', subjects: ['work', 'merge: integra main 1.0.9 e sobe a candidata para 1.1.0'] });
  try {
    let n = 0;
    const { code, result } = collect(r, {
      prOver: { body: '## O quê\n\nx\n' },
      runs: () => (n++ === 0 ? { runs: [{ conclusion: 'failure', databaseId: 7 }], complete: true } : green()),
    });
    assert.equal(code, 0);
    assert.deepEqual(result.candidates.map((c) => c.signature),
      [SIGNATURES.identifiers, SIGNATURES.closure, SIGNATURES.trail, SIGNATURES.red]);
    assert.equal(result.signals.base_merges, 1);
    assert.equal(result.signals.ci_heads, 2);
    assert.equal(result.signals.open_minutes, 30);
    assert.equal(result.signals.release, 'v1.1.0');
  } finally { cleanup(r.root); }
});

test('a PR that archives its own release, records its friction and stays green matches nothing', () => {
  const r = merged({ archivedSlug: 'this', proposal: 'PR #9 / v1.1.0', version: '1.1.0', subjects: ['work'] });
  try {
    const { code, result } = collect(r);
    assert.equal(code, 0);
    assert.deepEqual(result.candidates, []);
    assert.match(result.meaning, /not a clean change/);
  } finally { cleanup(r.root); }
});

test('what could not be measured stays unknown', () => {
  const r = merged({ archivedSlug: 'this', proposal: 'v1.1.0', version: '1.1.0', subjects: ['work'] });
  try {
    const { result } = collect(r, { prOver: { review_comments: undefined, created_at: null }, runs: () => ({ runs: [], complete: false }) });
    assert.equal(result.signals.ci_runs_complete, false);
    assert.equal(result.signals.open_minutes, null);
    assert.equal(result.signals.review_comments, null);
  } finally { cleanup(r.root); }
});

test('a retro reads a merge that happened, and a record that was collected is never replaced', () => {
  const r = merged({ archivedSlug: 'this', proposal: 'v1.1.0', version: '1.1.0', subjects: ['work'] });
  try {
    assert.equal(retroCommand({ root: r.root, argv: ['collect'], err: () => {} }), 2);
    const open = collect(r, { prOver: { merged_at: null } });
    assert.equal(open.code, 1);
    assert.match(open.errors[0], /^E_RETRO_NOT_MERGED:/);
    const unknown = collect(r, { prOver: { merge_commit_sha: 'f'.repeat(40) } });
    assert.match(unknown.errors[0], /^E_RETRO_MERGE_UNKNOWN:/);

    const first = collect(r, { argv: ['--apply'] });
    assert.equal(first.result.written, '.spectree/retros/this.signals.json');
    assert.equal(JSON.parse(readFileSync(join(r.root, first.result.written), 'utf8')).pr.number, 9);
    const again = collect(r, { argv: ['--apply'] });
    assert.equal(again.code, 1);
    assert.match(again.errors[0], /^E_RETRO_EXISTS:/);
    assert.ok(existsSync(join(r.root, first.result.written)));
  } finally { cleanup(r.root); }
});

test('the Atrito section is read up to the next heading or the footer', () => {
  assert.equal(frictionSection('## O quê\nx').status, 'missing');
  assert.equal(frictionSection('## Atrito\n\n## Outra').status, 'empty');
  assert.deepEqual(frictionSection('## Atrito\n\nDois reds locais.\n\n---\n_footer_'), { status: 'present', text: 'Dois reds locais.' });
  assert.equal(frictionSection('## Atrito\nNenhum.').text, 'Nenhum.');
});

test('what retro.recorded observes: the retro exists, names its change and says what it read', () => {
  const r = gitRepo({ 'docs/retros/ok.md': 'Change: `c1`\n\n## O que foi lido\n\nO PR.\n', 'docs/retros/bare.md': 'Change: `c1`\n' });
  try {
    const check = (...argv) => { const errors = []; const code = retroCommand({ root: r.root, argv: ['check', ...argv], out: () => {}, err: (s) => errors.push(s) }); return { code, err: errors[0] ?? '' }; };
    assert.equal(check('c1', 'docs/retros/ok.md').code, 0);
    assert.match(check('c2', 'docs/retros/ok.md').err, /^E_RETRO_INCOMPLETE:/);
    assert.match(check('c1', 'docs/retros/bare.md').err, /^E_RETRO_INCOMPLETE:/);
    assert.match(check('c1', 'docs/retros/none.md').err, /^E_RETRO_MISSING:/);
    assert.match(check('c1', '../outside.md').err, /^E_WORK_PATH:/);
    assert.equal(check('c1').code, 2);
  } finally { cleanup(r.root); }
});
