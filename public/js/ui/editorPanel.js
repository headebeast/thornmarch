// Map editor panel (view). The model lives in editor/mapEditor.js.

import { h, clear, spriteCanvas, show } from './dom.js';
import { glyph } from './icons.js';

const TILES = [
  [18, 'Ground'], [15, 'Forest'], [16, 'Forest (alt)'], [17, 'Mountain'], [32, 'Hill'], [0, 'Water'],
  [20, 'Road ─'], [21, 'Road │'], [22, 'Road ┼'], [23, 'Road ┐'], [24, 'Road ┘'], [25, 'Road └'], [26, 'Road ┌'],
  [28, 'Bridge'], [29, 'Bridge │'], [36, 'Village'], [38, 'Blue village'], [40, 'Red village'], [42, 'Green village'], [44, 'Black village'],
  [37, 'Keep'], [39, 'Blue keep'], [41, 'Red keep'], [43, 'Green keep'], [45, 'Black keep'], [27, 'Ruins']
];

export class EditorPanel {
  constructor({ assets, editor, themeId = () => 'frost', onSave, onPlay, onExit, onResize }) {
    this.assets = assets;
    this.editor = editor;
    this.cb = { onSave, onPlay, onExit, onResize };
    this.root = h('div', { id: 'editor-panel', class: 'plate hidden' });
    this.themeId = themeId;
  }

  mount(parent = document.body) {
    parent.appendChild(this.root);
  }

  show(v) {
    show(this.root, v);
    if (v) this.render();
  }

  render() {
    const { editor, assets } = this;
    clear(this.root);
    const tiles = assets.getTheme(this.themeId()).tiles;
    const mapName = h('input', { class: 'input', value: editor.map.name, maxlength: 32, 'aria-label': 'Map name' });
    const w = h('input', { class: 'input', type: 'number', min: 6, max: 32, value: editor.map.width, style: { width: '70px' }, 'aria-label': 'Width' });
    const hh = h('input', { class: 'input', type: 'number', min: 6, max: 32, value: editor.map.height, style: { width: '70px' }, 'aria-label': 'Height' });

    const tilePalette = h('div', { class: 'palette-grid' });
    for (const [idx, label] of TILES) {
      const b = h('button', { class: `palette-btn ${editor.brushMode === 'tile' && editor.selectedTileIndex === idx ? 'is-on' : ''}`, title: label, onclick: () => ((editor.brushMode = 'tile'), (editor.selectedTileIndex = idx), this.render()) }, tiles[idx] ? spriteCanvas(tiles[idx], 0, 0, 24, 24, 30) : label);
      tilePalette.append(b);
    }
    const unitPalette = h('div', { class: 'palette-grid' });
    for (const u of assets.units) {
      if (u.isCrystal || u.pack) continue;
      const spr = assets.getUnitSprite(u.index, editor.selectedTeam);
      unitPalette.append(h('button', { class: `palette-btn ${editor.brushMode === 'unit' && editor.selectedUnitIndex === u.index ? 'is-on' : ''}`, title: u.name, onclick: () => ((editor.brushMode = 'unit'), (editor.selectedUnitIndex = u.index), this.render()) }, spr ? spriteCanvas(spr.img, spr.sx, 0, spr.size, spr.size, 30) : u.name));
    }
    const teamSel = h('select', { class: 'select', 'aria-label': 'Army colour', onchange: e => ((editor.selectedTeam = +e.target.value), this.render()) }, ...['Blue', 'Red', 'Green', 'Black'].map((n, i) => h('option', { value: i, selected: editor.selectedTeam === i }, n)));

    this.root.append(
      h('div', { class: 'eyebrow' }, 'Map editor'),
      h('div', { class: 'field' }, h('label', null, 'Name'), mapName),
      h('div', { class: 'field' }, h('label', null, 'Size'), h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, w, '×', hh, h('button', { class: 'btn btn-sm', onclick: () => this.cb.onResize(+w.value, +hh.value) }, 'Resize'))),
      h('div', { class: 'field' }, h('label', null, 'Terrain & buildings'), tilePalette),
      h('div', { class: 'field' }, h('label', null, 'Army'), teamSel),
      h('div', { class: 'field' }, h('label', null, 'Units'), unitPalette, h('button', { class: `btn btn-sm ${editor.brushMode === 'erase' ? 'is-on' : ''}`, onclick: () => ((editor.brushMode = 'erase'), this.render()) }, 'Erase unit')),
      h('div', { class: 'note', style: { fontSize: '12px', color: 'var(--text-mute)' } }, 'Paint with left-drag · pan with right-drag or two fingers · scroll to zoom.'),
      h('div', { style: { display: 'flex', gap: '8px' } }, h('button', { class: 'btn btn-sm', style: { flex: 1 }, onclick: () => this.cb.onSave(mapName.value) }, 'Save'), h('button', { class: 'btn btn-sm btn-gold', style: { flex: 1 }, onclick: () => this.cb.onPlay(mapName.value) }, glyph('play', 2), 'Play')),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: () => this.cb.onExit() }, 'Exit editor')
    );
  }
}
