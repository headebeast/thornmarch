// The four things the statistics API does, independent of any web framework:
//   collect  – a client reports a batch of events          (public; only counts if the client had consent)
//   stats    – the dashboard asks for a summary             (needs the admin token)
//   forget   – a visitor erases everything recorded for them (needs only their own random visitor id)
//   purge    – delete sessions older than the retention period (run daily)
// Each takes plain values and returns { status, json? } so the Netlify functions and the Node server can share it exactly.

import crypto from 'node:crypto';
import { LIMITS, parseBatch, newSession, applyBatch, summarize, dayKey, dayAgo } from './core.mjs';

const DAY = 24 * 3600 * 1000;

/** Constant-time comparison of two secrets (hashing first makes the lengths equal). */
function sameSecret(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function readConfig(env = {}) {
  const retention = Math.max(1, Math.min(365, Number(env.ANALYTICS_RETENTION_DAYS) || 90));
  return {
    token: env.ANALYTICS_TOKEN || '',
    fullIp: env.ANALYTICS_FULL_IP === '1' || env.ANALYTICS_FULL_IP === 'true', // keep the whole address instead of the masked one
    salt: env.ANALYTICS_SALT || env.ANALYTICS_TOKEN || 'thornmarch',
    retentionDays: retention
  };
}

export function createAnalytics({ store, env = {}, now = () => Date.now() }) {
  const cfg = readConfig(env);
  const buckets = new Map(); // ip -> { tokens, at }

  /** 30 requests in a burst, then one every two seconds, per address. */
  function allow(ip) {
    const t = now();
    const key = ip || 'unknown';
    let b = buckets.get(key);
    if (!b) {
      if (buckets.size > 5000) buckets.clear(); // a flood of fresh addresses must not grow memory without bound
      b = { tokens: 30, at: t };
      buckets.set(key, b);
    }
    b.tokens = Math.min(30, b.tokens + (t - b.at) / 2000);
    b.at = t;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  const authorised = header => !!cfg.token && /^Bearer /.test(header || '') && sameSecret(String(header).slice(7), cfg.token);

  return {
    config: cfg,

    async collect({ body, ip, geo, ua }) {
      if (!allow(ip)) return { status: 429 };
      const batch = parseBatch(body);
      if (!batch) return { status: 400 };
      const t = now();
      const day = dayKey(t);
      let session = (await store.get(day, batch.sid)) ?? (await store.get(dayAgo(t, 1), batch.sid)); // a session that crosses midnight stays in one document
      if (!session) session = newSession({ sid: batch.sid, vid: batch.vid, now: t, ip, geo, ua, fullIp: cfg.fullIp, salt: cfg.salt });
      else if (session.vid !== batch.vid) return { status: 400 }; // someone else's session id
      applyBatch(session, batch, t);
      await store.put(session.day, session.sid, session);
      return { status: 204 };
    },

    async stats({ authorization, days }) {
      if (!authorised(authorization)) return { status: 401 };
      const span = Math.max(1, Math.min(cfg.retentionDays, Math.round(Number(days)) || 30));
      const t = now();
      const keys = Array.from({ length: span }, (_, i) => dayAgo(t, i));
      return { status: 200, json: summarize(await store.list(keys), { now: t, days: span }) };
    },

    async forget({ body }) {
      let vid;
      try {
        vid = JSON.parse(body || '{}').vid;
      } catch {
        return { status: 400 };
      }
      if (typeof vid !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(vid)) return { status: 400 };
      if (!allow(`forget:${vid}`)) return { status: 429 };
      const t = now();
      let removed = 0;
      for (let i = 0; i <= cfg.retentionDays; i++) {
        const day = dayAgo(t, i);
        for (const s of await store.list([day])) {
          if (s.vid !== vid) continue;
          await store.remove(s.day, s.sid);
          removed++;
        }
      }
      return { status: 200, json: { removed } };
    },

    async purge() {
      const t = now();
      let removed = 0;
      // look a month past the cut-off so a missed run never leaves old data behind
      for (let i = cfg.retentionDays + 1; i <= cfg.retentionDays + 31; i++) {
        const day = dayAgo(t, i);
        for (const s of await store.list([day])) {
          await store.remove(s.day, s.sid);
          removed++;
        }
      }
      return { status: 200, json: { removed } };
    }
  };
}

export { LIMITS, DAY };
