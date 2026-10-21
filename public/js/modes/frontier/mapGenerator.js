// Frontier map generator — deterministic (seeded), DOM-free, mirror-symmetric so every player gets an
// identical start. Produces plain mapData the engine already understands; the *same seed on any machine*
// yields the same map, which is how online matches stay in sync without shipping the whole grid.
//
// Pipeline: terrain noise (evaluated in a folded quadrant => perfect symmetry) -> keep zones ->
// points of interest -> roads (A*) with bridges/causeways -> autotile shores + road junctions.

import { Rng, hashSeed } from '../../engine/rng.js';
import { MinHeap } from '../../engine/pathfinding.js';
import { tileKey } from './content.js';
import { KIND, ihash, fbm, assembleTiles } from '../shared/terrain.js';

export const MAP_SIZES = {
  large: { size: 48, label: 'Large', note: '48×48 · 2,304 tiles (6× the biggest classic map)' },
  grand: { size: 64, label: 'Grand', note: '64×64 · 4,096 tiles (11× the biggest classic map)' },
  epic: { size: 96, label: 'Epic', note: '96×96 · 9,216 tiles (25× the biggest classic map)' }
};

// ----- generator ------------------------------------------------------------------------------
/**
 * @param {{size?:number, players?:number, seed?:string|number, theme?:string}} opts
 * @param {import('../../data/contentDatabase.js').ContentDatabase} db  with the frontier pack registered
 * @param {object} autotile  public/data/autotile.json
 */
