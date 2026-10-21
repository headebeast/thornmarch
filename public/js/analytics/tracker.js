// Anonymous usage statistics — the client half. Read public/privacy.html for the player-facing promise this code keeps.
//
//   · NOTHING happens until the player has said yes (consent.granted): no listeners, no timers, no id, no network.
//   · Saying no (or switching it off in Settings) removes every listener and drops anything not yet sent.
//   · What is recorded: which screen is open and for how long, which labelled controls are clicked, how long the page was
//     really in use ("active"), how long a match was played, scroll/zoom counts, frame-rate and ping averages, crashes.
//   · What is NEVER recorded: anything typed (names, chat), match contents, coordinates, the text of user-made things.
//     Controls inside a [data-notrack] container (the online lobby) are skipped entirely.
//   · The server adds the (masked) IP address and approximate location itself; the page cannot see them.

import { consent } from './consent.js';
import { platform } from '../platform/platform.js';
import { deploy } from '../config/deploy.js';
import { modalHooks } from '../ui/modal.js';

const FLUSH_MS = 20000; // send what has piled up this often …
const TICK_MS = 15000; // … and measure active time this often
const IDLE_MS = 30000; // no input for this long = the player has stepped away (unless a match is on screen)
const SAMPLE_MS = 60000; // frame-rate / ping samples
const VID_KEY = 'aeii_vid';

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => ((Math.random() * 16) | 0).toString(16)));

export class Tracker {
  /** @param {{perf: import('../platform/perfMonitor.js').PerfMonitor, getNet: () => import('../network/netStats.js').NetStats | null, isOnline: () => boolean}} o */
  constructor({ perf, getNet, isOnline }) {
    this.perf = perf;
    this.getNet = getNet;
    this.isOnline = isOnline;
    this.on = false;
    this.queue = [];
    this.screenName = 'menu';
    this.screenSince = 0;
    this.modalStack = [];
    this.play = null;
    this.scrolls = new Map();
    this.cleanups = [];
    this.seq = 0;
    this.sentContext = false;
  }

  get available() {
    return !!deploy.analyticsUrl;
  }

  /** Call once at start-up: follows the consent choice from then on. */
  init() {
    if (!this.available) return;
    consent.onChange(state => (state === 'granted' ? this.begin() : this.end()));
    if (consent.granted) this.begin();
  }

