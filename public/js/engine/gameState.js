// Game state & deterministic command engine.
//
// Platform-agnostic: no DOM, no window, no Math.random. The same file runs in the browser, in a
// Web Worker, in Node (headless tests / authoritative server) and inside Electron/Tauri/Capacitor shells.
// Mode-specific behaviour (fog, farming, renown, …) plugs in through `RuleSet` modules.

import { ABILITY, STATUS, DEFAULT_RULES, PLAYER_TYPES } from '../config/constants.js';
import {
  hasAbility,
  hasStatus,
  getUnitStats,
  calculateDamage,
  canCounterAttack,
  getTerrainHeal,
  getHealerHeal,
  getManhattanRange
} from './combat.js';
import {
  getReachableTiles,
  reconstructPath,
  getAttackableTargets,
  getSummonableTombs,
  getHealableTargets
} from './pathfinding.js';
import { Rng } from './rng.js';
import { EMPTY_RULES } from './ruleSet.js';

const noop = () => {};

export class GameEngine {
  constructor(assets, soundManager, onStateChange = noop, onFloatingText = noop, onEvent = noop) {
    this.assets = assets;
    this.sound = soundManager;
    this.onStateChange = onStateChange;
    this.onFloatingText = onFloatingText;
    this.onEvent = onEvent;
    this.reset();
  }

  reset() {
    this.map = null;
    this.units = [];
    this.tombs = [];
    this.players = {};
    this.activeTeams = [];
    this.currentTeamIndex = 0;
    this.turnNumber = 1;
    this.nextUnitId = 1;
    this.rules = EMPTY_RULES;
    this.rng = new Rng(1);
    this.options = {};
    this.vision = null; // set by the fog-of-war module

    this._cells = null; // x,y -> unit cache
    this._structMap = new Map();
    this._structList = [];
    this._structDirty = true;

    // UI / interaction state
    this.phase = 'IDLE'; // IDLE, MOVE, ACTION, ATTACK, SUMMON, HEAL, CUSTOM, GAME_OVER
    this.selectedUnit = null;
    this.reachable = [];
    this.pathField = null;
    this.actionTargets = [];
    this.availableActions = [];
    this.pendingAction = null;
    this.winnerTeam = null;
    this.muted = false; // true while a batch (e.g. a Royale round) resolves: no per-action UI notifications
    this.teamNames = {}; // optional display names (players, bots)
    this.mode = 'skirmish'; // skirmish | campaign | online | frontier
    this.campaignMeta = null;
  }

  // -------------------------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------------------------
  initGame(mapData, playerConfig = {}, options = {}) {
    this.reset();
    this.options = options;
    this.simultaneous = !!options.simultaneous; // Battle Royale: all teams plan together, then resolve
    this.mode = options.mode || 'skirmish';
    this.rules = options.rules || EMPTY_RULES;
    this.rng = new Rng(options.seed ?? mapData.seed ?? 1);
    this.campaignMeta =
      mapData.category === 'campaign'
        ? {
            campaign: mapData.campaign,
            stageNum: mapData.stageNum,
            name: mapData.name,
            objective: mapData.objective,
            dialogs: mapData.dialogs || []
          }
        : null;

    this.map = {
      id: mapData.id,
      name: mapData.name,
      width: mapData.width,
      height: mapData.height,
      tiles: mapData.tiles.map(col => [...col]),
      teamAccess: [...(mapData.teamAccess || [true, true, false, false])],
      theme: mapData.theme || null,
      meta: mapData.meta || null
    };
    this.rebuildStructures();

    const teamsOnMap = new Set(mapData.activeTeams || []);
    for (const s of this.structures) {
      const t = this.assets.getTile(this.map.tiles[s.x][s.y]);
      if (t.isCastle && t.team >= 0) teamsOnMap.add(t.team);
    }
    for (const u of mapData.units || []) if (u.team >= 0) teamsOnMap.add(u.team);

    this.activeTeams = Array.from(teamsOnMap).sort((a, b) => a - b);
    if (this.activeTeams.length === 0) this.activeTeams = [0, 1];

    const startGold = options.startGold ?? DEFAULT_RULES.START_GOLD;
    const maxPop = options.maxPop ?? DEFAULT_RULES.UNIT_CAPACITY;
    for (const teamId of this.activeTeams) {
      this.players[teamId] = {
        team: teamId,
        type: playerConfig[teamId] || (teamId === 0 ? PLAYER_TYPES.LOCAL : PLAYER_TYPES.AI),
        gold: startGold,
        maxPop,
        commanderDeaths: 0,
        commanderAlive: false,
        eliminated: false
      };
    }

    for (const u of mapData.units || []) this.spawnUnit(u.index, u.team, u.x, u.y, false);

    this.currentTeamIndex = 0;
    this.turnNumber = 1;
    this.rules.notify('setup', this, options);
    this.startTurnEffects(this.getCurrentTeam(), true);
    this.notify();
  }

