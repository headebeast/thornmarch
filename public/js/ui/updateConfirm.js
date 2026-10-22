// "Update now?" — the confirmation that stands between a click and a reload. It resolves true ONLY for the confirm
// button; Cancel, Esc, the close button and a click outside all resolve false and change nothing.
//
// It says plainly what a reload would cost: if the player is in the middle of a match or the map editor, that is named
// (matches are not saved, the editor keeps maps only when Save is pressed) and the safe button, Cancel, has the focus.

import { h, append } from './dom.js';
import { Modal } from './modal.js';
import { describeVersion } from '../pwa/version.js';

export class UpdateConfirm {
  /** @param {import('../pwa/updateController.js').UpdateController['view']} view  @returns {Promise<boolean>} */
  ask(view) {
    return new Promise(resolve => {
      const reload = view.kind === 'reload';
      const busy = view.busy?.busy;
      let answered = false;
      const answer = value => {
        if (answered) return;
        answered = true;
        resolve(value);
        modal.destroy();
      };

      const cancel = h('button', { class: 'btn', onclick: () => answer(false) }, 'Cancel');
      const confirm = h('button', { class: `btn ${busy ? 'btn-danger' : 'btn-gold'}`, onclick: () => answer(true) }, reload ? 'Reload now' : 'Update and reload');
      const modal = new Modal({
        title: reload ? 'Reload the game?' : 'Update the game now?',
        width: 480,
        disposable: true,
        footer: [cancel, confirm],
        onClose: () => answer(false) // Esc, the X, a click outside
      });

      const target = view.next ? `to ${describeVersion(view.next)}` : 'to the new version';
      append(modal.body, [ // (the project's append skips empty children; the native one would print "null")
        h('p', { class: 'uc-lead' }, reload ? 'The game will reload to finish updating.' : `The game will reload and switch ${target}.`),
        view.note ? h('p', { class: 'uc-note' }, view.note) : null,
        busy ? h('div', { class: 'uc-warn', role: 'alert' }, h('b', null, 'Heads up. '), view.busy.text, ' It cannot be brought back after the reload.') : h('p', { class: 'uc-ok' }, 'Your settings and any maps you saved in the editor are kept.'),
        busy ? h('p', { class: 'uc-hint' }, 'Not now? Press Cancel and choose Later — the update waits.') : null
      ]);
      modal.open();
      (busy ? cancel : confirm).focus({ preventScroll: true }); // when something would be lost, the safe button is the one Enter presses
    });
  }
}
