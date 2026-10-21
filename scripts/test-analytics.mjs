// Tests for the usage-statistics system: validation, privacy rules, aggregation, auth, erasure, retention, abuse limits,
// storage, and the real HTTP routes of the Node server.
//   node scripts/test-analytics.mjs

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseBatch, maskIp, hashIp, parseUa, newSession, applyBatch, summarize, dayKey, dayAgo, LIMITS } from '../analytics/core.mjs';
import { createAnalytics } from '../analytics/handlers.mjs';
import { MemoryStore, FileStore } from '../analytics/stores.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
let checks = 0;
const check = (ok, msg) => {
  checks++;
  if (!ok) failures++;
  console.log(ok ? `  ✓ ${msg}` : `  ✗ FAIL: ${msg}`);
};
const section = t => console.log(`\n== ${t}`);

const VID = 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb';
const SID = 'cccccccc-1111-4222-8333-dddddddddddd';
const batch = (events, extra = {}) => JSON.stringify({ v: 1, vid: VID, sid: SID, seq: 0, events, ...extra });

// ---------------------------------------------------------------------------------------------------------------------
section('Validation');
check(parseBatch('not json') === null && parseBatch('') === null && parseBatch(null) === null, 'garbage and empty bodies are rejected');
check(parseBatch(JSON.stringify({ v: 2, vid: VID, sid: SID, events: [] })) === null, 'an unknown protocol version is rejected');
check(parseBatch(JSON.stringify({ v: 1, vid: 'short', sid: SID, events: [] })) === null && parseBatch(JSON.stringify({ v: 1, vid: VID, sid: '../../etc', events: [] })) === null, 'visitor / session ids must look like ids (no path tricks)');
check(parseBatch('x'.repeat(LIMITS.body + 1)) === null, 'an oversized body is rejected');
const p = parseBatch(batch([
  { k: 'click', id: '  Battle   Royale<script>  ' },
  { k: 'hack', id: 'x' },
  { k: 'click' },
  { k: 'screen', name: 'menu', ms: 5000 },
  { k: 'screen', name: 'menu', ms: -5 },
  { k: 'play', mode: 'royale', cfg: { players: 20, ['a'.repeat(40)]: 1, secret: { nested: 'object' } } },
  { k: 'playEnd', mode: 'royale', ms: 90000, result: 'cheated', rounds: 61 },
  { k: 'fps', avg: 59.4, min: 31 },
  { k: 'active', ms: 1e12, play: -4 },
  { k: 'err', msg: 'TypeError: x is not a function\nat file.js:3' },
  42,
  null
]));
check(p.events.length === 8, `unknown kinds, missing fields and non-objects are dropped (${p.events.length} of 12 kept)`);
check(p.events[0].id === 'Battle Royale script' && !/[<>]/.test(p.events[0].id), 'labels are cleaned: whitespace collapsed, angle brackets removed');
check(p.events.find(e => e.k === 'playEnd').result === 'quit', 'an unknown result becomes "quit"');
check(p.events.find(e => e.k === 'active').ms === 120000 && p.events.find(e => e.k === 'active').play === 0, 'numbers are clamped to sane ranges');
check(Object.keys(p.events.find(e => e.k === 'play').cfg).length <= 3 && typeof p.events.find(e => e.k === 'play').cfg.players === 'string', 'play config keeps only short scalar values');
check(parseBatch(batch(Array.from({ length: 500 }, () => ({ k: 'click', id: 'x' })))).events.length === LIMITS.events, `at most ${LIMITS.events} events per request`);

// ---------------------------------------------------------------------------------------------------------------------
section('Privacy rules');
check(maskIp('203.0.113.77') === '203.0.113.0', 'IPv4: last octet removed');
check(maskIp('::ffff:198.51.100.9') === '198.51.100.0', 'IPv4 inside IPv6 is masked as IPv4');
check(maskIp('2001:db8:85a3:8d3:1319:8a2e:370:7348') === '2001:db8:85a3::', 'IPv6: everything after the first three groups removed');
check(maskIp('') === '' && maskIp('nonsense') === '', 'bad input gives an empty string');
check(hashIp('203.0.113.77', 'salt') === hashIp('203.0.113.77', 'salt') && hashIp('203.0.113.77', 'salt') !== hashIp('203.0.113.78', 'salt') && hashIp('203.0.113.77', 'a') !== hashIp('203.0.113.77', 'b'), 'IP hash is stable, distinguishes addresses, and depends on the salt');
const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const geo = { country: 'iq', countryName: 'Iraq', city: 'Erbil', region: 'Erbil Governorate', lat: 36.19123, lon: 44.00911, tz: 'Asia/Baghdad' };
const sMasked = newSession({ sid: SID, vid: VID, now: NOW, ip: '203.0.113.77', geo, ua: 'x', salt: 's' });
check(sMasked.ip === '203.0.113.0' && !JSON.stringify(sMasked).includes('203.0.113.77'), 'the stored session never contains the full address by default');
check(sMasked.geo.country === 'IQ' && sMasked.geo.lat === 36.2 && sMasked.geo.lon === 44, 'location is city-level and coordinates are rounded to about 11 km');
const sFull = newSession({ sid: SID, vid: VID, now: NOW, ip: '203.0.113.77', geo, ua: 'x', fullIp: true, salt: 's' });
check(sFull.ip === '203.0.113.77', 'the full address is kept only when the operator explicitly asks (ANALYTICS_FULL_IP)');
const ua = parseUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
check(ua.device === 'phone' && ua.os === 'iOS' && ua.browser === 'Safari', 'user agent → coarse device / OS / browser only (the raw string is not stored)');
check(!('ua' in { ...sMasked, ua: undefined }) || typeof sMasked.ua === 'object', 'the session holds the parsed device, not the raw user-agent');

