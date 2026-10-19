// The change with two registered tasks, shared by tests/task-executor*.test.mjs. It lives apart so
// the runner can run those files in parallel.

import { gitRepo, writeFiles, change, approval } from './helpers.mjs';
import { Store } from '../scripts/lib/change/store.mjs';
import { contractDigest } from '../scripts/lib/shared/digest.mjs';

export function fixture() {
  const r = gitRepo({ 'src/value.cjs': 'module.exports = { a: 0, b: 0 };\n', 'spec.md': 'Scenario A returns 1. Scenario B returns 2.\n',
    'tests/a.cjs': "const {test}=require('node:test');const assert=require('node:assert/strict');test('A',()=>assert.equal(require('../src/value.cjs').a,1));\n",
    'tests/b.cjs': "const {test}=require('node:test');const assert=require('node:assert/strict');test('B',()=>assert.equal(require('../src/value.cjs').b,2));\n" });
  r.git(['checkout', '-qb', 'feature']);
  const s = new Store(r.root); s.init({ project_id: 'proj', protocol_version: '1.0.0' });
  const c = s.putChange(change({ base_revision: r.base, state: 'pass1_complete', closure_mode: 'legacy', allowed_paths: ['src/'] }));
  s.putApproval(approval({ change_id: 'c1', gate: 'scope', revision: r.base, scope_digest: contractDigest(r.root, c).digest }));
  const plan = { version: 1, tasks: ['A', 'B'].map((id, i) => ({ id, mission: `Implement scenario ${id}`, depends_on: i ? ['A'] : [],
    refs: ['spec.md'], scenarios: [id], allowed_paths: ['src/value.cjs'], max_attempts: 2,
    checks: [{ scenario: id, test_name: id, command: [process.execPath, '--test', '--test-reporter=tap', `tests/${id.toLowerCase()}.cjs`], files: [`tests/${id.toLowerCase()}.cjs`], timeout_seconds: 10 }] })) };
  const bridge = (body) => {
    writeFiles(r.root, { '.spectree/bridge.cjs': `const fs=require('node:fs');const p=JSON.parse(fs.readFileSync(0,'utf8'));${body}` });
    return { kind: 'bridge', command: [process.execPath, '.spectree/bridge.cjs'], timeout_seconds: 10 };
  };
  const good = () => bridge("const e=JSON.parse(fs.readFileSync('.spectree/runs/c1/'+p.dispatch_id+'/000001.json'));if(e.type!=='run.started')throw Error('missing start');const v=require('../src/value.cjs');v[p.task.id.toLowerCase()]=p.task.id==='A'?1:2;fs.writeFileSync('src/value.cjs','module.exports = '+JSON.stringify(v));console.log(JSON.stringify({status:'completed'}));");
  return { ...r, s, plan, bridge, good };
}
