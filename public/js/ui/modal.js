// Modal windows: stepped-corner plate, Esc / backdrop to close, focus restored on close.

import { h, show } from './dom.js';
import { glyph } from './icons.js';

const stack = [];

export class Modal {
  /**
   * @param {{title:string, width?:number, onClose?:Function, dismissable?:boolean, footer?:Node[], disposable?:boolean}} opts
   *   `disposable`: a one-off dialog — its DOM is removed when it closes (otherwise every use would leave a hidden copy behind)
   */
  constructor({ title, width = 880, onClose = null, dismissable = true, footer = null, disposable = false } = {}) {
    this.disposable = disposable;
    this.onClose = onClose;
    this.dismissable = dismissable;
    this.title = h('h3', null, title);
    this.closeBtn = dismissable
      ? h('button', { class: 'btn btn-icon btn-sm', 'aria-label': 'Close', onclick: () => this.close() }, glyph('close', 2))
      : null;
    this.body = h('div', { class: 'modal-body' });
    this.footer = footer ? h('div', { class: 'modal-foot' }, ...footer) : null;
    this.headExtra = h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } });
    this.window = h(
      'div',
      { class: 'modal plate', style: { '--w': `${width}px` }, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-head' }, this.title, this.headExtra, this.closeBtn),
      this.body,
      this.footer
    );
    this.backdrop = h('div', { class: 'modal-backdrop hidden' }, this.window);
    this.backdrop.addEventListener('pointerdown', e => {
      if (e.target === this.backdrop && this.dismissable) this.close();
    });
    document.body.appendChild(this.backdrop);
    this.opener = null;
  }

  get isOpen() {
    return !this.backdrop.classList.contains('hidden');
  }

  open() {
    this.opener = document.activeElement;
    show(this.backdrop, true);
    stack.push(this);
    this.window.querySelector('button, input, select')?.focus?.({ preventScroll: true });
    return this;
  }

  close() {
    if (!this.isOpen) return;
    show(this.backdrop, false);
    const i = stack.indexOf(this);
    if (i >= 0) stack.splice(i, 1);
    this.opener?.focus?.({ preventScroll: true });
    this.onClose?.();
    if (this.disposable) this.backdrop.remove();
  }

  destroy() {
    this.close();
    this.backdrop.remove();
  }
}

window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && stack.length) {
    const top = stack[stack.length - 1];
    if (top.dismissable) {
      top.close();
      e.stopPropagation();
    }
  }
});

export const hasOpenModal = () => stack.length > 0;
