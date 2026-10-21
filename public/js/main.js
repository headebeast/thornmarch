// Entry point. Everything interesting lives in app/App.js (composition root) and the platform-agnostic core.

import { App } from './app/App.js';
import { deploy } from './config/deploy.js';

let app = null;

window.addEventListener('DOMContentLoaded', () => {
  app = new App();
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

// Offline / installable — only for a built release (`npm run build` stamps a version; the unbuilt dev page says "dev"), so
// development never meets a stale cache. A new release installs in the background; at the menu it takes over with a quick
// reload, mid-match it waits so nobody loses a game.
if ('serviceWorker' in navigator && window.isSecureContext && deploy.version !== 'dev') {
  navigator.serviceWorker
    .register('/sw.js')
    .then(reg => {
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state !== 'installed' || !navigator.serviceWorker.controller) return;
          if (app?.match) return app.hud?.toast('A new version is ready — it loads when you are back at the menu.', 'good');
          navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
          worker.postMessage('skipWaiting');
        });
      });
    })
    .catch(() => {});
}
