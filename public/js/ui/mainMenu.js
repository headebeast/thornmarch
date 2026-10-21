// Main menu — logo, mode list (driven by the registry), featured Frontier card, animated realm backdrop.

import { h, show } from './dom.js';
import { glyph, sprite } from './icons.js';
import { drawMapCrop, drawUnitSprite } from './mapPreview.js';
import { BRAND } from '../config/brand.js';
import { deploy } from '../config/deploy.js';

export class MainMenu {
  constructor({ assets, platform, onChoose, backdropMap }) {
    this.assets = assets;
    this.platform = platform;
    this.onChoose = onChoose;
    this.backdropMap = backdropMap;
    this.root = this.build();
  }

  item(id, icon, title, sub) {
    return h(
      'button',
      { class: 'menu-item', onclick: () => this.onChoose(id) },
      h('span', { class: 'ico' }, sprite(icon, icon === 'sword' || icon === 'hammer' || icon === 'globe' || icon === 'book' ? 1 : 1)),
      h('span', null, h('div', { class: 't' }, title), h('div', { class: 's' }, sub)),
      h('span', { class: 'go' }, glyph('chevronRight', 2))
    );
  }

  build() {
    // featured Frontier card: a real crop of a generated realm with units standing on it
    const art = h('canvas', { width: 520, height: 96, 'aria-hidden': 'true' });
    this.paintFeatured(art);
    const featured = h(
      'button',
      { class: 'menu-item featured', onclick: () => this.onChoose('frontier') },
      h('div', { class: 'art' }, art),
      h(
        'div',
        { class: 'copy' },
        h('span', null, h('div', { class: 't' }, 'Frontier', h('span', { class: 'new-tag' }, 'NEW')), h('div', { class: 's' }, 'A vast realm to farm, scout and conquer · fog of war · 10 new units')),
        h('span', { class: 'go', style: { marginLeft: 'auto' } }, glyph('chevronRight', 2))
      )
    );

    this.fsBtn = h('button', { class: 'btn btn-sm', onclick: () => this.onChoose('fullscreen') }, glyph('fullscreen', 2), 'Full screen');
    this.audioBtn = h('button', { class: 'btn btn-sm', onclick: () => this.onChoose('audio') }, glyph('audioOn', 2), 'Audio');

    this.canvas = h('canvas', { id: 'menu-backdrop', 'aria-hidden': 'true' });
    const col = h(
      'div',
      { class: 'menu-col' },
      h('div', { class: 'logo' }, h('div', { class: 'crest' }, glyph('flag', 3), glyph('trophy', 3), glyph('flag', 3)), h('h1', null, BRAND.name, h('span', null, BRAND.edition.toUpperCase())), h('p', null, 'The classic turn-based war, rebuilt for every screen.')),
      h('div', { class: 'menu-list' }, featured, this.item('campaign', 'sword', 'Campaign', '27 story stages from the original games'), this.item('skirmish', 'crystal', 'Skirmish', '26 classic maps · vs AI or pass-and-play'), this.royaleItem(), ...(deploy.online ? [this.item('online', 'globe', 'Online Battle', 'Live rooms, room codes and chat')] : []), this.item('editor', 'hammer', 'Map Editor', 'Paint terrain, place armies, share maps'), this.item('codex', 'book', 'Codex', 'Every unit, ability and building')),
      h('div', { class: 'menu-foot' }, this.fsBtn, this.audioBtn, h('button', { class: 'btn btn-sm', onclick: () => this.onChoose('about') }, 'About'), h('span', { class: 'grow' }), h('span', null, `v${deploy.version.split("+")[0]} · works on desktop, tablet & phone`))
    );
    return h('div', { id: 'menu-screen', class: 'hidden' }, this.canvas, col);
  }

  royaleItem() {
    const b = this.item('royale', 'gem', 'Battle Royale', '20–60 warbands · simultaneous turns · last one standing');
    b.querySelector('.t').append(h('span', { class: 'new-tag' }, 'NEW'));
    return b;
  }

  paintFeatured(canvas) {
    const m = this.backdropMap;
    if (!m) return;
    const ctx = canvas.getContext('2d');
    const ts = 32;
    // pick the top-left keep and show its surroundings
    const keep = m.meta.pois.find(p => p.type === 'keep');
    const x0 = Math.max(0, keep.x - 5);
    const y0 = Math.max(0, keep.y - 1);
    drawMapCrop(ctx, this.assets, 'meadow', m, x0, y0, 17, 4, ts);
    for (const u of m.units) {
      if (u.x >= x0 && u.x < x0 + 17 && u.y >= y0 && u.y < y0 + 4) drawUnitSprite(ctx, this.assets, u, (u.x - x0) * ts, (u.y - y0) * ts, ts, 0);
    }
  }

  mount(parent = document.body) {
    parent.appendChild(this.root);
  }

  show(v) {
    show(this.root, v);
  }

  setAudio(muted) {
    this.audioBtn.replaceChildren(glyph(muted ? 'audioOff' : 'audioOn', 2), muted ? 'Audio off' : 'Audio on');
  }

  setFullscreen(active) {
    this.fsBtn.replaceChildren(glyph(active ? 'fullscreenExit' : 'fullscreen', 2), active ? 'Exit full screen' : 'Full screen');
  }
}
