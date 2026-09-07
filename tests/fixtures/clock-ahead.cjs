// Moves the clock forward by SPECTREE_CLOCK_AHEAD_DAYS for one child process, so a test can
// resume a preparation "the next day" without renaming anything — renaming the archive folder
// would change the candidate, which is a different situation with a different right answer.
const Real = Date;
const shift = Number(process.env.SPECTREE_CLOCK_AHEAD_DAYS ?? 1) * 86400000;
class Ahead extends Real {
  constructor(...args) {
    if (args.length === 0) super(Real.now() + shift);
    else super(...args);
  }
  static now() { return Real.now() + shift; }
}
globalThis.Date = Ahead;
