// Classic modes (Skirmish & Campaign) expressed through the same Mode interface as everything else.
// Skirmish can opt into any reusable rule module — Fog of War today, more as modules mature.

import { RuleSet } from '../engine/ruleSet.js';
import { createFogOfWar } from '../rules/fogOfWar.js';
import { createMovementProfiles } from '../rules/movementProfiles.js';
import { AIController } from '../ai/aiController.js';
import { registerMode } from './registry.js';

function mapById(db, id) {
  return db.maps.find(m => m.id === id) || db.maps.find(m => m.category === 'skirmish') || db.maps[0];
}

export const SkirmishMode = registerMode({
  id: 'skirmish',
  name: 'Skirmish',
  tagline: '26 classic maps · hot-seat or vs AI',
  description: 'Fight a classic battle on any of the original maps — against the AI, a friend on this device, or online.',
  setup: db => [
    {
      id: 'mapId',
      type: 'select',
      label: 'Battle map',
      options: db.maps.filter(m => m.category === 'skirmish').map(m => ({ value: m.id, label: `(${m.maxPlayers}P) ${m.name} · ${m.width}×${m.height}` })),
      default: db.maps.find(m => m.category === 'skirmish')?.id
    },
    { id: 'teams', type: 'teams', label: 'Commanders' },
    {
      id: 'startGold',
      type: 'segmented',
      label: 'Starting gold',
      default: 450,
      options: [300, 450, 700, 1000, 2000].map(v => ({ value: v, label: String(v) }))
    },
    {
      id: 'maxPop',
      type: 'segmented',
      label: 'Unit capacity',
      default: 25,
      options: [20, 25, 35, 50].map(v => ({ value: v, label: String(v) }))
    },
    { id: 'enhancedMovement', type: 'toggle', label: 'Unit movement profiles', note: 'Every unit moves its own way — mounted units hate forests, war machines can’t cross water, flyers ignore terrain. Off = original uniform costs.', default: true },
    { id: 'fog', type: 'toggle', label: 'Fog of war', note: 'Experimental here — borrowed from Frontier. Enemies appear only inside your units’ sight.', default: false }
  ],
  createMatch(config, db) {
    const mapData = config.mapData || mapById(db, config.mapId);
    const modules = [];
    if (config.enhancedMovement !== false) modules.push(createMovementProfiles());
    if (config.fog) modules.push(createFogOfWar());
    return {
      modeId: 'skirmish',
      title: mapData.name,
      mapData,
      rules: new RuleSet(modules),
      options: {
        mode: config.online ? 'online' : 'skirmish',
        startGold: config.startGold ?? 450,
        maxPop: config.maxPop ?? 25,
        seed: config.seed ?? mapData.id
      },
      playerConfig: config.teams || {},
      createAI: game => new AIController(game),
      view: { theme: 'frost', focus: 'fit' }
    };
  }
});

export const CampaignMode = registerMode({
  id: 'campaign',
  name: 'Campaign',
  tagline: 'The original story stages',
  createMatch(config, db) {
    const mapData = mapById(db, config.mapId);
    return {
      modeId: 'campaign',
      title: mapData.name,
      mapData,
      rules: new RuleSet([]),
      options: { mode: 'campaign', startGold: 400, maxPop: 25, seed: mapData.id },
      playerConfig: { 0: 'LOCAL', 1: 'AI', 2: 'AI', 3: 'AI' },
      createAI: game => new AIController(game),
      view: { theme: 'frost', focus: 'fit' }
    };
  }
});
