// The measured half of a closure retro: what one merged PR went through, read from GitHub and from
// the merge in git, plus the known finding signatures that reading matches. The judgement stays
// with the Invoker and the squad skill `squad-closure-retro`; this file only makes sure the retro
// starts from signals somebody measured, not from memory of the session.
//
// It reads only. Nothing here comments, merges or writes outside `.spectree/retros/`. `trends` reads
// the retros already written and says which findings came back and which went quiet; whether that
// earns a change of its own is still the Invoker's call.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { flags, git, inside, publishOnce, pullRequestRecord, refuse, runsForCommit } from '../shared/index.mjs';

// A commit that only brings the base in and moves the candidate's version or test id: the
// signature of identifiers reserved by a PR and lost to a sibling that merged first (R-001).
const BASE_MERGE = /integra (a )?main|traz a main|sobe a candidata|merge remote-tracking branch 'origin\/main'/i;
const PASSED = new Set(['success', 'skipped', 'neutral']);

export const SIGNATURES = {
  identifiers: 'tool-economy · release · identificador-sequencial-disputado',
  closure: 'automated-checks · docs · fechamento-depois-do-merge',
  trail: 'information-access · retro · rastro-apagado',
  red: 'automated-checks · ci · vermelho-no-pr',
};

const minutes = (from, to) => {
  const a = Date.parse(from ?? ''); const b = Date.parse(to ?? '');
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 60000) : null;
};

/** The PR body's `## Atrito` section: `missing`, `empty`, or its text. */
export function frictionSection(body) {
  const m = /^##\s+Atrito\s*$([\s\S]*?)(?=^##\s|^---\s*$|(?![\s\S]))/m.exec(String(body ?? ''));
  if (!m) return { status: 'missing', text: null };
  const text = m[1].trim();
  return text ? { status: 'present', text } : { status: 'empty', text: null };
}

/**
 * Signals and candidate findings for one merged PR. Pure: every input was read by the caller.
 *
 * @param {{ pr: object, commits: {sha: string, subject: string}[], runs: Record<string, {runs: object[], complete: boolean}>,
 *   archived: {path: string, proposal: string}[], version: string | null }} input
 */
export function retroSignals({ pr, commits, runs, archived, version }) {
  const heads = commits.filter((c) => runs[c.sha]?.runs.length);
  const red = heads.flatMap((c) => runs[c.sha].runs.filter((r) => !PASSED.has(r.conclusion))
    .map((r) => ({ sha: c.sha.slice(0, 7), conclusion: r.conclusion ?? null, run: r.databaseId ?? null })));
  const baseMerges = commits.filter((c) => BASE_MERGE.test(c.subject));
  const friction = frictionSection(pr.body);
  const namesRelease = version ? archived.filter((a) => a.proposal.includes(`v${version}`)) : [];

  const candidates = [];
  if (baseMerges.length) candidates.push({ signature: SIGNATURES.identifiers, evidence: baseMerges.map((c) => `${c.sha.slice(0, 7)} ${c.subject}`) });
  if (version && !namesRelease.length) {
    candidates.push({ signature: SIGNATURES.closure, evidence: [`no proposal archived by this merge names v${version}`, ...archived.map((a) => a.path)] });
  }
  if (friction.status !== 'present') candidates.push({ signature: SIGNATURES.trail, evidence: [`PR body: Atrito section ${friction.status}`] });
  if (red.length) candidates.push({ signature: SIGNATURES.red, evidence: red.map((r) => `${r.sha} ${r.conclusion} run ${r.run}`) });

  return {
    pr: { number: pr.number, title: pr.title ?? null, url: pr.html_url ?? null, opened: pr.created_at ?? null, merged: pr.merged_at ?? null },
    signals: {
      open_minutes: minutes(pr.created_at, pr.merged_at),
      commits: commits.length,
      ci_heads: heads.length,
      // A page that came back full may hide runs; that count is then a floor, not the answer.
      ci_runs_complete: commits.every((c) => runs[c.sha]?.complete === true),
      ci_red: red,
      base_merges: baseMerges.length,
      review_comments: Number.isInteger(pr.review_comments) ? pr.review_comments : null,
      comments: Number.isInteger(pr.comments) ? pr.comments : null,
      friction: friction.status,
      release: version ? `v${version}` : null,
      archived: archived.map((a) => a.path),
    },
    friction: friction.text,
    candidates,
    meaning: 'Measured signals and matched signatures only. A candidate is not a finding until the retro judges it, and an empty list is not a clean change.',
  };
}

