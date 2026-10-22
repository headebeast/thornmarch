// Composition root of the PWA layer: builds the update manager / controller / install manager and wires them to the real
// browser. The page's UI pieces (ui/updateBanner.js …) receive the object this returns. main.js creates it BEFORE the game
// starts, so a build that fails to start can still be replaced by a fixed one (see recoverFromBootFailure).

import { platform } from '../platform/platform.js';
import { deploy } from '../config/deploy.js';
import { UpdateManager } from './updateManager.js';
import { UpdateController } from './updateController.js';
import { InstallManager } from './installManager.js';
import { SnoozeStore, makeLaunchId } from './snooze.js';

/** Service workers need a secure origin and a built release (the unbuilt dev page is "dev" and never registers one). */
export const pwaEnabled = () => typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator && deploy.version !== 'dev';

export function createPwa({ enabled = pwaEnabled(), version = deploy.version, storage = platform.storage, session = typeof sessionStorage === 'undefined' ? null : sessionStorage } = {}) {
  const manager = new UpdateManager({ currentVersion: version, enabled });
  const snooze = new SnoozeStore({ storage, launchId: makeLaunchId(session) });
  const updates = new UpdateController({ manager, snooze });
  const install = new InstallManager();
  let started = false;

  return {
    manager,
    updates,
    install,

    start() {
      if (started) return;
      started = true;
      install.start();
      updates.start();
      // timers sleep in background tabs: when the player comes back, a snooze that ended meanwhile must show again
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && updates.refresh());
      manager.start().catch(err => console.error('[pwa] could not start:', err)); // the game must run even if this layer cannot
    },

    /**
     * The game itself failed to start. If a newer build is waiting (or can be found), switch to it at once — nothing is lost
     * because nothing was running — instead of leaving the player stuck on a broken cached copy forever.
     */
    recoverFromBootFailure() {
      return manager.recover();
    }
  };
}
