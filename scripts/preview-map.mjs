// Generate a Frontier map headlessly and render it to a PNG with the real (themed) tiles.
//   node scripts/preview-map.mjs <outDir> [size=64] [players=2] [seed=demo] [theme=meadow]

import fs from 'fs';
import path from 'path';
import { decodePng, encodePng } from './lib/png.mjs';
import { loadDatabase, PUBLIC_DIR } from './lib/nodeContent.mjs';
import { generateFrontierMap } from '../public/js/modes/frontier/mapGenerator.js';
import { composeTileSet } from '../public/js/art/tileComposer.js';
import { THEMES } from '../public/js/art/themes.js';
import { FRONTIER_ART } from '../public/js/modes/frontier/art.js';

const [outDir = '.', size = '64', players = '2', seed = 'demo', themeId = 'meadow'] = process.argv.slice(2);
const db = loadDatabase();
const t0 = performance.now();
const map = generateFrontierMap({ size: +size, players: +players, seed, theme: themeId }, db, db.autotile);
console.log(`generated ${map.width}x${map.height} in ${(performance.now() - t0).toFixed(1)} ms; ${map.units.length} units; ${map.meta.pois.length} POIs`);

const px = i => {
  const f = path.join(PUBLIC_DIR, 'assets/images/tiles', `tile_${i}.png`);
  return fs.existsSync(f) ? decodePng(fs.readFileSync(f)).data : null;
};
const set = composeTileSet({ db, theme: THEMES[themeId], basePixels: px, overlayFor: d => FRONTIER_ART.tile(d) });

const TS = 24;
const W = map.width * TS;
const H = map.height * TS;
const img = new Uint8ClampedArray(W * H * 4);
for (let x = 0; x < map.width; x++) {
  for (let y = 0; y < map.height; y++) {
    const tile = set[map.tiles[x][y]];
    if (!tile) continue;
    for (let ty = 0; ty < TS; ty++) {
      const dst = ((y * TS + ty) * W + x * TS) * 4;
      img.set(tile.subarray(ty * TS * 4, (ty + 1) * TS * 4), dst);
    }
  }
}
// units as coloured dots
const COL = [[56, 140, 233], [219, 26, 103], [89, 180, 27], [0, 107, 139]];
for (const u of map.units) {
  for (let ty = 6; ty < 18; ty++) for (let tx = 6; tx < 18; tx++) {
    const o = ((u.y * TS + ty) * W + u.x * TS + tx) * 4;
    img.set([...COL[u.team], 255], o);
  }
}
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `map-${size}-${players}-${seed}.png`);
fs.writeFileSync(file, encodePng(W, H, img, 1));
// half-scale thumbnail for quick review
const half = new Uint8ClampedArray((W / 2) * (H / 2) * 4);
for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) half.set(img.subarray(((y * 2) * W + x * 2) * 4, ((y * 2) * W + x * 2) * 4 + 4), (y * (W / 2) + x) * 4);
fs.writeFileSync(path.join(outDir, `map-${size}-${players}-${seed}-small.png`), encodePng(W / 2, H / 2, half, 1));
console.log('wrote', file);
