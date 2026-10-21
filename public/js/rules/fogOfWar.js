// Fog of war — a reusable rule module (works in any mode, including Skirmish).
//
// Each team sees a circle around every unit and every owned structure. Enemies outside that sight are
// invisible and can't be targeted. Moving into an unseen enemy triggers an AMBUSH: the move stops there.
// Units with FOREST_STEALTH vanish inside forests unless an enemy stands next to them.

import { ABILITY, TILE_TYPES } from '../config/constants.js';
import { hasAbility } from '../engine/combat.js';

const DEFAULT_UNIT_VISION = 3;

export class VisionSystem {
  constructor(game, { revealAll = false } = {}) {
    this.game = game;
    this.revealAll = revealAll;
    const size = game.map.width * game.map.height;
    this.visible = {};
    this.explored = {};
    this.version = 0; // bumped on every change so renderers/minimaps can cache
    for (const t of game.activeTeams) {
      this.visible[t] = new Uint8Array(size);
      this.explored[t] = new Uint8Array(size);
    }
  }

  unitRadius(unit) {
    const game = this.game;
    let r = unit.vision ?? DEFAULT_UNIT_VISION;
    if (hasAbility(unit, ABILITY.FAR_SIGHT) && unit.vision === undefined) r += 2;
    const tile = game.assets.getTile(game.map.tiles[unit.x][unit.y]);
    if (tile.type === TILE_TYPES.MOUNTAIN && !hasAbility(unit, ABILITY.AIR_FORCE)) r += 1; // high ground
    if (tile.vision) r = Math.max(r, tile.vision);
    return r;
  }

  structureRadius(tile) {
    if (tile.vision !== undefined) return tile.vision;
    if (tile.isCastle) return 4;
    if (tile.isVillage) return 2;
    return 0;
  }

  reveal(team, cx, cy, r) {
    const { width: w, height: h } = this.game.map;
    const vis = this.visible[team];
    const exp = this.explored[team];
    const r2 = (r + 0.5) * (r + 0.5);
    for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) {
          const i = y * w + x;
          vis[i] = 1;
          exp[i] = 1;
        }
      }
    }
  }

  recompute(team) {
    const game = this.game;
    const vis = this.visible[team];
    if (!vis) return;
    vis.fill(0);
    for (const u of game.units) {
      if (u.team === team && u.currentHp > 0) this.reveal(team, u.x, u.y, this.unitRadius(u));
    }
    for (const s of game.structures) {
      const tile = game.assets.getTile(game.map.tiles[s.x][s.y]);
      // a mode that tracks ownership outside the tile (many teams, one tile) says who sees from here and how far
      const sight = game.rules.first('structureSight', game, s, tile);
      if (sight) {
        if (sight.team === team && sight.radius > 0) this.reveal(team, s.x, s.y, sight.radius);
      } else if (tile.team === team) {
        const r = this.structureRadius(tile);
        if (r > 0) this.reveal(team, s.x, s.y, r);
      }
    }
    this.version++;
  }

  recomputeAll() {
    for (const t of this.game.activeTeams) this.recompute(t);
  }

  isVisible(team, x, y) {
    if (this.revealAll) return true;
    const v = this.visible[team];
    return !v || v[y * this.game.map.width + x] === 1;
  }

  isExplored(team, x, y) {
    if (this.revealAll) return true;
    const e = this.explored[team];
    return !e || e[y * this.game.map.width + x] === 1;
  }

  canSeeUnit(team, unit) {
    if (this.revealAll || unit.team === team) return true;
    if (!this.isVisible(team, unit.x, unit.y)) return false;
    if (hasAbility(unit, ABILITY.FOREST_STEALTH)) {
      const tile = this.game.assets.getTile(this.game.map.tiles[unit.x][unit.y]);
      if (tile.type === TILE_TYPES.FOREST) {
        for (const o of this.game.units) {
          if (o.team === team && o.currentHp > 0 && Math.abs(o.x - unit.x) + Math.abs(o.y - unit.y) <= 1) return true;
        }
        return false;
      }
    }
    return true;
  }
}

export function createFogOfWar(options = {}) {
  return {
    id: 'fog',

    setup(game) {
      game.vision = new VisionSystem(game, options);
      game.vision.recomputeAll();
    },

    turnStart(game, team) {
      game.vision?.recompute(team);
    },

    afterMove(game, unit) {
      game.vision?.recompute(unit.team);
    },

    onUnitSpawned(game, unit) {
      game.vision?.recompute(unit.team);
    },

    onUnitKilled(game, unit) {
      game.vision?.recompute(unit.team);
    },

    onTileChanged(game, x, y, oldIndex, newIndex) {
      // only a change of owner or of sight radius alters what anybody can see (opening a crate does not)
      const was = game.assets.getTile(oldIndex);
      const now = game.assets.getTile(newIndex);
      if (was.team === now.team && (was.vision || 0) === (now.vision || 0) && !!was.isCastle === !!now.isCastle) return;
      game.vision?.recomputeAll();
    },

    /** Stop a move *before* an unseen enemy: returns the number of path steps that may be walked. */
    truncateMove(game, unit, path) {
      for (let i = 1; i < path.length; i++) {
        const occ = game.getUnitAt(path[i].x, path[i].y);
        if (occ && occ.team !== unit.team && !game.canSeeUnit(unit.team, occ)) return i - 1;
      }
      return undefined;
    }
  };
}
