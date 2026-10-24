// The security gates of this repository's own CI, and the runtime floor. The protocol promises
// dependency and secret scanning in CI (Section 4), and until v1.48.0 this repository ran neither
// while its consumer blueprint ran one. Each guard is first shown rejecting the shape main had then.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO, tempDir, cleanup } from './helpers.mjs';
import { satisfiesFloor } from '../scripts/lib/shared/index.mjs';

const read = (rel) => readFileSync(join(REPO, rel), 'utf8');

// --- the runtime floor -------------------------------------------------------------------------

// The floor is read with the same function the installed scripts use, so the test and the
// runtime cannot disagree about what the range means.
const satisfies = satisfiesFloor;

// Node.js security release of 2026-10-21: CVE-2026-111497 (Brotli RCE), the TLS hostname bypasses
// and the eMudhra chain rejection are fixed in 22.23.4, 24.22.1 and 26.12.1. 20.x gets no fix.
const UNPATCHED = ['20.11.0', '20.19.5', '22.22.0', '22.23.3', '24.22.0', '25.9.0', '26.12.0'];
const PATCHED = ['22.23.4', '22.24.0', '24.22.1', '24.23.0', '26.12.1', '27.0.0'];

test('the engines floor admits only runtimes carrying the 2026-10-21 fixes', () => {
  assert.ok(UNPATCHED.every((v) => satisfies(v, '>=20.11.0')), 'the floor main had admits every unpatched line');
  const { engines } = JSON.parse(read('package.json'));
  for (const v of UNPATCHED) assert.equal(satisfies(v, engines.node), false, `${v} is refused`);
  for (const v of PATCHED) assert.equal(satisfies(v, engines.node), true, `${v} is accepted`);
});

test('a range the floor reader does not understand is unknown, never satisfied', () => {
  assert.equal(satisfiesFloor('22.23.4', '~22.23.4'), null);
  assert.equal(satisfiesFloor('22.23.4', '^22.23.4 || 24.x'), null, 'one unknown comparator spoils the whole range');
  assert.equal(satisfiesFloor('nightly', '>=22.0.0'), null);
  assert.equal(satisfiesFloor('22.23.4', ''), null);
});

