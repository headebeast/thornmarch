// UpdateManager — the one place that talks to the browser's service-worker machinery.
//
// It registers the worker, notices when a NEWER build has finished downloading ("waiting"), and can switch to it on request.
// It never decides what the player sees or when — it only reports facts through the 'state' event. Policy (snooze, banner)
// lives in updateController.js, pictures in ui/updateBanner.js.
//
// phase:  unsupported  no service worker here (unbuilt dev page, insecure origin, old browser)
//         idle         running the newest build we know of
//         available    a newer build is downloaded and waiting for the player's go-ahead
//         applying     the player agreed; switching over and reloading
//         stale        ANOTHER tab/window already switched; this page still runs old code and should reload
//
// Nothing here reloads the page unless apply() was called — a page that updates itself mid-match is exactly the bug this
// system exists to prevent.

import { Emitter } from './emitter.js';
import { PWA } from './config.js';
import { SW_MESSAGE } from './protocol.js';

export const PHASE = Object.freeze({ UNSUPPORTED: 'unsupported', IDLE: 'idle', AVAILABLE: 'available', APPLYING: 'applying', STALE: 'stale' });

const message = err => String(err?.message || err || 'unknown error').slice(0, 200);

export class UpdateManager extends Emitter {
  /**
   * Everything the browser provides is injectable, so the whole thing is tested without a browser (scripts/test-pwa.mjs).
   * @param {object} o
   * @param {ServiceWorkerContainer} [o.container]
   * @param {Document} [o.doc]
   * @param {Window} [o.win]
   * @param {string} [o.currentVersion]  the build this page is running
   * @param {boolean} [o.enabled]        false → stay in the 'unsupported' phase (unbuilt dev page)
   * @param {() => void} [o.reload]
   */
  constructor({ container = globalThis.navigator?.serviceWorker, doc = globalThis.document, win = globalThis, currentVersion = 'dev', enabled = true, reload = () => globalThis.location?.reload(), now = Date.now, timers = null, config = PWA } = {}) {
    super();
    this.container = container;
    this.doc = doc;
    this.win = win;
    this.reload = reload;
    this.now = now;
    this.cfg = config;
    this.enabled = enabled;
    this.timers = timers || { setTimeout: (...a) => setTimeout(...a), clearTimeout: id => clearTimeout(id), setInterval: (...a) => setInterval(...a), clearInterval: id => clearInterval(id) };
    this.s = { phase: PHASE.UNSUPPORTED, current: currentVersion, next: null, note: '', checking: false, checkedAt: 0, offlineReady: false, error: null };
    this.reg = null;
    this.waiting = null; // the worker holding the newer build
    this.pending = null; // promise: a newly installed worker is being described
    this.offering = null; // the worker that is being described
    this.inflight = null; // promise: a check is running
    this.lastCheck = 0;
    this.hadController = false;
    this.reloading = false;
    this.applyDone = null;
    this.started = false;
    this.ready = null;
    this.cleanups = [];
  }

  get state() {
    return { ...this.s };
  }

  set(patch) {
    this.s = { ...this.s, ...patch };
    this.emit('state', this.state);
  }

  // ---- start-up ----------------------------------------------------------------------------------------------------
  /** Begin watching. Safe to call twice. Resolves when registration is done; `ready` is the same promise, for anyone who must wait. */
  start() {
    if (!this.ready) this.ready = this.boot();
    return this.ready;
  }

