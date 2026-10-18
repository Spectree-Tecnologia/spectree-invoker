import { readFileSync, existsSync } from 'node:fs';
import { writeAtomic } from '../change/index.mjs';
import { inside, refuse, assertValid } from '../shared/index.mjs';

export const DELIVERY_STATES = ['implemented', 'pass2_complete', 'ci_green', 'integration_approved', 'integrated', 'closed'];
export function deliveryLedger(root, { resolveEvidence = true } = {}) {
  const path = inside(root, '.spectree/deferred.json');
  if (!existsSync(path)) refuse('E_DELIVERY_LEDGER', 'The structured deferred ledger is missing.');
  const ledger = JSON.parse(readFileSync(path, 'utf8'));
  if (ledger.schema_version !== '1.0.0' || !Array.isArray(ledger.items)) refuse('E_DELIVERY_LEDGER', 'Unsupported deferred ledger.');
  const ids = new Set();
  for (const item of ledger.items) {
    assertValid('spectree/deferred', item);
    if (ids.has(item.stable_id)) refuse('E_DELIVERY_LEDGER', 'Duplicate stable deferred ID.');
    ids.add(item.stable_id);
    if (resolveEvidence && item.status === 'closed') {
      const ref = item.closure_evidence;
      if (ref.kind !== 'evidence') refuse('E_DELIVERY_LEDGER', `D-${item.stable_id}: closure requires observed evidence.`);
      const path = inside(root, `.spectree/evidence/${ref.id}.json`);
      if (!existsSync(path)) refuse('E_DELIVERY_LEDGER', `D-${item.stable_id}: closure evidence is absent.`);
      const evidence = JSON.parse(readFileSync(path, 'utf8'));
      assertValid('spectree/evidence', evidence);
      if (evidence.evidence_id !== ref.id || evidence.change_id !== item.closed_by_change || evidence.result !== 'PASS' ||
          evidence.source_kind !== 'observed_execution' || evidence.superseded_by)
        refuse('E_DELIVERY_LEDGER', `D-${item.stable_id}: closure evidence does not support the recorded resolution.`);
    }
  }
  for (const item of ledger.items) {
    const seen = new Set();
    let current = item;
    while (current.status === 'superseded') {
      if (seen.has(current.stable_id)) refuse('E_DELIVERY_LEDGER', 'Deferred supersession cycle.');
      seen.add(current.stable_id);
      current = ledger.items.find(i => i.stable_id === current.superseded_by);
      if (!current) refuse('E_DELIVERY_LEDGER', 'Superseded obligation has no successor.');
    }
  }
  return ledger.items.sort((a, b) => a.stable_id - b.stable_id);
}
export function ledgerMarkdown(items) {
  const out = ['# Deferred obligations', '', '<!-- Generated from .spectree/deferred.json by delivery.mjs ledger --apply. -->', ''];
  for (const i of items) {
    out.push(`## D-${String(i.stable_id).padStart(3, '0')} — ${i.title ?? i.current_decision}`, '',
      `- Status: ${i.status}`, `- Owner: ${i.owner}`, `- Impact: ${i.impact}`,
      `- Decision: ${i.current_decision}`, `- Due: ${i.due ? `${i.due.change_id} / ${i.due.state}` : i.reevaluation_trigger ?? 'informational; no automatic deadline'}`);
    if (i.closure_condition) out.push(`- Closure condition: ${i.closure_condition}`);
    if (i.closure_evidence) out.push(`- Closure evidence: ${i.closure_evidence.kind}/${i.closure_evidence.id}`);
    out.push('');
  }
  return out.join('\n') + '\n';
}
export function ledgerView(root, { apply = false } = {}) {
  const text = ledgerMarkdown(deliveryLedger(root));
  const file = inside(root, 'docs/DEFERRED.md');
  const current = existsSync(file) ? readFileSync(file, 'utf8').replaceAll('\r\n', '\n') : null;
  if (current !== text && apply) {
    writeAtomic(file, text);
  }
  return { ok: current === text || apply, changed: current !== text, expected: text,
    code: current === text || apply ? null : 'E_DELIVERY_LEDGER_DRIFT' };
}
export function ledgerGate(root, changeId, target) {
  try {
    const items = deliveryLedger(root), view = ledgerView(root);
    if (!view.ok) return { ok: false, code: view.code, message: 'Generate docs/DEFERRED.md from the structured ledger before preparing delivery.' };
    const due = items.filter(i => i.status === 'open' && i.due?.change_id === changeId &&
      DELIVERY_STATES.indexOf(target) >= DELIVERY_STATES.indexOf(i.due.state));
    return due.length ? { ok: false, code: 'E_DELIVERY_DUE', message: `Due obligations: ${due.map(i => `D-${i.stable_id}`).join(', ')}` }
      : { ok: true, open: items.filter(i => i.status === 'open').length };
  } catch (e) { return { ok: false, code: 'E_DELIVERY_LEDGER', message: e.message }; }
}
