// Usage statistics — the pure part (no I/O, no framework): validate what clients send, enrich it, fold it into one small
// document per play session, and summarise sessions for the dashboard.
//
// Principles (they are also what public/privacy.html promises):
//   · only what the player agreed to share arrives here (the client sends nothing without consent)
//   · closed vocabulary: unknown event kinds and extra fields are dropped; every string is length-capped
//   · never names, chat text, moves, coordinates or anything typed — only labels of buttons/screens, counts and durations
//   · the IP address is masked (last IPv4 octet / last IPv6 groups removed) unless the operator explicitly keeps it, and a salted
//     hash of it is kept to tell visitors apart; location is city-level, from the host's own geo-IP lookup
//   · a session is one JSON document, so old data can be deleted by date and one visitor's data by id

import crypto from 'node:crypto';

export const LIMITS = {
  body: 32 * 1024, // bytes accepted per request
  events: 120, // events per request
  keys: 80, // distinct keys per counter map, per session (stops a hostile client bloating a document)
  sessionEvents: 6000, // events folded into one session in total
  errors: 5 // error messages kept per session
};

const ID = /^[A-Za-z0-9-]{8,64}$/;
const HOUR = 3600 * 1000;

const str = (v, n = 64) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
const int = (v, lo, hi) => {
  const n = num(v, lo, hi);
  return n === null ? null : Math.round(n);
};

/** UTC day key, e.g. "2026-10-21". */
export const dayKey = ms => new Date(ms).toISOString().slice(0, 10);
export const dayAgo = (ms, days) => dayKey(ms - days * 24 * HOUR);

// ---------------------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------------------
function cleanEvent(e) {
  if (!e || typeof e !== 'object') return null;
  switch (e.k) {
    case 'start':
      return { k: 'start' };
    case 'screen': {
      const name = str(e.name, 40);
      const ms = num(e.ms, 0, 6 * HOUR);
      return name && ms !== null ? { k: 'screen', name, ms } : null;
    }
    case 'click': {
      const id = str(e.id, 48);
      return id ? { k: 'click', id } : null;
    }
    case 'play': {
      const mode = str(e.mode, 24);
      if (!mode) return null;
      const cfg = {};
      if (e.cfg && typeof e.cfg === 'object') for (const key of Object.keys(e.cfg).slice(0, 6)) cfg[str(key, 16)] = str(String(e.cfg[key]), 24);
      return { k: 'play', mode, cfg };
    }
    case 'playEnd': {
      const mode = str(e.mode, 24);
      const ms = num(e.ms, 0, 12 * HOUR);
      if (!mode || ms === null) return null;
      const result = ['won', 'lost', 'draw', 'quit'].includes(e.result) ? e.result : 'quit';
      return { k: 'playEnd', mode, ms, result, rounds: int(e.rounds, 0, 5000), place: int(e.place, 1, 64) };
    }
    case 'scroll': {
      const where = str(e.where, 24);
      const n = int(e.n, 1, 5000);
      return where && n ? { k: 'scroll', where, n, depth: int(e.depth, 0, 100) } : null;
    }
    case 'active': {
      const ms = num(e.ms, 0, 120000);
      return ms === null ? null : { k: 'active', ms, play: num(e.play, 0, 120000) ?? 0 };
    }
    case 'fps': {
      const avg = num(e.avg, 0, 1000);
      return avg === null ? null : { k: 'fps', avg, min: num(e.min, 0, 1000) ?? avg };
    }
    case 'net': {
      const ping = num(e.ping, 0, 20000);
      return ping === null ? null : { k: 'net', ping, jitter: num(e.jitter, 0, 20000) ?? 0, loss: num(e.loss, 0, 100) ?? 0 };
    }
    case 'err': {
      const msg = str(e.msg, 140);
      return msg ? { k: 'err', msg } : null;
    }
    case 'end': {
      const ms = num(e.ms, 0, 24 * HOUR);
      return ms === null ? null : { k: 'end', ms };
    }
    default:
      return null;
  }
}

