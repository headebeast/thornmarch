// Behaviour for the Frontier's new unit abilities that aren't pure stat tweaks.
// (Pike Wall lives in combat.js, Pathfinder in pathfinding.js, Forest Stealth in the fog module.)

import { ABILITY } from '../../../config/constants.js';
import { hasAbility } from '../../../engine/combat.js';

const REGROWTH_HEAL = 15;

export function createUnitAbilities() {
  return {
    id: 'frontier-abilities',

    turnStart(game, team) {
      // Regrowth: each Druid mends adjacent allies at the start of its team's turn
      for (const druid of game.units) {
        if (druid.team !== team || druid.currentHp <= 0 || !hasAbility(druid, ABILITY.REGROWTH)) continue;
        for (const other of game.units) {
          if (other.team !== team || other.currentHp <= 0 || other.id === druid.id) continue;
          if (Math.abs(other.x - druid.x) + Math.abs(other.y - druid.y) !== 1) continue;
          if (other.currentHp >= other.max_hp) continue;
          const prev = other.currentHp;
          other.currentHp = Math.min(other.max_hp, other.currentHp + REGROWTH_HEAL);
          game.onFloatingText(other.x, other.y, `+${other.currentHp - prev} Regrowth`, '#7fd68a');
        }
      }
    }
  };
}
