// AI controller — turn loop + classic tactical strategy (skirmish / campaign).
// Mode-specific AIs extend this class and override recruit()/actWithUnit()/unitOrder().
// DOM-free: pacing is injected (`pace`) so headless tests run at full speed.

import { ABILITY } from '../config/constants.js';
import { hasAbility, calculateDamage, getManhattanRange } from '../engine/combat.js';
import {
  getReachableTiles,
  getAttackableTargets,
  getSummonableTombs,
  getHealableTargets
} from '../engine/pathfinding.js';

const realSleep = ms => new Promise(r => setTimeout(r, ms));

export class AIController {
  constructor(gameEngine, { pace = null } = {}) {
    this.game = gameEngine;
    this.isThinking = false;
    this.paceFn = pace; // (ms, x, y) => Promise ; null = default pacing
    this.viewTeam = null; // set by the app: whose screen is watching (for fog-aware pacing)
    this.fast = false;
  }

  /** Wait so the human can follow the action — but not for moves hidden by fog. */
  async pace(ms, x = null, y = null) {
    if (this.fast) return;
    if (this.paceFn) return this.paceFn(ms, x, y);
    if (x !== null && this.viewTeam !== null && this.game.vision && !this.game.isTileVisible(this.viewTeam, x, y)) return;
    await realSleep(ms);
  }

  async playTurn() {
    if (this.isThinking || this.game.phase === 'GAME_OVER') return;
    this.isThinking = true;
    const team = this.game.getCurrentTeam();
    try {
      await this.pace(320);
      await this.beginTurn(team);
      await this.recruit(team);

      let safety = 120;
      let unit;
      while ((unit = this.nextUnit(team)) && safety-- > 0 && this.game.phase !== 'GAME_OVER') {
        await this.actWithUnit(unit, team);
        if (!unit.standby && unit.currentHp > 0 && this.game.phase !== 'GAME_OVER') {
          this.game.selectedUnit = unit; // never leave a unit hanging
          this.game.finishUnitTurn(unit);
        }
      }

      await this.recruit(team);
      if (this.game.phase !== 'GAME_OVER' && this.game.getCurrentTeam() === team) this.game.endTurn();
    } finally {
      this.isThinking = false;
    }
  }

  /** Hook: per-turn analysis. */
  async beginTurn() {}

  nextUnit(team) {
    const mine = this.game.units.filter(u => u.currentHp > 0 && u.team === team && !u.standby);
    return mine.length ? this.unitOrder(mine)[0] : null;
  }

  unitOrder(units) {
    return units;
  }