function cleanCtx(c) {
  if (!c || typeof c !== 'object') return null;
  return {
    ref: str(c.ref, 60),
    lang: str(c.lang, 12),
    tz: str(c.tz, 40),
    w: int(c.w, 0, 20000),
    h: int(c.h, 0, 20000),
    dpr: num(c.dpr, 0, 8),
    touch: !!c.touch,
    standalone: !!c.standalone,
    ver: str(c.ver, 24)
  };
}

/** Raw request body text → a clean batch, or null if it is not one of ours. Never throws. */
export function parseBatch(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > LIMITS.body) return null;
  let b;
  try {
    b = JSON.parse(text);
  } catch {
    return null;
  }
  if (!b || typeof b !== 'object' || b.v !== 1 || !ID.test(b.vid || '') || !ID.test(b.sid || '')) return null;
  const events = [];
  if (Array.isArray(b.events)) for (const raw of b.events.slice(0, LIMITS.events)) {
    const ev = cleanEvent(raw);
    if (ev) events.push(ev);
  }
  return { vid: b.vid, sid: b.sid, seq: int(b.seq, 0, 1e6) ?? 0, ctx: cleanCtx(b.ctx), events };
}

// ---------------------------------------------------------------------------------------------------------------------
// Enrichment: address, device
// ---------------------------------------------------------------------------------------------------------------------
/** 203.0.113.77 → 203.0.113.0 · 2001:db8:85a3:8d3:1319:8a2e:370:7348 → 2001:db8:85a3:: */
export function maskIp(ip) {
  if (typeof ip !== 'string' || !ip) return '';
  const v4 = ip.replace(/^::ffff:/i, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) return v4.replace(/\.\d{1,3}$/, '.0');
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':').replace(/:+$/, '') + '::';
  return '';
}

export function hashIp(ip, salt) {
  return crypto.createHash('sha256').update(`${salt}|${ip}`).digest('hex').slice(0, 16);
}

export function parseUa(ua = '') {
  const s = String(ua);
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /(Chrome|CriOS)\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Other';
  const os = /Windows/.test(s) ? 'Windows' : /(iPhone|iPad|iPod)/.test(s) ? 'iOS' : /Android/.test(s) ? 'Android' : /Mac OS X/.test(s) ? 'macOS' : /CrOS/.test(s) ? 'ChromeOS' : /Linux/.test(s) ? 'Linux' : 'Other';
  const device = /iPad|Tablet/.test(s) || (/Android/.test(s) && !/Mobile/.test(s)) ? 'tablet' : /Mobi|iPhone|Android/.test(s) ? 'phone' : 'desktop';
  return { browser, os, device };
}

/** Round to ~11 km: enough for "which part of the world", not "which street". */
const coarse = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

export function cleanGeo(g) {
  if (!g || typeof g !== 'object') return null;
  return { country: str(g.country, 2).toUpperCase(), countryName: str(g.countryName, 40), region: str(g.region, 40), city: str(g.city, 48), lat: coarse(g.lat), lon: coarse(g.lon), tz: str(g.tz, 40) };
}

// ---------------------------------------------------------------------------------------------------------------------
// One session = one document
// ---------------------------------------------------------------------------------------------------------------------
export function newSession({ sid, vid, now, ip, geo, ua, fullIp = false, salt = '' }) {
  return {
    v: 1,
    sid,
    vid,
    day: dayKey(now),
    first: now,
    last: now,
    ip: fullIp ? ip : maskIp(ip),
    ipHash: ip ? hashIp(ip, salt) : '',
    geo: cleanGeo(geo),
    ua: parseUa(ua),
    ctx: {},
    n: 0,
    batches: 0,
    activeMs: 0,
    playMs: 0,
    totalMs: 0,
    clicks: {},
    scrolls: {},
    screens: {},
    modes: {},
    fps: { n: 0, sum: 0, min: null },
    net: { n: 0, ping: 0, jitter: 0, loss: 0 },
    errs: []
  };
}

function bump(map, key, by = 1) {
  if (key in map) map[key] += by;
  else if (Object.keys(map).length < LIMITS.keys) map[key] = by;
}

