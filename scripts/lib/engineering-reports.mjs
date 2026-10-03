// Structural consistency only: prose and references do not prove an experiment ran.
import { references, snapshot, bounded, refuse } from './work.mjs';
export function engineeringReport(root, kind, doc) {
  if (!doc || doc.version !== 1 || !['diagnosis', 'review'].includes(kind)) refuse('E_REPORT', 'Unknown report kind/version.');
  const current = snapshot(root);
  if (doc.candidate?.revision !== current.revision || doc.candidate?.content_digest !== current.content_digest) refuse('E_REPORT_STALE', 'Report names a different candidate.');
  if (kind === 'diagnosis') {
    bounded(doc.symptom, 'symptom'); bounded(doc.environment, 'environment');
    if (!['inconclusive', 'cause_supported'].includes(doc.conclusion) || !Array.isArray(doc.hypotheses) || !doc.hypotheses.length ||
        !Array.isArray(doc.observations) || !doc.observations.length) refuse('E_DIAGNOSIS', 'Require hypotheses, observations and an explicit conclusion.');
    for (const h of doc.hypotheses) { bounded(h.id, 'hypothesis ID'); bounded(h.claim, 'hypothesis'); bounded(h.prediction, 'prediction'); }
    if (new Set(doc.hypotheses.map((h) => h.id)).size !== doc.hypotheses.length) refuse('E_DIAGNOSIS', 'Duplicate hypothesis ID.');
    for (const o of doc.observations) {
      if (!doc.hypotheses.some((h) => h.id === o.hypothesis) || !Number.isInteger(o.attempts) || o.attempts < 1 ||
          !Number.isInteger(o.failures) || o.failures < 0 || o.failures > o.attempts || !Array.isArray(o.command) || !o.command.length ||
          !o.command.every((s) => typeof s === 'string' && s.trim()) || !Array.isArray(o.refs) || !o.refs.length) refuse('E_DIAGNOSIS', 'Invalid observation counts, command or evidence.');
      bounded(o.intervention, 'intervention'); references(root, o.refs);
    }
    if (doc.conclusion === 'cause_supported' && (!doc.supporting_observations?.length ||
        doc.supporting_observations.some((i) => !Number.isInteger(i) || !doc.observations[i]))) refuse('E_DIAGNOSIS', 'Name the observations that support the cause.');
  } else {
    for (const axis of ['spec', 'standards']) {
      if (!Array.isArray(doc[axis])) refuse('E_REVIEW', 'Both spec and standards axes are required.');
      for (const f of doc[axis]) {
        bounded(f.claim, 'finding'); bounded(f.basis, 'requirement or standard');
        if (!['blocker', 'suggestion', 'inconclusive'].includes(f.kind)) refuse('E_REVIEW', 'Unknown finding kind.');
        references(root, f.refs ?? []);
        if (f.kind === 'blocker' && (!f.refs?.length || !Array.isArray(f.failing_command) || !f.failing_command.length ||
            !f.failing_command.every((s) => typeof s === 'string' && s.trim()) || !f.observed_failure)) refuse('E_REVIEW', 'A blocker requires a referenced failing execution; heuristics are suggestions.');
        if (f.kind === 'blocker') bounded(f.observed_failure, 'observed failure');
      }
    }
  }
  return { ok: true, advisory: true, authorizes_execution: false,
    meaning: 'Report consistency and candidate identity only. No execution or QA independence is inferred.' };
}
