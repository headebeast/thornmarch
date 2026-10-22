// Runs a generated service worker inside a Node `vm` with a fake network, fake Cache Storage and a way to deliver its
// events — so install / activate / fetch / message behaviour is tested on the real shipped code, no browser needed.

import vm from 'vm';

/** One named cache. Responses are stored as bytes + status + headers, like the real thing. */
class FakeCache {
  constructor(fetchFn) {
    this.entries = new Map(); // href -> { status, headers, body }
    this.fetchFn = fetchFn;
  }

  async addAll(requests) {
    const done = [];
    for (const req of requests) {
      const res = await this.fetchFn(req);
      if (!res.ok) throw new TypeError(`addAll: ${req.url} answered ${res.status}`); // like the real thing: one bad file fails the whole install
      done.push([req, res]);
    }
    for (const [req, res] of done) await this.put(req, res);
  }

  static href(req) {
    const u = new URL(typeof req === 'string' ? req : req.url, 'https://game.test');
    u.hash = '';
    return u.href;
  }

  async put(req, res) {
    this.entries.set(FakeCache.href(req), { status: res.status, headers: [...res.headers], body: Buffer.from(await res.arrayBuffer()) });
  }

  async match(req, opts = {}) {
    const want = new URL(FakeCache.href(req));
    for (const [href, e] of this.entries) {
      const got = new URL(href);
      if (opts.ignoreSearch) got.search = want.search = '';
      if (got.href === want.href) return new Response(e.status === 204 ? null : e.body, { status: e.status, headers: e.headers });
    }
    return undefined;
  }

  async delete(req) {
    return this.entries.delete(FakeCache.href(req));
  }

  async keys() {
    return [...this.entries.keys()].map(url => ({ url }));
  }
}

/** `fetchImpl(request) → Response` is the "network"; it may throw to simulate being offline. */
export function loadServiceWorker(source, { origin = 'https://game.test', fetchImpl }) {
  const listeners = new Map();
  const stores = new Map();
  const calls = { skipWaiting: 0, claim: 0, fetches: [] };
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new FakeCache(fetch));
      return stores.get(name);
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
    async has(name) {
      return stores.has(name);
    }
  };
  const self = {
    location: new URL(`${origin}/sw.js`),
    addEventListener: (type, fn) => listeners.set(type, fn),
    skipWaiting: () => void calls.skipWaiting++,
    clients: { claim: async () => void calls.claim++ }
  };
  const net = { online: true };
  const fetch = async req => {
    const request = typeof req === 'string' ? { url: new URL(req, origin).href, method: 'GET', headers: new Headers() } : req;
    calls.fetches.push(request.url);
    if (!net.online) throw new TypeError('Failed to fetch');
    const res = await fetchImpl(request);
    return Object.defineProperty(res, 'type', { value: 'basic' }); // a same-origin network answer, as a browser reports it
  };
  // a worker may write relative URLs ('/index.html'); in a browser they resolve against the worker's own address
  class WorkerRequest extends Request {
    constructor(input, init) {
      super(typeof input === 'string' ? new URL(input, origin).href : input, init);
    }
  }
  const context = vm.createContext({ self, caches, fetch, Request: WorkerRequest, Response, Headers, URL, console, Promise, Set, Map });
  vm.runInContext(source, context, { filename: 'sw.js' });

  /** Deliver an ExtendableEvent-like object and wait for everything the worker asked to wait for. */
  async function dispatch(type, event = {}) {
    const waits = [];
    const ev = { ...event, waitUntil: p => waits.push(p), respondWith: p => (ev.response = Promise.resolve(p)) };
    const fn = listeners.get(type);
    if (!fn) throw new Error(`service worker has no "${type}" listener`);
    fn(ev);
    // like a browser: the event stays alive while the answer is being built, and the worker may still call waitUntil() meanwhile
    let seen;
    do {
      seen = waits.length;
      await Promise.all(waits);
      if (ev.response) await ev.response.catch(() => {});
    } while (waits.length !== seen);
    return ev;
  }

  const fakeRequest = (path, { method = 'GET', mode = 'no-cors', headers = {} } = {}) => ({ url: new URL(path, origin).href, method, mode, headers: new Headers(headers) });
  return { dispatch, caches, stores, calls, net, listeners, fakeRequest, origin };
}
