// Deterministic seeded RNG (mulberry32) — identical sequences on every platform and every client.
// All gameplay randomness (damage spread, ruin rewards, map generation) MUST go through this
// so online matches, replays and server-side validation can never drift apart.

export function hashSeed(input) {
  const str = String(input ?? '');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export class Rng {
  constructor(seed = 1) {
    this.state = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0;
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  /** Float in [0, 1). */
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p) {
    return this.next() < p;
  }

  pick(list) {
    return list[Math.floor(this.next() * list.length)];
  }

  shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Independent child generator so sub-systems don't perturb each other's sequences. */
  fork(label = '') {
    return new Rng(hashSeed(`${this.state}:${label}`));
  }
}
