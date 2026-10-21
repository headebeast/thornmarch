// Player preferences, saved in this browser (through the platform adapter, so a native shell can keep them in its own store).

import { platform } from '../platform/platform.js';

const KEY = 'aeii_settings';
export const DEFAULTS = { showFps: false, showNet: false };

class Settings {
  constructor() {
    this.values = { ...DEFAULTS, ...(platform.storage.get(KEY, {}) || {}) };
    this.listeners = new Set();
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    if (this.values[key] === value) return;
    this.values[key] = value;
    platform.storage.set(KEY, this.values);
    for (const fn of this.listeners) fn(key, value);
  }

  /** Call `fn(key, value)` on every change; returns an unsubscribe function. */
  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const settings = new Settings();
