// InstallManager — "add this game to the home screen / desktop".
//
// Chromium browsers (Chrome, Edge, Brave, Samsung Internet…) announce that the page is installable with a
// `beforeinstallprompt` event, which we keep and fire when the player presses OUR Install button (the browser's own
// mini-bar is suppressed so the button is the one place to do it). Safari has no such event: on iPhone / iPad the only way
// is Share → Add to Home Screen, so we only report that a hint is needed. Pure logic over injected window/navigator.

import { Emitter } from './emitter.js';

export class InstallManager extends Emitter {
  constructor({ win = globalThis, nav = globalThis.navigator } = {}) {
    super();
    this.win = win;
    this.nav = nav;
    this.deferred = null;
    this.installedNow = false; // installed during this visit
    this.started = false;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.win.addEventListener?.('beforeinstallprompt', e => {
      e.preventDefault(); // keep it for our own button
      this.deferred = e;
      this.emit('change', this.state);
    });
    this.win.addEventListener?.('appinstalled', () => {
      this.deferred = null;
      this.installedNow = true;
      this.emit('change', this.state);
    });
    // opening the game from its icon (or installing it) flips the display mode: keep the Settings row honest
    for (const q of ['(display-mode: standalone)', '(display-mode: fullscreen)']) this.win.matchMedia?.(q)?.addEventListener?.('change', () => this.emit('change', this.state));
  }

  /** Running as an installed app right now (own window / home-screen icon), not in a browser tab. */
  get standalone() {
    const m = q => !!this.win.matchMedia?.(q)?.matches;
    return m('(display-mode: standalone)') || m('(display-mode: fullscreen)') || m('(display-mode: minimal-ui)') || this.nav?.standalone === true;
  }

  get ios() {
    const ua = this.nav?.userAgent || '';
    // iPadOS 13+ reports itself as a Mac: tell it apart by touch support
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (this.nav?.maxTouchPoints || 0) > 1);
  }

  /**
   * What the UI should offer:
   *   'installed'  already an app (nothing to offer)
   *   'prompt'     a one-tap install is available
   *   'ios'        show the Share → Add to Home Screen steps
   *   'browser'    the browser can install it but has not offered yet — point at its menu
   */
  get mode() {
    if (this.standalone || this.installedNow) return 'installed';
    if (this.deferred) return 'prompt';
    if (this.ios) return 'ios';
    return 'browser';
  }

  get state() {
    return { mode: this.mode, canPrompt: !!this.deferred, standalone: this.standalone };
  }

  /** Show the browser's install dialog. Resolves 'accepted' | 'dismissed' | 'unavailable'. */
  async prompt() {
    const e = this.deferred;
    if (!e) return 'unavailable';
    this.deferred = null; // the browser allows each event to be used once
    try {
      await e.prompt();
      const choice = await e.userChoice;
      this.emit('change', this.state);
      return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
    } catch (_) {
      this.emit('change', this.state);
      return 'dismissed';
    }
  }
}
