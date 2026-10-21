// Renders the app icon (pixel-art shield & crossed blades) with the sprite builder -> SVG + PNGs.
//   node scripts/make-icons.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Sprite } from '../public/js/art/spriteBuilder.js';
import { MATERIALS } from '../public/js/art/palettes.js';
import { encodePng } from './lib/png.mjs';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'icons');
fs.mkdirSync(out, { recursive: true });

const N = 32;
const s = new Sprite(N, N, { ...MATERIALS, royal: ['#0c2c67', '#005bbd', '#388ce9', '#8dd9f4'] });

// crossed blades behind the shield
s.line(4, 5, 26, 27, 'steel', 2);
s.line(27, 5, 5, 27, 'steel', 2);
s.rect(2, 3, 4, 3, 'gold');
s.rect(26, 3, 4, 3, 'gold');
// shield
s.poly([[8, 6], [24, 6], [24, 17], [16, 28], [8, 17]], 'royal');
s.poly([[11, 9], [21, 9], [21, 16], [16, 23], [11, 16]], 'gold');
s.poly([[13, 11], [19, 11], [19, 15], [16, 19], [13, 15]], 'royal');
s.rect(15, 5, 2, 1, 'gold');
s.finish('#0a0d16');

// background plate
const size = N;
const rgba = new Uint8ClampedArray(size * size * 4);
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const o = (y * size + x) * 4;
    const d = Math.hypot(x - 15.5, y - 15.5) / 22;
    rgba.set([Math.round(27 - d * 18), Math.round(38 - d * 24), Math.round(66 - d * 38), 255], o);
  }
}
for (let i = 0; i < size * size; i++) {
  const a = s.rgba[i * 4 + 3] / 255;
  if (!a) continue;
  for (let c = 0; c < 3; c++) rgba[i * 4 + c] = s.rgba[i * 4 + c] * a + rgba[i * 4 + c] * (1 - a);
}
fs.writeFileSync(path.join(out, 'icon-192.png'), encodePng(size, size, rgba, 6));
fs.writeFileSync(path.join(out, 'icon-512.png'), encodePng(size, size, rgba, 16));

// SVG: pixel rects, crisp at any size
let rects = '';
for (let y = 0; y < size; y++) {
  let x = 0;
  while (x < size) {
    const o = (y * size + x) * 4;
    const col = `#${[0, 1, 2].map(c => rgba[o + c].toString(16).padStart(2, '0')).join('')}`;
    let run = x + 1;
    while (run < size && `#${[0, 1, 2].map(c => rgba[(y * size + run) * 4 + c].toString(16).padStart(2, '0')).join('')}` === col) run++;
    rects += `<rect x="${x}" y="${y}" width="${run - x}" height="1" fill="${col}"/>`;
    x = run;
  }
}
fs.writeFileSync(path.join(out, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">${rects}</svg>`);
console.log('icons written to', out);
