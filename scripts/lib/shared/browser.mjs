// Whether the Chromium build the project's Playwright asks for is on disk, read from the filesystem
// alone: the revision from Playwright's own browsers.json, the folder from its cache layout. Nothing
// is launched, installed or downloaded, and no code of the project's dependencies runs.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';

// The folders Playwright installs each Chromium build into: `<name with _>-<revision>`.
const CHROMIUM = ['chromium', 'chromium-headless-shell'];

/** Where Playwright keeps its browsers, by the same rules it uses to install them. */
// A relative PLAYWRIGHT_BROWSERS_PATH is read from where the suite runs, the project root.
export function playwrightCacheRoot({ env = process.env, platform = process.platform, home = homedir(), core, cwd = process.cwd() } = {}) {
  const declared = env.PLAYWRIGHT_BROWSERS_PATH;
  if (declared === '0') return core ? join(core, '.local-browsers') : null;
  if (declared) return isAbsolute(declared) ? declared : resolve(cwd, declared);
  if (platform === 'darwin') return join(home, 'Library', 'Caches', 'ms-playwright');
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'ms-playwright');
  return join(env.XDG_CACHE_HOME || join(home, '.cache'), 'ms-playwright');
}

/**
 * `none`: the project neither has nor declares Playwright. `present`: every Chromium build it installs by default is
 * on disk. `absent`: at least one is missing, named in `missing`. `unknown`: the manifest or the
 * cache cannot be read; never reported as present.
 */
export function playwrightBrowsers(projectRoot, options = {}) {
  const core = [join(projectRoot, 'node_modules', 'playwright-core'),
    join(projectRoot, 'node_modules', 'playwright', 'node_modules', 'playwright-core')].find((p) => existsSync(join(p, 'browsers.json')));
  if (!core) {
    // A project that declares Playwright and keeps it where this does not look (pnpm's store, a
    // workspace root) has a browser suite all the same: not found is unknown, never "no Playwright".
    let pkg = null;
    try { pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')); } catch { /* no manifest, or unreadable */ }
    const deps = { ...pkg?.dependencies, ...pkg?.devDependencies, ...pkg?.optionalDependencies };
    if (['playwright', '@playwright/test', 'playwright-core'].some((name) => name in deps)) {
      return { status: 'unknown', reason: 'package.json declares Playwright, but no playwright-core/browsers.json is in node_modules where this reads it' };
    }
    return { status: 'none' };
  }
  let manifest;
  try { manifest = JSON.parse(readFileSync(join(core, 'browsers.json'), 'utf8')); } catch { return { status: 'unknown', reason: `${join(core, 'browsers.json')} is not readable JSON` }; }
  const chromium = (Array.isArray(manifest?.browsers) ? manifest.browsers : [])
    .filter((b) => CHROMIUM.includes(b?.name) && b.installByDefault !== false);
  // A per-platform revision is chosen by Playwright's host detection, which this does not repeat:
  // guessing it would report a build that is there as absent.
  if (chromium.some((b) => b.revisionOverrides && Object.keys(b.revisionOverrides).length)) {
    return { status: 'unknown', reason: 'browsers.json gives Chromium a per-platform revision this does not resolve' };
  }
  const wanted = chromium.filter((b) => typeof b.revision === 'string' && b.revision)
    .map((b) => `${b.name.replaceAll('-', '_')}-${b.revision}`);
  if (!wanted.length) return { status: 'unknown', reason: 'browsers.json names no Chromium build' };
  const root = playwrightCacheRoot({ cwd: projectRoot, ...options, core });
  if (!root) return { status: 'unknown', reason: 'the Playwright browser cache has no resolvable location here' };
  const missing = wanted.filter((dir) => !existsSync(join(root, dir)));
  return { status: missing.length ? 'absent' : 'present', root, wanted, missing };
}
