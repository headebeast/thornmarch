// About box — what this game is, who made what it is built on, the licence, and where the source lives.
// The GPL asks that anyone who plays a covered program can get its source: the link comes from the deployment's
// <meta name="aeii-source"> tag (see config/deploy.js), so each host puts in its own.

import { h } from './dom.js';
import { Modal } from './modal.js';
import { BRAND, brandTitle } from '../config/brand.js';
import { deploy } from '../config/deploy.js';

export class AboutBox {
  constructor() {
    this.modal = new Modal({ title: `About ${BRAND.name}`, width: 560 });
    const link = (text, href) => h('a', { href, target: '_blank', rel: 'noopener noreferrer', style: { color: 'var(--gold-hi)' } }, text);
    const p = (...kids) => h('p', { style: { color: 'var(--text-dim)', lineHeight: 1.5, margin: '0 0 10px' } }, ...kids);
    const src = deploy.sourceUrl;
    this.modal.body.append(
      h('h2', { style: { margin: '0 0 6px' } }, brandTitle()),
      h('div', { class: 'eyebrow', style: { marginBottom: '12px' } }, `Version ${deploy.version}`),
      p(BRAND.description),
      p('Built on ', link(BRAND.originalProject.name, BRAND.originalProject.url), ` by ${BRAND.originalProject.author}. Their game code is licensed under the GNU GPL v3 and their art and sound may be used freely; this web edition adds new modes, units, buildings, procedural art and a multiplayer referee, and is released under the same GPL v3 licence.`),
      p('Pixel typeface ', link('Jersey 15', 'https://fonts.google.com/specimen/Jersey+15'), ' by The Soft Type Project (SIL Open Font Licence).'),
      p(src ? ['Source code: ', link(src, src), '. '] : 'The complete source code is available from whoever runs this site. ', link('Licence text', '/LICENSE.txt'), ' · ', link('Credits', '/CREDITS.txt')),
      p('No account, no tracking and no ads: your settings and saved progress stay in this browser.')
    );
  }

  open() {
    this.modal.open();
  }
}
