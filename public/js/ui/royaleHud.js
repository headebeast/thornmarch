// Battle Royale HUD: round / planning timer / warbands alive / kills / war-horn countdown (+ storm when one runs), plus a kill feed.
// A thin extension of the main Hud — it re-uses the same plates, meters and typography.

import { h, clear } from './dom.js';
import { glyph, sprite } from './icons.js';
import { TEAMS } from '../config/constants.js';

const mmss = s => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;

export class RoyaleHud {
  constructor(hud) {
    this.hud = hud;
    this.last = {};
    const res = (cls, label) => {
      const val = h('div', { class: 'val' });
      const meter = h('div', { class: 'meter' }, h('i'));
      const node = h('div', { class: `res ${cls}` }, h('div', { class: 'stack' }, h('div', { class: 'eyebrow label', style: { fontSize: '10px' } }, label), val, meter));
      return { node, val, meter: meter.firstChild, label: node.querySelector('.label'), meterWrap: meter };
    };
    this.round = res('round', 'Round');
    this.timer = res('timer', 'Planning');
    this.alive = res('alive', 'Alive');
    this.kills = res('kills', 'Kills');
    this.gold = res('gold', 'Gold');
    this.squadCell = res('squadcell', 'Squad');
    this.hunt = res('hunt', 'Hunt');
    this.storm = res('storm', 'Storm');
    this.bar = h('div', { class: 'res-cluster plate royale-bar' }, this.round.node, this.timer.node, this.alive.node, this.kills.node, this.gold.node, this.squadCell.node, this.hunt.node, this.storm.node);
    this.feed = h('div', { class: 'kill-feed', 'aria-live': 'polite' });
  }

  attach() {
    const { hud } = this;
    hud.el.top.insertBefore(this.bar, hud.el.resBox);
    hud.root.appendChild(this.feed);
  }

  detach() {
    this.bar.remove();
    this.feed.remove();
  }

  setTeam(team, name) {
    const t = TEAMS[team] || TEAMS[0];
    const { el } = this.hud;
    el.flag.style.setProperty('--team', t.color);
    el.turnPlate.style.setProperty('--team-light', t.light);
    el.turnLabel.textContent = 'Your warband';
    el.turnName.textContent = (name || t.name).toUpperCase();
  }

  /** s: { round, state, left, total, alive, teams, kills, gold, income, squad, squadMax, hunt:{text,tone}, stormText, orders, inStorm } */
  update(s) {
    const sig = JSON.stringify([s.round, s.state, Math.ceil(s.left), s.alive, s.kills, s.gold, s.income, s.squadMax, s.hunt?.text, s.stormText, s.inStorm, s.orders, s.squad]);
    if (sig === this.last.sig) return;
    this.last.sig = sig;

    this.set(this.round, `${s.round}`);
    const planning = s.state === 'PLAN';
    this.timer.label.textContent = planning ? 'Planning' : s.state === 'LOCKED' ? 'Locked in' : s.state === 'RESOLVE' ? 'Resolving' : 'Waiting';
    this.set(this.timer, planning ? mmss(s.left) : s.state === 'RESOLVE' ? '···' : '—');
    this.timer.meter.style.setProperty('--fill', planning ? `${Math.max(0, Math.min(100, (s.left / s.total) * 100))}%` : '0%');
    this.timer.node.classList.toggle('urgent', planning && s.left <= 5);
    this.set(this.alive, `${s.alive}`, `/${s.teams}`);
    this.alive.meter.style.setProperty('--fill', `${(s.alive / s.teams) * 100}%`);
    this.set(this.kills, `${s.kills}`);
    this.set(this.gold, `${s.gold}`, ` +${s.income}`);
    this.gold.label.textContent = 'Gold · per round';
    this.gold.meterWrap.style.display = 'none';
    this.set(this.squadCell, `${s.squad}`, `/${s.squadMax}`);
    this.squadCell.meterWrap.style.display = 'none';
    this.set(this.hunt, s.hunt?.text || '');
    for (const tone of ['idle', 'horn', 'final', 'late']) this.hunt.node.classList.toggle(tone, s.hunt?.tone === tone);
    this.hunt.label.textContent = s.hunt?.tone === 'late' ? 'Stand-off' : s.hunt?.tone === 'idle' ? 'War horn' : 'Hunt';
    this.hunt.meterWrap.style.display = 'none';
    this.storm.node.style.display = s.stormText ? '' : 'none'; // only matches that run a storm show the cell
    this.set(this.storm, s.stormText);
    this.storm.node.classList.toggle('warn', !!s.inStorm);
    this.storm.node.classList.toggle('closing', !!s.closing);
    this.storm.label.textContent = s.inStorm ? 'IN THE STORM' : 'Storm';
    this.storm.meterWrap.style.display = 'none';

    const { hud } = this;
    const unordered = Math.max(0, s.squad - s.orders);
    hud.el.endReady.textContent = String(unordered);
    hud.el.endReady.classList.toggle('hidden', !planning || unordered === 0);
    hud.el.endBtn.querySelector('.lbl').textContent = planning ? 'Lock orders' : s.state === 'LOCKED' ? 'Waiting…' : 'Resolving…';
    hud.el.endBtn.disabled = !planning;
    hud.el.endBtn.classList.toggle('pulse', planning && unordered === 0);
    hud.el.endBtn.classList.toggle('hidden', false);
    hud.el.waiting.classList.add('hidden');
  }

  set(r, value, suffix = '') {
    clear(r.val);
    r.val.append(document.createTextNode(value));
    if (suffix) r.val.append(h('span', { class: 'of' }, suffix));
  }

  /** kind: 'kill' | 'storm' | 'horn' | 'drop' | 'loot' */
  feedAdd(text, kind = 'kill', color = null) {
    const row = h('div', { class: `feed-row ${kind}`, style: color ? { '--c': color } : null }, text);
    this.feed.prepend(row);
    setTimeout(() => row.classList.add('fade'), 7000);
    setTimeout(() => row.remove(), 8200);
    while (this.feed.children.length > 6) this.feed.lastChild.remove();
  }
}