  // -------------------------------------------------------------------------------------------
  // Indexes (units by cell, structures list) — keep large maps fast
  // -------------------------------------------------------------------------------------------
  touchUnits() {
    this._cells = null;
  }

  getUnitAt(x, y) {
    if (!this._cells) {
      const cells = new Map();
      const w = this.map.width;
      for (const u of this.units) if (u.currentHp > 0) cells.set(u.y * w + u.x, u);
      this._cells = cells;
    }
    return this._cells.get(y * this.map.width + x) || null;
  }

  /** Occupant of a cell as perceived by `team` (hidden enemies under fog read as empty). */
  getUnitAtFor(team, x, y) {
    const u = this.getUnitAt(x, y);
    return u && this.canSeeUnit(team, u) ? u : null;
  }

  canSeeUnit(team, unit) {
    if (!this.vision || unit.team === team) return true;
    return this.vision.canSeeUnit(team, unit);
  }

  isTileVisible(team, x, y) {
    return !this.vision || this.vision.isVisible(team, x, y);
  }

  get structures() {
    if (this._structDirty) {
      this._structList = Array.from(this._structMap.values());
      this._structDirty = false;
    }
    return this._structList;
  }

  isStructureTile(tile) {
    return !!(
      tile.isCastle || tile.isVillage || tile.isCapturable || tile.isRepairable || tile.isDestroyable || tile.building
    );
  }

  rebuildStructures() {
    this._structMap.clear();
    for (let x = 0; x < this.map.width; x++) {
      for (let y = 0; y < this.map.height; y++) {
        if (this.isStructureTile(this.assets.getTile(this.map.tiles[x][y]))) {
          this._structMap.set(y * this.map.width + x, { x, y });
        }
      }
    }
    this._structDirty = true;
  }

  /** Single choke-point for terrain mutation so indexes and modules stay consistent. */
  setTile(x, y, tileIndex) {
    const old = this.map.tiles[x][y];
    if (old === tileIndex) return;
    this.map.tiles[x][y] = tileIndex;
    const key = y * this.map.width + x;
    if (this.isStructureTile(this.assets.getTile(tileIndex))) this._structMap.set(key, { x, y });
    else this._structMap.delete(key);
    this._structDirty = true;
    this.rules.notify('onTileChanged', this, x, y, old, tileIndex);
    this.onEvent('tile', { x, y });
  }

  // -------------------------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------------------------
  getCurrentTeam() {
    return this.activeTeams[this.currentTeamIndex] ?? 0;
  }

  getCurrentPlayer() {
    return this.players[this.getCurrentTeam()];
  }

  getMaxPop(team) {
    const base = this.players[team]?.maxPop ?? DEFAULT_RULES.UNIT_CAPACITY;
    return this.rules.reduce('popCap', this, base, team);
  }

  getTeamPopulation(team) {
    let pop = 0;
    for (const u of this.units) if (u.currentHp > 0 && u.team === team) pop += u.occupancy || 1;
    return pop;
  }

  getTeamIncome(team) {
    let income = 0;
    for (const s of this.structures) {
      const tile = this.assets.getTile(this.map.tiles[s.x][s.y]);
      if (tile.team === team) {
        if (tile.isCastle) income += DEFAULT_RULES.CASTLE_INCOME;
        else if (tile.isVillage) income += DEFAULT_RULES.VILLAGE_INCOME;
      }
    }
    if (this.units.some(u => u.currentHp > 0 && u.team === team && u.isCommander)) {
      income += DEFAULT_RULES.COMMANDER_INCOME;
    }
    return this.rules.reduce('income', this, income, team);
  }

