// "Install app" — one small button (shown only when installing is actually possible) and the iPhone/iPad instructions.
// Used by the main menu's footer and by Settings; both get their own button from createInstallButton().

import { h } from './dom.js';
import { glyph } from './icons.js';
import { Modal } from './modal.js';

/** iOS Safari cannot be asked to install: show the three taps instead. */
export function showIosInstallHelp() {
  const modal = new Modal({ title: 'Add to Home Screen', width: 420, disposable: true });
  modal.body.append(
    h('ol', { class: 'install-steps' },
      h('li', null, 'Tap the ', h('b', null, 'Share'), ' button in Safari (the square with an arrow, in the bottom or top bar).'),
      h('li', null, 'Scroll down and tap ', h('b', null, 'Add to Home Screen'), '.'),
      h('li', null, 'Tap ', h('b', null, 'Add'), '. The game now opens full screen from its own icon, and keeps working offline.')
    ),
    h('button', { class: 'btn btn-gold', onclick: () => modal.destroy() }, 'Got it')
  );
  modal.open();
}

/** What pressing Install does for this device. */
export async function runInstall(install, notify = () => {}) {
  if (install.mode === 'ios') return showIosInstallHelp();
  const outcome = await install.prompt();
  if (outcome === 'accepted') notify('Installing — look for the game on your home screen or desktop.');
}

/**
 * A button that shows itself only when there is something to install.
 * @param {import('../pwa/installManager.js').InstallManager} install
 */
export function createInstallButton({ install, notify, label = 'Install app', className = 'btn btn-sm' }) {
  const node = h('button', { class: className, onclick: () => runInstall(install, notify) }, glyph('download', 2), label);
  const refresh = () => node.classList.toggle('hidden', !(install.mode === 'prompt' || install.mode === 'ios'));
  install.on('change', refresh);
  refresh();
  return { node, refresh };
}