/** Fold a clean batch into a session (mutates and returns it). */
export function applyBatch(session, batch, now) {
  session.batches++;
  session.last = now;
  if (batch.ctx && !('lang' in session.ctx)) Object.assign(session.ctx, batch.ctx); // the first batch describes the device; later ones do not repeat it
  for (const e of batch.events) {
    if (session.n >= LIMITS.sessionEvents) break;
    session.n++;
    switch (e.k) {
      case 'screen':
        bump(session.screens, e.name, Math.round(e.ms));
        break;
      case 'click':
        bump(session.clicks, e.id);
        break;
      case 'scroll':
        bump(session.scrolls, e.where, e.n);
        break;
      case 'play': {
        if (!(e.mode in session.modes) && Object.keys(session.modes).length >= 12) break;
        const m = (session.modes[e.mode] ??= { starts: 0, ends: 0, ms: 0, won: 0, lost: 0, draw: 0, quit: 0, rounds: 0, cfg: {} });
        m.starts++;
        for (const [k, v] of Object.entries(e.cfg)) bump(m.cfg, `${k}=${v}`);
        break;
      }
      case 'playEnd': {
        if (!(e.mode in session.modes) && Object.keys(session.modes).length >= 12) break;
        const m = (session.modes[e.mode] ??= { starts: 0, ends: 0, ms: 0, won: 0, lost: 0, draw: 0, quit: 0, rounds: 0, cfg: {} });
        m.ends++;
        m.ms += Math.round(e.ms);
        m[e.result]++;
        m.rounds += e.rounds ?? 0;
        break;
      }
      case 'active':
        session.activeMs += Math.round(e.ms);
        session.playMs += Math.round(Math.min(e.play, e.ms));
        break;
      case 'fps':
        session.fps.n++;
        session.fps.sum += e.avg;
        session.fps.min = session.fps.min === null ? e.min : Math.min(session.fps.min, e.min);
        break;
      case 'net':
        session.net.n++;
        session.net.ping += e.ping;
        session.net.jitter += e.jitter;
        session.net.loss += e.loss;
        break;
      case 'err':
        if (session.errs.length < LIMITS.errors) session.errs.push(e.msg);
        break;
      case 'end':
        session.totalMs = Math.max(session.totalMs, Math.round(e.ms));
        break;
      default:
        break; // 'start' carries nothing beyond ctx
    }
  }
  if (!session.totalMs) session.totalMs = session.last - session.first;
  return session;
}

// ---------------------------------------------------------------------------------------------------------------------
// Summaries for the dashboard
// ---------------------------------------------------------------------------------------------------------------------
const top = (map, n = 12) => Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([name, value]) => ({ name, value }));
const add = (map, key, by = 1) => {
  if (key) map[key] = (map[key] || 0) + by;
};
const min = ms => Math.round((ms / 60000) * 10) / 10;

