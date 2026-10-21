// Builds the final pixel buffers for every tile under a theme. Pure (no DOM): the browser asset loader and
// Node tooling call it with different pixel sources and get identical results.

import { mappingFor, remapPixels } from './themes.js';

/**
 * @param {object} p
 * @param {import('../data/contentDatabase.js').ContentDatabase} p.db
 * @param {object} p.theme                 from THEMES
 * @param {(index:number)=>Uint8ClampedArray|null} p.basePixels   original 24x24 RGBA for base-game tiles
 * @param {(def:object)=>({rgba:Uint8ClampedArray}|null)} p.overlayFor   pack tile -> overlay sprite
 * @returns {(Uint8ClampedArray|null)[]}
 */
export function composeTileSet({ db, theme, basePixels, overlayFor }) {
  const out = new Array(db.tiles.length).fill(null);
  const cache = new Map();

  const themedBase = index => {
    if (cache.has(index)) return cache.get(index);
    const src = basePixels(index);
    let px = null;
    if (src) {
      px = new Uint8ClampedArray(src);
      remapPixels(px, mappingFor(theme, db.getTile(index), index));
    }
    cache.set(index, px);
    return px;
  };

  db.tiles.forEach((def, index) => {
    if (def.art && def.ground !== undefined) {
      const ground = themedBase(def.ground);
      const overlay = overlayFor(def);
      if (!ground || !overlay) return;
      const buf = new Uint8ClampedArray(ground);
      for (let i = 0; i < buf.length; i += 4) {
        const a = overlay.rgba[i + 3] / 255;
        if (a === 0) continue;
        for (let c = 0; c < 3; c++) buf[i + c] = overlay.rgba[i + c] * a + buf[i + c] * (1 - a);
        buf[i + 3] = 255;
      }
      out[index] = buf;
    } else {
      out[index] = themedBase(index);
    }
  });
  return out;
}
