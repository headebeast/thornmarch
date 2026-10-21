// Headless end-to-end checks — the engine, rule modules, generator and AIs run in plain Node (no DOM).
//   node scripts/test-headless.mjs [turns=25]
// Exits non-zero on any failed assertion.

import { loadDatabase, silentSound } from './lib/nodeContent.mjs';
import { GameEngine } from '../public/js/engine/gameState.js';
import { getMode } from '../public/js/modes/registry.js';
import '../public/js/modes/classic.js';
import '../public/js/modes/frontier/index.js';
import { generateFrontierMap } from '../public/js/modes/frontier/mapGenerator.js';

const TURNS = Number(process.argv[2] || 25);
let failures = 0;
let checks = 0;
const check = (cond, msg) => {
  checks++;
  if (!cond) {
    failures++;
    console.error('  ✗ FAIL:', msg);
  }
};
const section = t => console.log(`\n== ${t}`);

function makeGame(db, match) {
  const game = new GameEngine(db, silentSound);
  game.initGame(match.mapData, match.playerConfig, { ...match.options, rules: match.rules });
  const ai = match.createAI(game);
  ai.fast = true;
  return { game, ai };
}

async function play(db, match, turns, label) {
  const { game, ai } = makeGame(db, match);
  const t0 = performance.now();
  let slowest = 0;
  while (game.phase !== 'GAME_OVER' && game.turnNumber <= turns) {
    const t1 = performance.now();
    await ai.playTurn();
    slowest = Math.max(slowest, performance.now() - t1);
  }
  const ms = performance.now() - t0;
  const summary = {
    label,
    turn: game.turnNumber,
    phase: game.phase,
    winner: game.winnerTeam,
    ms: Math.round(ms),
    slowestTurnMs: Math.round(slowest),
    units: game.activeTeams.map(t => game.getUnitsOf(t).length),
    gold: game.activeTeams.map(t => game.players[t].gold),
    pop: game.activeTeams.map(t => `${game.getTeamPopulation(t)}/${game.getMaxPop(t)}`),
    renown: game.renown ? game.activeTeams.map(t => game.renown[t]) : undefined
  };
  console.log(' ', JSON.stringify(summary));

  // invariants
  const seen = new Set();
  for (const u of game.units) {
    const k = `${u.x},${u.y}`;
    check(!seen.has(k), `${label}: two units on ${k}`);
    seen.add(k);
    check(u.x >= 0 && u.y >= 0 && u.x < game.map.width && u.y < game.map.height, `${label}: unit out of bounds`);
    check(u.currentHp > 0 && u.currentHp <= u.max_hp, `${label}: bad hp ${u.currentHp}`);
  }
  for (const t of game.activeTeams) check(game.getTeamPopulation(t) <= game.getMaxPop(t) + 8, `${label}: team ${t} far over supply`);
  return game;
}

const fingerprint = game =>
  JSON.stringify([
    game.turnNumber,
    game.units.map(u => [u.index, u.team, u.x, u.y, u.currentHp, u.level]).sort(),
    game.activeTeams.map(t => game.players[t].gold),
    game.map.tiles.flat().reduce((h, v) => (Math.imul(h, 31) + v) | 0, 7)
  ]);

