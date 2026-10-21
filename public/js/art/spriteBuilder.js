// Procedural pixel-art toolkit — DOM-free (runs in browsers, Node, workers).
//
// Sprites are painted with *materials* (a 4-tone ramp: deep, dark, mid, light). After composing the
// shapes, `shade()` applies rim lighting (light from the top-left) and `outline()` wraps the silhouette,
// which gives every sprite in the pack the same chunky, hand-inked look as the original art without
// hand-placing hundreds of pixels. Output is a plain RGBA buffer, so any renderer can consume it.

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export const RAMP = { DEEP: 0, DARK: 1, MID: 2, LIGHT: 3 };

export class Sprite {
  /**
   * @param {number} w
   * @param {number} h
   * @param {Object<string,string[]>} materials name -> [deep, dark, mid, light] hex ramp
   */
  constructor(w = 24, h = 24, materials = {}) {
    this.w = w;
    this.h = h;
    this.rgba = new Uint8ClampedArray(w * h * 4);
    this.mat = new Int16Array(w * h).fill(-1); // material id per pixel (-1 empty, -2 raw colour)
    this.matNames = Object.keys(materials);
    this.ramps = this.matNames.map(n => materials[n].map(hexToRgb));
    this.matIndex = Object.fromEntries(this.matNames.map((n, i) => [n, i]));
    this.shaded = false;
  }

  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** Paint one pixel with a material name, or a raw '#rrggbb' colour (not shaded). */
  px(x, y, what) {
    x = Math.round(x);
    y = Math.round(y);
    if (!this.inside(x, y)) return this;
    const i = y * this.w + x;
    if (what === null || what === undefined) {
      this.mat[i] = -1;
      this.rgba[i * 4 + 3] = 0;
      return this;
    }
    if (what[0] === '#') {
      const [r, g, b] = hexToRgb(what);
      this.rgba[i * 4] = r;
      this.rgba[i * 4 + 1] = g;
      this.rgba[i * 4 + 2] = b;
      this.rgba[i * 4 + 3] = what.length > 7 ? parseInt(what.slice(7, 9), 16) : 255;
      this.mat[i] = -2;
      return this;
    }
    const id = this.matIndex[what];
    if (id === undefined) throw new Error(`Unknown material "${what}"`);
    const [r, g, b] = this.ramps[id][RAMP.MID];
    this.rgba[i * 4] = r;
    this.rgba[i * 4 + 1] = g;
    this.rgba[i * 4 + 2] = b;
    this.rgba[i * 4 + 3] = 255;
    this.mat[i] = id;
    return this;
  }

  get(x, y) {
    return this.inside(x, y) ? this.mat[y * this.w + x] : -1;
  }

