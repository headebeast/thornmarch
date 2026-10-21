// Frontier content pack — pure data (no DOM): abilities, 10 new units, and every building tile variant.
// Buildings are described once in BUILDINGS; their tiles (per owner, per growth stage) are generated from it.

import { ABILITY } from '../../config/constants.js';

export const OWNERS = [-1, 0, 1, 2, 3]; // -1 = neutral
const ownerCode = o => (o < 0 ? 'n' : String(o));
export const tileKey = (building, owner, stage = 0) => `${building}_${ownerCode(owner)}_${stage}`;

// ---------------------------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------------------------
// income / supply / renown may be numbers or per-stage arrays. `capture` is the ability needed to take it
// (null = any unit can). `recruits` turns the building into a recruiting site for that roster.
export const BUILDINGS = {
  farm: {
    name: 'Farm',
    blurb: 'Fields ripen over two turns. Ripe farms pay gold and feed more troops.',
    stages: 3,
    stageNames: ['Tilled', 'Growing', 'Ripe'],
    capture: null,
    defence: 0,
    vision: 2,
    income: [0, 10, 25],
    supply: [0, 1, 2],
    buildCost: 60,
    builtBy: 'farm'
  },
  outpost: {
    name: 'Outpost',
    blurb: 'A forward camp: trains basic troops far from your Keep and extends supply and sight.',
    capture: ABILITY.CONQUEROR,
    defence: 10,
    hpRecovery: 10,
    vision: 5,
    supply: 2,
    income: 0,
    buildCost: 220,
    builtBy: 'outpost',
    recruits: 'outpost'
  },
  mine: {
    name: 'Gold Mine',
    blurb: 'Rich veins pay a steady stream of gold to whoever holds the shaft.',
    capture: ABILITY.CONQUEROR,
    defence: 10,
    vision: 2,
    income: 60
  },
  watchtower: {
    name: 'Watchtower',
    blurb: 'Sees across the fog. Good ground to hold: +15 defence.',
    capture: null,
    defence: 15,
    vision: 8,
    income: 0,
    buildCost: 140,
    builtBy: 'watchtower'
  },
  shrine: {
    name: 'Shrine of Vigor',
    blurb: 'Units resting here at the start of your turn recover 40 HP and shake off ailments.',
    capture: null,
    defence: 5,
    vision: 3,
    heal: 40,
    renown: 1
  },
  forge: {
    name: 'Forge',
    blurb: 'Pay 120 gold to temper a unit’s weapon: +8 attack, up to twice per unit.',
    capture: ABILITY.CONQUEROR,
    defence: 10,
    vision: 2,
    income: 0,
    action: 'forge',
    forgeCost: 120,
    forgeBonus: 8,
    forgeMax: 2
  },
  library: {
    name: 'Academy',
    blurb: 'A unit that studies here earns 60 experience for free.',
    capture: null,
    defence: 5,
    vision: 2,
    action: 'study',
    studyXp: 60
  },
  obelisk: {
    name: 'Obelisk of Renown',
    blurb: 'Ancient standing stone. Each turn you hold it earns 3 Renown toward victory.',
    capture: null,
    defence: 10,
    vision: 3,
    renown: 3
  },
  ruins: {
    name: 'Ancient Ruins',
    blurb: 'Crumbled halls hide treasure. Any unit can explore them once.',
    neutralOnly: true,
    capture: undefined, // cannot be captured, only explored
    defence: 10,
    vision: 1,
    action: 'explore',
    stages: 2,
    stageNames: ['Unexplored', 'Explored']
  }
};

export const BUILDER_OPTIONS = {
  farm: { id: 'farm', label: 'Plow Field', building: 'farm' },
  outpost: { id: 'outpost', label: 'Raise Outpost', building: 'outpost' },
  watchtower: { id: 'watchtower', label: 'Build Watchtower', building: 'watchtower' }
};

// ---------------------------------------------------------------------------------------------
// Tiles (generated)
// ---------------------------------------------------------------------------------------------
const LAND_TILE = 18; // plain ground in the base tileset

