// Farming: fields ripen one stage per turn of their owner (Tilled -> Growing -> Ripe).
// Ripe fields pay the most gold and supply (see BUILDINGS.farm). Captured fields keep their stage,
// so raiding a rival's harvest is as good as planting your own.

import { tileKey } from '../content.js';

export function createFarming() {
  return {
    id: 'frontier-farming',

    turnStart(game, team) {
      // everyone's first turn is turn 1: skip growth so every player starts from identical fields
      if (game.turnNumber === 1) return;
      const refs = game.assets.packRefs('frontier').tiles;
      // collect first: setTile mutates the structures list while we iterate
      const growing = [];
      for (const s of game.structures) {
        const t = game.assets.getTile(game.map.tiles[s.x][s.y]);
        if (t.building === 'farm' && t.team === team && t.stage < 2) growing.push({ x: s.x, y: s.y, stage: t.stage });
      }
      for (const f of growing) {
        game.setTile(f.x, f.y, refs[tileKey('farm', team, f.stage + 1)]);
        if (f.stage + 1 === 2) game.onFloatingText(f.x, f.y, 'Ripe!', '#fff0a0');
      }
    }
  };
}
