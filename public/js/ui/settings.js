// Settings box: what is drawn on screen (FPS, connection quality) and the privacy choices.

import { h, clear } from './dom.js';
import { Modal } from './modal.js';
import { settings } from '../config/settings.js';
import { deploy } from '../config/deploy.js';
import { consent } from '../analytics/consent.js';

/** A labelled on/off switch in the game's own style. `onChange(next)` returns void; the row repaints itself. */
function toggleRow({ label, note, get, onChange }) {
  const sw = h('div', { class: 'toggle', role: 'switch', tabindex: '0' }, h('span', { class: 'toggle-track' }, h('span', { class: 'toggle-knob' })), h('span', null, h('div', { class: 'label', style: { textTransform: 'uppercase' } }, label), note ? h('div', { class: 'note' }, note) : null));
  const paint = () => {
    const on = !!get();
    sw.classList.toggle('is-on', on);
    sw.setAttribute('aria-checked', String(on));
  };
  const flip = () => {
    onChange(!get());
    paint();
  };
  sw.addEventListener('click', flip);
  sw.addEventListener('keydown', e => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), flip()));
  paint();
  return { node: h('div', { class: 'field' }, sw), paint };
}

export class SettingsBox {
  /** @param {{onErase?: () => Promise<boolean>}} o */
  constructor({ onErase = null } = {}) {
    this.modal = new Modal({ title: 'Settings', width: 520 });
    this.rows = [];
    const section = (title, ...kids) => h('div', { style: { marginBottom: '16px' } }, h('div', { class: 'eyebrow', style: { marginBottom: '8px' } }, title), ...kids);

    const fps = toggleRow({ label: 'Show FPS counter', note: 'Frames per second, frame time and the slowest recent frame, in the corner of the screen.', get: () => settings.get('showFps'), onChange: v => settings.set('showFps', v) });
    const net = toggleRow({ label: 'Show connection quality', note: 'Ping, jitter and packet loss while you are in an online room. (Browsers hide raw packet loss, so loss is counted as probe replies that never came back.)', get: () => settings.get('showNet'), onChange: v => settings.set('showNet', v) });
    this.rows.push(fps, net);
    this.modal.body.append(section('On screen', fps.node, net.node));

    if (deploy.analyticsUrl) {
      const stats = toggleRow({
        label: 'Share anonymous usage statistics',
        note: 'Which modes and buttons are used and for how long, the speed of your game, and your approximate location from your IP address. Never your name, chat or moves.',
        get: () => consent.granted,
        onChange: on => consent.set(on ? 'granted' : 'denied')
      });
      this.rows.push(stats);
      this.signal = h('div', { class: 'note', style: { marginTop: '4px', display: 'none' } }, 'Your browser sends a Do-Not-Track / Global Privacy Control signal, so statistics stay off unless you switch this on.');
      this.status = h('div', { class: 'note', style: { marginTop: '6px', minHeight: '16px' } });
      const erase = h(
        'button',
        {
          class: 'btn btn-sm',
          onclick: async () => {
            this.status.textContent = 'Erasing…';
            const ok = onErase ? await onErase() : false;
            this.status.textContent = ok ? 'Done — what was recorded for this browser has been deleted.' : 'Could not reach the server. Nothing was changed; try again later.';
          }
        },
        'Erase my data'
      );
      this.modal.body.append(
        section(
          'Privacy',
          stats.node,
          this.signal,
          h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '8px' } }, erase, h('a', { href: '/privacy.html', target: '_blank', rel: 'noopener', style: { color: 'var(--gold-hi)' } }, 'Read the privacy notice')),
          this.status
        )
      );
    }
  }

  open() {
    this.rows.forEach(r => r.paint());
    if (this.signal) this.signal.style.display = consent.blockedBySignal ? '' : 'none';
    if (this.status) clear(this.status);
    this.modal.open();
  }
}
