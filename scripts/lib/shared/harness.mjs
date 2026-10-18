// Which harness is running this, and what it exposes about the execution context.
//
// One module, because two scripts computing "which harness" on their own is how the same tool
// came to answer `single-context` inside a consumer and `delegating-with-isolation` inside the
// package — same machine, same harness, opposite answers, and the second one silently satisfied
// a gate whose whole point is that the independence was never observed.
//
// The harness identity is MEASURED from the environment. Context isolation cannot be, and is read
// from a recorded observation instead — see `observedIsolationSignal`.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The same relative place in the package and in a consumer install, which ships the adapter
// declarations beside the scripts.
const ADAPTERS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'adapters');

export function detectHarness(env = process.env) {
  if (env.CLAUDE_PLUGIN_ROOT || env.CLAUDECODE) return { harness: 'claude-code', verified: true };
  if (env.CODEX_HOME || env.CODEX_SANDBOX || env.OPENAI_CODEX) return { harness: 'codex', verified: true };
  if (env.SPECTREE_HARNESS) return { harness: env.SPECTREE_HARNESS, verified: false };
  return { harness: 'unknown', verified: false };
}

// Context isolation is observed by DISPATCHING, never from inside a process.
//
// From inside, nothing tells a subagent apart from the loop that dispatched it: on Claude Code
// (measured 2026-09-10) a subagent's shell reports the same session id, host session, pid and
// AI_AGENT as the main loop, over an identical set of variable names. M4 stayed open for weeks on
// the assumption that this was where the signal had to come from. It was the wrong place. The
// signal is the dispatch itself: the loop holds a marker the dispatch does not carry and asks the
// subagent for it (negative arm), then sends one that does carry it (control arm). Absent in the
// first and quoted in the second is an observation — of context, made by the only party that can
// make it — and the vendor documents the same property.
//
// A script cannot dispatch, so it reads the recorded probe. And a recorded probe is not a string:
// `context_isolation: "observed"` with no record, or a record missing either arm, unlocks nothing.
// That is the protection the bare `"declared"` lacked, kept.
const PROBE_FIELDS = ['observed_at', 'dispatch', 'negative_arm', 'control_arm', 'source'];

export function isolationProbe(adapter) {
  if (adapter?.capabilities?.context_isolation !== 'observed') return null;
  const p = adapter.context_isolation_probe;
  return p && PROBE_FIELDS.every((k) => typeof p[k] === 'string' && p[k].trim()) ? p : null;
}

// Only a VERIFIED harness identity selects a probe: a harness name the squad's own variable
// asserts would apply one harness's observation to another.
export function observedIsolationSignal(env = process.env) {
  const { harness, verified } = detectHarness(env);
  if (!verified) return null;
  try { return isolationProbe(JSON.parse(readFileSync(join(ADAPTERS, harness, 'adapter.json'), 'utf8'))); }
  catch { return null; }
}

// The identity of the execution PROCESS, shaped so two records can be compared without either of
// them publishing a session id or a pid. Equal digests mean one process context.
//
// It is not a context-isolation claim, and on Claude Code the two disagree on purpose: a Quality
// Engineer and the builder it follows share one session, so their records carry the SAME digest,
// while their contexts were observed to be separate. `isolation_signal` names the observation the
// independence rests on; the digest says what the processes shared.
export function executionContext(env = process.env) {
  const { harness, verified } = detectHarness(env);
  const identity = [
    env.CLAUDE_CODE_SESSION_ID ?? env.CODEX_SESSION_ID ?? '',
    env.CLAUDE_CODE_HOST_SESSION_ID ?? '',
    env.CLAUDE_PID ?? '',
    env.AI_AGENT ?? '',
  ].join('\u0000');
  const probe = observedIsolationSignal(env);
  return {
    harness,
    harness_verified: verified,
    digest: createHash('sha256').update(identity).digest('hex').slice(0, 16),
    isolation_signal: probe ? `dispatch-probe ${probe.observed_at}` : 'none',
  };
}
