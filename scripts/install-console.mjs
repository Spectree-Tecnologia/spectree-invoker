#!/usr/bin/env node
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, lstatSync, renameSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inside, refuse } from './lib/work.mjs';

const source = fileURLToPath(new URL('..', import.meta.url));
export function installConsole(destination, { apply = false } = {}) {
  const root = resolve(destination);
  const files = new Map();
  function collect(rel) {
    const path = inside(source, rel), stat = lstatSync(path);
    if (stat.isDirectory()) for (const name of readdirSync(path).sort()) collect(`${rel}/${name}`);
    else if (stat.isFile()) files.set(rel, readFileSync(path));
    else refuse('E_INSTALL_SOURCE', 'Only regular package files can be installed.');
  }
  for (const rel of ['console', 'schemas', 'adapters', 'scripts/lib', 'scripts/console.mjs', 'scripts/state.mjs', 'package.json']) collect(rel);
  const version = JSON.parse(files.get('package.json')).version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) refuse('E_INSTALL_VERSION', 'Invalid package version.');
  const digest = createHash('sha256');
  for (const [path, bytes] of files) digest.update(path).update('\0').update(bytes).update('\0');
  const release = `${version}-${digest.digest('hex').slice(0, 16)}`;
  const base = `releases/${release}`;
  const launchers = {
    'spectree-console.cmd': `@echo off\r\nREM Spectree Console managed launcher\r\nnode "%~dp0releases\\${release}\\scripts\\console.mjs" %*\r\n`,
    'spectree-console': `#!/bin/sh\n# Spectree Console managed launcher\nexec node "$(dirname "$0")/releases/${release}/scripts/console.mjs" "$@"\n`,
  };
  for (const name of Object.keys(launchers)) {
    const path = inside(root, name);
    if (existsSync(path) && (!lstatSync(path).isFile() || !readFileSync(path, 'utf8').includes('Spectree Console managed launcher'))) refuse('E_INSTALL_CONFLICT', 'Destination contains an unmanaged launcher.');
  }
  const installed = existsSync(inside(root, base));
  if (installed) for (const [rel, bytes] of files) {
    const target = inside(root, `${base}/${rel}`);
    if (!existsSync(target) || !lstatSync(target).isFile() || !readFileSync(target).equals(bytes)) refuse('E_INSTALL_IMMUTABLE', 'Existing release is incomplete or modified; choose a new destination.');
  }
  const plan = { version, release, destination: root, files: files.size, apply, installed,
    command: join(root, process.platform === 'win32' ? 'spectree-console.cmd' : 'spectree-console') };
  if (!apply) return plan;
  if (!installed) for (const [rel, bytes] of files) {
    const target = inside(root, `${base}/${rel}`);
    mkdirSync(resolve(target, '..'), { recursive: true }); writeFileSync(target, bytes, { flag: 'wx' });
  }
  for (const [name, text] of Object.entries(launchers)) {
    const target = inside(root, name), temp = inside(root, `${name}.${process.pid}.tmp`);
    writeFileSync(temp, text, { flag: 'wx' }); renameSync(temp, target);
    if (process.platform !== 'win32' && name === 'spectree-console') chmodSync(target, 0o755);
  }
  return { ...plan, installed: true };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [destination, flag, ...extra] = process.argv.slice(2);
    if (!destination || destination.startsWith('--') || (flag && flag !== '--apply') || extra.length) throw new Error('usage: node scripts/install-console.mjs <destination> [--apply]');
    console.log(JSON.stringify(installConsole(destination, { apply: flag === '--apply' }), null, 2));
  } catch (e) { console.error(`${e.code ?? 'E_INSTALL'}: ${e.message}`); process.exitCode = 1; }
}
