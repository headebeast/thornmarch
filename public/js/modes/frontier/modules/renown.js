// Renown: the Frontier's victory-point track. Obelisks and shrines pay Renown every turn you hold them,
// exploring ruins grants a lump sum. Reach the goal first and the realm is yours — or crush your rivals.

import { BUILDINGS } from '../content.js';

export function createRenown({ goal = 100 } = {}) {
  return {
    id: 'frontier-renown',
    goal,

    setup(game) {
      game.renown = {};
      for (const t of game.activeTeams) game.renown[t] = 0;
      game.renownGoal = goal;
    },

    /** Public so other modules (ruins, future quests) can grant points. */
    award(game, team, amount, reason = '') {
      if (!game.renown || game.renown[team] === undefined) return;
      game.renown[team] += amount;
      game.onEvent('renown', { team, amount, reason });
    },

    turnStart(game, team) {
      let gain = 0;
      for (const s of game.structures) {
        const t = game.assets.getTile(game.map.tiles[s.x][s.y]);
        if (t.team !== team) continue;
        const b = BUILDINGS[t.building];
        if (b?.renown) gain += b.renown;
      }
      if (gain > 0) {
        this.award(game, team, gain, 'holdings');
        const k = game.structures.find(s => game.assets.getTile(game.map.tiles[s.x][s.y]).team === team);
        if (k) game.onFloatingText(k.x, k.y, `+${gain} Renown`, '#ffd966');
      }
    },

    checkVictory(game) {
      if (!goal || !game.renown) return undefined;
      let best = null;
      for (const t of game.activeTeams) {
        if (game.players[t]?.eliminated) continue;
        if (game.renown[t] >= goal && (best === null || game.renown[t] > game.renown[best])) best = t;
      }
      return best === null ? undefined : best;
    },

    describeScore(game, team) {
      return { value: game.renown?.[team] ?? 0, goal };
    }
  };
}
