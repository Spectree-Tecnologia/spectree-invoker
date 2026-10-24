// This repository closes a change inside the PR that delivers it: the folder is archived and its
// ROADMAP line is marked in the candidate, and the retro of the change before arrives in the next
// one. Each guard is first shown rejecting the state main was left in after #78, where the change
// stayed active and its line said "Em andamento" after the merge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './helpers.mjs';

// Releases before this one closed the old way, in the next PR. They are history, not drift.
const CUTOVER_VERSION = '1.46.0';
const CUTOVER_DATE = '2026-10-24';

const newerOrEqual = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return true;
};

/** The archived change that delivers this release: its proposal names `v<version>`. */
const releaseChange = (view) => view.archived.find((c) => c.proposal.includes(`v${view.version}`));

function unarchivedRelease(view) {
  if (!newerOrEqual(view.version, CUTOVER_VERSION) || releaseChange(view)) return [];
  return [`v${view.version}: no archived proposal names this release; archive the change in the PR that delivers it`];
}

// A ROADMAP line that links a change folder says what the folder says: archived is integrated,
// active is not, and the folder exists.
function roadmapDrift(view) {
  return view.roadmap.split('\n').filter((l) => l.startsWith('|')).flatMap((line) => {
    const state = (line.split('|')[3] ?? '').trim();
    return [...line.matchAll(/\]\((changes\/[^)#]+)\)/g)].map((m) => m[1]).flatMap((link) => {
      if (!view.exists(join('docs', link))) return [`${link}: linked from the ROADMAP and missing`];
      const archived = link.startsWith('changes/archive/');
      if (archived && !/^(Integrada|Concluída)/.test(state)) return [`${link}: archived, but the line says "${state.slice(0, 40)}"`];
      if (!archived && /^Integrada/.test(state)) return [`${link}: still active, but the line says it is integrated`];
      return [];
    });
  });
}

// From the cutover on, every archived change has its retro, except the release's own change,
// whose retro is written after its merge, in the change that follows.
function missingRetros(view) {
  const current = releaseChange(view)?.dir;
  return view.archived
    .filter((c) => c.dir.slice(0, 10) >= CUTOVER_DATE && c.dir !== current)
    .map((c) => c.dir.slice(11))
    .filter((slug) => !view.retros.some((r) => r.includes(`Change: \`${slug}\``)))
    .map((slug) => `${slug}: archived without a retro in docs/retros/`);
}

const read = (rel) => readFileSync(join(REPO, rel), 'utf8');
const dirs = (rel) => readdirSync(join(REPO, rel), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const repository = () => ({
  version: JSON.parse(read('package.json')).version,
  roadmap: read('docs/ROADMAP.md'),
  archived: dirs('docs/changes/archive').map((dir) => ({
    dir, proposal: existsSync(join(REPO, 'docs/changes/archive', dir, 'proposal.md')) ? read(`docs/changes/archive/${dir}/proposal.md`) : '',
  })),
  retros: existsSync(join(REPO, 'docs/retros')) ? readdirSync(join(REPO, 'docs/retros')).map((f) => read(`docs/retros/${f}`)) : [],
  exists: (rel) => existsSync(join(REPO, rel)),
});

// main after #78, transposed past the cutover: the release is out, its change is still active.
const afterMerge = (over = {}) => ({
  version: '1.46.0',
  roadmap: '| 10 | Pass 1 | Em andamento, [proposta](changes/pass1-superficie/proposal.md) | — |\n'
    + '| 9 | Cards | Integrada, PR #77 / v1.44.0, [proposta](changes/archive/2026-10-22-tamanho-dos-cards/proposal.md) | — |',
  archived: [{ dir: '2026-10-22-tamanho-dos-cards', proposal: '# Tamanho dos cards' }],
  retros: [],
  exists: () => true,
  ...over,
});

test('a release whose change is still active is refused', () => {
  assert.equal(unarchivedRelease(afterMerge()).length, 1);
  const closed = afterMerge({ archived: [...afterMerge().archived, { dir: '2026-10-24-pass1-superficie', proposal: 'PR #78 / v1.46.0' }] });
  assert.deepEqual(unarchivedRelease(closed), []);
  assert.deepEqual(unarchivedRelease(afterMerge({ version: '1.45.0' })), [], 'releases before the cutover closed the old way');
});

test('a ROADMAP line that disagrees with its change folder is refused', () => {
  assert.deepEqual(roadmapDrift(afterMerge()), []);
  const stale = afterMerge({ roadmap: '| 10 | Pass 1 | Em andamento, [proposta](changes/archive/2026-10-24-pass1-superficie/proposal.md) | — |' });
  assert.equal(roadmapDrift(stale).length, 1);
  const early = afterMerge({ roadmap: '| 10 | Pass 1 | Integrada, PR #78, [proposta](changes/pass1-superficie/proposal.md) | — |' });
  assert.equal(roadmapDrift(early).length, 1);
  assert.equal(roadmapDrift(afterMerge({ exists: () => false })).length, 2);
});

test('an archived change without its retro is refused, except the release being delivered', () => {
  const view = afterMerge({
    version: '1.47.0',
    archived: [{ dir: '2026-10-24-pass1-superficie', proposal: 'v1.46.0' }, { dir: '2026-10-25-next', proposal: 'v1.47.0' }],
  });
  assert.deepEqual(missingRetros(view), ['pass1-superficie: archived without a retro in docs/retros/']);
  assert.deepEqual(missingRetros({ ...view, retros: ['Change: `pass1-superficie`'] }), []);
  assert.deepEqual(missingRetros(afterMerge({ archived: [{ dir: '2026-10-22-old', proposal: '' }] })), [], 'before the cutover');
});

test('this repository closes each change in the PR that delivers it, and keeps its retros', () => {
  const view = repository();
  assert.deepEqual([...unarchivedRelease(view), ...roadmapDrift(view), ...missingRetros(view)], []);
});
