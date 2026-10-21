// Battle Royale content pack (pure data): loot objects. Reuses Frontier tiles (ruins, shrine, watchtower) for landmarks.

import { ROYALE_BUILDING_ART } from '../../art/royaleBuildings.js';

const object = (key, extra = {}) => ({
  key,
  building: key,
  stage: 0,
  owner: -1,
  team: -1,
  type: 0,
  stepCost: 1,
  defenceBonus: 0,
  isCapturable: false,
  isDestroyable: false,
  ground: 18,
  art: { key, owner: -1, stage: 0 },
  vision: 0,
  ...extra
});

export const ROYALE_PACK = {
  id: 'royale',
  tiles: [object('crate'), object('airdrop'), object('crate_empty'), object('camp', { defenceBonus: 10 })]
};

export const ROYALE_ART = {
  tile(def) {
    const make = ROYALE_BUILDING_ART[def.art?.key];
    return make ? make() : null;
  },
  unit() {
    return null;
  }
};

/** Loot tables. Weights are relative; `tier` crates are the common ones, airdrops the rare ones. */
export const LOOT = {
  crate: [
    { id: 'blade', weight: 28 },
    { id: 'armor', weight: 22 },
    { id: 'medkit', weight: 22 },
    { id: 'scroll', weight: 12 },
    { id: 'boots', weight: 10 },
    { id: 'banner', weight: 6 }
  ],
  airdrop: [{ id: 'arsenal', weight: 60 }, { id: 'banner', weight: 40 }]
};

export const LOOT_TEXT = {
  blade: { label: 'Honed blade', detail: '+6 attack' },
  armor: { label: 'Plate scraps', detail: '+4 defence' },
  medkit: { label: 'Field medic kit', detail: '+60 HP' },
  scroll: { label: 'Scroll of sight', detail: 'reveals the area, +1 vision' },
  boots: { label: 'Swift boots', detail: '+1 movement' },
  banner: { label: 'Mercenary banner', detail: 'a fighter joins your warband' },
  arsenal: { label: 'Royal arsenal', detail: '+10 attack, +6 defence, fully healed' }
};
