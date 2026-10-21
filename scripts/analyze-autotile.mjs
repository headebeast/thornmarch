// Reverse-engineers the original tileset's connectivity straight from the pixels:
// for every shoreline tile, which sides/corners are land; for every road tile, which sides continue.
// Output: public/data/autotile.json — consumed by the Frontier map generator so lakes get proper banks
// and roads get proper junctions without hand-maintaining index tables.
//
//   node scripts/analyze-autotile.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { decodePng } from './lib/png.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const tiles = JSON.parse(fs.readFileSync(path.join(root, 'data/tiles.json'), 'utf8'));

function load(i) {
  return decodePng(fs.readFileSync(path.join(root, `assets/images/tiles/tile_${i}.png`)));
}

const isWater = (r, g, b) => b > r + 30 && b >= g;
const isRoad = (r, g, b) => r > b + 40 && r >= g && r < 230 && g < 160;

function frac(img, x0, y0, x1, y1, pred) {
  let hit = 0;
  let total = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const o = (y * img.width + x) * 4;
      if (img.data[o + 3] === 0) continue;
      total++;
      if (pred(img.data[o], img.data[o + 1], img.data[o + 2])) hit++;
    }
  }
  return total ? hit / total : 0;
}

const water = [];
const road = [];

const BRIDGES = new Set([28, 29]);
const ROAD_TILES = new Set([20, 21, 22, 23, 24, 25, 26, 80, 81, 82, 83, 84, 85, 86, 87]);

tiles.forEach((t, i) => {
  if (BRIDGES.has(i)) return;
  if (t.type === 1) {
    const img = load(i);
    const landFrac = (x0, y0, x1, y1) => 1 - frac(img, x0, y0, x1, y1, isWater);
    const bits = {
      n: landFrac(7, 0, 16, 2) > 0.5,
      s: landFrac(7, 21, 16, 23) > 0.5,
      w: landFrac(0, 7, 2, 16) > 0.5,
      e: landFrac(21, 7, 23, 16) > 0.5,
      nw: landFrac(0, 0, 4, 4) > 0.5,
      ne: landFrac(19, 0, 23, 4) > 0.5,
      sw: landFrac(0, 19, 4, 23) > 0.5,
      se: landFrac(19, 19, 23, 23) > 0.5
    };
    // An edge that is land implies its two corners are land; keep only the *extra* corner bits.
    const edgeCorner = {
      nw: bits.n || bits.w,
      ne: bits.n || bits.e,
      sw: bits.s || bits.w,
      se: bits.s || bits.e
    };
    for (const k of ['nw', 'ne', 'sw', 'se']) if (edgeCorner[k]) bits[k] = false;
    const pureWater = !Object.values(bits).some(Boolean);
    water.push({ index: i, ...bits, pure: pureWater, animated: !!t.isAnimated });
  } else if (ROAD_TILES.has(i)) {
    const img = load(i);
    const bits = {
      n: frac(img, 9, 0, 14, 2, isRoad) > 0.5,
      s: frac(img, 9, 21, 14, 23, isRoad) > 0.5,
      w: frac(img, 0, 9, 2, 14, isRoad) > 0.5,
      e: frac(img, 21, 9, 23, 14, isRoad) > 0.5
    };
    const center = frac(img, 8, 8, 15, 15, isRoad);
    if (center > 0.5 && (bits.n || bits.s || bits.e || bits.w)) road.push({ index: i, ...bits });
  }
});

const out = {
  generated: 'scripts/analyze-autotile.mjs',
  water,
  road,
  bridge: { horizontal: 28, vertical: 29 },
  land: 18
};
fs.writeFileSync(path.join(root, 'data/autotile.json'), JSON.stringify(out));

const flag = o => ['n', 'e', 's', 'w'].filter(k => o[k]).join('') || '-';
console.log('Road tiles:', road.map(r => `${r.index}:${flag(r)}`).join('  '));
console.log(
  'Water tiles:',
  water.map(w => `${w.index}:${flag(w)}${['ne', 'se', 'sw', 'nw'].filter(k => w[k]).map(k => '+' + k).join('')}${w.pure ? '(pure)' : ''}`).join('  ')
);
