// A tiny event emitter. A listener that throws is reported and skipped — it never stops the others (or the game).

export class Emitter {
  constructor() {
    this.handlers = new Map();
  }

  /** Subscribe; returns the function that unsubscribes. */
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }

  emit(type, payload) {
    for (const fn of [...(this.handlers.get(type) || [])]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[pwa] listener for "${type}" failed:`, err);
      }
    }
  }
}
