// Every PR of this repository is reviewed in a clean context, guided by REVIEW.md. These guards
// keep the guide usable: the sections a reviewer reads are there, every path it points at still
// exists, and the PR template asks where the review went. Each guard is first shown rejecting
// the state it exists to catch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './helpers.mjs';

const SECTIONS = ['## O que é Importante aqui', '## Sempre confira', '## Não reporte', '## Limites'];
const TEMPLATE_SECTION = '## Revisão independente';

function missingSections(text) {
  return SECTIONS.filter((s) => !text.split('\n').includes(s)).map((s) => `REVIEW.md: no "${s}" section`);
}

// A path the reviewer is told to read or check. Globs and placeholders are patterns, not paths.
const looksLikePath = (t) => !/[\s*<>]/.test(t) && (t.includes('/') || /\.(md|mjs|json|ya?ml)$/.test(t));

function stalePaths(text, exists) {
  const ticked = [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const linked = [...text.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1].split('#')[0]);
  return [...new Set([...ticked, ...linked])].filter(looksLikePath).filter((p) => !exists(p))
    .map((p) => `REVIEW.md: points at ${p}, which does not exist`);
}

function templateWithoutReview(text) {
  return text.split('\n').includes(TEMPLATE_SECTION) ? [] : [`pull_request_template.md: no "${TEMPLATE_SECTION}" section`];
}

const read = (rel) => readFileSync(join(REPO, rel), 'utf8').replace(/\r\n/g, '\n');
const exists = (rel) => existsSync(join(REPO, rel));

test('a guide without its sections is refused', () => {
  assert.deepEqual(missingSections('# Instruções\n\n## Sempre confira\n'), [
    'REVIEW.md: no "## O que é Importante aqui" section',
    'REVIEW.md: no "## Não reporte" section',
    'REVIEW.md: no "## Limites" section',
  ]);
});

test('a guide pointing at a path that moved is refused, and patterns are not paths', () => {
  const text = 'Veja `scripts/lib/evidence/gone.mjs`, [papel](docs/roles/gone.md#x), `agents/*.md`, '
    + '`docs/changes/archive/<data>-<slug>/proposal.md`, `throw new Error` e `neutral_paths`.';
  assert.deepEqual(stalePaths(text, () => false), [
    'REVIEW.md: points at scripts/lib/evidence/gone.mjs, which does not exist',
    'REVIEW.md: points at docs/roles/gone.md, which does not exist',
  ]);
});

test('a PR template that does not ask where the review went is refused', () => {
  assert.equal(templateWithoutReview('## O quê\n\n## Atrito\n').length, 1);
});

test('this repository: REVIEW.md is whole and current, and the template asks for the review', () => {
  const guide = read('REVIEW.md');
  assert.deepEqual([...missingSections(guide), ...stalePaths(guide, exists), ...templateWithoutReview(read('.github/pull_request_template.md'))], []);
});
