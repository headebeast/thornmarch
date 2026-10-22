// UpdateController — the rules of the update announcement. It combines three things and turns them into one answer for the
// screen ("what should the banner show right now?"):
//
//   what the browser says       (UpdateManager: a newer build is ready / another window already updated)
//   what the player chose       (SnoozeStore: "remind me in 30 minutes" …)
//   what the player is doing    (context(): in a match? in the editor? — only used to word the confirmation honestly)
//
// It owns the reminder timer, so a snoozed banner comes back by itself, and it is the only door through which an update gets
// applied: requestApply() ALWAYS asks first, and "no" (or closing the dialog) leaves everything exactly as it was.
//
// No DOM here: the views (ui/updateBanner.js, ui/updateConfirm.js, ui/pwaSettings.js) listen to 'change' and call these methods.

import { Emitter } from './emitter.js';
import { PHASE } from './updateManager.js';
import { SNOOZE_OPTIONS } from './config.js';

const MAX_TIMER = 2 ** 31 - 1; // setTimeout silently misfires above this

export class UpdateController extends Emitter {
  /** @param {{manager: import('./updateManager.js').UpdateManager, snooze: import('./snooze.js').SnoozeStore}} o */
  constructor({ manager, snooze, now = Date.now, timers = null, options = SNOOZE_OPTIONS }) {
    super();
    this.manager = manager;
    this.snoozeStore = snooze;
    this.now = now;
    this.options = options;
    this.timers = timers || { setTimeout: (...a) => setTimeout(...a), clearTimeout: id => clearTimeout(id) };
    this.confirm = null;
    this.context = () => ({ busy: false });
    this.timer = null;
    this.last = '';
    this.asking = false;
  }

  /** The screen supplies the two things only it knows: how to ask yes/no, and what the player is in the middle of. */
  attach({ confirm, context }) {
    if (confirm) this.confirm = confirm;
    if (context) this.context = context;
  }

  start() {
    this.manager.on('state', () => this.refresh());
    this.refresh();
  }

  /** Which announcement is this? A snooze applies to one announcement only. */
  key(s = this.manager.state) {
    return `${s.phase === PHASE.STALE ? 'stale:' : ''}${s.next || 'unknown'}`;
  }

  /** The complete answer for the screen. */
  get view() {
    const s = this.manager.state;
    const announce = s.phase === PHASE.AVAILABLE || s.phase === PHASE.STALE || s.phase === PHASE.APPLYING;
    const snoozed = s.phase === PHASE.AVAILABLE || s.phase === PHASE.STALE ? this.snoozeStore.status(this.key(s)) : null;
    return {
      phase: s.phase,
      kind: s.phase === PHASE.STALE ? 'reload' : 'update', // 'reload': another window already updated; this page just needs a refresh
      visible: announce && !snoozed,
      available: s.phase === PHASE.AVAILABLE || s.phase === PHASE.STALE, // an update exists (shown or snoozed)
      applying: s.phase === PHASE.APPLYING,
      current: s.current,
      next: s.next,
      note: s.note,
      error: s.error,
      checking: s.checking,
      checkedAt: s.checkedAt,
      offlineReady: s.offlineReady,
      supported: s.phase !== PHASE.UNSUPPORTED,
      snoozed,
      options: this.options,
      busy: this.context()
    };
  }

  /** Re-evaluate (a timer fired, the window came back to the front, the manager changed) and tell the screen if anything changed. */
  refresh() {
    const v = this.view;
    this.schedule(v);
    const fingerprint = JSON.stringify({ ...v, busy: undefined, checkedAt: undefined });
    if (fingerprint === this.last) return;
    this.last = fingerprint;
    this.emit('change', v);
  }

  /** A timed snooze needs a wake-up call; nothing else does. */
  schedule(v) {
    this.timers.clearTimeout(this.timer);
    this.timer = null;
    if (!v.snoozed || v.snoozed.until === null) return;
    const wait = Math.min(Math.max(0, v.snoozed.until - this.now()) + 50, MAX_TIMER);
    this.timer = this.timers.setTimeout(() => this.refresh(), wait);
  }

  // ---- what the player can do --------------------------------------------------------------------------------------
  /** "Remind me later": postpone this announcement. Returns the snooze status, or null when there was nothing to postpone. */
  snooze(optionId) {
    const s = this.manager.state;
    if (s.phase !== PHASE.AVAILABLE && s.phase !== PHASE.STALE) return null;
    const status = this.snoozeStore.snooze(optionId, this.key(s));
    this.refresh();
    return status;
  }

  /** Bring a postponed announcement back right now. */
  remindNow() {
    this.snoozeStore.clear();
    this.refresh();
  }

  /**
   * Update now — after asking. 'applied' (reloading), 'cancelled' (nothing changed), 'failed' (could not switch),
   * 'unavailable' (no update waiting) or 'busy' (a question or an update is already in progress).
   */
  async requestApply() {
    const v = this.view;
    if (!v.available) return 'unavailable';
    if (this.asking || v.applying) return 'busy';
    this.asking = true;
    let agreed = false;
    try {
      agreed = this.confirm ? await this.confirm(v) : false; // with no way to ask, never act
    } finally {
      this.asking = false;
    }
    if (!agreed) return 'cancelled';
    return (await this.manager.apply()) ? 'applied' : 'failed';
  }

  /** "Check for updates" (a player's own action, so it ignores the minimum gap between checks). */
  check() {
    return this.manager.check({ manual: true });
  }
}
