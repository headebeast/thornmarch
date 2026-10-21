// Session documents in Netlify Blobs (a key-value store that comes with every Netlify site — nothing to set up).
// Same four calls as the other stores in analytics/stores.mjs. Keys are "<day>/<sid>".

import { getStore } from '@netlify/blobs';

const CHUNK = 25; // documents fetched in parallel

export class BlobStore {
  constructor(name = 'analytics') {
    this.store = getStore({ name, consistency: 'strong' }); // read-your-writes: a session's second batch must see its first
  }

  async get(day, sid) {
    return (await this.store.get(`${day}/${sid}`, { type: 'json' })) ?? null;
  }

  async put(day, sid, doc) {
    await this.store.setJSON(`${day}/${sid}`, doc);
  }

  async list(days) {
    const out = [];
    for (const day of days) {
      const { blobs } = await this.store.list({ prefix: `${day}/` });
      for (let i = 0; i < blobs.length; i += CHUNK) {
        const docs = await Promise.all(blobs.slice(i, i + CHUNK).map(b => this.store.get(b.key, { type: 'json' }).catch(() => null)));
        for (const d of docs) if (d) out.push(d);
      }
    }
    return out;
  }

  async remove(day, sid) {
    await this.store.delete(`${day}/${sid}`);
  }
}
