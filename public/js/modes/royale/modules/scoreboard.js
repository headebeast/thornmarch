// Scoreboard — kills, eliminations, placements and the winner. Pure bookkeeping on `game.royale`.

export function createScoreboard() {
  const alive = game => game.activeTeams.filter(t => !game.players[t].eliminated);

  return {
    id: 'royale-scoreboard',

    setup(game) {
      game.royale = { eliminated: [], kills: {}, unitKills: {}, round: 1, startTeams: game.activeTeams.length, loot: 0 };
      for (const t of game.activeTeams) {
        game.royale.kills[t] = 0;
      }
    },

    roundStart(game, round) {
      game.royale.round = round;
    },

    onUnitKilled(game, unit, killer) {
      const r = game.royale;
      if (!r) return;
      if (killer && killer.team !== unit.team) {
        r.kills[killer.team] = (r.kills[killer.team] || 0) + 1;
        r.unitKills[killer.id] = (r.unitKills[killer.id] || 0) + 1;
      }
      // a team falls when its last unit does
      if (!game.units.some(u => u.team === unit.team && u.currentHp > 0)) {
        const p = game.players[unit.team];
        if (p.eliminated) return;
        p.eliminated = true;
        const placement = alive(game).length + 1; // teams still standing + the one that just fell
        r.eliminated.push({ team: unit.team, round: r.round, by: killer ? killer.team : -1, placement });
        game.onEvent('eliminated', { team: unit.team, by: killer ? killer.team : -1, placement, round: r.round });
      }
    },

    onUnitSpawned(game, unit) {
      if (game.royale) game.royale.kills[unit.team] ??= 0;
    },

    checkVictory(game) {
      const live = alive(game);
      if (live.length === 1) return live[0];
      if (live.length === 0) {
        // everyone fell in the same round: the last eliminated team with the most kills takes it
        const last = game.royale.eliminated.filter(e => e.round === game.royale.round);
        last.sort((a, b) => (game.royale.kills[b.team] || 0) - (game.royale.kills[a.team] || 0));
        return last[0]?.team ?? 0;
      }
      return undefined;
    }
  };
}
