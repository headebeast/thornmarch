// Camera — pure math, no DOM. Works in *device pixels* so art stays crisp on every screen.
//
// `ts` is the on-screen size of one tile (always an integer so pixels never shimmer); (ox, oy) is where
// tile (0,0) lands on screen. View modes:
//   fit   — the whole map visible, as large as the free area allows
//   fill  — the map covers the entire screen (pan to see the rest): what "fullscreen" usually means
//   focus — a comfortable zoom centred on a point of interest (used for huge maps)
// The map area outside the grid is dressed by the renderer ("apron"), so a fitted map never looks letter-boxed.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const easeOut = t => 1 - Math.pow(1 - t, 3);

export class Camera {
  constructor() {
    this.viewW = 1;
    this.viewH = 1;
    this.dpr = 1;
    this.ts = 48;
    this.ox = 0;
    this.oy = 0;
    this.map = null;
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.mode = 'fit';
    this.glide = null;
  }

  setViewport(w, h, dpr = 1) {
    const nw = Math.max(1, w);
    const nh = Math.max(1, h);
    // Free / focus views keep whatever is at the centre of the screen centred through resizes and rotations
    // (fit / fill re-derive their layout in reflow()).
    if (this.map && (this.mode === 'free' || this.mode === 'focus') && this.dpr === dpr) {
      this.ox += (nw - this.viewW) / 2;
      this.oy += (nh - this.viewH) / 2;
      this.ox = Math.round(this.ox);
      this.oy = Math.round(this.oy);
    }
    this.viewW = nw;
    this.viewH = nh;
    this.dpr = dpr;
  }

  setMap(map) {
    this.map = map;
  }

  setInsets(insets) {
    this.insets = { top: 0, right: 0, bottom: 0, left: 0, ...insets };
  }

  // ---- limits ------------------------------------------------------------------------------
  get maxTs() {
    return Math.round(168 * this.dpr);
  }

  get minTs() {
    return Math.max(Math.round(5 * this.dpr), Math.floor(this.fitTs() * 0.8));
  }

  freeRect() {
    const { top, right, bottom, left } = this.insets;
    return { x: left, y: top, w: Math.max(1, this.viewW - left - right), h: Math.max(1, this.viewH - top - bottom) };
  }

  fitTs() {
    if (!this.map) return 24;
    const r = this.freeRect();
    // +0.5 row: castle spires poke one half-tile above the top edge
    return Math.max(4, Math.floor(Math.min(r.w / this.map.width, r.h / (this.map.height + 0.5))));
  }

  fillTs() {
    if (!this.map) return 24;
    return Math.max(4, Math.ceil(Math.max(this.viewW / this.map.width, this.viewH / this.map.height)));
  }

  /** A readable default zoom for huge maps: ~56 CSS px per tile. */
  focusTs() {
    return Math.round(clamp(56 * this.dpr, this.minTs, this.maxTs));
  }

  // ---- transforms --------------------------------------------------------------------------
  tileToScreen(tx, ty) {
    return { x: this.ox + tx * this.ts, y: this.oy + ty * this.ts };
  }

  screenToTile(sx, sy) {
    const fx = (sx - this.ox) / this.ts;
    const fy = (sy - this.oy) / this.ts;
    return { x: Math.floor(fx), y: Math.floor(fy), fx, fy };
  }

  visibleRange(pad = 1) {
    return {
      x0: Math.floor(-this.ox / this.ts) - pad,
      y0: Math.floor(-this.oy / this.ts) - pad,
      x1: Math.ceil((this.viewW - this.ox) / this.ts) + pad,
      y1: Math.ceil((this.viewH - this.oy) / this.ts) + pad
    };
  }

