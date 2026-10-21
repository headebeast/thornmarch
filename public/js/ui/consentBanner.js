// The one-time question: may we collect anonymous usage statistics? Sits quietly at the bottom of the menu; nothing is
// collected until "Allow" is pressed, and "No thanks" is as prominent as "Allow".

import { h } from './dom.js';

export class ConsentBanner {
  /** @param {{onChoose: (state: 'granted' | 'denied') => void}} o */
  constructor({ onChoose }) {
    this.onChoose = onChoose;
    const choose = state => {
      this.onChoose(state);
      this.node.classList.add('is-answered');
      this.thanks.textContent = state === 'granted' ? 'Thank you — you can change this any time in Settings.' : 'No problem — nothing will be collected.';
      setTimeout(() => this.hide(true), 2600);
    };
    this.thanks = h('div', { class: 'consent-thanks' });
    this.node = h(
      'section',
      { class: 'consent plate hidden', role: 'dialog', 'aria-label': 'Usage statistics', 'data-notrack': '1' },
      h('div', { class: 'consent-body' },
        h('h3', null, 'Help improve the game?'),
        h('p', null, 'May we collect anonymous usage statistics: which screens and buttons are used, how long you play, how smoothly the game runs, and your approximate location from your IP address (the last part of the address is removed). Never your name, chat or moves.'),
        h('a', { href: '/privacy.html', target: '_blank', rel: 'noopener' }, 'Read the privacy notice')
      ),
      h('div', { class: 'consent-actions' },
        h('button', { class: 'btn btn-gold', onclick: () => choose('granted') }, 'Allow'),
        h('button', { class: 'btn', onclick: () => choose('denied') }, 'No thanks')
      ),
      this.thanks
    );
    document.body.appendChild(this.node);
  }

  show() {
    if (this.node.classList.contains('is-answered')) return;
    this.node.classList.remove('hidden');
  }

  hide(remove = false) {
    this.node.classList.add('hidden');
    if (remove) this.node.remove();
  }
}
