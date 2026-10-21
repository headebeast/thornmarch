// Movement profiles — a reusable rule module (any mode can enable it).
//
// Gives every unit its own movement class + move points (see config/movement.js). With the module absent the
// engine uses the original uniform costs, so Campaign stays authentic; Skirmish, Frontier and Royale switch it on.

import { classCost, movementOf, terrainOf } from '../config/movement.js';

export function createMovementProfiles() {
  return {
    id: 'movement',

    /** Unit-specific base cost for entering a tile (abilities such as Flying/Crawler still override). */
    baseMoveCost(game, unit, tile, tileIndex) {
      if (!unit.moveClass) return undefined;
      return classCost(unit.moveClass, terrainOf(game.assets, tileIndex));
    },

    onUnitSpawned(game, unit) {
      const { cls, mp } = movementOf(unit);
      unit.moveClass = cls;
      unit.movement_point = mp;
      unit.currentMp = mp;
    },

    /** Lets shops / panels show the move points a recruit will actually have. */
    templateMp(game, tpl) {
      return movementOf(tpl).mp;
    }
  };
}
