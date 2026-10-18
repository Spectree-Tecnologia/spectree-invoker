#!/usr/bin/env node
// Read-only, exact run/attempt. Native gh authentication; no model API or log downloads.
// node bench/observe-run.mjs --repo owner/name --run 123 --attempt 1 [--human-events file.json]
import { readFileSync } from 'node:fs';
import { launch } from '../scripts/lib/shared/index.mjs';
import { runTiming, humanTiming } from './lib/timing.mjs';

export function collectRun({ repository, runId, attempt, human }, request) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || repository.split('/').some((s) => s === '.' || s === '..')) throw new Error('invalid owner/repository');
  if (![runId, attempt].every((n) => Number.isSafeInteger(n) && n > 0)) throw new Error('run and attempt must be positive safe integers');
  const path = `repos/${repository}/actions/runs/${runId}/attempts/${attempt}`;
  const started = new Date().toISOString();
  const run = request(path, false);
  const pages = request(`${path}/jobs?per_page=100`, true);
  if (!Array.isArray(pages) || !pages.length || !pages.every((p) => Array.isArray(p.jobs) && Number.isSafeInteger(p.total_count))) throw new Error('malformed jobs pagination');
  const jobs = pages.flatMap((p) => p.jobs);
  if (!pages.every((p) => p.total_count === jobs.length)) throw new Error('jobs pagination is incomplete or changed during collection');
  const result = runTiming(run, jobs, { repository, runId, attempt });
  // A rerun/status change while reading must not yield a single supposedly coherent sample.
  const after = request(path, false);
  if (['id', 'run_attempt', 'head_sha', 'status', 'conclusion', 'updated_at'].some((k) => after[k] !== run[k])) throw new Error('run changed during collection; collect a new observation');
  return { report_version: 1, kind: 'github-read-only-observation', collected_from: started,
    collected_until: new Date().toISOString(), gh_calls: 3, log_bytes: 0,
    note: 'gh_calls counts CLI invocations, not HTTP pages. This is not an atomic GitHub snapshot or a gate verdict.',
    run: result, human: human ? humanTiming(human, repository, runId) : null };
}

import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2), opts = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--repo', '--run', '--attempt', '--human-events'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || opts[args[i]] !== undefined) throw new Error('usage: --repo owner/name --run ID --attempt N [--human-events file.json]');
      opts[args[i]] = args[i + 1];
    }
    const report = collectRun({ repository: opts['--repo'] ?? '', runId: Number(opts['--run']), attempt: Number(opts['--attempt']),
      human: opts['--human-events'] ? JSON.parse(readFileSync(opts['--human-events'], 'utf8')) : null },
    (endpoint, paginate) => {
      const r = launch(['gh', 'api', '--method', 'GET', endpoint, ...(paginate ? ['--paginate', '--slurp'] : [])],
        { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
      if (r.error || r.status !== 0) throw new Error(`GitHub read failed: ${r.error?.message ?? r.stderr}`);
      return JSON.parse(r.stdout);
    });
    console.log(JSON.stringify(report, null, 2));
  } catch (e) { console.error(`OBSERVATION_REFUSED: ${e.message}`); process.exitCode = 1; }
}