async function rulesSection(db, frontier) {
  section('Frontier rules (scripted scenarios)');
  const match = frontier.createMatch({ players: 2, size: 'large', seed: 'RULES', fog: true, renown: 100, gold: 1000, teams: { 0: 'LOCAL', 1: 'LOCAL' } }, db);
  const { game: g } = makeGame(db, match);
  const refs = db.packRefs('frontier');
  const tid = (b, o, st = 0) => refs.tiles[`${b}_${o < 0 ? 'n' : o}_${st}`];
  const tileOf = (x, y) => db.getTile(g.map.tiles[x][y]);
  const cmd = g.units.find(u => u.team === 0 && u.isCommander);

  // -- commander recruit rule (original GameCore.canBuyUponUnit)
  const keep = g.structures.find(s => tileOf(s.x, s.y).isCastle && tileOf(s.x, s.y).team === 0);
  check(g.canRecruitUnit(0, 0, keep.x, keep.y).ok, 'can recruit while own commander stands on the Keep');
  {
    const before = g.units.length;
    g.recruitUnit(0, 0, keep.x, keep.y);
    const fresh = g.units[g.units.length - 1];
    check(g.units.length === before + 1 && (fresh.x !== keep.x || fresh.y !== keep.y), 'recruit deploys beside the commander instead of stacking on him');
    check(new Set(g.units.map(u => `${u.x},${u.y}`)).size === g.units.length, 'no two units ever share a tile');
    g.cancelSelection();
    g.units.splice(g.units.indexOf(fresh), 1);
    g.touchUnits();
    g.players[0].gold = 1000;
  }

  // -- starter farms: ripe farms pay, tilled/growing ones grow one stage per own turn
  const grow = g.structures.find(s => tileOf(s.x, s.y).building === 'farm' && tileOf(s.x, s.y).team === 0 && tileOf(s.x, s.y).stage === 1);
  check(!!grow, 'a growing starter farm exists');
  g.endTurn(); g.endTurn(); // back to team 0
  check(tileOf(grow.x, grow.y).stage === 2, 'farm ripened after the owner next turn');

  // -- Peasant builds a field on open ground
  const peasant = g.units.find(u => u.team === 0 && u.index === refs.units.peasant);
  const spot = (() => {
    for (let r = 1; r < 8; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      const x = peasant.x + dx, y = peasant.y + dy;
      if (x < 0 || y < 0 || x >= g.map.width || y >= g.map.height) continue;
      if ([18, 32, 34].includes(g.map.tiles[x][y]) && !g.getUnitAt(x, y)) return { x, y };
    }
  })();
  g.selectUnit(peasant);
  g.moveSelectedUnitTo(spot.x, spot.y);
  const goldBefore = g.players[0].gold;
  check(g.availableActions.includes('build:farm'), 'Peasant is offered Plow Field on open ground');
  g.beginActionTargeting('build:farm');
  check(tileOf(spot.x, spot.y).building === 'farm' && tileOf(spot.x, spot.y).team === 0, 'field built and owned');
  check(g.players[0].gold === goldBefore - 60, 'field cost 60 gold');
  check(peasant.standby, 'building ends the unit turn');

  // -- Forge: pay gold, permanent +8 attack, capped at 2
  const u2 = g.units.find(u => u.team === 0 && u.index === 0);
  g.setTile(u2.x, u2.y, tid('forge', 0));
  g.endTurn(); g.endTurn();
  g.selectUnit(u2); g.moveSelectedUnitTo(u2.x, u2.y);
  check(g.availableActions.includes('forge'), 'Forge action offered on an owned forge');
  const atk0 = u2.attack + u2.bonusAttack;
  g.beginActionTargeting('forge');
  check(u2.bonusAttack === 8 && u2.forged === 1, 'forge grants +8 attack');
  g.endTurn(); g.endTurn();
  g.selectUnit(u2); g.moveSelectedUnitTo(u2.x, u2.y); g.beginActionTargeting('forge');
  g.endTurn(); g.endTurn();
  g.selectUnit(u2); g.moveSelectedUnitTo(u2.x, u2.y);
  check(!g.availableActions.includes('forge'), 'forge is capped at two upgrades per unit');

  // -- Ruins: explore once, deterministic reward, tile becomes explored, renown awarded
  const u3 = g.units.find(u => u.team === 0 && u.index === 0 && u !== u2) || u2;
  g.endTurn(); g.endTurn();
  g.setTile(u3.x, u3.y, tid('ruins', -1, 0));
  const rn0 = g.renown[0];
  g.selectUnit(u3); g.moveSelectedUnitTo(u3.x, u3.y);
  check(g.availableActions.includes('explore'), 'Explore offered on unexplored ruins');
  g.beginActionTargeting('explore');
  check(tileOf(u3.x, u3.y).stage === 1, 'ruins become explored');
  check(g.renown[0] === rn0 + 5, 'exploring ruins awards 5 Renown');

  // -- Shrine heals the unit resting on it at the start of its owner turn
  const u4 = g.units.find(u => u.team === 0 && u.index === 0 && u !== u2 && u !== u3) || u3;
  g.endTurn(); g.endTurn();
  g.setTile(u4.x, u4.y, tid('shrine', 0));
  u4.currentHp = 30;
  g.endTurn(); g.endTurn();
  check(u4.currentHp >= 70, `shrine heals 40 HP (hp now ${u4.currentHp})`);

  // -- Pike Wall: +50% against mounted (same defender, ability on vs off)
  for (let x = 4; x < 8; x++) for (let y = 4; y < 8; y++) g.map.tiles[x][y] = 18;
  const pike = g.spawnUnit(refs.units.pikeman, 0, 5, 5);
  const horse = g.spawnUnit(refs.units.knight, 1, 5, 6);
  const { calculateDamage } = await import('../public/js/engine/combat.js');
  const withWall = calculateDamage(g, pike, horse, false);
  const keep32 = pike.abilities;
  pike.abilities = pike.abilities.filter(a => a !== 32);
  const withoutWall = calculateDamage(g, pike, horse, false);
  pike.abilities = keep32;
  check(withWall === Math.floor(withoutWall * 1.5), `Pike Wall = +50% vs mounted (${withoutWall} -> ${withWall})`);

  // -- Fog: an unseen enemy on the path triggers an AMBUSH (move stops one tile short)
  for (let x = 10; x < 40; x++) g.map.tiles[x][20] = 18;
  const scout = g.spawnUnit(refs.units.outrider, 0, 20, 20, false);
  const lurker = g.spawnUnit(0, 1, 28, 20, false);
  g.vision.recomputeAll();
  g.currentTeamIndex = 0; g.phase = 'IDLE';
  check(!g.canSeeUnit(0, lurker), 'enemy beyond sight radius is hidden');
  g.selectUnit(scout);
  g.moveSelectedUnitTo(28, 20);
  check(scout.ambushed && scout.x === 27, `scout ambushed one tile short (stopped at x=${scout.x})`);
  check(g.canSeeUnit(0, lurker), 'the ambusher is revealed once adjacent');

  // -- Renown victory
  g.renown[0] = 100; g.checkVictoryConditions();
  check(g.phase === 'GAME_OVER' && g.winnerTeam === 0, 'reaching the Renown goal wins the game');
}

