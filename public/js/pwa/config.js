// Every number and key of the PWA / update system in one place — change a timing or add a snooze choice here.

export const PWA = Object.freeze({
  scriptUrl: '/sw.js',
  scope: '/',
  /** While the game stays open (an installed app can run for days) ask the server about a new build this often … */
  checkEveryMs: 15 * 60 * 1000,
  /** … and when the window comes back to the front or the network returns, but never more often than this. */
  minCheckGapMs: 60 * 1000,
  /** How long to wait for the new worker to describe itself before showing the update without a version number. */
  infoTimeoutMs: 1500,
  /** How long to wait for the new worker to take over after the player confirmed. */
  applyTimeoutMs: 6000,
  /** A freshly found build is still downloading its files; give a manual "Check for updates" this long to finish. */
  installTimeoutMs: 90 * 1000,
  snoozeKey: 'aeii_update_snooze',
  launchKey: 'aeii_launch'
});

/**
 * What the "Later" button offers, in order. `ms` = remind after that long; `launch: true` = remind the next time the
 * game is opened (a new window / tab / app launch — a plain reload does not count).
 */
export const SNOOZE_OPTIONS = Object.freeze([
  Object.freeze({ id: '30m', label: '30 minutes', ms: 30 * 60 * 1000 }),
  Object.freeze({ id: '1h', label: '1 hour', ms: 60 * 60 * 1000 }),
  Object.freeze({ id: 'launch', label: 'Next time I open the game', launch: true })
]);