// D-015: npm enforces the floor only for whoever installs this package. A consumer runs the
// installed scripts on its own Node, so the capability report has to say when that Node is below.
test('an installed consumer reports a runtime below the floor, and a runtime that meets it', () => {
  const dir = tempDir('spectree-floor-');
  try {
    const install = spawnSync(process.execPath, [join(REPO, 'scripts/install-codex.mjs'), dir, '--apply'], { encoding: 'utf8' });
    assert.equal(install.status, 0, install.stderr);
    const squad = join(dir, '.spectree/squad');
    const report = () => {
      const r = spawnSync(process.execPath, [join(squad, 'scripts/capabilities.mjs'), '--json'], { cwd: dir, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(r.stdout).facts.find((f) => f.name === 'runtime.floor');
    };
    assert.deepEqual([report().value, report().confidence], ['met', 'VERIFIED'], 'this suite runs on a runtime at the floor');

    const pkgFile = join(squad, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
    pkg.engines.node = `>=${Number(process.versions.node.split('.')[0]) + 1}.0.0`;
    writeFileSync(pkgFile, JSON.stringify(pkg));
    const below = report();
    assert.equal(below.value, 'BELOW FLOOR');
    assert.match(below.note, /Upgrade Node/);

    delete pkg.engines;
    writeFileSync(pkgFile, JSON.stringify(pkg));
    assert.deepEqual([report().value, report().confidence], ['unknown', 'UNKNOWN'], 'no floor is unknown, never met');
  } finally { cleanup(dir); }
});

test('npm refuses to install on a runtime below the floor instead of warning', () => {
  assert.match(read('.npmrc'), /^engine-strict=true$/m);
});

// --- the workflow -------------------------------------------------------------------------------

/** `uses:` references not pinned to a full commit SHA. A tag can be moved; a SHA cannot. */
const unpinned = (text) => [...text.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]).filter((u) => !/@[0-9a-f]{40}$/.test(u));

/** The top-level token permission, before the first job. */
const readOnlyByDefault = (text) => /^permissions:\n\s+contents: read$/m.test(text.slice(0, text.indexOf('\njobs:')));

/** Jobs whose checkout leaves the token on the runner's disk, other than the one that pushes. */
function persistedCheckouts(text, allowed = ['tag']) {
  const jobs = text.slice(text.indexOf('\njobs:')).split(/\n(?= {2}[a-z][\w-]*:\n)/).slice(1);
  return jobs.flatMap((job) => {
    const name = job.match(/^ {2}([\w-]+):/)[1];
    const checkouts = job.split(/(?=- uses: actions\/checkout)/).slice(1).map((c) => c.split(/\n {6}- /)[0]);
    return allowed.includes(name) ? [] : checkouts.filter((c) => !/persist-credentials: false/.test(c)).map(() => name);
  });
}

const gates = (text) => ({
  audit: /npm audit --audit-level=high/.test(text),
  secrets: /gitleaks" git /.test(text) && /sha256sum -c/.test(text),
});

// The plugin job as main had it before v1.48.0, in the parts these guards read.
const BEFORE = `name: check
on:
  pull_request:

jobs:
  classify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
  plugin:
    needs: classify
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci --ignore-scripts --no-audit --no-fund
`;

test('each workflow guard refuses the shape main had before v1.48.0', () => {
  assert.deepEqual(unpinned(BEFORE), ['actions/checkout@v4', 'actions/checkout@v4', 'actions/setup-node@v4']);
  assert.equal(readOnlyByDefault(BEFORE), false);
  assert.deepEqual(persistedCheckouts(BEFORE), ['classify', 'plugin']);
  assert.deepEqual(gates(BEFORE), { audit: false, secrets: false });
});

for (const file of ['check.yml', 'security-watch.yml']) {
  test(`${file}: pinned actions, a read-only token, and no credential left on disk`, () => {
    const text = read(`.github/workflows/${file}`);
    assert.deepEqual(unpinned(text), []);
    assert.ok(readOnlyByDefault(text), 'contents: read at the top');
    assert.deepEqual(persistedCheckouts(text), []);
  });
}

test('the required plugin job audits dependencies and scans the whole history for secrets', () => {
  const text = read('.github/workflows/check.yml');
  const plugin = text.slice(text.indexOf('\n  plugin:'), text.indexOf('\n  required:'));
  assert.deepEqual(gates(plugin), { audit: true, secrets: true });
  assert.match(plugin, /fetch-depth: 0/, 'the scan reads every commit, not the last one');
  assert.ok(plugin.indexOf('npm audit') < plugin.indexOf('npm test'), 'the gates run before the suite');
});

test('the daily watch re-audits main without a push', () => {
  const text = read('.github/workflows/security-watch.yml');
  assert.match(text, /schedule:\n\s+- cron: /);
  assert.ok(gates(text).audit);
});

// --- the blue team as a process ------------------------------------------------------------------
// Not a role (Section 4): the defence splits along the boundaries the squad already has. These pin
// the promises each skill makes and the cards that load it, so neither can quietly drop one.

const skill = (name) => read(`skills/${name}/SKILL.md`);

test('the security watch turns advisories into cited verdicts, and never rounds unknown down', () => {
  const body = skill('squad-security-watch');
  assert.match(body, /Verdict: +affected \| not affected \| unknown/);
  assert.match(body, /never rounded down to `not affected`/);
  assert.match(body, /CISA KEV/, 'exploitation is read from the catalogue, not from a headline');
  assert.match(body, /seen reporting a known-defective input/, 'a clean report has to have been able to fail');
  assert.match(body, /Never runs an exploit/);
});

test('incident response keeps every production step at gate 3, and silencing a tool is never a fix', () => {
  const body = skill('squad-incident-response');
  for (const p of ['P1', 'P2', 'P3']) assert.match(body, new RegExp(`\\*\\*${p}\\*\\*`));
  const gate3 = body.slice(body.indexOf('**Gate 3'), body.indexOf('## 3.'));
  for (const step of ['production', 'credential that production uses', 'default branch', 'outside the project']) {
    assert.ok(gate3.includes(step), `"${step}" is a gate 3 step`);
  }
  assert.match(body, /Never disable a check, lower an audit level or allowlist an advisory/);
  assert.match(body, /closes on commands/);
});

test('each role that owns a part of the defence points at its skill, on both harnesses', () => {
  const pointers = {
    'integration-engineer': ['agents/integration-engineer.md', 'adapters/codex/dist/agents/integration_engineer.toml', 'squad-security-watch'],
    'platform-engineer': ['agents/platform-engineer.md', 'adapters/codex/dist/agents/platform_engineer.toml', 'squad-incident-response'],
    'quality-engineer': ['agents/quality-engineer.md', 'adapters/codex/dist/agents/quality_engineer.toml', 'squad-incident-response'],
  };
  for (const [claude, codex, name] of Object.values(pointers)) {
    for (const f of [claude, codex]) assert.match(read(f), new RegExp(`Load the squad skill \`${name}\``), `${f} loads ${name}`);
  }
  assert.match(read('agents/quality-engineer.md'), /\*\*Red team, when the change answers a security advisory\.\*\*/);
  assert.match(read('CLAUDE.md'), /A "Blue Team" crosses no boundary\. Security lives in .*`squad-security-watch` and `squad-incident-response`/);
});
