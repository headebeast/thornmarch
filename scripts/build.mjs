// Production build: public/ → dist/  (a folder you can upload anywhere — no bundler, no dependencies).
//
//   node scripts/build.mjs [--out dist]
//
// Settings come from environment variables (all optional):
//   SITE_URL    https://play.example.com   absolute URL of the page → canonical link, og:url, absolute share-image URL
//   SERVER_URL  wss://game.example.com     where the multiplayer server lives ("" = same host as the page)
//   ONLINE      off                        hide online play (use on a static-only host)
//   SOURCE_URL  https://github.com/you/x   where the source code is published (shown in About — the GPL asks for it)
//
// What it does: copies the client; writes the brand (name, description) from js/config/brand.js into index.html and the
// web manifest; stamps the version + a content hash; generates a service worker whose cache name IS that hash and that
// pre-caches the whole game as one consistent snapshot (so an update can never mix old and new files); writes
// _headers (Netlify / Cloudflare Pages), robots.txt and sitemap.xml; and prints a size report.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const args = process.argv.slice(2);
const OUT = path.resolve(ROOT, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'dist');
const env = process.env;
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const { BRAND, brandTitle } = await import(pathToFileURL(path.join(PUBLIC, 'js/config/brand.js')).href);
const { contentSecurityPolicy } = await import(pathToFileURL(path.join(ROOT, 'server/staticFiles.mjs')).href);

const SITE_URL = (env.SITE_URL || '').replace(/\/$/, '');
const SERVER_URL = (env.SERVER_URL || '').replace(/\/$/, '');
const ONLINE = env.ONLINE === 'off' ? 'off' : 'on';
const SOURCE_URL = env.SOURCE_URL || '';
const esc = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// ---- 1. copy -----------------------------------------------------------------------------------------------------
fs.rmSync(OUT, { recursive: true, force: true });
const files = [];
(function walk(dir, rel = '') {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'Thumbs.db') continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), r);
    else files.push(r);
  }
})(PUBLIC);
for (const f of files) {
  fs.mkdirSync(path.dirname(path.join(OUT, f)), { recursive: true });
  fs.copyFileSync(path.join(PUBLIC, f), path.join(OUT, f));
}

// ---- 2. content hash (everything the player downloads, in a fixed order) -----------------------------------------------
const hash = crypto.createHash('sha256');
for (const f of files.slice().sort()) if (f !== 'sw.js' && f !== 'index.html' && f !== 'manifest.webmanifest') hash.update(f).update(fs.readFileSync(path.join(PUBLIC, f)));
hash.update(JSON.stringify({ BRAND, SITE_URL, SERVER_URL, ONLINE, SOURCE_URL, v: pkg.version }));
hash.update(fs.readFileSync(path.join(PUBLIC, 'index.html')));
const stamp = hash.digest('hex').slice(0, 10);
const version = `${pkg.version}+${stamp}`;

// ---- 3. index.html: brand, previews, deployment settings ---------------------------------------------------------------
let html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const title = brandTitle();
const setMeta = (name, value, attr = 'name') => {
  const re = new RegExp(`(<meta ${attr}="${name}" content=")[^"]*(")`);
  if (!re.test(html)) throw new Error(`index.html has no <meta ${attr}="${name}">`);
  html = html.replace(re, `$1${esc(value)}$2`);
};
html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
setMeta('description', BRAND.description);
setMeta('og:title', title, 'property');
setMeta('og:description', BRAND.description, 'property');
setMeta('twitter:title', title);
setMeta('twitter:description', BRAND.description);
html = html.replace(/(<div id="loading-overlay">\s*<h2>)[^<]*(<\/h2>)/, `$1${esc(BRAND.name.toUpperCase())} ${esc(BRAND.edition.split(' ')[0].toUpperCase())}$2`);
setMeta('aeii-version', version);
setMeta('aeii-server', SERVER_URL);
setMeta('aeii-online', ONLINE);
setMeta('aeii-source', SOURCE_URL);
const shareUrl = `${SITE_URL}/assets/icons/share.png`;
setMeta('og:image', shareUrl, 'property');
setMeta('twitter:image', shareUrl);
if (SITE_URL) {
  html = html.replace('</head>', `  <link rel="canonical" href="${esc(SITE_URL)}/" />\n  <meta property="og:url" content="${esc(SITE_URL)}/" />\n</head>`);
}
fs.writeFileSync(path.join(OUT, 'index.html'), html);

