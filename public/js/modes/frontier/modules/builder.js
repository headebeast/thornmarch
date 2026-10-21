// Builder actions: units with the BUILDER ability raise structures on the open ground they stand on.
// Which structures a unit may raise is data on the unit (`builds`), costs live in BUILDINGS.

import { ABILITY } from '../../../config/constants.js';
import { hasAbility } from '../../../engine/combat.js';
import { BUILDINGS, tileKey } from '../content.js';

// Plain open-ground tiles of the base tileset (plains and the two hill variants)
const BUILDABLE_BASE_TILES = new Set([18, 32, 34]);

export function createBuilder() {
  const optionsFor = unit => (unit.builds || []).map(id => ({ id, def: BUILDINGS[id] })).filter(o => o.def);

  return {
    id: 'frontier-builder',

    actions(game, list, unit) {
      if (!hasAbility(unit, ABILITY.BUILDER)) return list;
      const tileIndex = game.map.tiles[unit.x][unit.y];
      if (!BUILDABLE_BASE_TILES.has(tileIndex)) return list;
      const gold = game.players[unit.team]?.gold ?? 0;
      const out = list.slice();
      for (const o of optionsFor(unit)) {
        if (gold >= o.def.buildCost) out.push(`build:${o.id}`);
      }
      return out;
    },

    describeAction(game, actionId) {
      if (!actionId.startsWith('build:')) return undefined;
      const def = BUILDINGS[actionId.slice(6)];
      if (!def) return undefined;
      const verbs = { farm: 'Plow Field', outpost: 'Raise Outpost', watchtower: 'Build Watchtower' };
      return { label: verbs[actionId.slice(6)] || `Build ${def.name}`, hint: def.name, cost: def.buildCost, icon: 'hammer' };
    },

    performAction(game, unit, actionId) {
      if (!actionId.startsWith('build:')) return undefined;
      const id = actionId.slice(6);
      const def = BUILDINGS[id];
      const player = game.players[unit.team];
      if (!def || !player || player.gold < def.buildCost) return false;
      if (!BUILDABLE_BASE_TILES.has(game.map.tiles[unit.x][unit.y])) return false;

      player.gold -= def.buildCost;
      const refs = game.assets.packRefs('frontier').tiles;
      game.setTile(unit.x, unit.y, refs[tileKey(id, unit.team, 0)]);
      game.sound.playSfx('recruit');
      game.onFloatingText(unit.x, unit.y, `${def.name} raised!`, '#ffcf6a');
      return true;
    }
  };
}
