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

// The portrait rides inside the avatar's SVG as an image, so PORTRAIT is either empty (the vector
// figure) or a base64 image data URI: never a remote address, which would fetch from the network.
// The SVG it rides in is refused past 131072 characters and the drawing around it takes about 10k,
// so CI bounds the URI at 110k; invoker-desk.test.tsx measures the SVG itself where Claude Code runs.
function portraitProblems(source) {
  const value = source.match(/export const PORTRAIT =\s*'([^']*)'\s*;?\s*$/m)?.[1];
  if (value === undefined) return ['portrait.ts: PORTRAIT is not one single-quoted string literal'];
  if (!value) return [];
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return ['portrait.ts: PORTRAIT is not a base64 image data URI'];
  return value.length > 110_000 ? [`portrait.ts: ${value.length} characters, the avatar's SVG would pass 131072`] : [];
}

const commandProblems = (source) =>
  [...source.matchAll(/name: '([^']+)'/g)].map((m) => m[1]).filter((n) => n === 'invoker').map(() => 'register.tsx: registers /invoker, which commands/invoker.md already is');

test('each guard rejects the state it exists to catch', () => {
  assert.deepEqual(moduleProblems('{ "modules": ["./gone.tsx"] }', () => false), ['hooks/hooks.json: names ./gone.tsx, which does not exist']);
  assert.equal(stateProblems('spectree', "atom({ plugin: 'invoker-desk', key: 'x' })", "\n    'invoker-desk': {").length, 2);
  assert.ok(orbProblems("{ role: 'quality-engineer', label: 'QE', orb: 'wex' }", ['quality-engineer', 'platform-engineer']).includes('orbs.ts: no orb for agents/platform-engineer.md'));
  assert.deepEqual(networkProblems({ 'a.ts': 'await $.http.fetch(url)' }), ['a.ts: reaches the network, a process or a tool']);
  assert.equal(networkProblems({ 'b.ts': "await $.tool.call({ tool: 'Bash' })", 'c.ts': '$.telemetry.log(x)' }).length, 2);
  assert.equal(portraitProblems("export const PORTRAIT = 'https://host/invoker.png'").length, 1);
  assert.equal(portraitProblems("export const PORTRAIT =\n  'data:text/html;base64,PHNjcmlwdD4='").length, 1);
  assert.equal(portraitProblems('export const PORTRAIT = "data:image/png;base64,AAAA"').length, 1);
  assert.equal(portraitProblems("export const PORTRAIT = '' + 'https://host/invoker.png'").length, 1);
  assert.equal(portraitProblems(`export const PORTRAIT = 'data:image/jpeg;base64,${'A'.repeat(120_000)}'`).length, 1);
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
      ...portraitProblems(read(join(DESK, 'portrait.ts'))),
    ],
    [],
  );
});