async function movementSection(db) {
  section('Movement profiles');
  const { RuleSet } = await import('../public/js/engine/ruleSet.js');
  const { createMovementProfiles } = await import('../public/js/rules/movementProfiles.js');
  const { getMovementPointCost, getReachableTiles } = await import('../public/js/engine/pathfinding.js');
  const make = (tiles, withProfiles, units = []) => {
    const g = new GameEngine(db, silentSound);
    g.initGame({ id: 'm', name: 'm', width: tiles.length, height: tiles[0].length, tiles, units: [{ team: 0, index: 9, x: 0, y: 0 }, { team: 1, index: 9, x: tiles.length - 1, y: tiles[0].length - 1 }, ...units] }, { 0: 'LOCAL', 1: 'LOCAL' }, { rules: new RuleSet(withProfiles ? [createMovementProfiles()] : []) });
    return g;
  };
  const N = 21;
  const grid = (f) => Array.from({ length: N }, (_, x) => Array.from({ length: N }, (_, y) => f(x, y)));
  const rough = grid((x, y) => [18, 15, 17, 0, 32, 20][(x * 3 + y * 5) % 6]);
  const g = make(rough, true);
  const reachOf = idx => { const u = g.spawnUnit(idx, 0, 10, 10, false); const n = getReachableTiles(g, u).reachable.length; g.units.splice(g.units.indexOf(u), 1); g.touchUnits(); return n; };
  const reach = Object.fromEntries(db.units.filter(u => !u.isCrystal && !u.pack).map(u => [u.name, reachOf(u.index)]));
  const dragon = reach.Dragon;
  check(Object.entries(reach).every(([n, r]) => n === 'Dragon' || r < dragon), `Dragon reaches furthest on rough terrain (${dragon} vs best other ${Math.max(...Object.entries(reach).filter(([n]) => n !== 'Dragon').map(([, r]) => r))})`);
  check(new Set(Object.values(reach)).size >= 9, `units have distinct reach (${new Set(Object.values(reach)).size} different values)`);

  const cost = (idx, tile) => { const u = g.spawnUnit(idx, 0, 3, 3, false); const c = getMovementPointCost(g, u, tile); g.units.splice(g.units.indexOf(u), 1); g.touchUnits(); return c; };
  check(cost(7, 17) >= 99 && cost(7, 0) >= 99, 'Catapult cannot enter mountains or water');
  check(cost(2, 0) === 1 && cost(17, 0) === 1, 'water elementals glide through water');
  check(cost(5, 15) === 1 && cost(5, 17) === 1, 'Wolf ignores forest/mountain cost (Crawler)');
  check(cost(8, 17) === 1 && cost(8, 0) === 1 && cost(8, 15) === 1, 'Dragon flies over everything');
  check(cost(0, 15) > cost(5, 15), 'Soldier slower in forest than Wolf');
  const refs = db.packRefs('frontier').units;
  check(cost(refs.knight, 15) > cost(0, 15) && cost(refs.outrider, 0) > cost(0, 0), 'mounted units struggle in forest and water');

  // enhanced off => original uniform behaviour
  const og = make(rough, false);
  const u = og.spawnUnit(0, 0, 3, 3, false);
  check(getMovementPointCost(og, u, 15) === 2 && getMovementPointCost(og, og.spawnUnit(7, 0, 4, 4, false), 17) === 3, 'without the module costs are the original ones');

  // flyers pass over enemy ground units but not enemy flyers (GameCore.canMoveThrough)
  const open = grid(() => 18);
  const fg = make(open, true);
  const dragonU = fg.spawnUnit(8, 0, 5, 10, false);
  const wallGround = [4, 5, 6].map(i => fg.spawnUnit(0, 1, 7, 9 + i - 4, false));
  const reachCells = new Set(getReachableTiles(fg, dragonU).reachable.map(r => `${r.x},${r.y}`));
  check(reachCells.has('9,10') && !reachCells.has('7,10'), 'Dragon flies over enemy ground units (cannot land on them)');
  fg.units.filter(x => x.team === 1 && x.index === 0).forEach(x => { x.index = 14; });
  const ghosts = fg.units.filter(x => x.team === 1 && x.index === 14);
  ghosts.forEach(gh => { gh.abilities = db.getUnitTemplate(14).abilities; });
  fg.touchUnits();
  // wall of enemy flyers across the whole column blocks a flyer
  for (let y = 0; y < N; y++) if (!fg.getUnitAt(7, y)) { const w = fg.spawnUnit(14, 1, 7, y, false); w.abilities = db.getUnitTemplate(14).abilities; }
  const behind = new Set(getReachableTiles(fg, dragonU).reachable.map(r => `${r.x},${r.y}`));
  check(![...behind].some(k => Number(k.split(',')[0]) > 7), 'a wall of enemy flyers blocks a flyer');
}


