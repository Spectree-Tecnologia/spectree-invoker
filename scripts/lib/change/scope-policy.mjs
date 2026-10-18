// Gate 1 by standing policy: the Founder approves a roadmap item once, marked for it, and the
// changes that stay inside that item no longer wait on him one by one.
//
// What this module checks is only what can be checked mechanically: that the approval is for
// the scope gate, that it cites a roadmap item the Founder marked, and that the change creates
// no module. Whether the change's scope actually fits the item is the Invoker's judgement, and
// the report the Founder receives is where he can see it and veto it. Nothing here grants
// anything — a policy approval is the record of a decision the Founder already took.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const POLICY_KIND = 'founder_policy';
export const POLICY_MARKER = 'policy: scope';
const REFERENCE = /^docs\/ROADMAP\.md#([A-Za-z0-9][A-Za-z0-9._-]*)$/;

const refuse = (code, message) => ({ ok: false, code, message });

/** The roadmap line that carries `item` as a whole word and the policy marker, or null. */
export function roadmapEntry(root, item) {
  const f = join(root, 'docs', 'ROADMAP.md');
  if (!existsSync(f)) return null;
  const word = new RegExp(`(^|[^A-Za-z0-9._-])${item.replace(/[.]/g, '\\.')}($|[^A-Za-z0-9._-])`);
  return readFileSync(f, 'utf8').split(/\r?\n/).find((l) => word.test(l) && l.includes(POLICY_MARKER)) ?? null;
}

/**
 * May this approval stand as a policy approval for this change?
 * @returns {{ok: true, entry: string} | {ok: false, code: string, message: string}}
 */
export function checkPolicyApproval(root, doc, change) {
  if (doc.gate !== 'scope') {
    return refuse('E_POLICY_GATE', `a ${POLICY_KIND} approval authorises only the scope gate, never "${doc.gate}": ` +
      'ambiguity, integration, irreversible operations and exposure stay with the Founder');
  }
  if (!change) return refuse('E_POLICY_CHANGE', `a ${POLICY_KIND} approval must name a change on record`);
  if (change.change_type === 'bootstrap') {
    return refuse('E_POLICY_BOOTSTRAP', 'a bootstrap is approved with the stack table, never by policy');
  }
  const m = REFERENCE.exec(doc.granted_by?.reference ?? '');
  if (!m) {
    return refuse('E_POLICY_REFERENCE', 'granted_by.reference must cite the roadmap item the Founder approved: "docs/ROADMAP.md#<item>"');
  }
  const entry = roadmapEntry(root, m[1]);
  if (!entry) {
    return refuse('E_POLICY_ROADMAP', `docs/ROADMAP.md has no line naming "${m[1]}" with "${POLICY_MARKER}": ` +
      'only an item the Founder approved for policy can carry a change past gate 1 without him');
  }
  const modules = change.modules_named;
  if (!modules && !change.deltaless) {
    return refuse('E_POLICY_MODULES', 'the change names no modules, so nothing shows it creates none; record modules_named or declare it deltaless');
  }
  const unborn = (modules ?? []).filter((mod) => !existsSync(join(root, 'docs', 'specs', mod, 'spec.md')));
  if (unborn.length) {
    return refuse('E_POLICY_NEW_MODULE', `a new module is a modelling decision and goes to the Founder: ${unborn.join(', ')} ` +
      'has no living spec yet');
  }
  return { ok: true, entry };
}
