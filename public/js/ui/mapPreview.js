// Map visuals for menus: a terrain thumbnail (setup preview), a real-tile crop (featured card), and the animated
// menu backdrop. Pure canvas helpers — they never touch the engine.

import { TEAMS } from '../config/constants.js';

const rgb = hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const TERRAIN = { 0: [118, 176, 74], 1: [42, 99, 200], 2: [44, 112, 56], 3: [150, 156, 170] };

/** 1 px per tile terrain thumbnail with keeps and points of interest. */
export function drawTerrainPreview(canvas, mapData, assets, scale = 4) {
  const { width: w, height: h } = mapData;
  const roads = new Set((assets.autotile?.road || []).map(r => r.index).concat([28, 29]));
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const img = new ImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = mapData.tiles[x][y];
      const t = assets.getTile(idx);
      let c = roads.has(idx) ? [170, 124, 80] : TERRAIN[t.type] || TERRAIN[0];
      if (t.type === 0 && idx !== assets.autotile?.land && !roads.has(idx) && t.defenceBonus >= 10 && !t.building && !t.isCastle && !t.isVillage) c = [100, 160, 66];
      const o = (y * w + x) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
  }
  src.getContext('2d').putImageData(img, 0, 0);
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);

  const dot = (x, y, color, r) => {
    ctx.fillStyle = '#0a0d16';
    ctx.fillRect((x - r) * scale - 1, (y - r) * scale - 1, (2 * r + 1) * scale + 2, (2 * r + 1) * scale + 2);
    ctx.fillStyle = color;
    ctx.fillRect((x - r) * scale, (y - r) * scale, (2 * r + 1) * scale, (2 * r + 1) * scale);
  };
  const pois = mapData.meta?.pois || [];
  const colour = { mine: '#ffd54a', obelisk: '#c58cff', shrine: '#4cc2a0', ruins: '#d9d2c0', outpost: '#c8a070', watchtower: '#b8c4d8', forge: '#ff9a4a', library: '#58a6ff', farm: '#e8d36a' };
  for (const p of pois) {
    if (colour[p.type]) dot(p.x, p.y, colour[p.type], 0);
  }
  for (const p of pois) {
    if (p.type === 'keep' || p.type === 'camp') dot(p.x, p.y, p.owner >= 0 ? TEAMS[p.owner].light : '#cfd6e4', 1);
  }
}

/** Real themed tiles + units for a rectangular crop of a map (featured menu card / backdrop). */
export function drawMapCrop(ctx, assets, themeId, mapData, x0, y0, tilesW, tilesH, ts, ox = 0, oy = 0, frame = 0) {
  const set = assets.getTheme(themeId);
  ctx.imageSmoothingEnabled = false;
  for (let y = 0; y < tilesH + 1; y++) {
    for (let x = 0; x < tilesW + 1; x++) {
      const mx = x0 + x;
      const my = y0 + y;
      if (mx < 0 || my < 0 || mx >= mapData.width || my >= mapData.height) continue;
      const idx = mapData.tiles[mx][my];
      const def = assets.getTile(idx);
      const di = def.isAnimated && frame === 1 && def.animationTileIndex >= 0 ? def.animationTileIndex : idx;
      const img = set.tiles[di];
      if (img) ctx.drawImage(img, ox + x * ts, oy + y * ts, ts, ts);
    }
  }
}

export function drawUnitSprite(ctx, assets, unit, px, py, ts, frame) {
  const spr = assets.getUnitSprite(unit.index, unit.team);
  if (!spr?.img) return;
  ctx.drawImage(spr.img, spr.sx, frame * spr.size, spr.size, spr.size, Math.round(px), Math.round(py), ts, ts);
  if (unit.index === (assets.unitConfig?.commander_index ?? 9) && assets.images.heads) {
    const heads = assets.images.heads;
    const hw = Math.floor(heads.width / 4);
    ctx.drawImage(heads, unit.team * hw, 0, hw, heads.height, Math.round(px + (ts * 7) / 24), Math.round(py + (frame * ts) / 24), (ts * 13) / 24, (ts * 12) / 24);
  }
}

/**
 * Animated menu backdrop: a slow cinematic drift across a generated Frontier realm with idle units.
 * Returns { start(), stop() }.
 */
export function createBackdrop(canvas, assets, mapData) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let raf = 0;
  let running = false;
  const t0 = performance.now();

  // scatter idle units on open ground along the route for life
  const decor = [];
  const ids = assets.units.filter(u => !u.isSkeleton && !u.isCrystal && !u.isCommander).map(u => u.index);
  let seed = 4242;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 70; i++) {
    const x = 6 + Math.floor(rnd() * (mapData.width - 12));
    const y = 6 + Math.floor(rnd() * (mapData.height - 12));
    const t = assets.getTile(mapData.tiles[x][y]);
    if (t.type === 0 && !t.building && !t.isCastle && !t.isVillage && t.stepCost === 1) {
      decor.push({ index: ids[Math.floor(rnd() * ids.length)], team: Math.floor(rnd() * 2), x, y });
    }
  }

  function frame(now) {
    if (!running) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(canvas.clientWidth * dpr);
    const H = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const ts = Math.round(64 * dpr);
    const t = (now - t0) / 1000;
    const camX = (mapData.width / 2 + Math.sin(t * 0.045) * (mapData.width * 0.28)) * ts - W * 0.62;
    const camY = (mapData.height / 2 + Math.cos(t * 0.031) * (mapData.height * 0.28)) * ts - H / 2;
    const tx0 = Math.floor(camX / ts);
    const ty0 = Math.floor(camY / ts);
    const ox = Math.round(-(camX - tx0 * ts));
    const oy = Math.round(-(camY - ty0 * ts));
    const anim = Math.floor(now / 300) % 2;
    ctx.fillStyle = '#0a0d16';
    ctx.fillRect(0, 0, W, H);
    drawMapCrop(ctx, assets, 'meadow', mapData, tx0, ty0, Math.ceil(W / ts) + 1, Math.ceil(H / ts) + 1, ts, ox, oy, anim);
    for (const u of decor) {
      const px = ox + (u.x - tx0) * ts;
      const py = oy + (u.y - ty0) * ts;
      if (px < -ts || py < -ts || px > W || py > H) continue;
      drawUnitSprite(ctx, assets, u, px, py, ts, anim);
    }
    raf = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    }
  };
}
