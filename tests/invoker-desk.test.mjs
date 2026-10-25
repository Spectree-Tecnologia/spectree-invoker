// The Invoker panel is a Claude Code hooks module (hooks/hooks.json). CI has no Claude Code to run
// `claude plugin test` with, so these guards hold what would break it silently: the module the
// manifest names, state keyed by the plugin's own name, one orb per specialist card, no network
// and no clash with /invoker. Each guard is first shown rejecting the state it exists to catch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './helpers.mjs';

const DESK = join(REPO, 'hooks', 'invoker-desk');
const read = (path) => readFileSync(path, 'utf8');

function moduleProblems(hooksJson, exists) {
  const modules = JSON.parse(hooksJson).modules ?? [];
  if (modules.length !== 1) return [`hooks/hooks.json: names ${modules.length} modules, the engine loads one`];
  return exists(modules[0]) ? [] : [`hooks/hooks.json: names ${modules[0]}, which does not exist`];
}

// A state value is addressed by the plugin's name; under any other name the engine refuses it.
function stateProblems(pluginName, source, contract) {
  const owners = [...source.matchAll(/plugin: '([^']+)'/g)].map((m) => m[1]);
  const problems = [...new Set(owners)].filter((o) => o !== pluginName).map((o) => `register.tsx: state under "${o}", the plugin is "${pluginName}"`);
  if (!new RegExp(`\\n\\s+'?${pluginName}'?: \\{`).test(contract)) problems.push(`state.d.ts: no PluginState entry for "${pluginName}"`);
  return problems;
}

// Six specialist cards, six orbs: two Quas, two Wex, two Exort.
function orbProblems(orbsSource, cards) {
  const roles = [...orbsSource.matchAll(/\{ role: '([^']+)', label: '[^']+', orb: '(\w+)' \}/g)].map((m) => ({ role: m[1], orb: m[2] }));
  const problems = [];
  for (const card of cards) if (!roles.some((r) => r.role === card)) problems.push(`orbs.ts: no orb for agents/${card}.md`);
  for (const r of roles) if (!cards.includes(r.role)) problems.push(`orbs.ts: orb for ${r.role}, which has no card`);
  for (const orb of ['quas', 'wex', 'exort']) {
    const n = roles.filter((r) => r.orb === orb).length;
    if (n !== 2) problems.push(`orbs.ts: ${n} ${orb} orbs, the squad has two of each`);
  }
  return problems;
}

// The panel only watches the session: nothing it sees leaves it.
const networkProblems = (sources) =>
  Object.entries(sources).filter(([, s]) => /\$\.(http|process|tool|mcp|model|telemetry)\b|\bfetch\(/.test(s)).map(([f]) => `${f}: reaches the network, a process or a tool`);

// The portrait and the three orb paintings ride inside the avatar's SVG as traced drawings: each is
// empty (the vector drawing) or `<svg viewBox="0 0 W H">` holding only filled paths. The desktop app
// strips an <image> (only fragment references survive), and a path list carries no reference, no
// script and no markup to smuggle. Each file must be its literals and nothing after them, or the
// value could be rebuilt at runtime.
const isTraced = (v) => v === '' || /^<svg viewBox="0 0 \d+ \d+">(<path d="[MZ0-9 -]+" fill="#[0-9a-f]{6}"\/>)+<\/svg>$/.test(v);

function portraitOf(source) {
  return source.match(/export const PORTRAIT =\s*'([^']*)'\s*;?\s*$/)?.[1];
}

function orbArtOf(source) {
  const orb = (k) => `${k}: \\{\\s*small:\\s*'([^']*)',\\s*large:\\s*'([^']*)',?\\s*\\},?\\s*`;
  const m = source.match(new RegExp(`export const ORB_ART = \\{\\s*${orb('quas')}${orb('wex')}${orb('exort')}\\} as const\\s*;?\\s*$`));
  return m && { quas: { small: m[1], large: m[2] }, wex: { small: m[3], large: m[4] }, exort: { small: m[5], large: m[6] } };
}

// The engine refuses an Svg source past 131072 characters. The avatar carries the portrait once and
// each small orb twice, a card one large orb, and the drawing around them takes about 12k: a CI
// proxy, since invoker-desk.test.tsx measures the SVG itself where Claude Code runs.
function artProblems(portraitSource, orbSource) {
  const portrait = portraitOf(portraitSource);
  const orbs = orbArtOf(orbSource);
  const problems = [];
  if (portrait === undefined) problems.push('portrait.ts: PORTRAIT is not one single-quoted string literal');
  else if (!isTraced(portrait)) problems.push('portrait.ts: PORTRAIT is not a traced drawing of filled paths');
  if (!orbs) problems.push('orb-art.ts: ORB_ART is not quas, wex and exort, each small and large, as single-quoted literals');
  else for (const [k, v] of Object.entries(orbs)) for (const [size, art] of Object.entries(v)) if (!isTraced(art)) problems.push(`orb-art.ts: ${k}.${size} is not a traced drawing of filled paths`);
  if (problems.length) return problems;
  const avatar = portrait.length + 2 * Object.values(orbs).reduce((n, v) => n + v.small.length, 0) + 12_000;
  if (avatar > 131_072) problems.push(`portrait.ts + orb-art.ts: about ${avatar} characters, the avatar's SVG would pass 131072`);
  for (const [k, v] of Object.entries(orbs)) if (v.large.length + 4_000 > 131_072) problems.push(`orb-art.ts: ${k}.large would push a card's SVG past 131072`);
  return problems;
}