  getUnitsOf(team) {
    return this.units.filter(u => u.currentHp > 0 && u.team === team);
  }

  /** Move points a *template* will have in this game (rule modules such as movement profiles may retune them). */
  templateMp(tpl) {
    return this.rules.first('templateMp', this, tpl) ?? tpl.movement_point;
  }

  getEffectiveStats(unit) {
    return getUnitStats(unit);
  }

  // -------------------------------------------------------------------------------------------
  // Units
  // -------------------------------------------------------------------------------------------
  spawnUnit(unitIndex, team, x, y, standby = false) {
    const tpl = this.assets.getUnitTemplate(unitIndex);
    const unit = {
      ...tpl,
      id: this.nextUnitId++,
      team,
      x,
      y,
      startTurnX: x,
      startTurnY: y,
      currentHp: tpl.max_hp,
      currentMp: tpl.movement_point,
      level: 0,
      xp: 0,
      standby,
      hasMoved: false,
      hasActed: false,
      status: null,
      bonusAttack: 0,
      headIndex: Math.min(3, Math.max(0, team))
    };
    this.units.push(unit);
    this.touchUnits();
    if (unit.isCommander && this.players[team]) this.players[team].commanderAlive = true;
    this.rules.notify('onUnitSpawned', this, unit);
    this.onEvent('spawn', { unit });
    return unit;
  }

  decayTombs() {
    this.tombs = this.tombs.map(t => ({ ...t, turns: t.turns - 1 })).filter(t => t.turns > 0);
  }

  /** `global:false` skips once-per-round work (tombstone decay) when many teams start their round together. */
  startTurnEffects(team, isFirstTurn = false, { global = true } = {}) {
    const player = this.players[team];
    if (!player) return;

    if (!isFirstTurn) player.gold += this.getTeamIncome(team);

    if (global) this.decayTombs();

    for (const unit of this.units) {
      if (unit.currentHp <= 0 || unit.team !== team) continue;

      unit.standby = false;
      unit.hasMoved = false;
      unit.hasActed = false;
      unit.ambushed = false;
      unit.startTurnX = unit.x;
      unit.startTurnY = unit.y;

      const isPoisoned = hasStatus(unit, STATUS.POISONED);
      const isUndead = hasAbility(unit, ABILITY.UNDEAD);

      let deltaHp = 0;
      if (isPoisoned) deltaHp += isUndead ? DEFAULT_RULES.POISON_DAMAGE : -DEFAULT_RULES.POISON_DAMAGE;
      if (!isPoisoned || isUndead || hasAbility(unit, ABILITY.REHABILITATION)) {
        deltaHp += getTerrainHeal(this, unit);
      }

      if (deltaHp !== 0) {
        const prev = unit.currentHp;
        unit.currentHp = Math.max(1, Math.min(unit.max_hp, unit.currentHp + deltaHp));
        const actual = unit.currentHp - prev;
        if (actual !== 0) {
          this.onFloatingText(unit.x, unit.y, actual > 0 ? `+${actual}` : `${actual}`, actual > 0 ? '#4ade80' : '#c084fc');
        }
      }

      if (unit.status) {
        unit.status.turns -= 1;
        if (unit.status.turns <= 0) unit.status = null;
      }
      unit.currentMp = getUnitStats(unit).movementPoint;
    }

    this.clearSelection();
    this.rules.notify('turnStart', this, team);
  }

  clearSelection() {
    this.phase = this.phase === 'GAME_OVER' ? 'GAME_OVER' : 'IDLE';
    this.selectedUnit = null;
    this.reachable = [];
    this.pathField = null;
    this.actionTargets = [];
    this.availableActions = [];
    this.pendingAction = null;
  }

  selectUnit(unit) {
    if (!unit || unit.currentHp <= 0 || unit.standby || unit.team !== this.getCurrentTeam()) return false;
    this.selectedUnit = unit;
    this.startTurnX = unit.x;
    this.startTurnY = unit.y;
    const { reachable, field } = getReachableTiles(this, unit);
    this.reachable = reachable;
    this.pathField = field;
    this.phase = 'MOVE';
    this.sfx('select');
    this.notify();
    return true;
  }

