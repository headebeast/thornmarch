// Test doubles for the browser's service-worker world, so the update system is exercised without a browser.

/** A clock and timers the test moves by hand: advance(ms) fires whatever is due, in order. */
export class FakeClock {
  constructor(start = 1_000_000) {
    this.t = start;
    this.seq = 0;
    this.items = new Map(); // id -> { at, fn, every }
    this.timers = {
      setTimeout: (fn, ms) => this.add(fn, ms, 0),
      clearTimeout: id => this.items.delete(id),
      setInterval: (fn, ms) => this.add(fn, ms, ms),
      clearInterval: id => this.items.delete(id)
    };
    this.now = () => this.t;
  }

  add(fn, ms, every) {
    const id = ++this.seq;
    this.items.set(id, { at: this.t + Math.max(0, ms), fn, every });
    return id;
  }

  get pending() {
    return this.items.size;
  }

  advance(ms) {
    const end = this.t + ms;
    for (;;) {
      let next = null;
      for (const [id, it] of this.items) if (it.at <= end && (!next || it.at < next.it.at)) next = { id, it };
      if (!next) break;
      this.t = Math.max(this.t, next.it.at);
      if (next.it.every) next.it.at += next.it.every;
      else this.items.delete(next.id);
      next.it.fn();
    }
    this.t = end;
  }
}

/** Let promises and MessageChannel deliveries settle. */
export const flush = async (rounds = 6) => {
  for (let i = 0; i < rounds; i++) await new Promise(r => setImmediate(r));
};

/** A service worker as the page sees it. `info` is what it answers to "which build are you?" (null = never answers). */
export class FakeWorker extends EventTarget {
  constructor({ version = '2.2.0+bbbbbbbbbb', note = '', state = 'installing', answers = true } = {}) {
    super();
    this.state = state;
    this.info = { version, note, cache: `aeii-${version.split('+')[1]}` };
    this.answers = answers;
    this.received = [];
  }

  postMessage(msg, ports = []) {
    this.received.push(msg);
    if (msg?.type === 'aeii:get-info' && this.answers && ports[0]) ports[0].postMessage(this.info);
    this.onMessage?.(msg);
  }

  setState(state) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

export class FakeRegistration extends EventTarget {
  constructor() {
    super();
    this.installing = null;
    this.waiting = null;
    this.active = new FakeWorker({ state: 'activated', version: '2.1.0+aaaaaaaaaa' });
    this.updates = 0;
    this.onUpdate = null; // () => FakeWorker|null — what a server check would discover
    this.failUpdate = false;
    this.lateEvents = false; // true: update() answers only AFTER the install finished, and the "installed" event arrives later
  }

  async update() {
    this.updates++;
    if (this.failUpdate) throw new TypeError('Failed to fetch');
    const w = this.onUpdate?.();
    if (w && this.lateEvents) {
      this.dispatchEvent(Object.assign(new Event('updatefound'), { late: true }));
      w.state = 'installed'; // finished already…
      this.waiting = w;
      this.installing = null;
      setImmediate(() => w.dispatchEvent(new Event('statechange'))); // …but the event has not been delivered yet
    } else if (w) {
      this.installing = w;
      this.dispatchEvent(new Event('updatefound'));
    }
    return this;
  }
}

export class FakeContainer extends EventTarget {
  constructor({ controller = new FakeWorker({ state: 'activated' }) } = {}) {
    super();
    this.controller = controller;
    this.registration = new FakeRegistration();
    this.registered = [];
    this.failRegister = false;
  }

  async register(url, options) {
    this.registered.push({ url, options });
    if (this.failRegister) throw new Error('SecurityError');
    return this.registration;
  }

  switchTo(worker) {
    this.controller = worker;
    this.dispatchEvent(new Event('controllerchange'));
  }
}

export class FakeStorage {
  constructor() {
    this.data = new Map();
  }
  get(key, fallback = null) {
    return this.data.has(key) ? structuredClone(this.data.get(key)) : fallback;
  }
  set(key, value) {
    this.data.set(key, structuredClone(value));
  }
}

/** A page: document + window + reload counter. */
export function fakePage() {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const win = new EventTarget();
  const page = { doc, win, reloads: 0, reload: () => page.reloads++ };
  page.show = state => {
    doc.visibilityState = state;
    doc.dispatchEvent(new Event('visibilitychange'));
  };
  return page;
}
