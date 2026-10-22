// ---- answering requests --------------------------------------------------------------------------------------------------

self.addEventListener('fetch', event => {
  const request = event.request;
  const kind = route(request, new URL(request.url));
  if (kind === 'app') event.respondWith(serveApp(event, request));
  else if (kind === 'media') event.respondWith(serveMedia(event, request));
});

/** Game files and pages: this build's snapshot first, the network for anything not in it, the start page for offline navigations. */
async function serveApp(event, request) {
  const cache = await caches.open(VERSION);
  // ignoreVary: the stored copy and the live request can differ in harmless headers (Accept-Encoding); that must never turn an offline visit into an error
  const hit = await cache.match(request, { ignoreSearch: request.mode === 'navigate', ignoreVary: true });
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res.ok && res.type === 'basic' && !PRECACHE.includes(new URL(request.url).pathname)) event.waitUntil(cache.put(request, res.clone()));
    return res;
  } catch (err) {
    if (request.mode === 'navigate') {
      const start = await cache.match('/', { ignoreVary: true });
      if (start) return start;
    }
    throw err;
  }
}

const storing = new Set(); // music files being saved right now

/** Music: from the music cache when saved (works offline, supports seeking); otherwise streamed as usual and saved for next time. */
async function serveMedia(event, request) {
  const cache = await caches.open(MEDIA);
  const url = new URL(request.url).pathname;
  const hit = await cache.match(url, { ignoreVary: true });
  if (hit) {
    const range = request.headers.get('range');
    return range ? rangeResponse(hit, range) : hit;
  }
  event.waitUntil(storeMedia(cache, url));
  return fetch(request);
}

async function storeMedia(cache, url) {
  if (storing.has(url)) return;
  storing.add(url);
  try {
    const res = await fetch(url); // the complete file, not a piece
    if (res.ok && res.status === 200 && res.type === 'basic') await cache.put(url, res);
  } catch (_) {
    /* offline or interrupted: it will be tried again the next time the track is requested */
  } finally {
    storing.delete(url);
  }
}
