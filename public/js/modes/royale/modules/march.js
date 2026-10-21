// Forced march — crossing a 160-tile island on foot takes forever, and nobody enjoys watching a warband plod through
// empty woods. While a warband has no enemy in sight its fighters move half as far again; the moment someone is seen the
// bonus is gone and movement is back to the normal, carefully balanced profile. Late in the match (war chests sealed) the
// march is doubled, so the last warbands can actually catch one another. It speeds up the travelling, not the fighting.

/** Forced-march bonus (exported so the balance sim can sweep it): normal, and once the war chests are sealed. */
export const MARCH = { bonus: 0.5, sealed: 1.0 };

export function createMarch() {
  return {
    id: 'royale-march',

    // must run after the fog-of-war module's own turnStart, which refreshes what the warband can see
    turnStart(game, team) {
      const sighted = game.units.some(e => e.team !== team && e.currentHp > 0 && game.canSeeUnit(team, e));
      if (sighted) return;
      for (const u of game.units) {
        if (u.team !== team || u.currentHp <= 0) continue;
        u.currentMp += Math.max(1, Math.round(u.movement_point * (game.hunt?.sealed ? MARCH.sealed : MARCH.bonus)));
      }
    }
  };
}
