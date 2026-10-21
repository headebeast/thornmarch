// What a bot warband knows and wants about buildings and gold (deterministic, fog-respecting, DOM-free).
//
// Bots only know buildings on ground their warband has explored, and only know WHO holds one while they can see it. They
// spend like this: claim whatever is near, recruit the best-value fighter they can afford whenever a fighter stands on a
// camp they hold, temper and study when standing on a forge or academy, and make a trip back to a camp when they are rich.

import { ABILITY } from '../../config/constants.js';
import { ihash } from '../shared/terrain.js';
import { ECONOMY, HOLDINGS, isHolding, fortifiedFor, tileOptions, rosterFor, squadSize, recruitPrice, warChestsSealed } from './holdings.js';

const man = (ax, ay, bx, by) => Math.abs(ax - bx) + Math.abs(ay - by);

/** The warband's purse and every holding it has heard of. `budget` is spent down as orders are given this round. */
export function readEconomy(game, team) {
  const w = game.map.width;
  const exp = game.vision?.explored?.[team];
  const holdings = [];
  for (const s of game.structures) {
    const tile = game.assets.getTile(game.map.tiles[s.x][s.y]);
    if (!isHolding(tile.building)) continue;
    const cell = s.y * w + s.x;
    if (exp && !exp[cell]) continue;
    let owner = game.holds[cell] ?? -1;
    // out of sight, a bot only remembers what it owns; anything else it assumes is up for grabs
    if (owner !== team && game.vision && !game.vision.isVisible(team, s.x, s.y)) owner = -1;
    holdings.push({ x: s.x, y: s.y, id: tile.building, owner });
  }
  return { team, gold: game.players[team].gold, budget: game.players[team].gold, squadN: squadSize(game, team), holdings };
}

/** Holdings worth walking to: unclaimed or enemy ground first, plus a trip to a camp when there is gold to spend. */
export function holdingCandidates(game, leader, eco, focus = 1) {
  const out = [];
  for (const h of eco.holdings) {
    const def = HOLDINGS[h.id];
    if (h.owner === eco.team) continue;
    if (h.owner >= 0 && fortifiedFor(game, h.x, h.y) > 0) continue; // a banner just planted cannot be taken yet
    const d = man(leader.x, leader.y, h.x, h.y) - def.value / 35;
    if (d < 26 * focus) out.push({ x: h.x, y: h.y, d, kind: 'claim' });
  }
  if (eco.squadN < ECONOMY.squadCap && !warChestsSealed(game)) {
    for (const h of eco.holdings) {
      const def = HOLDINGS[h.id];
      if (h.owner !== eco.team || !def.recruit) continue;
      const dist = man(leader.x, leader.y, h.x, h.y);
      // a short trip for a modest purse, a long one only for a big one
      if (dist > 0 && ((eco.budget >= 300 && dist <= 14) || (eco.budget >= 700 && dist <= 36))) out.push({ x: h.x, y: h.y, d: dist - 6, kind: 'recruit' });
    }
  }
  return out;
}

/** The best-value fighter this site can train for the money, leaning toward whatever the warband lacks. */
export function chooseRecruit(game, team, kind, eco, squad, seed, round) {
  let melee = 0;
  let ranged = 0;
  for (const u of squad) u.max_attack_range >= 2 ? ranged++ : melee++;
  const wantRanged = ranged * 2 < melee + ranged; // keep at least a third of the warband shooting
  let best = null;
  for (const index of rosterFor(game, kind)) {
    const tpl = game.assets.getUnitTemplate(index);
    const price = recruitPrice(game, team, tpl);
    if (price > eco.budget) continue;
    let quality = tpl.attack + tpl.physical_defence * 0.7 + tpl.magic_defence * 0.3 + tpl.movement_point * 3;
    if (tpl.abilities?.includes(ABILITY.HEALER)) quality += 8;
    if (wantRanged && tpl.max_attack_range >= 2) quality += 14;
    // a squad is capped at six, so a slot is worth more than a coin: favour strength over thrift
    const value = (quality / Math.pow(price / 100, 0.35)) * (0.92 + ihash(seed, team * 131 + index, round) * 0.16);
    if (!best || value > best.value || (value === best.value && index < best.index)) best = { index, value, price };
  }
  return best;
}

/**
 * The most worthwhile thing `unit` could do for its warband on the building at `pos`, or null.
 * { act, score, cost } — `cost` is gold to set aside once the order is chosen.
 */
export function buildingAct(game, unit, pos, eco, squad, seed, round) {
  const tile = game.assets.getTile(game.map.tiles[pos.x][pos.y]);
  if (!isHolding(tile.building)) return null;
  const def = HOLDINGS[tile.building];
  let best = null;
  const offer = (act, score, cost = 0) => {
    if (!best || score > best.score) best = { act, score, cost };
  };
  for (const o of tileOptions(game, unit, pos.x, pos.y)) {
    if (!o.ok) continue;
    if (o.id === 'claim') {
      const seized = eco.holdings.find(h => h.x === pos.x && h.y === pos.y)?.owner >= 0;
      offer({ type: 'claim' }, def.value + (seized ? 25 : 0));
    } else if (o.id === 'recruit' && eco.squadN < ECONOMY.squadCap) {
      const pick = chooseRecruit(game, unit.team, def.recruit, eco, squad, seed, round);
      if (pick) offer({ type: 'recruit', item: pick.index }, 100, pick.price);
    } else if (o.id === 'temper' && eco.budget >= o.cost) offer({ type: 'temper' }, 60, o.cost);
    else if (o.id === 'study') offer({ type: 'study' }, 52);
  }
  return best;
}
