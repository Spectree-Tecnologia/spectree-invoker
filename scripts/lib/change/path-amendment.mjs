// Amending the paths a change owns, mid-build.
//
// Ownership is cut at `open`, before anyone writes, and the build is where it turns out to be one
// file short: a fixture, a config the tests read, the adapter's index. Reopening the whole change
// for that cost a scope round nobody needed, and widening `allowed_paths` by hand left no trace
// of why. An amendment is recorded on the trail with its reason, and it only stops for a person
// when the new path lands in a module the change never named: that is a wider scope, gate 1's.

const MODULE_PATHS = [
  /^modules\/([^/]+)(?:\/|$)/,
  /^apps\/[^/]+\/src\/modules\/([^/]+)(?:\/|$)/,
  /^docs\/specs\/([^/]+)(?:\/|$)/,
];

// Bookkeeping and instructions are never implementation, whatever the change owns.
const OPERATIONAL = /^(?:\.git|\.spectree|\.agents|\.codex)(?:\/|$)|^(?:AGENTS|CLAUDE)\.md$/i;

// After the integration approval the content is frozen: ownership moves with it or not at all.
const FROZEN = ['integration_approved', 'integrated', 'closed'];

/** The business module a repository path belongs to, by the three folders of a module; or null. */
export function moduleOfPath(path) {
  for (const re of MODULE_PATHS) {
    const m = re.exec(path);
    if (m) return m[1];
  }
  return null;
}

const trim = (p) => p.replace(/\/+$/, '');
const covered = (allowed, p) => allowed.some((a) => trim(p) === trim(a) || trim(p).startsWith(`${trim(a)}/`));

/**
 * What adding `paths` to the change would do. Pure: it reads the change and decides.
 *
 * The modules the change names are `modules_named` when the proposal recorded them, and
 * otherwise the modules its paths already own: a deltaless refactor names its modules in prose,
 * and the paths cut at `open` are the only countable statement of them.
 *
 * @returns {{ ok: true, added: string[], already: string[], modules: string[] }
 *         | { ok: false, code: string, message: string }}
 */
export function planPathAmendment(change, paths, reason) {
  const no = (code, message) => ({ ok: false, code, message });
  if (!String(reason ?? '').trim()) return no('E_AMEND_REASON', 'an amendment needs --reason "<why>": ownership that grew with no stated cause is unreadable at review');
  if (FROZEN.includes(change.state)) return no('E_AMEND_STATE', `the change is ${change.state}: its content is approved for integration, and ownership cannot grow under that approval`);
  if (!paths.length) return no('E_AMEND_PATHS', 'nothing to add: pass --add <path>[,<path>]');
  for (const p of paths) {
    if (p.startsWith('/') || /^[a-z]:/i.test(p) || p.split('/').includes('..') || p.includes('\\')) {
      return no('E_AMEND_PATHS', `"${p}" is not a repository-relative path`);
    }
    if (OPERATIONAL.test(p)) return no('E_AMEND_PATHS', `"${p}" is operational state or instructions, never a path a change owns`);
  }

  const allowed = change.allowed_paths ?? [];
  const named = new Set(change.modules_named?.length
    ? change.modules_named
    : allowed.map(moduleOfPath).filter(Boolean));
  const already = paths.filter((p) => covered(allowed, p));
  const added = [...new Set(paths.filter((p) => !covered(allowed, p)))];
  const outside = [...new Set(added.map(moduleOfPath).filter((m) => m && !named.has(m)))];
  if (outside.length) {
    return no('E_AMEND_NEW_MODULE',
      `${outside.map((m) => `"${m}"`).join(', ')} ${outside.length > 1 ? 'are modules' : 'is a module'} this change does not name. ` +
      'That widens the scope: the Architect amends the proposal to name it, and gate 1 approves the change again');
  }
  return { ok: true, added, already, modules: [...new Set(added.map(moduleOfPath).filter(Boolean))] };
}
