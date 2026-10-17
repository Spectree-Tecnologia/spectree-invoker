#!/usr/bin/env node
// Migrate a consumer's closure records to the durable lifecycle. Explicit, idempotent, and a
// dry run unless told otherwise.
//
//   node scripts/migrate-closure.mjs            plan only, writes nothing
//   node scripts/migrate-closure.mjs --apply
//   node scripts/migrate-closure.mjs --json
//
// It is a DATA migration, and it is not part of installing anything. Updating scripts and
// rewriting a project's records are different acts with different blast radii, and an installer
// that quietly did the second one would rewrite state nobody asked it to touch.
//
// What it will not do, in as many words: it will not turn a v1 record into an approved v2
// preparation. A v1 manifest carries no preparation identity, so no approval on record can be
// shown to have been granted over it — and inventing that link would be this tool manufacturing
// an authorisation a human never gave. v1 records are preserved as HISTORY, byte for byte, and
// the change is reported as needing a fresh preparation and a fresh approval.
//
// Exit codes: 0 nothing to do / migrated, 1 refused, 2 usage.

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Store } from './lib/store.mjs';
import { stamp } from './lib/shared/time.mjs';
import {
  readLifecycle, emptyLifecycle, lifecyclePath, currentPath, snapshotPath,
  LIFECYCLE_VERSION, PREP_CONTRACT_VERSION,
} from './lib/lifecycle.mjs';

const root = process.env.SPECTREE_PROJECT_ROOT ?? process.cwd();
const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const asJson = argv.includes('--json');

const store = new Store(root);
if (!store.present) {
  console.error('no .spectree directory here: there is nothing to migrate, which is not the same as a migration that succeeded');
  process.exit(1);
}

const plan = [];
const refusals = [];

const changeIds = (() => {
  const dir = join(root, '.spectree', 'closure');
  const fromClosure = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.lifecycle.json') && !f.endsWith('.receipt.json'))
      .map((f) => f.slice(0, -5))
    : [];
  const fromChanges = store.changes().map((c) => c.change_id);
  return [...new Set([...fromClosure, ...fromChanges])].sort();
})();

for (const id of changeIds) {
  const lc = readLifecycle(root, id);
  if (lc.present && !lc.doc) {
    refusals.push({ change_id: id, code: lc.code, message: `${lc.message}. A control that cannot be read is not migrated over: recover it or remove it deliberately.` });
    continue;
  }

  const manifestFile = join(root, currentPath(id));
  let manifest = null, bytes = null;
  if (existsSync(manifestFile)) {
    bytes = readFileSync(manifestFile, 'utf8');
    try { manifest = JSON.parse(bytes); }
    catch {
      refusals.push({ change_id: id, code: 'E_PREP_CORRUPT', message: 'the preparation is not valid JSON; corrupt is not the same as absent, and neither is migrated by guessing' });
      continue;
    }
    if (manifest.change_id && manifest.change_id !== id) {
      refusals.push({ change_id: id, code: 'E_PREP_COLLISION', message: `the preparation at ${currentPath(id)} belongs to "${manifest.change_id}"` });
      continue;
    }
  }

  const version = manifest?.manifest_version ?? null;
  if (lc.doc && version === PREP_CONTRACT_VERSION) {
    plan.push({ change_id: id, action: 'none', why: `already lifecycle ${LIFECYCLE_VERSION} with a ${version} preparation` });
    continue;
  }
  if (lc.doc && version === null) {
    plan.push({ change_id: id, action: 'none', why: 'a control is present and there is no preparation to migrate' });
    continue;
  }

  if (version === PREP_CONTRACT_VERSION) {
    // v2 snapshot, no control behind it: build the control from what the snapshot already says.
    plan.push({
      change_id: id, action: 'adopt',
      why: `a ${version} preparation with no closure control; the control is created from it, generation ${manifest.generation ?? 1}`,
      generation: manifest.generation ?? 1,
      retired: manifest.supersedes_approval ?? [],
    });
    continue;
  }

  if (version === null) {
    plan.push({ change_id: id, action: 'create', why: 'no preparation and no control; an empty control is created so authority has somewhere to live' });
    continue;
  }

  // v1, or something older. History, not authority.
  plan.push({
    change_id: id, action: 'retire_v1',
    why: `a ${version} preparation predates the identity a v2 approval names, so it cannot be shown to be what any approval covered. ` +
      'It is preserved as history; the change needs a fresh preparation and a fresh integration approval.',
    retired: manifest.supersedes_approval ?? [],
    kept_at: snapshotPath(id, `v1-${version}`).split('\\').join('/'),
  });
}

