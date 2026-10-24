// The measured half of a closure retro: what one merged PR went through, read from GitHub and from
// the merge in git, plus the known finding signatures that reading matches. The judgement stays
// with the Invoker and the squad skill `squad-closure-retro`; this file only makes sure the retro
// starts from signals somebody measured, not from memory of the session.
//
// It reads only. Nothing here comments, merges or writes outside `.spectree/retros/`.

import { existsSync, readFileSync } from 'node:fs';
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

/**
 * `retro.mjs collect <pr> [--repo owner/name] [--apply]` and `retro.mjs check <change-id> <retro.md>`.
 * Returns the exit code: 0 collected or checked, 1 refused, 2 usage. `source` replaces the GitHub reads in a test.
 */
export function retroCommand({ root, argv, out = (s) => console.log(s), err = (s) => console.error(s), source }) {
  const [command, number] = argv;
  const usage = 'usage: retro.mjs collect <pr> [--repo owner/name] [--apply] | retro.mjs check <change-id> <retro.md>';
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