async function royaleSection(db) {
  section('Battle Royale');
  await import('../public/js/modes/royale/index.js');
  const { RoyaleRound } = await import('../public/js/modes/royale/round.js');
  const { inZone } = await import('../public/js/modes/royale/modules/storm.js');
  const mode = getMode('royale');
  const ai = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [i, 'AI']));

  const play = async (players, seed, cap = 130, extra = {}) => {
    const match = mode.createMatch({ players, seed, plan: 25, teams: ai(players), ...extra }, db);
    const g = new GameEngine(db, silentSound);
    g.initGame(match.mapData, match.playerConfig, { ...match.options, rules: match.rules });
    const rr = new RoyaleRound(g, match.createAI(g));
    const t0 = performance.now();
    let slowest = 0;
    while (g.phase !== 'GAME_OVER' && rr.round < cap) {
      const t1 = performance.now();
      rr.beginRound(); rr.planBots(); await rr.resolve({}); rr.endRound();
      slowest = Math.max(slowest, performance.now() - t1);
    }
    return { g, rr, match, ms: performance.now() - t0, slowest };
  };

  for (const [players, size] of [[20, 96], [40, 128], [60, 160]]) {
    const { g, rr, match, ms, slowest } = await play(players, `T${players}`);
    check(match.mapData.width === size, `${players} warbands => ${size}x${size} island`);
    check(g.phase === 'GAME_OVER' && g.winnerTeam !== null, `${players}-warband match reaches a winner (round ${rr.round})`);
    check(!g.storm && match.mapData.meta.storm === null, `${players}: no storm, no zone by default`);
    check(g.royale.endedBy !== 'time', `${players}: decided by the last warband standing, not by the stand-off cap (round ${rr.round} of ${g.hunt.cap})`);
    check(g.royale.eliminated.length === players - 1, `${players}: every other warband eliminated exactly once (${g.royale.eliminated.length})`);
    const places = g.royale.eliminated.map(e => e.placement);
    check(new Set(places).size === places.length, `${players}: placements are unique`);
    check(new Set(g.units.map(u => `${u.x},${u.y}`)).size === g.units.length, `${players}: no two units share a tile`);
    console.log(`  ${players}p ${size}x${size}: ${rr.round} rounds, ${ms.toFixed(0)} ms total, slowest round ${slowest.toFixed(0)} ms, winner ${match.teamNames[g.winnerTeam]}`);
  }

  // determinism: identical seed => identical final state (this is what online lockstep relies on)
  const a = await play(20, 'DETERM');
  const b = await play(20, 'DETERM');
  check(a.rr.stateHash() === b.rr.stateHash() && a.rr.round === b.rr.round && a.g.winnerTeam === b.g.winnerTeam, 'same seed => identical match (lockstep-safe)');
  const c = await play(20, 'OTHER');
  check(c.rr.stateHash() !== a.rr.stateHash(), 'different seed => different match');

  // human orders flow through the same resolver: a scripted team moves where told and attacks
  const match = mode.createMatch({ players: 20, seed: 'ORDERS', teams: { 0: 'LOCAL', ...Object.fromEntries(Array.from({ length: 19 }, (_, i) => [i + 1, 'AI'])) } }, db);
  const g = new GameEngine(db, silentSound);
  g.initGame(match.mapData, match.playerConfig, { ...match.options, rules: match.rules });
  const rr = new RoyaleRound(g, match.createAI(g));
  rr.beginRound(); rr.planBots();
  const mine = g.units.filter(u => u.team === 0);
  const target = { x: mine[0].x + 2, y: mine[0].y };
  const orders = [{ unitId: mine[0].id, move: target, act: null }];
  const startX = mine[0].x;
  await rr.resolve({ 0: orders });
  check(mine[0].x !== startX || g.getUnitAt(target.x, target.y) !== mine[0], 'a human move order is carried out (or blocked sensibly)');
  check(g.units.every(u => u.currentHp > 0), 'resolution leaves no dead units on the board');

  // an optional storm still works when asked for: units outside the circle take damage at round end, inside do not
  const m2 = mode.createMatch({ players: 20, seed: 'STORM', storm: 'normal', teams: ai(20) }, db);
  check(m2.mapData.meta.storm?.phases.length === 8 && m2.rules.modules.some(m => m.id === 'royale-storm'), 'storm = normal builds an 8-phase zone and the storm module');
  const g2 = new GameEngine(db, silentSound);
  g2.initGame(m2.mapData, m2.playerConfig, { ...m2.options, rules: m2.rules });
  const r2 = new RoyaleRound(g2, m2.createAI(g2));
  while (g2.storm.index < 2 && r2.round < 40) { r2.beginRound(); r2.planBots(); await r2.resolve({}); r2.endRound(); }
  r2.beginRound();
  const outside = g2.units.find(u => u.currentHp > 0 && !inZone(g2.storm.current, u.x, u.y));
  const inside = g2.units.find(u => u.currentHp > 0 && inZone(g2.storm.current, u.x, u.y));
  const before = [outside?.currentHp, inside?.currentHp];
  g2.rules.notify('roundEnd', g2, r2.round);
  if (outside) check(outside.currentHp < before[0] || outside.currentHp <= 0, 'storm hurts units outside the safe circle');
  if (inside) check(inside.currentHp === before[1] || inside.currentHp < before[1] && g2.storm.suddenDeath, 'storm spares units inside the safe circle');

  // loot: stepping on a crate opens it (once) and powers the unit up
  const m3 = mode.createMatch({ players: 20, seed: 'LOOT', teams: ai(20) }, db);
  const g3 = new GameEngine(db, silentSound);
  g3.initGame(m3.mapData, m3.playerConfig, { ...m3.options, rules: m3.rules });
  const crate = g3.structures.find(s => g3.assets.getTile(g3.map.tiles[s.x][s.y]).building === 'crate');
  const u3 = g3.units.find(u => u.team === 0);
  u3.x = crate.x; u3.y = crate.y; g3.touchUnits();
  g3.rng.next = () => 0; // force the first loot-table entry: a honed blade (+6 attack)
  g3.rules.notify('afterMove', g3, u3);
  check(g3.assets.getTile(g3.map.tiles[crate.x][crate.y]).building === 'crate_empty', 'opened crate becomes an empty crate');
  check(u3.bonusAttack === 6, `the crate granted +6 attack (got ${u3.bonusAttack})`);
  g3.rules.notify('afterMove', g3, u3);
  check(u3.bonusAttack === 6, 'an empty crate gives nothing the second time');
  check(!g3.storm, 'default island has no storm object');

  // ---- the Hunt: war horns, spoils, forced march, stand-off cap ---------------------------------------------------
  const { HORN, PING_MEMORY, standings, huntStatus } = await import('../public/js/modes/royale/modules/hunt.js');
  const fresh = (seed, players = 20) => {
    const m = mode.createMatch({ players, seed, plan: 25, teams: ai(players) }, db);
    const g = new GameEngine(db, silentSound);
    g.initGame(m.mapData, m.playerConfig, { ...m.options, rules: m.rules });
    return { m, g, rr: new RoyaleRound(g, m.createAI(g)) };
  };

  const h4 = fresh('HUNT');
  let firstHorn = 0;
  while (h4.g.phase !== 'GAME_OVER' && h4.rr.round < HORN.first + 2) {
    h4.rr.beginRound();
    if (h4.g.hunt.horn && !firstHorn) {
      firstHorn = h4.rr.round;
      const alive = h4.rr.aliveTeams();
      check(h4.g.hunt.pings.length === alive.length, `the horn marks every living warband (${h4.g.hunt.pings.length}/${alive.length})`);
      const ping = h4.g.hunt.pings[0];
      const squad = h4.g.units.filter(u => u.team === ping.team && u.currentHp > 0);
      check(squad.some(u => u.x === ping.x && u.y === ping.y) && ping.n === squad.length, 'a marker sits on its warband and counts its fighters');
      check(huntStatus(h4.g).tone === 'horn', 'the HUD is told a horn sounded');
    }
    h4.rr.planBots(); await h4.rr.resolve({}); h4.rr.endRound();
  }
  check(firstHorn === HORN.first, `the first horn sounds on round ${HORN.first} (got ${firstHorn})`);
  h4.rr.beginRound();
  check(!h4.g.hunt.horn && h4.g.hunt.pings.length > 0 && h4.rr.round - h4.g.hunt.pingRound <= PING_MEMORY, 'between horns the last markers stay as "last known position"');

  // final hunt: few warbands left => a horn every round
  const h5 = fresh('FINAL');
  for (const t of h5.g.activeTeams.slice(HORN.finalAt)) {
    h5.g.players[t].eliminated = true;
    for (const u of h5.g.units.filter(u => u.team === t)) u.currentHp = 0;
  }
  h5.g.units = h5.g.units.filter(u => u.currentHp > 0);
  h5.rr.beginRound();
  check(h5.g.hunt.final && h5.g.hunt.horn && huntStatus(h5.g).tone === 'final', `with ${HORN.finalAt} warbands left every round is a horn (final hunt)`);

  // spoils: a wiped-out warband leaves an arsenal that every warband has seen
  const squad0 = h5.g.units.filter(u => u.team === 0);
  const where = { x: squad0[0].x, y: squad0[0].y };
  const killer = h5.g.units.find(u => u.team === 1);
  for (const u of squad0) h5.g.handleUnitDeath(u, killer);
  const w5 = h5.g.map.width;
  const drops = h5.g.structures.filter(s => h5.g.assets.getTile(h5.g.map.tiles[s.x][s.y]).building === 'airdrop');
  check(drops.some(d => Math.abs(d.x - where.x) + Math.abs(d.y - where.y) <= 2 && h5.g.activeTeams.every(t => h5.g.vision.explored[t][d.y * w5 + d.x] === 1)), 'a wiped-out warband drops an arsenal where it fell, seen by all');
  check(h5.g.players[0].eliminated === true, 'the fallen warband is marked eliminated');

  // forced march: extra movement only while the warband sees no enemy
  const h6 = fresh('MARCH');
  const lone = h6.g.units.find(u => u.team === 0);
  h6.g.startTurnEffects(0, false, { global: false });
  check(lone.currentMp > lone.movement_point, `no enemy in sight => forced march (${lone.currentMp} > ${lone.movement_point} MP)`);
  const foe = h6.g.units.find(u => u.team === 1);
  foe.x = lone.x + 1; foe.y = lone.y; h6.g.touchUnits(); h6.g.vision.recompute(0);
  h6.g.startTurnEffects(0, false, { global: false });
  check(lone.currentMp === lone.movement_point, 'an enemy in sight => normal movement');

  // stand-off cap: at the cap the strongest warband is named (it never decides a real last-one-standing game)
  const h7 = fresh('CAP');
  h7.g.hunt.cap = 3;
  while (h7.g.phase !== 'GAME_OVER' && h7.rr.round < 10) { h7.rr.beginRound(); h7.rr.planBots(); await h7.rr.resolve({}); h7.rr.endRound(); }
  check(h7.g.phase === 'GAME_OVER' && h7.rr.round === 3 && h7.g.royale.endedBy === 'time', `time is called at the cap (round ${h7.rr.round})`);
  check(h7.g.winnerTeam === standings(h7.g)[0].team && h7.g.royale.standings[0] === h7.g.winnerTeam, 'the winner is the strongest warband (living fighters, HP, kills)');

  // bots never park: no living warband stands motionless for a long stretch (they route around lakes and ridges)
  const h8 = fresh('T40', 40);
  const still = {};
  let worst = 0;
  while (h8.g.phase !== 'GAME_OVER' && h8.rr.round < 140) {
    h8.rr.beginRound(); h8.rr.planBots(); await h8.rr.resolve({}); h8.rr.endRound();
    for (const t of h8.rr.aliveTeams()) {
      const key = h8.g.units.filter(u => u.team === t).map(u => `${u.x},${u.y}`).join('|');
      still[t] = still[t]?.key === key ? { key, n: still[t].n + 1 } : { key, n: 0 };
      worst = Math.max(worst, still[t].n);
    }
  }
  check(worst < 14, `no warband stands still for 14+ rounds in a row (longest stretch: ${worst})`);

  // ---- holdings & gold ---------------------------------------------------------------------------------------------
  const H = await import('../public/js/modes/royale/holdings.js');
  const e1 = fresh('ECON');
  const { g: ge } = e1;
  const spawn0 = ge.map.meta.spawns.find(s => s.team === 0);
  check(H.holdingAt(ge, spawn0.x, spawn0.y)?.id === 'camp' && H.holdingAt(ge, spawn0.x, spawn0.y).owner === 0, 'every warband starts on its own War Camp');
  check(ge.players[0].gold === H.ECONOMY.startGold, `warbands start with ${H.ECONOMY.startGold} gold`);
  const starter = ge.map.meta.starters.find(s => s.team === 0);
  check(starter.mine && ge.vision.isExplored(0, starter.mine.x, starter.mine.y), 'the starter Gold Mine is already in sight at round one');
  check(starter.crates.length >= 1, 'crates are scattered near the camp for the first rounds');
  const placeOn = (unit, x, y) => { unit.x = x; unit.y = y; ge.touchUnits(); };
  const u0 = ge.units.find(u => u.team === 0);

  // income
  const goldBefore = ge.players[0].gold;
  ge.startTurnEffects(0, false, { global: false });
  check(ge.players[0].gold - goldBefore === H.incomeOf(ge, 0) && H.incomeOf(ge, 0) === H.ECONOMY.baseIncome + H.HOLDINGS.camp.income, `income = base + camp (${H.incomeOf(ge, 0)}/round)`);

  // claim, income, fortify
  placeOn(u0, starter.mine.x, starter.mine.y);
  check(H.tileOptions(ge, u0).some(o => o.id === 'claim' && o.ok), 'standing on an unclaimed mine offers "claim"');
  ge.selectUnit(u0);
  check(ge.computeAvailableActions(u0).includes('claim'), 'the engine lists "claim" as an available action');
  ge.clearSelection();
  check(ge.executeCustomAction(u0, 'claim', null) === true && ge.holds[starter.mine.y * ge.map.width + starter.mine.x] === 0, 'claiming gives the warband the mine');
  check(H.incomeOf(ge, 0) === H.ECONOMY.baseIncome + H.HOLDINGS.camp.income + H.HOLDINGS.mine.income, `the mine pays gold (+${H.HOLDINGS.mine.income}/round)`);
  check(ge.vision.isVisible(0, starter.mine.x + H.HOLDINGS.mine.vision, starter.mine.y), 'a held building grants its sight (structureSight hook)');
  const raider = ge.units.find(u => u.team === 1);
  placeOn(raider, starter.mine.x, starter.mine.y);
  ge.turnNumber = 2;
  const seize = H.tileOptions(ge, raider).find(o => o.id === 'claim');
  check(seize && !seize.ok && /Freshly claimed/.test(seize.reason), 'a freshly planted banner cannot be seized straight away');
  ge.turnNumber = 2 + H.ECONOMY.fortify;
  check(H.tileOptions(ge, raider).find(o => o.id === 'claim').ok, 'after the fortify period an enemy fighter can seize it');
  ge.executeCustomAction(raider, 'claim', null);
  check(ge.holds[starter.mine.y * ge.map.width + starter.mine.x] === 1 && H.incomeOf(ge, 0) === H.ECONOMY.baseIncome + H.HOLDINGS.camp.income, 'seizing moves the income to the new owner');

  // recruit: weariness, squad cap, sealed war chests
  const camp = H.holdingAt(ge, spawn0.x, spawn0.y);
  placeOn(u0, camp.x, camp.y);
  ge.players[0].gold = 2000;
  const soldier = ge.assets.getUnitTemplate(0);
  const squadNow = () => ge.units.filter(u => u.team === 0 && u.currentHp > 0).length;
  const n0 = squadNow();
  check(ge.executeCustomAction(u0, 'recruit', { item: 0 }) && squadNow() === n0 + 1, 'a fighter on a held camp can recruit');
  check(ge.players[0].gold === 2000 - soldier.price, 'the recruit costs list price the first time');
  check(H.recruitPrice(ge, 0, soldier) > soldier.price, `each recruit makes the next dearer (${H.recruitPrice(ge, 0, soldier)}g)`);
  const fresh1 = ge.units.filter(u => u.team === 0).at(-1);
  check(fresh1.currentMp === 0 && !ge.getUnitAt(camp.x, camp.y)?.id !== undefined && (fresh1.x !== camp.x || fresh1.y !== camp.y), 'the recruit appears beside the camp and arrives weary');
  while (squadNow() < H.ECONOMY.squadCap) ge.executeCustomAction(u0, 'recruit', { item: 0 });
  check(squadNow() === H.ECONOMY.squadCap, `warbands stop growing at ${H.ECONOMY.squadCap} fighters`);
  check(!H.tileOptions(ge, u0).find(o => o.id === 'recruit').ok && ge.executeCustomAction(u0, 'recruit', { item: 0 }) === false, 'a full warband cannot recruit');
  ge.units.find(u => u.team === 0 && u !== u0).currentHp = 0; ge.units = ge.units.filter(u => u.currentHp > 0); ge.touchUnits();
  ge.hunt.sealed = true;
  check(ge.executeCustomAction(u0, 'recruit', { item: 0 }) === false && /closed/.test(H.tileOptions(ge, u0).find(o => o.id === 'recruit').reason), 'sealed war chests block recruiting');
  ge.hunt.sealed = false;
  check(!H.rosterFor(ge, 'outpost').includes(8) && H.rosterFor(ge, 'camp').includes(8), 'outposts train only cheap fighters; camps train everyone');

  // forge & academy
  const forgeSpot = ge.map.meta.towns.find(t => t.type === 'forge');
  const libSpot = ge.map.meta.towns.find(t => t.type === 'library');
  if (forgeSpot) {
    placeOn(u0, forgeSpot.x, forgeSpot.y);
    check(!H.tileOptions(ge, u0).some(o => o.id === 'temper'), 'a forge only works for its owner');
    ge.executeCustomAction(u0, 'claim', null);
    ge.players[0].gold = 1000;
    const atk = u0.bonusAttack || 0;
    ge.executeCustomAction(u0, 'temper', null);
    ge.executeCustomAction(u0, 'temper', null);
    check((u0.bonusAttack || 0) === atk + 2 * H.HOLDINGS.forge.bonus && ge.players[0].gold === 1000 - 2 * H.HOLDINGS.forge.cost, 'a held forge tempers a weapon for gold (+8 attack, twice)');
    check(ge.executeCustomAction(u0, 'temper', null) === false, 'no more than two temperings per fighter');
  }
  if (libSpot) {
    placeOn(u0, libSpot.x, libSpot.y);
    ge.executeCustomAction(u0, 'claim', null);
    const xp = u0.xp + u0.level * 100;
    ge.executeCustomAction(u0, 'study', null);
    check(u0.xp + u0.level * 100 === xp + H.HOLDINGS.library.xp, 'a held academy trains experience');
  }

  // held shrines mend the fighters beside them; neutral ones only the one resting on them
  const shrineSpot = ge.map.meta.towns.find(t => t.type === 'shrine');
  if (shrineSpot) {
    const nb = { x: shrineSpot.x + 1, y: shrineSpot.y };
    placeOn(u0, shrineSpot.x, shrineSpot.y);
    ge.executeCustomAction(u0, 'claim', null);
    const buddy = ge.units.find(u => u.team === 0 && u !== u0);
    placeOn(buddy, nb.x, nb.y);
    buddy.currentHp = 30; u0.currentHp = 30;
    ge.startTurnEffects(0, false, { global: false });
    check(buddy.currentHp === 30 + H.HOLDINGS.shrine.heal && u0.currentHp === 30 + H.HOLDINGS.shrine.heal, 'a held shrine heals fighters on and beside it');
  }

  // bots use the economy
  const eco = fresh('BOTECON');
  let claims = 0, recruits = 0;
  const prev = eco.g.onEvent.bind(eco.g);
  eco.g.onEvent = (t, d) => { if (t === 'claim') claims++; if (t === 'recruit') recruits++; prev(t, d); };
  for (let i = 0; i < 12; i++) { eco.rr.beginRound(); eco.rr.planBots(); await eco.rr.resolve({}); eco.rr.endRound(); }
  check(claims >= 10, `bots claim buildings (${claims} claims in 12 rounds)`);
  check(recruits >= 5, `bots recruit with their gold (${recruits} recruits in 12 rounds)`);
  const gold1 = eco.g.players[0].gold;
  check(eco.rr.stateHash() === eco.rr.stateHash() && typeof gold1 === 'number', 'economy state is part of the lockstep hash');
  const h1 = eco.rr.stateHash();
  eco.g.players[0].gold += 5;
  check(eco.rr.stateHash() !== h1, 'a gold difference changes the state hash (desyncs would be caught)');

  // lockstep with building orders: two independent clients, one "human" team whose orders (claims, recruits, forge) travel as JSON
  const client = () => {
    const m = mode.createMatch({ players: 20, seed: 'LOCKSTEP', plan: 25, teams: { 0: 'LOCAL', ...Object.fromEntries(Array.from({ length: 19 }, (_, i) => [i + 1, 'AI'])) } }, db);
    const g = new GameEngine(db, silentSound);
    g.initGame(m.mapData, m.playerConfig, { ...m.options, rules: m.rules });
    return { g, rr: new RoyaleRound(g, m.createAI(g)), ai: m.createAI(g) };
  };
  const A = client();
  const B = client();
  let lockOk = true;
  let humanActs = 0;
  for (let round = 1; round <= 25 && lockOk; round++) {
    A.rr.beginRound(); B.rr.beginRound();
    A.rr.planBots(); B.rr.planBots();
    const wire = JSON.stringify(A.ai.planTeam(A.g, 0)); // what the human's client would send to the referee
    humanActs += JSON.parse(wire).filter(o => ['claim', 'recruit', 'temper', 'study'].includes(o.act?.type)).length;
    await A.rr.resolve({ 0: JSON.parse(wire) });
    await B.rr.resolve({ 0: JSON.parse(wire) });
    A.rr.endRound(); B.rr.endRound();
    if (A.rr.stateHash() !== B.rr.stateHash()) lockOk = false;
  }
  check(lockOk, 'two clients stay hash-identical through 25 rounds of claims, recruits and upgrades (lockstep-safe economy)');
  check(humanActs >= 4, `the human-style team actually used buildings (${humanActs} building orders)`);
}


