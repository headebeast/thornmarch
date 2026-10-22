// "Remind me later" — remembers that the player postponed THIS update, and until when.
//
//   · Timed choices (30 minutes, 1 hour…) store a deadline; the banner returns when it passes.
//   · "Next time I open the game" stores the id of the current launch; the banner returns in any later launch. A launch is
//     one window / tab / app start — it survives a reload (sessionStorage) but not closing the window.
//   · The postponement belongs to one build: a newer build is a new announcement and is never hidden by an old snooze.
//   · A clock that jumped backwards cannot hide the banner for days: a deadline further away than the longest choice is void.
//
// Pure logic over an injected `storage` ({get(key, fallback), set(key, value)}), clock and launch id — no DOM.

import { PWA, SNOOZE_OPTIONS } from './config.js';

/** An id for this launch: kept in sessionStorage so a reload keeps it; a fresh random one when sessionStorage is unavailable. */
export function makeLaunchId(session, key = PWA.launchKey) {
  const fresh = () => Math.random().toString(36).slice(2, 12);
  try {
    let id = session?.getItem(key);
    if (!id) {
      id = fresh();
      session?.setItem(key, id);
    }
    return id;
  } catch (_) {
    return fresh();
  }
}

export class SnoozeStore {
  constructor({ storage, launchId, now = Date.now, options = SNOOZE_OPTIONS, key = PWA.snoozeKey }) {
    this.storage = storage;
    this.launchId = launchId;
    this.now = now;
    this.options = options;
    this.key = key;
    this.longest = Math.max(0, ...options.map(o => o.ms || 0));
  }

  option(id) {
    return this.options.find(o => o.id === id) || null;
  }

  /** Postpone the update announcement for build `version`. Returns the resulting status (see `status`). */
  snooze(optionId, version) {
    const opt = this.option(optionId);
    if (!opt) throw new Error(`unknown snooze option "${optionId}"`);
    const t = this.now();
    this.storage.set(this.key, { version: String(version), optionId, setAt: t, until: opt.ms ? t + opt.ms : null, launch: opt.launch ? this.launchId : null });
    return this.status(version);
  }

  /** null = not postponed (or the postponement is over); otherwise { optionId, until|null, launch|null, setAt }. */
  status(version) {
    const rec = this.storage.get(this.key, null);
    if (!rec || rec.version !== String(version)) return null;
    const t = this.now();
    const over = rec.until !== null && rec.until !== undefined ? t >= rec.until || rec.until - t > this.longest + 1000 : rec.launch !== this.launchId;
    if (over) {
      this.clear();
      return null;
    }
    return { optionId: rec.optionId, until: rec.until ?? null, launch: rec.launch ?? null, setAt: rec.setAt };
  }

  /** Milliseconds until a timed postponement ends; null when there is none (or it lasts until the next launch). */
  remainingMs(version) {
    const s = this.status(version);
    return s && s.until !== null ? Math.max(0, s.until - this.now()) : null;
  }

  clear() {
    this.storage.set(this.key, null);
  }
}
