// Content database — tiles, units, abilities and maps, with *content packs*.
//
// DOM-free: the browser loader, a Node test harness, a worker or a server can all build one.
// A content pack is plain data that appends new abilities / units / tiles after the base game's, so a
// mode (Frontier, a future DLC, a user mod) ships its content without touching the core tables.
//
// Pack format
//   { id, abilities:[{id, name, description}], units:[{key, ...unit fields}],
//     tiles:[{key, ...tile fields, capturedKeys:[k0,k1,k2,k3,kNeutral], destroyedKey, repairedKey}] }
// registerPack() assigns final indexes, resolves *Key references, and returns lookup tables.

export class ContentDatabase {
  constructor() {
    this.tiles = [];
    this.units = [];
    this.unitConfig = null;
    this.abilities = [];
    this.maps = [];
    this.autotile = null;
    this.packs = new Map(); // id -> { pack, refs }
  }

  loadBase({ tiles, units, abilities, maps = [], autotile = null }) {
    this.tiles = tiles;
    this.unitConfig = units.config;
    this.units = units.units;
    this.abilities = abilities;
    this.maps = maps;
    this.autotile = autotile;
    this.baseCounts = { tiles: tiles.length, units: units.units.length, abilities: abilities.length };
    return this;
  }

  registerPack(pack) {
    if (this.packs.has(pack.id)) return this.packs.get(pack.id).refs;
    const refs = { abilities: {}, units: {}, tiles: {} };

    for (const a of pack.abilities || []) {
      if (a.id !== this.abilities.length) {
        throw new Error(`Pack "${pack.id}": ability "${a.name}" expects id ${a.id} but next free id is ${this.abilities.length}`);
      }
      this.abilities.push({ id: a.id, name: a.name, description: a.description });
      refs.abilities[a.key || a.name] = a.id;
    }

    for (const u of pack.units || []) {
      const index = this.units.length;
      this.units.push({ ...u, index, pack: pack.id });
      refs.units[u.key] = index;
    }

    // Tiles: assign indexes first so definitions can reference each other by key
    const firstTile = this.tiles.length;
    (pack.tiles || []).forEach((t, i) => {
      refs.tiles[t.key] = firstTile + i;
    });
    const resolve = key => {
      if (key === undefined || key === null) return -1;
      if (typeof key === 'number') return key;
      if (refs.tiles[key] === undefined) throw new Error(`Pack "${pack.id}": unknown tile key "${key}"`);
      return refs.tiles[key];
    };
    for (const t of pack.tiles || []) {
      const def = {
        defenceBonus: 0,
        stepCost: 1,
        hpRecovery: 0,
        type: 0,
        topTileIndex: -1,
        team: -1,
        accessTileList: [],
        isCapturable: false,
        isDestroyable: false,
        isRepairable: false,
        isAnimated: false,
        miniMapIndex: 0,
        isCastle: false,
        isVillage: false,
        isTemple: false,
        ...t,
        index: refs.tiles[t.key],
        pack: pack.id,
        capturedTileList: (t.capturedKeys || []).map(resolve),
        destroyedTileIndex: resolve(t.destroyedKey),
        repairedTileIndex: resolve(t.repairedKey),
        animationTileIndex: resolve(t.animationKey)
      };
      this.tiles.push(def);
    }

    this.packs.set(pack.id, { pack, refs });
    return refs;
  }

  getTile(index) {
    return this.tiles[index] || this.tiles[0];
  }

  getUnitTemplate(index) {
    return this.units[index] || this.units[0];
  }

  getAbility(id) {
    return this.abilities[id] || { id, name: `Ability ${id}`, description: '' };
  }

  packRefs(id) {
    return this.packs.get(id)?.refs || null;
  }
}
