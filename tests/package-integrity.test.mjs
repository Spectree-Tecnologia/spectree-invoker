// §15.2 missing specialist · §15.3 missing entrypoint · §15.4 broken reference
// §15.5 drift between core and adapters · §15.13 empty required test set
// §15.26 both adapters read the same state
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir, cleanup, REPO } from './helpers.mjs';

function pkgCopy() {
  const dir = join(tempDir('spectree-pkg-'), 'pkg');
  mkdirSync(dir, { recursive: true });
  for (const d of ['protocol', 'adapters', 'schemas', 'scripts', 'agents', 'commands', 'tests', 'evals', '.claude-plugin']) {
    if (existsSync(join(REPO, d))) cpSync(join(REPO, d), join(dir, d), { recursive: true });
  }
  for (const f of ['CLAUDE.md', 'package.json', 'docs/protocol-rationale.md']) {
    if (existsSync(join(REPO, f))) cpSync(join(REPO, f), join(dir, f));
  }
  return dir;
}

function check(dir) {
  try {
    const out = execFileSync(process.execPath, [join(REPO, 'scripts', 'check-plugin.mjs'), dir], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? -1, out: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

test('the real package passes its own integrity check', () => {
  const r = check(REPO);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Structural integrity only/, 'the green says what it does not cover');
});

test('reliability entrypoints and their libraries are required package content', () => {
  for (const file of ['scripts/work.mjs', 'scripts/lib/evidence/mutation.mjs']) {
    const dir = pkgCopy();
    try {
      rmSync(join(dir, file));
      const result = check(dir);
      assert.equal(result.code, 1);
      assert.match(result.out, /required reliability command or library missing/);
    } finally { cleanup(dir); }
  }
});

test('deleting every specialist card fails — it never reports "zero cards, OK"', () => {
  const dir = pkgCopy();
  try {
    rmSync(join(dir, 'agents'), { recursive: true, force: true });
    mkdirSync(join(dir, 'agents'));
    const r = check(dir);
    assert.equal(r.code, 1, 'an empty agents/ directory must fail');
    assert.match(r.out, /required specialist card missing/);
    assert.equal((r.out.match(/required specialist card missing/g) ?? []).length, 6, 'all six are named');
  } finally { cleanup(dir); }
});

test('removing one specialist from the manifest fails', () => {
  const dir = pkgCopy();
  try {
    const f = join(dir, 'protocol', 'manifest.json');
    const m = JSON.parse(readFileSync(f, 'utf8'));
    m.roles = m.roles.filter((r) => r !== 'quality-engineer');
    writeFileSync(f, JSON.stringify(m, null, 2));
    const r = check(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /does not declare the required specialist "quality-engineer"/);
  } finally { cleanup(dir); }
});

test('a specialist the squad does not have fails, and is named', () => {
  // The literal "exactly 5" this replaces would have refused a sixth type for the wrong reason —
  // a stale number — and accepted any swap that kept the count. The list is the contract now.
  const dir = pkgCopy();
  try {
    const f = join(dir, 'protocol', 'manifest.json');
    const m = JSON.parse(readFileSync(f, 'utf8'));
    m.roles.push('growth-hacker');
    writeFileSync(f, JSON.stringify(m, null, 2));
    const r = check(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /declares "growth-hacker", which is not a specialist the squad has/);
  } finally { cleanup(dir); }
});

test('a missing entrypoint fails, for each harness', () => {
  for (const [file, needle] of [['commands/invoker.md', /Claude Code entrypoint is missing/], ['adapters/codex/dist/SQUAD.md', /Codex squad document is missing/]]) {
    const dir = pkgCopy();
    try {
      rmSync(join(dir, file), { force: true });
      const r = check(dir);
      assert.equal(r.code, 1, `${file} removed must fail`);
      assert.match(r.out, needle);
    } finally { cleanup(dir); }
  }
});

test('a missing required directory fails', () => {
  const dir = pkgCopy();
  try {
    rmSync(join(dir, 'schemas'), { recursive: true, force: true });
    const r = check(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /required directory missing/);
  } finally { cleanup(dir); }
});

test('a broken cross-reference fails', () => {
  const dir = pkgCopy();
  try {
    const f = join(dir, 'CLAUDE.md');
    writeFileSync(f, readFileSync(f, 'utf8').replace('Section 10', 'Section 99'));
    const r = check(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /refers to "Section 99"/);
  } finally { cleanup(dir); }
});

test('a rendered core that drops a rule from the inventory fails', () => {
  const dir = pkgCopy();
  try {
    const f = join(dir, 'adapters/codex/dist/SQUAD.md');
    writeFileSync(f, readFileSync(f, 'utf8').replace('**One voice.**', ''));
    const r = check(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /SQUAD\.md: dropped the rule "One voice\."/);
  } finally { cleanup(dir); }
});

test('a rendered core over its size ceiling, or without its rationale, fails', () => {
  const dir = pkgCopy();
  try {
    const f = join(dir, 'CLAUDE.md');
    writeFileSync(f, readFileSync(f, 'utf8') + '\n' + 'x'.repeat(46080));
    rmSync(join(dir, 'docs', 'protocol-rationale.md'));
    const r = check(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /CLAUDE\.md: is \d+ bytes, over the 46080-byte ceiling/);
    assert.match(r.out, /protocol-rationale\.md: the protocol rationale is missing/);
  } finally { cleanup(dir); }
});

test('a rendered card that drops a rule, or grows past its ceiling, fails on each harness', () => {
  const dir = pkgCopy();
  try {
    const sa = join(dir, 'adapters/codex/dist/agents/solutions_architect.toml');
    writeFileSync(sa, readFileSync(sa, 'utf8').replace('**Extract leaves first.**', ''));
    const pe = join(dir, 'agents/platform-engineer.md');
    writeFileSync(pe, readFileSync(pe, 'utf8') + '\n' + 'x'.repeat(22528));
    const r = check(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /solutions_architect\.toml: dropped the rule "Extract leaves first\." \(Modularizing a legacy codebase\)/);
    assert.match(r.out, /platform-engineer\.md: is \d+ bytes, over the 22528-byte ceiling/);
  } finally { cleanup(dir); }
});

test('an invalid manifest fails', () => {
  const dir = pkgCopy();
  try {
    writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), '{ not json');
    const r = check(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /invalid JSON/);
  } finally { cleanup(dir); }
});