const DRAWING = '<svg viewBox="0 0 4 4"><path d="M0 0 4 0 4 4Z" fill="#ff8800"/></svg>';
const ORBS_OK = `export const ORB_ART = {\n  quas: {\n    small:\n      '${DRAWING}',\n    large:\n      '',\n  },\n  wex: {\n    small:\n      '',\n    large:\n      '',\n  },\n  exort: {\n    small:\n      '',\n    large:\n      '',\n  },\n} as const\n`;

const commandProblems = (source) =>
  [...source.matchAll(/name: '([^']+)'/g)].map((m) => m[1]).filter((n) => n === 'invoker').map(() => 'register.tsx: registers /invoker, which commands/invoker.md already is');

test('each guard rejects the state it exists to catch', () => {
  assert.deepEqual(moduleProblems('{ "modules": ["./gone.tsx"] }', () => false), ['hooks/hooks.json: names ./gone.tsx, which does not exist']);
  assert.equal(stateProblems('spectree', "atom({ plugin: 'invoker-desk', key: 'x' })", "\n    'invoker-desk': {").length, 2);
  assert.ok(orbProblems("{ role: 'quality-engineer', label: 'QE', orb: 'wex' }", ['quality-engineer', 'platform-engineer']).includes('orbs.ts: no orb for agents/platform-engineer.md'));
  assert.deepEqual(networkProblems({ 'a.ts': 'await $.http.fetch(url)' }), ['a.ts: reaches the network, a process or a tool']);
  assert.equal(networkProblems({ 'b.ts': "await $.tool.call({ tool: 'Bash' })", 'c.ts': '$.telemetry.log(x)' }).length, 2);
  const portrait = (v) => artProblems(v, ORBS_OK).length;
  assert.equal(portrait("export const PORTRAIT = 'data:image/jpeg;base64,/9j/AA=='"), 1);
  assert.equal(portrait(`export const PORTRAIT = '<svg viewBox="0 0 4 4"><image href="https://host/x.png"/></svg>'`), 1);
  assert.equal(portrait(`export const PORTRAIT = '<svg viewBox="0 0 4 4"><path d="M0 0 4 0Z" fill="url(#x)"/></svg>'`), 1);
  assert.equal(portrait(`export const PORTRAIT = "${DRAWING}"`), 1);
  assert.equal(portrait(`export const PORTRAIT = '' + '${DRAWING}'`), 1);
  assert.equal(portrait(`export const PORTRAIT = ''\n  + '<svg>'\n`), 1);
  assert.equal(portrait(`export const PORTRAIT = '<svg viewBox="0 0 4 4">${'<path d="M0 0 4 0 4 4Z" fill="#ff8800"/>'.repeat(3_000)}</svg>'`), 1);
  assert.deepEqual(artProblems("export const PORTRAIT = ''\n", ORBS_OK), []);
  assert.deepEqual(artProblems(`export const PORTRAIT =\n  '${DRAWING}'\n`, ORBS_OK), []);
  assert.equal(artProblems("export const PORTRAIT = ''", ORBS_OK.replace(`'${DRAWING}'`, "'data:image/png;base64,AAAA'")).length, 1);
  assert.equal(artProblems("export const PORTRAIT = ''", ORBS_OK.replace('} as const\n', '} as const\nORB_ART.wex.small = url\n')).length, 1);
  assert.equal(artProblems("export const PORTRAIT = ''", ORBS_OK.replace(`'${DRAWING}'`, `'<svg viewBox="0 0 4 4"><script>x</script></svg>'`)).length, 1);
  assert.equal(artProblems("export const PORTRAIT = ''", ORBS_OK.replace(`'${DRAWING}'`, `'<svg viewBox="0 0 4 4" onload="x"><path d="M0 0Z" fill="#ff8800"/></svg>'`)).length, 1);
  const smallBig = `<svg viewBox="0 0 4 4">${'<path d="M0 0 4 0 4 4Z" fill="#ff8800"/>'.repeat(1_500)}</svg>`;
  assert.match(artProblems("export const PORTRAIT = ''", ORBS_OK.replace(`'${DRAWING}'`, `'${smallBig}'`))[0], /avatar's SVG would pass/);
  const largeBig = `<svg viewBox="0 0 4 4">${'<path d="M0 0 4 0 4 4Z" fill="#ff8800"/>'.repeat(3_200)}</svg>`;
  assert.match(artProblems("export const PORTRAIT = ''", ORBS_OK.replace("large:\n      '',\n  },\n  wex", `large:\n      '${largeBig}',\n  },\n  wex`))[0], /quas\.large would push a card/);
  assert.equal(commandProblems("$.command.register({ name: 'invoker' })").length, 1);
});

test('the panel module is wired, keyed, mapped and offline', () => {
  const plugin = JSON.parse(read(join(REPO, '.claude-plugin', 'plugin.json')));
  const register = read(join(DESK, 'register.tsx'));
  const cards = readdirSync(join(REPO, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
  const sources = Object.fromEntries(readdirSync(DESK).map((f) => [f, read(join(DESK, f))]));

  assert.ok(existsSync(join(REPO, plugin.types)), `plugin.json types points at ${plugin.types}`);
  assert.deepEqual(
    [
      ...moduleProblems(read(join(REPO, 'hooks', 'hooks.json')), (m) => existsSync(join(REPO, 'hooks', m))),
      ...stateProblems(plugin.name, register, read(join(DESK, 'state.d.ts'))),
      ...orbProblems(read(join(DESK, 'orbs.ts')), cards),
      ...networkProblems(sources),
      ...commandProblems(register),
      ...artProblems(read(join(DESK, 'portrait.ts')), read(join(DESK, 'orb-art.ts'))),
    ],
    [],
  );
});