// ---------------------------------------------------------------------------------------------------------------------
section('Aggregation');
const s = newSession({ sid: SID, vid: VID, now: NOW, ip: '203.0.113.77', geo, ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537', salt: 's' });
const first = parseBatch(batch([{ k: 'start' }, { k: 'click', id: 'menu:Battle Royale' }, { k: 'click', id: 'menu:Battle Royale' }, { k: 'click', id: 'tool:fit' }, { k: 'screen', name: 'menu', ms: 20000 }, { k: 'play', mode: 'royale', cfg: { players: 20 } }, { k: 'scroll', where: 'map-zoom', n: 14, depth: null }], { ctx: { ref: 'discord.com', lang: 'en-US', tz: 'Asia/Baghdad', w: 1920, h: 1080, dpr: 1, touch: false, ver: '2.1.0' } }));
applyBatch(s, first, NOW + 1000);
const second = parseBatch(batch([{ k: 'active', ms: 15000, play: 15000 }, { k: 'active', ms: 15000, play: 0 }, { k: 'fps', avg: 58, min: 40 }, { k: 'fps', avg: 62, min: 55 }, { k: 'net', ping: 40, jitter: 4, loss: 0 }, { k: 'net', ping: 60, jitter: 6, loss: 2 }, { k: 'playEnd', mode: 'royale', ms: 600000, result: 'won', rounds: 55 }, { k: 'end', ms: 900000 }, { k: 'err', msg: 'oops' }]));
applyBatch(s, second, NOW + 900000);
check(s.clicks['menu:Battle Royale'] === 2 && s.clicks['tool:fit'] === 1, 'clicks are counted per labelled control');
check(s.screens.menu === 20000 && s.scrolls['map-zoom'] === 14, 'screen dwell time and scroll counts accumulate');
check(s.activeMs === 30000 && s.playMs === 15000 && s.totalMs === 900000, 'active time, play time and total time accumulate');
check(s.modes.royale.starts === 1 && s.modes.royale.won === 1 && s.modes.royale.ms === 600000 && s.modes.royale.cfg['players=20'] === 1, 'a match is tracked from start to result');
check(s.fps.n === 2 && s.fps.sum === 120 && s.fps.min === 40 && s.net.n === 2 && s.net.ping === 100 && s.net.loss === 2, 'frame rate and connection samples are summed');
check(s.ctx.lang === 'en-US' && s.ctx.ref === 'discord.com', 'the device description from the first batch is kept');
// a hostile client cannot bloat a document
const bloat = newSession({ sid: SID, vid: VID, now: NOW, ip: '1.2.3.4', ua: '', salt: 's' });
for (let b = 0; b < 40; b++) applyBatch(bloat, parseBatch(batch(Array.from({ length: 100 }, (_, i) => ({ k: 'click', id: `spam-${b}-${i}` })))), NOW);
check(Object.keys(bloat.clicks).length <= LIMITS.keys && bloat.n <= LIMITS.sessionEvents, `distinct counter keys capped at ${LIMITS.keys}, events per session at ${LIMITS.sessionEvents}`);
check(JSON.stringify(bloat).length < 20000, `a hostile session stays small (${JSON.stringify(bloat).length} bytes)`);

const sum = summarize([s, { ...s, sid: 'second-session-1', vid: 'visitor-two-aaaa', day: dayAgo(NOW, 1), activeMs: 60000, playMs: 0, modes: {}, clicks: { 'tool:fit': 4 }, geo: { ...geo, city: 'Berlin', country: 'DE', countryName: 'Germany' } }], { now: NOW, days: 7 });
check(sum.totals.sessions === 2 && sum.totals.visitors === 2 && sum.totals.players === 1, 'summary counts sessions, visitors and players');
check(sum.totals.avgSessionMin === 0.8 && sum.totals.totalPlayMin === 0, `average active time per session: ${sum.totals.avgSessionMin} min`);
check(sum.series.length === 7 && sum.series.at(-1).day === dayKey(NOW) && sum.series.at(-1).sessions === 1 && sum.series.at(-2).sessions === 1, 'the daily series covers the whole range, empty days included');
check(sum.clicks[0].name === 'tool:fit' && sum.clicks[0].value === 5, 'top clicks are ranked');
check(sum.modes[0].mode === 'royale' && sum.modes[0].won === 1 && sum.modes[0].avgMin === 10, 'per-mode figures: starts, wins, average minutes');
check(sum.countries.length === 2 && sum.performance.avgFps === 60 && sum.network.avgPing === 50, 'countries, average FPS and ping');
check(sum.recent[0].ip === '203.0.113.0' && /Erbil/.test(sum.recent[0].where), 'the recent-visitors list shows the masked address and the city');
check(!JSON.stringify(sum).includes('203.0.113.77') && !JSON.stringify(sum).includes('ipHash') && !JSON.stringify(sum).includes(VID), 'the summary contains no full IP, no IP hash and no visitor ids');

// ---------------------------------------------------------------------------------------------------------------------
section('Handlers: collect, stats, forget, purge');
let clock = NOW;
const store = new MemoryStore();
const api = createAnalytics({ store, env: { ANALYTICS_TOKEN: 'secret-token', ANALYTICS_RETENTION_DAYS: '30' }, now: () => clock });
const post = (body, ip = '203.0.113.77') => api.collect({ body, ip, geo, ua: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/120.0' });
check((await post('garbage')).status === 400, 'collect: garbage → 400');
check((await post(batch([{ k: 'start' }, { k: 'click', id: 'a' }]))).status === 204, 'collect: a good batch → 204');
check((await post(batch([{ k: 'click', id: 'a' }]))).status === 204 && (await store.list([dayKey(NOW)])).length === 1, 'a second batch joins the same session document');
check((await api.collect({ body: JSON.stringify({ v: 1, vid: 'someone-else-xxxx', sid: SID, events: [{ k: 'click', id: 'x' }] }), ip: '1.1.1.1', ua: '' })).status === 400, 'a session id cannot be hijacked by another visitor id');
check((await api.stats({ authorization: '', days: 7 })).status === 401 && (await api.stats({ authorization: 'Bearer wrong', days: 7 })).status === 401 && (await api.stats({ authorization: 'secret-token', days: 7 })).status === 401, 'stats: no token, wrong token, or a token without "Bearer" → 401');
const open = createAnalytics({ store, env: {}, now: () => clock });
check((await open.stats({ authorization: 'Bearer ', days: 7 })).status === 401, 'stats: with no ANALYTICS_TOKEN configured nothing can ever read the data');
const good = await api.stats({ authorization: 'Bearer secret-token', days: 7 });
check(good.status === 200 && good.json.totals.sessions === 1 && good.json.clicks[0].value === 2, 'stats: the right token returns the summary');
check((await api.stats({ authorization: 'Bearer secret-token', days: 9999 })).json.days === 30, 'stats: the range is capped at the retention period');
// midnight rollover keeps one document
clock = NOW + 13 * 3600 * 1000;
check((await post(batch([{ k: 'click', id: 'b' }]))).status === 204 && (await store.list([dayKey(NOW), dayKey(clock)])).length === 1, 'a session that crosses midnight stays one document');
// rate limit
let limited = 0;
for (let i = 0; i < 60; i++) if ((await post(batch([{ k: 'click', id: 'x' }]), '198.51.100.5')).status === 429) limited++;
check(limited >= 25, `a flood from one address is throttled (${limited} of 60 refused)`);
check((await post(batch([{ k: 'click', id: 'x' }]), '198.51.100.6')).status === 204, '…while other addresses are unaffected');
// forget
const OTHER = 'ffffffff-1111-4222-8333-eeeeeeeeeeee';
await api.collect({ body: JSON.stringify({ v: 1, vid: OTHER, sid: 'dddddddd-2222-4222-8333-cccccccccccc', events: [{ k: 'click', id: 'mine' }] }), ip: '9.9.9.9', ua: '' });
const before = (await store.list([dayKey(NOW), dayKey(clock)])).length;
check((await api.forget({ body: '{"vid":"bad"}' })).status === 400 && (await api.forget({ body: 'nope' })).status === 400, 'forget: a malformed id → 400');
const fr = await api.forget({ body: JSON.stringify({ vid: VID }) });
const after = await store.list([dayKey(NOW), dayKey(clock)]);
check(fr.status === 200 && fr.json.removed >= 1 && after.every(d => d.vid !== VID) && after.some(d => d.vid === OTHER) && after.length < before, `forget: erased this visitor's data (${fr.json.removed} sessions) and nobody else's`);
// purge
const old = newSession({ sid: 'old-session-aaaa', vid: 'old-visitor-aaaa', now: clock - 40 * 24 * 3600 * 1000, ip: '', ua: '', salt: 's' });
await store.put(old.day, old.sid, old);
const fresh = newSession({ sid: 'new-session-aaaa', vid: 'new-visitor-aaaa', now: clock - 5 * 24 * 3600 * 1000, ip: '', ua: '', salt: 's' });
await store.put(fresh.day, fresh.sid, fresh);
const pr = await api.purge();
check(pr.json.removed === 1 && !(await store.get(old.day, old.sid)) && !!(await store.get(fresh.day, fresh.sid)), 'purge: sessions older than the retention period are deleted, recent ones kept');

// ---------------------------------------------------------------------------------------------------------------------
section('File store');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aeii-analytics-'));
const fsStore = new FileStore(dir);
await fsStore.put('2026-10-21', 'abc-123-def', { sid: 'abc-123-def', vid: VID, day: '2026-10-21', x: 1 });
check((await fsStore.get('2026-10-21', 'abc-123-def')).x === 1 && (await fsStore.list(['2026-10-21', '2026-10-20'])).length === 1, 'a document round-trips through disk');
let threw = false;
try {
  await fsStore.put('..', '..%2f', {});
} catch {
  threw = true;
}
check(threw && (await fsStore.get('../..', 'x')) === null, 'ids that could escape the data folder are refused');
await fsStore.remove('2026-10-21', 'abc-123-def');
check((await fsStore.list(['2026-10-21'])).length === 0, 'documents can be removed');
fs.writeFileSync(path.join(dir, '2026-10-21', 'broken.json'), '{not json');
check((await fsStore.list(['2026-10-21'])).length === 0, 'a damaged file is skipped, not fatal');
fs.rmSync(dir, { recursive: true, force: true });

// ---------------------------------------------------------------------------------------------------------------------
section('Over real HTTP (the Node server)');
const free = () => new Promise(r => { const sv = net.createServer().listen(0, () => { const { port } = sv.address(); sv.close(() => r(port)); }); });
const port = await free();
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'aeii-http-'));
const child = spawn(process.execPath, ['server/server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ANALYTICS_DIR: data, ANALYTICS_TOKEN: 'http-token' } });
await new Promise((res, rej) => { child.stdout.on('data', d => String(d).includes('listening') && res()); setTimeout(() => rej(new Error('server did not start')), 8000); });
const base = `http://127.0.0.1:${port}`;
try {
  let r = await fetch(`${base}/api/collect`, { method: 'POST', body: batch([{ k: 'start' }, { k: 'click', id: 'menu:Skirmish' }, { k: 'play', mode: 'skirmish', cfg: {} }]) });
  check(r.status === 204, 'POST /api/collect → 204');
  r = await fetch(`${base}/api/collect`, { method: 'POST', body: 'x'.repeat(40000) });
  check(r.status === 413, 'an oversized POST is cut off (413)');
  r = await fetch(`${base}/api/collect`);
  check(r.status === 405, 'GET /api/collect → 405');
  r = await fetch(`${base}/api/stats`);
  check(r.status === 401, 'GET /api/stats without the token → 401');
  r = await fetch(`${base}/api/stats?days=7`, { headers: { Authorization: 'Bearer http-token' } });
  const body = await r.json();
  check(r.status === 200 && body.totals.sessions === 1 && body.modes[0].mode === 'skirmish' && /no-store/.test(r.headers.get('cache-control')), 'GET /api/stats with the token → the summary, never cached');
  check(body.recent[0].ip === '127.0.0.0', 'the address in the summary is masked (127.0.0.0)');
  const files = fs.readdirSync(path.join(data, dayKey(Date.now())));
  check(files.length === 1 && !fs.readFileSync(path.join(data, dayKey(Date.now()), files[0]), 'utf8').includes('127.0.0.1'), 'the file on disk holds no full IP either');
  r = await fetch(`${base}/api/forget`, { method: 'POST', body: JSON.stringify({ vid: VID }) });
  check(r.status === 200 && (await r.json()).removed === 1 && fs.readdirSync(path.join(data, dayKey(Date.now()))).length === 0, 'POST /api/forget erases the visitor from disk');
  r = await fetch(`${base}/api/nope`);
  check(r.status === 404, 'unknown /api paths → 404');
  r = await fetch(`${base}/healthz`);
  check(r.status === 200, 'the game server keeps serving normally');
} finally {
  child.kill('SIGKILL');
  fs.rmSync(data, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} of ${checks} check(s) FAILED` : `\nAnalytics OK — all ${checks} checks passed ✓`);
process.exit(failures ? 1 : 0);