  // -------------------------------------------------------------------------------------------
  // Recruitment (classic: strongest affordable unit at every free castle)
  // -------------------------------------------------------------------------------------------
  async recruit(team) {
    const game = this.game;
    const player = game.players[team];
    if (!player) return;
    const commanderIndex = game.assets.unitConfig?.commander_index ?? 9;
    const candidates = [8, 12, 6, 5, 3, 2, 1, 0]; // Dragon, Paladin, Golem, Wolf, Sorceress, Elemental, Archer, Soldier

    for (const s of game.structures) {
      const tile = game.assets.getTile(game.map.tiles[s.x][s.y]);
      if (!tile.isCastle || tile.team !== team || game.getUnitAt(s.x, s.y)) continue;
      if (!player.commanderAlive && game.canRecruitUnit(team, commanderIndex, s.x, s.y).ok) {
        game.recruitUnit(team, commanderIndex, s.x, s.y);
        await this.pace(220, s.x, s.y);
        continue;
      }
      for (const uIdx of candidates) {
        if (game.canRecruitUnit(team, uIdx, s.x, s.y).ok) {
          game.recruitUnit(team, uIdx, s.x, s.y);
          await this.pace(220, s.x, s.y);
          break;
        }
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Classic unit logic
  // -------------------------------------------------------------------------------------------
  async actWithUnit(unit, aiTeam) {
    const game = this.game;
    game.selectUnit(unit);
    const { reachable } = getReachableTiles(game, unit);

    let bestMove = { x: unit.x, y: unit.y };
    let bestAction = { type: 'standby' };
    let bestScore = -99999;

    const enemies = game.units.filter(u => u.currentHp > 0 && u.team !== aiTeam && game.canSeeUnit(aiTeam, u));
    const capturable = [];
    for (const s of game.structures) {
      const t = game.assets.getTile(game.map.tiles[s.x][s.y]);
      if (t.isCapturable && t.team !== aiTeam) capturable.push({ x: s.x, y: s.y, tile: t });
    }

    for (const pos of reachable) {
      const tile = game.assets.getTile(game.map.tiles[pos.x][pos.y]);
      let basePosScore = tile.defenceBonus * 0.5;

      let minObjectiveDist = 999;
      for (const e of enemies) minObjectiveDist = Math.min(minObjectiveDist, getManhattanRange(pos.x, pos.y, e.x, e.y));
      for (const b of capturable) {
        if (game.canCapture(unit, b.tile)) minObjectiveDist = Math.min(minObjectiveDist, getManhattanRange(pos.x, pos.y, b.x, b.y));
      }
      basePosScore -= minObjectiveDist * 3;

      if (game.canCapture(unit, tile)) {
        const capScore = basePosScore + (tile.isCastle ? 500 : 300);
        if (capScore > bestScore) {
          bestScore = capScore;
          bestMove = pos;
          bestAction = { type: 'occupy' };
        }
      }
      if (tile.isRepairable && hasAbility(unit, ABILITY.REPAIRER)) {
        const s = basePosScore + 220;
        if (s > bestScore) {
          bestScore = s;
          bestMove = pos;
          bestAction = { type: 'repair' };
        }
      }
      const tombs = getSummonableTombs(game, unit, pos.x, pos.y);
      if (tombs.length > 0 && basePosScore + 240 > bestScore) {
        bestScore = basePosScore + 240;
        bestMove = pos;
        bestAction = { type: 'summon', targetX: tombs[0].x, targetY: tombs[0].y };
      }
      for (const ht of getHealableTargets(game, unit, pos.x, pos.y)) {
        const s = basePosScore + 180 + (ht.unit.max_hp - ht.unit.currentHp);
        if (s > bestScore) {
          bestScore = s;
          bestMove = pos;
          bestAction = { type: 'heal', targetX: ht.x, targetY: ht.y };
        }
      }
      for (const atk of getAttackableTargets(game, unit, pos.x, pos.y)) {
        if (atk.type !== 'unit') continue;
        const ox = unit.x;
        const oy = unit.y;
        unit.x = pos.x;
        unit.y = pos.y;
        const dmg = calculateDamage(game, unit, atk.unit, false);
        unit.x = ox;
        unit.y = oy;
        const s = basePosScore + dmg * 3 + (dmg >= atk.unit.currentHp ? 250 : 0) + (atk.unit.isCommander ? 80 : 0);
        if (s > bestScore) {
          bestScore = s;
          bestMove = pos;
          bestAction = { type: 'attack', targetX: atk.x, targetY: atk.y };
        }
      }
      if (basePosScore > bestScore) {
        bestScore = basePosScore;
        bestMove = pos;
        bestAction = { type: 'standby' };
      }
    }

    await this.commit(unit, bestMove, bestAction);
  }

  /** Move, then perform the chosen action. Shared by every strategy. */
  async commit(unit, move, action) {
    const game = this.game;
    if (game.selectedUnit !== unit) game.selectUnit(unit);
    const fromX = unit.x;
    const fromY = unit.y;
    game.moveSelectedUnitTo(move.x, move.y);
    await this.pace(150, move.x, move.y);
    if (game.phase === 'GAME_OVER') return;

    // An ambush may have stopped the unit early: fall back to the best action actually available
    let act = action;
    if (unit.ambushed && !(move.x === unit.x && move.y === unit.y)) {
      const atk = getAttackableTargets(game, unit, unit.x, unit.y).find(t => t.type === 'unit');
      act = atk ? { type: 'attack', targetX: atk.x, targetY: atk.y } : { type: 'standby' };
    }

    switch (act.type) {
      case 'occupy': game.executeCapture(unit); break;
      case 'repair': game.executeRepair(unit); break;
      case 'summon': game.executeSummon(unit, act.targetX, act.targetY); break;
      case 'heal': game.executeHeal(unit, act.targetX, act.targetY); break;
      case 'attack':
        game.executeAttack(unit, act.targetX, act.targetY);
        if (game.selectedUnit === unit && game.phase === 'MOVE') game.finishUnitTurn(unit); // charger: skip 2nd move
        break;
      case 'custom':
        game.executeCustomAction(unit, act.id, act.target ?? null);
        if (game.selectedUnit === unit && game.phase === 'MOVE') game.finishUnitTurn(unit);
        break;
      default:
        game.finishUnitTurn(unit);
    }
    await this.pace(120, unit.x, unit.y);
    return { fromX, fromY };
  }
}