  // ---- commands (instant unless `animate`) -------------------------------------------------
  _apply(ts, ox, oy, animate) {
    ts = Math.round(clamp(ts, this.minTs, this.maxTs));
    const t = { ts, ox: Math.round(ox), oy: Math.round(oy) };
    if (animate && this.map) {
      this.glide = { from: { ts: this.ts, ox: this.ox, oy: this.oy }, to: t, start: performance.now(), dur: 260 };
    } else {
      this.glide = null;
      this.ts = t.ts;
      this.ox = t.ox;
      this.oy = t.oy;
    }
  }

  fit(animate = false) {
    this.mode = 'fit';
    if (!this.map) return;
    const ts = this.fitTs();
    const r = this.freeRect();
    this._apply(ts, r.x + (r.w - this.map.width * ts) / 2, r.y + (r.h - this.map.height * ts) / 2 + ts * 0.25, animate);
  }

  fill(animate = false) {
    this.mode = 'fill';
    if (!this.map) return;
    const ts = this.fillTs();
    this._apply(ts, (this.viewW - this.map.width * ts) / 2, (this.viewH - this.map.height * ts) / 2, animate);
  }

  focus(tx, ty, ts = this.ts, animate = true) {
    this.mode = 'focus';
    const r = this.freeRect();
    const t = Math.round(clamp(ts, this.minTs, this.maxTs));
    this._apply(t, r.x + r.w / 2 - (tx + 0.5) * t, r.y + r.h / 2 - (ty + 0.5) * t, animate);
  }

  /** Pan by screen pixels (drag). */
  pan(dx, dy) {
    this.glide = null;
    this.mode = 'free';
    this.ox += dx;
    this.oy += dy;
    this.clampToMap();
  }

  /** Zoom so the tile under (sx, sy) stays put. `factor` multiplies tile size; at least ±1px so it always moves. */
  zoomAt(factor, sx = this.viewW / 2, sy = this.viewH / 2) {
    this.glide = null;
    this.mode = 'free';
    let next = Math.round(this.ts * factor);
    if (next === this.ts) next += factor > 1 ? 1 : -1;
    next = Math.round(clamp(next, this.minTs, this.maxTs));
    if (next === this.ts) return;
    const k = next / this.ts;
    this.ox = Math.round(sx - (sx - this.ox) * k);
    this.oy = Math.round(sy - (sy - this.oy) * k);
    this.ts = next;
    this.clampToMap();
  }

  setTsAt(ts, sx, sy) {
    this.zoomAt(ts / this.ts, sx, sy);
  }

  /** Keep at least a slice of the map on screen (never lose the board). */
  clampToMap() {
    if (!this.map) return;
    const mw = this.map.width * this.ts;
    const mh = this.map.height * this.ts;
    const keepX = Math.min(mw, this.viewW) * 0.35;
    const keepY = Math.min(mh, this.viewH) * 0.35;
    // when the map is smaller than the view, keep it fully on screen; otherwise allow overscroll into the apron
    this.ox = Math.round(clamp(this.ox, keepX - mw, this.viewW - keepX));
    this.oy = Math.round(clamp(this.oy, keepY - mh, this.viewH - keepY));
  }

  /** Advance programmatic glides. Returns true while animating. */
  update(now = performance.now()) {
    if (!this.glide) return false;
    const g = this.glide;
    const t = clamp((now - g.start) / g.dur, 0, 1);
    const e = easeOut(t);
    this.ts = Math.round(g.from.ts + (g.to.ts - g.from.ts) * e);
    this.ox = Math.round(g.from.ox + (g.to.ox - g.from.ox) * e);
    this.oy = Math.round(g.from.oy + (g.to.oy - g.from.oy) * e);
    if (t >= 1) this.glide = null;
    return true;
  }

  /** Re-apply the current mode after the viewport/insets change. */
  reflow() {
    if (!this.map) return;
    if (this.mode === 'fit') this.fit(false);
    else if (this.mode === 'fill') this.fill(false);
    else {
      this.ts = Math.round(clamp(this.ts, this.minTs, this.maxTs));
      this.clampToMap();
    }
  }
}
