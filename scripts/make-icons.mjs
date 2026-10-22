// Renders the app icon (pixel-art shield & crossed blades) with the sprite builder → SVG + every PNG the install needs.
//   node scripts/make-icons.mjs
//
//   icon-32 … icon-512        "any" icons, drawn at whole-number pixel scales so the pixel art stays razor sharp
//   icon-maskable-192/512     for Android's adaptive icons (a circle, squircle or rounded square is cut out of the picture):
//                             the artwork is shrunk into the central 80 % "safe zone" and the plate bleeds to every edge
//   icon.svg                  the same art as crisp rectangles, for browser tabs

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

/** The dark radial plate with the sprite composited on it. `size` = plate width in art pixels, `pad` = sprite offset. */
function compose(size, pad) {
  const rgba = new Uint8ClampedArray(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c) / (size * 0.69);
      rgba.set([Math.round(27 - d * 18), Math.round(38 - d * 24), Math.round(66 - d * 38), 255], (y * size + x) * 4);
    }
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const a = s.rgba[(y * N + x) * 4 + 3] / 255;
      if (!a) continue;
      const o = ((y + pad) * size + x + pad) * 4;
      for (let k = 0; k < 3; k++) rgba[o + k] = s.rgba[(y * N + x) * 4 + k] * a + rgba[o + k] * (1 - a);
    }
  }
  return rgba;
}

/** Nearest-neighbour resize to any size (used where the target is not a whole multiple of the art). */
function resize(rgba, from, to) {
  const dst = new Uint8ClampedArray(to * to * 4);
  for (let y = 0; y < to; y++) {
    for (let x = 0; x < to; x++) {
      const sx = Math.min(from - 1, Math.floor(((x + 0.5) * from) / to));
      const sy = Math.min(from - 1, Math.floor(((y + 0.5) * from) / to));
      dst.set(rgba.subarray((sy * from + sx) * 4, (sy * from + sx) * 4 + 4), (y * to + x) * 4);
    }
  }
  return dst;
}

const write = (name, buf) => fs.writeFileSync(path.join(out, name), buf);

// ---- "any" icons: whole-number scales of the 32-pixel art ------------------------------------------------------------
const plate = compose(N, 0);
for (const [size, scale] of [[32, 1], [96, 3], [128, 4], [192, 6], [256, 8], [384, 12], [512, 16]]) write(`icon-${size}.png`, encodePng(N, N, plate, scale));

// ---- maskable: 40-pixel plate, art in the middle 32 (exactly the 80 % safe zone) ---------------------------------------
const M = 40;
const maskable = compose(M, 4);
for (const size of [192, 512]) write(`icon-maskable-${size}.png`, encodePng(size, size, resize(maskable, M, size), 1));

// ---- SVG: pixel rects, crisp at any size ----------------------------------------------------------------------------------
let rects = '';
for (let y = 0; y < N; y++) {
  let x = 0;
  const hex = px => `#${[0, 1, 2].map(k => plate[(y * N + px) * 4 + k].toString(16).padStart(2, '0')).join('')}`;
  while (x < N) {
    const col = hex(x);
    let run = x + 1;
    while (run < N && hex(run) === col) run++;
    rects += `<rect x="${x}" y="${y}" width="${run - x}" height="1" fill="${col}"/>`;
    x = run;
  }
}
write('icon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${N} ${N}" shape-rendering="crispEdges">${rects}</svg>`);
console.log('wrote icons to', path.relative(process.cwd(), out));