// ---- 4. web manifest ---------------------------------------------------------------------------------------------------
const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'manifest.webmanifest'), 'utf8'));
manifest.name = title;
manifest.short_name = BRAND.shortName;
manifest.description = BRAND.description;
manifest.id = '/';
fs.writeFileSync(path.join(OUT, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

// ---- 5. service worker: one versioned, pre-cached snapshot --------------------------------------------------------------
// Audio is streamed with byte-range requests (which a cache cannot answer) and is large, so it is left to the browser's HTTP
// cache; everything else the game needs is pre-cached so it opens offline and never mixes versions.
const precache = ['/', ...files.filter(f => !/^assets\/audio\//.test(f) && !['sw.js', 'LICENSE.txt', 'CREDITS.txt', 'assets/icons/share.png'].includes(f)).map(f => `/${f}`)].sort();
const sw = `// GENERATED by scripts/build.mjs — do not edit (the template is inside the build script).
// Cache name = hash of the shipped files: a new deploy is a new cache, installed whole, switched on when the old tabs close.

const VERSION = 'aeii-${stamp}';
const PRECACHE = ${JSON.stringify(precache)};

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION).then(cache => cache.addAll(PRECACHE.map(url => new Request(url, { cache: 'reload' }))))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('aeii-') && k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  // Only same-site GETs for the game's own files. Never the multiplayer socket, the health probe, or byte-range media.
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname === '/ws' || url.pathname === '/healthz' || req.headers.has('range')) return;
  event.respondWith(
    caches.open(VERSION).then(async cache => {
      const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok && res.type === 'basic' && !PRECACHE.includes(url.pathname)) cache.put(req, res.clone());
        return res;
      } catch (err) {
        if (req.mode === 'navigate') return (await cache.match('/')) || Response.error();
        throw err;
      }
    })
  );
});
`;
fs.writeFileSync(path.join(OUT, 'sw.js'), sw);

// ---- 6. hosting files ---------------------------------------------------------------------------------------------------
const csp = contentSecurityPolicy({ connect: SERVER_URL ? [SERVER_URL.replace(/^http/, 'ws'), SERVER_URL.replace(/^ws/, 'http')] : [] });
fs.writeFileSync(
  path.join(OUT, '_headers'),
  `# Netlify / Cloudflare Pages. Other hosts: copy these into your server or CDN configuration.
/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin

# code and data: always revalidate (the ETag makes that a cheap 304) so a deploy shows up immediately
/
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/sw.js
  Cache-Control: no-cache
/manifest.webmanifest
  Content-Type: application/manifest+json; charset=utf-8
  Cache-Control: no-cache
/js/*
  Cache-Control: no-cache
/css/*
  Cache-Control: no-cache
/data/*
  Cache-Control: no-cache

# art, audio and fonts change rarely
/assets/*
  Cache-Control: public, max-age=86400
`
);
fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n${SITE_URL ? `Sitemap: ${SITE_URL}/sitemap.xml\n` : ''}`);
if (SITE_URL) fs.writeFileSync(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE_URL}/</loc></url></urlset>\n`);
fs.writeFileSync(path.join(OUT, 'version.json'), JSON.stringify({ name: pkg.name, version, built: new Date().toISOString() }, null, 2));

// ---- 7. report ----------------------------------------------------------------------------------------------------------
let raw = 0;
let gz = 0;
let preBytes = 0;
const all = [...files, 'sw.js', '_headers', 'robots.txt', 'version.json'];
for (const f of all) {
  const buf = fs.readFileSync(path.join(OUT, f));
  raw += buf.length;
  if (/\.(js|css|json|html|svg|webmanifest|txt)$/.test(f)) gz += zlib.gzipSync(buf).length;
  else gz += buf.length;
  if (precache.includes(`/${f}`)) preBytes += buf.length;
}
const mb = n => (n / 1024 / 1024).toFixed(2);
console.log(`Built ${brandTitle()} v${version}`);
console.log(`  ${all.length} files → ${path.relative(process.cwd(), OUT) || OUT}   ${mb(raw)} MB raw, about ${mb(gz)} MB over the wire (gzip)`);
console.log(`  offline snapshot: ${precache.length} files, ${mb(preBytes)} MB   (music streams on demand)`);
console.log(`  server ${SERVER_URL || '(same host)'} · online ${ONLINE} · source ${SOURCE_URL || '(not set — set SOURCE_URL before publishing)'} · site ${SITE_URL || '(not set)'}`);
