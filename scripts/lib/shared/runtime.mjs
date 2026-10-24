// Whether the Node.js running the squad is one its package declared safe to run on.
//
// The floor lives once, in `engines.node` of the package's own package.json, and travels with
// every install. npm enforces it only for whoever runs `npm install` on this package with
// engine-strict; a consumer runs the installed scripts on whatever Node it has, so the scripts
// have to ask. Only the two comparator forms the floor uses are understood, `^x.y.z` and
// `>=x.y.z` joined by `||`; anything else is reported as not understood, never as satisfied.

const parse = (v) => {
  const m = String(v).trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? m.slice(1).map(Number) : null;
};
const atLeast = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

/**
 * @param {string} version  e.g. process.versions.node
 * @param {string} range    the `engines.node` value
 * @returns {boolean|null}  null when the version or a comparator is not understood
 */
export function satisfiesFloor(version, range) {
  const v = parse(version);
  if (!v || typeof range !== 'string' || !range.trim()) return null;
  let any = false;
  for (const part of range.split('||').map((r) => r.trim())) {
    const caret = part.match(/^\^(\d+\.\d+\.\d+)$/);
    const min = part.match(/^>=(\d+\.\d+\.\d+)$/);
    if (!caret && !min) return null;
    const f = parse((caret ?? min)[1]);
    if (caret ? v[0] === f[0] && atLeast(v, f) : atLeast(v, f)) any = true;
  }
  return any;
}
