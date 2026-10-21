// Prints every unit's movement points and the cost of each terrain for it, plus how many tiles it can reach on a
// fixed mixed-terrain arena. Run:  node scripts/audit-movement.mjs
import { loadDatabase, silentSound } from './lib/nodeContent.mjs';
import { GameEngine } from '../public/js/engine/gameState.js';
import { getMovementPointCost, getReachableTiles } from '../public/js/engine/pathfinding.js';
import { RuleSet } from '../public/js/engine/ruleSet.js';
import { createMovementProfiles } from '../public/js/rules/movementProfiles.js';
const ENHANCED = !process.argv.includes('--classic');

const db = loadDatabase();
const g = new GameEngine(db, silentSound);
// terrain sample tiles: plains, road, forest, hill, mountain, water, bridge, village
const T = { plains: 18, road: 20, forest: 15, hill: 32, mountain: 17, water: 0, bridge: 28, village: 36 };

// arena 25x25 of mixed terrain bands + a swamp of everything around the centre
const N = 25;
const tiles = Array.from({ length: N }, (_, x) => Array.from({ length: N }, (_, y) => {
  const r = (x * 7 + y * 13) % 10;
  return r < 4 ? T.plains : r < 6 ? T.forest : r < 7 ? T.hill : r < 8 ? T.mountain : r < 9 ? T.water : T.road;
}));
tiles[12][12] = T.plains;
g.initGame({ id: 'arena', name: 'arena', width: N, height: N, tiles, units: [{ team: 0, index: 9, x: 0, y: 0 }, { team: 1, index: 9, x: 24, y: 24 }] }, { 0: 'LOCAL', 1: 'LOCAL' }, { rules: new RuleSet(ENHANCED ? [createMovementProfiles()] : []) });
console.log(ENHANCED ? '== ENHANCED movement profiles ==' : '== ORIGINAL uniform movement ==');

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('unit', 14) + pad('MP', 4) + pad('class', 12) + Object.keys(T).map(k => pad(k, 9)).join('') + 'reach(arena)  reach(open plains)');
for (const tpl of db.units) {
  if (tpl.isCrystal) continue;
  const u = g.spawnUnit(tpl.index, 0, 12, 12, false);
  const costs = Object.values(T).map(t => getMovementPointCost(g, u, t));
  const reach = getReachableTiles(g, u).reachable.length;
  // open plains reach
  const keep = g.map.tiles.map(c => c.slice());
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) g.map.tiles[x][y] = T.plains;
  const open = getReachableTiles(g, u).reachable.length;
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) g.map.tiles[x][y] = keep[x][y];
  console.log(pad(tpl.name, 14) + pad(u.movement_point, 4) + pad(u.moveClass || 'orig', 12) + costs.map(c => pad(c, 9)).join('') + pad(reach, 14) + open);
  g.units.splice(g.units.indexOf(u), 1); g.touchUnits();
}
