// Renders the procedural art packs to PNG sheets so they can be reviewed outside the browser.
//   node scripts/preview-art.mjs <outDir>

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { encodePng } from './lib/png.mjs';
import { UNIT_ART } from '../public/js/art/frontierUnits.js';

const out = process.argv[2] || '.';
fs.mkdirSync(out, { recursive: true });
const SCALE = 6;

function sheet(cols, rows, cell, painters, bg = [70, 110, 70, 255]) {
  const W = cols * cell;
  const H = rows * cell;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set(bg, i * 4);
  painters.forEach((sp, n) => {
    if (!sp) return;
    const ox = (n % cols) * cell;
    const oy = Math.floor(n / cols) * cell;
    for (let y = 0; y < sp.h; y++) {
      for (let x = 0; x < sp.w; x++) {
        const s = (y * sp.w + x) * 4;
        if (sp.rgba[s + 3] === 0) continue;
        const d = ((oy + y) * W + ox + x) * 4;
        data[d] = sp.rgba[s];
        data[d + 1] = sp.rgba[s + 1];
        data[d + 2] = sp.rgba[s + 2];
        data[d + 3] = 255;
      }
    }
  });
  return { W, H, data };
}

const names = Object.keys(UNIT_ART);
const sprites = [];
for (const team of [0, 1, 2, 3]) {
  for (const n of names) for (let f = 0; f < 2; f++) sprites.push(UNIT_ART[n](team, f));
}
// layout: per team a row of (names x 2 frames) — 20 columns, 24px cells
const s = sheet(names.length * 2, 4, 24, sprites);
fs.writeFileSync(path.join(out, 'units-frontier.png'), encodePng(s.W, s.H, s.data, SCALE));
console.log('wrote units-frontier.png', s.W * SCALE, 'x', s.H * SCALE);

// ---- buildings, composited onto the meadow ground tile ---------------------------------------
import { BUILDING_ART } from '../public/js/art/frontierBuildings.js';
import { decodePng } from './lib/png.mjs';
import { THEMES, mappingFor, remapPixels } from '../public/js/art/themes.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const tiles = JSON.parse(fs.readFileSync(path.join(root, 'data/tiles.json'), 'utf8'));
const groundPx = decodePng(fs.readFileSync(path.join(root, 'assets/images/tiles/tile_18.png'))).data;
remapPixels(groundPx, mappingFor(THEMES.meadow, tiles[18], 18));

function compose(sp) {
  const buf = new Uint8ClampedArray(groundPx);
  for (let i = 0; i < 576; i++) {
    const a = sp.rgba[i * 4 + 3] / 255;
    if (a === 0) continue;
    for (let c = 0; c < 3; c++) buf[i * 4 + c] = sp.rgba[i * 4 + c] * a + buf[i * 4 + c] * (1 - a);
  }
  return { w: 24, h: 24, rgba: buf };
}

const rows = [];
const bnames = Object.keys(BUILDING_ART);
for (const n of bnames) {
  const row = [];
  if (n === 'farm') {
    for (const st of [0, 1, 2]) row.push(compose(BUILDING_ART.farm(0, st)));
    row.push(compose(BUILDING_ART.farm(1, 2)), compose(BUILDING_ART.farm(-1, 2)));
  } else if (n === 'ruins') {
    row.push(compose(BUILDING_ART.ruins(-1, 0)), compose(BUILDING_ART.ruins(-1, 1)));
  } else {
    for (const o of [-1, 0, 1, 2, 3]) row.push(compose(BUILDING_ART[n](o)));
  }
  rows.push(row);
}
const flat = [];
for (const r of rows) for (let i = 0; i < 5; i++) flat.push(r[i] || null);
const bs = sheet(5, rows.length, 24, flat, [20, 20, 30, 255]);
fs.writeFileSync(path.join(out, 'buildings-frontier.png'), encodePng(bs.W, bs.H, bs.data, 8));
console.log('wrote buildings-frontier.png');

// ---- Battle Royale objects ------------------------------------------------------------------
import { ROYALE_BUILDING_ART } from '../public/js/art/royaleBuildings.js';
const royale = Object.values(ROYALE_BUILDING_ART).map(make => compose(make()));
const rs = sheet(royale.length, 1, 24, royale, [20, 20, 30, 255]);
fs.writeFileSync(path.join(out, 'objects-royale.png'), encodePng(rs.W, rs.H, rs.data, 10));
console.log('wrote objects-royale.png');
