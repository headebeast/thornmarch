// The "App & updates" part of the Settings box: install status, offline readiness, which build is running, a
// "Check for updates" button, and — whenever an update is waiting — the same Update / Remind-me controls as the banner,
// so a snoozed update is never out of reach.

import { h } from './dom.js';
import { createInstallButton } from './installControl.js';
import { describeVersion } from '../pwa/version.js';

const clock = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** @param {{pwa: ReturnType<import('../pwa/pwa.js').createPwa>, notify?: (text: string) => void}} o  @returns {{node: HTMLElement, refresh: () => void}} */
export function buildPwaSettings({ pwa, notify = () => {} }) {
  const { updates, install } = pwa;

  const installLine = h('div', { class: 'note' });
  const installBtn = createInstallButton({ install, notify, label: 'Install app', className: 'btn btn-sm btn-gold' });
  const offlineLine = h('div', { class: 'note' });

  const versionLine = h('div', { class: 'ps-version' });
  const statusLine = h('div', { class: 'note', 'aria-live': 'polite' });
  const checkBtn = h('button', { class: 'btn btn-sm', onclick: () => check() }, 'Check for updates');
  const updateBtn = h('button', { class: 'btn btn-sm btn-gold', onclick: () => updates.requestApply() }, 'Update now…');
  const remindBtn = h('button', { class: 'btn btn-sm', onclick: () => updates.remindNow() }, 'Remind me now');
  async function check() {
    await updates.check();
    refresh();
  }

  function status(v) {
    if (!v.supported) return 'Updates are handled by your browser here (this is a development copy, or your browser cannot install updates in the background).';
    if (v.applying) return 'Updating…';
    if (v.checking) return 'Checking…';
    if (v.kind === 'reload' && v.available) return v.snoozed ? 'This window needs a reload — the reminder is snoozed.' : 'Another window already updated — reload this one to finish.';
    if (v.available) {
      const what = v.next ? `${describeVersion(v.next)} is ready.` : 'A new version is ready.';
      const s = v.snoozed;
      if (!s) return `${what}${v.note ? ` ${v.note}` : ''}`;
      return `${what} Reminder snoozed ${s.until ? `until ${clock(s.until)}` : 'until the next time you open the game'}.`;
    }
    if (v.error) return v.error;
    return v.checkedAt ? `You have the newest version. Last checked ${clock(v.checkedAt)}.` : 'Updates download in the background and are never installed without asking.';
  }

  function refresh() {
    const v = updates.view;
    const mode = install.mode;
    installLine.textContent =
      mode === 'installed' ? 'Installed: the game opens in its own window from its icon.' : mode === 'prompt' ? 'Install the game for its own icon, window and full-screen play.' : mode === 'ios' ? 'On iPhone and iPad: Share → Add to Home Screen.' : 'Your browser can install this game from its menu (look for “Install” or “Add to Home screen”).';
    offlineLine.textContent = v.offlineReady ? 'Offline play: ready — the whole game is stored on this device. (Music is saved the first time it plays.)' : v.supported ? 'Offline play: ready after the next full load.' : 'Offline play: not available in this copy.';
    versionLine.textContent = `You have ${describeVersion(v.current)}`;
    statusLine.textContent = status(v);
    checkBtn.disabled = !v.supported || v.checking || v.applying;
    checkBtn.textContent = v.checking ? 'Checking…' : 'Check for updates';
    updateBtn.classList.toggle('hidden', !v.available);
    updateBtn.disabled = v.applying;
    updateBtn.textContent = v.kind === 'reload' ? 'Reload now…' : 'Update now…';
    remindBtn.classList.toggle('hidden', !v.snoozed);
    installBtn.refresh();
  }

  updates.on('change', refresh);
  install.on('change', refresh);
  refresh();

  const row = (...kids) => h('div', { class: 'ps-row' }, ...kids);
  const node = h('div', { class: 'ps' }, h('div', { class: 'field' }, installLine, row(installBtn.node), offlineLine), h('div', { class: 'field' }, versionLine, statusLine, row(checkBtn, updateBtn, remindBtn)));
  return { node, refresh };
}
