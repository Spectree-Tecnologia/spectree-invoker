#!/usr/bin/env node
// Sanity check for the plugin's manifest surface.
//
//   node scripts/check-plugin.mjs [rootDir]
//
// Exits 0 when clean, 1 with one line per problem otherwise.
//
// It checks only what breaks the plugin *silently* -- at install time or at
// dispatch time, with no error anywhere pointing back at the cause. Prose
// quality is not checkable and is not attempted here.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const problems = [];
const fail = (where, msg) => problems.push(where + ': ' + msg);

function readJson(relPath) {
  const abs = join(root, relPath);
  if (!existsSync(abs)) {
    fail(relPath, 'missing');
    return null;
  }
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    fail(relPath, 'invalid JSON -- ' + e.message);
    return null;
  }
}

// Frontmatter, deliberately dumb: no YAML dependency to read two keys.
function frontmatter(abs) {
  // Normalise CRLF first: this repo is authored on Windows, and in a JS regex
  // `.` does not match \r, so a trailing \r makes every `key: value` line miss.
  const text = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const out = {};
  for (const line of text.slice(3, end).split('\n')) {
    const m = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const markdownIn = (dir) => {
  const abs = join(root, dir);
  return existsSync(abs) ? readdirSync(abs).filter((f) => f.endsWith('.md')) : [];
};

// --- the Invoker's own definition ships with the plugin ----------------------
// Without this file the Invoker stops at boot, by its own rule. It is the most
// load-bearing file here and the easiest to lose in a restructure.
if (!existsSync(join(root, 'CLAUDE.md'))) {
  fail('CLAUDE.md', "missing -- it is the Invoker's definition and ships inside the plugin");
}

// --- manifests ---------------------------------------------------------------
const plugin = readJson('.claude-plugin/plugin.json');
if (plugin) {
  for (const key of ['name', 'description', 'version']) {
    if (!plugin[key]) fail('.claude-plugin/plugin.json', 'missing "' + key + '"');
  }
  if (plugin.version && !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(plugin.version)) {
    fail('.claude-plugin/plugin.json', 'version "' + plugin.version + '" is not semver');
  }
}

const marketplace = readJson('.claude-plugin/marketplace.json');
if (marketplace) {
  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) {
    fail('.claude-plugin/marketplace.json', 'plugins[] missing or empty');
  } else {
    for (const entry of marketplace.plugins) {
      if (!entry.source) {
        fail('.claude-plugin/marketplace.json', 'entry "' + entry.name + '" has no source');
      } else if (!existsSync(resolve(root, entry.source))) {
        fail('.claude-plugin/marketplace.json', 'source "' + entry.source + '" does not exist');
      }
      if (plugin && entry.name && entry.name !== plugin.name) {
        fail('.claude-plugin/marketplace.json', 'entry name "' + entry.name +
          '" does not match plugin.json name "' + plugin.name + '"');
      }
    }
  }
}

// --- agent cards and commands ------------------------------------------------
// A frontmatter name that drifts from the filename errors nowhere: the agent
// just stops being dispatchable under the name everything else refers to.
for (const file of markdownIn('agents')) {
  const where = 'agents/' + file;
  const fm = frontmatter(join(root, 'agents', file));
  if (!fm) {
    fail(where, 'no frontmatter block');
    continue;
  }
  for (const key of ['name', 'description']) {
    if (!fm[key]) fail(where, 'frontmatter missing "' + key + '"');
  }
  const stem = basename(file, '.md');
  if (fm.name && fm.name !== stem) {
    fail(where, 'frontmatter name "' + fm.name + '" does not match the filename "' + stem + '"');
  }
}

for (const file of markdownIn('commands')) {
  const where = 'commands/' + file;
  const fm = frontmatter(join(root, 'commands', file));
  if (!fm) {
    fail(where, 'no frontmatter block');
    continue;
  }
  if (!fm.description) fail(where, 'frontmatter missing "description"');
}

// --- report ------------------------------------------------------------------
if (problems.length > 0) {
  console.error('check:plugin FAILED -- ' + problems.length + ' problem(s)\n');
  for (const p of problems) console.error('  ' + p);
  console.error('');
  process.exit(1);
}
console.log('check:plugin OK -- manifests, CLAUDE.md, ' +
  markdownIn('agents').length + ' agent card(s), ' +
  markdownIn('commands').length + ' command(s).');
