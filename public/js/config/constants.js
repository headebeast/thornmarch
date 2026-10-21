// Modular Configuration & Constants (matches project_aeii Rule.java, Ability.java, Status.java, Tile.java)

import { hslHex, teamHue } from './colors.js';

const CLASSIC_TEAMS = [
  { id: 0, name: 'BLUE', label: 'King Galamar (Blue)', color: '#0064c6', light: '#38bdf8' },
  { id: 1, name: 'RED', label: 'Valadorn / Red Legion', color: '#a10070', light: '#f43f5e' },
  { id: 2, name: 'GREEN', label: 'Elven / Green Guard', color: '#009937', light: '#22c55e' },
  { id: 3, name: 'BLACK', label: 'Saeth / Shadow Army', color: '#004172', light: '#a855f7' }
];

/** Team metadata for up to 64 teams: the four classic armies, then generated hues (Battle Royale uses up to 60). */
export const TEAMS = Array.from({ length: 64 }, (_, id) =>
  id < CLASSIC_TEAMS.length
    ? CLASSIC_TEAMS[id]
    : { id, name: `TEAM ${id + 1}`, label: `Warband ${id + 1}`, color: hslHex(teamHue(id), 70, 40), light: hslHex(teamHue(id), 85, 66) }
);

export const PLAYER_TYPES = {
  LOCAL: 'LOCAL',
  AI: 'AI',
  REMOTE: 'REMOTE',
  NONE: 'NONE'
};

export const TILE_TYPES = {
  LAND: 0,
  WATER: 1,
  FOREST: 2,
  MOUNTAIN: 3
};

export const TILE_TYPE_NAMES = {
  0: 'Plains / Road / Building',
  1: 'Water / Sea',
  2: 'Forest',
  3: 'Mountain'
};

export const ABILITY = {
  CONQUEROR: 0,
  FIGHTER_OF_THE_SEA: 1,
  FIGHTER_OF_THE_FOREST: 2,
  FIGHTER_OF_THE_MOUNTAIN: 3,
  DESTROYER: 4,
  AIR_FORCE: 5,
  NECROMANCER: 6,
  HEALER: 7,
  CHARGER: 8,
  POISONER: 9,
  REPAIRER: 10,
  UNDEAD: 11,
  MARKSMAN: 12,
  SON_OF_THE_SEA: 13,
  SON_OF_THE_FOREST: 14,
  SON_OF_THE_MOUNTAIN: 15,
  CRAWLER: 16,
  SLOWING_AURA: 17,
  COMMANDER: 18,
  HEAVY_MACHINE: 19,
  ATTACK_AURA: 20,
  BLOODTHIRSTY: 21,
  GUARDIAN: 22,
  REFRESH_AURA: 23,
  LORD_OF_TERROR: 24,
  COUNTER_MADNESS: 25,
  BLINDER: 26,
  REHABILITATION: 27,
  HARD_SKIN: 28,
  // — Frontier content pack (ids continue after the classic 29 abilities) —
  BUILDER: 29,
  PATHFINDER: 30,
  FAR_SIGHT: 31,
  ANTI_CAVALRY: 32,
  MOUNTED: 33,
  FOREST_STEALTH: 34,
  REGROWTH: 35
};

export const STATUS = {
  POISONED: 0,
  SLOWED: 1,
  INSPIRED: 2,
  BLINDED: 3
};

export const STATUS_NAMES = {
  0: 'Poisoned (-10 HP/turn, no terrain heal)',
  1: 'Slowed (Move reduced to 1)',
  2: 'Inspired (+10 Attack)',
  3: 'Blinded (Cannot counter/ranged reduced)'
};

export const DEFAULT_RULES = {
  CASTLE_INCOME: 100,
  VILLAGE_INCOME: 50,
  COMMANDER_INCOME: 50,
  KILL_EXPERIENCE: 60,
  ATTACK_EXPERIENCE: 30,
  COUNTER_EXPERIENCE: 10,
  COMMANDER_PRICE_STEP: 100,
  UNIT_CAPACITY: 25,
  START_GOLD: 450,
  POISON_DAMAGE: 10,
  HEALER_BASE_HEAL: 40,
  REFRESH_BASE_HEAL: 10
};
