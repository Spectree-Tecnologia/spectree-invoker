// Pass 2 coverage: what one round attacked and which mutants it killed, bound to the bytes it
// attacked, with the round's own duration. A record is an observation for planning the next round
// on the same change. It never stands for `pass2.attack` or `mutation.killed`: those stay observed
// on the whole current candidate. The next round reads `scope` and attacks only what moved since.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Store, identifier, references, snapshot, workRecords } from '../change/index.mjs';
import { fileMode, flags, git, inside, publishOnce, refuse } from '../shared/index.mjs';

const OPERATIONAL = /^(?:\.spectree|docs\/changes)(?:\/|$)/;
const folder = (root, id) => inside(root, `.spectree/pass2/${identifier(id)}`);
// What a file is, for coverage: its raw bytes and its mode. The mode is read the way the content
// digest reads it (the index for a tracked file), so the digest that binds a round and the
// fingerprint agree; raw bytes are stricter than the digest's normalised blob, so a line-ending
// change alone sends a file back to attack.
const fingerprintOf = (root, path) => {
  try { return `${references(root, [path])[0].sha256}:${fileMode(root, path)}`; } catch { return null; }
};

function change(root, id) {
  const found = new Store(root).change(identifier(id));
  if (!found) refuse('E_PASS2_CHANGE', `No change "${id}" is registered.`);
  return found;
}

