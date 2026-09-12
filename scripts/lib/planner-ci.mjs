// Optional observation, never a ci.green evidence writer. Uses the existing GitHub transport.
import { pullRequest, prChecks } from './gh.mjs';

export function observePlanCi({ repository, pr, revision, branch, cwd }, transport = { pullRequest, prChecks }) {
  const unknown = (reason) => ({ status: 'unknown', reason, repository, pr });
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') || !Number.isSafeInteger(pr) || pr < 1) {
    return unknown('Declare project.repository and supply a positive --pr. No repository or PR is inferred.');
  }
  const opts = { repo: repository, cwd };
  try {
    const before = transport.pullRequest(pr, opts);
    const matches = (p) => p.number === pr && (p.state === 'MERGED'
      ? p.mergeCommit?.oid === revision || (p.headRefOid === revision && p.headRefName === branch)
      : p.state === 'OPEN' && p.headRefOid === revision && p.headRefName === branch);
    if (!matches(before)) return unknown('The PR does not identify this checkout/branch, or is closed without a merge. Re-read the candidate before deciding.');
    // Required PR checks cannot certify a merged tree's push run. post-merge owns that question.
    if (before.state === 'MERGED') return { status: 'merged', repository, pr, head_sha: before.headRefOid,
      merge_sha: before.mergeCommit?.oid, reason: 'Use post-merge dry-run to inspect the required main checks; PR checks are not main evidence.' };
    const observed = transport.prChecks(pr, opts);
    const after = transport.pullRequest(pr, opts);
    if (!matches(after) || before.headRefOid !== after.headRefOid || before.state !== after.state) return unknown('PR changed during observation; discard this observation.');
    const checks = observed.checks;
    if (!Array.isArray(checks) || !checks.length) return unknown('No required checks were reported; empty is not green.');
    if (checks.some((c) => !['pass', 'fail', 'pending', 'cancel', 'skipping'].includes(c.bucket))) return unknown('An unsupported required-check result was reported.');
    const status = checks.some((c) => ['fail', 'cancel', 'skipping'].includes(c.bucket)) ? 'failed'
      : observed.pending || checks.some((c) => c.bucket === 'pending') ? 'pending' : 'green';
    return { status, repository, pr, head_sha: before.headRefOid,
      checks: checks.map(({ name, state, bucket, workflow, link }) => ({ name, state, bucket, workflow, link })),
      reason: 'Snapshot of required PR checks only. Re-observe before acting; no evidence or approval was recorded.' };
  } catch (e) { return unknown(`${e.code ?? 'E_GH_UNAVAILABLE'}: ${e.message}`); }
}