export function summarize(sessions, { now = Date.now(), days = 30 } = {}) {
  const visitors = new Set();
  const perDay = {};
  const clicks = {};
  const screens = {};
  const scrolls = {};
  const countries = {};
  const cities = {};
  const browsers = {};
  const oses = {};
  const devices = {};
  const referrers = {};
  const langs = {};
  const modes = {};
  const errors = {};
  const fps = { n: 0, sum: 0, min: null };
  const net = { n: 0, ping: 0, jitter: 0, loss: 0 };
  let active = 0;
  let play = 0;
  let engaged = 0; // sessions with at least 30 s of real activity
  let players = new Set(); // visitors who started a match
  let clickTotal = 0;

  for (const s of sessions) {
    visitors.add(s.vid);
    const d = (perDay[s.day] ??= { day: s.day, sessions: 0, visitors: new Set(), activeMs: 0, playMs: 0 });
    d.sessions++;
    d.visitors.add(s.vid);
    d.activeMs += s.activeMs;
    d.playMs += s.playMs;
    active += s.activeMs;
    play += s.playMs;
    if (s.activeMs >= 30000) engaged++;
    for (const [k, v] of Object.entries(s.clicks)) {
      add(clicks, k, v);
      clickTotal += v;
    }
    for (const [k, v] of Object.entries(s.screens)) add(screens, k, v);
    for (const [k, v] of Object.entries(s.scrolls)) add(scrolls, k, v);
    if (s.geo?.country) add(countries, s.geo.countryName || s.geo.country);
    if (s.geo?.city) add(cities, `${s.geo.city}${s.geo.country ? `, ${s.geo.country}` : ''}`);
    add(browsers, s.ua?.browser);
    add(oses, s.ua?.os);
    add(devices, s.ua?.device);
    add(referrers, s.ctx?.ref || 'direct');
    add(langs, (s.ctx?.lang || '').slice(0, 2).toLowerCase());
    for (const [name, m] of Object.entries(s.modes)) {
      const a = (modes[name] ??= { mode: name, starts: 0, ends: 0, ms: 0, won: 0, lost: 0, draw: 0, quit: 0, rounds: 0, players: new Set() });
      a.starts += m.starts;
      a.ends += m.ends;
      a.ms += m.ms;
      a.won += m.won;
      a.lost += m.lost;
      a.draw += m.draw;
      a.quit += m.quit;
      a.rounds += m.rounds;
      if (m.starts) {
        a.players.add(s.vid);
        players.add(s.vid);
      }
    }
    if (s.fps.n) {
      fps.n += s.fps.n;
      fps.sum += s.fps.sum;
      fps.min = fps.min === null ? s.fps.min : Math.min(fps.min, s.fps.min);
    }
    if (s.net.n) {
      net.n += s.net.n;
      net.ping += s.net.ping;
      net.jitter += s.net.jitter;
      net.loss += s.net.loss;
    }
    for (const e of s.errs) add(errors, e);
  }

  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = dayAgo(now, i);
    const d = perDay[key];
    series.push({ day: key, sessions: d?.sessions ?? 0, visitors: d?.visitors.size ?? 0, activeMin: min(d?.activeMs ?? 0), playMin: min(d?.playMs ?? 0) });
  }
  const n = sessions.length;
  return {
    generated: now,
    days,
    totals: {
      sessions: n,
      visitors: visitors.size,
      players: players.size,
      avgSessionMin: n ? min(active / n) : 0, // active time (hands on the page), not tab-open time
      totalPlayMin: Math.round(play / 60000),
      avgPlayMinPerPlayer: players.size ? min(play / players.size) : 0,
      engagedPct: n ? Math.round((engaged / n) * 100) : 0,
      clicks: clickTotal,
      errors: Object.values(errors).reduce((a, b) => a + b, 0)
    },
    series,
    modes: Object.values(modes)
      .map(m => ({ mode: m.mode, starts: m.starts, finished: m.ends, players: m.players.size, playMin: Math.round(m.ms / 60000), avgMin: m.ends ? min(m.ms / m.ends) : 0, won: m.won, lost: m.lost, quit: m.quit, avgRounds: m.ends ? Math.round(m.rounds / m.ends) : 0 }))
      .sort((a, b) => b.starts - a.starts),
    clicks: top(clicks, 15),
    screens: top(screens, 14).map(x => ({ name: x.name, minutes: min(x.value) })),
    scrolls: top(scrolls, 8),
    countries: top(countries, 12),
    cities: top(cities, 12),
    browsers: top(browsers, 8),
    os: top(oses, 8),
    devices: top(devices, 4),
    referrers: top(referrers, 8),
    languages: top(langs, 8),
    performance: { samples: fps.n, avgFps: fps.n ? Math.round(fps.sum / fps.n) : null, lowestFps: fps.min === null ? null : Math.round(fps.min) },
    network: { samples: net.n, avgPing: net.n ? Math.round(net.ping / net.n) : null, avgJitter: net.n ? Math.round(net.jitter / net.n) : null, avgLossPct: net.n ? Math.round((net.loss / net.n) * 10) / 10 : null },
    errors: top(errors, 8),
    recent: sessions
      .slice()
      .sort((a, b) => b.last - a.last)
      .slice(0, 40)
      .map(s => ({
        at: s.first,
        ip: s.ip,
        where: [s.geo?.city, s.geo?.region, s.geo?.country].filter(Boolean).join(', ') || '—',
        device: s.ua ? `${s.ua.device} · ${s.ua.os} · ${s.ua.browser}` : '—',
        activeMin: min(s.activeMs),
        playMin: min(s.playMs),
        modes: Object.keys(s.modes).join(', '),
        clicks: Object.values(s.clicks).reduce((a, b) => a + b, 0)
      }))
  };
}
