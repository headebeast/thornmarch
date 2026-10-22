// ---- which requests are ours ---------------------------------------------------------------------------------------------

/** 'skip' (leave it to the browser) · 'media' (music) · 'app' (the game's own files and pages). */
function route(request, url) {
  if (request.method !== 'GET' || url.origin !== self.location.origin) return 'skip';
  if (NEVER_PATHS.includes(url.pathname) || NEVER_PREFIXES.some(p => url.pathname.startsWith(p))) return 'skip';
  if (url.pathname.startsWith(MEDIA_PATH)) return 'media';
  if (request.headers.get('range')) return 'skip'; // only music is served in pieces
  return 'app';
}
