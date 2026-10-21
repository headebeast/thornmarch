// Static file handler for the game client — zero dependencies, safe against hostile URLs.
//
//   · GET / HEAD only; malformed or escaping paths are rejected, never thrown
//   · ETag + If-None-Match (304s are nearly free), sensible Cache-Control per file kind
//   · gzip / brotli for text assets, compressed once and kept in memory until the file changes
//   · single-range requests (Safari will not play audio without them)
//   · security headers on every response (CSP, nosniff, frame, referrer, permissions)

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2'
};

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.webmanifest', '.txt', '.xml', '.svg']);
/** Files whose name does not change when their content does must be revalidated on every load (a 304 is cheap). */
const REVALIDATE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.webmanifest', '.txt', '.xml']);
const MAX_COMPRESS_BYTES = 4 * 1024 * 1024;

/** The Content-Security-Policy the game is built to run under (no inline script, no eval, no third parties). */
export function contentSecurityPolicy({ connect = [] } = {}) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // the UI sets inline styles from script
    "img-src 'self' data: blob:",
    "media-src 'self' blob: data:",
    "font-src 'self'",
    ["connect-src 'self' ws: wss:", ...connect].join(' '),
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'"
  ].join('; ');
}

export function securityHeaders(csp, reportOnly = false) {
  return {
    [reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy']: reportOnly ? `${csp}; report-uri /csp-report` : csp,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin'
  };
}

export function createStaticHandler({ dir, csp = contentSecurityPolicy(), reportOnly = false, log = () => {} }) {
  const root = path.resolve(dir);
  const headersCommon = securityHeaders(csp, reportOnly);
  const compressed = new Map(); // file -> { stamp, gzip, br }

  /** Resolve a request path to a file inside `root`, or null. Never throws. */
  function resolve(rawPath) {
    let pathname;
    try {
      pathname = decodeURIComponent(rawPath);
    } catch {
      return { status: 400 };
    }
    if (pathname.includes('\0')) return { status: 400 };
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.resolve(root, '.' + path.posix.normalize('/' + pathname));
    const rel = path.relative(root, file);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return { status: 403 };
    return { file };
  }

  async function compress(file, stamp, raw, accept) {
    let entry = compressed.get(file);
    if (!entry || entry.stamp !== stamp) {
      entry = { stamp, gzip: null, br: null };
      compressed.set(file, entry);
    }
    if (/\bbr\b/.test(accept)) {
      entry.br ??= await new Promise((res, rej) => zlib.brotliCompress(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 8 } }, (e, b) => (e ? rej(e) : res(b))));
      return { body: entry.br, encoding: 'br' };
    }
    if (/\bgzip\b/.test(accept)) {
      entry.gzip ??= await new Promise((res, rej) => zlib.gzip(raw, { level: 9 }, (e, b) => (e ? rej(e) : res(b))));
      return { body: entry.gzip, encoding: 'gzip' };
    }
    return null;
  }

  function finish(res, status, headers = {}, body = '') {
    res.writeHead(status, { ...headersCommon, ...headers });
    res.end(body);
  }

  return async function handle(req, res) {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return finish(res, 405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain' }, 'Method not allowed');
      const q = req.url.indexOf('?');
      const hit = resolve(q < 0 ? req.url : req.url.slice(0, q));
      if (hit.status) return finish(res, hit.status, { 'Content-Type': 'text/plain' }, hit.status === 403 ? 'Forbidden' : 'Bad request');

      let file = hit.file;
      let stat = await fs.promises.stat(file).catch(() => null);
      if (stat?.isDirectory()) {
        file = path.join(file, 'index.html');
        stat = await fs.promises.stat(file).catch(() => null);
      }
      if (!stat || !stat.isFile()) return finish(res, 404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' }, 'Not found');

      const ext = path.extname(file).toLowerCase();
      const type = MIME[ext] || 'application/octet-stream';
      const stamp = `${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}`;
      const etag = `W/"${stamp}"`;
      const cache = REVALIDATE.has(ext) ? 'no-cache' : 'public, max-age=86400';
      const base = { 'Content-Type': type, ETag: etag, 'Cache-Control': cache, Vary: 'Accept-Encoding', 'Last-Modified': stat.mtime.toUTCString() };

      if (req.headers['if-none-match'] === etag) return finish(res, 304, base);

      const accept = String(req.headers['accept-encoding'] || '');
      if (COMPRESSIBLE.has(ext) && stat.size <= MAX_COMPRESS_BYTES && accept) {
        const raw = await fs.promises.readFile(file);
        const packed = await compress(file, stamp, raw, accept);
        if (packed) {
          res.writeHead(200, { ...headersCommon, ...base, 'Content-Encoding': packed.encoding, 'Content-Length': packed.body.length });
          return res.end(req.method === 'HEAD' ? undefined : packed.body);
        }
        res.writeHead(200, { ...headersCommon, ...base, 'Content-Length': raw.length });
        return res.end(req.method === 'HEAD' ? undefined : raw);
      }

      // byte ranges (audio seeking, Safari) — one range only
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
      if (range && (range[1] || range[2])) {
        let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
        let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
        end = Math.min(end, stat.size - 1);
        start = Math.max(0, start);
        if (start > end || start >= stat.size) return finish(res, 416, { 'Content-Range': `bytes */${stat.size}` });
        res.writeHead(206, { ...headersCommon, ...base, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
        if (req.method === 'HEAD') return res.end();
        return fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
      }

      res.writeHead(200, { ...headersCommon, ...base, 'Accept-Ranges': 'bytes', 'Content-Length': stat.size });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch (err) {
      log('static handler error', err);
      if (!res.headersSent) finish(res, 500, { 'Content-Type': 'text/plain' }, 'Server error');
      else res.destroy();
    }
  };
}
