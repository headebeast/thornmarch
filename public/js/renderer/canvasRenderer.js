// Canvas renderer — draws the battlefield in device pixels through a Camera.
// Only visible tiles are touched, so cost depends on the screen, not the map: a 96x96 realm renders like a 15x15 map.

import { STATUS, TEAMS } from '../config/constants.js';
import { reconstructPath } from '../engine/pathfinding.js';
import { calculateDamage, canCounterAttack } from '../engine/combat.js';

const FONT = '"Jersey 15", "Segoe UI", system-ui, sans-serif';
const hash2 = (x, y, s = 0) => {
  let h = (Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s + 1, 2147483647)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export class CanvasRenderer {
  constructor(canvas, assets, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.assets = assets;
    this.camera = camera;
    this.game = null;
    this.themeId = 'frost';
    this.themeSet = null;
    this.viewTeam = null;
    this.hover = { x: -1, y: -1 };
    this.showHover = true;
    this.floatingTexts = [];
    this.anims = new Map(); // unit id -> { path, start, dur }
    this.flashes = new Map(); // unit id -> until (ms)
    this.fog = { canvas: document.createElement('canvas'), signature: '' };
    this.terrain = null; // offscreen pre-rendered terrain for the active map
    this.apronPattern = null;
    this.animatedCells = [];
    this.stormView = null; // Battle Royale: { current, next } zones
    this.stormMask = null;
    this.huntView = null; // Battle Royale: { pings, round, pingRound, memory } war-horn markers
    this.holdingIds = null; // Battle Royale: ids of claimable buildings (set by the session); enables the claim markers
    this.plan = null; // Battle Royale: the human's planning layer
    this.dpr = 1;
    this.landIndex = assets.autotile?.land ?? 18;
  }

  // ---- lifecycle -----------------------------------------------------------------------------
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.dpr = dpr;
    this.camera.setViewport(w, h, dpr);
    return dpr;
  }

  setMatch(game, themeId = 'frost') {
    this.game = game;
    this.themeId = themeId;
    this.themeSet = this.assets.getTheme(themeId);
    this.camera.setMap(game?.map || null);
    this.floatingTexts = [];
    this.anims.clear();
    this.flashes.clear();
    this.fog.signature = '';
    this.terrain = null;
    this.apronPattern = null;
    this.stormView = null;
    this.stormMask = null;
    this.huntView = null;
    this.plan = null;
    if (game?.map) this.buildTerrain(game.map);
  }

  setViewTeam(team) {
    this.viewTeam = team;
    this.fog.signature = '';
  }

  addFloatingText(x, y, text, color = '#ffffff') {
    this.floatingTexts.push({ x, y, text, color, createdAt: performance.now() });
  }

  /** Engine events -> visual effects. */
  onGameEvent(type, data) {
    const now = performance.now();
    if (type === 'move' && data.path?.length > 1) {
      this.anims.set(data.unit.id, { path: data.path, start: now, dur: Math.max(160, (data.path.length - 1) * 95) });
    } else if (type === 'attack') {
      this.flashes.set(data.defender.id, now + 220);
    } else if (type === 'tile') {
      this.repaintCell(data.x, data.y);
    }
  }

  // ---- main draw -----------------------------------------------------------------------------
  render(game, editor = null) {
    const ctx = this.ctx;
    const cam = this.camera;
    const now = performance.now();
    const map = editor ? editor.map : game?.map;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0a0d16';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!map || !this.themeSet) return;

    const ts = cam.ts;
    const frame = Math.floor(now / 300) % 2;
    const range = cam.visibleRange(1);
    const tiles = this.themeSet.tiles;
    const variants = this.themeSet.variants;

    // 1 — terrain. Games use a pre-rendered layer (one blit regardless of map size); the editor repaints live.
    if (editor || !this.terrain) {
      this.drawTerrainCells(map, range, frame, ts);
    } else {
      this.drawApron(map, ts);
      this.blitTerrain(map, ts, frame);
    }

    // 2 — castle spires (drawn on the row above the castle)
    const topTile = this.assets.images.topTiles[0];
    if (topTile) {
      const cells = game && !editor ? game.structures : this.scanStructures(map, range);
      for (const c of cells) {
        const def = this.assets.getTile(map.tiles[c.x][c.y]);
        if (def.topTileIndex >= 0) ctx.drawImage(topTile, cam.ox + c.x * ts, cam.oy + (c.y - 1) * ts, ts, ts);
      }
    }

    // 3 — dim the apron and frame the playable grid
    this.drawApronShade(map, ts);

    if (!editor && game) {
      this.drawTombs(game, ts, range);
      this.drawHighlights(game, ts, false);
      this.drawSelection(game, ts, now);
      this.drawUnits(game.units, ts, frame, now, false);
      this.drawHoldings(game, ts);
      this.drawFog(game, map, ts);
      // Everything the player can *act on* is drawn above the fog: tiles you can reach may lie beyond your sight
      this.drawHighlights(game, ts, true);
      this.drawPathPreview(game, map, ts);
      this.drawStorm(game, map, ts, now);
      this.drawHunt(game, ts, now);
      this.drawObjectives(game, ts, now);
      this.drawPlan(game, map, ts, now);
      this.drawOrderBadges(game, ts);
      this.drawCursor(game, map, ts, now);
      this.drawDamagePreview(game, ts);
    } else if (editor) {
      this.drawUnits(editor.map.units, ts, frame, now, true);
      this.drawCursor(null, map, ts, now);
    }
    this.drawFloatingTexts(ts, now);
  }

  // ---- terrain layer ---------------------------------------------------------------------------
  tileImageAt(map, x, y, frame = 0) {
    const index = map.tiles[x][y];
    const def = this.assets.getTile(index);
    const { tiles, variants } = this.themeSet;
    let drawIndex = index;
    if (def.isAnimated && frame === 1 && def.animationTileIndex >= 0) drawIndex = def.animationTileIndex;
    let img = tiles[drawIndex];
    if (index === this.landIndex && variants.length && hash2(x, y) < 0.55) img = variants[Math.floor(hash2(x, y, 7) * variants.length)];
    return img;
  }

  buildTerrain(map) {
    const c = document.createElement('canvas');
    c.width = map.width * 24;
    c.height = map.height * 24;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    this.animatedCells = [];
    for (let x = 0; x < map.width; x++) {
      for (let y = 0; y < map.height; y++) {
        const img = this.tileImageAt(map, x, y, 0);
        if (img) ctx.drawImage(img, x * 24, y * 24);
        const def = this.assets.getTile(map.tiles[x][y]);
        if (def.isAnimated && def.animationTileIndex >= 0) this.animatedCells.push({ x, y });
      }
    }
    this.terrain = { canvas: c, ctx, map };
  }

  repaintCell(x, y) {
    const t = this.terrain;
    if (!t || !t.map || x < 0 || y < 0 || x >= t.map.width || y >= t.map.height) return;
    const img = this.tileImageAt(t.map, x, y, 0);
    t.ctx.clearRect(x * 24, y * 24, 24, 24);
    if (img) t.ctx.drawImage(img, x * 24, y * 24);
    const def = this.assets.getTile(t.map.tiles[x][y]);
    const i = this.animatedCells.findIndex(c => c.x === x && c.y === y);
    if (def.isAnimated && def.animationTileIndex >= 0) {
      if (i < 0) this.animatedCells.push({ x, y });
    } else if (i >= 0) this.animatedCells.splice(i, 1);
  }

  blitTerrain(map, ts, frame) {
    const ctx = this.ctx;
    const cam = this.camera;
    const k = ts / 24;
    // visible source rectangle in terrain-layer pixels, snapped to whole tiles so scaling never shears one
    const sx0 = Math.max(0, Math.floor(-cam.ox / k));
    const sy0 = Math.max(0, Math.floor(-cam.oy / k));
    const sx1 = Math.min(map.width * 24, Math.ceil((this.canvas.width - cam.ox) / k));
    const sy1 = Math.min(map.height * 24, Math.ceil((this.canvas.height - cam.oy) / k));
    if (sx1 <= sx0 || sy1 <= sy0) return;
    const tx0 = Math.floor(sx0 / 24) * 24;
    const ty0 = Math.floor(sy0 / 24) * 24;
    const tx1 = Math.min(map.width * 24, Math.ceil(sx1 / 24) * 24);
    const ty1 = Math.min(map.height * 24, Math.ceil(sy1 / 24) * 24);
    ctx.drawImage(this.terrain.canvas, tx0, ty0, tx1 - tx0, ty1 - ty0, cam.ox + (tx0 / 24) * ts, cam.oy + (ty0 / 24) * ts, ((tx1 - tx0) / 24) * ts, ((ty1 - ty0) / 24) * ts);

    if (frame === 1) {
      for (const c of this.animatedCells) {
        const sx = cam.ox + c.x * ts;
        const sy = cam.oy + c.y * ts;
        if (sx + ts < 0 || sy + ts < 0 || sx > this.canvas.width || sy > this.canvas.height) continue;
        const img = this.tileImageAt(map, c.x, c.y, 1);
        if (img) ctx.drawImage(img, sx, sy, ts, ts);
      }
    }
  }

  /** Tiled scenery outside the playable grid (pattern fill: cost is independent of how much is visible). */
  drawApron(map, ts) {
    const ctx = this.ctx;
    const cam = this.camera;
    if (!this.apronPattern) {
      const N = 12;
      const c = document.createElement('canvas');
      c.width = N * 24;
      c.height = N * 24;
      const pc = c.getContext('2d');
      pc.imageSmoothingEnabled = false;
      const { tiles, variants } = this.themeSet;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const r = hash2(x, y, 3);
          const img = r < 0.1 ? tiles[hash2(x, y, 5) < 0.5 ? 15 : 16] : variants.length && r < 0.55 ? variants[Math.floor(hash2(x, y, 7) * variants.length)] : tiles[this.landIndex];
          if (img) pc.drawImage(img, x * 24, y * 24);
        }
      }
      this.apronPattern = ctx.createPattern(c, 'repeat');
    }
    const k = ts / 24;
    ctx.save();
    ctx.setTransform(k, 0, 0, k, cam.ox, cam.oy);
    ctx.fillStyle = this.apronPattern;
    ctx.fillRect(-cam.ox / k, -cam.oy / k, this.canvas.width / k + 1, this.canvas.height / k + 1);
    ctx.restore();
  }

  scanStructures(map, range) {
    const out = [];
    for (let y = Math.max(0, range.y0); y <= Math.min(map.height - 1, range.y1 + 1); y++) {
      for (let x = Math.max(0, range.x0); x <= Math.min(map.width - 1, range.x1); x++) out.push({ x, y });
    }
    return out;
  }

  /** Per-tile path used by the editor (live edits). */
  drawTerrainCells(map, range, frame, ts) {
    const ctx = this.ctx;
    const cam = this.camera;
    const tiles = this.themeSet.tiles;
    const variants = this.themeSet.variants;
    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        const sx = cam.ox + x * ts;
        const sy = cam.oy + y * ts;
        const inside = x >= 0 && y >= 0 && x < map.width && y < map.height;
        let img;
        if (inside) img = this.tileImageAt(map, x, y, frame);
        else {
          const r = hash2(x, y, 3);
          img = r < 0.07 ? tiles[hash2(x, y, 5) < 0.5 ? 15 : 16] : variants.length && r < 0.5 ? variants[Math.floor(hash2(x, y, 7) * variants.length)] : tiles[this.landIndex];
        }
        if (img) ctx.drawImage(img, sx, sy, ts, ts);
      }
    }
  }

  // ---- Battle Royale overlays ------------------------------------------------------------------------------
  /** Storm: a violet haze outside the safe circle (soft edge via a 1px/tile mask), the circle itself, and the next one. */
  drawStorm(game, map, ts, now) {
    const st = this.stormView;
    if (!st) return;
    const ctx = this.ctx;
    const cam = this.camera;
    const z = st.current;
    const sig = `${z.x},${z.y},${z.r},${map.width}`;
    if (!this.stormMask || this.stormMask.sig !== sig) {
      const c = this.stormMask?.canvas || document.createElement('canvas');
      c.width = map.width;
      c.height = map.height;
      const img = new ImageData(map.width, map.height);
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const o = (y * map.width + x) * 4;
          const outside = Math.hypot(x - z.x, y - z.y) > z.r;
          img.data[o] = 88;
          img.data[o + 1] = 22;
          img.data[o + 2] = 140;
          img.data[o + 3] = outside ? 112 : 0;
        }
      }
      c.getContext('2d').putImageData(img, 0, 0);
      this.stormMask = { canvas: c, sig };
    }
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.stormMask.canvas, cam.ox, cam.oy, map.width * ts, map.height * ts);
    ctx.restore();

    const ring = (zone, color, dash, width) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.lineDashOffset = -((now / 40) % 64);
      ctx.beginPath();
      ctx.arc(cam.ox + (zone.x + 0.5) * ts, cam.oy + (zone.y + 0.5) * ts, zone.r * ts, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    };
    ring(z, 'rgba(206, 150, 255, 0.95)', [ts * 0.5, ts * 0.25], Math.max(2, ts / 9));
    if (st.next) ring(st.next, 'rgba(255, 255, 255, 0.85)', [ts * 0.3, ts * 0.3], Math.max(2, ts / 12));
  }

  /**
   * Battle Royale holdings: a rim in the owner's colour round every held building (readable from far out) and, once zoomed
   * in, their banner on a pole. Ownership is not part of the tile, so 60 warbands share one set of building art. Other
   * warbands' holdings only show while you can see the tile.
   */
  drawHoldings(game, ts) {
    const holds = game.holds;
    if (!holds) return;
    const ctx = this.ctx;
    const cam = this.camera;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const vis = game.vision && this.viewTeam !== null && !game.vision.revealAll ? game.vision : null;
    const k = ts / 24;
    const px = Math.max(1, Math.round(k)); // one art pixel
    for (const s of game.structures) {
      const owner = holds[s.y * game.map.width + s.x];
      if (owner === undefined) continue;
      if (vis && owner !== this.viewTeam && !vis.isVisible(this.viewTeam, s.x, s.y)) continue;
      const x = cam.ox + s.x * ts;
      const y = cam.oy + s.y * ts;
      if (x < -ts || y < -ts || x > W || y > H) continue;
      const t = TEAMS[owner] || TEAMS[0];
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.strokeStyle = t.light;
      ctx.lineWidth = px;
      ctx.strokeRect(x + px / 2, y + px / 2, ts - px, ts - px);
      ctx.restore();
      if (ts < 16) continue;
      // pole + swallow-tail pennant, outlined so it reads on any ground
      const ox = x + 17 * k;
      const oy = y + 0.5 * k;
      ctx.fillStyle = '#141a26';
      ctx.fillRect(ox - px, oy - px, 2 * px + px, 13 * k + px);
      ctx.fillStyle = '#c08a52';
      ctx.fillRect(ox, oy, px, 13 * k);
      ctx.beginPath();
      ctx.moveTo(ox + px, oy);
      ctx.lineTo(ox + 7 * k, oy);
      ctx.lineTo(ox + 5 * k, oy + 3 * k);
      ctx.lineTo(ox + 7 * k, oy + 6 * k);
      ctx.lineTo(ox + px, oy + 6 * k);
      ctx.closePath();
      ctx.fillStyle = t.color;
      ctx.fill();
      ctx.lineWidth = px;
      ctx.strokeStyle = '#141a26';
      ctx.stroke();
      ctx.fillStyle = t.light;
      ctx.fillRect(ox + 2 * px, oy + px, 4 * k - px, px); // highlight along the top edge
    }
  }

  /** A bobbing arrow over every known building that is not yours — the answer to "what can I do here?". */
  drawObjectives(game, ts, now) {
    if (!this.holdingIds || !game.holds || this.viewTeam === null || ts < 14) return;
    const ctx = this.ctx;
    const cam = this.camera;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const vis = game.vision && !game.vision.revealAll ? game.vision : null;
    for (const s of game.structures) {
      const tile = this.assets.getTile(game.map.tiles[s.x][s.y]);
      if (!this.holdingIds.has(tile.building)) continue;
      const owner = game.holds[s.y * game.map.width + s.x] ?? -1;
      if (owner === this.viewTeam) continue;
      const seen = !vis || vis.isVisible(this.viewTeam, s.x, s.y);
      if (vis && !seen && !vis.isExplored(this.viewTeam, s.x, s.y)) continue;
      if (owner >= 0 && !seen) continue; // somebody holds it, but you cannot see that now
      const cx = cam.ox + (s.x + 0.5) * ts;
      const cy = cam.oy + s.y * ts - ts * 0.06 + Math.sin(now / 280 + s.x * 0.7 + s.y * 0.4) * ts * 0.06;
      if (cx < -ts || cy < -ts || cx > W + ts || cy > H + ts) continue;
      const w = ts * 0.2;
      const h = ts * 0.26;
      ctx.save();
      ctx.globalAlpha = seen ? 1 : 0.55;
      ctx.beginPath();
      ctx.moveTo(cx - w, cy - h);
      ctx.lineTo(cx + w, cy - h);
      ctx.lineTo(cx, cy);
      ctx.closePath();
      ctx.fillStyle = owner < 0 ? '#ffd54a' : '#ff7a6a';
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, ts / 18);
      ctx.strokeStyle = 'rgba(8, 11, 20, 0.95)';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * War-horn markers: where each warband stood when the horn sounded. The current horn pulses; older ones fade as "last
   * known position" until they go cold.
   */
  drawHunt(game, ts, now) {
    const hv = this.huntView;
    if (!hv || !hv.pings.length) return;
    const ctx = this.ctx;
    const cam = this.camera;
    const age = hv.round - hv.pingRound;
    const fresh = age <= 0;
    const fade = fresh ? 1 : Math.max(0.28, 1 - age / (hv.memory + 1));
    const W = this.canvas.width;
    const H = this.canvas.height;
    for (const p of hv.pings) {
      const cx = cam.ox + (p.x + 0.5) * ts;
      const cy = cam.oy + (p.y + 0.5) * ts;
      if (cx < -ts * 3 || cy < -ts * 3 || cx > W + ts * 3 || cy > H + ts * 3) continue;
      const t = TEAMS[p.team] || TEAMS[0];
      ctx.save();
      ctx.lineCap = 'round';
      if (fresh) {
        const k = ((now / 1300) + p.team * 0.137) % 1; // an expanding ripple, like a horn call travelling outward
        ctx.globalAlpha = (1 - k) * 0.85;
        ctx.strokeStyle = t.light;
        ctx.lineWidth = Math.max(2, ts / 11);
        ctx.beginPath();
        ctx.arc(cx, cy, ts * (0.5 + k * 1.2), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = fade;
      ctx.setLineDash([ts * 0.16, ts * 0.13]);
      ctx.lineDashOffset = -((now / 60) % 64);
      ctx.strokeStyle = t.light;
      ctx.lineWidth = Math.max(2, ts / 14);
      ctx.beginPath();
      ctx.arc(cx, cy, ts * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      const r = ts * 0.22; // a banner-coloured diamond with a dark rim
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fillStyle = t.color;
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, ts / 16);
      ctx.strokeStyle = 'rgba(8, 11, 20, 0.95)';
      ctx.stroke();
      if (ts >= 26) {
        const name = game.teamNames?.[p.team] || t.name;
        this.label(`${name} ×${p.n}`, cx, cy - ts * 0.78, Math.max(13, ts * 0.34), t.light, 'center');
      }
      ctx.restore();
    }
  }

  /** The human's planning layer: reachable tiles, path preview, targets, and every order already given. */
  drawPlan(game, map, ts, now) {
    const plan = this.plan;
    if (!plan) return;
    const ctx = this.ctx;
    const cam = this.camera;
    const center = p => [cam.ox + (p.x + 0.5) * ts, cam.oy + (p.y + 0.5) * ts];

    // existing orders: ghost at the destination, dashed move line, red line to the target
    for (const o of plan.orders) {
      const u = o.unit;
      const [ux, uy] = center(u);
      const dest = o.move || { x: u.x, y: u.y };
      const [dx, dy] = center(dest);
      ctx.save();
      ctx.lineWidth = Math.max(2, ts / 14);
      ctx.setLineDash([ts * 0.22, ts * 0.16]);
      if (o.move) {
        ctx.strokeStyle = 'rgba(255, 235, 160, 0.9)';
        ctx.beginPath();
        ctx.moveTo(ux, uy);
        ctx.lineTo(dx, dy);
        ctx.stroke();
      }
      if (o.target) {
        const [tx, ty] = center(o.target);
        ctx.strokeStyle = 'rgba(255, 110, 100, 0.95)';
        ctx.beginPath();
        ctx.moveTo(dx, dy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeRect(cam.ox + o.target.x * ts + 2, cam.oy + o.target.y * ts + 2, ts - 4, ts - 4);
      }
      ctx.restore();
      if (o.move) {
        ctx.save();
        ctx.globalAlpha = 0.55;
        this.drawUnit({ ...u, standby: false, x: dest.x, y: dest.y }, cam.ox + dest.x * ts, cam.oy + dest.y * ts, ts, false, 0, now);
        ctx.restore();
      }
      if (o.label) this.pill(o.label, dx, cam.oy + dest.y * ts, '#ffe9a8', ts);
    }

    if (plan.reachable?.length) {
      const sz = this.assets.images.alpha?.height || 24;
      const vis = game.vision && !game.vision.revealAll ? game.vision : null;
      for (const p of plan.reachable) {
        const hidden = vis && !vis.isVisible(this.viewTeam, p.x, p.y);
        const sx = cam.ox + p.x * ts;
        const sy = cam.oy + p.y * ts;
        ctx.save();
        ctx.globalAlpha = hidden ? 0.5 : 0.55;
        if (this.assets.images.alpha) ctx.drawImage(this.assets.images.alpha, sz, 0, sz, sz, sx, sy, ts, ts);
        if (hidden) {
          ctx.globalAlpha = 0.85;
          ctx.strokeStyle = '#ffe08a';
          ctx.lineWidth = Math.max(1, Math.round(ts / 24));
          ctx.strokeRect(sx + 0.5, sy + 0.5, ts - 1, ts - 1);
        }
        ctx.restore();
      }
    }

    if (plan.mode === 'target') {
      const sz = this.assets.images.alpha?.height || 24;
      for (const t of plan.targets) {
        ctx.save();
        ctx.globalAlpha = 0.6;
        if (this.assets.images.alpha) ctx.drawImage(this.assets.images.alpha, 0, 0, sz, sz, cam.ox + t.x * ts, cam.oy + t.y * ts, ts, ts);
        ctx.restore();
      }
    }

    // path to the hovered destination
    if (plan.mode === 'move' && plan.pathField && this.hover.x >= 0 && plan.reachable.some(r => r.x === this.hover.x && r.y === this.hover.y)) {
      const u = plan.selected;
      const path = reconstructPath(plan.pathField, u.x, u.y, this.hover.x, this.hover.y);
      if (path.length > 1) {
        const pts = path.map(p => center(p));
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const [w, c] of [[Math.max(5, ts * 0.22), 'rgba(10,13,22,0.85)'], [Math.max(3, ts * 0.12), '#ffd45e']]) {
          ctx.strokeStyle = c;
          ctx.lineWidth = w;
          ctx.beginPath();
          pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
          ctx.stroke();
        }
        ctx.restore();
        const cur = this.assets.images.cursorMoveTarget;
        if (cur) {
          const size = Math.round((ts * 26) / 24);
          ctx.drawImage(cur, cam.ox + this.hover.x * ts + Math.floor((ts - size) / 2), cam.oy + this.hover.y * ts + Math.floor((ts - size) / 2), size, size);
        }
      }
    }

    // damage preview for a hovered target
    if (plan.mode === 'target' && plan.dest) {
      const tgt = plan.targets.find(t => t.x === this.hover.x && t.y === this.hover.y);
      if (tgt) {
        const atk = plan.selected;
        const ox = atk.x;
        const oy = atk.y;
        atk.x = plan.dest.x;
        atk.y = plan.dest.y;
        const dmg = calculateDamage(game, atk, tgt.unit, false);
        const kill = dmg >= tgt.unit.currentHp;
        const counter = !kill && canCounterAttack(atk, tgt.unit) ? calculateDamage(game, tgt.unit, atk, false) : 0;
        atk.x = ox;
        atk.y = oy;
        this.pill(kill ? `−${dmg}  KILL` : counter ? `−${dmg}  ↩${counter}` : `−${dmg}`, cam.ox + tgt.x * ts + ts / 2, cam.oy + tgt.y * ts - ts * 0.15, kill ? '#ffb4a8' : '#ffe0d6', ts);
      }
    }

    // pulsing ring on the selected unit
    if (plan.selected) {
      const u = plan.selected;
      const pulse = 0.5 + 0.5 * Math.sin(now / 220);
      ctx.save();
      ctx.strokeStyle = `rgba(255, 224, 138, ${0.6 + 0.4 * pulse})`;
      ctx.lineWidth = Math.max(2, ts / 16);
      ctx.beginPath();
      ctx.ellipse(cam.ox + u.x * ts + ts / 2, cam.oy + u.y * ts + ts * 0.82, ts * (0.38 + 0.03 * pulse), ts * 0.16, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Unit badges for the human's own squad during planning: ✓ ordered, ! idle. */
  drawOrderBadges(game, ts) {
    const plan = this.plan;
    if (!plan) return;
    const cam = this.camera;
    for (const u of plan.squad) {
      const ordered = plan.orders.some(o => o.unit.id === u.id);
      const sx = cam.ox + u.x * ts;
      const sy = cam.oy + u.y * ts;
      const r = Math.max(5, ts * 0.12);
      this.ctx.fillStyle = ordered ? '#3ecf74' : '#ffb04a';
      this.ctx.strokeStyle = '#0a0d16';
      this.ctx.lineWidth = Math.max(1.5, ts / 20);
      this.ctx.beginPath();
      this.ctx.arc(sx + ts - r - 2, sy + r + 2, r, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.stroke();
    }
  }

  drawApronShade(map, ts) {
    const ctx = this.ctx;
    const cam = this.camera;
    const x0 = cam.ox;
    const y0 = cam.oy;
    const x1 = cam.ox + map.width * ts;
    const y1 = cam.oy + map.height * ts;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.fillStyle = 'rgba(8, 11, 22, 0.74)';
    ctx.fillRect(0, 0, W, Math.max(0, y0));
    ctx.fillRect(0, Math.min(H, y1), W, Math.max(0, H - y1));
    ctx.fillRect(0, Math.max(0, y0), Math.max(0, x0), Math.max(0, Math.min(H, y1) - Math.max(0, y0)));
    ctx.fillRect(Math.min(W, x1), Math.max(0, y0), Math.max(0, W - x1), Math.max(0, Math.min(H, y1) - Math.max(0, y0)));
    const lw = Math.max(2, Math.round(ts / 14));
    ctx.strokeStyle = 'rgba(233, 185, 73, 0.9)';
    ctx.lineWidth = lw;
    ctx.strokeRect(x0 - lw / 2, y0 - lw / 2, x1 - x0 + lw, y1 - y0 + lw);
    ctx.strokeStyle = 'rgba(8, 11, 22, 0.9)';
    ctx.lineWidth = lw;
    ctx.strokeRect(x0 - lw * 1.5, y0 - lw * 1.5, x1 - x0 + lw * 3, y1 - y0 + lw * 3);
  }

  drawTombs(game, ts, range) {
    const img = this.assets.images.tombstone;
    if (!img) return;
    for (const t of game.tombs) {
      if (this.viewTeam !== null && !game.isTileVisible(this.viewTeam, t.x, t.y)) continue;
      this.ctx.drawImage(img, this.camera.ox + t.x * ts, this.camera.oy + t.y * ts, ts, ts);
    }
  }

  /**
   * Move/attack overlays. Pass 1 (`fogged=false`) paints under units on visible ground; pass 2 (`fogged=true`)
   * repaints the tiles hidden by fog on top of it, with a crisp outline, so a reachable-but-unseen tile
   * never looks unreachable.
   */
  drawHighlights(game, ts, fogged) {
    const alpha = this.assets.images.alpha;
    const ctx = this.ctx;
    const cam = this.camera;
    const sz = alpha ? alpha.height : 24;
    const vis = game.vision && this.viewTeam !== null && !game.vision.revealAll ? game.vision : null;
    const hidden = p => vis && !vis.isVisible(this.viewTeam, p.x, p.y);
    const blit = (list, frame, fallback, edge) => {
      ctx.save();
      for (const p of list) {
        const isHidden = hidden(p);
        if (isHidden !== fogged) continue;
        const sx = cam.ox + p.x * ts;
        const sy = cam.oy + p.y * ts;
        ctx.globalAlpha = fogged ? 0.5 : 0.62;
        if (alpha) ctx.drawImage(alpha, frame * sz, 0, sz, sz, sx, sy, ts, ts);
        else {
          ctx.fillStyle = fallback;
          ctx.fillRect(sx, sy, ts, ts);
        }
        if (fogged) {
          ctx.globalAlpha = 0.85;
          ctx.strokeStyle = edge;
          ctx.lineWidth = Math.max(1, Math.round(ts / 24));
          ctx.strokeRect(sx + 0.5, sy + 0.5, ts - 1, ts - 1);
        }
      }
      ctx.restore();
    };
    if (game.phase === 'MOVE' && game.reachable.length) blit(game.reachable, 1, 'rgba(250,204,21,0.35)', '#ffe08a');
    if (['ATTACK', 'SUMMON', 'HEAL', 'CUSTOM'].includes(game.phase) && game.actionTargets.length) {
      blit(game.actionTargets, 0, 'rgba(239,68,68,0.45)', '#ff9a8a');
    }
  }

  drawPathPreview(game, map, ts) {
    if (game.phase !== 'MOVE' || !game.selectedUnit || !game.pathField) return;
    const { x, y } = this.hover;
    if (!this.showHover || x < 0 || y < 0 || x >= map.width || y >= map.height) return;
    const entry = game.reachable.find(r => r.x === x && r.y === y);
    if (!entry) return;
    const u = game.selectedUnit;
    const path = reconstructPath(game.pathField, u.x, u.y, x, y);
    if (path.length < 2) return;
    const ctx = this.ctx;
    const cam = this.camera;
    const pts = path.map(p => [cam.ox + p.x * ts + ts / 2, cam.oy + p.y * ts + ts / 2]);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [w, c] of [[Math.max(5, ts * 0.22), 'rgba(10,13,22,0.85)'], [Math.max(3, ts * 0.12), '#ffd45e']]) {
      ctx.strokeStyle = c;
      ctx.lineWidth = w;
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.stroke();
    }
    ctx.restore();

    const cur = this.assets.images.cursorMoveTarget;
    if (cur) {
      const size = Math.round((ts * 26) / 24);
      const off = Math.floor((ts - size) / 2);
      ctx.drawImage(cur, cam.ox + x * ts + off, cam.oy + y * ts + off, size, size);
    }
    this.pill(`${entry.cost} MP`, cam.ox + x * ts + ts / 2, cam.oy + y * ts - ts * 0.12, '#ffe9a8', ts);
  }

  drawSelection(game, ts, now) {
    const u = game.selectedUnit;
    if (!u) return;
    const ctx = this.ctx;
    const cam = this.camera;
    const pulse = 0.5 + 0.5 * Math.sin(now / 220);
    const cx = cam.ox + u.x * ts + ts / 2;
    const cy = cam.oy + u.y * ts + ts * 0.82;
    ctx.save();
    ctx.strokeStyle = `rgba(255, 224, 138, ${0.6 + 0.4 * pulse})`;
    ctx.lineWidth = Math.max(2, ts / 16);
    ctx.beginPath();
    ctx.ellipse(cx, cy, ts * (0.38 + 0.03 * pulse), ts * 0.16, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  unitDrawPos(unit, ts, now) {
    const cam = this.camera;
    const anim = this.anims.get(unit.id);
    if (anim) {
      const t = (now - anim.start) / anim.dur;
      if (t >= 1) this.anims.delete(unit.id);
      else {
        const segs = anim.path.length - 1;
        const f = Math.max(0, t) * segs;
        const i = Math.min(segs - 1, Math.floor(f));
        const k = f - i;
        const a = anim.path[i];
        const b = anim.path[i + 1];
        return {
          x: cam.ox + (a.x + (b.x - a.x) * k) * ts,
          y: cam.oy + (a.y + (b.y - a.y) * k) * ts - Math.sin(k * Math.PI) * ts * 0.1,
          moving: true
        };
      }
    }
    return { x: cam.ox + unit.x * ts, y: cam.oy + unit.y * ts, moving: false };
  }

  drawUnits(units, ts, frame, now, isEditor) {
    const game = this.game;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const list = isEditor ? units : [...units].sort((a, b) => a.y - b.y || a.id - b.id);
    for (const unit of list) {
      if (!isEditor) {
        if (unit.currentHp <= 0) continue;
        if (this.viewTeam !== null && !game.canSeeUnit(this.viewTeam, unit)) continue;
      }
      const pos = isEditor
        ? { x: this.camera.ox + unit.x * ts, y: this.camera.oy + unit.y * ts, moving: false }
        : this.unitDrawPos(unit, ts, now);
      if (pos.x + ts < 0 || pos.y + ts < 0 || pos.x > W || pos.y > H) continue;
      this.drawUnit(unit, pos.x, pos.y, ts, isEditor, pos.moving ? frame : isEditor ? 0 : unit.standby ? 0 : frame, now);
    }
  }

  drawUnit(unit, sx, sy, ts, isEditor, frame, now) {
    const ctx = this.ctx;
    const team = unit.team ?? 0;
    const gray = !isEditor && unit.standby;
    const spr = this.assets.getUnitSprite(unit.index, team, gray);
    sx = Math.round(sx);
    sy = Math.round(sy);

    if (spr?.img) {
      // soft contact shadow
      ctx.fillStyle = 'rgba(6, 10, 18, 0.28)';
      ctx.beginPath();
      ctx.ellipse(sx + ts / 2, sy + ts * 0.88, ts * 0.3, ts * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.drawImage(spr.img, spr.sx, frame * spr.size, spr.size, spr.size, sx, sy, ts, ts);
      if (!isEditor && (this.flashes.get(unit.id) || 0) > now) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.65;
        ctx.drawImage(spr.img, spr.sx, frame * spr.size, spr.size, spr.size, sx, sy, ts, ts);
        ctx.restore();
      }
    }

    // Commander head overlay (matches CanvasRenderer.java#drawHead)
    const isCmd = unit.isCommander || unit.index === (this.assets.unitConfig?.commander_index ?? 9);
    const heads = this.assets.images.heads;
    if (isCmd && heads) {
      const hw = Math.floor(heads.width / 4);
      const idx = Math.min(3, Math.max(0, team));
      ctx.drawImage(heads, idx * hw, 0, hw, heads.height, sx + (ts * 7) / 24, sy + (frame * ts) / 24, (ts * 13) / 24, (ts * 12) / 24);
    }
    if (isEditor) return;

    const st = this.assets.images.status;
    if (unit.status && st) {
      const w = Math.floor(st.width / 4);
      const map = { [STATUS.POISONED]: 0, [STATUS.INSPIRED]: 1, [STATUS.SLOWED]: 2, [STATUS.BLINDED]: 3 };
      ctx.drawImage(st, (map[unit.status.type] ?? 0) * w, 0, w, st.height, sx, sy, Math.floor((ts * w) / 24), Math.floor((ts * st.height) / 24));
    }
    const lv = this.assets.images.level;
    if (unit.level > 0 && lv) {
      const w = Math.floor(lv.width / 3);
      const dw = Math.floor((ts * w) / 24);
      ctx.drawImage(lv, Math.min(2, unit.level - 1) * w, 0, w, lv.height, sx + ts - dw, sy, dw, Math.floor((ts * lv.height) / 24));
    }

    if (unit.currentHp < unit.max_hp) {
      const pct = unit.currentHp / unit.max_hp;
      const bw = Math.round(ts * 0.7);
      const bh = Math.max(3, Math.round(ts * 0.08));
      const bx = sx + Math.round((ts - bw) / 2);
      const by = sy + ts - bh - 1;
      ctx.fillStyle = 'rgba(8,11,20,0.85)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      ctx.fillStyle = pct > 0.55 ? '#58d36b' : pct > 0.28 ? '#f2c23e' : '#ee5a4a';
      ctx.fillRect(bx, by, Math.max(1, Math.round(bw * pct)), bh);
      if (ts >= 40 * this.dpr * 0.8) this.label(`${unit.currentHp}`, sx + 2, by - 3, Math.max(15, ts * 0.3), '#fff7d6', 'left');
    }
  }

  drawFog(game, map, ts) {
    const vis = game.vision;
    const team = this.viewTeam;
    if (!vis || vis.revealAll || team === null) return;
    const f = this.fog;
    const sig = `${vis.version}:${team}:${map.width}`;
    if (f.signature !== sig) {
      f.signature = sig;
      f.canvas.width = map.width;
      f.canvas.height = map.height;
      const img = new ImageData(map.width, map.height);
      for (let i = 0; i < map.width * map.height; i++) {
        const o = i * 4;
        img.data[o] = 8;
        img.data[o + 1] = 12;
        img.data[o + 2] = 26;
        img.data[o + 3] = vis.visible[team][i] ? 0 : vis.explored[team][i] ? 132 : 244;
      }
      f.canvas.getContext('2d').putImageData(img, 0, 0);
    }
    const ctx = this.ctx;
    const cam = this.camera;
    ctx.save();
    ctx.imageSmoothingEnabled = true; // smooth edge between seen and unseen
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(f.canvas, cam.ox, cam.oy, map.width * ts, map.height * ts);
    ctx.restore();
  }

  drawCursor(game, map, ts, now) {
    const { x, y } = this.hover;
    if (!this.showHover || x < 0 || y < 0 || x >= map.width || y >= map.height) return;
    const ctx = this.ctx;
    const cam = this.camera;
    const isAction =
      game && ['ATTACK', 'SUMMON', 'HEAL', 'CUSTOM'].includes(game.phase) && game.actionTargets.some(t => t.x === x && t.y === y);
    const phase = Math.floor(now / 300);

    if (isAction && this.assets.images.cursorAttack) {
      // 3-frame sheet, each frame 40x41 (see AttackCursorAnimator.java)
      const img = this.assets.images.cursorAttack;
      const fw = Math.floor(img.width / 3);
      const w = Math.round((ts * 40) / 24);
      const h = Math.round((ts * 41) / 24);
      ctx.drawImage(img, (phase % 3) * fw, 0, fw, img.height, cam.ox + x * ts + Math.floor((ts - w) / 2), cam.oy + y * ts + Math.floor((ts - h) / 2), w, h);
      return;
    }
    const img = this.assets.images.cursorNormal;
    if (img) {
      // 2-frame sheet, each frame 26x26 (see CursorAnimator.java)
      const fw = Math.floor(img.width / 2);
      const size = Math.round((ts * 26) / 24);
      ctx.drawImage(img, (phase % 2) * fw, 0, fw, img.height, cam.ox + x * ts + Math.floor((ts - size) / 2), cam.oy + y * ts + Math.floor((ts - size) / 2), size, size);
    }
  }

  /** Estimated damage chip over a hovered attack target. */
  drawDamagePreview(game, ts) {
    if (game.phase !== 'ATTACK' || !game.selectedUnit || !this.showHover) return;
    const { x, y } = this.hover;
    const target = game.actionTargets.find(t => t.x === x && t.y === y && t.type === 'unit');
    if (!target) return;
    const atk = game.selectedUnit;
    const dmg = calculateDamage(game, atk, target.unit, false);
    const kill = dmg >= target.unit.currentHp;
    const counter = !kill && canCounterAttack(atk, target.unit) ? calculateDamage(game, target.unit, atk, false) : 0;
    const cam = this.camera;
    const cx = cam.ox + x * ts + ts / 2;
    const cy = cam.oy + y * ts - ts * 0.15;
    this.pill(kill ? `−${dmg}  KILL` : counter ? `−${dmg}  ↩${counter}` : `−${dmg}`, cx, cy, kill ? '#ffb4a8' : '#ffe0d6', ts);
  }

  drawFloatingTexts(ts, now) {
    const ctx = this.ctx;
    const cam = this.camera;
    this.floatingTexts = this.floatingTexts.filter(f => now - f.createdAt < 1300);
    for (const f of this.floatingTexts) {
      if (this.viewTeam !== null && this.game?.vision && !this.game.isTileVisible(this.viewTeam, f.x, f.y)) continue;
      const p = (now - f.createdAt) / 1300;
      const fx = cam.ox + f.x * ts + ts / 2;
      const fy = cam.oy + f.y * ts + ts / 3 - p * ts * 0.7;
      ctx.save();
      ctx.globalAlpha = Math.min(1, (1 - p) * 2);
      this.label(f.text, fx, fy, Math.max(17, ts * 0.38), f.color, 'center');
      ctx.restore();
    }
  }

  // ---- text helpers ---------------------------------------------------------------------------
  label(text, x, y, size, color, align = 'left') {
    const ctx = this.ctx;
    ctx.font = `400 ${Math.round(size)}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    // crisp pixel-style outline: the text stamped in 8 directions, then the colour on top (no blurry stroke)
    const o = Math.max(1, Math.round(size / 13));
    ctx.fillStyle = 'rgba(8,11,20,0.96)';
    for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o], [-o, -o], [o, o], [-o, o], [o, -o]]) ctx.fillText(text, x + dx, y + dy);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  pill(text, cx, cy, color, ts) {
    const ctx = this.ctx;
    const size = Math.max(15, ts * 0.3);
    ctx.font = `400 ${Math.round(size)}px ${FONT}`;
    const w = ctx.measureText(text).width + size * 0.9;
    const h = size * 1.45;
    const x = Math.round(cx - w / 2);
    const y = Math.round(cy - h);
    ctx.fillStyle = 'rgba(10,13,22,0.88)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(233,185,73,0.85)';
    ctx.lineWidth = Math.max(1, Math.round(size / 10));
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, y + h / 2 + 1);
  }
}
