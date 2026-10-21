// Route finding for Battle Royale bots: a cost-to-goal field per warband, built with the leader's own movement profile
// (roads are cheap, lakes and ridges are not), so bots walk AROUND obstacles instead of getting stuck against them.
//
// The memo is keyed by round, goal, unit template AND the unit's tile, and is dropped when the round changes — so a cache
// hit is by construction the very field a fresh search would return. Clearing it changes speed, never results, which is what
// keeps online clients identical no matter who pressed "auto-plan" or in what order bots were planned.

import { buildDistanceField } from '../../engine/pathfinding.js';

export const NAV_MARGIN = 34; // search this far (movement cost) past the unit: more than any single move can reach

export class GoalNav {
  constructor() {
    this.round = -1;
    this.fields = new Map(); // `${team}:${goal}:${template}:${tile}` -> Float32Array
  }

  /** Cost-to-goal field for `unit`, exact around the unit. */
  field(game, team, unit, goal) {
    if (this.round !== game.turnNumber) {
      this.round = game.turnNumber;
      this.fields.clear();
    }
    const key = `${team}:${goal.x},${goal.y}:${unit.index}:${unit.x},${unit.y}`;
    let field = this.fields.get(key);
    if (!field) {
      field = buildDistanceField(game, unit, goal.x, goal.y, 400, { x: unit.x, y: unit.y, margin: NAV_MARGIN });
      this.fields.set(key, field);
    }
    return field;
  }
}