const write = (file, text) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

if (apply && refusals.length === 0) {
  for (const item of plan) {
    if (item.action === 'none') continue;
    const id = item.change_id;
    const lc = readLifecycle(root, id);
    const base = lc.doc ?? emptyLifecycle(id, store.project()?.project_id);
    const at = stamp();

    if (item.action === 'retire_v1') {
      // Byte for byte. A re-serialised document preserves the meaning and loses the document,
      // and what a record was is the document.
      const kept = join(root, snapshotPath(id, `v1-${JSON.parse(readFileSync(join(root, currentPath(id)), 'utf8')).manifest_version}`));
      if (!existsSync(kept)) write(kept, readFileSync(join(root, currentPath(id)), 'utf8'));
    }
    if (item.action === 'adopt') {
      const snap = join(root, snapshotPath(id, JSON.parse(readFileSync(join(root, currentPath(id)), 'utf8')).preparation_id));
      if (!existsSync(snap)) write(snap, readFileSync(join(root, currentPath(id)), 'utf8'));
    }

    const next = {
      ...base,
      lifecycle_version: LIFECYCLE_VERSION,
      generation: item.generation ?? base.generation ?? 1,
      current_preparation: item.action === 'adopt'
        ? JSON.parse(readFileSync(join(root, currentPath(id)), 'utf8')).preparation_id
        : null,
      retired_approvals: [
        ...base.retired_approvals,
        ...(item.retired ?? [])
          .filter((a) => !base.retired_approvals.some((r) => r.approval_id === a))
          .map((a) => ({ approval_id: a, generation: item.generation ?? 1, at, reason: 'carried forward by the closure migration' })),
      ],
      migrated_from: item.action === 'retire_v1' ? { manifest_version: 'v1', at, kept_at: item.kept_at } : (base.migrated_from ?? null),
      revision: (base.revision ?? 0) + 1,
      updated_at: at,
    };
    write(join(root, lifecyclePath(id)), `${JSON.stringify(next, null, 2)}\n`);
    store.appendHistory(id, {
      event_id: `closure_migrated:${id}:${item.action}`,
      type: 'closure_migrated',
      at, action: item.action, why: item.why,
      lifecycle_version: LIFECYCLE_VERSION,
      schema_version: base.schema_version ?? '1.0.0',
    });
  }
}

const answer = {
  apply,
  lifecycle_version: LIFECYCLE_VERSION,
  preparation_contract: PREP_CONTRACT_VERSION,
  plan,
  refusals,
  needs_reapproval: plan.filter((p) => p.action === 'retire_v1').map((p) => p.change_id),
};

if (asJson) console.log(JSON.stringify(answer, null, 2));
else {
  console.log(`${apply ? 'MIGRATED' : 'DRY RUN — nothing written'}  (${plan.length} change(s))`);
  for (const p of plan) console.log(`  ${p.action.padEnd(11)} ${p.change_id}\n              ${p.why}`);
  for (const r of refusals) console.error(`  REFUSED     ${r.change_id} — ${r.code}: ${r.message}`);
  if (answer.needs_reapproval.length) {
    console.log(`\n${answer.needs_reapproval.length} change(s) need a fresh preparation AND a fresh integration approval:`);
    console.log(`  ${answer.needs_reapproval.join(', ')}`);
    console.log('  A v1 record names no preparation, so no approval can be shown to have covered it.');
    console.log('  Nothing here invents that link.');
  }
  if (!apply) console.log('\nRe-run with --apply to perform this plan.');
}
process.exit(refusals.length ? 1 : 0);
