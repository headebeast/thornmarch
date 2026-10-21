// Mode setup — builds the whole configuration screen from a mode's `setup` schema, with a live map preview.
// Field types: segmented · cards · toggle · select · seed · teams.
// A new mode (or a new option) needs zero UI code: add a field to the schema.

import { TEAMS, PLAYER_TYPES } from '../config/constants.js';
import { h, clear } from './dom.js';
import { glyph } from './icons.js';
import { Modal } from './modal.js';
import { drawTerrainPreview } from './mapPreview.js';

function teamsOfMap(mapData) {
  if (mapData.activeTeams?.length) return mapData.activeTeams;
  const out = [];
  (mapData.teamAccess || [true, true, false, false]).forEach((on, t) => on && out.push(t));
  return out.length ? out : [0, 1];
}

export class ModeSetup {
  /**
   * @param {{assets, mode, online?:boolean, startLabel?:string, onStart:(config:object)=>void}} o
   */
  constructor({ assets, mode, online = false, startLabel = 'Begin Battle', onStart }) {
    this.assets = assets;
    this.mode = mode;
    this.online = online;
    this.onStart = onStart;
    this.schema = typeof mode.setup === 'function' ? mode.setup(assets) : mode.setup || [];
    this.config = {};
    for (const f of this.schema) {
      if (f.type === 'seed') this.config[f.id] = f.make();
      else if (f.type === 'select') this.config[f.id] = f.default ?? f.options?.[0]?.value;
      else if (f.type === 'toggle') this.config[f.id] = f.default ?? false;
      else if (f.id !== 'teams') this.config[f.id] = f.default ?? f.options?.[0]?.value;
    }
    this.teamChoices = { 0: PLAYER_TYPES.LOCAL };
    this.modal = new Modal({ title: mode.name, width: 960, disposable: true });
    this.startBtn = h('button', { class: 'btn btn-gold', onclick: () => this.start() }, glyph('play', 2), startLabel);
    this.modal.window.append(h('div', { class: 'modal-foot' }, h('button', { class: 'btn btn-ghost', onclick: () => this.modal.close() }, 'Cancel'), this.startBtn));
    this.formEl = h('div', { class: 'setup-form' });
    this.previewCanvas = h('canvas', { 'aria-label': 'Map preview' });
    this.facts = h('div', { class: 'preview-facts' });
    this.previewCard = h('div', { class: 'preview-card plate flat' }, h('div', { class: 'eyebrow' }, 'Map preview'), this.previewCanvas, this.facts);
    this.modal.body.append(h('p', { style: { color: 'var(--text-dim)', fontSize: '13px' } }, mode.description || mode.tagline || ''), h('div', { class: 'setup-grid' }, this.formEl, this.previewCard));
  }

  open() {
    this.render();
    this.modal.open();
  }

  render() {
    clear(this.formEl);
    for (const f of this.schema) {
      if (f.type === 'teams' && this.online) continue;
      this.formEl.append(this.field(f));
    }
    this.refreshPreview();
  }

  set(id, value, rerender = true) {
    this.config[id] = value;
    if (rerender) this.render();
  }

