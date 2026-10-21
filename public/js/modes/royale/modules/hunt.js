// The Hunt — what makes a Battle Royale end, without a gas cloud or a shrinking zone.
//
// Nothing here hurts anyone. It only makes sure the survivors can FIND each other, and that fighting pays:
//   · War horns   — every few rounds a horn sounds and every living warband is marked on everybody's map for that round
//                   (position only, fog stays). The thinner the field, the faster the horns; the last few warbands hear
//                   one every round ("Final Hunt").
//   · Spoils      — a fallen fighter sometimes drops a crate; a wiped-out warband drops an arsenal that every warband can
//                   see, so a fight always leaves a prize (and a crowd) behind.
//   · Sealed chests — once only a fifth of the warbands are left no more fighters can be recruited and camps stop
//                   healing, so what is left on the island is all there will ever be.
//   · Time called — a safety net for a stand-off: at the round cap the strongest warband (living fighters, then HP, then
//                   kills) takes the island. A real last-one-standing finish never needs it.

import { ECONOMY } from '../holdings.js';

/** Horn pacing (exported so the balance sim can sweep it). */
export const HORN = { first: 8, finalAt: 4, far: 8, mid: 5, near: 3 };
/** How many rounds a horn's markers stay useful as "last known position". */
export const PING_MEMORY = 6;
export const FIRST_HORN = HORN.first;
export const FINAL_AT = HORN.finalAt; // this many warbands or fewer: a horn every round

/** Rounds until the next horn, given how thin the field has become. */
export function hornInterval(alive, start) {
  if (alive <= HORN.finalAt) return 1;
  const f = alive / start;
  return f > 0.5 ? HORN.far : f > 0.25 ? HORN.mid : HORN.near;
}

/** Round cap per field size (only reached when everyone refuses to fight). */
export function roundCap(players) {
  return players <= 24 ? 110 : players <= 44 ? 130 : 150;
}

/** Strongest warband first: living fighters, remaining HP, kills, then team number (all deterministic). */
export function standings(game) {
  const rows = game.activeTeams.map(team => {
    const squad = game.units.filter(u => u.team === team && u.currentHp > 0);
    return { team, alive: squad.length, hp: squad.reduce((s, u) => s + u.currentHp, 0), kills: game.royale?.kills?.[team] || 0 };
  });
  rows.sort((a, b) => b.alive - a.alive || b.hp - a.hp || b.kills - a.kills || a.team - b.team);
  return rows;
}

/** What the Hunt wants to tell the player this round (DOM-free so every shell can show it). */
export function huntStatus(game) {
  const h = game.hunt;
  const left = h.cap - h.round;
  if (left <= 10) return { text: left <= 0 ? 'Time called' : `Time called in ${left}`, tone: 'late' };
  if (h.final) return { text: 'Final hunt · all marked', tone: 'final' };
  if (h.horn) return { text: 'Horn! All marked', tone: 'horn' };
  const n = h.nextHorn - h.round;
  return { text: n <= 1 ? 'Horn next round' : `Horn in ${n} rounds`, tone: 'idle' };
}

export function createHunt({ cap = 100, firstHorn = HORN.first } = {}) {
  const aliveTeams = game => game.activeTeams.filter(t => !game.players[t].eliminated);
  const tileRef = (game, name) => game.assets.packRefs('royale').tiles[name];

  /** A plain bit of ground at (x, y) or right next to it where a crate may fall. */
  function dropSpot(game, x, y) {
    for (const [dx, dy] of [[0, 0], [0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const px = x + dx;
      const py = y + dy;
      if (px < 1 || py < 1 || px >= game.map.width - 1 || py >= game.map.height - 1) continue;
      const t = game.assets.getTile(game.map.tiles[px][py]);
      if (t.type !== 0 || t.stepCost !== 1 || t.building || t.isCastle || t.isVillage || game.getUnitAt(px, py)) continue;
      return { x: px, y: py };
    }
    return null;
  }

  return {
    id: 'royale-hunt',

    setup(game) {
      game.hunt = { round: 1, cap, startTeams: game.activeTeams.length, nextHorn: firstHorn, horn: false, final: false, pings: [], pingRound: -99, timeCalled: false, sealed: false };
    },

    roundStart(game, round) {
      const h = game.hunt;
      const live = aliveTeams(game);
      h.round = round;
      h.final = live.length <= HORN.finalAt;
      const sealed = live.length <= Math.max(HORN.finalAt, Math.ceil(h.startTeams * ECONOMY.sealAt));
      if (sealed && !h.sealed) game.onEvent('sealed', { warbands: live.length });
      h.sealed = sealed;
      h.horn = h.final || round >= h.nextHorn;
      if (!h.horn) {
        if (round - h.pingRound > PING_MEMORY) h.pings = []; // the markers have gone cold
        return;
      }
      h.pings = [];
      h.pingRound = round;
      for (const team of live) {
        const squad = game.units.filter(u => u.team === team && u.currentHp > 0).sort((a, b) => a.id - b.id);
        if (squad.length) h.pings.push({ team, x: squad[0].x, y: squad[0].y, n: squad.length });
      }
      h.nextHorn = round + hornInterval(live.length, h.startTeams);
      game.onEvent('horn', { final: h.final, round, warbands: live.length });
    },

    onUnitKilled(game, unit) {
      if (!game.royale || game.hunt.timeCalled) return;
      const wiped = !game.units.some(u => u.team === unit.team && u.currentHp > 0);
      // single losses drop a crate now and then; a whole warband always leaves an arsenal that everyone can see
      if (!wiped && game.rng.next() >= 0.3) return;
      const spot = dropSpot(game, unit.x, unit.y);
      if (!spot) return;
      game.setTile(spot.x, spot.y, tileRef(game, wiped ? 'airdrop' : 'crate'));
      if (wiped && game.vision) for (const t of game.activeTeams) game.vision.explored[t][spot.y * game.map.width + spot.x] = 1;
      game.onEvent('spoils', { x: spot.x, y: spot.y, wiped, team: unit.team });
    },

    // the cap is only judged when a round is over, never halfway through one
    roundEnd(game, round) {
      game.hunt.capped = round >= game.hunt.cap;
    },

    /** Stand-off breaker (comes after the scoreboard, which always wins a real last-one-standing finish). */
    checkVictory(game) {
      const h = game.hunt;
      if (!h?.capped || !game.royale) return undefined;
      const table = standings(game);
      h.timeCalled = true;
      game.royale.endedBy = 'time';
      game.royale.standings = table.map(r => r.team);
      return table[0].team;
    }
  };
}
