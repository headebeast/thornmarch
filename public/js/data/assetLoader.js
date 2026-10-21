// Browser asset loader — data (via ContentDatabase) + images, themed tile sets, and generated pack art.
// The only DOM-aware data module; everything it hands to the engine is plain data.

import { ContentDatabase } from './contentDatabase.js';
import { composeTileSet } from '../art/tileComposer.js';
import { THEMES, groundVariants } from '../art/themes.js';
import { stackFrames } from '../art/spriteBuilder.js';
import { platform } from '../platform/platform.js';
import { recolorBlueSheet } from '../art/recolor.js';

const TEAM_COUNT = 4;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function canvasFromRgba(w, h, rgba) {
  const c = makeCanvas(w, h);
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  return c;
}

export class AssetLoader extends ContentDatabase {
  constructor() {
    super();
    this.images = {
      tiles: [],
      topTiles: [],
      unitSheets: [],
      unitSheetGray: [],
      heads: null,
      tombstone: null,
      alpha: null,
      status: null,
      level: null,
      cursorNormal: null,
      cursorAttack: null,
      cursorMoveTarget: null,
      iconsAction: null,
      iconsBattle: null,
      iconsStatus: null,
      iconsMenu: null,
      portraits: null
    };
    this.basePixels = []; // original 24x24 RGBA per base tile
    this.themes = new Map(); // themeId -> { tiles: canvas[], variants: canvas[] }
    this.packArt = new Map(); // packId -> art interface
    this.packUnitSheets = new Map(); // unitIndex -> { color: canvas[team], gray: canvas[team] } (built lazily per team)
    this.packUnitArt = new Map(); // unitIndex -> { def, art }
    this.recolored = new Map(); // team -> { color, gray } for the base sheets (teams beyond the 4 shipped ones)
  }

  async loadAll(onProgress = () => {}) {
    onProgress(5, 'Loading tactical database…');
    const [tiles, units, abilities, maps, autotile] = await Promise.all([
      fetch('/data/tiles.json').then(r => r.json()),
      fetch('/data/units.json').then(r => r.json()),
      fetch('/data/abilities.json').then(r => r.json()),
      fetch('/data/maps.json').then(r => r.json()),
      fetch('/data/autotile.json').then(r => r.json())
    ]);
    this.loadBase({ tiles, units, abilities, maps, autotile });

    // User-made maps
    for (const m of platform.storage.get('aeii_custom_maps', [])) this.maps.push(m);

    onProgress(25, 'Loading terrain textures…');
    await Promise.all(
      tiles.map((_, i) =>
        this.loadImage(`/assets/images/tiles/tile_${i}.png`).then(img => {
          this.images.tiles[i] = img;
          this.basePixels[i] = img ? this.readPixels(img) : null;
        })
      )
    );

    onProgress(60, 'Loading units and interface…');
    const misc = [
      ['topTiles0', '/assets/images/tiles/top_tiles/top_tile_0.png', img => (this.images.topTiles[0] = img)],
      ['heads', '/assets/images/units/heads.png'],
      ['tombstone', '/assets/images/tombstone.png'],
      ['alpha', '/assets/images/alpha.png'],
      ['status', '/assets/images/status.png'],
      ['level', '/assets/images/level.png'],
      ['cursorNormal', '/assets/images/cursor_normal.png'],
      ['cursorAttack', '/assets/images/cursor_attack.png'],
      ['cursorMoveTarget', '/assets/images/cursor_move_target.png'],
      ['iconsAction', '/assets/images/icons_action.png'],
      ['iconsBattle', '/assets/images/icons_hud_battle.png'],
      ['iconsStatus', '/assets/images/icons_hud_status.png'],
      ['iconsMenu', '/assets/images/icons_main_menu.png'],
      ['portraits', '/assets/images/portraits.png']
    ].map(([key, src, setter]) =>
      this.loadImage(src).then(img => {
        if (setter) setter(img);
        else this.images[key] = img;
      })
    );
    for (let team = 0; team < TEAM_COUNT; team++) {
      misc.push(
        this.loadImage(`/assets/images/units/unit_sheet_${team}.png`).then(img => {
          this.images.unitSheets[team] = img;
          this.images.unitSheetGray[team] = this.createGrayscaleCanvas(img);
        })
      );
    }
    await Promise.all(misc);
    onProgress(100, 'Ready for battle!');
  }

