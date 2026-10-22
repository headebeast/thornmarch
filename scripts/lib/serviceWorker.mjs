// Builds the service worker from its parts (pwa/sw/*.js, joined in file-name order) and fills in the build's values.
// Used by scripts/build.mjs and by the tests, so what is tested is exactly what ships.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SW_PARTS_DIR = path.join(ROOT, 'pwa', 'sw');

/** The page ↔ worker vocabulary, from the single source the page also imports. */
export async function loadProtocol() {
  return import(pathToFileURL(path.join(ROOT, 'public/js/pwa/protocol.js')).href);
}

export const swParts = (dir = SW_PARTS_DIR) =>
  fs
    .readdirSync(dir)
    .filter(f => f.endsWith('.js'))
    .sort()
    .map(f => ({ name: f, source: fs.readFileSync(path.join(dir, f), 'utf8') }));

/** A short fingerprint of the worker's own code, so changing only the worker still counts as a new build. */
export function swFingerprint(dir = SW_PARTS_DIR) {
  const h = crypto.createHash('sha256');
  for (const p of swParts(dir)) h.update(p.name).update(p.source);
  return h.digest('hex').slice(0, 16);
}

/**
 * @param {object} o
 * @param {string} o.version    cache name for this build ('aeii-<hash>')
 * @param {string} o.build      human version ('2.1.0+<hash>')
 * @param {string} o.media      music cache name
 * @param {string[]} o.precache URLs downloaded at install
 * @param {string} [o.note]     one-line release note
 */
export async function composeServiceWorker({ version, build, media, precache, note = '', dir = SW_PARTS_DIR }) {
  const { SW_MESSAGE, CACHE_PREFIX } = await loadProtocol();
  const values = { VERSION: version, BUILD: build, NOTE: note, MEDIA: media, PRECACHE: precache, MESSAGES: SW_MESSAGE, CACHE_PREFIX };
  const used = new Set();
  const source = swParts(dir)
    .map(p => p.source.replace(/__AEII_([A-Z_]+)__/g, (all, key) => {
      if (!(key in values)) throw new Error(`service worker part ${p.name} asks for unknown value ${all}`);
      used.add(key);
      return JSON.stringify(values[key]);
    }))
    .join('\n');
  for (const key of Object.keys(values)) if (!used.has(key)) throw new Error(`service worker never uses build value ${key} — a part lost its placeholder`);
  if (!version.startsWith(CACHE_PREFIX) || !media.startsWith(CACHE_PREFIX)) throw new Error(`cache names must start with "${CACHE_PREFIX}"`);
  return source;
}