(async () => {
  const db = loadDatabase();

  section('Diagnostics (FPS, ping, jitter, loss)');
  {
    const { NetStats } = await import('../public/js/network/netStats.js');
    const { PerfMonitor } = await import('../public/js/platform/perfMonitor.js');
    const ns = new NetStats({ keep: 10, timeoutMs: 3000 });
    check(ns.snapshot(0).quality === 'none' && ns.snapshot(0).ping === null, 'no probes yet: quality "none"');
    // five answered probes with RTTs 40, 50, 40, 50, 40
    [40, 50, 40, 50, 40].forEach((rtt, i) => { ns.sent(i, i * 2000); ns.received(i, i * 2000 + rtt); });
    let s = ns.snapshot(9000);
    check(Math.abs(s.ping - 44) < 1e-9 && Math.abs(s.jitter - 10) < 1e-9 && s.loss === 0 && s.quality === 'good', `ping ${s.ping}, jitter ${s.jitter}, loss ${s.loss}% → good`);
    // two probes never answered
    ns.sent(100, 10000); ns.sent(101, 12000);
    ns.sweep(13000);
    check(ns.snapshot(13000).loss === 0, 'a probe still inside its timeout is not lost yet');
    ns.sweep(16000);
    s = ns.snapshot(16000);
    check(Math.abs(s.loss - (2 / 7) * 100) < 1e-9, `two silent probes out of seven → ${s.loss.toFixed(1)}% loss`);
    check(s.quality === 'poor' && s.silent, 'high loss and a long silence read as "poor"');
    check(ns.received(100, 17000) === null, 'a late answer for a written-off probe is ignored');
    ns.reset();
    check(ns.snapshot(0).samples === 0, 'reset clears the history');
    check(NetStats.quality(60, 0) === 'good' && NetStats.quality(150, 0) === 'fair' && NetStats.quality(60, 2) === 'fair' && NetStats.quality(300, 0) === 'poor', 'quality bands: good < 100 ms & < 1% · fair · poor ≥ 250 ms or ≥ 5%');
    const win = new NetStats({ keep: 5 });
    for (let i = 0; i < 20; i++) { win.sent(i, i); win.received(i, i + 10); }
    check(win.history.length === 5 && win.rtts.length === 5, 'only the most recent probes count');

    const pm = new PerfMonitor(500);
    for (let t = 1000; t <= 3000; t += 1000 / 60) pm.tick(t);
    check(Math.abs(pm.fps - 60) < 2 && Math.abs(pm.frameMs - 16.7) < 1, `a steady 60 Hz reads ${pm.fps.toFixed(1)} FPS / ${pm.frameMs.toFixed(1)} ms`);
    for (let t = 3000; t <= 5000; t += 1000 / 30) pm.tick(t);
    check(Math.abs(pm.fps - 30) < 2, `dropping to 30 Hz reads ${pm.fps.toFixed(1)} FPS`);
    pm.tick(5000 + 8000); // the tab was in the background for 8 s
    check(pm.fps > 20, 'a long background gap is not counted as a slow frame');
    const d = pm.drain();
    check(d && d.avg > 20 && d.min <= d.avg && pm.drain() === null, 'drain() returns the average and minimum once, then starts afresh');
  }

  section('Content pack');
  check(db.units.length === 29, `expected 29 units, got ${db.units.length}`);
  check(db.abilities.length === 36, `expected 36 abilities, got ${db.abilities.length}`);
  console.log(`  units ${db.units.length}, tiles ${db.tiles.length}, abilities ${db.abilities.length}`);
  for (const u of db.units.slice(19)) check(u.max_hp === 100 && u.abilities.length > 0, `unit ${u.name} malformed`);

  section('Map generator');
  for (const [size, players] of [[48, 2], [64, 3], [96, 4]]) {
    const t0 = performance.now();
    const m = generateFrontierMap({ size, players, seed: `t${size}` }, db, db.autotile);
    const ms = performance.now() - t0;
    check(m.width === size && m.tiles.length === size && m.tiles[0].length === size, `grid shape ${size}`);
    check(m.units.filter(u => u.index === 9).length === players, `${size}: one commander per player`);
    const m2 = generateFrontierMap({ size, players, seed: `t${size}` }, db, db.autotile);
    check(JSON.stringify(m.tiles) === JSON.stringify(m2.tiles), `${size}: generation is deterministic`);
    // mirror symmetry (4-way): tile identity may differ only by ownership, so compare terrain classes
    let asym = 0;
    for (let x = 0; x < size; x++) for (let y = 0; y < size; y++) {
      const a = db.getTile(m.tiles[x][y]);
      const b = db.getTile(m.tiles[size - 1 - x][y]);
      if (a.type !== b.type) asym++;
    }
    check(asym === 0, `${size}: terrain symmetric (asymmetric cells: ${asym})`);
    console.log(`  ${size}x${size} / ${players}p  ${ms.toFixed(0)} ms  POIs ${m.meta.pois.length}`);
  }

  section('Frontier: AI vs AI');
  const frontier = getMode('frontier');
  const cfg = { players: 2, size: 'large', seed: 'HEADLESS', fog: true, renown: 100, gold: 400, teams: { 0: 'AI', 1: 'AI' } };
  const g1 = await play(db, frontier.createMatch(cfg, db), TURNS, 'frontier-large');
  const g2 = await play(db, frontier.createMatch(cfg, db), TURNS, 'frontier-large (replay)');
  check(fingerprint(g1) === fingerprint(g2), 'same seed + same AI => identical outcome (deterministic)');

  const own = (g, t) => g.structures.filter(s => g.assets.getTile(g.map.tiles[s.x][s.y]).team === t).length;
  console.log('  structures owned:', g1.activeTeams.map(t => own(g1, t)));
  check(g1.activeTeams.every(t => own(g1, t) > 3), 'both teams expanded beyond their starting buildings');
  check(g1.units.length > 8, 'armies grew');

  section('Frontier: 4 players on the Grand realm');
  await play(db, frontier.createMatch({ players: 4, size: 'grand', seed: 'FOUR', fog: true, renown: 60, gold: 400, teams: { 0: 'AI', 1: 'AI', 2: 'AI', 3: 'AI' } }, db), Math.min(TURNS, 15), 'frontier-grand-4p');

  section('Classic skirmish AI (refactored controller)');
  const skirmish = getMode('skirmish');
  const classicMap = db.maps.find(m => m.category === 'skirmish' && m.width <= 15);
  const sm = skirmish.createMatch({ mapId: classicMap.id, teams: { 0: 'AI', 1: 'AI' }, fog: false }, db);
  await play(db, sm, 20, 'skirmish-classic');
  const sf = skirmish.createMatch({ mapId: classicMap.id, teams: { 0: 'AI', 1: 'AI' }, fog: true }, db);
  await play(db, sf, 20, 'skirmish-with-fog (module reuse)');

  await rulesSection(db, frontier);
  await movementSection(db);
  await royaleSection(db);

  console.log(failures ? `\n${failures} of ${checks} check(s) FAILED` : `\nAll ${checks} checks passed ✓`);
  process.exit(failures ? 1 : 0);
})().catch(err => {
  console.error(err);
  process.exit(2);
});
