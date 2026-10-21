// Shared procedural-terrain toolkit (pure, seeded) used by every generated mode: noise, terrain kinds, and the
// autotiler that turns a plain grid of "kinds + roads + structures" into correct tile indexes (shore banks,
// road junctions, bridges). Frontier and Battle Royale both build on it.

export const KIND = { LAND: 0, WATER: 1, FOREST: 2, MOUNTAIN: 3, HILL: 4 };

export function ihash(seed, x, y) {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = t => t * t * (3 - 2 * t);

export function valueNoise(seed, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const a = ihash(seed, x0, y0);
  const b = ihash(seed, x0 + 1, y0);
  const c = ihash(seed, x0, y0 + 1);
  const d = ihash(seed, x0 + 1, y0 + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export function fbm(seed, x, y, octaves = 4) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(seed + o * 1013, x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * Turn terrain data into tile indexes.
 * @param {{N:number, seed:number, kind:Uint8Array, structure:Int32Array, road:Uint8Array, bridge:Uint8Array}} g
 *        flat N*N arrays (index = y*N + x); structure holds an explicit tile index or -1
 * @param {object} autotile  public/data/autotile.json
 * @returns {number[][]} tiles[x][y]
 */
export function assembleTiles({ N, seed, kind, structure, road, bridge }, autotile) {
  const idx = (x, y) => y * N + x;
  const isWaterish = (x, y) => (kind[idx(x, y)] === KIND.WATER && !road[idx(x, y)]) || bridge[idx(x, y)] > 0;
  const landAt = (x, y) => x >= 0 && y >= 0 && x < N && y < N && !isWaterish(x, y);
  const waterTiles = autotile.water.filter(t => !t.pure);
  const pureWater = autotile.water.filter(t => t.pure && t.index <= 2).map(t => t.index);

  function waterTile(x, y) {
    const n = landAt(x, y - 1);
    const s = landAt(x, y + 1);
    const w = landAt(x - 1, y);
    const e = landAt(x + 1, y);
    const want = {
      n,
      s,
      w,
      e,
      nw: landAt(x - 1, y - 1) && !n && !w,
      ne: landAt(x + 1, y - 1) && !n && !e,
      sw: landAt(x - 1, y + 1) && !s && !w,
      se: landAt(x + 1, y + 1) && !s && !e
    };
    if (!Object.values(want).some(Boolean)) {
      return ihash(seed + 9, x, y) < 0.07 ? pureWater[1 + ((x + y) & 1)] : 0;
    }
    let best = null;
    let bestCost = Infinity;
    for (const t of waterTiles) {
      let cost = 0;
      for (const k of ['n', 's', 'w', 'e']) if (!!t[k] !== want[k]) cost += 4;
      for (const k of ['nw', 'ne', 'sw', 'se']) if (!!t[k] !== want[k]) cost += 1;
      if (cost < bestCost) {
        bestCost = cost;
        best = t;
      }
    }
    return best.index;
  }

  const roadByMask = new Map();
  for (const r of autotile.road) roadByMask.set((r.n ? 1 : 0) | (r.e ? 2 : 0) | (r.s ? 4 : 0) | (r.w ? 8 : 0), r.index);
  const connects = (x, y) => x >= 0 && y >= 0 && x < N && y < N && (road[idx(x, y)] || bridge[idx(x, y)] > 0 || structure[idx(x, y)] >= 0);

  const tiles = Array.from({ length: N }, () => new Array(N).fill(autotile.land));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = idx(x, y);
      let t;
      if (structure[i] >= 0) t = structure[i];
      else if (bridge[i]) t = bridge[i] === 1 ? autotile.bridge.horizontal : autotile.bridge.vertical;
      else if (road[i]) {
        const mask = (connects(x, y - 1) ? 1 : 0) | (connects(x + 1, y) ? 2 : 0) | (connects(x, y + 1) ? 4 : 0) | (connects(x - 1, y) ? 8 : 0);
        t = roadByMask.get(mask) ?? autotile.land;
      } else {
        switch (kind[i]) {
          case KIND.WATER: t = waterTile(x, y); break;
          case KIND.FOREST: t = ihash(seed + 3, x, y) < 0.5 ? 15 : 16; break;
          case KIND.MOUNTAIN: t = 17; break;
          case KIND.HILL: t = ihash(seed + 4, x, y) < 0.5 ? 32 : 34; break;
          default: t = autotile.land;
        }
      }
      tiles[x][y] = t;
    }
  }
  return tiles;
}
