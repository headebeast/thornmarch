// Platform adapter — the *only* place that knows about browser/OS differences.
// The game never touches `document.fullscreenElement`, `localStorage` or `navigator.vibrate` directly, so a native
// shell (Electron, Tauri, Capacitor, Steam) can take over any capability by providing `window.aeiiHost`:
//
//   window.aeiiHost = {
//     name: 'electron' | 'tauri' | 'capacitor' | 'steam',
//     fullscreen: { toggle(): Promise<bool>, isActive(): bool },
//     storage:    { get(key), set(key, value) },           // e.g. files / Steam Cloud
//     haptic(ms), openUrl(url), quit(), achievement(id)    // all optional
//   }

const host = typeof window !== 'undefined' ? window.aeiiHost || null : null;

function safeStorage() {
  try {
    const k = '__aeii_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return localStorage;
  } catch (_) {
    const mem = new Map();
    return {
      getItem: k => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: k => mem.delete(k)
    };
  }
}

const store = safeStorage();

const fsTarget = () => document.documentElement;

class Fullscreen {
  constructor() {
    this.listeners = new Set();
    this.pseudo = false; // iOS Safari: no Fullscreen API on iPhone → hide browser chrome via CSS instead
    const notify = () => this.listeners.forEach(fn => fn(this.isActive()));
    document.addEventListener('fullscreenchange', notify);
    document.addEventListener('webkitfullscreenchange', notify);
    this.notify = notify;
  }

  get supported() {
    return !!(host?.fullscreen || fsTarget().requestFullscreen || fsTarget().webkitRequestFullscreen);
  }

  isActive() {
    if (host?.fullscreen) return host.fullscreen.isActive();
    return !!(document.fullscreenElement || document.webkitFullscreenElement) || this.pseudo;
  }

  async toggle() {
    if (host?.fullscreen) {
      await host.fullscreen.toggle();
      this.notify();
      return this.isActive();
    }
    const el = fsTarget();
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) {
      // pseudo-fullscreen: let CSS drop all chrome; installed PWAs/standalone already are fullscreen
      this.pseudo = !this.pseudo;
      document.body.classList.toggle('pseudo-fullscreen', this.pseudo);
      window.scrollTo(0, 1);
      this.notify();
      return this.pseudo;
    }
    if (this.isActive()) {
      await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      try {
        await req.call(el, { navigationUI: 'hide' });
        // on phones, landscape is the natural orientation for the battlefield
        if (platform.isTouch) screen.orientation?.lock?.('landscape').catch(() => {});
      } catch (_) {
        /* user gesture required / blocked by embedding page */
      }
    }
    return this.isActive();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const platform = {
  host,
  name: host?.name || 'web',
  isTouch: typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches,
  isStandalone:
    typeof matchMedia !== 'undefined' &&
    (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true),
  fullscreen: typeof document !== 'undefined' ? new Fullscreen() : null,

  storage: {
    get(key, fallback = null) {
      try {
        const raw = host?.storage ? host.storage.get(key) : store.getItem(key);
        return raw === null || raw === undefined ? fallback : JSON.parse(raw);
      } catch (_) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        const raw = JSON.stringify(value);
        if (host?.storage) host.storage.set(key, raw);
        else store.setItem(key, raw);
      } catch (_) {
        /* quota / private mode: non-fatal */
      }
    }
  },

  haptic(ms = 12) {
    if (host?.haptic) host.haptic(ms);
    else navigator.vibrate?.(ms);
  },

  async keepAwake() {
    try {
      this._lock = await navigator.wakeLock?.request('screen');
    } catch (_) {
      /* not granted: fine */
    }
  },

  copy(text) {
    return navigator.clipboard?.writeText(text).then(() => true, () => false) ?? Promise.resolve(false);
  },

  achievement(id) {
    host?.achievement?.(id);
  }
};
