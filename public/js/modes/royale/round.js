// Simultaneous-round controller (DOM-free).
//
//   beginRound()  — round bookkeeping, start-of-round effects for every warband
//   planBots()    — every bot warband decides its orders
//   resolve()     — everyone's orders execute in a seeded initiative order (rotates every round)
//   endRound()    — round-end rules (storm damage when a storm runs), eliminations, victory check
//
// Orders are plain JSON so they can cross the network:
//   { unitId, move: {x,y} | null, act: {type:'attack'|'heal'|'explore'|'claim'|'recruit'|'temper'|'study'|'wait', targetId?, item?} | null }
// (`item` is the unit index a 'recruit' order trains.)
// Because the engine, the seeded RNG and the bot AI are all deterministic, every client that applies the same
// orders from the same state ends in the identical state — that is the whole online model (lockstep).

import { Rng, hashSeed } from '../../engine/rng.js';
import { PLAYER_TYPES } from '../../config/constants.js';
import { getAttackableTargets, getHealableTargets } from '../../engine/pathfinding.js';

const noPace = async () => {};
/** Order actions that run through the rule modules' performAction (building actions and exploring). */
export const BUILDING_ACTIONS = new Set(['explore', 'claim', 'recruit', 'temper', 'study']);

export class RoyaleRound {
  /**
   * @param {import('../../engine/gameState.js').GameEngine} game
   * @param {{planTeam:(game,team)=>object[]}} planner  bot brain
   */
  constructor(game, planner) {
    this.game = game;
    this.planner = planner;
    this.round = 0;
    this.botOrders = {};
    this.seed = String(game.options.seed ?? 'royale');
  }

  /** Teams still in the match. */
  aliveTeams() {
    return this.game.activeTeams.filter(t => !this.game.players[t].eliminated);
  }

  isBot(team) {
    return this.game.players[team].type !== PLAYER_TYPES.LOCAL;
  }

  beginRound() {
    const g = this.game;
    this.round += 1;
    g.turnNumber = this.round;
    g.batch(() => {
      g.rules.notify('roundStart', g, this.round);
      g.decayTombs();
      for (const team of this.aliveTeams()) g.startTurnEffects(team, false, { global: false });
      g.clearSelection();
    });
    this.botOrders = {};
    return this.round;
  }

  /**
   * Bots decide their orders from the state at the start of the round. Kept separate from beginRound() so an online client
   * can first apply "player X left, a bot takes over" and still plan identically to everyone else.
   */
  planBots() {
    this.botOrders = {};
    for (const team of this.aliveTeams()) {
      if (this.isBot(team)) this.botOrders[team] = this.planner.planTeam(this.game, team);
    }
    return this.botOrders;
  }

  /** Initiative for this round: a seeded shuffle, so nobody permanently acts first. */
  initiative() {
    return new Rng(hashSeed(`${this.seed}:${this.round}`)).shuffle(this.aliveTeams());
  }

  /**
   * @param {Object<string, object[]>} humanOrders  team -> orders (teams missing here use bot orders if they are bots)
   * @param {{pace?:Function, viewTeam?:number|null}} opts  pace(ms,x,y) lets a UI animate steps the viewer can see
   */
  async resolve(humanOrders = {}, { pace = noPace, viewTeam = null } = {}) {
    const g = this.game;
    for (const team of this.initiative()) {
      if (g.phase === 'GAME_OVER') break;
      if (g.players[team].eliminated) continue;
      const orders = humanOrders[team] ?? (this.isBot(team) ? this.botOrders[team] : null) ?? [];
      g.currentTeamIndex = g.activeTeams.indexOf(team);
      for (const order of orders.slice().sort((a, b) => a.unitId - b.unitId)) {
        const unit = g.units.find(u => u.id === order.unitId && u.team === team && u.currentHp > 0);
        if (!unit) continue;
        const visible =
          viewTeam !== null &&
          (g.isTileVisible(viewTeam, unit.x, unit.y) || (order.move && g.isTileVisible(viewTeam, order.move.x, order.move.y)));
        if (visible) {
          g.muted = false;
          this.execute(unit, order);
          g.muted = true;
          g.notify();
          await pace(280, unit.x, unit.y);
        } else {
          g.muted = true;
          this.execute(unit, order);
        }
      }
    }
    g.muted = false;
  }

