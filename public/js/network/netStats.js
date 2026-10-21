// Connection quality, measured the only honest way a web page can.
//
// A browser WebSocket runs over TCP, which hides raw packet loss by re-sending lost packets — the player just feels it as a
// stall. So "packet loss" here is probe loss: the client sends a tiny PING every couple of seconds, the server answers PONG,
// and a probe whose answer has not come back within `timeoutMs` counts as lost. That is exactly what matters to a player:
// how long messages take (ping), how much that varies (jitter) and how often the line stalls or drops (loss).
// Pure maths on timestamps — no DOM, no sockets — so it is unit-tested.

export class NetStats {
  constructor({ keep = 30, timeoutMs = 3000 } = {}) {
    this.keep = keep; // how many recent probes the figures are based on
    this.timeoutMs = timeoutMs;
    this.reset();
  }

  reset() {
    this.pending = new Map(); // probe id -> time sent
    this.rtts = []; // round-trip times of answered probes (ms)
    this.history = []; // true = answered, false = lost (most recent last)
    this.lastReply = null;
  }

  sent(id, now) {
    this.pending.set(id, now);
  }

  /** An answer arrived. Returns the round-trip time, or null if that probe was already written off. */
  received(id, now) {
    const t = this.pending.get(id);
    if (t === undefined) return null;
    this.pending.delete(id);
    const rtt = Math.max(0, now - t);
    this.history.push(true);
    this.rtts.push(rtt);
    if (this.history.length > this.keep) this.history.shift();
    if (this.rtts.length > this.keep) this.rtts.shift();
    this.lastReply = now;
    return rtt;
  }

  /** Write off probes that have waited too long. Call it whenever a new probe is sent. */
  sweep(now) {
    for (const [id, t] of this.pending) {
      if (now - t <= this.timeoutMs) continue;
      this.pending.delete(id);
      this.history.push(false);
      if (this.history.length > this.keep) this.history.shift();
    }
  }

  snapshot(now = 0) {
    const n = this.rtts.length;
    const ping = n ? this.rtts.reduce((a, b) => a + b, 0) / n : null;
    let jitter = null;
    if (n > 1) {
      let sum = 0;
      for (let i = 1; i < n; i++) sum += Math.abs(this.rtts[i] - this.rtts[i - 1]);
      jitter = sum / (n - 1);
    }
    const lost = this.history.filter(ok => !ok).length;
    const loss = this.history.length ? (lost / this.history.length) * 100 : 0;
    const silent = this.lastReply !== null && now - this.lastReply > this.timeoutMs; // nothing back for a while
    return { ping, last: n ? this.rtts[n - 1] : null, jitter, loss, samples: this.history.length, silent, quality: NetStats.quality(ping, loss, silent) };
  }

  /** 'good' | 'fair' | 'poor' | 'none' */
  static quality(ping, loss, silent = false) {
    if (ping === null) return 'none';
    if (silent || loss >= 5 || ping >= 250) return 'poor';
    if (loss >= 1 || ping >= 100) return 'fair';
    return 'good';
  }
}
