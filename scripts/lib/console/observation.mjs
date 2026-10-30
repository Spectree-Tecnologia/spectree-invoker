// Explicit, bounded observation. The HTTP service never accepts a command or a root from a request.
import { execFile, execFileSync } from 'node:child_process';
import { readdirSync, existsSync, lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { identifier } from '../change/index.mjs';
import { inside, refuse, observeProcesses, gitExecutable } from '../shared/index.mjs';
import { taskStatus } from '../execution/index.mjs';
import { diagnoseProject } from '../closure/index.mjs';

const self = fileURLToPath(import.meta.url);
const stateCli = fileURLToPath(new URL('../../state.mjs', import.meta.url));
function preflight(root, candidate = true) {
  let budget = 12000;
  const metadata = [];
  function walk(relative, depth = 0) {
    if (--budget < 0 || depth > 32) refuse('E_OBSERVATION_LIMIT', 'Project metadata exceeds observation limits.');
    const file = inside(root, relative);
    if (!existsSync(file)) return;
    const stat = lstatSync(file);
    if (stat.isDirectory()) for (const name of readdirSync(file)) walk(`${relative}/${name}`, depth + 1);
    else if (!stat.isFile() || stat.size > 32 * 1024 * 1024) refuse('E_OBSERVATION_LIMIT', 'Unsupported metadata file.');
    else metadata.push(relative);
  }
  walk('.spectree'); walk('docs/changes');
  if (!candidate) return;
  // Git status can invoke fsmonitor and hashing can invoke clean/process filters.
  // Refuse executable configuration rather than running project-specific helpers from a read UI.
  let config, gitBin;
  try { gitBin = gitExecutable(root); config = execFileSync(gitBin, ['config', '--null', '--list'], { cwd: root, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024, windowsHide: true }); }
  catch { refuse('E_OBSERVATION_GIT', 'Git configuration could not be inspected.'); }
  if (config.split('\0').some(s => /^core\.fsmonitor\n(?!false$|0$|$)/i.test(s))) refuse('E_OBSERVATION_HELPER', 'Git fsmonitor requires inspection outside the Console.');
  const paths = [...new Set([...metadata, ...execFileSync(gitBin, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }).split('\0').filter(Boolean)])];
  if (paths.length > 50000) refuse('E_OBSERVATION_LIMIT', 'Candidate exceeds observation limits.');
  if (paths.length) {
    const attrs = execFileSync(gitBin, ['check-attr', '-z', '--stdin', 'filter'], { cwd: root, input: paths.join('\0') + '\0', encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }).split('\0');
    for (let i = 2; i < attrs.length; i += 3) {
      const filter = attrs[i];
      if (['unspecified', 'unset'].includes(filter)) continue;
      if (config.split('\0').some(s => s.startsWith(`filter.${filter}.clean\n`) || s.startsWith(`filter.${filter}.process\n`)))
        refuse('E_OBSERVATION_HELPER', 'Candidate uses executable Git filters; inspect outside the Console.');
    }
  }
  for (const path of paths) {
    const file = inside(root, path);
    if (existsSync(file) && !lstatSync(file).isFile()) refuse('E_OBSERVATION_LIMIT', 'Unsupported candidate entry.');
  }
}

export async function observeRuntime(root, change) {
  if (change) identifier(change);
  return new Promise(resolve => {
    execFile(process.execPath, [self, root, change ?? ''], { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', SPECTREE_PROJECT_ROOT: root } }, (error, stdout) => {
      try { if (!error) return resolve(JSON.parse(stdout)); } catch { /* explicit unavailable result below */ }
      resolve({ status: 'unavailable', code: error?.killed ? 'E_OBSERVATION_TIMEOUT' : 'E_OBSERVATION', authorizes_execution: false, observed_at: new Date().toISOString() });
    });
  });
}
if (process.argv[1] === self) {
  const [root, change] = process.argv.slice(2);
  let result, diagnostic;
  try {
    if (change) identifier(change);
    preflight(root, false);
    diagnostic = diagnoseProject(root, change || undefined);
    if (!change) {
      result = { status: 'observed', diagnostic, authorizes_execution: false, observed_at: new Date().toISOString() };
    } else {
      preflight(root);
      const plan = JSON.parse(execFileSync(process.execPath, [stateCli, 'plan', change, '--json'], {
        cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true,
        env: { ...process.env, SPECTREE_PROJECT_ROOT: root, GIT_OPTIONAL_LOCKS: '0' } }));
      let tasks = null, task_error = null;
      if (existsSync(inside(root, `.spectree/tasks/${change}.json`))) {
        try { tasks = taskStatus(root, change); } catch (e) { task_error = { code: e.code ?? 'E_TASK', message: e.message }; }
      }
      const processes = [];
      const runDir = inside(root, `.spectree/runs/${change}`);
      const operations = existsSync(runDir) ? readdirSync(runDir).map(operation => {
        identifier(operation);
        const first = inside(root, `.spectree/runs/${change}/${operation}/000001.json`);
        const event = JSON.parse(readFileSync(first, 'utf8'));
        if (event.operation_id !== operation || event.change_id !== change || event.type !== 'run.started') refuse('E_RUN_CORRUPT', 'Run identity mismatch.');
        return { operation, at: event.at };
      }).sort((a, b) => String(b.at).localeCompare(String(a.at))) : [];
      for (const { operation } of operations.slice(0, 20)) {
        if (existsSync(inside(root, `.spectree/processes/${operation}`))) processes.push({ operation_id: operation, ...observeProcesses(root, `.spectree/processes/${operation}`) });
      }
      result = { status: 'observed', diagnostic, plan, tasks, task_error, processes, process_limit: 20, processes_truncated: operations.length > 20, authorizes_execution: false, observed_at: new Date().toISOString() };
    }
  } catch (e) { result = { status: 'unavailable', diagnostic, code: e.code ?? 'E_OBSERVATION', message: e.message, authorizes_execution: false, observed_at: new Date().toISOString() }; }
  console.log(JSON.stringify(result));
}
