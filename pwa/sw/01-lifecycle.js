// ---- install · activate · messages ---------------------------------------------------------------------------------------

self.addEventListener('install', event => {
  // Deliberately NO self.skipWaiting() here: a new build waits until the player agrees (or closes every window of the game).
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(PRECACHE.map(url => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(CACHE_PREFIX) && key !== VERSION && key !== MEDIA) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', event => {
  const data = event.data;
  // The bare string 'skipWaiting' is what releases before the update banner sent; keep answering it so their already-open pages can still update.
  const type = typeof data === 'string' ? data : data && data.type;
  if (type === MSG.SKIP_WAITING || type === 'skipWaiting') {
    self.skipWaiting();
  } else if (type === MSG.GET_INFO) {
    const reply = { version: BUILD, cache: VERSION, note: NOTE };
    const port = event.ports && event.ports[0];
    if (port) port.postMessage(reply);
    else if (event.source) event.source.postMessage({ type: MSG.GET_INFO, ...reply });
  }
});