  cancelSelection() {
    const u = this.selectedUnit;
    if (u && this.phase !== 'MOVE' && u.hasMoved && !u.hasActed && !u.ambushed) {
      u.x = u.startTurnX;
      u.y = u.startTurnY;
      u.currentMp = getUnitStats(u).movementPoint;
      u.hasMoved = false;
      this.touchUnits();
      this.rules.notify('afterMove', this, u);
    }
    this.clearSelection();
    this.notify();
  }

  moveSelectedUnitTo(targetX, targetY) {
    const unit = this.selectedUnit;
    if (!unit) return false;
    const entry = this.reachable.find(r => r.x === targetX && r.y === targetY);
    if (!entry) return false;

    let destX = targetX;
    let destY = targetY;
    let cost = entry.cost;
    let ambushed = false;

    const path = reconstructPath(this.pathField, unit.x, unit.y, targetX, targetY);
    const walkable = this.rules.first('truncateMove', this, unit, path);
    if (typeof walkable === 'number' && walkable < path.length - 1) {
      const stop = path[Math.max(0, walkable)];
      destX = stop.x;
      destY = stop.y;
      cost = this.pathField.getDist(destX, destY);
      ambushed = true;
      path.length = Math.max(1, walkable + 1);
    }

    const fromX = unit.x;
    const fromY = unit.y;
    unit.x = destX;
    unit.y = destY;
    this.touchUnits();
    unit.currentMp = Math.max(0, unit.currentMp - cost);
    unit.hasMoved = cost > 0;
    unit.ambushed = ambushed;
    this.sfx('move');
    this.onEvent('move', { unit, path, fromX, fromY });
    this.rules.notify('afterMove', this, unit);

    if (ambushed) {
      this.onFloatingText(destX, destY, 'AMBUSH!', '#f97316');
      this.computeAvailableActions(unit);
      this.availableActions = this.availableActions.filter(a => a !== 'buy');
      this.phase = 'ACTION';
      this.notify();
      return true;
    }

    if (unit.hasActed) {
      this.finishUnitTurn(unit); // Charger finishing its secondary move
      return true;
    }

    this.computeAvailableActions(unit);
    this.phase = 'ACTION';
    this.notify();
    return true;
  }

  captureRequirement(tile) {
    if (!tile.isCapturable) return undefined;
    if (tile.captureAbility !== undefined) return tile.captureAbility; // null => anyone
    if (tile.isCastle) return ABILITY.COMMANDER;
    if (tile.isVillage) return ABILITY.CONQUEROR;
    return ABILITY.CONQUEROR;
  }

  canCapture(unit, tile) {
    if (!tile.isCapturable || tile.team === unit.team) return false;
    const need = this.captureRequirement(tile);
    return need === null || hasAbility(unit, need);
  }

  computeAvailableActions(unit) {
    const actions = [];
    const tile = this.assets.getTile(this.map.tiles[unit.x][unit.y]);

    if (this.canCapture(unit, tile)) actions.push('occupy');
    if (tile.isRepairable && hasAbility(unit, ABILITY.REPAIRER)) actions.push('repair');
    if (getAttackableTargets(this, unit, unit.x, unit.y).length > 0) actions.push('attack');
    if (getSummonableTombs(this, unit, unit.x, unit.y).length > 0) actions.push('summon');
    if (getHealableTargets(this, unit, unit.x, unit.y).length > 0) actions.push('heal');

    if (unit.isCommander && !unit.hasMoved && this.getRecruitSite(unit.team, unit.x, unit.y)) {
      actions.push('buy');
    }

    const extra = this.rules.reduce('actions', this, [], unit);
    for (const a of extra) if (!actions.includes(a)) actions.push(a);

    actions.push('standby');
    this.availableActions = actions;
    return actions;
  }