  async boot() {
    this.started = true;
    if (!this.enabled || !this.container) return this.set({ phase: PHASE.UNSUPPORTED });
    this.hadController = !!this.container.controller;
    this.listen(this.container, 'controllerchange', () => this.onControllerChange());
    try {
      this.reg = await this.container.register(this.cfg.scriptUrl, { scope: this.cfg.scope, updateViaCache: 'none' });
    } catch (err) {
      return this.set({ phase: PHASE.UNSUPPORTED, error: message(err) });
    }
    this.set({ phase: PHASE.IDLE, offlineReady: !!this.container.controller });
    this.listen(this.reg, 'updatefound', () => this.track(this.reg.installing));

    if (this.reg.waiting && this.container.controller) this.offer(this.reg.waiting); // a build arrived while the game was closed
    else if (this.reg.installing) this.track(this.reg.installing);

    // An installed app can stay open for days: ask now and then, and whenever the player comes back to it.
    this.interval = this.timers.setInterval(() => this.check({ reason: 'interval' }), this.cfg.checkEveryMs);
    this.listen(this.doc, 'visibilitychange', () => this.doc.visibilityState === 'visible' && this.check({ reason: 'visible' }));
    this.listen(this.win, 'online', () => this.check({ reason: 'online' }));
  }

  stop() {
    this.timers.clearInterval(this.interval);
    for (const off of this.cleanups.splice(0)) off();
  }

  listen(target, type, fn) {
    target?.addEventListener?.(type, fn);
    this.cleanups.push(() => target?.removeEventListener?.(type, fn));
  }

  // ---- noticing a new build ----------------------------------------------------------------------------------------
  /** Follow a worker that is installing; when it is ready and an older build is running, announce it. */
  track(worker) {
    if (!worker) return;
    const onState = () => {
      if (worker.state === 'installed' && this.container.controller) this.offer(worker);
      else if (worker.state === 'redundant' && this.waiting === worker && this.s.phase === PHASE.AVAILABLE) {
        this.waiting = null; // superseded by a newer build or discarded: the newer one arrives through its own 'updatefound'
        if (!this.reg.waiting) this.set({ phase: PHASE.IDLE, next: null, note: '' });
      }
    };
    worker.addEventListener('statechange', onState);
    onState();
  }

  /** A newer build is downloaded: read its version, then tell everyone. */
  offer(worker) {
    if (this.s.phase === PHASE.APPLYING || this.waiting === worker) return;
    if (this.offering === worker) return this.pending; // already being described (the same worker can be reported twice)
    this.offering = worker;
    const run = (async () => {
      const info = await this.describe(worker);
      if (this.pending !== run || this.s.phase === PHASE.APPLYING) return; // a newer offer replaced this one
      this.waiting = worker;
      this.set({ phase: PHASE.AVAILABLE, next: info?.version || null, note: info?.note || '', error: null });
    })();
    this.pending = run;
    return run;
  }

  /** Ask a worker which build it holds (a missing answer is fine: the update is then announced without a number). */
  describe(worker) {
    return new Promise(resolve => {
      let done = false;
      let ch = null;
      const finish = v => {
        if (done) return;
        done = true;
        this.timers.clearTimeout(timer);
        ch?.port1.close();
        resolve(v);
      };
      const timer = this.timers.setTimeout(() => finish(null), this.cfg.infoTimeoutMs);
      try {
        ch = new MessageChannel();
        ch.port1.onmessage = e => finish(e.data && e.data.version ? e.data : null);
        worker.postMessage({ type: SW_MESSAGE.GET_INFO }, [ch.port2]);
      } catch (_) {
        finish(null);
      }
    });
  }

  // ---- checking ----------------------------------------------------------------------------------------------------
  /**
   * Ask the server whether a newer build exists.
   * resolves { result: 'available' | 'current' | 'stale' | 'applying' | 'skipped' | 'unsupported' | 'error', error? }
   * `manual` ignores the minimum gap between checks (the player pressed "Check for updates").
   */
  check({ manual = false } = {}) {
    const { phase } = this.s;
    if (phase === PHASE.UNSUPPORTED || !this.reg) return Promise.resolve({ result: 'unsupported' });
    if (phase === PHASE.APPLYING) return Promise.resolve({ result: 'applying' });
    if (phase === PHASE.AVAILABLE || phase === PHASE.STALE) return Promise.resolve({ result: phase });
    if (this.inflight) return this.inflight;
    const t = this.now();
    if (!manual && t - this.lastCheck < this.cfg.minCheckGapMs) return Promise.resolve({ result: 'skipped' });
    this.lastCheck = t;
    this.set({ checking: true, error: null });
    this.inflight = this.runCheck().finally(() => (this.inflight = null));
    return this.inflight;
  }

