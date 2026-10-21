// Small, dependency-free abuse limits for the multiplayer endpoint.

import fs from 'fs';
import { fileURLToPath } from 'url';

const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

/** Everything tunable about a deployment comes from environment variables, with safe defaults. */
export function readConfig(env = process.env) {
  const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  return {
    version: pkg.version,
    port: num(env.PORT, 3080),
    host: env.HOST || '0.0.0.0',
    staticDir: env.STATIC_DIR || '',
    // browsers sending an Origin header must be on this list (comma separated, e.g. https://play.example.com); the
    // server's own origin is always allowed. Leave empty to accept only same-origin browsers.
    allowedOrigins: String(env.ALLOWED_ORIGINS || '')
      .split(',')
      .map(s => s.trim().replace(/\/$/, ''))
      .filter(Boolean),
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true', // behind nginx / Render / Fly / Cloudflare
    maxClients: num(env.MAX_CLIENTS, 3000),
    maxPerIp: num(env.MAX_PER_IP, 24),
    maxRooms: num(env.MAX_ROOMS, 600),
    msgBurst: num(env.MSG_BURST, 40), // messages a client may send at once …
    msgPerSec: num(env.MSG_PER_SEC, 20), // … then this many per second, sustained
    // CSP_REPORT_ONLY=1: do not enforce the Content-Security-Policy, only log violations (POST /csp-report) — for trying a new
    // build or a new CDN in front of the game without risking a blank page
    cspReportOnly: env.CSP_REPORT_ONLY === '1' || env.CSP_REPORT_ONLY === 'true',
    pingMs: num(env.PING_MS, 25000),
    deadMs: num(env.DEAD_MS, 90000) // no sign of life (data or pong) for this long = gone
  };
}

/** Token bucket: `take()` is true while the client is within its allowance. */
export class TokenBucket {
  constructor(burst, perSec, now = Date.now) {
    this.burst = burst;
    this.perSec = perSec;
    this.now = now;
    this.tokens = burst;
    this.last = now();
  }
  take() {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.perSec);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** Counts live connections per address. */
export class IpCounter {
  constructor(max) {
    this.max = max;
    this.counts = new Map();
  }
  tryAdd(ip) {
    const n = this.counts.get(ip) || 0;
    if (n >= this.max) return false;
    this.counts.set(ip, n + 1);
    return true;
  }
  remove(ip) {
    const n = (this.counts.get(ip) || 1) - 1;
    if (n <= 0) this.counts.delete(ip);
    else this.counts.set(ip, n);
  }
}

/** The caller's address: the socket's, or the first X-Forwarded-For entry when a trusted proxy fronts the server. */
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || 'unknown';
}

/** May a browser on `origin` open a socket to a server answering at `host`? (Non-browser clients send no Origin.) */
export function originAllowed(origin, host, allowed) {
  if (!origin) return true;
  let u;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.host === host) return true; // same site as the page the server itself served
  return allowed.includes(u.origin);
}