  beginActionTargeting(actionType) {
    const unit = this.selectedUnit;
    if (!unit) return;
    if (actionType === 'attack') {
      this.actionTargets = getAttackableTargets(this, unit, unit.x, unit.y);
      this.phase = 'ATTACK';
    } else if (actionType === 'summon') {
      this.actionTargets = getSummonableTombs(this, unit, unit.x, unit.y);
      this.phase = 'SUMMON';
    } else if (actionType === 'heal') {
      this.actionTargets = getHealableTargets(this, unit, unit.x, unit.y);
      this.phase = 'HEAL';
    } else if (actionType === 'occupy') {
      this.executeCapture(unit);
      return;
    } else if (actionType === 'repair') {
      this.executeRepair(unit);
      return;
    } else if (actionType === 'standby') {
      this.finishUnitTurn(unit);
      return;
    } else {
      // Custom action supplied by a rule module
      const targets = this.rules.first('actionTargets', this, unit, actionType);
      if (Array.isArray(targets) && targets.length > 0) {
        this.actionTargets = targets;
        this.pendingAction = actionType;
        this.phase = 'CUSTOM';
      } else {
        this.executeCustomAction(unit, actionType, null);
        return;
      }
    }
    this.notify();
  }

  executeCustomAction(unit, actionId, target) {
    const handled = this.rules.first('performAction', this, unit, actionId, target);
    if (!handled) {
      this.clearSelection();
      this.notify();
      return false;
    }
    unit.hasActed = true;
    this.pendingAction = null;
    this.afterUnitAction(unit);
    return true;
  }

  executeCapture(unit) {
    const tile = this.assets.getTile(this.map.tiles[unit.x][unit.y]);
    if (!tile.isCapturable) return;
    this.setTile(unit.x, unit.y, tile.capturedTileList[unit.team] ?? this.map.tiles[unit.x][unit.y]);
    this.sfx('capture');
    this.onFloatingText(unit.x, unit.y, 'CAPTURED!', '#facc15');
    unit.hasActed = true;
    this.afterUnitAction(unit);
  }

  executeRepair(unit) {
    const tile = this.assets.getTile(this.map.tiles[unit.x][unit.y]);
    if (!tile.isRepairable) return;
    this.setTile(unit.x, unit.y, tile.repairedTileIndex);
    this.sfx('capture');
    this.onFloatingText(unit.x, unit.y, 'REPAIRED!', '#38bdf8');
    unit.hasActed = true;
    this.afterUnitAction(unit);
  }

  executeAttack(unit, targetX, targetY) {
    const info = getAttackableTargets(this, unit, unit.x, unit.y).find(t => t.x === targetX && t.y === targetY);
    if (!info) return false;

    this.sfx('attack');

    if (info.type === 'tile_destroy') {
      const tile = this.assets.getTile(this.map.tiles[targetX][targetY]);
      if (tile.isDestroyable) {
        this.setTile(targetX, targetY, tile.destroyedTileIndex);
        this.onFloatingText(targetX, targetY, 'DESTROYED!', '#f97316');
      }
      unit.hasActed = true;
      this.afterUnitAction(unit);
      return true;
    }

    const defender = info.unit;
    const dmg = calculateDamage(this, unit, defender, true);
    defender.currentHp = Math.max(0, defender.currentHp - dmg);
    this.onFloatingText(defender.x, defender.y, `-${dmg}`, '#ef4444');
    this.onEvent('attack', { attacker: unit, defender, damage: dmg });

    if (defender.currentHp > 0) {
      if (hasAbility(unit, ABILITY.POISONER) && !hasAbility(defender, ABILITY.POISONER)) {
        defender.status = { type: STATUS.POISONED, turns: 2 };
      }
      if (hasAbility(unit, ABILITY.BLINDER) && !hasAbility(defender, ABILITY.BLINDER)) {
        defender.status = { type: STATUS.BLINDED, turns: 1 };
      }
    }

    if (defender.currentHp <= 0) {
      this.handleUnitDeath(defender, unit);
      this.grantExperience(unit, DEFAULT_RULES.KILL_EXPERIENCE);
    } else {
      this.grantExperience(unit, DEFAULT_RULES.ATTACK_EXPERIENCE);
      if (canCounterAttack(unit, defender)) {
        const counterDmg = calculateDamage(this, defender, unit, true);
        unit.currentHp = Math.max(0, unit.currentHp - counterDmg);
        this.onFloatingText(unit.x, unit.y, `-${counterDmg} (Counter)`, '#fb923c');
        this.onEvent('attack', { attacker: defender, defender: unit, damage: counterDmg, counter: true });
        if (unit.currentHp <= 0) {
          this.handleUnitDeath(unit, defender);
          this.grantExperience(defender, DEFAULT_RULES.KILL_EXPERIENCE);
        } else {
          this.grantExperience(defender, DEFAULT_RULES.COUNTER_EXPERIENCE);
        }
      }
    }

    unit.hasActed = true;
    this.afterUnitAction(unit);
    return true;
  }

