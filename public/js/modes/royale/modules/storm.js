// The Storm — a shrinking safe zone. At the start of each phase the *next* circle is announced; at the end of every
// round, units outside the current circle take damage that grows with each phase. After the last phase "sudden death"
// wears everyone down so a match always ends.

export const inZone = (zone, x, y) => Math.hypot(x - zone.x, y - zone.y) <= zone.r;

export function stormStatus(game) {
  return game.storm || null;
}

export function createStorm() {
  const apply = (game, round) => {
    const st = game.storm;
    const phases = st.phases;
    let idx = 0;
    for (let i = 0; i < phases.length; i++) if (phases[i].round <= round) idx = i;
    st.index = idx;
    st.current = phases[idx];
    st.next = phases[idx + 1] || null;
    st.roundsToShrink = st.next ? st.next.round - round : null;
    st.suddenDeath = round >= st.suddenDeathRound;
  };

  return {
    id: 'royale-storm',

    setup(game) {
      const meta = game.map.meta?.storm;
      if (!meta) throw new Error('Storm module needs map.meta.storm');
      game.storm = { ...meta, round: 1 };
      apply(game, 1);
    },

    roundStart(game, round) {
      game.storm.round = round;
      const before = game.storm.index;
      apply(game, round);
      if (game.storm.index !== before) game.onEvent('storm', { phase: game.storm.index, shrinking: true });
    },

    roundEnd(game, round) {
      const st = game.storm;
      const pct = st.suddenDeath ? Math.max(0.25, st.current.damage) : st.current.damage;
      if (pct <= 0 && !st.suddenDeath) return;
      // collect first: handleUnitDeath mutates the units list
      const hit = game.units.filter(u => u.currentHp > 0 && !inZone(st.current, u.x, u.y));
      for (const u of hit) {
        const dmg = Math.max(8, Math.round(u.max_hp * pct));
        u.currentHp = Math.max(0, u.currentHp - dmg);
        game.onFloatingText(u.x, u.y, `-${dmg} storm`, '#c084fc');
        if (u.currentHp <= 0) game.handleUnitDeath(u, null);
      }
      if (st.suddenDeath) {
        for (const u of game.units.slice()) {
          if (u.currentHp <= 0 || !inZone(st.current, u.x, u.y)) continue;
          u.currentHp = Math.max(0, u.currentHp - Math.round(u.max_hp * 0.2));
          if (u.currentHp <= 0) game.handleUnitDeath(u, null);
        }
      }
    }
  };
}