/** Every recorded round of a change, oldest first. */
export function pass2Rounds(root, id) {
  const dir = folder(root, id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^\d{3}\.json$/.test(f)).sort().map((f) => {
    let doc;
    try { doc = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { refuse('E_PASS2_CORRUPT', `Unreadable round record: ${f}`); }
    if (doc?.version !== 1 || doc.change_id !== id || !Array.isArray(doc.attacked) || !Array.isArray(doc.mutations)) refuse('E_PASS2_CORRUPT', `Unsupported round record: ${f}`);
    return doc;
  });
}

/**
 * Records one finished round. `report.attacked` lists the candidate files the round attacked;
 * `report.mutation_report` is optional, the saved output of `mutation-probe.mjs --apply` on this
 * same content. The round's start, end and usage come from its work operation, never from the report.
 */
export function recordPass2Round(root, id, report, { operation }) {
  change(root, id);
  if (!report || typeof report !== 'object' || Object.keys(report).some((k) => !['attacked', 'mutation_report'].includes(k))) refuse('E_PASS2_REPORT', 'A report has `attacked` and, optionally, `mutation_report`.');
  if (!Array.isArray(report.attacked) || !report.attacked.length || report.attacked.length > 500 ||
      report.attacked.some((p) => typeof p !== 'string' || OPERATIONAL.test(p.replaceAll('\\', '/')))) refuse('E_PASS2_REPORT', '`attacked` lists 1..500 candidate files, outside .spectree/ and docs/changes/.');
  const op = workRecords(root, id).find((r) => r.operation_id === identifier(operation));
  if (!op?.finished || op.started.phase !== 'pass2') refuse('E_PASS2_OPERATION', 'Record a pass2 operation after work.mjs finish: its start and end are what this record measures.');
  // An interrupted or failed round attacked only part of what it lists; recording it as coverage
  // would let the next round skip the rest.
  if (op.finished.status !== 'reported_success') refuse('E_PASS2_UNFINISHED', `The round ended ${op.finished.status}; only a completed round is coverage. Run it again.`);
  const rounds = pass2Rounds(root, id);
  const already = rounds.find((r) => r.operation.operation_id === op.operation_id);
  if (already) refuse('E_PASS2_DUPLICATE', `Operation ${op.operation_id} is already round ${already.round}.`);
  // Rounds are numbered in the order they finished, so "the latest result" of a mutant is the latest observed.
  const last = rounds.at(-1);
  if (last && op.finished.at < last.operation.finished_at) refuse('E_PASS2_ORDER', `Operation ${op.operation_id} finished before round ${last.round}; record rounds in the order they finished.`);
  // Bound to the bytes the round ended on: a repair between finish and record would otherwise be
  // recorded as attacked, and the next round would skip exactly the file it changed.
  const current = snapshot(root);
  if (current.content_digest !== op.finished.snapshot.content_digest) refuse('E_PASS2_STALE', 'The content moved since the round finished; record a round before anything changes it.');
  const attacked = [...new Set(report.attacked)].sort().map((p) => {
    const fingerprint = fingerprintOf(root, p);
    if (!fingerprint) refuse('E_PASS2_REPORT', `Attacked file is not a regular candidate file: ${p}`);
    return { path: p, fingerprint };
  });
  let mutations = [];
  if (report.mutation_report !== undefined) {
    let probe;
    try { probe = JSON.parse(readFileSync(inside(root, report.mutation_report), 'utf8')); } catch { refuse('E_PASS2_REPORT', 'The mutation report is not readable JSON.'); }
    if (probe?.version !== 1 || probe.dry_run || !Array.isArray(probe.mutations)) refuse('E_PASS2_REPORT', 'The mutation report must be a batch run of mutation-probe.mjs --apply.');
    if (probe.source_digest !== current.content_digest) refuse('E_PASS2_PROBE_STALE', 'The mutation report was produced on other content; run the probe on this candidate.');
    mutations = probe.mutations.map((m) => ({ id: m.id, target: m.target.replaceAll('\\', '/'), test_name: m.test_name, result: m.result,
      target_fingerprint: fingerprintOf(root, m.target) }));
  }
  const doc = { version: 1, change_id: id, round: rounds.length + 1, at: new Date().toISOString(),
    advisory: true, authorizes_execution: false, candidate: current, attacked, mutations,
    operation: { operation_id: op.operation_id, started_at: op.started.at, finished_at: op.finished.at,
      elapsed_ms: Date.parse(op.finished.at) - Date.parse(op.started.at), status: op.finished.status, usage: op.finished.usage ?? null } };
  try { publishOnce(join(folder(root, id), `${String(doc.round).padStart(3, '0')}.json`), `${JSON.stringify(doc, null, 2)}\n`); }
  catch (e) { if (e.code === 'EEXIST') refuse('E_PASS2_CONFLICT', `Round ${doc.round} was recorded concurrently; read scope and record again.`); throw e; }
  return doc;
}

/**
 * What the next round attacks: candidate files changed since the change's base whose bytes no
 * round attacked, and killed mutants whose target changed. Advisory, and it authorizes nothing.
 */
export function pass2Scope(root, id) {
  const base = change(root, id).base_revision;
  // NUL-separated and without rename pairing: a renamed file's old path is listed as deleted, and
  // a non-ASCII path arrives as itself instead of quoted.
  const listed = (args) => git(root, args).split('\0').filter(Boolean);
  const files = [...new Set([...listed(['diff', '-z', '--no-renames', '--relative', '--name-only', base]), ...listed(['ls-files', '-z', '--others', '--exclude-standard'])])]
    .filter((p) => !OPERATIONAL.test(p)).sort();
  const rounds = pass2Rounds(root, id);
  const attackedAt = new Map(rounds.flatMap((r) => r.attacked.map((a) => [`${a.path}\0${a.fingerprint}`, r.round])));
  const attack = []; const covered = []; const deleted = [];
  for (const path of files) {
    const sha = fingerprintOf(root, path);
    const round = sha && attackedAt.get(`${path}\0${sha}`);
    if (round) covered.push({ path, round });
    else if (sha) attack.push({ path, reason: 'changed since the last round that attacked it, or never attacked' });
    // Only a file that is not there is deleted; one that cannot be read is unknown, and attacked.
    else if (!existsSync(join(root, path))) deleted.push({ path });
    else attack.push({ path, reason: 'unknown: the file could not be fingerprinted' });
  }
  // The latest result of each mutant decides: a later survivor is never hidden by an older kill. A
  // mutant is its id on its target: ids are unique only within one plan, so a later round may reuse one.
  const latest = new Map(rounds.flatMap((r) => r.mutations.map((m) => [`${m.id}\0${m.target}`, { ...m, round: r.round }])));
  const carried = []; const rerun = [];
  for (const m of latest.values()) (m.result === 'PASS' && m.target_fingerprint && fingerprintOf(root, m.target) === m.target_fingerprint ? carried : rerun).push({ id: m.id, target: m.target, round: m.round });
  return { version: 1, advisory: true, authorizes_execution: false, change_id: id, candidate: snapshot(root),
    rounds: rounds.map((r) => ({ round: r.round, elapsed_ms: r.operation.elapsed_ms, usage: r.operation.usage, attacked: r.attacked.length, mutations: r.mutations.length })),
    attack, covered, deleted, mutations: { carried, rerun },
    meaning: rounds.length
      ? 'Attack the files under `attack`; rerun the mutants under `rerun` and those of new or changed rules. The suite still runs whole for pass2.attack.'
      : 'No round recorded yet: the first round attacks the whole change.' };
}

/** `pass2.mjs record <change> <report.json> --operation <id>` and `pass2.mjs scope <change>`. Returns 0 done, 1 refused, 2 usage. */
export function pass2Command({ root, argv, out = (s) => console.log(s), err = (s) => console.error(s) }) {
  const [command, id, file, ...rest] = argv;
  const usage = 'usage: pass2.mjs record <change> <report.json> --operation <id> | pass2.mjs scope <change>';
  const operation = flags(rest).value('operation');
  const valid = command === 'scope' ? id && !file : command === 'record' && id && file && operation && rest.length === 2;
  if (!valid) { err(usage); return 2; }
  try {
    const read = () => { try { return JSON.parse(readFileSync(inside(root, file), 'utf8')); } catch { refuse('E_PASS2_REPORT', `Cannot read the round report: ${file}`); } };
    const result = command === 'scope' ? pass2Scope(root, id) : recordPass2Round(root, id, read(), { operation });
    out(JSON.stringify(result, null, 2));
    return 0;
  } catch (e) { err(`${e.code ?? 'E_PASS2'}: ${e.message}`); return 1; }
}
