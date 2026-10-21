// Movement profiles — each unit moves in its own way.
//
// A unit has (a) move points and (b) a *movement class* giving the cost of every terrain category. Special abilities
// (Flying, Crawler, Fighter of the Sea/Forest/Mountain, Pathfinder) still override on top, exactly like the original.
// Pure data + pure functions: no DOM, usable by the engine, UI and server alike.

export const TERRAINS = ['plains', 'road', 'forest', 'hill', 'mountain', 'water', 'structure'];

// Costs: plains, road, forest, hill/snowdrift, mountain, water, structure/bridge.  99 = cannot enter.
export const MOVE_CLASSES = {
  foot:     { name: 'Foot',        blurb: 'Marches steadily. Forests slow it, mountains and water more so.',          costs: [1, 1, 2, 2, 3, 3, 1] },
  light:    { name: 'Light foot',  blurb: 'Nimble: skips over hills and snowdrifts.',                                  costs: [1, 1, 2, 1, 3, 3, 1] },
  sylvan:   { name: 'Woodland',    blurb: 'At home in forests and hills; copes with mountains.',                       costs: [1, 1, 1, 1, 2, 3, 1] },
  heavy:    { name: 'Armoured',    blurb: 'Plate and weight: forests and hills drag, mountains and water are brutal.', costs: [1, 1, 3, 2, 4, 4, 1] },
  machine:  { name: 'War machine', blurb: 'Needs open ground or roads — cannot climb mountains or cross water.',       costs: [1, 1, 3, 3, 99, 99, 1] },
  mounted:  { name: 'Mounted',     blurb: 'Fast on open ground; forests, mountains and water cripple a horse.',        costs: [1, 1, 3, 2, 4, 4, 1] },
  cavalry:  { name: 'Heavy cavalry', blurb: 'Devastating on plains and roads, but nearly stuck in rough country.',     costs: [1, 1, 3, 3, 5, 5, 1] },
  beast:    { name: 'Beast',       blurb: 'Pads through forests and hills without slowing; wades water reluctantly.',  costs: [1, 1, 1, 1, 2, 3, 1] },
  aquatic:  { name: 'Aquatic',     blurb: 'Glides through water; slower on land.',                                     costs: [1, 1, 2, 2, 3, 1, 1] },
  amphibious: { name: 'Amphibious', blurb: 'Oozes through water and over land at a steady crawl.',                      costs: [1, 1, 2, 2, 3, 2, 1] },
  flyer:    { name: 'Flying',      blurb: 'Ignores terrain entirely — and passes over ground enemies.',                costs: [1, 1, 1, 1, 1, 1, 1] }
};

/** Base-game units by index -> [class, enhanced move points]. Frontier units declare `moveClass` on the pack. */
export const BASE_UNIT_MOVEMENT = {
  0: ['foot', 4],      // Soldier
  1: ['light', 5],     // Archer — skirmisher
  2: ['aquatic', 4],   // Aqua Elemental
  3: ['light', 4],     // Sorceress — light robes, glides over drifts
  4: ['flyer', 5],     // Spirit
  5: ['beast', 7],     // Wolf
  6: ['heavy', 3],     // Golem — slow giant (its mountain skill still applies)
  7: ['machine', 3],   // Catapult
  8: ['flyer', 8],     // Dragon — the furthest-reaching unit on any terrain
  9: ['foot', 4],      // Commander
  10: ['foot', 3],     // Skeleton
  12: ['heavy', 4],    // Paladin
  13: ['foot', 5],     // Berserker — frenzied (crawler skill still applies)
  14: ['flyer', 5],    // Ghost
  15: ['foot', 4],     // Black Mage
  16: ['beast', 6],    // Wolfarcher
  17: ['aquatic', 4],  // Ice Elemental
  18: ['amphibious', 3] // Slime
};

/** Terrain names shown to the player per theme. */
export const TERRAIN_NAMES = {
  frost: { plains: 'Snowfield', road: 'Road', forest: 'Pine forest', hill: 'Snowdrift', mountain: 'Ice crag', water: 'Icy water', structure: 'Building' },
  meadow: { plains: 'Grassland', road: 'Road', forest: 'Forest', hill: 'Hills', mountain: 'Mountain', water: 'Water', structure: 'Building' }
};

const cache = new WeakMap();

/** Terrain category of a tile index (cached per content database). */
export function terrainOf(db, tileIndex) {
  let c = cache.get(db);
  if (!c) {
    c = { terrain: [], roads: new Set([...(db.autotile?.road || []).map(r => r.index), 28, 29]) };
    cache.set(db, c);
  }
  if (c.terrain[tileIndex] !== undefined) return c.terrain[tileIndex];
  const t = db.getTile(tileIndex);
  let k;
  if (c.roads.has(tileIndex)) k = 'road';
  else if (t.isCastle || t.isVillage || t.building || t.isTemple) k = 'structure';
  else if (t.type === 1) k = 'water';
  else if (t.type === 2) k = 'forest';
  else if (t.type === 3) k = 'mountain';
  else if (t.stepCost >= 2) k = 'hill';
  else k = 'plains';
  c.terrain[tileIndex] = k;
  return k;
}

/** Movement class + enhanced move points for a unit template. */
export function movementOf(tpl) {
  if (tpl.moveClass) return { cls: tpl.moveClass, mp: tpl.movement_point };
  const base = BASE_UNIT_MOVEMENT[tpl.index];
  return base ? { cls: base[0], mp: base[1] } : { cls: 'foot', mp: tpl.movement_point };
}

export function classCost(cls, terrain) {
  const row = (MOVE_CLASSES[cls] || MOVE_CLASSES.foot).costs;
  return row[TERRAINS.indexOf(terrain)] ?? 1;
}
