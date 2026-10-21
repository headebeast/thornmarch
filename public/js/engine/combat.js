// Modular Combat & Stat Formulas — 1:1 port of project_aeii UnitToolkit.java

import { ABILITY, STATUS, TILE_TYPES, DEFAULT_RULES } from '../config/constants.js';

export function hasAbility(unit, abilityId) {
  return Array.isArray(unit.abilities) && unit.abilities.includes(abilityId);
}

export function hasStatus(unit, statusType) {
  return unit.status && unit.status.type === statusType && unit.status.turns > 0;
}

export function getManhattanRange(x1, y1, x2, y2) {
  return Math.abs(x2 - x1) + Math.abs(y2 - y1);
}

export function getEnemyAroundCount(game, unit, radius = 2) {
  let count = 0;
  for (const other of game.units) {
    if (other.currentHp > 0 && other.team !== unit.team) {
      if (getManhattanRange(unit.x, unit.y, other.x, other.y) <= radius) {
        count++;
      }
    }
  }
  return count;
}

export function getUnitStats(unit) {
  const lvl = unit.level || 0;
  return {
    attack: unit.attack + lvl * (unit.attack_growth || 0) + (unit.bonusAttack || 0),
    physicalDefence: unit.physical_defence + lvl * (unit.physical_defence_growth || 0) + (unit.bonusDef || 0),
    magicDefence: unit.magic_defence + lvl * (unit.magic_defence_growth || 0) + (unit.bonusDef || 0),
    movementPoint: hasStatus(unit, STATUS.SLOWED)
      ? 1
      : unit.movement_point + lvl * (unit.movement_growth || 0)
  };
}

export function getTileDefenceBonus(game, unit, tileIndex) {
  const tile = game.assets.getTile(tileIndex);
  let bonus = 0;
  if (!hasAbility(unit, ABILITY.AIR_FORCE)) {
    bonus += tile.defenceBonus;
  }
  if (hasAbility(unit, ABILITY.GUARDIAN) && tile.team === unit.team) {
    bonus += 5;
  }
  if (tile.type === TILE_TYPES.FOREST && hasAbility(unit, ABILITY.FIGHTER_OF_THE_FOREST)) {
    bonus += 10;
  }
  if (tile.type === TILE_TYPES.MOUNTAIN && hasAbility(unit, ABILITY.FIGHTER_OF_THE_MOUNTAIN)) {
    bonus += 10;
  }
  if (tile.type === TILE_TYPES.WATER && hasAbility(unit, ABILITY.FIGHTER_OF_THE_SEA)) {
    bonus += 10;
  }
  return bonus;
}

export function getAttackBonus(game, attacker, defender, attackerTileIndex) {
  const tile = game.assets.getTile(attackerTileIndex);
  let bonus = 0;
  if (hasAbility(attacker, ABILITY.FIGHTER_OF_THE_MOUNTAIN) && tile.type === TILE_TYPES.MOUNTAIN) {
    bonus += 10;
  }
  if (hasAbility(attacker, ABILITY.FIGHTER_OF_THE_FOREST) && tile.type === TILE_TYPES.FOREST) {
    bonus += 10;
  }
  if (hasAbility(attacker, ABILITY.FIGHTER_OF_THE_SEA) && tile.type === TILE_TYPES.WATER) {
    bonus += 10;
  }
  if (hasAbility(attacker, ABILITY.MARKSMAN) && hasAbility(defender, ABILITY.AIR_FORCE)) {
    bonus += 15;
  }
  if (hasAbility(attacker, ABILITY.BLOODTHIRSTY)) {
    bonus += getEnemyAroundCount(game, attacker, 2) * 10;
  }
  if (hasStatus(attacker, STATUS.INSPIRED)) {
    bonus += 10;
  }
  return bonus;
}

export function getDefenceBonus(game, attacker, defender, defenderTileIndex) {
  let bonus = getTileDefenceBonus(game, defender, defenderTileIndex);
  if (attacker.attack_type === 0 && hasAbility(defender, ABILITY.BLOODTHIRSTY)) {
    bonus += getEnemyAroundCount(game, defender, 2) * 5;
  }
  return bonus;
}

