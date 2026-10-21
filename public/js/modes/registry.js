// Game-mode registry. A mode is a self-contained object:
//   { id, name, tagline, description, contentPacks?, art?, setup:[field…], createMatch(config, db) -> Match }
// The app never hard-codes a mode: the menu, the setup screen (built from `setup`), the HUD widgets and the
// AI all come from the registered definition, so a new mode (or a mod) is one file + one registerMode() call.
//
// Match = {
//   modeId, title, mapData, rules:RuleSet, options:{mode,startGold,maxPop,seed},
//   playerConfig:{team:'LOCAL'|'AI'}, createAI(game), view:{ theme, focus:'commander'|'fit' }
// }

const modes = new Map();

export function registerMode(def) {
  if (!def?.id) throw new Error('Mode needs an id');
  modes.set(def.id, def);
  return def;
}

export function getMode(id) {
  return modes.get(id) || null;
}

export function listModes() {
  return Array.from(modes.values());
}

/** Register every content pack declared by registered modes into a ContentDatabase (idempotent). */
export function installModeContent(db) {
  for (const m of modes.values()) for (const p of m.contentPacks || []) db.registerPack(p);
}
