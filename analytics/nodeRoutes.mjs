// Plugs the statistics API into the Node server (node:http). Returns an async function (req, res) → true if it answered.
// Location comes from the host when it provides it (Cloudflare's CF-IPCountry); a bare VPS only knows the address.

import { FileStore } from './stores.mjs';
import { createAnalytics, LIMITS } from './handlers.mjs';

const readBody = (req, limit) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let over = false;
    req.on('data', c => {
      if (over) return; // already refused: let the rest of the upload drain away unread
      size += c.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        reject(new Error('too large'));
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

export function createAnalyticsRoutes({ dir, env = process.env, clientIp, store = new FileStore(dir) }) {
  const api = createAnalytics({ store, env });
  const send = (res, { status, json }) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...(status === 413 ? { Connection: 'close' } : {}) });
    res.end(json ? JSON.stringify(json) : undefined);
  };

  async function route(req, res) {
    const url = (req.url || '').split('?')[0];
    if (!url.startsWith('/api/')) return false;
    try {
      if (url === '/api/collect' && req.method === 'POST') {
        const country = String(req.headers['cf-ipcountry'] || '').toUpperCase();
        const geo = /^[A-Z]{2}$/.test(country) && country !== 'XX' ? { country } : null;
        send(res, await api.collect({ body: await readBody(req, LIMITS.body), ip: clientIp(req), geo, ua: req.headers['user-agent'] }));
      } else if (url === '/api/stats' && req.method === 'GET') {
        const days = new URL(req.url, 'http://x').searchParams.get('days');
        send(res, await api.stats({ authorization: req.headers.authorization, days }));
      } else if (url === '/api/forget' && req.method === 'POST') {
        send(res, await api.forget({ body: await readBody(req, 2048) }));
      } else send(res, { status: url.match(/^\/api\/(collect|stats|forget)$/) ? 405 : 404 });
    } catch (err) {
      send(res, { status: err.message === 'too large' ? 413 : 500 });
    }
    return true;
  }
  route.api = api;
  return route;
}
