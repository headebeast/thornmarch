// Crop a rectangle out of a PNG (used to turn browser screenshots into the exact-size store screenshots in the manifest).
//   node scripts/lib/cropPng.mjs <in.png> <out.png> <x> <y> <w> <h>
import fs from 'fs';
import { decodePng, encodePng } from './png.mjs';

export function crop(inFile, outFile, x, y, w, h) {
  const src = decodePng(fs.readFileSync(inFile));
  if (x + w > src.width || y + h > src.height) throw new Error(`crop ${w}x${h} at ${x},${y} does not fit ${src.width}x${src.height}`);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) out.set(src.data.subarray(((y + r) * src.width + x) * 4, ((y + r) * src.width + x + w) * 4), r * w * 4);
  fs.writeFileSync(outFile, encodePng(w, h, out, 1));
  return { from: `${src.width}x${src.height}`, to: `${w}x${h}` };
}

if (process.argv[1]?.endsWith('cropPng.mjs')) {
  const [inF, outF, x, y, w, h] = process.argv.slice(2);
  console.log(crop(inF, outF, +x, +y, +w, +h));
}
