// Battle Royale holdings — the buildings you fight over, as data plus a few pure helpers (no DOM).
//
// Every building starts neutral. A fighter standing on one can CLAIM it for the warband (an instant order action); a claimed
// building pays gold every round, and the buildings that do something (recruit, forge, study, heal) only work for their
// owner. Ownership lives in `game.holds` (cell index -> team), NOT in the tile, so 60 warbands need no extra tile art — the
// renderer paints a banner over whatever is held. Enemy fighters can claim a building away by standing on it.
//
// Add a building: one entry in HOLDINGS (+ a tile in content.js if it is not a Frontier one). Rules, bots and UI read it.

import { ABILITY, TILE_TYPES } from '../../config/constants.js';

export const ECONOMY = {
  startGold: 300, // enough for one good fighter at round 1 — the first decision of the game
  baseIncome: 6, // every living warband earns this each round
  squadCap: 5, // fighters per warband
  restHeal: 15, // an unowned shrine still tends whoever rests on it
  weariness: 0.25, // every fighter a warband has already raised makes the next one this much dearer
  fortify: 3, // a freshly planted banner cannot be seized again for this many rounds
  sealAt: 0.3 // war chests seal once this share of the starting warbands (at least 4) is left
};

/**
 * `income` gold per round to the owner · `recruit` roster id · `heal` HP per round to fighters resting here (owner only,
 * `healRange` tiles around it) · `vision` how far the owner sees · `action` the thing a fighter can do here for the owner.
 */
export const HOLDINGS = {
  camp: {
    name: 'War Camp',
    short: 'Camp',
    income: 6,
    recruit: 'camp',
    heal: 15,
    vision: 5,
    value: 140 // how much bots want it
  },
  outpost: {
    name: 'Outpost',
    short: 'Outpost',
    income: 4,
    recruit: 'outpost',
    heal: 10,
    vision: 4,
    value: 110
  },
  mine: {
    name: 'Gold Mine',
    short: 'Mine',
    income: 20,
    vision: 2,
    value: 130
  },
  forge: {
    name: 'Forge',
    short: 'Forge',
    action: 'temper',
    cost: 120,
    bonus: 8,
    max: 2,
    vision: 2,
    value: 100
  },
  library: {
    name: 'Academy',
    short: 'Academy',
    action: 'study',
    xp: 60,
    vision: 2,
    value: 90
  },
  shrine: {
    name: 'Shrine of Vigor',
    short: 'Shrine',
    heal: 40,
    healRange: 1,
    vision: 3,
    value: 80
  },
  watchtower: {
    name: 'Watchtower',
    short: 'Tower',
    vision: 8,
    value: 85
  }
};

// Descriptions are generated from the numbers above, so what the inspector says can never drift from what the rules do.
const BLURB = {
  camp: d => `Your base. Trains any fighter, pays ${d.income} gold a round and mends ${d.heal} HP. Lose it and you cannot recruit until you take another camp.`,
  outpost: d => `A forward camp. Trains cheap fighters far from your War Camp, pays ${d.income} gold a round and mends ${d.heal} HP.`,
  mine: d => `Rich veins pay ${d.income} gold a round to whoever holds the shaft. Everyone wants one.`,
  forge: d => `Temper a fighter’s weapon here for ${d.cost} gold: +${d.bonus} attack, up to ${d.max === 2 ? 'twice' : `${d.max} times`} per fighter.`,
  library: d => `A fighter who studies here gains ${d.xp} experience for free — three studies make a veteran.`,
  shrine: d => `Held, it restores ${d.heal} HP each round to your fighters on or beside it and cleanses ailments. Unclaimed, it only mends ${ECONOMY.restHeal} HP for the one resting on it.`,
  watchtower: d => `Holds the high ground (+15 defence) and sees ${d.vision} tiles in every direction — find the horn’s prey before it finds you.`
};
for (const [id, def] of Object.entries(HOLDINGS)) def.blurb = BLURB[id](def);

export const isHolding = id => Object.prototype.hasOwnProperty.call(HOLDINGS, id);

const cellOf = (game, x, y) => y * game.map.width + x;

/** The holding on a tile, or null. */
export function holdingAt(game, x, y) {
  const tile = game.assets.getTile(game.map.tiles[x][y]);
  if (!tile.building || !isHolding(tile.building)) return null;
  const owner = game.holds?.[cellOf(game, x, y)] ?? -1;
  return { id: tile.building, def: HOLDINGS[tile.building], tile, owner, x, y };
}

/** Gold a recruit costs THIS warband now: the list price, plus weariness for each fighter it has already raised. */
export function recruitPrice(game, team, tpl) {
  const raised = game.players[team]?.raised || 0;
  return Math.round((tpl.price * (1 + ECONOMY.weariness * raised)) / 5) * 5;
}

/** Late in the match the war chests are sealed: no more recruits, no healing at camps. (Set by the hunt module.) */
export const warChestsSealed = game => !!game.hunt?.sealed;

/** Rounds until a building claimed by someone else can be seized (0 = now). */
export function fortifiedFor(game, x, y) {
  const since = game.holdSince?.[y * game.map.width + x];
  return since === undefined ? 0 : Math.max(0, since + ECONOMY.fortify - game.turnNumber);
}

export const squadSize = (game, team) => game.units.reduce((n, u) => n + (u.team === team && u.currentHp > 0 ? 1 : 0), 0);