  async runCheck() {
    let out;
    try {
      await this.reg.update();
      const installing = this.reg.installing;
      if (installing) await this.settle(installing); // update() may answer when the download BEGINS; wait for it to finish
      // …or after it finished, before the "installed" event was delivered: either way a waiting worker is an update
      if (this.reg.waiting && this.container.controller) this.offer(this.reg.waiting);
      await this.pending;
      out = { result: this.s.phase === PHASE.AVAILABLE ? 'available' : 'current' };
    } catch (err) {
      console.warn('[pwa] update check failed:', message(err)); // the technical reason, for whoever debugs it
      out = { result: 'error', error: 'Could not reach the server — you may be offline. Try again later.' };
    }
    this.set({ checking: false, checkedAt: this.now(), error: out.error || null });
    return out;
  }

  /** Resolves when a worker is installed, discarded or too slow. */
  settle(worker) {
    return new Promise(resolve => {
      const timer = this.timers.setTimeout(done, this.cfg.installTimeoutMs);
      function done() {
        worker.removeEventListener('statechange', onState);
        resolve();
      }
      const onState = () => {
        if (worker.state !== 'installing') {
          this.timers.clearTimeout(timer);
          done();
        }
      };
      worker.addEventListener('statechange', onState);
      onState();
    });
  }

  // ---- switching over ----------------------------------------------------------------------------------------------
  /** Take the new build and reload. Call ONLY after the player confirmed. Resolves true once the reload has been triggered. */
  async apply() {
    const { phase } = this.s;
    if (phase === PHASE.STALE) {
      this.set({ phase: PHASE.APPLYING });
      this.reloading = true;
      this.reload(); // the new worker is already in charge; only this page's code is old
      return true;
    }
    if (phase !== PHASE.AVAILABLE || !this.waiting) return false;
    const worker = this.waiting;
    this.set({ phase: PHASE.APPLYING, error: null });
    const switched = await new Promise(resolve => {
      const timer = this.timers.setTimeout(() => resolve(false), this.cfg.applyTimeoutMs);
      this.applyDone = ok => {
        this.timers.clearTimeout(timer);
        resolve(ok);
      };
      try {
        worker.postMessage({ type: SW_MESSAGE.SKIP_WAITING });
      } catch (err) {
        this.applyDone(false);
      }
    });
    this.applyDone = null;
    if (switched) return true; // the reload was already triggered by the controllerchange below
    this.set({ phase: PHASE.AVAILABLE, error: 'The new version could not take over. Close every window of the game and open it again.' });
    return false;
  }

  /**
   * The game itself failed to start. If a newer build is waiting (or can be found), switch to it at once — nothing is running,
   * so nothing can be lost — instead of leaving the player stuck on a broken cached copy. Resolves true when it switched.
   */
  async recover() {
    await this.start();
    await this.pending;
    if (this.s.phase === PHASE.UNSUPPORTED) return false;
    if (this.s.phase !== PHASE.AVAILABLE && this.s.phase !== PHASE.STALE) {
      const found = await this.check({ manual: true });
      if (found.result !== 'available') return false;
    }
    return this.apply();
  }

  onControllerChange() {
    if (!this.hadController) {
      this.hadController = true; // the very first install claiming this page — nothing to update
      this.set({ offlineReady: true });
      return;
    }
    if (this.reloading) return;
    if (this.s.phase === PHASE.APPLYING) {
      this.reloading = true;
      this.applyDone?.(true);
      this.reload();
      return;
    }
    // Another window applied the update. The worker serving files is now the new one, but this page runs old code.
    this.waiting = null;
    this.set({ phase: PHASE.STALE, next: null, note: '', checking: false });
    const controller = this.container.controller;
    if (controller) this.describe(controller).then(info => info && this.s.phase === PHASE.STALE && this.set({ next: info.version, note: info.note || '' }));
  }
}
