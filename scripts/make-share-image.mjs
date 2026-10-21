// Renders the 1200×630 link-preview image from real game art (a Battle Royale island with camps, mines and crates).
//   node scripts/make-share-image.mjs
import fs from 'fs';
import path from 'path';
import { decodePng, encodePng } from './lib/png.mjs';
import { loadDatabase, PUBLIC_DIR } from './lib/nodeContent.mjs';
import { generateRoyaleMap } from '../public/js/modes/royale/mapGenerator.js';
import { composeTileSet } from '../public/js/art/tileComposer.js';
import { THEMES } from '../public/js/art/themes.js';
import { FRONTIER_ART } from '../public/js/modes/frontier/art.js';
import { ROYALE_ART } from '../public/js/modes/royale/content.js';

const W = 1200;
const H = 630;
const SCALE = 3;
const TS = 24 * SCALE; // each 24px tile drawn at 3x
const db = loadDatabase();
const map = generateRoyaleMap({ players: 40, seed: 'SHARE', loot: 'rich' }, db, db.autotile);
const px = i => {
  const f = path.join(PUBLIC_DIR, 'assets/images/tiles', `tile_${i}.png`);
  return fs.existsSync(f) ? decodePng(fs.readFileSync(f)).data : null;
};
const set = composeTileSet({ db, theme: THEMES.meadow, basePixels: px, overlayFor: d => (d.pack === 'royale' ? ROYALE_ART.tile(d) : FRONTIER_ART.tile(d)) });

// centre the picture on a War Camp near the middle of the island so buildings and crates are in frame
const cx = (map.width - 1) / 2;
const cy = (map.height - 1) / 2;
const camp = map.meta.spawns.slice().sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))[0];
const mine = map.meta.starters.find(s => s.team === camp.team)?.mine || camp;
const mid = { x: Math.round((camp.x + mine.x) / 2), y: Math.round((camp.y + mine.y) / 2) };
const cols = Math.ceil(W / TS) + 1;
const rows = Math.ceil(H / TS) + 1;
const x0 = Math.max(0, Math.min(map.width - cols, mid.x - (cols >> 1)));
const y0 = Math.max(0, Math.min(map.height - rows, mid.y - (rows >> 1)));

const img = new Uint8ClampedArray(W * H * 4);
for (let ty = 0; ty < rows; ty++) {
  for (let tx = 0; tx < cols; tx++) {
    const tile = set[map.tiles[x0 + tx][y0 + ty]];
    if (!tile) continue;
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        const dx = tx * TS + x;
        const dy = ty * TS + y;
        if (dx >= W || dy >= H) continue;
        const s = ((Math.floor(y / SCALE) * 24) + Math.floor(x / SCALE)) * 4;
        img.set(tile.subarray(s, s + 4), (dy * W + dx) * 4);
      }
    }
  }
}
// vignette + a darker band on the left so a pasted title stays readable
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const nx = (x - W / 2) / (W / 2);
    const ny = (y - H / 2) / (H / 2);
    const v = Math.min(1, Math.max(0, (Math.hypot(nx * 0.9, ny) - 0.45) / 0.85));
    const k = 1 - v * 0.78;
    const o = (y * W + x) * 4;
    img[o] *= k;
    img[o + 1] *= k;
    img[o + 2] *= k;
    img[o + 3] = 255;
  }
}
const out = path.join(PUBLIC_DIR, 'assets/icons/share.png');
fs.writeFileSync(out, encodePng(W, H, img, 1));
console.log(`wrote ${path.relative(process.cwd(), out)} (${W}x${H}) centred on camp ${camp.team} at ${camp.x},${camp.y}`);
