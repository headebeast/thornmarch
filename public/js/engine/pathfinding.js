// Pathfinding & range queries — 1:1 rules with project_aeii UnitToolkit, rebuilt for large maps:
// binary-heap Dijkstra, flat typed arrays, and work proportional to the *reachable* area
// (not the whole grid), so a 96x96 frontier map costs the same as a 15x15 skirmish map.

import { ABILITY, TILE_TYPES, STATUS } from '../config/constants.js';
import { hasAbility, hasStatus, getUnitStats, getManhattanRange } from './combat.js';

const DIRS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 }
];

export function getMovementPointCost(game, unit, tileIndex) {
  const tile = game.assets.getTile(tileIndex);
  // a movement-profile module may supply a unit-specific base cost; abilities below still override it
  const profiled = game.rules.first('baseMoveCost', game, unit, tile, tileIndex);
  let mpCost = profiled !== undefined ? profiled : tile.stepCost;
  const tileType = tile.type;

  if (hasAbility(unit, ABILITY.AIR_FORCE)) return 1;
  if (
    hasAbility(unit, ABILITY.CRAWLER) &&
    (tileType === TILE_TYPES.LAND || tileType === TILE_TYPES.FOREST || tileType === TILE_TYPES.MOUNTAIN)
  ) {
    mpCost = 1;
  }
  if (hasAbility(unit, ABILITY.FIGHTER_OF_THE_SEA) && tileType === TILE_TYPES.WATER) mpCost = 1;
  if (hasAbility(unit, ABILITY.FIGHTER_OF_THE_FOREST) && tileType === TILE_TYPES.FOREST) mpCost = 1;
  if (hasAbility(unit, ABILITY.FIGHTER_OF_THE_MOUNTAIN) && tileType === TILE_TYPES.MOUNTAIN) mpCost = 1;
  if (hasAbility(unit, ABILITY.PATHFINDER) && (tileType === TILE_TYPES.FOREST || tileType === TILE_TYPES.MOUNTAIN)) {
    mpCost = Math.min(mpCost, 2);
  }
  if (unit.isCrystal && tileType === TILE_TYPES.MOUNTAIN && tile.stepCost >= 3) mpCost = 99;
  return mpCost;
}

// ---------------------------------------------------------------------------------------------
// Binary min-heap keyed by numeric priority (stores cell indexes)
// ---------------------------------------------------------------------------------------------
export class MinHeap {
  constructor() {
    this.keys = [];
    this.vals = [];
  }
  get size() {
    return this.keys.length;
  }
  push(key, val) {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop() {
    const k = this.keys;
    const v = this.vals;
    const topVal = v[0];
    const lastKey = k.pop();
    const lastVal = v.pop();
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lastKey) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lastKey;
      v[i] = lastVal;
    }
    return topVal;
  }
}

/** Result of a movement search. Replaces the old [x][y] matrices. */
export class PathField {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.dist = new Float32Array(width * height).fill(Infinity);
    this.parent = new Int32Array(width * height).fill(-1);
    this.visited = [];
  }
  idx(x, y) {
    return y * this.width + x;
  }
  getDist(x, y) {
    return this.dist[y * this.width + x];
  }
  getParent(x, y) {
    const p = this.parent[y * this.width + x];
    return p < 0 ? null : { x: p % this.width, y: (p / this.width) | 0 };
  }
}

export function getReachableTiles(game, unit) {
  const width = game.map.width;
  const height = game.map.height;
  const maxMp = unit.currentMp !== undefined ? unit.currentMp : getUnitStats(unit).movementPoint;
  const isAir = hasAbility(unit, ABILITY.AIR_FORCE);
  const tiles = game.map.tiles;

  const field = new PathField(width, height);
  const { dist, parent } = field;
  const start = unit.y * width + unit.x;
  dist[start] = 0;

  const heap = new MinHeap();
  heap.push(0, start);

  while (heap.size > 0) {
    const cur = heap.pop();
    const cx = cur % width;
    const cy = (cur / width) | 0;
    const cd = dist[cur];
    field.visited.push(cur);

    for (let d = 0; d < 4; d++) {
      const nx = cx + DIRS[d].dx;
      const ny = cy + DIRS[d].dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ni = ny * width + nx;

      // Original rule (GameCore.canMoveThrough): nobody passes an enemy — except flyers, who sail over enemy *ground* units
      const occ = game.getUnitAtFor(unit.team, nx, ny);
      if (occ && occ.team !== unit.team && !(isAir && !hasAbility(occ, ABILITY.AIR_FORCE))) continue;

      const nextCost = cd + getMovementPointCost(game, unit, tiles[nx][ny]);
      if (nextCost <= maxMp && nextCost < dist[ni]) {
        dist[ni] = nextCost;
        parent[ni] = cur;
        heap.push(nextCost, ni);
      }
    }
  }

  const reachable = [];
  for (const i of field.visited) {
    const x = i % width;
    const y = (i / width) | 0;
    if (dist[i] > maxMp) continue;
    const occ = game.getUnitAtFor(unit.team, x, y);
    // Can only stop on an empty tile or the unit's own tile
    if (!occ || occ.id === unit.id) reachable.push({ x, y, cost: dist[i] });
  }
  return { reachable, dist: field, parent: field, field };
}

