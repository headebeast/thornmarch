// Frontier AI — plants farms, claims buildings, scouts the fog and marches on rivals.
// Strategy layers: (1) recruit by need, (2) give every unit a role + goal, (3) score each reachable tile
// by goal progress and opportunities (capture, build, explore, attack), (4) commit.
// Fair play: it only targets enemy *units* it can currently see (remembered for a few turns), but, like a
// human who studied the map, it knows where buildings are.

import { ABILITY } from '../config/constants.js';
import { hasAbility, calculateDamage, canCounterAttack, getManhattanRange } from '../engine/combat.js';
import { getReachableTiles, getAttackableTargets, getHealableTargets, buildDistanceField } from '../engine/pathfinding.js';
import { AIController } from './aiController.js';
import { BUILDINGS } from '../modes/frontier/content.js';

const BUILDABLE = new Set([18, 32, 34]);
const STRUCT_VALUE = { mine: 95, obelisk: 90, outpost: 70, shrine: 55, forge: 60, library: 45, watchtower: 50, farm: 45, ruins: 75, village: 60 };

export class FrontierAI extends AIController {
  async beginTurn(team) {
    const g = this.game;
    this.team = team;
    this.fields = new Map();
    this.claims = new Set();
    this.sight = this.sight || new Map(); // remembered enemy sightings
    this.mine = g.getUnitsOf(team);
    this.visible = g.units.filter(u => u.currentHp > 0 && u.team !== team && g.canSeeUnit(team, u));
    for (const e of this.visible) this.sight.set(e.id, { x: e.x, y: e.y, turn: g.turnNumber, unit: e });
    for (const [id, s] of this.sight) if (g.turnNumber - s.turn > 8 || !g.units.includes(s.unit)) this.sight.delete(id);

    this.own = { keeps: [], outposts: [], farms: 0, structures: [] };
    this.targets = [];
    this.enemyKeeps = [];
    for (const s of g.structures) {
      const t = g.assets.getTile(g.map.tiles[s.x][s.y]);
      if (t.team === team) {
        this.own.structures.push({ x: s.x, y: s.y, t });
        if (t.isCastle) this.own.keeps.push(s);
        if (t.building === 'outpost') this.own.outposts.push(s);
        if (t.building === 'farm') this.own.farms++;
      } else {
        if (t.isCastle) this.enemyKeeps.push({ x: s.x, y: s.y, neutral: t.team < 0 });
        const v = this.structureValue(t);
        if (v > 0) this.targets.push({ x: s.x, y: s.y, t, value: v });
      }
    }
    this.armyGoal = this.chooseArmyGoal();
  }

  structureValue(t) {
    if (t.building === 'ruins') return t.stage === 0 ? STRUCT_VALUE.ruins : 0;
    if (t.building) {
      const base = STRUCT_VALUE[t.building] || 40;
      return base + (t.team >= 0 ? 25 : 0) + (t.building === 'farm' ? t.stage * 12 : 0);
    }
    if (t.isVillage) return STRUCT_VALUE.village + (t.team >= 0 ? 20 : 0);
    if (t.isCastle) return t.team >= 0 ? 130 : 105;
    return 0;
  }