function buildTiles() {
  const tiles = [];
  for (const [id, b] of Object.entries(BUILDINGS)) {
    const stages = b.stages || 1;
    const owners = b.neutralOnly ? [-1] : OWNERS;
    for (const owner of owners) {
      for (let stage = 0; stage < stages; stage++) {
        const stageVal = (v) => (Array.isArray(v) ? v[stage] : v) || 0;
        const capturable = id !== 'ruins';
        tiles.push({
          key: tileKey(id, owner, stage),
          building: id,
          stage,
          owner,
          team: owner,
          type: 0,
          stepCost: 1,
          defenceBonus: b.defence || 0,
          hpRecovery: owner >= 0 ? b.hpRecovery || 0 : 0,
          isCapturable: capturable,
          captureAbility: capturable ? b.capture : undefined,
          isDestroyable: owner >= 0 && id !== 'ruins' && id !== 'mine' && id !== 'shrine' && id !== 'obelisk',
          destroyedKey: LAND_TILE,
          capturedKeys: capturable
            ? [0, 1, 2, 3, -1].map(t => tileKey(id, t, stage))
            : [],
          ground: LAND_TILE,
          art: { key: id, owner, stage },
          income: stageVal(b.income),
          supply: stageVal(b.supply),
          vision: owner >= 0 || id === 'obelisk' ? b.vision || 0 : Math.min(1, b.vision || 0)
        });
      }
    }
  }
  return tiles;
}

// ---------------------------------------------------------------------------------------------
// Abilities & units
// ---------------------------------------------------------------------------------------------
const ABILITIES = [
  { id: 29, key: 'builder', name: 'Builder', description: 'Can raise buildings on open ground: fields, outposts and towers.' },
  { id: 30, key: 'pathfinder', name: 'Pathfinder', description: 'Forest and mountain tiles cost at most 2 movement.' },
  { id: 31, key: 'far_sight', name: 'Far Sight', description: 'Sees much farther than other units through the fog.' },
  { id: 32, key: 'pike_wall', name: 'Pike Wall', description: 'Deals 50% extra damage to mounted units.' },
  { id: 33, key: 'mounted', name: 'Mounted', description: 'Rides a beast. Fast, but vulnerable to pikes.' },
  { id: 34, key: 'forest_stealth', name: 'Forest Stealth', description: 'Unseen by enemies while standing in a forest, unless one is adjacent.' },
  { id: 35, key: 'regrowth', name: 'Regrowth', description: 'Heals adjacent allies by 15 HP at the start of every turn.' }
];

const A = ABILITY;
const MOVE_CLASS = { peasant: 'light', outrider: 'mounted', knight: 'cavalry', pikeman: 'heavy', crossbowman: 'light', ranger: 'sylvan', druid: 'sylvan', alchemist: 'light', sapper: 'heavy', griffin_rider: 'flyer' };
const unit = (key, name, art, o) => ({
  key,
  moveClass: MOVE_CLASS[key],
  name,
  art,
  isCommander: false,
  isSkeleton: false,
  isCrystal: false,
  max_hp: 100,
  attack_type: 0,
  hp_growth: 0,
  attack_growth: 10,
  physical_defence_growth: 5,
  magic_defence_growth: 5,
  movement_growth: 0,
  min_attack_range: 1,
  max_attack_range: 1,
  vision: 3,
  ...o
});

