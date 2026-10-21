// Battle Royale bots. Deterministic planners: given the same state they always produce the same orders, which is what
// lets every online client simulate the bots locally. They respect fog (they only target enemies their warband can
// see and only know about loot and buildings on tiles it has explored), grab crates, claim buildings, spend gold on
// recruits and upgrades, regroup, pick fights they can win and — as the
// field thins — hunt: they follow war-horn pings, then sweep ground they have not explored yet. If a storm is running
// they also stay inside the safe circle.

import { calculateDamage, canCounterAttack } from '../../engine/combat.js';
import { getReachableTiles, getAttackableTargets, getHealableTargets } from '../../engine/pathfinding.js';
import { hashSeed } from '../../engine/rng.js';
import { TILE_TYPES } from '../../config/constants.js';
import { ihash } from '../shared/terrain.js';
import { GoalNav } from './botNav.js';
import { PING_MEMORY } from './modules/hunt.js';
import { readEconomy, holdingCandidates, buildingAct } from './botEconomy.js';

/** Bot pacing knobs (exported so the balance sim can sweep them). */
export const TUNING = {
  huntBase: 1.1, // pull toward the hunt goal (score per movement point) at round 0 …
  huntSpan: 1.2, // … and the extra pull at full urgency
  rampFrom: 3, // urgency starts rising at this round …
  rampLen: 30, // … and gets its time share after this many more
  rampShare: 0.5,
  thinShare: 0.45, // urgency share from the field having thinned out
  finalBonus: 0.5,
  danger: 3 // fear of a visible enemy that could reach us (healthy units)
};

const man = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by);

export class RoyaleAI {
  constructor(game) {
    this.game = game;
    this.seed = hashSeed(String(game.options.seed ?? 'royale'));
    this.nav = new GoalNav();
  }

  /** Orders for every living unit of `team`. */
  planTeam(game, team) {
    const squad = game.units.filter(u => u.team === team && u.currentHp > 0).sort((a, b) => a.id - b.id);
    if (!squad.length) return [];
    const ctx = this.context(game, team, squad);
    const orders = [];
    for (const unit of squad) orders.push(this.planUnit(game, unit, ctx));
    return orders;
  }

  context(game, team, squad) {
    const st = game.storm; // optional: only present when the match runs a closing storm
    const hunt = game.hunt;
    const round = game.turnNumber;
    // be inside the NEXT circle once it is about to close
    const zone = st ? (st.next && st.roundsToShrink <= 1 ? st.next : st.current) : null;
    const visible = game.units.filter(u => u.currentHp > 0 && u.team !== team && game.canSeeUnit(team, u));
    const loot = [];
    for (const s of game.structures) {
      const t = game.assets.getTile(game.map.tiles[s.x][s.y]);
      if (t.building !== 'crate' && t.building !== 'airdrop' && !(t.building === 'ruins' && t.stage === 0)) continue;
      if (game.vision && !game.vision.isExplored(team, s.x, s.y)) continue;
      loot.push({ x: s.x, y: s.y, value: t.building === 'airdrop' ? 200 : t.building === 'ruins' ? 110 : 90 });
    }
    const leader = squad[0];
    const eco = readEconomy(game, team);
    const aggr = 0.75 + ihash(this.seed, team, 17) * 0.6; // each warband has its own temperament
    // how hard to chase: gently at first (loot comes first), harder every round and as the field thins
    const alive = game.activeTeams.filter(t => !game.players[t].eliminated).length;
    const thin = 1 - alive / (hunt?.startTeams || game.activeTeams.length);
    const T = TUNING;
    const urge = Math.min(1, Math.max(0, (round - T.rampFrom) / T.rampLen)) * T.rampShare + thin * T.thinShare + (hunt?.final ? T.finalBonus : 0);
    return {
      team,
      zone,
      zoneR: zone ? Math.max(2, zone.r - 1.5) : 0,
      visible,
      loot,
      eco,
      squad,
      leader,
      pull: st ? 0.12 + st.index * 0.16 : 0, // with a storm: the later the phase, the harder bots crowd the centre
      aggr,
      round,
      ...this.destination(game, team, leader, visible, loot, eco, hunt, round, Math.max(0.25, 1 - urge), (T.huntBase + urge * T.huntSpan) * (0.8 + aggr * 0.25)),
      fear: 1 - Math.min(0.85, urge) // the closer the end, the less bots hold back
    };
  }