test('an empty required test set fails', () => {
  const dir = pkgCopy();
  try {
    rmSync(join(dir, 'tests'), { recursive: true, force: true });
    mkdirSync(join(dir, 'tests'));
    const r = check(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /an empty suite is not a passing suite/);
  } finally { cleanup(dir); }
});

test('a missing Codex specialist fails', () => {
  const dir = pkgCopy();
  try {
    rmSync(join(dir, 'adapters/codex/dist/agents/quality_engineer.toml'), { force: true });
    const r = check(dir);
    assert.equal(r.code, 1);
    assert.match(r.out, /required Codex specialist missing/);
  } finally { cleanup(dir); }
});

test('generated files are checked for drift against the protocol', () => {
  const drift = (dir) => {
    try { execFileSync(process.execPath, [join(REPO, 'scripts', 'build.mjs'), '--check'], { cwd: dir, encoding: 'utf8' }); return 0; }
    catch (e) { return e.status ?? -1; }
  };
  assert.equal(drift(REPO), 0, 'the repository is in sync with protocol/');
});

test('hand-editing a generated file is detected as drift', () => {
  // On a COPY, always. A test that edits the real package can leave it dirty when it is
  // interrupted, and it makes the suite unrunnable under read-only authorisation.
  const dir = pkgCopy();
  try {
    const f = join(dir, 'CLAUDE.md');
    writeFileSync(f, readFileSync(f, 'utf8') + '\nA line somebody typed straight into the generated file.\n');
    let code = 0;
    try { execFileSync(process.execPath, [join(dir, 'scripts', 'build.mjs'), '--check'], { cwd: dir, encoding: 'utf8' }); }
    catch (e) { code = e.status ?? -1; }
    assert.equal(code, 1, 'an edit that bypasses protocol/ must fail CI');
  } finally { cleanup(dir); }
});

test('the suite leaves the package under test byte-identical', () => {
  // The guard for the rule above: nothing in tests/ may write inside REPO.
  const before = readFileSync(join(REPO, 'CLAUDE.md'), 'utf8');
  const out = execFileSync(process.execPath, [join(REPO, 'scripts', 'build.mjs'), '--check'], { encoding: 'utf8' });
  assert.match(out, /OK/);
  assert.equal(readFileSync(join(REPO, 'CLAUDE.md'), 'utf8'), before);
});

test('both adapters render every required role from the same protocol body', async () => {
  const { renderAdapter } = await import('../scripts/build.mjs');
  const roles = ['solutions-architect', 'full-stack-developer', 'quality-engineer', 'platform-engineer', 'integration-engineer', 'typesafe-engineer'];
  const claude = renderAdapter('claude-code');
  const codex = renderAdapter('codex');
  for (const r of roles) {
    assert.ok(claude.some((f) => f.path === `agents/${r}.md`), `claude-code renders ${r}`);
    assert.ok(codex.some((f) => f.path.endsWith(`${r.replace(/-/g, '_')}.toml`)), `codex renders ${r}`);
  }
  // The invariant that matters: the same rule text reaches both.
  const marker = 'Never accept two representations of the same concept across modules';
  assert.ok(claude.find((f) => f.path === 'CLAUDE.md').content.includes(marker));
  assert.ok(codex.find((f) => f.path.endsWith('SQUAD.md')).content.includes(marker));
});

test('the state contract reads the same in both adapters', async () => {
  const { Store } = await import('../scripts/lib/change/store.mjs');
  const { change } = await import('./helpers.mjs');
  const dir = tempDir();
  try {
    const s = new Store(dir);
    s.init({ project_id: 'p', protocol_version: '1.0.0' });
    for (const adapter of ['claude-code', 'codex']) {
      s.putChange(change({ change_id: `c-${adapter}`, adapter }));
    }
    const read = new Store(dir).changes();
    assert.equal(read.length, 2);
    assert.deepEqual(read.map((c) => c.adapter).sort(), ['claude-code', 'codex']);
    for (const c of read) assert.equal(c.state, 'draft', 'the same state means the same thing to both');
  } finally { cleanup(dir); }
});