  // -------------------------------------------------------------------------------------------
  // Recruitment
  // -------------------------------------------------------------------------------------------
  async recruit(team) {
    const g = this.game;
    const player = g.players[team];
    const refs = g.assets.packRefs('frontier').units;
    const idx = k => refs[k] ?? g.assets.units.find(u => u.name.toLowerCase() === k)?.index;
    const turn = g.turnNumber;

    const sites = [];
    for (const s of g.structures) {
      const t = g.assets.getTile(g.map.tiles[s.x][s.y]);
      if (t.team !== team || g.getUnitAt(s.x, s.y)) continue;
      if (t.isCastle) sites.push({ ...s, kind: 'keep' });
      else if (t.building === 'outpost') sites.push({ ...s, kind: 'outpost' });
    }

    for (const site of sites) {
      const units = g.getUnitsOf(team);
      const count = k => units.filter(u => u.index === idx(k)).length;
      const wantPeasants = Math.min(5, 2 + Math.floor(turn / 5));
      const order = [];

      if (!player.commanderAlive && site.kind === 'keep') order.push(g.assets.unitConfig.commander_index);
      if (count('peasant') < wantPeasants) order.push(idx('peasant'));
      const scouts = count('outrider') + count('griffin_rider');
      if (scouts < (turn < 4 ? 1 : 2)) order.push(idx('outrider'));
      if (site.kind === 'keep' && turn >= 5 && count('sapper') < 1 && this.own.outposts.length < 2) order.push(idx('sapper'));

      const enemyMounted = this.visible.filter(e => hasAbility(e, ABILITY.MOUNTED)).length;
      const enemyAir = this.visible.filter(e => hasAbility(e, ABILITY.AIR_FORCE)).length;
      const melee = count('pikeman') + count('soldier') + count('knight');
      const ranged = count('crossbowman') + count('archer') + count('alchemist') + count('ranger');
      const support = count('druid');

      if (enemyMounted >= 2) order.push(idx('pikeman'));
      if (enemyAir >= 1) order.push(idx('crossbowman'));
      if (support < Math.floor(units.length / 6)) order.push(idx('druid'));
      if (ranged < melee * 0.6) order.push(site.kind === 'keep' ? idx('crossbowman') : idx('archer'));
      if (site.kind === 'keep') {
        const heavy = [idx('knight'), idx('ranger'), idx('alchemist'), idx('pikeman'), idx('griffin_rider')];
        order.push(heavy[(turn + units.length) % heavy.length]);
      }
      order.push(idx('pikeman'), idx('soldier'));

      // keep a little gold in reserve for fields while the economy is young
      const reserve = turn < 8 && this.own.farms < 5 ? 60 : 0;
      for (const u of order) {
        if (u === undefined) continue;
        const check = g.canRecruitUnit(team, u, site.x, site.y);
        if (!check.ok || player.gold - check.price < reserve) continue;
        g.recruitUnit(team, u, site.x, site.y);
        await this.pace(200, site.x, site.y);
        // recruitUnit leaves the new unit selected; the main loop will move it
        g.clearSelection();
        g.notify();
        break;
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Goals
  // -------------------------------------------------------------------------------------------
  chooseArmyGoal() {
    const g = this.game;
    const home = this.own.keeps[0] || { x: g.map.width >> 1, y: g.map.height >> 1 };
    // defend: a visible enemy near anything we own
    let best = null;
    let bestD = 14;
    for (const e of this.visible) {
      for (const s of this.own.structures) {
        const d = getManhattanRange(e.x, e.y, s.x, s.y);
        if (d < bestD) {
          bestD = d;
          best = { x: e.x, y: e.y, kind: 'defend' };
        }
      }
    }
    if (best) return best;
    const army = this.mine.filter(u => !this.isCivilian(u) && !this.isScout(u)).length;
    if (army >= 5 && this.enemyKeeps.length) {
      const hostile = this.enemyKeeps.filter(k => !k.neutral);
      const pool = hostile.length ? hostile : this.enemyKeeps;
      pool.sort((a, b) => getManhattanRange(a.x, a.y, home.x, home.y) - getManhattanRange(b.x, b.y, home.x, home.y));
      return { x: pool[0].x, y: pool[0].y, kind: 'assault' };
    }
    const sighted = [...this.sight.values()].sort(
      (a, b) => getManhattanRange(a.x, a.y, home.x, home.y) - getManhattanRange(b.x, b.y, home.x, home.y)
    )[0];
    if (sighted && army >= 3) return { x: sighted.x, y: sighted.y, kind: 'hunt' };
    return { x: (g.map.width - 1) >> 1, y: (g.map.height - 1) >> 1, kind: 'muster' };
  }

  isCivilian(u) {
    return hasAbility(u, ABILITY.BUILDER);
  }
  isScout(u) {
    return hasAbility(u, ABILITY.FAR_SIGHT);
  }

  field(unit, gx, gy) {
    const air = hasAbility(unit, ABILITY.AIR_FORCE) ? 'a' : hasAbility(unit, ABILITY.PATHFINDER) ? 'p' : 'g';
    const key = `${air}:${gx},${gy}`;
    let f = this.fields.get(key);
    if (!f) {
      f = buildDistanceField(this.game, unit, gx, gy, 260);
      this.fields.set(key, f);
    }
    return f;
  }

  nearestOwnHub(x, y) {
    let best = null;
    let bd = Infinity;
    for (const s of [...this.own.keeps, ...this.own.outposts]) {
      const d = getManhattanRange(x, y, s.x, s.y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return { hub: best, dist: bd };
  }

  /** Pick this unit's strategic goal (a map cell) and what we want to do on arrival. */
  planFor(unit) {
    const g = this.game;
    const gold = g.players[this.team].gold;
    const turn = g.turnNumber;

    if (hasAbility(unit, ABILITY.BUILDER)) {
      const isSapper = (unit.builds || []).includes('outpost');
      if (!isSapper) {
        // peasants: prefer a good field site near a hub; if broke, capture loose farms
        if (gold >= BUILDINGS.farm.buildCost && this.own.farms < 3 + turn) return { goal: this.farmSiteGoal(unit), role: 'farm' };
        const farm = this.bestTarget(unit, t => t.t.building === 'farm', 14);
        if (farm) return { goal: farm, role: 'claim' };
        const hub = this.own.keeps[0];
        return hub ? { goal: hub, role: 'idle' } : { goal: null, role: 'idle' };
      }
      if (gold >= BUILDINGS.outpost.buildCost && this.own.outposts.length < 1 + Math.floor(turn / 8)) {
        return { goal: this.outpostSiteGoal(unit), role: 'outpost' };
      }
      return { goal: this.armyGoal, role: 'follow' };
    }

    if (this.isScout(unit)) {
      const t = this.bestTarget(unit, () => true, 60);
      if (t) return { goal: t, role: 'claim' };
      return { goal: this.armyGoal, role: 'roam' };
    }

    if (hasAbility(unit, ABILITY.CONQUEROR)) {
      const t = this.bestTarget(unit, tt => this.game.canCapture(unit, tt.t) || tt.t.building === 'ruins', 16);
      if (t) return { goal: t, role: 'claim' };
    } else {
      const ruin = this.bestTarget(unit, tt => tt.t.building === 'ruins' || this.game.canCapture(unit, tt.t), 8);
      if (ruin) return { goal: ruin, role: 'claim' };
    }
    return { goal: this.armyGoal, role: 'army' };
  }

  bestTarget(unit, filter, maxDist) {
    let best = null;
    let bestScore = -Infinity;
    for (const t of this.targets) {
      if (!filter(t)) continue;
      const key = `${t.x},${t.y}`;
      if (this.claims.has(key)) continue;
      const d = getManhattanRange(unit.x, unit.y, t.x, t.y);
      if (d > maxDist) continue;
      const score = t.value - d * 3.2;
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (best) this.claims.add(`${best.x},${best.y}`);
    return best;
  }

  farmSiteGoal(unit) {
    const { hub } = this.nearestOwnHub(unit.x, unit.y);
    if (!hub) return null;
    // aim for open ground near the hub, hugging existing fields
    let best = null;
    let bestScore = -Infinity;
    const g = this.game;
    for (let dy = -7; dy <= 7; dy++) {
      for (let dx = -7; dx <= 7; dx++) {
        const x = hub.x + dx;
        const y = hub.y + dy;
        if (x < 1 || y < 1 || x >= g.map.width - 1 || y >= g.map.height - 1) continue;
        if (!BUILDABLE.has(g.map.tiles[x][y]) || g.getUnitAt(x, y)) continue;
        const key = `${x},${y}`;
        if (this.claims.has(key)) continue;
        let score = -Math.abs(dx) - Math.abs(dy) - getManhattanRange(unit.x, unit.y, x, y) * 0.6;
        for (const s of this.own.structures) {
          if (s.t.building === 'farm' && getManhattanRange(x, y, s.x, s.y) === 1) score += 3;
        }
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }
    if (best) this.claims.add(`${best.x},${best.y}`);
    return best;
  }

  outpostSiteGoal(unit) {
    const g = this.game;
    const home = this.own.keeps[0];
    if (!home) return null;
    const dir = this.armyGoal;
    // a buildable tile ~12-16 cells from every hub, pointing at the objective
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 90; i++) {
      const t = 0.3 + (i % 9) * 0.05;
      const x = Math.round(home.x + (dir.x - home.x) * t + ((i * 7) % 7) - 3);
      const y = Math.round(home.y + (dir.y - home.y) * t + ((i * 5) % 7) - 3);
      if (x < 1 || y < 1 || x >= g.map.width - 1 || y >= g.map.height - 1) continue;
      if (!BUILDABLE.has(g.map.tiles[x][y]) || g.getUnitAt(x, y)) continue;
      const { dist } = this.nearestOwnHub(x, y);
      if (dist < 10) continue;
      const score = -Math.abs(dist - 13) * 2 - getManhattanRange(unit.x, unit.y, x, y) * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------------------------
  // Unit turn
  // -------------------------------------------------------------------------------------------
  unitOrder(units) {
    const rank = u => (hasAbility(u, ABILITY.BUILDER) ? 0 : this.isScout(u) ? 1 : 2);
    return units.slice().sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  }

  customActionsAt(unit, pos) {
    const ox = unit.x;
    const oy = unit.y;
    unit.x = pos.x;
    unit.y = pos.y;
    const list = this.game.rules.reduce('actions', this.game, [], unit);
    unit.x = ox;
    unit.y = oy;
    return list;
  }

  async actWithUnit(unit, team) {
    const g = this.game;
    g.selectUnit(unit);
    const { reachable } = getReachableTiles(g, unit);
    const plan = this.planFor(unit);
    const gold = g.players[team].gold;
    const field = plan.goal ? this.field(unit, plan.goal.x, plan.goal.y) : null;
    const w = g.map.width;
    const civilian = this.isCivilian(unit);

    let best = { score: -Infinity, move: { x: unit.x, y: unit.y }, action: { type: 'standby' } };

    for (const pos of reachable) {
      const tile = g.assets.getTile(g.map.tiles[pos.x][pos.y]);
      let base = tile.defenceBonus * 0.4;
      if (field) base -= Math.min(field[pos.y * w + pos.x], 999) * 2.2;

      // danger: stay out of reach of strong visible enemies when fragile
      for (const e of this.visible) {
        const d = getManhattanRange(pos.x, pos.y, e.x, e.y);
        if (d <= e.movement_point + e.max_attack_range) {
          base -= civilian ? 40 : unit.currentHp < 45 ? 25 : 4;
        }
      }
      if (this.visible.length && civilian) {
        // civilians shelter near a hub
        const { dist } = this.nearestOwnHub(pos.x, pos.y);
        base -= dist * 1.5;
      }

      let cand = { score: base, move: pos, action: { type: 'standby' } };
      const consider = (bonus, action) => {
        if (base + bonus > cand.score) cand = { score: base + bonus, move: pos, action };
      };

      if (g.canCapture(unit, tile)) consider(this.structureValue(tile) * 2.2 + (tile.isCastle ? 120 : 0), { type: 'occupy' });
      if (tile.isRepairable && hasAbility(unit, ABILITY.REPAIRER)) consider(230, { type: 'repair' });

      for (const id of this.customActionsAt(unit, pos)) {
        if (id === 'explore') consider(520, { type: 'custom', id });
        else if (id === 'study' && !this.visible.length) consider(140, { type: 'custom', id });
        else if (id === 'forge' && gold > 420 && !civilian) consider(170, { type: 'custom', id });
        else if (id === 'build:farm' && plan.role === 'farm') {
          // reward spots that border an existing field and stay close to a hub
          const { dist } = this.nearestOwnHub(pos.x, pos.y);
          if (dist <= 8) consider(330 - dist * 8, { type: 'custom', id });
        } else if (id === 'build:outpost' && plan.role === 'outpost') {
          const { dist } = this.nearestOwnHub(pos.x, pos.y);
          if (dist >= 9) consider(360, { type: 'custom', id });
        } else if (id === 'build:watchtower' && gold > 700 && !this.visible.length) consider(90, { type: 'custom', id });
      }

      for (const ht of getHealableTargets(g, unit, pos.x, pos.y)) {
        consider(170 + (ht.unit.max_hp - ht.unit.currentHp), { type: 'heal', targetX: ht.x, targetY: ht.y });
      }

      if (!civilian || unit.currentHp > 60) {
        for (const atk of getAttackableTargets(g, unit, pos.x, pos.y)) {
          if (atk.type === 'tile_destroy') {
            consider(150, { type: 'attack', targetX: atk.x, targetY: atk.y });
            continue;
          }
          const ox = unit.x;
          const oy = unit.y;
          unit.x = pos.x;
          unit.y = pos.y;
          const dmg = calculateDamage(g, unit, atk.unit, false);
          const counter = canCounterAttack(unit, atk.unit) && dmg < atk.unit.currentHp
            ? calculateDamage(g, atk.unit, unit, false) * 0.6
            : 0;
          unit.x = ox;
          unit.y = oy;
          const kill = dmg >= atk.unit.currentHp;
          const s = dmg * 3 - counter * 2.2 + (kill ? 260 : 0) + (atk.unit.isCommander ? 90 : 0);
          consider(civilian ? s * 0.35 : s, { type: 'attack', targetX: atk.x, targetY: atk.y });
        }
      }

      if (cand.score > best.score) best = cand;
    }

    await this.commit(unit, best.move, best.action);
  }
}
