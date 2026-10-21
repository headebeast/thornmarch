// Minimap — one pixel per tile, rebuilt only when the world changes. Fog-aware: unexplored ground is dark
// and enemy units/ownership you can't see aren't shown. Click or drag to jump the camera.

import { TEAMS } from '../config/constants.js';

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const TEAM_RGB = TEAMS.map(t => hex(t.light));
const TERRAIN = {
  land: [118, 176, 74],
  water: [42, 99, 200],
  forest: [48, 120, 60],
  mountain: [150, 156, 170],
  road: [168, 120, 76]
};

export class Minimap {
  constructor(canvas, assets, camera, onJump) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.assets = assets;
    this.camera = camera;
    this.onJump = onJump;
    this.base = document.createElement('canvas');
    this.signature = '';
    this.roads = new Set((assets.autotile?.road || []).map(r => r.index).concat([28, 29]));
    this.dragging = false;
    this.overlay = null; // (ctx, scaleX, scaleY) => void — modes draw extra layers (e.g. the Royale storm)
    this.bind();
  }

  bind() {
    const jump = e => {
      const r = this.canvas.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width;
      const v = (e.clientY - r.top) / r.height;
      this.onJump?.(u * this.map.width, v * this.map.height);
    };
    this.canvas.addEventListener('pointerdown', e => {
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      jump(e);
      e.stopPropagation();
    });
    this.canvas.addEventListener('pointermove', e => {
      if (this.dragging) jump(e);
    });
    const end = () => (this.dragging = false);
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  setGame(game, viewTeam) {
    this.game = game;
    this.map = game.map;
    this.viewTeam = viewTeam;
    this.base.width = this.map.width;
    this.base.height = this.map.height;
    this.canvas.width = Math.max(96, this.map.width * 2);
    this.canvas.height = Math.max(96, this.map.height * 2);
    this.signature = '';
  }

  setViewTeam(team) {
    this.viewTeam = team;
    this.signature = '';
  }

  tileColor(index) {
    const t = this.assets.getTile(index);
    if (this.roads.has(index)) return TERRAIN.road;
    if (t.team !== undefined && t.team >= 0 && (t.isCastle || t.isVillage || t.building)) return TEAM_RGB[t.team];
    if (t.isCastle || t.isVillage || t.building) return [200, 200, 210];
    switch (t.type) {
      case 1: return TERRAIN.water;
      case 2: return TERRAIN.forest;
      case 3: return TERRAIN.mountain;
      default: return TERRAIN.land;
    }
  }

  rebuild() {
    const { game, map } = this;
    const img = new ImageData(map.width, map.height);
    const vis = game.vision;
    const team = this.viewTeam;
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const o = (y * map.width + x) * 4;
        let [r, g, b] = this.tileColor(map.tiles[x][y]);
        let k = 1;
        if (vis && team !== null && !vis.revealAll) {
          if (!vis.isExplored(team, x, y)) {
            // unexplored: flat ink — never leak terrain shape through the minimap
            img.data[o] = 14;
            img.data[o + 1] = 19;
            img.data[o + 2] = 34;
            img.data[o + 3] = 255;
            continue;
          }
          if (!vis.isVisible(team, x, y)) k = 0.55;
        }
        img.data[o] = r * k;
        img.data[o + 1] = g * k;
        img.data[o + 2] = b * k;
        img.data[o + 3] = 255;
      }
    }
    for (const u of game.units) {
      if (u.currentHp <= 0 || !game.canSeeUnit(team ?? u.team, u)) continue;
      const c = TEAM_RGB[u.team] || [255, 255, 255];
      const o = (u.y * map.width + u.x) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
    }
    this.base.getContext('2d').putImageData(img, 0, 0);
  }

  draw() {
    if (!this.game?.map) return;
    const { game, camera, ctx, canvas } = this;
    const sig = `${game.vision?.version ?? 0}:${game.units.length}:${game.units.reduce((s, u) => s + u.x * 31 + u.y, 0)}:${game.structures.length}:${this.map.tiles.length}:${this._tileStamp ?? 0}`;
    if (sig !== this.signature) {
      this.signature = sig;
      this.rebuild();
    }
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.base, 0, 0, canvas.width, canvas.height);

    const sx = canvas.width / this.map.width;
    const sy = canvas.height / this.map.height;
    this.overlay?.(ctx, sx, sy);

    // viewport frame
    const x = (-camera.ox / camera.ts) * sx;
    const y = (-camera.oy / camera.ts) * sy;
    const w = (camera.viewW / camera.ts) * sx;
    const h = (camera.viewH / camera.ts) * sy;
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
    ctx.strokeStyle = '#ffe08a';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }

  /** Called when any tile changes (capture, build…) */
  markDirty() {
    this._tileStamp = (this._tileStamp || 0) + 1;
  }
}