  executeSummon(unit, targetX, targetY) {
    const tombIdx = this.tombs.findIndex(t => t.x === targetX && t.y === targetY);
    if (tombIdx === -1) return false;
    this.tombs.splice(tombIdx, 1);

    const skelIndex = this.assets.unitConfig?.skeleton_index ?? 10;
    this.spawnUnit(skelIndex, unit.team, targetX, targetY, true);
    this.sfx('summon');
    this.onFloatingText(targetX, targetY, 'SUMMONED!', '#c084fc');
    this.grantExperience(unit, DEFAULT_RULES.ATTACK_EXPERIENCE);

    unit.hasActed = true;
    this.afterUnitAction(unit);
    return true;
  }

  executeHeal(unit, targetX, targetY) {
    const target = this.getUnitAt(targetX, targetY);
    if (!target) return false;

    const amount = getHealerHeal(unit, target);
    this.sfx('heal');

    if (amount < 0) {
      const dmg = Math.min(target.currentHp, -amount);
      target.currentHp -= dmg;
      this.onFloatingText(target.x, target.y, `-${dmg} HOLY!`, '#facc15');
      if (target.currentHp <= 0) {
        this.handleUnitDeath(target, unit);
        this.grantExperience(unit, DEFAULT_RULES.KILL_EXPERIENCE);
      }
    } else {
      const prev = target.currentHp;
      target.currentHp = Math.min(target.max_hp, target.currentHp + amount);
      this.onFloatingText(target.x, target.y, `+${target.currentHp - prev} HP`, '#4ade80');
      this.grantExperience(unit, DEFAULT_RULES.ATTACK_EXPERIENCE);
    }

    unit.hasActed = true;
    this.afterUnitAction(unit);
    return true;
  }

  afterUnitAction(unit) {
    if (unit.currentHp <= 0) {
      this.clearSelection();
      this.checkVictoryConditions();
      this.notify();
      return;
    }

    // Charger: with MP left after acting the unit may make a secondary move
    if (hasAbility(unit, ABILITY.CHARGER) && unit.currentMp > 0) {
      const { reachable, field } = getReachableTiles(this, unit);
      if (reachable.length > 1) {
        this.reachable = reachable;
        this.pathField = field;
        this.actionTargets = [];
        this.availableActions = [];
        this.phase = 'MOVE';
        this.checkVictoryConditions();
        this.notify();
        return;
      }
    }
    this.finishUnitTurn(unit);
  }

  finishUnitTurn(unit) {
    unit.standby = true;
    unit.currentMp = 0;

    for (const other of this.units) {
      if (other.currentHp <= 0 || other.id === unit.id) continue;
      const dist = getManhattanRange(unit.x, unit.y, other.x, other.y);
      if (dist <= 2) {
        if (hasAbility(unit, ABILITY.REFRESH_AURA) && other.team === unit.team) {
          other.status = null;
          const heal = DEFAULT_RULES.REFRESH_BASE_HEAL + (unit.level || 0) * 5;
          other.currentHp = Math.min(other.max_hp, other.currentHp + heal);
          this.onFloatingText(other.x, other.y, `+${heal} Aura`, '#38bdf8');
        }
        if (hasAbility(unit, ABILITY.ATTACK_AURA) && other.team === unit.team) {
          other.status = { type: STATUS.INSPIRED, turns: 1 };
          this.onFloatingText(other.x, other.y, 'INSPIRED!', '#facc15');
        }
        if (hasAbility(unit, ABILITY.SLOWING_AURA) && other.team !== unit.team && !hasAbility(other, ABILITY.SLOWING_AURA)) {
          other.status = { type: STATUS.SLOWED, turns: 1 };
        }
      }
    }

    const onTomb = this.tombs.some(t => t.x === unit.x && t.y === unit.y);
    if (onTomb && !hasAbility(unit, ABILITY.UNDEAD) && !hasAbility(unit, ABILITY.NECROMANCER)) {
      unit.status = { type: STATUS.POISONED, turns: 2 };
      this.onFloatingText(unit.x, unit.y, 'POISONED!', '#c084fc');
    }

    this.clearSelection();
    this.checkVictoryConditions();
    this.notify();
  }