const UNITS = [
  unit('peasant', 'Peasant', 'peasant', {
    price: 90, occupancy: 1, attack: 25, physical_defence: 0, magic_defence: 0, movement_point: 4,
    abilities: [A.BUILDER, A.REPAIRER], builds: ['farm'], vision: 3,
    attack_growth: 5, physical_defence_growth: 2, magic_defence_growth: 2,
    description: 'Hardy farmhands who plow fields for gold and supply — and repair ruined villages.',
    guide: 'Peasants are the backbone of the frontier economy. Plow fields near your Keep, then keep them safe.'
  }),
  unit('outrider', 'Outrider', 'outrider', {
    price: 250, occupancy: 2, attack: 45, physical_defence: 5, magic_defence: 5, movement_point: 8,
    abilities: [A.MOUNTED, A.FAR_SIGHT, A.CONQUEROR], vision: 7,
    description: 'Fast light cavalry that scouts the fog and snatches distant buildings.',
    guide: 'Send Outriders ahead to claim farms, mines and ruins before your rival does. Keep them away from pikes.'
  }),
  unit('knight', 'Knight', 'knight', {
    price: 650, occupancy: 3, attack: 65, physical_defence: 25, magic_defence: 8, movement_point: 6,
    abilities: [A.MOUNTED, A.CHARGER], vision: 4,
    description: 'Heavily armoured lancers. After striking, they can ride on with any movement left.',
    guide: 'Break enemy lines and withdraw in the same turn. A wall of Pikemen will stop them cold.'
  }),
  unit('pikeman', 'Pikeman', 'pikeman', {
    price: 200, occupancy: 1, attack: 45, physical_defence: 15, magic_defence: 0, movement_point: 4,
    abilities: [A.ANTI_CAVALRY, A.CONQUEROR], vision: 3,
    description: 'Disciplined spear infantry. Deals 50% extra damage to mounted units.',
    guide: 'Cheap, sturdy, and the best answer to Knights, Outriders and Wolves.'
  }),
  unit('crossbowman', 'Crossbowman', 'crossbowman', {
    price: 350, occupancy: 1, attack: 55, physical_defence: 5, magic_defence: 5, movement_point: 4,
    min_attack_range: 2, max_attack_range: 3, abilities: [A.MARKSMAN], vision: 4,
    description: 'Heavy bolts that punch through armour — and shoot flyers out of the sky.',
    guide: 'Shield them behind Pikemen. Excellent against Dragons and Griffin Riders.'
  }),
  unit('ranger', 'Ranger', 'ranger', {
    price: 400, occupancy: 2, attack: 50, physical_defence: 8, magic_defence: 12, movement_point: 5,
    min_attack_range: 2, max_attack_range: 3,
    abilities: [A.FOREST_STEALTH, A.FIGHTER_OF_THE_FOREST, A.PATHFINDER], vision: 5,
    description: 'Woodland marksmen who vanish into forests and move easily through rough ground.',
    guide: 'Ambush from the treeline: enemies can’t see a Ranger in a forest until they stand next to it.'
  }),
  unit('druid', 'Druid', 'druid', {
    price: 420, occupancy: 2, attack: 35, attack_type: 1, physical_defence: 3, magic_defence: 25, movement_point: 4,
    abilities: [A.HEALER, A.REGROWTH, A.SON_OF_THE_FOREST], vision: 4,
    description: 'Keepers of the green. Their presence mends allies, and forests restore them.',
    guide: 'Park a Druid inside your formation: everyone adjacent heals 15 HP at the start of your turn.'
  }),
  unit('alchemist', 'Alchemist', 'alchemist', {
    price: 450, occupancy: 2, attack: 50, attack_type: 1, physical_defence: 0, magic_defence: 15, movement_point: 4,
    min_attack_range: 2, max_attack_range: 2, abilities: [A.POISONER], vision: 4,
    description: 'Hurls volatile flasks from a distance, poisoning whatever survives.',
    guide: 'Poison wears down heavy hitters like Knights and Golems that are hard to kill outright.'
  }),
  unit('sapper', 'Sapper', 'sapper', {
    price: 300, occupancy: 2, attack: 45, physical_defence: 10, magic_defence: 0, movement_point: 3,
    abilities: [A.BUILDER, A.DESTROYER, A.REPAIRER], builds: ['outpost', 'watchtower'], vision: 3,
    description: 'Combat engineers who raise outposts and towers — or blow up enemy ones.',
    guide: 'Bring a Sapper with your army: an outpost at the front turns a long march into a short one.'
  }),
  unit('griffin_rider', 'Griffin Rider', 'griffin_rider', {
    price: 700, occupancy: 4, attack: 60, physical_defence: 10, magic_defence: 15, movement_point: 7,
    abilities: [A.AIR_FORCE, A.FAR_SIGHT], vision: 6,
    description: 'Sky cavalry that ignores terrain and sees for miles.',
    guide: 'Raid undefended farms across rivers and mountains. Crossbowmen are their natural predators.'
  })
];

export const FRONTIER_PACK = {
  id: 'frontier',
  abilities: ABILITIES,
  units: UNITS,
  tiles: buildTiles()
};

/** Rosters expressed with unit keys; mode code resolves them to indexes after registration. */
export const ROSTER_KEYS = {
  outpost: ['peasant', 'soldier', 'pikeman', 'archer', 'outrider'],
  keep: null // everything (classic + frontier) except specials
};

export const CLASSIC_KEYS = {
  soldier: 0,
  archer: 1,
  wolf: 5,
  commander: 9
};
