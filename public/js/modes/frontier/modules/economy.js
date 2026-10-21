// Frontier economy: building income, supply cap, recruiting sites, and the one-shot building actions
// (Forge, Academy, Ruins). Everything reads the data in content.js — add a building there and it works.

import { DEFAULT_RULES } from '../../../config/constants.js';
import { BUILDINGS, tileKey } from '../content.js';

export const KEEP_SUPPLY = 4;
export const VILLAGE_SUPPLY = 1;
// Villages are plentiful on a realm this large, so each pays less than in a classic skirmish.
export const VILLAGE_INCOME_CUT = 30;

export function createEconomy({ outpostRoster, keepRoster }) {
  const tileOf = (game, x, y) => game.assets.getTile(game.map.tiles[x][y]);

  return {
    id: 'frontier-economy',

    income(game, value, team) {
      let extra = 0;
      for (const s of game.structures) {
        const t = tileOf(game, s.x, s.y);
        if (t.team !== team) continue;
        if (t.income) extra += t.income;
        else if (t.isVillage) extra -= VILLAGE_INCOME_CUT;
      }
      return value + extra;
    },

    popCap(game, value, team) {
      let cap = value;
      for (const s of game.structures) {
        const t = tileOf(game, s.x, s.y);
        if (t.team !== team) continue;
        if (t.isCastle) cap += KEEP_SUPPLY;
        else if (t.isVillage) cap += VILLAGE_SUPPLY;
        else if (t.supply) cap += t.supply;
      }
      return cap;
    },

    recruitSite(game, team, x, y, tile) {
      if (tile.team !== team) return undefined;
      if (tile.isCastle) return { roster: keepRoster(game), kind: 'keep' };
      if (tile.building === 'outpost') return { roster: outpostRoster(game), kind: 'outpost' };
      return undefined;
    },

    turnStart(game, team) {
      // Shrines mend whoever is resting on them
      for (const s of game.structures) {
        const t = tileOf(game, s.x, s.y);
        if (t.building !== 'shrine' || t.team !== team) continue;
        const u = game.getUnitAt(s.x, s.y);
        if (!u || u.team !== team) continue;
        const heal = BUILDINGS.shrine.heal;
        const prev = u.currentHp;
        u.currentHp = Math.min(u.max_hp, u.currentHp + heal);
        u.status = null;
        if (u.currentHp !== prev) game.onFloatingText(u.x, u.y, `+${u.currentHp - prev} Shrine`, '#4ce0a0');
      }
    },

    actions(game, list, unit) {
      const t = tileOf(game, unit.x, unit.y);
      const player = game.players[unit.team];
      if (!t.building) return list;
      const out = list.slice();
      if (t.building === 'forge' && t.team === unit.team) {
        const b = BUILDINGS.forge;
        if ((unit.forged || 0) < b.forgeMax && player.gold >= b.forgeCost && !unit.isCrystal) out.push('forge');
      }
      if (t.building === 'library' && t.team === unit.team && unit.level < 3) out.push('study');
      if (t.building === 'ruins' && t.stage === 0) out.push('explore');
      return out;
    },

    describeAction(game, actionId, unit) {
      if (actionId === 'forge') {
        const b = BUILDINGS.forge;
        return { label: 'Temper Weapon', hint: `+${b.forgeBonus} attack`, cost: b.forgeCost, icon: 'hammer' };
      }
      if (actionId === 'study') return { label: 'Study', hint: `+${BUILDINGS.library.studyXp} XP`, icon: 'book' };
      if (actionId === 'explore') return { label: 'Explore Ruins', hint: 'Unknown rewards', icon: 'chest' };
      return undefined;
    },

    performAction(game, unit, actionId) {
      const t = tileOf(game, unit.x, unit.y);
      const player = game.players[unit.team];

      if (actionId === 'forge') {
        const b = BUILDINGS.forge;
        if (player.gold < b.forgeCost) return false;
        player.gold -= b.forgeCost;
        unit.forged = (unit.forged || 0) + 1;
        unit.bonusAttack = (unit.bonusAttack || 0) + b.forgeBonus;
        game.sound.playSfx('recruit');
        game.onFloatingText(unit.x, unit.y, `+${b.forgeBonus} ATK`, '#ffa030');
        return true;
      }

      if (actionId === 'study') {
        game.sound.playSfx('heal');
        game.onFloatingText(unit.x, unit.y, `+${BUILDINGS.library.studyXp} XP`, '#4cb8f0');
        game.grantExperience(unit, BUILDINGS.library.studyXp);
        return true;
      }

      if (actionId === 'explore') {
        if (t.building !== 'ruins' || t.stage !== 0) return false;
        const roll = game.rng.int(1, 100);
        game.setTile(unit.x, unit.y, game.assets.packRefs('frontier').tiles[tileKey('ruins', -1, 1)]);
        game.sound.playSfx('capture');
        if (roll <= 50) {
          const gold = game.rng.int(150, 300);
          player.gold += gold;
          game.onFloatingText(unit.x, unit.y, `+${gold} Gold hoard`, '#facc15');
        } else if (roll <= 70) {
          unit.bonusAttack = (unit.bonusAttack || 0) + 8;
          game.onFloatingText(unit.x, unit.y, 'Relic blade! +8 ATK', '#ffa030');
        } else if (roll <= 90) {
          game.onFloatingText(unit.x, unit.y, 'Ancient lore! +100 XP', '#4cb8f0');
          game.grantExperience(unit, 100);
        } else {
          unit.currentHp = unit.max_hp;
          unit.status = null;
          game.onFloatingText(unit.x, unit.y, 'Spring of life!', '#4ce0a0');
        }
        game.rules.get('frontier-renown')?.award(game, unit.team, 5, 'ruins');
        return true;
      }
      return undefined;
    },

    describeTile(game, lines, x, y) {
      const t = tileOf(game, x, y);
      const b = BUILDINGS[t.building];
      if (!b) return lines;
      const out = lines.slice();
      out.push({ kind: 'building', text: b.blurb });
      if (b.stageNames && b.stages > 1) out.push({ kind: 'stage', text: `${b.stageNames[t.stage]} (${t.stage + 1}/${b.stages})` });
      if (t.income) out.push({ kind: 'income', text: `+${t.income} gold / turn` });
      if (t.supply) out.push({ kind: 'supply', text: `+${t.supply} supply` });
      return out;
    }
  };
}

export const FRONTIER_START = { gold: 400, baseSupply: 6, maxPop: DEFAULT_RULES.UNIT_CAPACITY };
