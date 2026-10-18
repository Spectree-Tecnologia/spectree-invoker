import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The renderer is resolved as a dependency of this package, never by a path into the root
// node_modules: where npm places a workspace dependency is the installer's choice, not ours.
const vendor = dirname(fileURLToPath(import.meta.resolve('three')));

// Fixed package resources only. No generic file serving or consumer paths.
export function presenceAssets(live = false) {
  const files = new Map();
  const add = (route, file, type) => files.set(route, { type, body: readFileSync(file) });
  const own = (relative) => fileURLToPath(new URL(relative, import.meta.url));
  add('/presence/', own(live ? '../live.html' : '../index.html'), 'text/html; charset=utf-8');
  if (live) {
    for (const name of ['live', 'client', 'voice', 'voice-format', 'voice-capture', 'voice-player', 'voice-worklet', 'realtime']) add(`/presence/${name}.mjs`, own(`../${name}.mjs`), 'text/javascript; charset=utf-8');
    add('/presence/live.css', own('../live.css'), 'text/css; charset=utf-8');
  }
  add('/presence/style.css', own('../style.css'), 'text/css; charset=utf-8');
  for (const name of ['app', 'state', 'audio', 'renderer', 'renderer-core', 'lifecycle']) add(`/presence/${name}.mjs`, own(`../${name}.mjs`), 'text/javascript; charset=utf-8');
  for (const name of ['invoker-intro', 'architect', 'invoker-return']) add(`/presence/audio/${name}.mp3`, own(`../audio/${name}.mp3`), 'audio/mpeg');
  for (const name of ['three.module.js', 'three.core.js']) add(`/presence/vendor/${name}`, join(vendor, name), 'text/javascript; charset=utf-8');
  return files;
}