  rect(x, y, w, h, what) {
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) this.px(x + xx, y + yy, what);
    return this;
  }

  ellipse(cx, cy, rx, ry, what) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / (rx + 0.35);
        const dy = (y - cy) / (ry + 0.35);
        if (dx * dx + dy * dy <= 1) this.px(x, y, what);
      }
    }
    return this;
  }

  line(x0, y0, x1, y1, what, thick = 1) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (thick <= 1) this.px(x0, y0, what);
      else this.rect(x0, y0, thick, thick, what);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
    return this;
  }

  /** Filled polygon (even-odd scanline). Points are [[x,y],…]. */
  poly(points, what) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of points) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
      const xs = [];
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i];
        const [bx, by] = points[(i + 1) % points.length];
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.round(xs[k]); x <= Math.round(xs[k + 1]); x++) this.px(x, y, what);
      }
    }
    return this;
  }

  /**
   * Stamp ASCII art. `legend` maps a character to a material / '#hex'; '.' and ' ' are empty.
   * Great for faces and small details where primitives are clumsy.
   */
  stamp(rows, x, y, legend) {
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const ch = rows[r][c];
        if (ch === '.' || ch === ' ') continue;
        const what = legend[ch];
        if (what !== undefined) this.px(x + c, y + r, what);
      }
    }
    return this;
  }

  /** Remove a pixel's contents without disturbing others. */
  erase(x, y) {
    return this.px(x, y, null);
  }

  /** Rim shading — light from the top-left. Run once, after all shapes are painted. */
  shade() {
    if (this.shaded) return this;
    this.shaded = true;
    const { w, h } = this;
    const src = this.mat.slice();
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : src[y * w + x]);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const m = src[y * w + x];
        if (m < 0) continue;
        const up = at(x, y - 1) !== m;
        const left = at(x - 1, y) !== m;
        const down = at(x, y + 1) !== m;
        const right = at(x + 1, y) !== m;
        const lightRim = up || left;
        const shadeRim = down || right;
        let slot = RAMP.MID;
        if (down && right) slot = RAMP.DEEP;
        else if (lightRim && !shadeRim) slot = RAMP.LIGHT;
        else if (shadeRim && !lightRim) slot = RAMP.DARK;
        const [r, g, b] = this.ramps[m][slot];
        const o = (y * w + x) * 4;
        this.rgba[o] = r;
        this.rgba[o + 1] = g;
        this.rgba[o + 2] = b;
      }
    }
    return this;
  }

  /** 4-neighbour silhouette outline into empty pixels. */
  outline(colour = '#141a26') {
    const { w, h } = this;
    const [r, g, b] = hexToRgb(colour);
    const solid = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) solid[i] = this.rgba[i * 4 + 3] > 0 ? 1 : 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (solid[y * w + x]) continue;
        const n =
          (y > 0 && solid[(y - 1) * w + x]) ||
          (y < h - 1 && solid[(y + 1) * w + x]) ||
          (x > 0 && solid[y * w + x - 1]) ||
          (x < w - 1 && solid[y * w + x + 1]);
        if (n) {
          const o = (y * w + x) * 4;
          this.rgba[o] = r;
          this.rgba[o + 1] = g;
          this.rgba[o + 2] = b;
          this.rgba[o + 3] = 255;
          this.mat[y * w + x] = -2;
        }
      }
    }
    return this;
  }

  /** Composite another sprite (or raw RGBA of equal size) on top of this one. */
  overlay(other, dx = 0, dy = 0) {
    for (let y = 0; y < other.h; y++) {
      for (let x = 0; x < other.w; x++) {
        const o = (y * other.w + x) * 4;
        const a = other.rgba[o + 3];
        if (a === 0) continue;
        const tx = x + dx;
        const ty = y + dy;
        if (!this.inside(tx, ty)) continue;
        const t = (ty * this.w + tx) * 4;
        if (a === 255) {
          this.rgba[t] = other.rgba[o];
          this.rgba[t + 1] = other.rgba[o + 1];
          this.rgba[t + 2] = other.rgba[o + 2];
          this.rgba[t + 3] = 255;
        } else {
          const k = a / 255;
          const ta = this.rgba[t + 3] / 255;
          const outA = k + ta * (1 - k);
          for (let c = 0; c < 3; c++) {
            this.rgba[t + c] = (other.rgba[o + c] * k + this.rgba[t + c] * ta * (1 - k)) / (outA || 1);
          }
          this.rgba[t + 3] = outA * 255;
        }
        this.mat[ty * this.w + tx] = -2;
      }
    }
    return this;
  }

  clone() {
    const s = new Sprite(this.w, this.h, {});
    s.rgba = this.rgba.slice();
    s.mat = this.mat.slice();
    s.shaded = this.shaded;
    s.matNames = this.matNames;
    s.ramps = this.ramps;
    s.matIndex = this.matIndex;
    return s;
  }

  flipH() {
    const s = this.clone();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const a = (y * this.w + x) * 4;
        const b = (y * this.w + (this.w - 1 - x)) * 4;
        for (let c = 0; c < 4; c++) s.rgba[a + c] = this.rgba[b + c];
        s.mat[y * this.w + x] = this.mat[y * this.w + (this.w - 1 - x)];
      }
    }
    return s;
  }

  /** Soft ground shadow written only into still-empty pixels (so it never gets outlined). */
  groundShadow(cx, cy, rx, ry, alpha = 70) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        if (!this.inside(x, y)) continue;
        const dx = (x - cx) / (rx + 0.3);
        const dy = (y - cy) / (ry + 0.3);
        const o = (y * this.w + x) * 4;
        if (dx * dx + dy * dy <= 1 && this.rgba[o + 3] === 0) {
          this.rgba[o] = 8;
          this.rgba[o + 1] = 20;
          this.rgba[o + 2] = 10;
          this.rgba[o + 3] = alpha;
        }
      }
    }
    return this;
  }

  /** Finish a sprite: shade + outline. */
  finish(outlineColour = '#141a26') {
    return this.shade().outline(outlineColour);
  }
}

/** Stack frames vertically (frame 0 on top) like the original 24x48 unit sheets. */
export function stackFrames(frames) {
  const w = frames[0].w;
  const h = frames[0].h;
  const out = new Uint8ClampedArray(w * h * frames.length * 4);
  frames.forEach((f, i) => out.set(f.rgba, i * w * h * 4));
  return { w, h: h * frames.length, rgba: out };
}