const remoteRepo = (root) => {
  const url = git(root, ['remote', 'get-url', 'origin']).trim();
  const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  return m ? m[1] : null;
};

/** What the merge itself says: its commits, the proposals it archived and the release it became. */
function readMerge(root, sha, read) {
  let parents;
  try { parents = read(['rev-list', '--parents', '-n', '1', sha]).trim().split(' ').slice(1); }
  catch { refuse('E_RETRO_MERGE_UNKNOWN', `The merge commit ${sha} is not in this clone; fetch the base branch first.`); }
  const range = parents.length > 1 ? [`${parents[0]}..${parents[1]}`] : ['-1', sha];
  const commits = read(['log', '--format=%H%x09%s', ...range]).split('\n').filter(Boolean)
    .map((l) => { const [s, ...rest] = l.split('\t'); return { sha: s, subject: rest.join('\t') }; });
  const archived = read(['diff', '--name-status', parents[0], sha, '--', 'docs/changes/archive']).split('\n')
    .map((l) => l.split('\t')).filter(([st, path]) => /^[AR]/.test(st ?? '') && /\/proposal\.md$/.test(path ?? ''))
    .map((cols) => cols[cols.length - 1])
    .map((path) => ({ path, proposal: read(['show', `${sha}:${path}`]) }));
  let version = null;
  try { version = JSON.parse(read(['show', `${sha}:package.json`])).version ?? null; } catch { version = null; }
  return { commits, archived, version };
}

/**
 * What `retro.recorded` checks: the retro is a file in the project that names its change on a
 * `Change:` line and says what was read. The judgement inside it is the Invoker's; this only
 * refuses a retro that does not exist, names another change, or never said what it read.
 */
export function retroDocument(root, changeId, rel) {
  const file = inside(root, rel);
  if (!existsSync(file)) refuse('E_RETRO_MISSING', `${rel} does not exist.`);
  const text = readFileSync(file, 'utf8');
  if (!text.includes(`Change: \`${changeId}\``)) refuse('E_RETRO_INCOMPLETE', `${rel} has no line "Change: \`${changeId}\`".`);
  if (!/^##\s+(O que foi lido|What was read)\s*$/m.test(text)) refuse('E_RETRO_INCOMPLETE', `${rel} does not say what was read; an empty retro still names what it read.`);
  return { ok: true, change_id: changeId, path: rel.replaceAll('\\', '/') };
}

const SIGNATURE = /`([a-z][a-z-]* · [a-z0-9][a-z0-9-]* · [a-z0-9][a-z0-9-]*)`/;
const FINDING_ID = /^\*\*(R-\d{3})\b/;
// A finding is quiet once this many later retros went by without it: the point where the method
// says an open finding is a candidate to close.
const QUIET_AFTER = 3;

/** The list items under a retro's `## Achados` or `## Findings`, each joined into one line. */
function findingItems(text) {
  const items = []; let inFindings = false; let item = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(line)) { inFindings = /^##\s+(Achados|Findings)\s*$/.test(line); item = null; continue; }
    if (!inFindings) continue;
    const start = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (start) { item = { text: start[1] }; items.push(item); }
    else if (!line.trim()) item = null;
    else if (item) item.text += ` ${line.trim()}`;
  }
  return items.map((i) => i.text);
}

/** `| R-NNN | `signature` | … | situation |` rows of the retros index, when the project keeps one. */
function indexRows(text) {
  const rows = new Map();
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split('|').map((c) => c.trim());
    if (!/^R-\d{3}$/.test(cells[1] ?? '')) continue;
    const situation = cells.at(-2) ?? '';
    const status = /^(aberto|open)\b/i.test(situation) ? 'open' : /^(pago|paid)\b/i.test(situation) ? 'paid' : 'other';
    rows.set(cells[1], { signature: SIGNATURE.exec(cells[2] ?? '')?.[1] ?? null, status, situation });
  }
  return rows;
}

