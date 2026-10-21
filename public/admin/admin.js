// Players' dashboard. Talks only to /api/stats with the dashboard key. Every value goes into the page with textContent /
// createElement — the numbers and labels came from the open internet, so nothing here ever builds HTML from them.

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const svgNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, text) => {
  const e = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
};
const fmt = n => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US'));
const minutes = m => (m >= 120 ? `${(m / 60).toFixed(1)} h` : `${m} min`);

let days = 30;
let token = sessionStorage.getItem('aeii_dash_key') || '';

// ---- sign-in ---------------------------------------------------------------------------------------------------------
$('gate-form').addEventListener('submit', async e => {
  e.preventDefault();
  token = $('token').value.trim();
  $('gate-msg').textContent = '';
  if (!token) return;
  if (await load()) sessionStorage.setItem('aeii_dash_key', token);
  else token = '';
});
$('signout').addEventListener('click', () => {
  sessionStorage.removeItem('aeii_dash_key');
  token = '';
  $('app').classList.add('hidden');
  $('gate').classList.remove('hidden');
  $('token').value = '';
});
$('refresh').addEventListener('click', () => load());
const range = $('range');
for (const d of [7, 30, 90]) {
  const b = el('button', d === days ? 'on' : '', `${d} days`);
  b.addEventListener('click', () => {
    days = d;
    range.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    load();
  });
  range.append(b);
}

