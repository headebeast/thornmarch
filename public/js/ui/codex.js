// Codex — every unit (with the new Frontier roster flagged), ability and building.

import { h, clear, spriteCanvas } from './dom.js';
import { glyph, sprite } from './icons.js';
import { Modal } from './modal.js';
import { BUILDINGS, tileKey } from '../modes/frontier/content.js';
import { MOVE_CLASSES, TERRAINS, TERRAIN_NAMES, movementOf, classCost } from '../config/movement.js';

export class Codex {
  constructor({ assets }) {
    this.assets = assets;
    this.tab = 'units';
    this.modal = new Modal({ title: 'Codex', width: 1000 });
    this.tabs = h('div', { class: 'tab-row' });
    this.list = h('div', { class: 'grid-cards' });
    this.modal.body.append(this.tabs, this.list);
  }

  open(tab = this.tab) {
    this.tab = tab;
    this.render();
    this.modal.open();
  }

  render() {
    clear(this.tabs);
    for (const [id, label] of [['units', 'Units'], ['frontier', 'Frontier units'], ['movement', 'Movement'], ['buildings', 'Buildings']]) {
      this.tabs.append(h('button', { class: `btn btn-sm ${this.tab === id ? 'is-on' : ''}`, onclick: () => ((this.tab = id), this.render()) }, label));
    }
    clear(this.list);
    if (this.tab === 'buildings') return this.renderBuildings();
    if (this.tab === 'movement') return this.renderMovement();
    const units = this.assets.units.filter(u => !u.isCrystal && (this.tab === 'frontier' ? u.pack : !u.pack));
    for (const u of units) {
      const spr = this.assets.getUnitSprite(u.index, 0);
      const abil = (u.abilities || []).map(id => this.assets.getAbility(id));
      this.list.append(
        h(
          'div',
          { class: 'codex-card plate flat' },
          h('div', { class: 'codex-head' }, spr ? spriteCanvas(spr.img, spr.sx, 0, spr.size, spr.size, 56) : null, h('div', { style: { flex: 1 } }, h('h4', null, u.name, h('small', null, `${u.price}g`)), h('div', { class: 'stat-row' }, h('span', { class: 'stat' }, sprite('atk', 1), `${u.attack}`), h('span', { class: 'stat' }, sprite('pdef', 1), `${u.physical_defence}`), h('span', { class: 'stat' }, sprite('mdef', 1), `${u.magic_defence}`), h('span', { class: 'stat' }, glyph('boot', 2), `${u.movement_point}`), h('span', { class: 'stat' }, glyph('target', 2), `${u.min_attack_range}–${u.max_attack_range}`)))),
          abil.length ? h('div', { class: 'chips' }, ...abil.map(a => h('span', { class: 'chip', title: a.description }, a.name))) : null,
          h('p', null, u.description),
          u.guide ? h('p', { class: 'guide' }, u.guide) : null
        )
      );
    }
  }

  renderMovement() {
    const names = TERRAIN_NAMES.meadow;
    const head = h('tr', null, h('th', null, 'Unit'), h('th', null, 'Class'), h('th', null, 'MP'), ...TERRAINS.map(t => h('th', null, names[t])));
    const rows = this.assets.units
      .filter(u => !u.isCrystal)
      .map(u => {
        const { cls, mp } = movementOf(u);
        const ab = u.abilities || [];
        const air = ab.includes(5);
        const cost = t => {
          let c = classCost(cls, t);
          if (air) return 1;
          if (ab.includes(16) && ['plains', 'forest', 'hill', 'mountain'].includes(t)) c = 1; // Crawler
          if (ab.includes(1) && t === 'water') c = 1; // Fighter of the Sea
          if (ab.includes(2) && t === 'forest') c = 1; // Fighter of the Forest
          if (ab.includes(3) && t === 'mountain') c = 1; // Fighter of the Mountain
          if (ab.includes(30) && (t === 'forest' || t === 'mountain')) c = Math.min(c, 2); // Pathfinder
          return c;
        };
        const spr = this.assets.getUnitSprite(u.index, 0);
        return h(
          'tr',
          null,
          h('td', { class: 'mv-unit' }, spr ? spriteCanvas(spr.img, spr.sx, 0, spr.size, spr.size, 28) : null, u.name),
          h('td', null, MOVE_CLASSES[cls]?.name || cls),
          h('td', { class: 'mv-mp' }, String(mp)),
          ...TERRAINS.map(t => {
            const c = cost(t);
            return h('td', { class: `mv-c mv-${c >= 99 ? 'x' : c}` }, c >= 99 ? '✕' : String(c));
          })
        );
      });
    const classes = h('div', { class: 'grid-cards', style: { marginTop: '14px', gridColumn: '1 / -1' } }, ...Object.values(MOVE_CLASSES).map(c => h('div', { class: 'codex-card plate flat' }, h('h4', null, c.name), h('p', null, c.blurb))));
    this.list.append(
      h('p', { style: { color: 'var(--text-dim)', fontSize: '13px', marginBottom: '10px', gridColumn: '1 / -1' } }, 'Move points (MP) and what each terrain costs a unit to enter. 1 is best; ✕ means it cannot enter. Flyers ignore terrain, and special skills (Crawler, Fighter of the Sea…) are already applied. This is the enhanced movement used by Skirmish (when enabled), Frontier and Royale — Campaign keeps the original uniform costs.'),
      h('div', { class: 'mv-wrap', style: { gridColumn: '1 / -1' } }, h('table', { class: 'mv-table' }, h('thead', null, head), h('tbody', null, ...rows))),
      classes
    );
  }

  renderBuildings() {
    const refs = this.assets.packRefs('frontier');
    if (!refs) return this.list.append(h('div', { class: 'empty' }, 'No buildings registered.'));
    const tiles = this.assets.getTheme('meadow').tiles;
    for (const [id, b] of Object.entries(BUILDINGS)) {
      const stage = b.stages ? b.stages - 1 : 0;
      const idx = refs.tiles[tileKey(id, b.neutralOnly ? -1 : 0, id === 'ruins' ? 0 : stage)];
      const facts = [];
      const inc = Array.isArray(b.income) ? b.income[b.income.length - 1] : b.income;
      if (inc) facts.push(`+${inc} gold / turn`);
      const sup = Array.isArray(b.supply) ? b.supply[b.supply.length - 1] : b.supply;
      if (sup) facts.push(`+${sup} supply`);
      if (b.renown) facts.push(`+${b.renown} Renown / turn`);
      if (b.buildCost) facts.push(`Built for ${b.buildCost}g`);
      if (b.vision >= 5) facts.push(`Sight ${b.vision}`);
      this.list.append(
        h(
          'div',
          { class: 'codex-card plate flat' },
          h('div', { class: 'codex-head' }, spriteCanvas(tiles[idx], 0, 0, 24, 24, 56), h('div', null, h('h4', null, b.name), h('div', { class: 'chips' }, ...facts.map(f => h('span', { class: 'chip gold' }, f))))),
          h('p', null, b.blurb)
        )
      );
    }
  }
}