export function calculateDamage(game, attacker, defender, applyRng = true) {
  const attackerTileIndex = game.map.tiles[attacker.x][attacker.y];
  const defenderTileIndex = game.map.tiles[defender.x][defender.y];

  const atkStats = getUnitStats(attacker);
  const defStats = getUnitStats(defender);

  const attack = atkStats.attack + getAttackBonus(game, attacker, defender, attackerTileIndex);
  const baseDef = attacker.attack_type === 0 ? defStats.physicalDefence : defStats.magicDefence;
  const defence = baseDef + getDefenceBonus(game, attacker, defender, defenderTileIndex);

  let damage = Math.max(0, attack - defence);
  damage = Math.floor((damage * attacker.currentHp) / attacker.max_hp);
  damage = Math.max(0, damage);

  const dist = getManhattanRange(attacker.x, attacker.y, defender.x, defender.y);
  let pctModifier = 1.0;
  if (
    dist === 1 &&
    hasAbility(attacker, ABILITY.LORD_OF_TERROR) &&
    !hasAbility(defender, ABILITY.LORD_OF_TERROR)
  ) {
    pctModifier += 0.5;
  }
  if (dist > 1 && hasAbility(defender, ABILITY.HARD_SKIN)) {
    pctModifier -= 0.5;
  }
  if (hasAbility(attacker, ABILITY.ANTI_CAVALRY) && hasAbility(defender, ABILITY.MOUNTED)) {
    pctModifier += 0.5;
  }
  pctModifier = Math.max(0, pctModifier);
  damage = Math.floor(damage * pctModifier);

  if (applyRng) {
    // Seeded so every client in an online match rolls the same spread
    damage += game.rng.int(-2, 2);
  }

  damage = Math.max(0, Math.min(defender.currentHp, damage));
  return damage;
}

export function canCounterAttack(attacker, defender) {
  if (defender.currentHp <= 0) return false;
  if (hasStatus(defender, STATUS.BLINDED)) return false;
  const dist = getManhattanRange(attacker.x, attacker.y, defender.x, defender.y);
  if (hasAbility(defender, ABILITY.COUNTER_MADNESS)) {
    return dist <= 2 && dist >= defender.min_attack_range && dist <= defender.max_attack_range;
  }
  // Standard AE2 rule: melee attacks (dist === 1) can be countered if defender can attack at range 1
  return dist === 1 && defender.min_attack_range <= 1 && defender.max_attack_range >= 1;
}

export function getTerrainHeal(game, unit) {
  const tileIndex = game.map.tiles[unit.x][unit.y];
  const tile = game.assets.getTile(tileIndex);
  let heal = 0;

  if (!hasAbility(unit, ABILITY.BLOODTHIRSTY)) {
    if (tile.team === -1 || tile.team === unit.team) {
      heal += tile.hpRecovery;
    }
  }
  if (hasAbility(unit, ABILITY.SON_OF_THE_MOUNTAIN) && tile.type === TILE_TYPES.MOUNTAIN) {
    heal += 10;
  }
  if (hasAbility(unit, ABILITY.SON_OF_THE_FOREST) && tile.type === TILE_TYPES.FOREST) {
    heal += 10;
  }
  if (hasAbility(unit, ABILITY.SON_OF_THE_SEA) && tile.type === TILE_TYPES.WATER) {
    heal += 10;
  }
  if (hasAbility(unit, ABILITY.REHABILITATION)) {
    heal += Math.floor(unit.max_hp * 0.25);
  }
  return heal;
}

export function getHealerHeal(healer, target) {
  if (!hasAbility(healer, ABILITY.HEALER)) return 0;
  const heal = DEFAULT_RULES.HEALER_BASE_HEAL + 10 * (healer.level || 0);
  if (hasAbility(target, ABILITY.UNDEAD)) {
    return -Math.floor(heal * 1.5);
  }
  return heal;
}
