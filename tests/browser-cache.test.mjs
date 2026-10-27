// The Chromium build a project's Playwright launches is read from disk before the baseline, so a
// machine without it is told so up front (SYND passkeys: it surfaced only when pass 2 ran the browser suite).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO, cleanup } from './helpers.mjs';
import { playwrightBrowsers, playwrightCacheRoot } from '../scripts/lib/shared/browser.mjs';

const MANIFEST = { browsers: [
  { name: 'chromium', revision: '1243', installByDefault: true },
  { name: 'chromium-headless-shell', revision: '1243', installByDefault: true },
  { name: 'firefox', revision: '1543', installByDefault: true }] };
function fixture({ manifest = MANIFEST, installed = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pw-'));
  const project = join(root, 'project'), cache = join(root, 'cache');
  if (manifest !== null) {
    mkdirSync(join(project, 'node_modules', 'playwright-core'), { recursive: true });
    writeFileSync(join(project, 'node_modules', 'playwright-core', 'browsers.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  } else mkdirSync(project, { recursive: true });
  for (const dir of installed) mkdirSync(join(cache, dir), { recursive: true });
  return { root, project, cache, env: { PLAYWRIGHT_BROWSERS_PATH: cache } };
}

test('the Chromium builds Playwright installs by default are present, absent by name, or unknown', () => {
  const none = fixture({ manifest: null });
  const absent = fixture({ installed: ['chromium-1243'] });
  const old = fixture({ installed: ['chromium-1200', 'chromium_headless_shell-1200'] });
  const present = fixture({ installed: ['chromium-1243', 'chromium_headless_shell-1243'] });
  const broken = fixture({ manifest: '{not json' });
  try {
    assert.equal(playwrightBrowsers(none.project, { env: none.env }).status, 'none');
    const a = playwrightBrowsers(absent.project, { env: absent.env });
    assert.equal(a.status, 'absent'); assert.deepEqual(a.missing, ['chromium_headless_shell-1243']);
    assert.equal(playwrightBrowsers(old.project, { env: old.env }).status, 'absent', 'a build of another revision is not the one asked for');
    assert.equal(playwrightBrowsers(present.project, { env: present.env }).status, 'present');
    assert.equal(playwrightBrowsers(broken.project, { env: broken.env }).status, 'unknown');
    // A relative cache path is the project's: present read from another working directory too.
    assert.equal(playwrightBrowsers(present.project, { env: { PLAYWRIGHT_BROWSERS_PATH: '../cache' } }).status, 'present');
    const override = fixture({ manifest: { browsers: [{ name: 'chromium', revision: '1243', installByDefault: true, revisionOverrides: { mac14: '1200' } }] },
      installed: ['chromium-1243'] });
    assert.equal(playwrightBrowsers(override.project, { env: override.env }).status, 'unknown', 'a per-platform revision is not guessed');
    cleanup(override.root);
  } finally { for (const f of [none, absent, old, present, broken]) cleanup(f.root); }
});

test('the cache is found where Playwright installs it', () => {
  assert.equal(playwrightCacheRoot({ env: {}, platform: 'linux', home: '/h' }), join('/h', '.cache', 'ms-playwright'));
  assert.equal(playwrightCacheRoot({ env: { XDG_CACHE_HOME: '/x' }, platform: 'linux', home: '/h' }), join('/x', 'ms-playwright'));
  assert.equal(playwrightCacheRoot({ env: {}, platform: 'darwin', home: '/h' }), join('/h', 'Library', 'Caches', 'ms-playwright'));
  assert.equal(playwrightCacheRoot({ env: { LOCALAPPDATA: 'C:\\L' }, platform: 'win32', home: '/h' }), join('C:\\L', 'ms-playwright'));
  assert.equal(playwrightCacheRoot({ env: {}, platform: 'win32', home: '/h' }), join('/h', 'AppData', 'Local', 'ms-playwright'));
  assert.equal(playwrightCacheRoot({ env: { PLAYWRIGHT_BROWSERS_PATH: '/p' } }), '/p');
  assert.equal(playwrightCacheRoot({ env: { PLAYWRIGHT_BROWSERS_PATH: 'b' }, cwd: '/proj' }), resolve('/proj', 'b'));
  assert.equal(playwrightCacheRoot({ env: { PLAYWRIGHT_BROWSERS_PATH: '0' }, core: '/c' }), join('/c', '.local-browsers'));
});

test('capabilities.mjs names the missing build and the command that installs it', () => {
  const f = fixture({ installed: ['chromium-1243'] });
  try {
    const run = spawnSync(process.execPath, [join(REPO, 'scripts/capabilities.mjs'), '--json'],
      { encoding: 'utf8', env: { ...process.env, SPECTREE_PROJECT_ROOT: f.project, ...f.env } });
    const fact = JSON.parse(run.stdout).facts.find((x) => x.name === 'browser.playwright_chromium');
    assert.equal(fact.value, 'absent'); assert.equal(fact.confidence, 'VERIFIED');
    assert.match(fact.note, /chromium_headless_shell-1243/); assert.match(fact.note, /npx playwright install chromium/);
  } finally { cleanup(f.root); }
});