  /**
   * Where the warband is heading — decided once for the whole squad from its leader: nearby loot first (while it is worth
   * the walk), otherwise the hunt (a seen enemy, a recent horn ping, new ground). Comes with a cost-to-goal field so bots
   * route around lakes and ridges instead of stalling against them.
   */
  destination(game, team, leader, visible, loot, eco, hunt, round, focus, huntW) {
    // things worth walking to: loot, buildings to claim, a camp to recruit at — nearest (richest) first
    const worthwhile = [...this.lootCandidates(leader, loot, focus), ...holdingCandidates(game, leader, eco, focus)].sort((a, b) => a.d - b.d || a.x - b.x || a.y - b.y).slice(0, 3);
    if (worthwhile.length) {
      const goal = this.pickGoal(game, team, leader, worthwhile, true);
      if (goal) return { goal, goalW: round < 10 ? 1.5 : 1.0 };
    }
    return { goal: this.pickGoal(game, team, leader, this.huntCandidates(game, team, leader, visible, hunt, round), false), goalW: huntW };
  }

  /** First candidate with a sensible route. `strict`: give up (null) rather than take a cut-off one. */
  pickGoal(game, team, leader, cands, strict) {
    let fallback = null;
    for (const c of cands) {
      const field = this.nav.field(game, team, leader, c);
      const cost = field[leader.y * game.map.width + leader.x];
      const goal = { x: c.x, y: c.y, field };
      if (cost <= man(leader.x, leader.y, c.x, c.y) * 3.5 + 40) return goal; // a sensible route
      fallback ??= goal; // looks cut off (island, wall of water): try the next one
    }
    return strict ? null : fallback;
  }

  /** Loot worth walking to (about 22 steps; richer loot is worth a longer walk — and the walk shrinks as the hunt tightens), best first. */
  lootCandidates(leader, loot, focus = 1) {
    const out = [];
    for (const l of loot) {
      const d = man(leader.x, leader.y, l.x, l.y) - l.value / 40;
      if (d < 22 * focus) out.push({ x: l.x, y: l.y, d });
    }
    return out.sort((a, b) => a.d - b.d || a.x - b.x || a.y - b.y).slice(0, 3);
  }

  /** Up to three hunting goals in order of preference. */
  huntCandidates(game, team, leader, visible, hunt, round) {
    const top = (items, n) => items.sort((a, b) => a.d - b.d || a.x - b.x || a.y - b.y).slice(0, n);
    const known = [];
    for (const e of visible) known.push({ x: e.x, y: e.y, d: man(leader.x, leader.y, e.x, e.y) });
    // a horn ping stays useful for a few rounds — until we get there and find nobody
    if (hunt && round - hunt.pingRound <= PING_MEMORY) {
      for (const p of hunt.pings) {
        const d = man(leader.x, leader.y, p.x, p.y);
        if (p.team !== team && d > 5) known.push({ x: p.x, y: p.y, d });
      }
    }
    if (known.length) return top(known, 3);

    // nothing known: sweep the nearest ground this warband has never seen (coarse grid, land only)
    const exp = game.vision?.explored?.[team];
    if (exp) {
      const w = game.map.width;
      const fresh = [];
      for (const s of this.landSamples(game)) {
        if (exp[s.y * w + s.x]) continue;
        fresh.push({ x: s.x, y: s.y, d: man(leader.x, leader.y, s.x, s.y) + ihash(this.seed, team * 7 + s.x, s.y) * 3 }); // tie-break per warband
      }
      if (fresh.length) return top(fresh, 3);
    }
    return [{ x: game.map.meta.centre.x | 0, y: game.map.meta.centre.y | 0 }];
  }

  /** A coarse grid of walkable-looking ground, built once per map. */
  landSamples(game) {
    if (this.samples && this.samplesFor === game.map) return this.samples;
    const out = [];
    const step = 5;
    for (let y = 2; y < game.map.height - 2; y += step) {
      for (let x = 2; x < game.map.width - 2; x += step) {
        const t = game.assets.getTile(game.map.tiles[x][y]);
        if (t.type !== TILE_TYPES.WATER && t.type !== TILE_TYPES.MOUNTAIN) out.push({ x, y });
      }
    }
    this.samples = out;
    this.samplesFor = game.map;
    return out;
  }

