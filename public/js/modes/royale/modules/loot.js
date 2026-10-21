// Loot — walk onto a crate to open it; explore ruins for a double haul; airdrops land somewhere on the island.
// (Shrines, camps and the other buildings live in economy.js.)
// Everything random goes through the shared seeded RNG, so every client sees the same loot.

import { LOOT, LOOT_TEXT } from '../content.js';
import { ECONOMY } from '../holdings.js';

const DEF_CAP = 20; // keep stacked armour from making a unit unkillable
const ATK_CAP = 40;
const MP_CAP = 2; // at most two pairs of boots

function pick(game, table) {
  const total = table.reduce((s, t) => s + t.weight, 0);
  let r = game.rng.next() * total;
  for (const t of table) {
    r -= t.weight;
    if (r <= 0) return t.id;
  }
  return table[table.length - 1].id;
}

const SQUAD_POOL = [0, 1, 12, 13, 3]; // banner recruits: Soldier, Archer, Paladin, Berserker, Sorceress

export function createLoot({ airdropEvery = 4 } = {}) {
  const tileRef = (game, name) => game.assets.packRefs('royale').tiles[name];

  function applyLoot(game, unit, id) {
    const text = LOOT_TEXT[id];
    switch (id) {
      case 'blade':
        unit.bonusAttack = Math.min(ATK_CAP, (unit.bonusAttack || 0) + 6);
        break;
      case 'armor':
        unit.bonusDef = Math.min(DEF_CAP, (unit.bonusDef || 0) + 4);
        break;
      case 'medkit':
        unit.currentHp = Math.min(unit.max_hp, unit.currentHp + 60);
        break;
      case 'boots':
        if ((unit.bootsWorn || 0) < MP_CAP) {
          unit.bootsWorn = (unit.bootsWorn || 0) + 1;
          unit.movement_point += 1;
          unit.currentMp += 1;
        }
        break;
      case 'scroll':
        unit.vision = (unit.vision ?? 3) + 1;
        game.vision?.reveal(unit.team, unit.x, unit.y, 9);
        break;
      case 'arsenal':
        unit.bonusAttack = Math.min(ATK_CAP, (unit.bonusAttack || 0) + 10);
        unit.bonusDef = Math.min(DEF_CAP, (unit.bonusDef || 0) + 6);
        unit.currentHp = unit.max_hp;
        break;
      case 'banner': {
        const squad = game.units.filter(u => u.team === unit.team && u.currentHp > 0).length;
        if (squad >= ECONOMY.squadCap) {
          unit.currentHp = Math.min(unit.max_hp, unit.currentHp + 40);
          break;
        }
        for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const x = unit.x + dx;
          const y = unit.y + dy;
          if (x < 0 || y < 0 || x >= game.map.width || y >= game.map.height || game.getUnitAt(x, y)) continue;
          if (game.assets.getTile(game.map.tiles[x][y]).type === 1) continue;
          const recruit = game.spawnUnit(SQUAD_POOL[game.rng.int(0, SQUAD_POOL.length - 1)], unit.team, x, y, true);
          recruit.currentMp = 0;
          break;
        }
        break;
      }
    }
    game.onFloatingText(unit.x, unit.y, `${text.label}: ${text.detail}`, '#ffe08a');
    game.onEvent('loot', { unit, id });
  }

  return {
    id: 'royale-loot',

    afterMove(game, unit) {
      if (unit.currentHp <= 0) return;
      const t = game.assets.getTile(game.map.tiles[unit.x][unit.y]);
      if (t.building !== 'crate' && t.building !== 'airdrop') return;
      const id = pick(game, LOOT[t.building]);
      game.setTile(unit.x, unit.y, tileRef(game, 'crate_empty'));
      game.sfx('capture');
      applyLoot(game, unit, id);
    },

    actions(game, list, unit) {
      const t = game.assets.getTile(game.map.tiles[unit.x][unit.y]);
      return t.building === 'ruins' && t.stage === 0 ? [...list, 'explore'] : list;
    },

    describeAction(game, actionId) {
      return actionId === 'explore' ? { label: 'Explore ruins', hint: 'Two loot rolls', icon: 'chest' } : undefined;
    },

    performAction(game, unit, actionId) {
      if (actionId !== 'explore') return undefined;
      const t = game.assets.getTile(game.map.tiles[unit.x][unit.y]);
      if (t.building !== 'ruins' || t.stage !== 0) return false;
      game.setTile(unit.x, unit.y, game.assets.packRefs('frontier').tiles['ruins_n_1']);
      game.sfx('capture');
      applyLoot(game, unit, pick(game, LOOT.crate));
      applyLoot(game, unit, pick(game, LOOT.crate));
      return true;
    },

    roundStart(game, round) {
      // an airdrop falls every few rounds, revealed to everyone — inside the safe circle when a storm is running,
      // otherwise anywhere on the island
      if (round < 3 || round % airdropEvery !== 0) return;
      const meta = game.map.meta;
      const z = game.storm ? game.storm.current : { x: meta.centre.x, y: meta.centre.y, r: meta.islandRadius };
      for (let tries = 0; tries < 60; tries++) {
        const a = game.rng.next() * Math.PI * 2;
        const r = Math.sqrt(game.rng.next()) * z.r * 0.8;
        const x = Math.round(z.x + Math.cos(a) * r);
        const y = Math.round(z.y + Math.sin(a) * r);
        if (x < 1 || y < 1 || x >= game.map.width - 1 || y >= game.map.height - 1) continue;
        const tile = game.assets.getTile(game.map.tiles[x][y]);
        if (tile.type !== 0 || tile.stepCost !== 1 || tile.building || tile.isCastle || tile.isVillage || game.getUnitAt(x, y)) continue;
        game.setTile(x, y, tileRef(game, 'airdrop'));
        if (game.vision) for (const t of game.activeTeams) game.vision.explored[t][y * game.map.width + x] = 1;
        game.onEvent('airdrop', { x, y });
        break;
      }
    }
  };
}
