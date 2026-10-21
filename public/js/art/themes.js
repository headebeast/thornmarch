// Terrain themes — palette remaps over the original (snow) tileset. Pure data + a pixel function,
// so themes can be applied in the browser at load time, in Node tooling, or baked offline.

import { hexToRgb } from './spriteBuilder.js';

const SNOW_BASES = ['f4f4e6', 'f6f6de'];

function entries(map) {
  return Object.entries(map).map(([from, to]) => [from, hexToRgb(to)]);
}

const MEADOW = {
  id: 'meadow',
  name: 'Meadow',
  ground: entries({
    f4f4e6: '78b94a', f6f6de: '78b94a',
    '93d4e0': '9fd45e', '91d1d4': '9fd45e', c3e3d9: '92cb55',
    '36aad1': '4f9a3a', '35a8c6': '4f9a3a',
    '7b8ed3': '3f8233', '425599': '2f6a2c', '405397': '2f6a2c', '7789b8': '3f8233'
  }),
  rock: entries({
    f4f4e6: '78b94a', f6f6de: '78b94a',
    abbbf3: 'c4c9d2', c2d7f7: 'dde0e6', '7b8ed3': '8b93a3', '425599': '565e70',
    '36aad1': '6f7788', '93d4e0': 'a2a9b6', '91d1d4': 'a2a9b6', '35a8c6': '6f7788',
    '405397': '565e70', '7789b8': '8b93a3', c3e3d9: 'bfc5ce'
  }),
  tree: entries({
    f4f4e6: '78b94a', f6f6de: '78b94a',
    '93d4e0': '9fd45e', '4bb8eb': '67d45c', '005982': '0f5c3a', '015557': '0b4a35', '007071': '0f6a45'
  }),
  waterBank: entries({ f4f4e6: '78b94a', f6f6de: '78b94a' }),
  rockTiles: new Set([17, 33, 35]),
  // Subtle grass tufts drawn onto plain-ground variants so large fields don't read as flat green
  grassTufts: { base: '78b94a', light: '8fcb58', dark: '62a43e' }
};

const FROST = { id: 'frost', name: 'Frost (original)', identity: true };

export const THEMES = { meadow: MEADOW, frost: FROST };

/** Returns the colour mapping to use for a tile under a theme, or null for "unchanged". */
export function mappingFor(theme, tileDef, tileIndex) {
  if (!theme || theme.identity) return null;
  if (theme.rockTiles?.has(tileIndex)) return theme.rock;
  if (tileDef.type === 1) return theme.waterBank; // water: only the snow banks change
  if (tileDef.type === 2) return theme.tree;
  return theme.ground;
}

/** In-place recolour of an RGBA buffer. */
export function remapPixels(rgba, mapping) {
  if (!mapping) return rgba;
  const lut = new Map();
  for (const [hex, rgb] of mapping) {
    lut.set((parseInt(hex.slice(0, 2), 16) << 16) | (parseInt(hex.slice(2, 4), 16) << 8) | parseInt(hex.slice(4, 6), 16), rgb);
  }
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] === 0) continue;
    const to = lut.get((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]);
    if (to) {
      rgba[i] = to[0];
      rgba[i + 1] = to[1];
      rgba[i + 2] = to[2];
    }
  }
  return rgba;
}

/** Deterministic plain-ground variants: base grass with a few tufts. Returns n RGBA buffers (24x24). */
export function groundVariants(theme, n = 4, size = 24) {
  if (!theme?.grassTufts) return [];
  const { base, light, dark } = theme.grassTufts;
  const [br, bg, bb] = hexToRgb(base);
  const L = hexToRgb(light);
  const D = hexToRgb(dark);
  const out = [];
  let seed = 90210;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let v = 0; v < n; v++) {
    const buf = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i++) buf.set([br, bg, bb, 255], i * 4);
    const tufts = 3 + (v % 3);
    for (let t = 0; t < tufts; t++) {
      const x = 2 + Math.floor(rnd() * (size - 5));
      const y = 3 + Math.floor(rnd() * (size - 6));
      const put = (px, py, c) => {
        const o = (py * size + px) * 4;
        buf[o] = c[0];
        buf[o + 1] = c[1];
        buf[o + 2] = c[2];
      };
      put(x, y, D);
      put(x + 1, y, D);
      put(x, y - 1, L);
      put(x + 2, y - 1, L);
      put(x + 1, y - 1, D);
    }
    out.push(buf);
  }
  return out;
}