  /** One unit's order, through the ordinary engine commands so every rule applies. */
  execute(unit, order) {
    const g = this.game;
    if (g.selectedUnit) g.clearSelection();
    if (unit.standby || !g.selectUnit(unit)) return;

    if (order.move && !(order.move.x === unit.x && order.move.y === unit.y)) {
      let dest = g.reachable.find(r => r.x === order.move.x && r.y === order.move.y);
      if (!dest) {
        // blocked or occupied by now: get as close as we can
        let best = null;
        for (const r of g.reachable) {
          const d = Math.abs(r.x - order.move.x) + Math.abs(r.y - order.move.y);
          if (!best || d < best.d || (d === best.d && r.cost < best.cost)) best = { ...r, d };
        }
        dest = best;
      }
      if (dest && !(dest.x === unit.x && dest.y === unit.y)) g.moveSelectedUnitTo(dest.x, dest.y);
      else if (g.phase === 'MOVE') g.moveSelectedUnitTo(unit.x, unit.y);
    } else if (g.phase === 'MOVE') {
      g.moveSelectedUnitTo(unit.x, unit.y);
    }

    const act = order.act;
    if (unit.currentHp > 0 && g.phase === 'ACTION' && act) {
      if (act.type === 'attack') {
        const targets = getAttackableTargets(g, unit, unit.x, unit.y).filter(t => t.type === 'unit');
        // the intended target if it is still in reach, otherwise the weakest enemy that is
        const pick = targets.find(t => t.unit.id === act.targetId) || targets.sort((a, b) => a.unit.currentHp - b.unit.currentHp || a.unit.id - b.unit.id)[0];
        if (pick) g.executeAttack(unit, pick.x, pick.y);
      } else if (act.type === 'heal') {
        const targets = getHealableTargets(g, unit, unit.x, unit.y);
        const pick = targets.find(t => t.unit.id === act.targetId) || targets[0];
        if (pick) g.executeHeal(unit, pick.x, pick.y);
      } else if (BUILDING_ACTIONS.has(act.type) && g.availableActions.includes(act.type)) {
        g.executeCustomAction(unit, act.type, Number.isInteger(act.item) ? { item: act.item } : null);
      }
    }
    // whatever is left (waiting, nothing to do, charger's second move): the unit's turn is over
    if (unit.currentHp > 0 && !unit.standby) g.finishUnitTurn(unit);
    else if (g.selectedUnit) g.clearSelection();
    g.phase = g.phase === 'GAME_OVER' ? 'GAME_OVER' : 'IDLE';
  }

  endRound() {
    const g = this.game;
    g.batch(() => {
      g.rules.notify('roundEnd', g, this.round);
      g.checkVictoryConditions();
    });
    return g.phase === 'GAME_OVER';
  }

  /** Cheap fingerprint of the full state — clients compare these every round to catch desyncs. */
  stateHash() {
    const g = this.game;
    let h = 2166136261;
    const mix = v => {
      h ^= v | 0;
      h = Math.imul(h, 16777619) >>> 0;
    };
    mix(this.round);
    mix(g.rng.state);
    for (const u of g.units.slice().sort((a, b) => a.id - b.id)) {
      mix(u.id);
      mix(u.x);
      mix(u.y);
      mix(u.currentHp);
      mix(u.bonusAttack || 0);
      mix(u.bonusDef || 0);
      mix(u.movement_point);
      mix(u.xp || 0);
      mix(u.level || 0);
      mix(u.forged || 0);
    }
    for (const t of g.activeTeams) mix(g.players[t].gold);
    for (const key in g.holds) {
      mix(+key);
      mix(g.holds[key]);
    }
    for (let x = 0; x < g.map.width; x += 3) for (let y = 0; y < g.map.height; y += 3) mix(g.map.tiles[x][y]);
    return h >>> 0;
  }
}