export function generateFrontierMap(opts, db, autotile) {
  const N = Math.max(32, (opts.size || 64) & ~1);
  const players = Math.min(4, Math.max(2, opts.players || 2));
  const seedStr = String(opts.seed ?? Date.now());
  const seed = hashSeed(seedStr);
  const rng = new Rng(seed ^ 0x51ed270b);
  const H = N / 2;
  const S = N / 64; // linear scale vs the reference 64x64 map
  const refs = db.packRefs('frontier').tiles;
  const tk = (b, o, s = 0) => refs[tileKey(b, o, s)];

  // slots: mirrored corners. 2 players take opposite corners; empty slots get neutral keeps.
  const a = Math.max(4, Math.round(N * 0.14));
  const slotPos = [
    [a, a],
    [N - 1 - a, a],
    [N - 1 - a, N - 1 - a],
    [a, N - 1 - a]
  ];
  const slotTeam = players === 2 ? [0, -1, 1, -1] : players === 3 ? [0, 1, 2, -1] : [0, 1, 2, 3];
  const mirrors = [
    (x, y) => [x, y],
    (x, y) => [N - 1 - x, y],
    (x, y) => [N - 1 - x, N - 1 - y],
    (x, y) => [x, N - 1 - y]
  ];
  const canon = (x, y) => [Math.min(x, N - 1 - x), Math.min(y, N - 1 - y)];
  const idx = (x, y) => y * N + x;

  // ---- 1. terrain kinds (canonical quadrant => symmetric) ----
  const noiseScale = 0.075 / Math.max(0.75, S);
  const kindCanon = new Uint8Array(H * H);
  for (let cy = 0; cy < H; cy++) {
    for (let cx = 0; cx < H; cx++) {
      const e = fbm(seed, cx * noiseScale * 1.6, cy * noiseScale * 1.6);
      const f = fbm(seed + 777, cx * noiseScale * 2.4 + 50, cy * noiseScale * 2.4 + 50);
      let k = KIND.LAND;
      if (e < 0.34) k = KIND.WATER;
      else if (e > 0.7) k = KIND.MOUNTAIN;
      else if (f > 0.6) k = KIND.FOREST;
      else if (ihash(seed + 5, cx, cy) < 0.045) k = KIND.HILL;
      // clear generous breathing room around each keep
      const d = Math.abs(cx - a) + Math.abs(cy - a);
      if (d <= 7 && k !== KIND.LAND) k = d <= 4 ? KIND.LAND : k === KIND.WATER ? KIND.LAND : k;
      // the Heart of the Realm: an open plaza at the very centre where armies meet
      const dc = Math.abs(cx - (H - 1)) + Math.abs(cy - (H - 1));
      if (dc <= Math.round(7 * Math.max(0.8, S))) {
        if (k === KIND.WATER || k === KIND.MOUNTAIN) k = KIND.LAND;
        else if (k === KIND.FOREST && dc <= 4) k = KIND.LAND;
      }
      kindCanon[cy * H + cx] = k;
    }
  }
  const kind = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const [cx, cy] = canon(x, y);
      kind[idx(x, y)] = kindCanon[cy * H + cx];
    }
  }

  const structure = new Int32Array(N * N).fill(-1); // explicit tile index for buildings
  const road = new Uint8Array(N * N);
  const bridge = new Uint8Array(N * N); // 1 horizontal, 2 vertical
  const units = [];
  const pois = [];

  const cellFree = (x, y) =>
    kind[idx(x, y)] === KIND.LAND && structure[idx(x, y)] < 0 && !road[idx(x, y)];

  // Place the same structure on every mirror; `ownerOf(slot)` decides ownership per copy.
  function placeMirrored(cx, cy, building, stage, ownerOf) {
    const seen = new Set();
    mirrors.forEach((m, slot) => {
      const [x, y] = m(cx, cy);
      if (seen.has(idx(x, y))) return;
      seen.add(idx(x, y));
      const owner = ownerOf(slot);
      structure[idx(x, y)] = tk(building, owner, stage);
      kind[idx(x, y)] = KIND.LAND;
      pois.push({ type: building, x, y, owner });
    });
  }
  const neutral = () => -1;
  const slotOwner = slot => slotTeam[slot];

  // ---- 2. keeps + starting setup ----
  const peasantIndex = db.packRefs('frontier').units.peasant;
  const castleByTeam = [39, 41, 43, 45];
  const NEUTRAL_CASTLE = 37;
  const VILLAGE_NEUTRAL = 36;
  const VILLAGES_BY_TEAM = [38, 40, 42, 44];
  mirrors.forEach((m, slot) => {
    const [kx, ky] = m(a, a);
    const team = slotTeam[slot];
    structure[idx(kx, ky)] = team >= 0 ? castleByTeam[team] : NEUTRAL_CASTLE;
    kind[idx(kx, ky)] = KIND.LAND;
    pois.push({ type: 'keep', x: kx, y: ky, owner: team });
    if (team >= 0) {
      units.push({ team, index: 9, x: kx, y: ky });
      for (const [ox, oy, unitIndex] of [
        [1, 0, 0],
        [0, 1, 0],
        [1, 1, peasantIndex]
      ]) {
        const [ux, uy] = m(a + ox, a + oy);
        units.push({ team, index: unitIndex, x: ux, y: uy });
      }
    }
  });

  // owned starter fields + nearby neutral villages (mirrored with their keep's owner)
  placeMirrored(a + 2, a + 2, 'farm', 2, slotOwner);
  placeMirrored(a + 1, a + 3, 'farm', 2, slotOwner);
  placeMirrored(a + 3, a + 1, 'farm', 1, slotOwner);
  for (const [vx, vy] of [[a + 5, a + 1], [a + 1, a + 5]]) {
    mirrors.forEach(m => {
      const [x, y] = m(vx, vy);
      structure[idx(x, y)] = VILLAGE_NEUTRAL;
      kind[idx(x, y)] = KIND.LAND;
      pois.push({ type: 'village', x, y, owner: -1 });
    });
  }

  // ---- 3. points of interest (canonical quadrant, mirrored) ----
  const margin = 2;
  const hi = H - 1 - 3;
  const quadCells = [];
  for (let cy = margin; cy <= hi; cy++) for (let cx = margin; cx <= hi; cx++) quadCells.push([cx, cy]);
  const placedCanon = [[a, a], [a + 2, a + 2], [a + 1, a + 3], [a + 3, a + 1], [a + 5, a + 1], [a + 1, a + 5]];
  const area = S * S;
  const specs = [
    { b: 'obelisk', n: 1, min: 20, max: 44, sep: 9, stage: 0 },
    { b: 'mine', n: Math.max(1, Math.round(2 * area)), min: 14, max: 44, sep: 9, stage: 0 },
    { b: 'shrine', n: 1, min: 10, max: 26, sep: 8, stage: 0 },
    { b: 'forge', n: 1, min: 16, max: 34, sep: 8, stage: 0 },
    { b: 'library', n: 1, min: 12, max: 30, sep: 8, stage: 0 },
    { b: 'watchtower', n: Math.max(1, Math.round(2 * area)), min: 10, max: 44, sep: 8, stage: 0 },
    { b: 'outpost', n: Math.max(1, Math.round(2 * area)), min: 14, max: 40, sep: 9, stage: 0 },
    { b: 'ruins', n: Math.max(2, Math.round(3 * area)), min: 12, max: 48, sep: 6, stage: 0 },
    { b: 'farm', n: Math.max(3, Math.round(6 * area)), min: 9, max: 40, sep: 4, stage: 1 },
    { b: 'village', n: Math.max(2, Math.round(4 * area)), min: 8, max: 44, sep: 6, stage: 0 }
  ];
  const sc = v => v * Math.max(0.8, S);
  for (const spec of specs) {
    let placed = 0;
    let guard = 0;
    while (placed < spec.n && guard++ < 1200) {
      const [cx, cy] = rng.pick(quadCells);
      const d = Math.abs(cx - a) + Math.abs(cy - a);
      if (d < sc(spec.min) || d > sc(spec.max)) continue;
      if (kind[idx(cx, cy)] !== KIND.LAND || structure[idx(cx, cy)] >= 0) continue;
      let ok = true;
      for (const [px, py] of placedCanon) {
        if (Math.abs(px - cx) + Math.abs(py - cy) < Math.max(3, spec.sep * Math.min(1, S))) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (spec.b === 'village') {
        mirrors.forEach(m => {
          const [x, y] = m(cx, cy);
          structure[idx(x, y)] = VILLAGE_NEUTRAL;
          kind[idx(x, y)] = KIND.LAND;
          pois.push({ type: 'village', x, y, owner: -1 });
        });
      } else {
        placeMirrored(cx, cy, spec.b, spec.stage, neutral);
      }
      placedCanon.push([cx, cy]);
      placed++;
    }
  }
  // the Heart of the Realm: four obelisks around the centre
  const heart = H - 1 - Math.max(2, Math.round(2 * S));
  placeMirrored(heart, heart, 'obelisk', 0, neutral);
  kindClear(heart, heart);
  function kindClear(cx, cy) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        mirrors.forEach(m => {
          const [x, y] = m(cx + dx, cy + dy);
          if (x >= 0 && y >= 0 && x < N && y < N && structure[idx(x, y)] < 0) kind[idx(x, y)] = KIND.LAND;
        });
      }
    }
  }

  // ---- 4. roads: A* inside the canonical quadrant, mirrored ----
  const roadCanon = new Uint8Array(H * H);
  const cstep = (cx, cy) => {
    const i = cy * H + cx;
    if (structure[idx(cx, cy)] >= 0 && Math.abs(cx - a) + Math.abs(cy - a) > 0) return 40; // go around buildings
    if (roadCanon[i]) return 0.35;
    let c;
    switch (kind[idx(cx, cy)]) {
      case KIND.WATER: c = 7; break;
      case KIND.MOUNTAIN: c = 9; break;
      case KIND.FOREST: c = 2.6; break;
      case KIND.HILL: c = 1.6; break;
      default: c = 1;
    }
    // organic wobble, and stay off the mirror axes so mirrored copies never form a 2-wide road
    c *= 0.75 + 0.9 * ihash(seed + 11, cx, cy);
    if (cx === H - 1 || cy === H - 1) c += 9;
    return c;
  };
  function carve(from, to) {
    const dist = new Float32Array(H * H).fill(Infinity);
    const prev = new Int32Array(H * H).fill(-1);
    const heap = new MinHeap();
    const s = from[1] * H + from[0];
    dist[s] = 0;
    heap.push(0, s);
    const goal = to[1] * H + to[0];
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) break;
      const cx = cur % H;
      const cy = (cur / H) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= H || ny >= H) continue;
        const nd = dist[cur] + cstep(nx, ny);
        const ni = ny * H + nx;
        if (nd < dist[ni]) {
          dist[ni] = nd;
          prev[ni] = cur;
          heap.push(nd + (Math.abs(nx - to[0]) + Math.abs(ny - to[1])) * 0.9, ni);
        }
      }
    }
    // walk back, resolving water into bridges (straight, short) or causeways
    const path = [];
    for (let c = goal; c !== -1; c = prev[c]) path.push([c % H, (c / H) | 0]);
    path.reverse();
    for (let i = 0; i < path.length; i++) {
      const [cx, cy] = path[i];
      if (structure[idx(cx, cy)] >= 0) continue;
      roadCanon[cy * H + cx] = 1;
    }
    // bridge runs
    let i = 0;
    while (i < path.length) {
      if (kind[idx(path[i][0], path[i][1])] !== KIND.WATER) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < path.length && kind[idx(path[j + 1][0], path[j + 1][1])] === KIND.WATER) j++;
      const dx = path[i][0] - (path[i - 1]?.[0] ?? path[i][0]);
      const dy = path[i][1] - (path[i - 1]?.[1] ?? path[i][1]);
      let straight = i > 0 && j < path.length - 1 && j - i + 1 <= 5;
      for (let k = i; k <= j && straight; k++) {
        const ddx = path[k][0] - path[k - 1][0];
        const ddy = path[k][1] - path[k - 1][1];
        if (ddx !== dx || ddy !== dy) straight = false;
      }
      for (let k = i; k <= j; k++) {
        const [cx, cy] = path[k];
        if (straight) bridgeCanon.set(cy * H + cx, dx !== 0 ? 1 : 2);
        else kindCanon[cy * H + cx] = KIND.LAND; // causeway
      }
      i = j + 1;
    }
  }
  const bridgeCanon = new Map();
  const centre = [H - 1, H - 1];
  const jitter = () => rng.int(-2, Math.max(3, Math.round(5 * S)));
  carve([a, a], [H - 1, Math.min(H - 4, a + jitter() + 2)]); // east to the neighbouring keep
  carve([a, a], [Math.min(H - 4, a + jitter() + 2), H - 1]); // south to the other neighbour
  carve([a, a], centre); // highway to the Heart of the Realm

  // causeways were written to kindCanon; refresh the full-grid kinds from it
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const [cx, cy] = canon(x, y);
      if (kindCanon[cy * H + cx] === KIND.LAND && kind[idx(x, y)] === KIND.WATER) kind[idx(x, y)] = KIND.LAND;
      if (roadCanon[cy * H + cx] && structure[idx(x, y)] < 0) road[idx(x, y)] = 1;
      const b = bridgeCanon.get(cy * H + cx);
      if (b && structure[idx(x, y)] < 0) bridge[idx(x, y)] = b;
    }
  }
  // roads should never sit on forest/mountain tiles: clear them
  for (let i = 0; i < N * N; i++) {
    if (road[i] && !bridge[i] && kind[i] !== KIND.WATER) kind[i] = KIND.LAND;
  }

  // ---- 5. tile assembly with autotiling (shared toolkit) ----
  const tiles = assembleTiles({ N, seed, kind, structure, road, bridge }, autotile);

  const activeTeams = [...new Set(slotTeam.filter(t => t >= 0))];
  return {
    id: `frontier_${seedStr}_${N}_${players}`,
    name: `Frontier · ${N}×${N}`,
    category: 'frontier',
    author: 'Procedural',
    width: N,
    height: N,
    tiles,
    units,
    teamAccess: [true, true, players > 2, players > 3],
    maxPlayers: players,
    activeTeams,
    theme: opts.theme || 'meadow',
    seed: seedStr,
    meta: { size: N, players, slots: slotPos.map((p, i) => ({ slot: i, team: slotTeam[i], x: p[0], y: p[1] })), pois }
  };
}
