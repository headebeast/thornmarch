// Render a Battle Royale island to PNG (real themed tiles). node scripts/preview-royale.mjs <outDir> [players=60] [seed=demo]
import fs from 'fs';
import path from 'path';
import { decodePng, encodePng } from './lib/png.mjs';
import { loadDatabase, PUBLIC_DIR } from './lib/nodeContent.mjs';
import { generateRoyaleMap } from '../public/js/modes/royale/mapGenerator.js';
import { composeTileSet } from '../public/js/art/tileComposer.js';
import { THEMES } from '../public/js/art/themes.js';
import { FRONTIER_ART } from '../public/js/modes/frontier/art.js';
import { ROYALE_ART } from '../public/js/modes/royale/content.js';
import { TEAMS } from '../public/js/config/constants.js';

const [outDir = '.', players = '60', seed = 'demo'] = process.argv.slice(2);
const db = loadDatabase();
const map = generateRoyaleMap({ players: +players, seed, loot: 'normal', storm: process.env.STORM || 'off' }, db, db.autotile);
const px = i => { const f = path.join(PUBLIC_DIR, 'assets/images/tiles', `tile_${i}.png`); return fs.existsSync(f) ? decodePng(fs.readFileSync(f)).data : null; };
const set = composeTileSet({ db, theme: THEMES.meadow, basePixels: px, overlayFor: d => (d.pack === 'royale' ? ROYALE_ART.tile(d) : FRONTIER_ART.tile(d)) });
const TS = 12; // half-size render keeps a 160x160 island viewable
const W = map.width * TS, H = map.height * TS;
const img = new Uint8ClampedArray(W * H * 4);
for (let x = 0; x < map.width; x++) for (let y = 0; y < map.height; y++) {
  const t = set[map.tiles[x][y]]; if (!t) continue;
  for (let ty = 0; ty < TS; ty++) for (let tx = 0; tx < TS; tx++) img.set(t.subarray(((ty * 2) * 24 + tx * 2) * 4, ((ty * 2) * 24 + tx * 2) * 4 + 4), ((y * TS + ty) * W + x * TS + tx) * 4);
}
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const dot = (x, y, c, r) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) img.set([...c, 255], ((y * TS + TS / 2 + dy) * W + x * TS + TS / 2 + dx) * 4); };
for (const u of map.units) dot(u.x, u.y, hex(TEAMS[u.team].light), 2);
// storm circles
const ring = (ph, col) => { for (let a = 0; a < 720; a++) { const x = Math.round((ph.x + Math.cos(a / 720 * 6.2832) * ph.r) * TS + TS / 2), y = Math.round((ph.y + Math.sin(a / 720 * 6.2832) * ph.r) * TS + TS / 2); if (x > 0 && y > 0 && x < W && y < H) img.set([...col, 255], (y * W + x) * 4); } };
map.meta.storm?.phases.slice(1, 6).forEach(p => ring(p, [255, 255, 255])); // only when STORM=slow|normal|fast
fs.mkdirSync(outDir, { recursive: true });
const half = new Uint8ClampedArray((W / 2) * (H / 2) * 4);
for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) half.set(img.subarray(((y * 2) * W + x * 2) * 4, ((y * 2) * W + x * 2) * 4 + 4), (y * (W / 2) + x) * 4);
fs.writeFileSync(path.join(outDir, `royale-${players}-${seed}.png`), encodePng(W / 2, H / 2, half, 1));
console.log(`${map.width}x${map.height}, ${map.meta.towns.length} towns, ${map.meta.crates} crates, ${map.units.length} units`);
