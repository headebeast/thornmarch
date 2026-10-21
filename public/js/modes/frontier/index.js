// Frontier — the large-scale farming & expansion mode.
//
// Armies start in opposite corners of a huge procedurally generated realm (11× the biggest classic map by
// default). You plow fields for gold and supply, claim mines, shrines, forges and obelisks, scout through
// fog of war, and raise outposts to project power. Win by crushing rivals or by earning Renown.
//
// Everything here is composition: map generator + content pack + rule modules + AI. Any module can be
// lifted into another mode without changes.

import { RuleSet } from '../../engine/ruleSet.js';
import { createFogOfWar } from '../../rules/fogOfWar.js';
import { createMovementProfiles } from '../../rules/movementProfiles.js';
import { registerMode } from '../registry.js';
import { FrontierAI } from '../../ai/frontierAI.js';
import { FRONTIER_PACK, ROSTER_KEYS } from './content.js';
import { FRONTIER_ART } from './art.js';
import { generateFrontierMap, MAP_SIZES } from './mapGenerator.js';
import { createEconomy, FRONTIER_START } from './modules/economy.js';
import { createFarming } from './modules/farming.js';
import { createBuilder } from './modules/builder.js';
import { createRenown } from './modules/renown.js';
import { createUnitAbilities } from './modules/abilities.js';

const randomSeed = () => Math.random().toString(36).slice(2, 8).toUpperCase();

export const FrontierMode = registerMode({
  id: 'frontier',
  name: 'Frontier',
  tagline: 'A vast realm to farm, scout and conquer',
  description:
    'Armies begin far apart in a huge, fog-shrouded realm. Plow fields for gold and supply, claim mines and ' +
    'shrines, temper weapons at forges, raise outposts — and outlast your rivals or win on Renown.',
  contentPacks: [FRONTIER_PACK],
  art: { frontier: FRONTIER_ART }, // art per content pack id
  hud: { minimap: true, renown: true, supply: true },

  setup: [
    {
      id: 'players',
      type: 'segmented',
      label: 'Rival realms',
      default: 2,
      options: [
        { value: 2, label: '2 Players' },
        { value: 3, label: '3 Players' },
        { value: 4, label: '4 Players' }
      ]
    },
    { id: 'teams', type: 'teams', label: 'Commanders' },
    {
      id: 'size',
      type: 'cards',
      label: 'Realm size',
      default: 'grand',
      options: Object.entries(MAP_SIZES).map(([value, m]) => ({ value, label: m.label, note: m.note }))
    },
    {
      id: 'renown',
      type: 'segmented',
      label: 'Renown victory',
      default: 100,
      options: [
        { value: 60, label: 'Quick · 60' },
        { value: 100, label: 'Standard · 100' },
        { value: 160, label: 'Long · 160' },
        { value: 0, label: 'Off' }
      ]
    },
    {
      id: 'gold',
      type: 'segmented',
      label: 'Starting gold',
      default: FRONTIER_START.gold,
      options: [
        { value: 250, label: '250' },
        { value: 400, label: '400' },
        { value: 650, label: '650' }
      ]
    },
    { id: 'fog', type: 'toggle', label: 'Fog of war', note: 'You only see what your units and buildings see.', default: true },
    { id: 'seed', type: 'seed', label: 'Realm seed', note: 'The same seed always builds the same realm.', make: randomSeed }
  ],

  /** @param {object} config  values from the setup form (also what online hosts broadcast) */
  createMatch(config, db) {
    const players = config.players || 2;
    const size = MAP_SIZES[config.size] || MAP_SIZES.grand;
    const seed = String(config.seed || randomSeed());
    const mapData = generateFrontierMap({ size: size.size, players, seed, theme: 'meadow' }, db, db.autotile);

    const unitRefs = db.packRefs('frontier').units;
    const outpostIdx = ROSTER_KEYS.outpost.map(k => unitRefs[k] ?? db.units.find(u => u.name.toLowerCase() === k)?.index).filter(i => i !== undefined);
    const modules = [createMovementProfiles()];
    if (config.fog !== false) modules.push(createFogOfWar());
    modules.push(
      createEconomy({
        outpostRoster: () => outpostIdx,
        keepRoster: game => game.assets.units.filter(u => !u.isSkeleton && !u.isCrystal).map(u => u.index)
      }),
      createFarming(),
      createBuilder(),
      createUnitAbilities(),
      createRenown({ goal: config.renown ?? 100 })
    );

    const playerConfig = {};
    for (let t = 0; t < players; t++) playerConfig[t] = config.teams?.[t] || (t === 0 ? 'LOCAL' : 'AI');

    return {
      modeId: 'frontier',
      title: mapData.name,
      mapData,
      rules: new RuleSet(modules),
      options: {
        mode: config.online ? 'online' : 'frontier',
        startGold: config.gold ?? FRONTIER_START.gold,
        maxPop: FRONTIER_START.baseSupply,
        seed
      },
      playerConfig,
      createAI: game => new FrontierAI(game),
      view: { theme: 'meadow', focus: 'commander' }
    };
  }
});
