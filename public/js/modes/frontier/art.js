// Connects the Frontier pack's data to its procedural art (kept apart so content.js stays pure data).

import { UNIT_ART } from '../../art/frontierUnits.js';
import { BUILDING_ART } from '../../art/frontierBuildings.js';

export const FRONTIER_ART = {
  /** Overlay sprite for a generated building tile def. */
  tile(def) {
    const make = BUILDING_ART[def.art?.key];
    return make ? make(def.art.owner, def.art.stage) : null;
  },
  /** Finished sprite for one unit frame in a team colour. */
  unit(def, team, frame) {
    const make = UNIT_ART[def.art];
    return make ? make(team, frame) : null;
  }
};
