// Battle Royale — "Last Banner Standing".
//
// 20, 40 or 60 warbands (3 fighters each) land on an island. Everyone plans their moves AT THE SAME TIME under a timer,
// then all orders resolve together in a rotating initiative order. Loot crates and airdrops power you up, war horns keep
// the survivors finding each other (no gas, no shrinking zone — see modules/hunt), and the last warband alive wins.
// An optional closing storm can be switched on in the setup. Humans and bots mix freely; online play is deterministic
// lockstep (see network/royaleLockstep).

import { RuleSet } from '../../engine/ruleSet.js';
import { createFogOfWar } from '../../rules/fogOfWar.js';
import { createMovementProfiles } from '../../rules/movementProfiles.js';
import { registerMode } from '../registry.js';
import { Rng, hashSeed } from '../../engine/rng.js';
import { FRONTIER_PACK } from '../frontier/content.js';
import { FRONTIER_ART } from '../frontier/art.js';
import { ROYALE_PACK, ROYALE_ART } from './content.js';
import { generateRoyaleMap, royaleMapSize } from './mapGenerator.js';
import { createStorm } from './modules/storm.js';
import { createHunt, roundCap } from './modules/hunt.js';
import { createMarch } from './modules/march.js';
import { createEconomy } from './modules/economy.js';
import { ECONOMY } from './holdings.js';
import { createLoot } from './modules/loot.js';
import { createScoreboard } from './modules/scoreboard.js';
import { RoyaleAI } from './ai.js';

const randomSeed = () => Math.random().toString(36).slice(2, 8).toUpperCase();

const NAMES_A = ['Iron', 'Ash', 'Crimson', 'Frost', 'Gilded', 'Hollow', 'Storm', 'Ember', 'Pale', 'Dusk', 'Thorn', 'Grim', 'Silver', 'Black', 'Wild', 'Stone'];
const NAMES_B = ['wolves', 'crows', 'lances', 'vale', 'banner', 'oath', 'hawks', 'guard', 'fang', 'reach', 'blades', 'host', 'wardens', 'riders', 'pact', 'veil'];

/** Deterministic bot warband names: same seed => same roster on every client. */
export function botNames(seed, count) {
  const rng = new Rng(hashSeed(`names:${seed}`));
  const pool = [];
  for (const a of NAMES_A) for (const b of NAMES_B) pool.push(`${a} ${b}`);
  return rng.shuffle(pool).slice(0, count);
}

export const RoyaleMode = registerMode({
  id: 'royale',
  name: 'Battle Royale',
  tagline: 'Up to 60 warbands · one island · last banner standing',
  description:
    'Land with a three-fighter warband on a big island. Everyone plans simultaneously, then all orders resolve at once. ' +
    'Loot crates and airdrops, follow the war horns to the other warbands, and be the last one standing. No gas, no zone. Bots fill every empty slot.',
  contentPacks: [FRONTIER_PACK, ROYALE_PACK],
  art: { frontier: FRONTIER_ART, royale: ROYALE_ART }, // art per content pack id
  hud: { minimap: true, supply: false, renown: false, royale: true },

  setup: [
    {
      id: 'players',
      type: 'segmented',
      label: 'Warbands on the island',
      default: 20,
      options: [
        { value: 20, label: '20 · 96×96' },
        { value: 40, label: '40 · 128×128' },
        { value: 60, label: '60 · 160×160' }
      ]
    },
    {
      id: 'plan',
      type: 'segmented',
      label: 'Planning time per round',
      default: 25,
      options: [
        { value: 15, label: 'Fast · 15s' },
        { value: 25, label: 'Standard · 25s' },
        { value: 45, label: 'Relaxed · 45s' }
      ]
    },
    {
      id: 'loot',
      type: 'segmented',
      label: 'Loot',
      default: 'normal',
      options: [
        { value: 'sparse', label: 'Sparse' },
        { value: 'normal', label: 'Normal' },
        { value: 'rich', label: 'Rich' }
      ]
    },
    {
      id: 'storm',
      type: 'segmented',
      label: 'Closing storm',
      note: 'Off = pure last-one-standing. A storm adds a shrinking safe zone.',
      default: 'off',
      options: [
        { value: 'off', label: 'Off' },
        { value: 'slow', label: 'Slow' },
        { value: 'normal', label: 'Normal' },
        { value: 'fast', label: 'Fast' }
      ]
    },
    { id: 'seed', type: 'seed', label: 'Island seed', note: 'The same seed always builds the same island.', make: randomSeed }
  ],

  previewFacts(match) {
    const m = match.mapData.meta;
    return [
      { value: `${m.size}×${m.size}`, label: 'tiles across' },
      { value: String(m.players), label: 'warbands, 3 fighters each' },
      { value: String(m.towns.length), label: 'loot towns' },
      { value: String(m.crates), label: 'scattered crates' }
    ];
  },

  createMatch(config, db) {
    const players = Math.max(8, Math.min(60, config.players || 20));
    const seed = String(config.seed || randomSeed());
    const mapData = generateRoyaleMap({ players, seed, loot: config.loot || 'normal', storm: config.storm || 'off' }, db, db.autotile);

    // the scoreboard must come before the hunt: a genuine last-one-standing win is always decided first
    const modules = [createMovementProfiles(), createFogOfWar(), createMarch(), createEconomy(), createLoot(), createScoreboard(), createHunt({ cap: roundCap(players) })];
    if (mapData.meta.storm) modules.splice(4, 0, createStorm());
    const playerConfig = {};
    for (const t of mapData.activeTeams) playerConfig[t] = config.teams?.[t] || (t === 0 ? 'LOCAL' : 'AI');

    const names = botNames(seed, players);
    const teamNames = {};
    mapData.activeTeams.forEach(t => (teamNames[t] = names[t]));
    Object.assign(teamNames, config.names || {}); // human names override

    return {
      modeId: 'royale',
      title: `${mapData.name}`,
      mapData,
      rules: new RuleSet(modules),
      options: { mode: 'royale', startGold: ECONOMY.startGold, maxPop: 99, seed, simultaneous: true },
      playerConfig,
      teamNames,
      createAI: game => new RoyaleAI(game),
      online: !!config.online,
      royale: { planSeconds: config.plan || 25, size: royaleMapSize(players) },
      view: { theme: 'meadow', focus: 'commander' }
    };
  }
});
