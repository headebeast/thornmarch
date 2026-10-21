// Headless content loading for Node (tests, tooling, an authoritative server). Mirrors what the browser's
// AssetLoader does for data, minus images — proof the engine + modes have no DOM dependency.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ContentDatabase } from '../../public/js/data/contentDatabase.js';
import { FRONTIER_PACK } from '../../public/js/modes/frontier/content.js';
import { ROYALE_PACK } from '../../public/js/modes/royale/content.js';

export const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

const readJson = f => JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'data', f), 'utf8'));

export function loadDatabase({ frontier = true } = {}) {
  const db = new ContentDatabase();
  db.loadBase({
    tiles: readJson('tiles.json'),
    units: readJson('units.json'),
    abilities: readJson('abilities.json'),
    maps: readJson('maps.json'),
    autotile: readJson('autotile.json')
  });
  if (frontier) {
    db.registerPack(FRONTIER_PACK);
    db.registerPack(ROYALE_PACK);
  }
  return db;
}

/** Sound stub with the same surface as SoundManager. */
export const silentSound = { playSfx() {}, playPrompt() {}, playMusic() {}, stopMusic() {} };
