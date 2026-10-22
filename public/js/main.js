// Entry point. Everything interesting lives in app/App.js (composition root) and the platform-agnostic core.

import { App } from './app/App.js';
import { createPwa } from './pwa/pwa.js';

let app = null;

// The installable-app layer (service worker, update checks) starts BEFORE the game: if a release ever fails to start, a fixed
// release can still be found and switched to, instead of the player being stuck on a broken cached copy.
const pwa = createPwa();
pwa.start();

window.addEventListener('DOMContentLoaded', () => {
  app = new App({ pwa });
  window.__aeii = app; // handy for debugging & automated tests
  app
    .start()
    .then(() => {
      window.__aeiiBooted = true;
    })
    .catch(err => {
      console.error(err);
      window.__aeiiBooted = true; // the watchdog has nothing to add: we are reporting the real reason
      const text = `Failed to start: ${err?.message || err}`;
      if (window.__aeiiBootFailed) window.__aeiiBootFailed(text);
      else document.getElementById('loading-status')?.append(text);
      pwa.recoverFromBootFailure().catch(() => {}); // a newer build may already fix it: nothing is running, so nothing can be lost
    });
});

// A bug in one corner of the UI should be visible and recoverable, not a silent freeze. Throttled so a loop cannot spam.
let lastWarn = 0;
const report = (what, err) => {
  console.error(what, err);
  const now = Date.now();
  if (!app?.hud || now - lastWarn < 10000) return;
  lastWarn = now;
  app.hud.toast('Something went wrong. If the game misbehaves, reload the page — your saved progress is kept.', 'warn');
};
window.addEventListener('error', e => report('Uncaught error:', e.error || e.message));
window.addEventListener('unhandledrejection', e => report('Unhandled rejection:', e.reason));
