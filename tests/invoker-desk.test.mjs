// The Invoker panel is a Claude Code hooks module (hooks/hooks.json). CI has no Claude Code to run
// `claude plugin test` with, so these guards hold what would break it silently: the module the
// manifest names, state keyed by the plugin's own name, one drawing per specialist card, no network
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

// Six specialist cards, each with the drawing that takes the mascot's place while it works and the
// expression its running card wears.
function roleProblems(rolesSource, cards, arts) {
  const roles = [...rolesSource.matchAll(/\{ role: '([^']+)', label: '[^']+', art: '(\w+)', face: '(\w+)' \}/g)].map((m) => ({ role: m[1], art: m[2], face: m[3] }));
  const problems = [];
  for (const card of cards) if (!roles.some((r) => r.role === card)) problems.push(`roles.ts: no drawing for agents/${card}.md`);
  for (const r of roles) if (!cards.includes(r.role)) problems.push(`roles.ts: drawing for ${r.role}, which has no card`);
  for (const r of roles) if (!arts.includes(r.art)) problems.push(`roles.ts: ${r.role} names ${r.art}, which mascot-art.ts does not draw`);
  for (const r of roles) if (!arts.includes(`face_${r.face}`)) problems.push(`roles.ts: ${r.role} wears face_${r.face}, which mascot-art.ts does not draw`);
  return problems;
}