/** Gold per round a warband earns right now. */
export function incomeOf(game, team) {
  let gold = ECONOMY.baseIncome;
  for (const key in game.holds) if (game.holds[key] === team) {
    const x = key % game.map.width;
    const y = (key / game.map.width) | 0;
    gold += holdingAt(game, x, y)?.def.income || 0;
  }
  return gold;
}

/** Which unit indexes a recruiting building trains. Cheap fighters at outposts, everyone at camps. */
const rosterCache = new WeakMap();
export function rosterFor(game, kind) {
  let byKind = rosterCache.get(game.assets);
  if (!byKind) rosterCache.set(game.assets, (byKind = {}));
  if (byKind[kind]) return byKind[kind];
  const out = [];
  for (const u of game.assets.units) {
    if (u.isCommander || u.isSkeleton || u.isCrystal) continue;
    if (u.abilities?.includes(ABILITY.BUILDER)) continue; // royale has nothing to build
    if (kind === 'outpost' && u.price > 300) continue;
    out.push(u.index);
  }
  byKind[kind] = out.sort((a, b) => game.assets.getUnitTemplate(a).price - game.assets.getUnitTemplate(b).price);
  return byKind[kind];
}

/** A free tile beside (x, y) where a recruit can stand: dry ground first, cheapest to walk. */
export function deploySpot(game, x, y, tpl) {
  const air = tpl.abilities?.includes(ABILITY.AIR_FORCE);
  let best = null;
  for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 1 || ny < 1 || nx >= game.map.width - 1 || ny >= game.map.height - 1 || game.getUnitAt(nx, ny)) continue;
    const t = game.assets.getTile(game.map.tiles[nx][ny]);
    if (!air && (t.type === TILE_TYPES.WATER || t.stepCost >= 99)) continue;
    const cost = air ? 1 : t.stepCost + (dx && dy ? 0.5 : 0);
    if (!best || cost < best.cost) best = { x: nx, y: ny, cost };
  }
  return best;
}

/**
 * What `unit` could do for its warband while standing on (x, y). Used three ways: the planner offers it to the player, the
 * bots score it, and the resolver re-checks it when the order actually runs (the world may have changed by then).
 * Each entry: { id, label, hint, cost, icon, ok, reason }.
 */
export function tileOptions(game, unit, x = unit.x, y = unit.y, spend = { gold: null, recruits: 0 }) {
  const team = unit.team;
  // `spend` lets the planner subtract what this round's other orders already commit (gold and squad places)
  const gold = spend.gold ?? game.players[team]?.gold ?? 0;
  const out = [];
  const tile = game.assets.getTile(game.map.tiles[x][y]);

  if (tile.building === 'ruins' && tile.stage === 0) out.push({ id: 'explore', label: 'Explore ruins', hint: 'two loot rolls', icon: 'chest', ok: true });

  const hold = holdingAt(game, x, y);
  if (!hold) return out;
  const { def, owner } = hold;
  if (owner !== team) {
    const wait = owner >= 0 ? fortifiedFor(game, x, y) : 0;
    out.push({ id: 'claim', label: owner < 0 ? `Claim ${def.name}` : `Seize ${def.name}`, hint: wait ? `fortified for ${wait} more` : describeYield(def), icon: 'occupy', ok: !wait, reason: `Freshly claimed — can be seized in ${wait} round${wait === 1 ? '' : 's'}`, primary: true });
    return out;
  }
  if (def.recruit) {
    const full = squadSize(game, team) + (spend.recruits || 0) >= ECONOMY.squadCap;
    const sealed = warChestsSealed(game);
    const cheapest = rosterFor(game, def.recruit).reduce((m, i) => Math.min(m, recruitPrice(game, team, game.assets.getUnitTemplate(i))), Infinity);
    const ok = !full && !sealed && gold >= cheapest;
    const reason = sealed ? 'Recruiting is closed for the final hunt' : full ? `Warband is full (${ECONOMY.squadCap})` : 'Not enough gold';
    out.push({ id: 'recruit', label: 'Recruit…', hint: sealed ? 'closed — final hunt' : full ? 'warband is full' : `from ${cheapest}g`, icon: 'buy', ok, reason, primary: true });
  }
  if (def.action === 'temper') {
    const ok = (unit.forged || 0) < def.max && gold >= def.cost && !unit.isCrystal;
    out.push({ id: 'temper', label: 'Temper weapon', hint: `+${def.bonus} attack`, cost: def.cost, icon: 'hammer', ok, reason: (unit.forged || 0) >= def.max ? 'Fully tempered' : 'Not enough gold', primary: true });
  }
  if (def.action === 'study') {
    out.push({ id: 'study', label: 'Study', hint: `+${def.xp} XP`, icon: 'book', ok: unit.level < 3, reason: 'Already a veteran', primary: true });
  }
  return out;
}

export function describeYield(def) {
  const bits = [];
  if (def.income) bits.push(`+${def.income} gold/round`);
  if (def.recruit) bits.push('recruits');
  if (def.action === 'temper') bits.push('forge');
  if (def.action === 'study') bits.push('+XP');
  if (def.heal) bits.push(`heals ${def.heal}`);
  if (def.vision >= 5) bits.push(`sees ${def.vision}`);
  return bits.join(' · ') || def.short;
}