  handleUnitDeath(unit, killer = null) {
    unit.currentHp = 0;
    if (unit.isCommander && this.players[unit.team]) {
      this.players[unit.team].commanderAlive = false;
      this.players[unit.team].commanderDeaths += 1;
    }
    if (!hasAbility(unit, ABILITY.UNDEAD) && !unit.isCrystal) {
      this.tombs = this.tombs.filter(t => !(t.x === unit.x && t.y === unit.y));
      this.tombs.push({ x: unit.x, y: unit.y, turns: 2 });
    }
    this.units = this.units.filter(u => u.currentHp > 0);
    this.touchUnits();
    this.onEvent('death', { unit });
    this.rules.notify('onUnitKilled', this, unit, killer);
  }

  grantExperience(unit, xpGain) {
    if (unit.currentHp <= 0 || unit.level >= 3) return;
    unit.xp = (unit.xp || 0) + xpGain;
    if (unit.xp >= 100) {
      unit.xp -= 100;
      unit.level += 1;
      this.onFloatingText(unit.x, unit.y, `LEVEL UP! (Lv.${unit.level})`, '#fde047');
    }
  }

  // -------------------------------------------------------------------------------------------
  // Recruitment
  // -------------------------------------------------------------------------------------------
  /** Which unit indexes can be bought where `team` stands/clicks — castles by default, modules add more. */
  getRecruitSite(team, x, y) {
    const tile = this.assets.getTile(this.map.tiles[x][y]);
    const fromModule = this.rules.first('recruitSite', this, team, x, y, tile);
    if (fromModule !== undefined) return fromModule;
    if (tile.isCastle && tile.team === team) return { roster: this.getClassicRoster(), kind: 'castle' };
    return null;
  }

  getClassicRoster() {
    const out = [];
    for (const u of this.assets.units) {
      if (u.isSkeleton || u.isCrystal || u.pack) continue;
      out.push(u.index);
    }
    return out;
  }

  getRecruitPrice(team, unitIndex) {
    const tpl = this.assets.getUnitTemplate(unitIndex);
    if (tpl.isCommander) {
      const deaths = this.players[team]?.commanderDeaths || 0;
      return tpl.price + deaths * DEFAULT_RULES.COMMANDER_PRICE_STEP;
    }
    return tpl.price;
  }

  canRecruitUnit(team, unitIndex, x, y) {
    const player = this.players[team];
    if (!player) return { ok: false, reason: 'Invalid player' };
    const site = this.getRecruitSite(team, x, y);
    if (!site) return { ok: false, reason: 'Not your recruiting site' };
    if (!site.roster.includes(unitIndex)) return { ok: false, reason: 'Not trained here' };
    // Original rule (GameCore.canBuyUponUnit): an empty site, or one holding your own Commander, may recruit.
    const occupant = this.getUnitAt(x, y);
    if (occupant && !(occupant.isCommander && occupant.team === team)) return { ok: false, reason: 'Tile is occupied' };
    if (occupant && !this.hasFreeNeighbour(x, y)) return { ok: false, reason: 'No room to deploy' };

    const tpl = this.assets.getUnitTemplate(unitIndex);
    if (tpl.isSkeleton || tpl.isCrystal) return { ok: false, reason: 'Cannot recruit special unit' };
    if (tpl.isCommander && player.commanderAlive) return { ok: false, reason: 'Commander already fielded' };

    const price = this.getRecruitPrice(team, unitIndex);
    if (player.gold < price) return { ok: false, reason: 'Not enough Gold' };

    if (!tpl.isCommander && this.getTeamPopulation(team) + (tpl.occupancy || 1) > this.getMaxPop(team)) {
      return { ok: false, reason: 'Supply cap reached' };
    }
    return this.rules.reduce('canRecruit', this, { ok: true, price }, team, unitIndex, x, y);
  }