// The panel only watches the session: nothing it sees leaves it. Declaring its
// own plan tool runs nothing (the panel's hook answers it in process); calling
// a tool does.
const networkProblems = (sources) =>
  Object.entries(sources)
    .filter(([, s]) => /\$\.(http|process|mcp|model|telemetry)\b|\$\.tool\b(?!\.register\()|\bfetch\(/.test(s))
    .map(([f]) => `${f}: reaches the network, a process or a tool`);

// The mascot and the specialists ride inside the centre's SVG as traced drawings: each is
// `<svg viewBox="0 0 W H">` holding only filled paths. The desktop app strips an <image> (only
// fragment references survive), and a path list carries no reference, no script and no markup to
// smuggle. The file must be its literals and nothing after them, or a value could be rebuilt at runtime.
const isTraced = (v) => /^<svg viewBox="0 0 \d+ \d+">(<path d="[MLCZ0-9 -]+" fill="#[0-9a-f]{6}"\/>)+<\/svg>$/.test(v);

function mascotArtOf(source) {
  const body = source.match(/export const MASCOT_ART = \{\s*((?:\w+:\s*'[^']*',\s*)+)\} as const\s*;?\s*$/)?.[1];
  return body && Object.fromEntries([...body.matchAll(/(\w+):\s*'([^']*)',/g)].map((m) => [m[1], m[2]]));
}

// The engine refuses an Svg source past 131072 characters. The centre carries one drawing and
// about 2k around it: a CI proxy, since invoker-desk.test.tsx measures the SVG where Claude Code runs.
function artProblems(source) {
  const arts = mascotArtOf(source);
  if (!arts) return ['mascot-art.ts: MASCOT_ART is not an object of single-quoted literals'];
  const problems = [];
  for (const key of ['mascot', 'happy']) if (!(key in arts)) problems.push(`mascot-art.ts: no ${key}`);
  for (const [k, v] of Object.entries(arts)) {
    if (!isTraced(v)) problems.push(`mascot-art.ts: ${k} is not a traced drawing of filled paths`);
    else if (v.length + 2_000 > 131_072) problems.push(`mascot-art.ts: ${k} would push the centre's SVG past 131072`);
  }
  return problems;
}

const DRAWING = '<svg viewBox="0 0 4 4"><path d="M0 0 4 0 4 4Z" fill="#ff8800"/></svg>';
const ART_OK = `export const MASCOT_ART = {\n  mascot:\n    '${DRAWING}',\n  happy:\n    '${DRAWING}',\n} as const\n`;

// The engine draws the whole pane at every tick (tarefa 40): a drawing that never moves goes as an image,
// not a frame. Always a frame: the floating centre and the spinner.
function drawingProblems(source) {
  const problems = [];
  for (const svg of source.match(/<Svg\b[^>]*>/gs) ?? []) {
    if (/\bisInteractive(?!=)/.test(svg) && !/heroMarkup\(|spinnerMarkup\(/.test(svg)) problems.push('register.tsx: an Svg is a frame whether or not it moves');
  }
  return problems;
}

const commandProblems = (source) =>
  [...source.matchAll(/name: '([^']+)'/g)].map((m) => m[1]).filter((n) => n === 'invoker').map(() => 'register.tsx: registers /invoker, which commands/invoker.md already is');

test('each guard rejects the state it exists to catch', () => {
  assert.deepEqual(moduleProblems('{ "modules": ["./gone.tsx"] }', () => false), ['hooks/hooks.json: names ./gone.tsx, which does not exist']);
  assert.equal(stateProblems('spectree', "atom({ plugin: 'invoker-desk', key: 'x' })", "\n    'invoker-desk': {").length, 2);
  assert.ok(roleProblems("{ role: 'quality-engineer', label: 'QE', art: 'quality', face: 'angry' }", ['quality-engineer', 'platform-engineer'], ['quality', 'face_angry']).includes('roles.ts: no drawing for agents/platform-engineer.md'));
  assert.deepEqual(roleProblems("{ role: 'quality-engineer', label: 'QE', art: 'quality', face: 'angry' }", ['quality-engineer'], ['mascot', 'face_angry']), ['roles.ts: quality-engineer names quality, which mascot-art.ts does not draw']);
  assert.deepEqual(roleProblems("{ role: 'quality-engineer', label: 'QE', art: 'quality', face: 'angry' }", ['quality-engineer'], ['quality']), ['roles.ts: quality-engineer wears face_angry, which mascot-art.ts does not draw']);
  assert.deepEqual(networkProblems({ 'a.ts': 'await $.http.fetch(url)' }), ['a.ts: reaches the network, a process or a tool']);
  assert.deepEqual(networkProblems({ 'a.ts': 'await $.tool.call({ tool: "Bash" })' }), ['a.ts: reaches the network, a process or a tool']);
  assert.deepEqual(networkProblems({ 'a.ts': 'const { call } = $.tool; await call({ tool: "Bash" })' }), ['a.ts: reaches the network, a process or a tool']);
  assert.deepEqual(networkProblems({ 'a.ts': 'await $.tool.registerX({ name: "plan" })' }), ['a.ts: reaches the network, a process or a tool']);
  assert.deepEqual(networkProblems({ 'a.ts': 'await $.tool.register({ name: "plan" })' }), []);
  assert.equal(networkProblems({ 'b.ts': "await $.tool.call({ tool: 'Bash' })", 'c.ts': '$.telemetry.log(x)' }).length, 2);
  const art = (v) => artProblems(ART_OK.replace(`'${DRAWING}'`, v)).length;
  assert.deepEqual(artProblems(ART_OK), []);
  assert.equal(art("'data:image/jpeg;base64,/9j/AA=='"), 1);
  assert.equal(art(`'<svg viewBox="0 0 4 4"><image href="https://host/x.png"/></svg>'`), 1);
  assert.equal(art(`'<svg viewBox="0 0 4 4"><path d="M0 0 4 0Z" fill="url(#x)"/></svg>'`), 1);
  assert.equal(art(`'<svg viewBox="0 0 4 4"><script>x</script></svg>'`), 1);
  assert.equal(art(`'<svg viewBox="0 0 4 4" onload="x"><path d="M0 0Z" fill="#ff8800"/></svg>'`), 1);
  assert.equal(art(`'<svg viewBox="0 0 4 4">${'<path d="M0 0 4 0 4 4Z" fill="#ff8800"/>'.repeat(3_400)}</svg>'`), 1);
  assert.equal(artProblems(`${ART_OK}MASCOT_ART.mascot = url\n`).length, 1);
  assert.equal(artProblems(ART_OK.replace(`'${DRAWING}'`, `'' + '${DRAWING}'`)).length, 1);
  assert.deepEqual(artProblems(ART_OK.replace('  happy:', '  sad:')), ['mascot-art.ts: no happy']);
  assert.equal(commandProblems("$.command.register({ name: 'invoker' })").length, 1);
  assert.deepEqual(drawingProblems('<Svg source={barMarkup(c, s)} alt="x" height={6} isInteractive />'), ['register.tsx: an Svg is a frame whether or not it moves']);
  assert.deepEqual(drawingProblems('<Svg source={barMarkup(c, s)} alt="x" height={6} isInteractive={isMoving} />'), []);
  assert.deepEqual(drawingProblems('<Svg\n  source={heroMarkup(hero)}\n  isInteractive\n/>'), []);
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
      ...roleProblems(read(join(DESK, 'roles.ts')), cards, Object.keys(mascotArtOf(read(join(DESK, 'mascot-art.ts'))) ?? {})),
      ...networkProblems(sources),
      ...commandProblems(register),
      ...drawingProblems(register),
      ...artProblems(read(join(DESK, 'mascot-art.ts'))),
    ],
    [],
  );
});
