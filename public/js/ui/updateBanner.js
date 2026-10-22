// The "update available" banner. A small card under the top bar: what is ready, [Update] and [Later ▾].
//
//   [Update]  → asks the controller to apply — which ALWAYS opens the confirmation first (ui/updateConfirm.js).
//   [Later]   → opens the snooze choices (30 minutes · 1 hour · next time I open the game); picking one hides the banner,
//               and the controller brings it back when the time comes.
//
// It never takes keyboard focus on its own (the player may be mid-move) and never blocks the game. All it knows is the
// controller's `view`; every rule lives in pwa/updateController.js.

import { h, clear } from './dom.js';
import { glyph } from './icons.js';
import { describeVersion } from '../pwa/version.js';

export class UpdateBanner {
  /**
   * @param {{controller: import('../pwa/updateController.js').UpdateController,
   *          anchor?: () => Element | null,       the top bar: the banner sits just under it (and at the top when it is hidden)
   *          notify?: (text: string) => void}} o  where "I'll remind you in…" confirmations go (a toast)
   */
  constructor({ controller, anchor = () => null, notify = () => {} }) {
    this.controller = controller;
    this.anchor = anchor;
    this.notify = notify;
    this.pickingSnooze = false;
    this.shown = false;

    this.title = h('div', { class: 'ub-title' });
    this.detail = h('div', { class: 'ub-detail' });
    this.note = h('div', { class: 'ub-note' });
    this.error = h('div', { class: 'ub-error', role: 'alert' });
    this.updateBtn = h('button', { class: 'btn btn-gold btn-sm', onclick: () => this.update() });
    this.laterBtn = h('button', { class: 'btn btn-sm', 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: () => this.toggleSnooze() }, 'Later');
    this.choices = h('div', { class: 'ub-choices hidden', role: 'group', 'aria-label': 'Remind me again' });
    this.node = h(
      'section',
      { class: 'update-banner plate hidden', role: 'status', 'aria-live': 'polite', 'aria-label': 'Update available' },
      h('div', { class: 'ub-icon' }, glyph('download', 3)),
      h('div', { class: 'ub-text' }, this.title, this.detail, this.note, this.error),
      h('div', { class: 'ub-actions' }, this.updateBtn, this.laterBtn),
      this.choices
    );
    this.node.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.pickingSnooze) {
        e.stopPropagation();
        this.toggleSnooze(false);
        this.laterBtn.focus();
      }
    });
    document.body.appendChild(this.node);

    // keep clear of the top bar wherever it is (it wraps, hides in menus, grows on phones)
    window.addEventListener('resize', () => this.reposition());
    const target = this.anchor();
    if (target && typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.reposition()).observe(target);

    controller.on('change', view => this.render(view));
    this.render(controller.view);
  }

  render(view) {
    const reload = view.kind === 'reload';
    const visible = view.visible || view.applying;
    this.title.textContent = reload ? 'Updated in another window' : 'Update available';
    this.node.setAttribute('aria-label', this.title.textContent);
    this.detail.textContent = reload
      ? 'This window is still running the old version. Reload it to finish updating.'
      : view.next
        ? `${describeVersion(view.next)} is ready. You are on ${describeVersion(view.current)}.`
        : 'A new version of the game is ready.';
    this.note.textContent = view.note || '';
    this.note.classList.toggle('hidden', !view.note);
    this.error.textContent = view.error || '';
    this.error.classList.toggle('hidden', !view.error);
    this.updateBtn.textContent = view.applying ? 'Updating…' : reload ? 'Reload' : 'Update';
    this.updateBtn.disabled = view.applying;
    this.laterBtn.disabled = view.applying;
    if (!visible || view.applying) this.toggleSnooze(false);
    this.fillChoices(view);
    this.setShown(visible);
  }

  fillChoices(view) {
    clear(this.choices);
    this.choices.append(h('span', { class: 'ub-choices-label' }, 'Remind me in'));
    for (const o of view.options) {
      this.choices.append(h('button', { class: 'btn btn-sm', onclick: () => this.snooze(o) }, o.label));
    }
  }

  setShown(visible) {
    if (visible === this.shown) return;
    this.shown = visible;
    if (!visible) {
      this.node.classList.remove('is-in');
      this.node.classList.add('hidden');
      return;
    }
    this.reposition();
    this.node.classList.remove('hidden');
    void this.node.offsetWidth; // let the browser see the starting position so the slide-in animates
    this.node.classList.add('is-in');
  }

  reposition() {
    const r = this.anchor()?.getBoundingClientRect();
    const top = r && r.height > 0 ? r.bottom + 8 : 10;
    this.node.style.top = `calc(${Math.round(top)}px + var(--safe-t, 0px))`;
  }

  // ---- actions -----------------------------------------------------------------------------------------------------
  async update() {
    this.updateBtn.disabled = true; // one press at a time; the confirmation dialog is next
    try {
      await this.controller.requestApply();
    } finally {
      this.render(this.controller.view);
    }
  }

  toggleSnooze(open = !this.pickingSnooze) {
    this.pickingSnooze = open;
    this.choices.classList.toggle('hidden', !open);
    this.laterBtn.setAttribute('aria-expanded', String(open));
    this.reposition();
  }

  snooze(option) {
    this.toggleSnooze(false);
    this.controller.snooze(option.id);
    this.notify(option.launch ? 'Okay — I will remind you the next time you open the game.' : `Okay — I will remind you in ${option.label}.`);
  }
}
