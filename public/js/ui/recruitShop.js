// Recruitment shop — opened from any recruiting site (Keep, Outpost). The roster comes from the engine/rules,
// so a mode decides what each site can train; this view just presents it.

import { h, clear, spriteCanvas } from './dom.js';
import { glyph, sprite } from './icons.js';
import { Modal } from './modal.js';
import { ABILITY } from '../config/constants.js';
import { MOVE_CLASSES, movementOf } from '../config/movement.js';

const CLASSES = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'foot', label: 'Infantry', test: u => u.max_attack_range === 1 && !u.abilities?.includes(ABILITY.MOUNTED) && !u.abilities?.includes(ABILITY.AIR_FORCE) && !u.abilities?.includes(ABILITY.HEALER) },
  { id: 'ranged', label: 'Ranged', test: u => u.max_attack_range >= 2 },
  { id: 'mounted', label: 'Mounted', test: u => u.abilities?.includes(ABILITY.MOUNTED) || u.movement_point >= 6 },
  { id: 'air', label: 'Air', test: u => u.abilities?.includes(ABILITY.AIR_FORCE) },
  { id: 'support', label: 'Support', test: u => u.abilities?.includes(ABILITY.HEALER) || u.abilities?.includes(ABILITY.BUILDER) || u.abilities?.includes(ABILITY.NECROMANCER) }
];

export class RecruitShop {
  constructor({ assets, onBuy, themeId = () => 'frost' }) {
    this.assets = assets;
    this.onBuy = onBuy;
    this.filter = 'all';
    this.modal = new Modal({ title: 'Recruit', width: 980 });
    this.resBox = h('div', { class: 'sticky-res' });
    this.modal.headExtra.append(this.resBox);
    this.tabs = h('div', { class: 'tab-row' });
    this.grid = h('div', { class: 'shop-grid' });
    this.modal.body.append(this.tabs, this.grid);
  }

  /**
   * `custom` lets a mode present its own site instead of the classic Keep/Outpost rules:
   *   { title, roster:[unitIndex], price(tpl), check(tpl) -> {ok, reason}, supply:'n/cap' }
   * (Battle Royale uses it: purchases there are queued as orders, with per-warband prices.)
   */
  open(game, team, x, y, custom = null) {
    this.game = game;
    this.team = team;
    this.pos = { x, y };
    this.custom = custom;
    this.render();
    this.modal.open();
  }

  render() {
    const { game, team, pos, custom } = this;
    const site = custom ? { kind: 'custom', roster: custom.roster } : game.getRecruitSite(team, pos.x, pos.y);
    if (!site) return this.modal.close();
    this.modal.title.textContent = custom ? custom.title : site.kind === 'outpost' ? 'Outpost — Field Recruitment' : 'Keep — Recruit Troops';

    const player = game.players[team];
    clear(this.resBox);
    this.resBox.append(h('span', null, sprite('coin', 2), `${player.gold.toLocaleString('en-US')}`), h('span', null, sprite('person', 2), custom ? custom.supply() : `${game.getTeamPopulation(team)}/${game.getMaxPop(team)}`));

    clear(this.tabs);
    for (const c of CLASSES) {
      this.tabs.append(h('button', { class: `btn btn-sm ${this.filter === c.id ? 'is-on' : ''}`, onclick: () => ((this.filter = c.id), this.render()) }, c.label));
    }

    clear(this.grid);
    const cls = CLASSES.find(c => c.id === this.filter) || CLASSES[0];
    const units = site.roster
      .map(i => this.assets.getUnitTemplate(i))
      .filter(u => cls.test(u))
      .sort((a, b) => (custom ? custom.price(a) - custom.price(b) : a.price - b.price));
    if (!units.length) this.grid.append(h('div', { class: 'empty' }, 'Nothing of that kind is trained here.'));

    for (const u of units) {
      const check = custom ? custom.check(u) : game.canRecruitUnit(team, u.index, pos.x, pos.y);
      const price = custom ? custom.price(u) : game.getRecruitPrice(team, u.index);
      const spr = this.assets.getUnitSprite(u.index, team);
      const icon = spr ? spriteCanvas(spr.img, spr.sx, 0, spr.size, spr.size, 56) : null;
      const abilities = (u.abilities || []).map(id => this.assets.getAbility(id));
      this.grid.append(
        h(
          'div',
          { class: `unit-card plate flat ${check.ok ? '' : 'is-locked'}` },
          h('div', { class: 'top' }, icon, h('div', null, h('div', { class: 'nm' }, u.name, u.pack ? h('span', { class: 'new-badge' }, 'NEW') : null), h('div', { class: 'pr' }, h('span', null, `${price}g`), h('span', null, `${u.occupancy || 1} supply`)))),
          h('div', { class: 'stat-row' }, h('span', { class: 'stat' }, sprite('atk', 1), `${u.attack}`, h('small', null, u.attack_type === 0 ? 'PHYS' : 'MAG')), h('span', { class: 'stat' }, sprite('pdef', 1), `${u.physical_defence}`), h('span', { class: 'stat' }, sprite('mdef', 1), `${u.magic_defence}`), h('span', { class: 'stat', title: 'Move points' }, glyph('boot', 2), `${game.templateMp(u)}`), h('span', { class: 'stat' }, glyph('target', 2), `${u.min_attack_range}–${u.max_attack_range}`)),
          h('div', { class: 'chips' }, h('span', { class: 'chip gold', title: (MOVE_CLASSES[game.rules.has('movement') ? movementOf(u).cls : 'foot'] || MOVE_CLASSES.foot).blurb }, `Moves: ${(MOVE_CLASSES[game.rules.has('movement') ? movementOf(u).cls : 'foot'] || MOVE_CLASSES.foot).name}`)),
          abilities.length ? h('div', { class: 'chips' }, ...abilities.map(a => h('span', { class: 'chip', title: a.description }, a.name))) : null,
          h('div', { class: 'desc' }, u.description),
          h('button', { class: `btn btn-sm ${check.ok ? 'btn-gold' : ''}`, disabled: !check.ok, onclick: () => this.buy(u.index) }, check.ok ? `${custom ? 'Order' : 'Recruit'} · ${price}g` : check.reason)
        )
      );
    }
  }

  buy(index) {
    this.onBuy(this.team, index, this.pos.x, this.pos.y);
    this.modal.close();
  }
}
