// The player's choice about anonymous usage statistics. Nothing is recorded or sent until it is 'granted'.
//
// 'unset'   – never asked: ask once (unless the browser already said no, below), collect nothing meanwhile
// 'granted' – "Allow": collect
// 'denied'  – "No thanks": collect nothing, do not ask again
//
// A browser that sends "Do Not Track" or "Global Privacy Control" has already answered, so it is treated as 'denied'
// without asking — and an explicit "Allow" given later in Settings still wins.

import { platform } from '../platform/platform.js';

const KEY = 'aeii_consent';

const browserSaysNo = () => typeof navigator !== 'undefined' && (navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1');

class Consent {
  constructor() {
    this.listeners = new Set();
  }

  get state() {
    const saved = platform.storage.get(KEY, null);
    if (saved === 'granted' || saved === 'denied') return saved;
    return browserSaysNo() ? 'denied' : 'unset';
  }

  /** Should the banner appear? Only while the player has not decided and the browser has not decided for them. */
  get needsAsk() {
    return this.state === 'unset';
  }

  get granted() {
    return this.state === 'granted';
  }

  /** True when the browser's own privacy signal (not a click) is what is keeping statistics off. */
  get blockedBySignal() {
    return platform.storage.get(KEY, null) === null && browserSaysNo();
  }

  set(state) {
    if (state !== 'granted' && state !== 'denied') return;
    const before = this.state;
    platform.storage.set(KEY, state);
    if (before !== state) for (const fn of this.listeners) fn(state);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const consent = new Consent();
