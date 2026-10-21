// Campaign stage picker.

import { h, clear } from './dom.js';
import { Modal } from './modal.js';

export class CampaignPicker {
  constructor({ assets, onPlay }) {
    this.assets = assets;
    this.onPlay = onPlay;
    this.campaign = 'all';
    this.modal = new Modal({ title: 'Campaign', width: 1000 });
    this.tabs = h('div', { class: 'tab-row' });
    this.grid = h('div', { class: 'grid-cards' });
    this.modal.body.append(this.tabs, this.grid);
  }

  open() {
    this.render();
    this.modal.open();
  }

  render() {
    const stages = this.assets.maps.filter(m => m.category === 'campaign');
    const names = ['all', ...new Set(stages.map(m => m.campaign))];
    clear(this.tabs);
    for (const n of names) this.tabs.append(h('button', { class: `btn btn-sm ${this.campaign === n ? 'is-on' : ''}`, onclick: () => ((this.campaign = n), this.render()) }, n === 'all' ? 'All stages' : n));
    clear(this.grid);
    for (const m of stages.filter(s => this.campaign === 'all' || s.campaign === this.campaign)) {
      this.grid.append(
        h(
          'div',
          { class: 'stage-card plate flat' },
          h('div', { class: 'meta' }, h('span', null, (m.campaign || '').toUpperCase()), h('span', null, `${m.width}×${m.height}`)),
          h('h4', null, `Stage ${m.stageNum}: ${m.name}`),
          h('p', null, m.objective),
          h('button', { class: 'btn btn-sm btn-gold', onclick: () => (this.modal.close(), this.onPlay(m.id)) }, 'Play stage')
        )
      );
    }
  }
}