  // ---- lifecycle -------------------------------------------------------------------------------------------------
  begin() {
    if (this.on || !this.available) return;
    this.on = true;
    this.vid = platform.storage.get(VID_KEY, null) || uuid();
    platform.storage.set(VID_KEY, this.vid);
    this.sid = uuid();
    this.t0 = performance.now();
    this.lastInput = this.t0;
    this.lastTick = this.t0;
    this.lastSample = this.t0;
    this.screenSince = this.t0;
    this.seq = 0;
    this.sentContext = false;
    this.push({ k: 'start' });

    const add = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts);
      this.cleanups.push(() => target.removeEventListener(type, fn, opts));
    };
    const touch = () => (this.lastInput = performance.now());
    for (const type of ['pointerdown', 'keydown', 'touchstart']) add(document, type, touch, { capture: true, passive: true });
    add(document, 'click', e => this.onClick(e), { capture: true, passive: true });
    add(document, 'wheel', e => this.onWheel(e), { capture: true, passive: true });
    add(document, 'scroll', e => this.onScroll(e), { capture: true, passive: true });
    add(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.pageHidden();
      else this.lastTick = this.screenSince = performance.now(); // time spent in the background is not time on screen
    });
    add(window, 'pagehide', () => this.pageHidden(true));
    add(window, 'error', e => this.push({ k: 'err', msg: `${e.message || 'error'} @ ${(e.filename || '').split('/').pop()}:${e.lineno || 0}` }));
    add(window, 'unhandledrejection', e => this.push({ k: 'err', msg: `rejection: ${String(e.reason?.message || e.reason || '').slice(0, 100)}` }));
    this.timers = [setInterval(() => this.tick(), TICK_MS), setInterval(() => this.flush(), FLUSH_MS)];

    modalHooks.open = m => this.modalOpened(m);
    modalHooks.close = m => this.modalClosed(m);
  }

  /** Switched off: stop everything and forget what was waiting to be sent. */
  end() {
    if (!this.on) return;
    this.on = false;
    this.cleanups.splice(0).forEach(fn => fn());
    this.timers?.forEach(clearInterval);
    this.queue = [];
    this.scrolls.clear();
    modalHooks.open = modalHooks.close = null;
  }

  // ---- what the app tells us -------------------------------------------------------------------------------------
  /** The screen the player is on: 'menu', 'play:royale', 'editor', 'modal:Codex'. Remembered even while off. */
  screen(name) {
    if (name === this.screenName) return;
    this.dwell();
    this.screenName = name;
  }

  /** Record how long the current screen has been showing (while the page was visible), and start counting again. */
  dwell() {
    if (!this.on) return;
    const now = performance.now();
    const ms = now - this.screenSince;
    if (ms > 400) this.push({ k: 'screen', name: this.screenName, ms });
    this.screenSince = now;
  }

  playStart(mode, cfg = {}) {
    if (!this.on) return;
    this.play = { mode, since: performance.now(), rounds: 0 };
    this.push({ k: 'play', mode, cfg });
  }

  /** result: 'won' | 'lost' | 'draw' | 'quit' */
  playEnd(result = 'quit', { rounds = 0, place = null } = {}) {
    if (!this.on || !this.play) return;
    this.push({ k: 'playEnd', mode: this.play.mode, ms: performance.now() - this.play.since, result, rounds, place });
    this.play = null;
    this.flush();
  }

  // ---- modal dialogs count as screens ----------------------------------------------------------------------------
  modalOpened(modal) {
    this.modalStack.push(this.screenName);
    this.screen(`modal:${modal.title.textContent.slice(0, 30)}`);
  }

  modalClosed() {
    if (this.modalStack.length) this.screen(this.modalStack.pop());
  }

  // ---- input -----------------------------------------------------------------------------------------------------
  /** A label for the control that was clicked, or null (including: anything we must not look at). */
  label(el) {
    if (!(el instanceof Element)) return null;
    const t = el.closest('[data-track], button, a, [role=switch], [role=button], canvas');
    if (!t || t.closest('[data-notrack]')) return null;
    if (t.tagName === 'CANVAS') return `${this.screenName}: map`;
    const own = t.dataset.track || (t.dataset.tool ? `tool:${t.dataset.tool}` : '') || t.getAttribute('aria-label') || (t.innerText || '').split('\n')[0];
    const text = own.replace(/NEW$/, '').trim().slice(0, 30); // the little "NEW" badge is not part of the name
    return text ? `${this.screenName}: ${text}` : null;
  }

  onClick(e) {
    const id = this.label(e.target);
    if (id) this.push({ k: 'click', id });
  }

  onWheel(e) {
    const where = e.target?.id === 'game-canvas' ? 'map-zoom' : 'ui-wheel';
    this.scrolls.set(where, { n: (this.scrolls.get(where)?.n || 0) + 1, depth: null });
  }

  onScroll(e) {
    const el = e.target;
    if (!(el instanceof Element) || el.closest('[data-notrack]')) return;
    const room = el.scrollHeight - el.clientHeight;
    const depth = room > 0 ? Math.min(100, Math.round((el.scrollTop / room) * 100)) : 0;
    const where = (el.id || (el.className && String(el.className).split(' ')[0]) || el.tagName.toLowerCase()).slice(0, 24);
    const prev = this.scrolls.get(where);
    this.scrolls.set(where, { n: (prev?.n || 0) + 1, depth: Math.max(prev?.depth ?? 0, depth) });
  }

  // ---- timers ----------------------------------------------------------------------------------------------------
  tick() {
    const now = performance.now();
    const dt = Math.min(now - this.lastTick, TICK_MS * 2);
    this.lastTick = now;
    for (const [where, v] of this.scrolls) this.push({ k: 'scroll', where, n: v.n, depth: v.depth });
    this.scrolls.clear();
    if (document.visibilityState !== 'visible') return;
    const playing = this.screenName.startsWith('play:');
    // a match on screen counts as time in use even while the player only watches the round play out
    if (playing || now - this.lastInput < IDLE_MS) this.push({ k: 'active', ms: dt, play: playing ? dt : 0 });
    if (now - this.lastSample >= SAMPLE_MS) {
      this.lastSample = now;
      const f = playing ? this.perf.drain() : null;
      if (f) this.push({ k: 'fps', avg: f.avg, min: f.min });
      if (this.isOnline()) {
        const s = this.getNet()?.snapshot(now);
        if (s && s.ping !== null) this.push({ k: 'net', ping: s.ping, jitter: s.jitter ?? 0, loss: s.loss });
      }
    }
  }

  pageHidden(leaving = false) {
    if (!this.on) return;
    this.tick();
    this.dwell();
    if (leaving) this.push({ k: 'end', ms: performance.now() - this.t0 });
    this.flush(true);
  }

  // ---- sending ---------------------------------------------------------------------------------------------------
  push(ev) {
    if (!this.on) return;
    if (this.queue.length > 400) this.queue.splice(0, 100); // offline for ages: keep the newest
    this.queue.push(ev);
    if (this.queue.length >= 50) this.flush();
  }

  flush(unloading = false) {
    if (!this.on || !this.queue.length) return;
    const events = this.queue.splice(0, 100);
    const payload = { v: 1, vid: this.vid, sid: this.sid, seq: this.seq++, events };
    if (!this.sentContext) {
      this.sentContext = true;
      let ref = '';
      try {
        ref = document.referrer ? new URL(document.referrer).hostname : '';
      } catch (_) {
        /* ignore */
      }
      payload.ctx = { ref: ref === location.hostname ? '' : ref, lang: navigator.language, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, w: innerWidth, h: innerHeight, dpr: devicePixelRatio, touch: platform.isTouch, standalone: platform.isStandalone, ver: deploy.version.split('+')[0] };
    }
    const url = `${deploy.analyticsUrl}/collect`;
    const body = JSON.stringify(payload);
    try {
      if (unloading && navigator.sendBeacon) navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
      else fetch(url, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
    } catch (_) {
      /* statistics must never break the game */
    }
  }

  /** Delete everything the server holds for this browser, and this browser's id. Resolves true on success. */
  async forget() {
    const vid = platform.storage.get(VID_KEY, null);
    if (!vid) return true;
    try {
      const res = await fetch(`${deploy.analyticsUrl}/forget`, { method: 'POST', body: JSON.stringify({ vid }), headers: { 'Content-Type': 'text/plain' } });
      if (!res.ok) return false;
    } catch (_) {
      return false;
    }
    this.queue = [];
    platform.storage.set(VID_KEY, null);
    if (this.on) {
      this.vid = uuid(); // still sharing: carry on under a new id that is not linked to the erased history
      platform.storage.set(VID_KEY, this.vid);
    }
    return true;
  }
}