/**
 * How each finding signature moved across the retros of a project, oldest retro first. Pure: the
 * caller read the files. A retro is ordered by the date in its name, then by the first PR number in
 * its title. A finding line that names an id without a signature counts under the signature that id
 * carries elsewhere; one with neither is left out and counted as `unsigned`.
 *
 * @param {{ retros: {path: string, text: string}[], index?: string | null }} input
 */
export function retroTrends({ retros, index = null }) {
  const rows = index ? indexRows(index) : new Map();
  const order = (r) => [r.path.split('/').at(-1).slice(0, 10), Number(/#(\d+)/.exec(r.text.split('\n')[0])?.[1] ?? Infinity), r.path];
  const sorted = [...retros].sort((a, b) => {
    const [x, y] = [order(a), order(b)];
    return x[0].localeCompare(y[0]) || x[1] - y[1] || x[2].localeCompare(y[2]);
  });
  const parsed = sorted.map((r) => ({
    change: /^Change: `([^`]+)`/m.exec(r.text)?.[1] ?? null,
    path: r.path,
    items: findingItems(r.text).map((t) => ({ id: FINDING_ID.exec(t)?.[1] ?? null, signature: SIGNATURE.exec(t)?.[1] ?? null })),
  }));
  const idSignature = new Map([...rows].filter(([, row]) => row.signature).map(([id, row]) => [id, row.signature]));
  parsed.flatMap((r) => r.items).forEach((i) => { if (i.id && i.signature && !idSignature.has(i.id)) idSignature.set(i.id, i.signature); });

  const bySignature = new Map(); let unsigned = 0;
  parsed.forEach((r, position) => {
    for (const item of r.items) {
      const signature = item.signature ?? (item.id ? idSignature.get(item.id) : null);
      if (!signature) { unsigned += 1; continue; }
      const entry = bySignature.get(signature) ?? { signature, ids: new Set(), positions: new Set(), retros: [] };
      if (item.id) entry.ids.add(item.id);
      if (!entry.positions.has(position)) { entry.positions.add(position); entry.retros.push(r.change ?? r.path); }
      bySignature.set(signature, entry);
    }
  });

  const findings = [...bySignature.values()].map((e) => {
    const ids = [...e.ids].sort();
    // A line written the way the skill asks carries no id, so the index is also read by signature.
    const row = ids.map((id) => rows.get(id)).find(Boolean) ?? [...rows.values()].find((r) => r.signature === e.signature) ?? null;
    const last = Math.max(...e.positions);
    return {
      signature: e.signature, ids, status: row?.status ?? null, situation: row?.situation ?? null,
      appearances: e.positions.size, retros: e.retros, last_seen: e.retros.at(-1), quiet_for: parsed.length - 1 - last,
    };
  }).sort((a, b) => b.appearances - a.appearances || a.signature.localeCompare(b.signature));

  return {
    retros: parsed.length,
    findings,
    // Unknown status is not paid: a finding nobody marked paid that came back is still recurring,
    // until it goes quiet; then it is a candidate to close, never both at once.
    recurring: findings.filter((f) => f.appearances >= 2 && f.status !== 'paid' && f.quiet_for < QUIET_AFTER).map((f) => f.signature),
    quiet: findings.filter((f) => f.status === 'open' && f.quiet_for >= QUIET_AFTER).map((f) => f.signature),
    unsigned,
    meaning: `Counted from the retros written, not from the changes: a finding no retro recorded is absent here. Recurring is a signature in two or more retros that no index marks paid and that has not gone quiet; quiet is an open one no retro has named in the last ${QUIET_AFTER}. Both are candidates, never decisions.`,
  };
}

/** Every retro in `dir` and, when present, its `README.md` index. */
function readRetros(root, rel) {
  const dir = inside(root, rel);
  if (!existsSync(dir)) refuse('E_RETRO_MISSING', `${rel} does not exist; trends read the retros a project already wrote.`);
  const names = readdirSync(dir).filter((n) => n.endsWith('.md') && n !== 'README.md' && statSync(join(dir, n)).isFile());
  const base = rel.replaceAll('\\', '/').replace(/\/$/, '');
  return {
    retros: names.map((n) => ({ path: `${base}/${n}`, text: readFileSync(join(dir, n), 'utf8') })),
    index: existsSync(join(dir, 'README.md')) ? readFileSync(join(dir, 'README.md'), 'utf8') : null,
  };
}

/**
 * `retro.mjs collect <pr> [--repo owner/name] [--apply]`, `retro.mjs check <change-id> <retro.md>` and
 * `retro.mjs trends [--dir docs/retros]`.
 * Returns the exit code: 0 collected or checked, 1 refused, 2 usage. `source` replaces the GitHub reads in a test.
 */
export function retroCommand({ root, argv, out = (s) => console.log(s), err = (s) => console.error(s), source }) {
  const [command, number] = argv;
  const usage = 'usage: retro.mjs collect <pr> [--repo owner/name] [--apply] | retro.mjs check <change-id> <retro.md> | retro.mjs trends [--dir docs/retros]';
  if (command === 'trends') {
    const f = flags(argv);
    const extra = argv.slice(1).filter((a, i, all) => a !== '--dir' && all[i - 1] !== '--dir');
    if (extra.length || (argv.includes('--dir') && !f.value('dir'))) { err(usage); return 2; }
    try { out(JSON.stringify({ ok: true, ...retroTrends(readRetros(root, f.value('dir') ?? 'docs/retros')) }, null, 2)); return 0; }
    catch (e) { err(`${e.code ?? 'E_RETRO'}: ${e.message}`); return 1; }
  }
  if (command === 'check') {
    if (!argv[1] || !argv[2] || argv.length > 3) { err(usage); return 2; }
    try { out(JSON.stringify(retroDocument(root, argv[1], argv[2]))); return 0; }
    catch (e) { err(`${e.code ?? 'E_RETRO'}: ${e.message}`); return 1; }
  }
  if (command !== 'collect' || !/^\d+$/.test(number ?? '')) {
    err(usage);
    return 2;
  }
  try {
    const read = source?.git ?? ((args) => git(root, args));
    const repo = flags(argv).value('repo') ?? (source ? null : remoteRepo(root));
    if (!repo && !source) refuse('E_RETRO_REPO', 'Cannot tell which repository this is; pass --repo owner/name.');
    const pr = (source?.pullRequest ?? ((n) => pullRequestRecord(n, { cwd: root, repo })))(Number(number));
    if (!pr.merged_at || !pr.merge_commit_sha) refuse('E_RETRO_NOT_MERGED', `PR #${number} is not merged; a retro reads a merge that happened.`);
    const merge = readMerge(root, pr.merge_commit_sha, read);
    const runsOf = source?.runs ?? ((sha) => runsForCommit(sha, { cwd: root, repo, event: 'pull_request' }));
    const runs = Object.fromEntries(merge.commits.map((c) => [c.sha, runsOf(c.sha)]));
    const result = { ok: true, repo, ...retroSignals({ pr, runs, ...merge }) };
    if (flags(argv).has('apply')) {
      const slug = merge.archived.find((a) => merge.version && a.proposal.includes(`v${merge.version}`))?.path.split('/').at(-2).slice(11);
      const file = join(root, '.spectree', 'retros', `${slug ?? `pr-${number}`}.signals.json`);
      try { publishOnce(file, `${JSON.stringify(result, null, 2)}\n`); }
      catch (e) { if (e.code === 'EEXIST') refuse('E_RETRO_EXISTS', `${file} already exists; a collected record is never replaced.`); throw e; }
      result.written = file.slice(root.length + 1).replaceAll('\\', '/');
    }
    out(JSON.stringify(result, null, 2));
    return 0;
  } catch (e) {
    err(`${e.code ?? 'E_RETRO'}: ${e.message}`);
    return 1;
  }
}
