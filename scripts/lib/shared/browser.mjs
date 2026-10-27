// Whether the Chromium build the project's Playwright asks for is on disk, read from the filesystem
// alone: the revision from Playwright's own browsers.json, the folder from its cache layout. Nothing
// is launched, installed or downloaded, and no code of the project's dependencies runs.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// The folders Playwright installs each Chromium build into: `<name with _>-<revision>`.
const CHROMIUM = ['chromium', 'chromium-headless-shell'];

/** Where Playwright keeps its browsers, by the same rules it uses to install them. */
export function playwrightCacheRoot({ env = process.env, platform = process.platform, home = homedir(), core } = {}) {
  const declared = env.PLAYWRIGHT_BROWSERS_PATH;
  if (declared === '0') return core ? join(core, '.local-browsers') : null;
  if (declared) return declared;
  if (platform === 'darwin') return join(home, 'Library', 'Caches', 'ms-playwright');
  if (platform === 'win32') return env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'ms-playwright') : null;
  return join(env.XDG_CACHE_HOME || join(home, '.cache'), 'ms-playwright');
}

/**
 * `none`: the project has no Playwright. `present`: every Chromium build it installs by default is
 * on disk. `absent`: at least one is missing, named in `missing`. `unknown`: the manifest or the
 * cache cannot be read; never reported as present.
 */
export function playwrightBrowsers(projectRoot, options = {}) {
  const core = [join(projectRoot, 'node_modules', 'playwright-core'),
    join(projectRoot, 'node_modules', 'playwright', 'node_modules', 'playwright-core')].find((p) => existsSync(join(p, 'browsers.json')));
  if (!core) return { status: 'none' };
  let manifest;
  try { manifest = JSON.parse(readFileSync(join(core, 'browsers.json'), 'utf8')); } catch { return { status: 'unknown', reason: `${join(core, 'browsers.json')} is not readable JSON` }; }
  const wanted = (Array.isArray(manifest?.browsers) ? manifest.browsers : [])
    .filter((b) => CHROMIUM.includes(b?.name) && b.installByDefault !== false && typeof b.revision === 'string' && b.revision)
    .map((b) => `${b.name.replaceAll('-', '_')}-${b.revision}`);
  if (!wanted.length) return { status: 'unknown', reason: 'browsers.json names no Chromium build' };
  const root = playwrightCacheRoot({ ...options, core });
  if (!root) return { status: 'unknown', reason: 'the Playwright browser cache has no resolvable location here' };
  const missing = wanted.filter((dir) => !existsSync(join(root, dir)));
  return { status: missing.length ? 'absent' : 'present', root, wanted, missing };
}