  planUnit(game, unit, ctx) {
    const { reachable } = getReachableTiles(game, unit);
    let best = null;

    for (const pos of reachable) {
      const tile = game.assets.getTile(game.map.tiles[pos.x][pos.y]);
      // good ground only matters when there is somebody to fight; otherwise nobody should sit on a watchtower all game
      let score = tile.defenceBonus * (ctx.visible.length ? 0.35 : 0.06) - pos.cost * 0.05;

      // 1. the storm (only when the match has one) — otherwise: the hunt
      if (ctx.zone) {
        const dz = Math.hypot(pos.x - ctx.zone.x, pos.y - ctx.zone.y);
        if (dz > ctx.zoneR) score -= 36 + (dz - ctx.zoneR) * 6;
        else score -= dz * ctx.pull;
      }
      score -= this.goalCost(game, ctx.goal, pos) * ctx.goalW;

      // 2. loot
      for (const l of ctx.loot) if (l.x === pos.x && l.y === pos.y) score += l.value;

      // 3. stay with the warband
      if (unit !== ctx.leader && ctx.leader.currentHp > 0) score -= Math.max(0, man(pos.x, pos.y, ctx.leader.x, ctx.leader.y) - 4) * 1.4;

      // 4. danger from visible enemies that could reach us
      for (const e of ctx.visible) {
        const d = man(pos.x, pos.y, e.x, e.y);
        if (d <= e.movement_point + e.max_attack_range) score -= unit.currentHp < 45 ? 26 : (TUNING.danger * ctx.fear) / ctx.aggr;
      }

      // 5. the single best thing we could do from this tile
      let act = null;
      let actScore = 0;
      let cost = 0;
      const t = game.assets.getTile(game.map.tiles[pos.x][pos.y]);
      if (t.building === 'ruins' && t.stage === 0) {
        actScore = 40;
        act = { type: 'explore' };
      }
      // buildings: claim, recruit, temper, study
      const work = buildingAct(game, unit, pos, ctx.eco, ctx.squad, this.seed, ctx.round);
      if (work && work.score > actScore) {
        actScore = work.score;
        act = work.act;
        cost = work.cost;
      }
      const ox = unit.x;
      const oy = unit.y;
      unit.x = pos.x;
      unit.y = pos.y;
      for (const tg of getAttackableTargets(game, unit, pos.x, pos.y)) {
        if (tg.type !== 'unit') continue;
        const dmg = calculateDamage(game, unit, tg.unit, false);
        const counter = dmg < tg.unit.currentHp && canCounterAttack(unit, tg.unit) ? calculateDamage(game, tg.unit, unit, false) * 0.6 : 0;
        const s = (dmg * 2.6 - counter * 1.7 + (dmg >= tg.unit.currentHp ? 200 : 0)) * ctx.aggr;
        if (s > actScore && s > 8) {
          actScore = s;
          act = { type: 'attack', targetId: tg.unit.id };
        }
      }
      for (const h of getHealableTargets(game, unit, pos.x, pos.y)) {
        if (h.unit.team !== unit.team) continue;
        const s = 70 + (h.unit.max_hp - h.unit.currentHp);
        if (s > actScore) {
          actScore = s;
          act = { type: 'heal', targetId: h.unit.id };
        }
      }
      unit.x = ox;
      unit.y = oy;
      score += actScore;

      // wounded fighters seek shrines
      if (unit.currentHp < 50 && t.building === 'shrine') score += 60;

      if (!best || score > best.score || (score === best.score && ihash(this.seed + ctx.round, unit.id, pos.x * 97 + pos.y) < 0.5)) {
        best = { score, pos, act, cost };
      }
    }

    // gold and a squad slot set aside for what was just ordered, so the next fighter plans with what is really left
    if (best?.act?.type === 'recruit') ctx.eco.squadN++;
    if (best?.cost) ctx.eco.budget -= best.cost;
    const move = best && !(best.pos.x === unit.x && best.pos.y === unit.y) ? { x: best.pos.x, y: best.pos.y } : null;
    return { unitId: unit.id, move, act: best?.act ?? null };
  }

  /** Travel cost from `pos` to the hunt goal (straight-line guess where the searched area ends). */
  goalCost(game, goal, pos) {
    const v = goal.field[pos.y * game.map.width + pos.x];
    return Number.isFinite(v) ? v : man(pos.x, pos.y, goal.x, goal.y) * 3 + 100;
  }
}
