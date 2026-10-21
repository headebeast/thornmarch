// Battle Royale map generator — deterministic (seeded), DOM-free.
//
// A circular island sized for the field (20 players → 96², 40 → 128², 60 → 160²): shores fall away into sea, spawn
// rings put every warband an equal distance from the action and loot towns pull players together. A shrinking-storm
// schedule is precomputed only when the match asks for one (`opts.storm`); the default island has no zone at all.

import { Rng, hashSeed } from '../../engine/rng.js';
import { MinHeap } from '../../engine/pathfinding.js';
import { KIND, ihash, fbm, assembleTiles } from '../shared/terrain.js';
import { tileKey } from '../frontier/content.js';

export const MAX_TEAMS = 60;

export function royaleMapSize(players) {
  return players <= 24 ? 96 : players <= 44 ? 128 : 160;
}

export const LOOT_DENSITY = { sparse: 0.0028, normal: 0.0046, rich: 0.0072 };
export const STORM_PHASE_ROUNDS = { fast: 3, normal: 4, slow: 6 };
const RADIUS_FRACTIONS = [1.06, 0.74, 0.54, 0.38, 0.26, 0.16, 0.09, 0.04];
const DAMAGE_PCT = [0, 0.1, 0.14, 0.2, 0.28, 0.38, 0.52, 0.75];

