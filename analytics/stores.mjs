// Where session documents live. Every store offers the same four calls, so the handlers do not care which one they get:
//   get(day, sid) · put(day, sid, doc) · list(days[]) → doc[] · remove(day, sid)
// MemoryStore: tests and tiny experiments. FileStore: one JSON file per session under <dir>/<day>/ (the Node server).
// The Netlify deployment has its own, backed by Netlify Blobs (netlify/lib/blobStore.mjs).

import fs from 'node:fs/promises';
import path from 'node:path';

export class MemoryStore {
  constructor() {
    this.docs = new Map(); // `${day}/${sid}` -> doc
  }
  async get(day, sid) {
    const d = this.docs.get(`${day}/${sid}`);
    return d ? structuredClone(d) : null;
  }
  async put(day, sid, doc) {
    this.docs.set(`${day}/${sid}`, structuredClone(doc));
  }
  async list(days) {
    const out = [];
    for (const [key, doc] of this.docs) if (days.includes(key.split('/')[0])) out.push(structuredClone(doc));
    return out;
  }
  async remove(day, sid) {
    this.docs.delete(`${day}/${sid}`);
  }
}

const SAFE = /^[A-Za-z0-9-]+$/;

export class FileStore {
  constructor(dir) {
    this.dir = dir;
  }
  file(day, sid) {
    if (!SAFE.test(day) || !SAFE.test(sid)) throw new Error('bad key'); // never let an id walk out of the data folder
    return path.join(this.dir, day, `${sid}.json`);
  }
  async get(day, sid) {
    try {
      return JSON.parse(await fs.readFile(this.file(day, sid), 'utf8'));
    } catch {
      return null;
    }
  }
  async put(day, sid, doc) {
    const f = this.file(day, sid);
    await fs.mkdir(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(doc)); // write whole, then rename: a crash never leaves half a document
    await fs.rename(tmp, f);
  }
  async list(days) {
    const out = [];
    for (const day of days) {
      let names = [];
      try {
        names = await fs.readdir(path.join(this.dir, day));
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        try {
          out.push(JSON.parse(await fs.readFile(path.join(this.dir, day, name), 'utf8')));
        } catch {
          /* a half-written or damaged file is skipped, never fatal */
        }
      }
    }
    return out;
  }
  async remove(day, sid) {
    await fs.rm(this.file(day, sid), { force: true });
  }
}
