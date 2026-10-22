// The words the page and the service worker use to talk to each other — ONE definition. The page imports it, and
// scripts/build.mjs injects the very same values into the generated worker, so the two sides can never drift apart.

export const SW_MESSAGE = Object.freeze({
  /** page → waiting worker: "the player agreed — take over now". */
  SKIP_WAITING: 'aeii:skip-waiting',
  /** page → worker (with a MessageChannel port): "which build are you?" The worker answers { version, cache, note }. */
  GET_INFO: 'aeii:get-info'
});

/** Every cache this game creates starts with this, so the worker can tell its own caches from anyone else's. */
export const CACHE_PREFIX = 'aeii-';