  loadImage(src) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  readPixels(img) {
    const c = makeCanvas(img.width, img.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height).data;
  }

  createGrayscaleCanvas(img) {
    if (!img) return null;
    const c = makeCanvas(img.width, img.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] > 0) {
        const lum = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
        px[i] = px[i + 1] = px[i + 2] = lum;
      }
    }
    ctx.putImageData(d, 0, 0);
    return c;
  }

  // ---------------------------------------------------------------------------------------------
  // Content packs: data first (ContentDatabase), then art
  // ---------------------------------------------------------------------------------------------
  /** Register a pack's art factory (`{ tile(def), unit(def, team, frame) }`) and pre-render pack units. */
  installPackArt(pack, art) {
    this.packArt.set(pack.id, art);
    const refs = this.packRefs(pack.id);
    if (!refs) return;
    for (const key of Object.keys(refs.units)) {
      const def = this.units[refs.units[key]];
      this.packUnitArt.set(def.index, { def, art });
      this.packUnitSheets.set(def.index, { color: [], gray: [] });
      for (let team = 0; team < TEAM_COUNT; team++) this.ensurePackSheet(def.index, team); // the classic four up front
    }
    this.themes.clear(); // tile set must be rebuilt to include the pack's tiles
  }

  /** Build (once) a pack unit's 2-frame sheet for a team colour. */
  ensurePackSheet(unitIndex, team) {
    const sheets = this.packUnitSheets.get(unitIndex);
    if (!sheets || sheets.color[team]) return sheets;
    const { def, art } = this.packUnitArt.get(unitIndex);
    const frames = [art.unit(def, team, 0), art.unit(def, team, 1)];
    if (!frames[0]) return sheets;
    const sheet = stackFrames(frames);
    const canvas = canvasFromRgba(sheet.w, sheet.h, sheet.rgba);
    sheets.color[team] = canvas;
    sheets.gray[team] = this.createGrayscaleCanvas(canvas);
    return sheets;
  }

  /** Base-game sheets for teams beyond the four shipped: palette-swapped from the Blue sheet, cached. */
  ensureRecolor(team) {
    let r = this.recolored.get(team);
    if (r) return r;
    const blue = this.images.unitSheets[0];
    if (!blue) return null;
    const c = document.createElement('canvas');
    c.width = blue.width;
    c.height = blue.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(blue, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    recolorBlueSheet(d.data, team);
    ctx.putImageData(d, 0, 0);
    r = { color: c, gray: this.createGrayscaleCanvas(c) };
    this.recolored.set(team, r);
    return r;
  }

  /** Themed tile canvases (base tiles remapped + pack building overlays composed onto the ground). */
  getTheme(themeId = 'frost') {
    let set = this.themes.get(themeId);
    if (set) return set;
    const theme = THEMES[themeId] || THEMES.frost;
    const buffers = composeTileSet({
      db: this,
      theme,
      basePixels: i => this.basePixels[i] || null,
      overlayFor: def => {
        const art = this.packArt.get(def.pack);
        return art ? art.tile(def) : null;
      }
    });
    const tiles = buffers.map(b => (b ? canvasFromRgba(24, 24, b) : null));
    const variants = groundVariants(theme, 4).map(b => canvasFromRgba(24, 24, b));
    set = { theme, tiles, variants };
    this.themes.set(themeId, set);
    return set;
  }

  /** Source rectangle for drawing a unit's current frame (any team index). */
  getUnitSprite(unitIndex, team, gray = false) {
    if (this.packUnitArt.has(unitIndex)) {
      const sheets = this.ensurePackSheet(unitIndex, team);
      const img = (gray ? sheets.gray : sheets.color)[team] || sheets.color[0];
      return { img, sx: 0, size: 24 };
    }
    let sheet;
    if (team < this.images.unitSheets.length && this.images.unitSheets[team]) sheet = gray ? this.images.unitSheetGray[team] : this.images.unitSheets[team];
    else {
      const r = this.ensureRecolor(team);
      sheet = r ? (gray ? r.gray : r.color) : null;
    }
    if (!sheet) return null;
    const count = this.unitConfig?.unit_count || 19;
    const size = Math.floor(sheet.width / count);
    return { img: sheet, sx: unitIndex * size, size };
  }
}
