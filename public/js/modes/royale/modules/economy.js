// Royale economy — gold, holdings and what a fighter can do with them.
//
//   claim    stand on a building and take it for the warband (or take it away from another)
//   income   +15 gold a round for everyone, plus whatever the held buildings pay
//   recruit  a fighter on a held War Camp / Outpost trains a new fighter (a gold price, 6 fighters at most)
//   temper   a fighter on a held Forge pays for +8 attack
//   study    a fighter on a held Academy gains experience
//   heal     held camps, outposts and shrines mend the fighters resting there at the start of a round
//
// Everything is an ordinary order action ({type:'claim'|'recruit'|'temper'|'study'}), so it runs through the same resolver as
// attacks and is identical on every client in an online match. The rules read their numbers from holdings.js.

import { ECONOMY, HOLDINGS, isHolding, holdingAt, fortifiedFor, tileOptions, rosterFor, deploySpot, incomeOf, squadSize, describeYield, recruitPrice, warChestsSealed } from '../holdings.js';

const ORDER_ACTIONS = new Set(['claim', 'recruit', 'temper', 'study']);

export function createEconomy() {
  const cell = (game, x, y) => y * game.map.width + x;

  function claim(game, unit) {
    const hold = holdingAt(game, unit.x, unit.y);
    if (!hold || hold.owner === unit.team) return false;
    if (hold.owner >= 0 && fortifiedFor(game, unit.x, unit.y) > 0) return false;
    const prev = hold.owner;
    game.holds[cell(game, unit.x, unit.y)] = unit.team;
    game.holdSince[cell(game, unit.x, unit.y)] = game.turnNumber;
    game.vision?.recompute(unit.team);
    if (prev >= 0) game.vision?.recompute(prev);
    game.sfx('capture');
    const yields = hold.def.income ? `  +${hold.def.income}g/round` : '';
    game.onFloatingText(unit.x, unit.y, `${hold.def.short} claimed${yields}`, '#facc15');
    game.onEvent('claim', { x: unit.x, y: unit.y, team: unit.team, from: prev, id: hold.id, name: hold.def.name });
    return true;
  }

  function recruit(game, unit, item) {
    const team = unit.team;
    const hold = holdingAt(game, unit.x, unit.y);
    if (!hold || hold.owner !== team || !hold.def.recruit) return false;
    if (!rosterFor(game, hold.def.recruit).includes(item)) return false;
    if (squadSize(game, team) >= ECONOMY.squadCap || warChestsSealed(game)) return false;
    const tpl = game.assets.getUnitTemplate(item);
    const player = game.players[team];
    const price = recruitPrice(game, team, tpl);
    if (player.gold < price) return false;
    const spot = deploySpot(game, unit.x, unit.y, tpl);
    if (!spot) return false;
    player.gold -= price;
    player.raised = (player.raised || 0) + 1;
    const fresh = game.spawnUnit(item, team, spot.x, spot.y, true);
    fresh.currentMp = 0; // reinforcements arrive weary and join in next round
    game.sfx('recruit');
    game.onFloatingText(spot.x, spot.y, `${fresh.name} joins!`, '#38bdf8');
    game.onEvent('recruit', { team, unit: fresh, price });
    return true;
  }

  function temper(game, unit) {
    const hold = holdingAt(game, unit.x, unit.y);
    const def = hold?.def;
    const player = game.players[unit.team];
    if (!hold || hold.owner !== unit.team || def.action !== 'temper') return false;
    if ((unit.forged || 0) >= def.max || player.gold < def.cost || unit.isCrystal) return false;
    player.gold -= def.cost;
    unit.forged = (unit.forged || 0) + 1;
    unit.bonusAttack = (unit.bonusAttack || 0) + def.bonus;
    game.sfx('recruit');
    game.onFloatingText(unit.x, unit.y, `+${def.bonus} ATK`, '#ffa030');
    return true;
  }

  function study(game, unit) {
    const hold = holdingAt(game, unit.x, unit.y);
    if (!hold || hold.owner !== unit.team || hold.def.action !== 'study' || unit.level >= 3) return false;
    game.sfx('heal');
    game.onFloatingText(unit.x, unit.y, `+${hold.def.xp} XP`, '#4cb8f0');
    game.grantExperience(unit, hold.def.xp);
    return true;
  }

  /** Healing a fighter gets at the start of a round: from the building it rests on, or a held shrine beside it. */
  function restHeal(game, unit) {
    let heal = 0;
    let cleanse = false;
    const here = holdingAt(game, unit.x, unit.y);
    if (here) {
      if (here.owner === unit.team && here.def.heal && !(here.def.recruit && warChestsSealed(game))) {
        heal = here.def.heal;
        cleanse = here.id === 'shrine';
      } else if (here.owner < 0 && here.id === 'shrine') heal = ECONOMY.restHeal;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = unit.x + dx;
      const y = unit.y + dy;
      if (x < 0 || y < 0 || x >= game.map.width || y >= game.map.height) continue;
      const near = holdingAt(game, x, y);
      if (near && near.owner === unit.team && near.def.healRange >= 1 && near.def.heal > heal) {
        heal = near.def.heal;
        cleanse = true;
      }
    }
    return { heal, cleanse };
  }

  return {
    id: 'royale-economy',

    setup(game) {
      game.holds = {}; // cell index -> owning team (absent = neutral)
      game.holdSince = {}; // cell index -> the round it was last claimed
      const spawns = game.map.meta?.spawns || [];
      for (const s of spawns) {
        game.holds[cell(game, s.x, s.y)] = s.team;
        game.vision?.reveal(s.team, s.x, s.y, 9); // from round one you can see the first things worth walking to
      }
      game.vision?.recomputeAll();
    },

    structureSight(game, s, tile) {
      if (!isHolding(tile.building)) return undefined;
      const owner = game.holds?.[cell(game, s.x, s.y)] ?? -1; // fog sets up before this module does
      return { team: owner, radius: owner >= 0 ? HOLDINGS[tile.building].vision : 0 };
    },

    income(game, value, team) {
      return value + incomeOf(game, team);
    },

    actions(game, list, unit) {
      const extra = tileOptions(game, unit).filter(o => ORDER_ACTIONS.has(o.id) && o.ok).map(o => o.id);
      return extra.length ? [...list, ...extra] : list;
    },

    describeAction(game, actionId) {
      const labels = { claim: ['Claim', 'take it for your warband'], recruit: ['Recruit', 'train a fighter'], temper: ['Temper weapon', '+8 attack'], study: ['Study', '+60 XP'] };
      return labels[actionId] ? { label: labels[actionId][0], hint: labels[actionId][1] } : undefined;
    },

    performAction(game, unit, actionId, target) {
      switch (actionId) {
        case 'claim': return claim(game, unit);
        case 'recruit': return recruit(game, unit, target?.item);
        case 'temper': return temper(game, unit);
        case 'study': return study(game, unit);
        default: return undefined; // not ours (explore is the loot module's)
      }
    },

    turnStart(game, team) {
      for (const u of game.units) {
        if (u.team !== team || u.currentHp <= 0) continue;
        const { heal, cleanse } = restHeal(game, u);
        if (!heal) continue;
        const before = u.currentHp;
        u.currentHp = Math.min(u.max_hp, u.currentHp + heal);
        if (cleanse) u.status = null;
        if (u.currentHp !== before) game.onFloatingText(u.x, u.y, `+${u.currentHp - before}`, '#4ce0a0');
      }
    },

    describeTile(game, lines, x, y) {
      const hold = holdingAt(game, x, y);
      if (!hold) return lines;
      const me = game.getCurrentTeam();
      const owner = hold.owner < 0 ? 'Unclaimed' : hold.owner === me ? 'Held by your warband' : `Held by ${game.teamNames?.[hold.owner] || `warband ${hold.owner + 1}`}`;
      return [...lines, { kind: 'building', text: hold.def.blurb }, { kind: 'income', text: `${owner} · ${describeYield(hold.def)}` }];
    }
  };
}