export function reconstructPath(field, startX, startY, targetX, targetY) {
  const path = [];
  let cur = { x: targetX, y: targetY };
  let guard = field.width * field.height;
  while (cur && guard-- > 0) {
    path.unshift(cur);
    if (cur.x === startX && cur.y === startY) break;
    cur = field.getParent(cur.x, cur.y);
  }
  return path;
}

/**
 * Cost-to-goal map: Dijkstra *outwards from a goal*, over the terrain a given unit class could walk.
 * Used by AI to route units toward far-away objectives on huge maps (one search per goal, reused).
 *
 * `until` ({x, y, margin}) turns it into a directed search for ONE unit: the frontier is steered toward that cell (A*, a
 * Manhattan guess that never overestimates because every step costs at least 1) and stops once the cell is settled plus
 * `margin` more cost. Cells inside that band hold exact costs — everything a unit planning its next move can reach — and
 * the rest stay tentative or Infinity. Far goals then cost a narrow band of the map instead of a full disc.
 */
export function buildDistanceField(game, unit, goalX, goalY, maxCost = 400, until = null) {
  const { width, height } = game.map;
  const field = new Float32Array(width * height).fill(Infinity);
  const heap = new MinHeap();
  const g = goalY * width + goalX;
  field[g] = 0;
  const stopX = until ? until.x : 0;
  const stopY = until ? until.y : 0;
  const guess = (x, y) => (until ? Math.abs(x - stopX) + Math.abs(y - stopY) : 0);
  heap.push(guess(goalX, goalY), g);
  const closed = new Uint8Array(width * height);
  const stopCell = until ? stopY * width + stopX : -1;
  let limit = maxCost; // compared against cost + guess, i.e. the cheapest total a route through the cell could have
  while (heap.size > 0) {
    const cur = heap.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % width;
    const cy = (cur / width) | 0;
    const cd = field[cur];
    if (cd + guess(cx, cy) > limit) break;
    if (cur === stopCell) limit = Math.min(limit, cd + (until.margin ?? 0));
    for (let d = 0; d < 4; d++) {
      const nx = cx + DIRS[d].dx;
      const ny = cy + DIRS[d].dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ni = ny * width + nx;
      if (closed[ni]) continue;
      // Cost of *entering the current cell* when walking from the neighbour toward the goal
      const nd = cd + getMovementPointCost(game, unit, game.map.tiles[cx][cy]);
      if (nd < field[ni]) {
        field[ni] = nd;
        heap.push(nd + guess(nx, ny), ni);
      }
    }
  }
  return field;
}

export function getAttackableTargets(game, unit, fromX = unit.x, fromY = unit.y) {
  if (hasStatus(unit, STATUS.BLINDED)) return [];
  if (hasAbility(unit, ABILITY.HEAVY_MACHINE) && (fromX !== unit.startTurnX || fromY !== unit.startTurnY)) {
    return []; // Catapults cannot attack after moving
  }

  const targets = [];
  const minR = unit.min_attack_range;
  const maxR = unit.max_attack_range;

  for (const other of game.units) {
    if (other.currentHp > 0 && other.team !== unit.team) {
      const r = getManhattanRange(fromX, fromY, other.x, other.y);
      if (r >= minR && r <= maxR && game.canSeeUnit(unit.team, other)) {
        targets.push({ x: other.x, y: other.y, type: 'unit', unit: other });
      }
    }
  }

  // Destroyable enemy/neutral buildings if the unit has the DESTROYER ability (Catapult, Sapper)
  if (hasAbility(unit, ABILITY.DESTROYER)) {
    for (const s of game.structures) {
      const r = getManhattanRange(fromX, fromY, s.x, s.y);
      if (r >= minR && r <= maxR && !game.getUnitAt(s.x, s.y)) {
        const tile = game.assets.getTile(game.map.tiles[s.x][s.y]);
        if (tile.isDestroyable && tile.team !== unit.team) {
          targets.push({ x: s.x, y: s.y, type: 'tile_destroy' });
        }
      }
    }
  }
  return targets;
}

export function getSummonableTombs(game, unit, fromX = unit.x, fromY = unit.y) {
  if (!hasAbility(unit, ABILITY.NECROMANCER)) return [];
  const targets = [];
  for (const tomb of game.tombs) {
    const r = getManhattanRange(fromX, fromY, tomb.x, tomb.y);
    if (r === 1 && !game.getUnitAt(tomb.x, tomb.y)) targets.push({ x: tomb.x, y: tomb.y });
  }
  return targets;
}

export function getHealableTargets(game, unit, fromX = unit.x, fromY = unit.y) {
  if (!hasAbility(unit, ABILITY.HEALER)) return [];
  const targets = [];
  for (const other of game.units) {
    if (other.currentHp <= 0) continue;
    const r = getManhattanRange(fromX, fromY, other.x, other.y);
    if (r > 1) continue;
    if (other.team === unit.team && other.currentHp < other.max_hp && other.id !== unit.id) {
      targets.push({ x: other.x, y: other.y, unit: other });
    } else if (other.team !== unit.team && hasAbility(other, ABILITY.UNDEAD) && game.canSeeUnit(unit.team, other)) {
      targets.push({ x: other.x, y: other.y, unit: other });
    }
  }
  return targets;
}