  hasFreeNeighbour(x, y) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < this.map.width && ny < this.map.height && !this.getUnitAt(nx, ny)) return true;
    }
    return false;
  }

  /**
   * Where a recruit appears. Normally on the site itself; if your own Commander is standing there (allowed by the
   * original rules) the recruit is deployed to the cheapest free neighbouring tile instead of stacking invisibly
   * underneath him.
   */
  pickDeploySpot(x, y, tpl) {
    const air = (tpl.abilities || []).includes(ABILITY.AIR_FORCE);
    let best = null;
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= this.map.width || ny >= this.map.height || this.getUnitAt(nx, ny)) continue;
      const cost = air ? 1 : this.assets.getTile(this.map.tiles[nx][ny]).stepCost;
      if (!best || cost < best.cost) best = { x: nx, y: ny, cost };
    }
    return best;
  }

  recruitUnit(team, unitIndex, x, y) {
    const check = this.canRecruitUnit(team, unitIndex, x, y);
    if (!check.ok) return false;
    const tpl = this.assets.getUnitTemplate(unitIndex);
    const spot = this.getUnitAt(x, y) ? this.pickDeploySpot(x, y, tpl) : { x, y };
    if (!spot) return false;
    this.players[team].gold -= check.price;
    const unit = this.spawnUnit(unitIndex, team, spot.x, spot.y, false);
    this.sfx('recruit');
    this.onFloatingText(spot.x, spot.y, `Recruited ${unit.name}!`, '#38bdf8');
    this.selectUnit(unit);
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Turn flow & victory
  // -------------------------------------------------------------------------------------------
  endTurn() {
    if (this.phase === 'GAME_OVER') return;
    const finishing = this.getCurrentTeam();
    this.rules.notify('turnEnd', this, finishing);
    this.clearSelection();

    for (let i = 0; i < this.activeTeams.length; i++) {
      this.currentTeamIndex = (this.currentTeamIndex + 1) % this.activeTeams.length;
      if (this.currentTeamIndex === 0) this.turnNumber += 1;
      if (!this.players[this.getCurrentTeam()]?.eliminated) break;
    }

    this.startTurnEffects(this.getCurrentTeam(), false);
    this.checkVictoryConditions();
    this.notify();
  }

  checkVictoryConditions() {
    // one pass over units and structures (this runs after every action, and a 60-team match has hundreds of both)
    const withUnits = new Set();
    for (const u of this.units) if (u.currentHp > 0) withUnits.add(u.team);
    const withCastle = new Set();
    for (const s of this.structures) {
      const tile = this.assets.getTile(this.map.tiles[s.x][s.y]);
      if (tile.isCastle && tile.team >= 0) withCastle.add(tile.team);
    }
    for (const teamId of this.activeTeams) {
      if (!withUnits.has(teamId) && !withCastle.has(teamId)) this.players[teamId].eliminated = true;
    }

    const moduleWinner = this.rules.first('checkVictory', this);
    if (typeof moduleWinner === 'number') {
      this.winnerTeam = moduleWinner;
      this.phase = 'GAME_OVER';
      return;
    }

    const alive = this.activeTeams.filter(t => !this.players[t].eliminated);
    if (alive.length === 1) {
      this.winnerTeam = alive[0];
      this.phase = 'GAME_OVER';
    }
  }

  /** Sound effects are skipped while a batch resolves silently. */
  sfx(type) {
    if (!this.muted) this.sound.playSfx(type);
  }

  notify() {
    if (this.muted) return;
    this.onStateChange(this);
  }

  /** Run `fn` without per-action UI notifications, then notify once. */
  batch(fn) {
    const was = this.muted;
    this.muted = true;
    try {
      return fn();
    } finally {
      this.muted = was;
      if (!was) this.notify();
    }
  }
}