export function generateRoyaleMap(opts, db, autotile) {
  const P = Math.max(8, Math.min(MAX_TEAMS, opts.players || 20));
  const N = royaleMapSize(P);
  const seedStr = String(opts.seed ?? Date.now());
  const seed = hashSeed(seedStr);
  const rng = new Rng(seed ^ 0x5bd1e995);
  const idx = (x, y) => y * N + x;
  const cx = (N - 1) / 2;
  const cy = (N - 1) / 2;
  const R = N * 0.47;

  const frontier = db.packRefs('frontier');
  const royale = db.packRefs('royale');
  const T = (b, s = 0) => frontier.tiles[tileKey(b, -1, s)];

  // ---- terrain: an island with noisy shores, lakes, ridges and woods ----
  const kind = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - cx, y - cy) / R;
      const base = fbm(seed, x * 0.045, y * 0.045);
      const h = base * 0.62 + (1 - Math.pow(Math.min(d, 1.4), 2.2)) * 0.82 - 0.21;
      let k = KIND.LAND;
      if (h < 0.33 || d > 1.03) k = KIND.WATER;
      else if (d < 0.85 && fbm(seed + 55, x * 0.075 + 9, y * 0.075 + 9) > 0.72) k = KIND.WATER; // inland lakes
      else if (h > 0.5 && fbm(seed + 31, x * 0.06, y * 0.06) > 0.71) k = KIND.MOUNTAIN;
      else if (fbm(seed + 777, x * 0.09 + 50, y * 0.09 + 50) > 0.6) k = KIND.FOREST;
      else if (ihash(seed + 5, x, y) < 0.04) k = KIND.HILL;
      kind[idx(x, y)] = k;
    }
  }
  const structure = new Int32Array(N * N).fill(-1);
  const road = new Uint8Array(N * N);
  const bridge = new Uint8Array(N * N);
  const reserved = new Uint8Array(N * N); // spawn zones etc.: nothing else may be placed here

  const inMap = (x, y) => x >= 1 && y >= 1 && x < N - 1 && y < N - 1;
  const isLand = (x, y) => inMap(x, y) && (kind[idx(x, y)] === KIND.LAND || kind[idx(x, y)] === KIND.HILL);
  const free = (x, y) => isLand(x, y) && structure[idx(x, y)] < 0 && !road[idx(x, y)] && !reserved[idx(x, y)];

  // ---- spawn rings ----
  const outerCount = P > 32 ? Math.ceil(P * 0.62) : P;
  const rings = [
    { n: outerCount, r: R * 0.8 },
    { n: P - outerCount, r: R * 0.5 }
  ];
  const spawns = [];
  let team = 0;
  rings.forEach((ring, ri) => {
    const off = rng.next() * Math.PI * 2;
    for (let i = 0; i < ring.n; i++) {
      const ang = off + (i / ring.n) * Math.PI * 2 + (rng.next() - 0.5) * (Math.PI / ring.n) * 0.4;
      let sx = Math.round(cx + Math.cos(ang) * ring.r);
      let sy = Math.round(cy + Math.sin(ang) * ring.r);
      sx = Math.max(4, Math.min(N - 5, sx));
      sy = Math.max(4, Math.min(N - 5, sy));
      spawns.push({ team: team++, x: sx, y: sy, ring: ri });
    }
  });
  for (const s of spawns) {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const x = s.x + dx;
        const y = s.y + dy;
        if (!inMap(x, y) || Math.abs(dx) + Math.abs(dy) > 4) continue;
        if (Math.abs(dx) + Math.abs(dy) <= 3 && kind[idx(x, y)] !== KIND.LAND) kind[idx(x, y)] = KIND.LAND;
        reserved[idx(x, y)] = 1;
      }
    }
  }

  // ---- every warband starts on its own War Camp, with a Gold Mine and a couple of crates in sight ----
  const crateTile = royale.tiles.crate;
  const campTile = royale.tiles.camp;
  const starters = [];
  const clearAround = (x, y, r) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (inMap(x + dx, y + dy) && structure[idx(x + dx, y + dy)] >= 0) return false;
    return true;
  };
  const placeNear = (s, minD, maxD, tile, apart) => {
    for (let tries = 0; tries < 60; tries++) {
      const a = rng.next() * Math.PI * 2;
      const d = minD + rng.next() * (maxD - minD);
      const x = Math.round(s.x + Math.cos(a) * d);
      const y = Math.round(s.y + Math.sin(a) * d);
      if (!inMap(x, y) || !isLand(x, y) || kind[idx(x, y)] !== KIND.LAND || structure[idx(x, y)] >= 0 || road[idx(x, y)]) continue;
      if (!clearAround(x, y, apart)) continue;
      structure[idx(x, y)] = tile;
      reserved[idx(x, y)] = 1;
      return { x, y };
    }
    return null;
  };
  for (const s of spawns) {
    structure[idx(s.x, s.y)] = campTile;
    reserved[idx(s.x, s.y)] = 1;
  }
  for (const s of spawns) {
    const mine = placeNear(s, 5, 9, T('mine', 0), 2) || placeNear(s, 4, 12, T('mine', 0), 1);
    const crates = [placeNear(s, 4, 8, crateTile, 2), placeNear(s, 4, 9, crateTile, 2)].filter(Boolean);
    starters.push({ team: s.team, mine, crates });
  }

  // ---- towns: a landmark ringed by crates ----
  const towns = [];
  const townCount = Math.max(6, Math.min(40, Math.round(P * 0.62)));
  const minSep = Math.max(9, N / 10);
  const deck = [];
  const TOWN_TYPES = [['watchtower', 0.15], ['shrine', 0.15], ['ruins', 0.15], ['mine', 0.17], ['forge', 0.12], ['library', 0.1], ['outpost', 0.16]];
  let guard = 0;
  while (towns.length < townCount && guard++ < 4000) {
    const a = rng.next() * Math.PI * 2;
    const r = R * 0.74 * Math.sqrt(rng.next());
    const x = Math.round(cx + Math.cos(a) * r);
    const y = Math.round(cy + Math.sin(a) * r);
    if (!free(x, y) || kind[idx(x, y)] !== KIND.LAND) continue;
    if (spawns.some(s => Math.abs(s.x - x) + Math.abs(s.y - y) < 7)) continue;
    if (towns.some(t => Math.abs(t.x - x) + Math.abs(t.y - y) < minSep)) continue;
    // the first seven towns are one of everything (in a shuffled order), the rest follow the weights
    let type;
    if (towns.length < TOWN_TYPES.length) {
      if (!deck.length) deck.push(...rng.shuffle(TOWN_TYPES.map(([id]) => id)));
      type = deck.shift();
    } else {
      let roll = rng.next();
      type = TOWN_TYPES[TOWN_TYPES.length - 1][0];
      for (const [id, w] of TOWN_TYPES) {
        if (roll < w) {
          type = id;
          break;
        }
        roll -= w;
      }
    }
    towns.push({ x, y, type });
    structure[idx(x, y)] = T(type, 0);
    reserved[idx(x, y)] = 1;
    const crates = rng.int(3, 5);
    let placed = 0;
    for (let tries = 0; tries < 30 && placed < crates; tries++) {
      const cxn = x + rng.int(-3, 3);
      const cyn = y + rng.int(-3, 3);
      if (!free(cxn, cyn) || (cxn === x && cyn === y)) continue;
      structure[idx(cxn, cyn)] = crateTile;
      placed++;
    }
  }

  // ---- roads between neighbouring towns (causeways across water) ----
  const stepCost = (x, y) => {
    const k = kind[idx(x, y)];
    const base = k === KIND.WATER ? 11 : k === KIND.MOUNTAIN ? 8 : k === KIND.FOREST ? 2.4 : k === KIND.HILL ? 1.5 : 1;
    const meander = 0.55 + 1.3 * fbm(seed + 13, x * 0.11, y * 0.11, 2); // low-frequency bends, not Manhattan boxes
    return road[idx(x, y)] ? 0.45 : base * meander * (0.9 + 0.2 * ihash(seed + 11, x, y));
  };
  function carve(a, b) {
    const dist = new Float32Array(N * N).fill(Infinity);
    const prev = new Int32Array(N * N).fill(-1);
    const heap = new MinHeap();
    const s = idx(a.x, a.y);
    dist[s] = 0;
    heap.push(0, s);
    const goal = idx(b.x, b.y);
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) break;
      const x = cur % N;
      const y = (cur / N) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inMap(nx, ny)) continue;
        const nd = dist[cur] + stepCost(nx, ny);
        const ni = idx(nx, ny);
        if (nd < dist[ni]) {
          dist[ni] = nd;
          prev[ni] = cur;
          heap.push(nd + (Math.abs(nx - b.x) + Math.abs(ny - b.y)) * 0.8, ni);
        }
      }
    }
    for (let c = goal; c !== -1; c = prev[c]) {
      if (structure[c] >= 0) continue;
      road[c] = 1;
      kind[c] = KIND.LAND; // causeway / cleared path
    }
  }
  const linked = new Set();
  towns.forEach((t, i) => {
    const near = towns
      .map((o, j) => ({ j, d: Math.abs(o.x - t.x) + Math.abs(o.y - t.y) }))
      .filter(o => o.j !== i)
      .sort((p, q) => p.d - q.d)
      .slice(0, 2)
      .filter((_, n) => n === 0 || rng.chance(0.3)); // always the nearest town, sometimes a second link
    for (const { j } of near) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (linked.has(key)) continue;
      linked.add(key);
      carve(t, towns[j]);
    }
  });

  // ---- scattered crates ----
  let landCells = 0;
  for (let i = 0; i < N * N; i++) if (kind[i] === KIND.LAND) landCells++;
  const wanted = Math.round(landCells * (LOOT_DENSITY[opts.loot] ?? LOOT_DENSITY.normal));
  let crates = 0;
  for (let tries = 0; tries < wanted * 12 && crates < wanted; tries++) {
    const x = rng.int(2, N - 3);
    const y = rng.int(2, N - 3);
    if (!free(x, y) || kind[idx(x, y)] !== KIND.LAND) continue;
    if (Math.hypot(x - cx, y - cy) > R * 0.95) continue;
    let tooClose = false;
    for (let dy = -2; dy <= 2 && !tooClose; dy++) for (let dx = -2; dx <= 2; dx++) if (inMap(x + dx, y + dy) && structure[idx(x + dx, y + dy)] === crateTile) { tooClose = true; break; }
    if (tooClose) continue;
    structure[idx(x, y)] = crateTile;
    crates++;
  }

  // ---- squads ----
  const U = frontier.units;
  const pools = {
    front: [0, U.pikeman, 13, 12],
    ranged: [1, U.crossbowman, U.ranger, 3, U.alchemist, 15],
    flex: [U.druid, 5, U.outrider, 14, 2, 6, 4]
  };
  const units = [];
  const taken = new Set();
  for (const s of spawns) {
    const cells = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]
      .map(([dx, dy]) => [s.x + dx, s.y + dy])
      .filter(([x, y]) => isLand(x, y) && !taken.has(idx(x, y)));
    const roster = [rng.pick(pools.front), rng.pick(pools.ranged), rng.pick(pools.flex)];
    roster.forEach((index, i) => {
      const [x, y] = cells[i] || cells[0];
      taken.add(idx(x, y));
      units.push({ team: s.team, index, x, y });
    });
  }

  // ---- optional storm schedule (last, so it never changes the island itself) ----
  const phaseLen = STORM_PHASE_ROUNDS[opts.storm];
  let storm = null;
  if (phaseLen) {
    const phases = [];
    let prev = { x: cx, y: cy, r: R * RADIUS_FRACTIONS[0] };
    RADIUS_FRACTIONS.forEach((f, i) => {
      const r = R * f;
      let x = cx;
      let y = cy;
      if (i > 0) {
        const a = rng.next() * Math.PI * 2;
        const off = rng.next() * Math.max(0, prev.r - r) * 0.85;
        x = prev.x + Math.cos(a) * off;
        y = prev.y + Math.sin(a) * off;
      }
      phases.push({ index: i, round: i * phaseLen + 1, x: +x.toFixed(2), y: +y.toFixed(2), r: +r.toFixed(2), damage: DAMAGE_PCT[i] });
      prev = { x, y, r };
    });
    storm = { phaseLen, phases, suddenDeathRound: phases[phases.length - 1].round + 6 };
  }

  const tiles = assembleTiles({ N, seed, kind, structure, road, bridge }, autotile);

  const pois = [
    ...spawns.map(s => ({ type: 'camp', x: s.x, y: s.y, owner: s.team })),
    ...starters.filter(s => s.mine).map(s => ({ type: 'mine', x: s.mine.x, y: s.mine.y, owner: -1 })),
    ...towns.map(t => ({ type: t.type, x: t.x, y: t.y, owner: -1 }))
  ];
  return {
    id: `royale_${seedStr}_${P}`,
    name: `Battle Royale · ${P} warbands`,
    category: 'royale',
    author: 'Procedural',
    width: N,
    height: N,
    tiles,
    units,
    teamAccess: [true, true, true, true],
    maxPlayers: P,
    activeTeams: spawns.map(s => s.team),
    theme: 'meadow',
    seed: seedStr,
    meta: {
      size: N,
      players: P,
      islandRadius: R,
      centre: { x: cx, y: cy },
      storm, // null = no zone (the default)
      spawns,
      starters,
      towns,
      crates,
      pois
    }
  };
}
