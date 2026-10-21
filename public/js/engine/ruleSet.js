// Rule modules — the extension seam of the engine.
//
// A game mode is "a map source + a list of rule modules". Each module is a plain object with an
// `id` and any subset of the hooks below; the engine calls every active module in order.
// Because modules only touch the engine through these hooks, any module written for one mode
// (fog of war, farming, renown…) can be switched on in any other mode — e.g. Skirmish — later.
//
// Hook signatures (all optional, `game` is always the first argument):
//   setup(game, options)                          after map + players are created
//   turnStart(game, team)                         start of a team's turn (after classic effects)
//   turnEnd(game, team)                           just before the turn passes on
//   income(game, team, value) -> number           chain: adjust gold income
//   popCap(game, team, value) -> number           chain: adjust unit capacity
//   actions(game, unit, list) -> string[]         chain: add/remove action ids for a unit
//   actionTargets(game, unit, actionId) -> []|undefined   targets for a targeted custom action
//   performAction(game, unit, actionId, target) -> bool   run a custom action (true = handled)
//   truncateMove(game, unit, path) -> number      how many path steps may actually be walked
//   afterMove(game, unit)                         unit arrived on its destination
//   onTileChanged(game, x, y, oldIndex, newIndex) a map tile was replaced
//   onUnitSpawned(game, unit) / onUnitKilled(game, unit, killer)
//   structureSight(game, structure, tile) -> {team, radius}|undefined   who sees from a structure (modes that keep ownership outside the tile)
//   recruitSite(game, team, x, y) -> {roster:[...]}|null   which unit indexes can be bought here
//   canRecruit(game, team, unitIndex, x, y, verdict) -> verdict  chain: veto / adjust a purchase
//   checkVictory(game) -> team|null               a module may declare a winner
//   unitStats(game, unit, stats) -> stats         chain: adjust effective stats
//   describeTile(game, x, y, lines) -> lines      chain: extra inspector lines
//   serialize(game) -> object / restore(game, data)

export class RuleSet {
  constructor(modules = []) {
    this.modules = [];
    for (const m of modules) this.add(m);
  }

  add(module) {
    if (!module || !module.id) throw new Error('Rule module needs an id');
    if (this.has(module.id)) return this;
    for (const dep of module.requires || []) {
      if (!this.has(dep)) throw new Error(`Rule module "${module.id}" requires "${dep}"`);
    }
    this.modules.push(module);
    return this;
  }

  has(id) {
    return this.modules.some(m => m.id === id);
  }

  get(id) {
    return this.modules.find(m => m.id === id) || null;
  }

  get ids() {
    return this.modules.map(m => m.id);
  }

  /** Call a hook on every module (fire-and-forget). */
  notify(hook, ...args) {
    for (const m of this.modules) {
      if (typeof m[hook] === 'function') m[hook](...args);
    }
  }

  /** Thread a value through every module that implements the hook. */
  reduce(hook, game, initial, ...args) {
    let value = initial;
    for (const m of this.modules) {
      if (typeof m[hook] === 'function') {
        const next = m[hook](game, value, ...args);
        if (next !== undefined) value = next;
      }
    }
    return value;
  }

  /** First module returning a non-undefined value wins. */
  first(hook, ...args) {
    for (const m of this.modules) {
      if (typeof m[hook] === 'function') {
        const out = m[hook](...args);
        if (out !== undefined) return out;
      }
    }
    return undefined;
  }

  /** Concatenate array results from all modules. */
  collect(hook, ...args) {
    const out = [];
    for (const m of this.modules) {
      if (typeof m[hook] === 'function') {
        const part = m[hook](...args);
        if (Array.isArray(part)) out.push(...part);
      }
    }
    return out;
  }
}

export const EMPTY_RULES = new RuleSet([]);