async function load() {
  $('status').textContent = 'Loading…';
  let res;
  try {
    res = await fetch(`/api/stats?days=${days}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  } catch {
    return fail('Could not reach the server.');
  }
  if (res.status === 401) return fail(token ? 'That key is not right.' : 'Enter the key.');
  if (!res.ok) return fail(`The server answered ${res.status}.`);
  render(await res.json());
  $('gate').classList.add('hidden');
  $('app').classList.remove('hidden');
  return true;
}

function fail(msg) {
  const app = !$('app').classList.contains('hidden');
  (app ? $('status') : $('gate-msg')).textContent = msg;
  if (!app) $('gate').classList.remove('hidden');
  return false;
}

// ---- pieces --------------------------------------------------------------------------------------------------------------
function bars(host, rows, { unit = '', cls = '' } = {}) {
  host.replaceChildren();
  if (!rows.length) return host.append(el('div', 'empty', 'Nothing yet.'));
  const max = Math.max(...rows.map(r => r.value), 1);
  const list = el('div', 'bars');
  for (const r of rows) {
    const row = el('div', `bar ${cls}`);
    row.append(el('div', 'name', r.name), (() => { const t = el('div', 'track'); const f = el('div', 'fill'); f.style.width = `${Math.max(2, (r.value / max) * 100)}%`; t.append(f); return t; })(), el('div', 'val', `${fmt(r.value)}${unit}`));
    row.title = r.name;
    list.append(row);
  }
  host.append(list);
}

function kpi(value, label, note, unit = '') {
  const c = el('div', 'card kpi');
  const v = el('div', 'v', value);
  if (unit) v.append(el('small', '', unit));
  c.append(v, el('div', 'l', label));
  if (note) c.append(el('div', 'n', note));
  return c;
}

function chart(series) {
  const host = $('chart');
  host.replaceChildren();
  const W = 1000;
  const H = 260;
  const m = { l: 44, r: 14, t: 12, b: 28 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const maxS = Math.max(...series.map(d => d.sessions), 1);
  const maxP = Math.max(...series.map(d => d.playMin), 1);
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Sessions and play minutes per day' });
  for (let i = 0; i <= 4; i++) {
    const y = m.t + (ih * i) / 4;
    s.append(svg('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: '#26324d', 'stroke-width': 1 }));
    s.append(svg('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end', class: 'ax' }, fmt(Math.round(maxS * (1 - i / 4)))));
  }
  const bw = iw / series.length;
  series.forEach((d, i) => {
    const h = (d.sessions / maxS) * ih;
    const r = svg('rect', { x: m.l + i * bw + bw * 0.14, y: m.t + ih - h, width: Math.max(1, bw * 0.72), height: h, fill: '#e9b949' });
    r.append(svg('title', {}, `${d.day}: ${d.sessions} sessions, ${d.visitors} visitors, ${d.playMin} min played`));
    s.append(r);
    if (series.length <= 31 ? i % Math.ceil(series.length / 8) === 0 : i % 12 === 0) s.append(svg('text', { x: m.l + i * bw + bw / 2, y: H - 8, 'text-anchor': 'middle', class: 'ax' }, d.day.slice(5)));
  });
  const pts = series.map((d, i) => `${m.l + i * bw + bw / 2},${m.t + ih - (d.playMin / maxP) * ih}`).join(' ');
  s.append(svg('polyline', { points: pts, fill: 'none', stroke: '#58a6ff', 'stroke-width': 3, 'stroke-linejoin': 'round' }));
  host.append(s);
  const legend = $('legend');
  legend.replaceChildren();
  for (const [c, t] of [['#e9b949', 'Sessions'], [ '#58a6ff', `Minutes played (peak ${fmt(Math.round(maxP))})`]]) {
    const l = el('span');
    const i = el('i');
    i.style.background = c;
    l.append(i, t);
    legend.append(l);
  }
}

function render(d) {
  $('status').textContent = `${fmt(d.totals.sessions)} sessions in the last ${d.days} days · updated ${new Date(d.generated).toLocaleTimeString()}`;
  const t = d.totals;
  const kp = $('kpis');
  kp.replaceChildren(
    kpi(fmt(t.visitors), 'Visitors', `${fmt(t.sessions)} sessions`),
    kpi(fmt(t.players), 'Started a match', t.visitors ? `${Math.round((t.players / t.visitors) * 100)}% of visitors` : ''),
    kpi(String(t.avgSessionMin), 'Average time in use', 'per session, hands on the page', ' min'),
    kpi(minutes(t.totalPlayMin), 'Total time played', `${t.avgPlayMinPerPlayer} min per player`),
    kpi(`${t.engagedPct}%`, 'Stayed 30 s or more', 'engaged sessions'),
    kpi(fmt(t.clicks), 'Button presses', ''),
    kpi(fmt(t.errors), 'Crashes reported', t.errors ? 'see below' : 'none 🎉')
  );
  chart(d.series);

  const modes = $('modes');
  modes.replaceChildren();
  if (!d.modes.length) modes.append(el('div', 'empty', 'No matches yet.'));
  for (const m of d.modes) {
    const row = el('div', 'mode');
    row.append(el('b', '', m.mode), el('div', 'big', fmt(m.starts)));
    const done = m.finished ? `${m.won} won · ${m.lost} lost · ${m.quit} left` : 'no finished matches';
    row.append(el('span', '', `${fmt(m.players)} players · avg ${m.avgMin} min${m.avgRounds ? ` · ~${m.avgRounds} rounds` : ''} · ${done}`), el('span', '', 'starts'));
    modes.append(row);
  }

  bars($('screens'), d.screens.map(s => ({ name: s.name, value: s.minutes })), { unit: ' min', cls: 'blue' });
  bars($('clicks'), d.clicks);
  bars($('countries'), d.countries, { cls: 'mint' });
  bars($('cities'), d.cities, { cls: 'mint' });
  bars($('devices'), d.devices);
  bars($('os'), d.os, { cls: 'blue' });
  bars($('browsers'), d.browsers, { cls: 'blue' });
  bars($('referrers'), d.referrers);
  bars($('languages'), d.languages.map(l => ({ name: l.name || '?', value: l.value })), { cls: 'blue' });
  bars($('scrolls'), d.scrolls.map(s => ({ name: s.name, value: s.value })));

  const perf = $('perf');
  perf.replaceChildren();
  const stat = (v, l) => {
    const s = el('div', 'stat');
    s.append(el('div', 'v', v), el('div', 'l', l));
    return s;
  };
  const grid = el('div', 'stats');
  grid.append(stat(d.performance.avgFps ?? '—', 'average FPS'), stat(d.performance.lowestFps ?? '—', 'lowest FPS seen'), stat(d.network.avgPing === null ? '—' : `${d.network.avgPing} ms`, 'average ping'), stat(d.network.avgJitter === null ? '—' : `${d.network.avgJitter} ms`, 'average jitter'), stat(d.network.avgLossPct === null ? '—' : `${d.network.avgLossPct}%`, 'average packet loss'));
  perf.append(grid, el('div', 'sub empty', `${fmt(d.performance.samples)} frame-rate samples · ${fmt(d.network.samples)} connection samples`));

  const errs = $('errors');
  errs.replaceChildren();
  if (!d.errors.length) errs.append(el('div', 'empty', 'No crashes reported in this period.'));
  else bars(errs, d.errors.map(e => ({ name: e.name, value: e.value })), { cls: '' });

  const table = $('recent');
  table.replaceChildren();
  const head = el('tr');
  for (const h of ['When', 'Where', 'Address', 'Device', 'In use', 'Played', 'Modes', 'Presses']) head.append(el('th', '', h));
  table.append(head);
  for (const r of d.recent) {
    const tr = el('tr');
    tr.append(el('td', '', new Date(r.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })), el('td', '', r.where), el('td', '', r.ip || '—'), el('td', '', r.device), el('td', 'num', `${r.activeMin} min`), el('td', 'num', `${r.playMin} min`), el('td', '', r.modes || '—'), el('td', 'num', fmt(r.clicks)));
    table.append(tr);
  }
}

if (token) load().then(ok => !ok && sessionStorage.removeItem('aeii_dash_key'));