  field(f) {
    const label = h('div', { class: 'label' }, f.label);
    const note = f.note ? h('div', { class: 'note' }, f.note) : null;
    if (f.type === 'segmented') {
      return h('div', { class: 'field' }, label, h('div', { class: 'segmented' }, ...f.options.map(o => h('button', { class: `btn seg ${this.config[f.id] === o.value ? 'is-on' : ''}`, onclick: () => this.set(f.id, o.value) }, o.label))), note);
    }
    if (f.type === 'cards') {
      return h('div', { class: 'field' }, label, h('div', { class: 'cards' }, ...f.options.map(o => h('button', { class: `btn opt-card ${this.config[f.id] === o.value ? 'is-on' : ''}`, onclick: () => this.set(f.id, o.value) }, h('span', { class: 'n' }, o.label), o.note ? h('span', { class: 'd' }, o.note) : null))), note);
    }
    if (f.type === 'toggle') {
      const on = !!this.config[f.id];
      return h('div', { class: 'field' }, h('div', { class: `toggle ${on ? 'is-on' : ''}`, role: 'switch', 'aria-checked': String(on), tabindex: '0', onclick: () => this.set(f.id, !on), onkeydown: e => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), this.set(f.id, !on)) }, h('span', { class: 'toggle-track' }, h('span', { class: 'toggle-knob' })), h('span', null, h('div', { class: 'label', style: { textTransform: 'uppercase' } }, f.label), note)));
    }
    if (f.type === 'select') {
      const sel = h('select', { class: 'select', onchange: e => this.set(f.id, e.target.value) }, ...f.options.map(o => h('option', { value: o.value, selected: o.value === this.config[f.id] }, o.label)));
      return h('div', { class: 'field' }, label, sel, note);
    }
    if (f.type === 'seed') {
      const input = h('input', { class: 'input', value: this.config[f.id], maxlength: 12, 'aria-label': f.label, oninput: e => { this.config[f.id] = e.target.value.toUpperCase(); clearTimeout(this._t); this._t = setTimeout(() => this.refreshPreview(), 180); } });
      return h('div', { class: 'field' }, label, h('div', { class: 'seed-row' }, input, h('button', { class: 'btn btn-icon', title: 'Roll a new realm', 'aria-label': 'Roll a new realm', onclick: () => this.set(f.id, f.make()) }, glyph('dice', 2))), note);
    }
    if (f.type === 'teams') return this.teamsField(f, label);
    return h('div');
  }

  teamsField(f, label) {
    let match;
    try {
      match = this.mode.createMatch({ ...this.config, teams: {} }, this.assets);
    } catch (_) {
      return h('div');
    }
    const teams = teamsOfMap(match.mapData);
    const rows = teams.map((t, i) => {
      const meta = TEAMS[t];
      const cur = this.teamChoices[t] || (i === 0 ? PLAYER_TYPES.LOCAL : PLAYER_TYPES.AI);
      this.teamChoices[t] = cur;
      return h(
        'div',
        { class: 'team-row' },
        h('span', { class: 'team-flag', style: { '--team': meta.color } }),
        h('span', { class: 'px', style: { width: '64px', color: meta.light, fontWeight: 700 } }, meta.name),
        h('select', { class: 'select', 'aria-label': `${meta.name} controller`, onchange: e => (this.teamChoices[t] = e.target.value) }, h('option', { value: PLAYER_TYPES.LOCAL, selected: cur === PLAYER_TYPES.LOCAL }, 'Human (this device)'), h('option', { value: PLAYER_TYPES.AI, selected: cur === PLAYER_TYPES.AI }, 'AI commander'))
      );
    });
    return h('div', { class: 'field' }, label, ...rows);
  }

  refreshPreview() {
    let match;
    try {
      match = this.mode.createMatch({ ...this.config, teams: {} }, this.assets);
    } catch (e) {
      console.error(e);
      return;
    }
    const m = match.mapData;
    const scale = Math.max(2, Math.floor(340 / Math.max(m.width, m.height)));
    drawTerrainPreview(this.previewCanvas, m, this.assets, scale);
    const biggest = 361;
    const tiles = m.width * m.height;
    const pois = m.meta?.pois || [];
    const count = t => pois.filter(p => p.type === t).length;
    clear(this.facts);
    const fact = (value, label) => h('div', null, h('b', null, value), label);
    if (this.mode.previewFacts) {
      for (const f of this.mode.previewFacts(match)) this.facts.append(fact(f.value, f.label));
      return;
    }
    this.facts.append(fact(`${m.width}×${m.height}`, 'tiles across'), fact(`${(tiles / biggest).toFixed(1)}×`, 'the biggest classic map'));
    if (pois.length) this.facts.append(fact(String(count('farm') + count('mine')), 'farms & mines'), fact(String(count('ruins') + count('shrine') + count('obelisk') + count('forge') + count('library')), 'landmarks'));
  }

  start() {
    const teams = {};
    const slots = (() => {
      try {
        return teamsOfMap(this.mode.createMatch({ ...this.config, teams: {} }, this.assets).mapData);
      } catch (_) {
        return [0, 1];
      }
    })();
    for (const t of slots) teams[t] = this.online ? PLAYER_TYPES.LOCAL : this.teamChoices[t] || (t === slots[0] ? PLAYER_TYPES.LOCAL : PLAYER_TYPES.AI);
    this.modal.close();
    this.onStart({ ...this.config, teams, players: this.config.players ?? slots.length });
  }
}
