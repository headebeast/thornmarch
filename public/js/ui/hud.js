// HUD — turn plate, resources, tools, inspector, action bar, minimap host, End Turn.
// A pure view: it renders what it's told and reports intent through `onCommand`. No game rules in here.

import { TEAMS, TILE_TYPE_NAMES, STATUS_NAMES } from '../config/constants.js';
import { getUnitStats, calculateDamage, canCounterAttack } from '../engine/combat.js';
import { h, clear, show, spriteCanvas } from './dom.js';
import { glyph, sprite } from './icons.js';
import { getMovementPointCost } from '../engine/pathfinding.js';
import { MOVE_CLASSES, TERRAIN_NAMES, terrainOf } from '../config/movement.js';

const fmt = n => Number(n).toLocaleString('en-US');

export class Hud {
  constructor({ assets, platform, onCommand }) {
    this.assets = assets;
    this.platform = platform;
    this.onCommand = onCommand;
    this.last = {};
    this.root = this.build();
    this.themeId = 'frost';
  }

  // ------------------------------------------------------------------------------------------
  build() {
    const cmd = (name, arg) => () => this.onCommand(name, arg);
    const tool = (name, glyphName, label, cls = '') =>
      h('button', { class: `btn btn-icon btn-sm ${cls}`, 'aria-label': label, title: label, onclick: cmd(name), dataset: { tool: name } }, glyph(glyphName, 2));

    this.el = {};
    const e = this.el;

    e.flag = h('span', { class: 'team-flag' });
    e.turnLabel = h('div', { class: 'eyebrow' }, 'Turn 1');
    e.turnName = h('div', { class: 'team-name' }, 'BLUE ARMY');
    e.turnPlate = h('div', { class: 'turn-plate plate' }, e.flag, h('div', null, e.turnLabel, e.turnName));

    const resource = (cls, icon, label, title) => {
      const val = h('div', { class: 'val' });
      const meter = h('div', { class: 'meter' }, h('i'));
      const node = h('div', { class: `res ${cls}`, title }, icon, h('div', { class: 'stack' }, h('div', { class: 'eyebrow label', style: { fontSize: '10px' } }, label), val, meter));
      return { node, val, meter: meter.firstChild, meterWrap: meter };
    };
    e.gold = resource('gold', sprite('coin', 2), 'Gold', 'Gold — spend it at Keeps and Outposts');
    e.supply = resource('supply', sprite('person', 2), 'Supply', 'Supply — troops fielded / cap. Farms and villages raise the cap');
    e.renown = resource('renown', sprite('rank', 2), 'Renown', 'Renown — reach the goal to win');
    e.resBox = h('div', { class: 'res-cluster plate' }, e.gold.node, e.supply.node, e.renown.node);

    e.audioBtn = tool('audio', 'audioOn', 'Toggle audio');
    e.fsBtn = tool('fullscreen', 'fullscreen', 'Toggle full screen (F)');
    e.tools = h(
      'div',
      { class: 'hud-tools plate' },
      h('span', { class: 'zoom-tool' }, tool('zoomOut', 'zoomOut', 'Zoom out (−)')),
      h('span', { class: 'zoom-tool' }, tool('zoomIn', 'zoomIn', 'Zoom in (+)')),
      tool('fit', 'fit', 'Fit whole map'),
      tool('focus', 'target', 'Centre on my commander (C)'),
      h('span', { class: 'sep' }),
      e.audioBtn,
      e.fsBtn,
      tool('codex', 'info', 'Codex'),
      tool('menu', 'menu', 'Menu')
    );
    // tools wrapped spans must not break flex gap
    e.tools.querySelectorAll('span.zoom-tool').forEach(s => s.classList.add('contents'));

    e.top = h('div', { class: 'hud-top' }, e.turnPlate, e.resBox, e.tools);

    // inspector
    e.inspector = h('div', { class: 'inspector plate is-empty' });
    // minimap + end turn
    e.minimapCanvas = h('canvas', { width: 128, height: 128, 'aria-label': 'Minimap' });
    e.minimapWrap = h('div', { class: 'minimap-wrap plate' }, e.minimapCanvas, h('span', { class: 'cap' }, 'MAP'));
    e.endReady = h('span', { class: 'ready hidden' }, '0');
    e.endBtn = h(
      'button',
      { class: 'btn btn-gold endturn', onclick: cmd('endTurn') },
      glyph('hourglass', 2),
      h('span', { class: 'lbl' }, 'End Turn'),
      h('span', { class: 'key' }, 'E'),
      e.endReady
    );
    e.waiting = h('div', { class: 'waiting-note plate hidden' }, '…');
    e.right = h('div', { class: 'hud-right' }, e.minimapWrap, e.waiting, e.endBtn);
    e.bottom = h('div', { class: 'hud-bottom' }, e.inspector, e.right);

    e.actionbar = h('div', { class: 'actionbar plate hidden', role: 'toolbar', 'aria-label': 'Unit actions' });
    e.banner = h('div', { class: 'banner plate gold hidden' });

    e.toasts = h('div', { id: 'toasts', 'aria-live': 'polite' });
    const root = h('div', { id: 'hud', class: 'hidden' }, e.top, e.banner, e.bottom, e.actionbar);
    document.body.appendChild(e.toasts);
    return root;
  }

  mount(parent = document.body) {
    parent.appendChild(this.root);
  }

  setVisible(v) {
    show(this.root, v);
    this.syncBottomHeight();
  }

  /** Publish the bottom HUD's height so narrow-screen CSS can float the action bar above it. */
  syncBottomHeight() {
    requestAnimationFrame(() => this.root.style.setProperty('--bottom-h', `${Math.round(this.el.bottom.getBoundingClientRect().height)}px`));
  }

  /** Which resource widgets a mode wants. */
  configure({ renown = false, supply = true, minimap = false, royale = false } = {}) {
    show(this.el.resBox, !royale);
    show(this.el.renown.node, renown);
    show(this.el.supply.node, supply);
    show(this.el.minimapWrap, minimap);
    this.last = {};
  }

  setTheme(themeId) {
    this.themeId = themeId;
  }

  // ------------------------------------------------------------------------------------------
  /** Screen rectangles the HUD occupies, in CSS px — the camera keeps the map clear of them when fitting. */
  insets() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const top = this.el.top.getBoundingClientRect().bottom + 6;
    const bb = this.el.bottom.getBoundingClientRect();
    const wide = vw > 720;
    // Portrait / narrow: HUD bands sit above/below the map. Wide screens: only reserve space for the bands that
    // would genuinely cover the map's top/bottom edge; side furniture floats over the apron instead.
    return { top: Math.max(0, top), bottom: wide ? 0 : Math.max(0, vh - bb.top + 6), left: 0, right: 0 };
  }

  // ------------------------------------------------------------------------------------------
  updateTurn(game, viewTeam, canAct, label = '') {
    const t = TEAMS[game.getCurrentTeam()] || TEAMS[0];
    this.el.flag.style.setProperty('--team', t.color);
    this.el.turnPlate.style.setProperty('--team-light', t.light);
    this.el.turnLabel.textContent = `Turn ${game.turnNumber}`;
    this.el.turnName.textContent = `${t.name} ${label || 'ARMY'}`;

    const myTurn = canAct;
    this.el.endBtn.classList.toggle('hidden', !myTurn);
    show(this.el.waiting, !myTurn);
    this.el.waiting.textContent = game.phase === 'GAME_OVER' ? 'Battle over' : `${t.name} is moving…`;

    const ready = game.units.filter(u => u.currentHp > 0 && u.team === game.getCurrentTeam() && !u.standby).length;
    this.el.endReady.textContent = String(ready);
    show(this.el.endReady, myTurn && ready > 0);
    this.el.endBtn.classList.toggle('pulse', myTurn && ready === 0 && game.phase === 'IDLE');
    this.el.endBtn.disabled = !myTurn || (game.phase !== 'IDLE' && game.phase !== 'MOVE');
  }

  updateResources(game, team) {
    if (team === null || team === undefined || !game.players[team]) return;
    const player = game.players[team];
    const income = game.getTeamIncome(team);
    this.setRes(this.el.gold, 'gold', `${fmt(player.gold)}`, income >= 0 ? `+${fmt(income)}` : fmt(income));

    const pop = game.getTeamPopulation(team);
    const cap = game.getMaxPop(team);
    this.setRes(this.el.supply, 'supply', `${pop}`, null, `/${cap}`);
    this.el.supply.node.classList.toggle('full', pop >= cap);
    this.el.supply.meter.style.setProperty('--fill', `${Math.min(100, (pop / Math.max(1, cap)) * 100)}%`);
    this.el.supply.meterWrap.style.display = '';

    if (game.renown) {
      const goal = game.renownGoal || 0;
      this.setRes(this.el.renown, 'renown', `${game.renown[team] ?? 0}`, null, goal ? `/${goal}` : '');
      this.el.renown.meter.style.setProperty('--fill', goal ? `${Math.min(100, ((game.renown[team] ?? 0) / goal) * 100)}%` : '0%');
    }
  }

  setRes(res, key, value, delta = null, suffix = '') {
    const sig = `${value}|${delta}|${suffix}`;
    if (this.last[key] === sig) return;
    const changed = this.last[key] !== undefined;
    this.last[key] = sig;
    clear(res.val);
    res.val.append(document.createTextNode(value));
    if (suffix) res.val.append(h('span', { class: 'of' }, suffix));
    if (delta) res.val.append(h('small', null, delta));
    if (changed) {
      res.node.classList.remove('bump');
      void res.node.offsetWidth;
      res.node.classList.add('bump');
    }
  }

  setAudio(muted) {
    const b = this.el.audioBtn;
    clear(b);
    b.append(glyph(muted ? 'audioOff' : 'audioOn', 2));
  }

  setFullscreen(active) {
    const b = this.el.fsBtn;
    clear(b);
    b.append(glyph(active ? 'fullscreenExit' : 'fullscreen', 2));
    b.classList.toggle('is-on', active);
  }

  toast(text, kind = '') {
    const t = h('div', { class: `toast plate ${kind}` }, text);
    this.el.toasts.append(t);
    setTimeout(() => t.remove(), 3500);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstChild.remove();
  }

  showBanner(meta) {
    const b = this.el.banner;
    clear(b);
    if (!meta) return show(b, false);
    b.append(
      h('h4', null, `${meta.campaign} — Stage ${meta.stageNum}: ${meta.name}`),
      h('div', { class: 'obj' }, `Objective: ${meta.objective}`),
      ...(meta.dialogs || []).slice(0, 4).map(d => h('p', null, `“${d}”`)),
      h('button', { class: 'btn btn-sm', onclick: () => show(b, false) }, 'Dismiss')
    );
    show(b, true);
  }

  // ------------------------------------------------------------------------------------------
  // Action bar
  // ------------------------------------------------------------------------------------------
  /** items: [{id,label,icon,hotkey,cost,hint,primary,cancel,disabled}] */
  actionButton(it) {
    const iconNode = it.iconNode || (it.icon ? sprite(it.icon, ['occupy', 'heal', 'buy', 'attack', 'summon'].includes(it.icon) ? 2 : 1) : glyph('flag', 2));
    return h(
      'button',
      {
        class: `act ${it.primary ? 'primary' : ''} ${it.cancel ? 'cancel' : ''}`,
        disabled: it.disabled,
        title: it.hint || it.label,
        onclick: () => this.onCommand('action', it.id)
      },
      it.hotkey ? h('span', { class: 'key' }, it.hotkey) : null,
      it.cost ? h('span', { class: 'cost' }, `${it.cost}g`) : null,
      h('span', { class: 'ico' }, iconNode),
      h('span', null, it.label),
      it.hint && !it.cost ? h('span', { class: 'hint' }, it.hint) : null
    );
  }

  setActions(items) {
    const bar = this.el.actionbar;
    clear(bar);
    if (!items || !items.length) return show(bar, false);
    for (const it of items) bar.append(this.actionButton(it));
    show(bar, true);
    this.syncBottomHeight();
  }

  /** A prompt with its own buttons (used by planning modes). */
  setPromptBar(text, items = []) {
    const bar = this.el.actionbar;
    clear(bar);
    bar.append(h('div', { class: 'target-prompt' }, text));
    for (const it of items) bar.append(this.actionButton(it));
    show(bar, true);
    this.syncBottomHeight();
  }

  setTargetPrompt(text) {
    const bar = this.el.actionbar;
    clear(bar);
    bar.append(
      h('div', { class: 'target-prompt' }, text),
      h('button', { class: 'act cancel', style: { width: '90px', minHeight: '56px' }, onclick: () => this.onCommand('action', 'cancel') }, h('span', { class: 'ico' }, glyph('close', 2)), h('span', null, 'Cancel'))
    );
    show(bar, true);
  }

  // ------------------------------------------------------------------------------------------
  // Inspector
  // ------------------------------------------------------------------------------------------
  inspect(game, x, y, viewTeam) {
    const box = this.el.inspector;
    const map = game.map;
    if (!map || x < 0 || y < 0 || x >= map.width || y >= map.height) return;

    const visible = viewTeam === null || game.isTileVisible(viewTeam, x, y);
    const explored = viewTeam === null || !game.vision || game.vision.isExplored(viewTeam, x, y);
    const key = `${x},${y},${visible},${explored},${game.units.length},${game.phase},${game.selectedUnit?.id ?? 0}`;
    const sigUnit = game.getUnitAt(x, y);
    const sig = key + (game.selectedUnit?.id ?? '') + (sigUnit ? `${sigUnit.currentHp}|${sigUnit.level}|${sigUnit.x}|${sigUnit.currentMp}|${sigUnit.status?.type ?? ''}` : '') + game.map.tiles[x][y];
    if (this.last.insp === sig) return;
    this.last.insp = sig;

    clear(box);
    box.classList.remove('is-empty');

    if (!explored) {
      box.append(h('div', { class: 'row' }, h('div', { class: 'insp-portrait' }, glyph('fogEye', 3)), h('div', null, h('div', { class: 'insp-name' }, 'Unexplored'), h('div', { class: 'insp-sub' }, `[${x}, ${y}] · send a scout`))));
      return;
    }

    const unit = visible ? sigUnit : null;
    if (unit && unit.currentHp > 0 && game.canSeeUnit(viewTeam ?? unit.team, unit)) box.append(this.unitCard(game, unit, viewTeam), h('div', { class: 'insp-divider' }));
    box.append(this.tileCard(game, x, y, visible));
    this.syncBottomHeight();
  }

  unitCard(game, unit, viewTeam) {
    const stats = getUnitStats(unit);
    const team = TEAMS[unit.team] || TEAMS[0];
    const spr = this.assets.getUnitSprite(unit.index, unit.team);
    const portrait = h('div', { class: 'insp-portrait' }, spr ? spriteCanvas(spr.img, spr.sx, 0, spr.size, spr.size, 44) : null);
    const pct = unit.currentHp / unit.max_hp;
    const abilities = (unit.abilities || []).map(id => this.assets.getAbility(id));
    const status = unit.status ? STATUS_NAMES[unit.status.type]?.split(' (')[0] : null;

    // combat preview when aiming
    let combat = null;
    const sel = game.selectedUnit;
    if (game.phase === 'ATTACK' && sel && unit.team !== sel.team && game.actionTargets.some(t => t.x === unit.x && t.y === unit.y)) {
      const dmg = calculateDamage(game, sel, unit, false);
      const counter = dmg < unit.currentHp && canCounterAttack(sel, unit) ? calculateDamage(game, unit, sel, false) : 0;
      combat = h('div', { class: 'insp-combat' }, dmg >= unit.currentHp ? `Lethal: ~${dmg} damage` : `~${dmg} damage${counter ? ` · counter ~${counter}` : ' · no counter'}`);
    }

    return h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      h(
        'div',
        { class: 'row' },
        portrait,
        h(
          'div',
          { style: { flex: 1, minWidth: 0 } },
          h('div', { class: 'insp-name' }, unit.name, unit.level > 0 ? h('small', null, `LV ${unit.level}`) : null),
          h('div', { class: 'insp-sub' }, h('span', { class: 'team-pill', style: { '--team': team.light } }, team.name), `${unit.currentHp}/${unit.max_hp} HP`, status ? h('span', { class: 'chip warn' }, status) : null),
          h('div', { class: `bar ${pct <= 0.28 ? 'low' : pct <= 0.55 ? 'mid' : ''}`, style: { '--fill': `${pct * 100}%`, marginTop: '5px' } }, h('i'))
        )
      ),
      h(
        'div',
        { class: 'stat-row' },
        h('span', { class: 'stat', title: 'Attack' }, sprite('atk', 1), `${stats.attack}`, h('small', null, unit.attack_type === 0 ? 'PHYS' : 'MAG')),
        h('span', { class: 'stat', title: 'Physical defence' }, sprite('pdef', 1), `${stats.physicalDefence}`),
        h('span', { class: 'stat', title: 'Magic defence' }, sprite('mdef', 1), `${stats.magicDefence}`),
        h('span', { class: 'stat', title: 'Movement left / total' }, glyph('boot', 2), `${unit.currentMp}`, h('small', null, `/${stats.movementPoint}`)),
        h('span', { class: 'stat', title: 'Attack range' }, glyph('target', 2), `${unit.min_attack_range}–${unit.max_attack_range}`)
      ),
      unit.level < 3 && unit.xp ? h('div', { class: 'bar xp', title: `${unit.xp}/100 XP`, style: { '--fill': `${unit.xp}%` } }, h('i')) : null,
      h(
        'div',
        { class: 'chips abil-chips' },
        unit.moveClass && MOVE_CLASSES[unit.moveClass] ? h('span', { class: 'chip gold', title: MOVE_CLASSES[unit.moveClass].blurb }, `Moves: ${MOVE_CLASSES[unit.moveClass].name}`) : null,
        ...abilities.map(a => h('span', { class: 'chip', title: a.description }, a.name))
      ),
      combat
    );
  }

  tileCard(game, x, y, visible) {
    const index = game.map.tiles[x][y];
    const def = this.assets.getTile(index);
    const tiles = this.assets.getTheme(this.themeId).tiles;
    const img = tiles[index];
    const owner = def.team >= 0 ? TEAMS[def.team] : null;
    const terrain = terrainOf(this.assets, index);
    const themed = (TERRAIN_NAMES[this.themeId] || TERRAIN_NAMES.frost)[terrain];
    const name = def.building
      ? this.buildingName(def)
      : def.isCastle
      ? 'Keep'
      : def.isVillage
      ? 'Village'
      : def.isRepairable
      ? 'Ruined Village'
      : themed || TILE_TYPE_NAMES[def.type] || 'Terrain';
    const lines = game.rules.reduce('describeTile', game, [], x, y);
    const chips = [
      h('span', { class: 'chip' }, `Def +${def.defenceBonus}`),
      h('span', { class: 'chip' }, `Move ${def.stepCost}`),
      def.hpRecovery > 0 ? h('span', { class: 'chip good' }, `+${def.hpRecovery} HP`) : null,
      def.isCapturable ? h('span', { class: 'chip gold' }, owner ? `${owner.name} owned` : 'Neutral') : null
    ];
    // what this ground costs the unit you are commanding
    const sel = game.selectedUnit;
    if (sel && sel.team === game.getCurrentTeam()) {
      const cost = getMovementPointCost(game, sel, index);
      chips.push(h('span', { class: `chip ${cost >= 99 ? 'warn' : cost > 1 ? '' : 'good'}`, title: `Movement cost for ${sel.name}` }, cost >= 99 ? `${sel.name}: impassable` : `${sel.name}: ${cost} MP`));
    }
    return h(
      'div',
      { class: 'insp-tile' },
      h('div', { class: 'row' }, img ? spriteCanvas(img, 0, 0, 24, 24, 36) : null, h('div', { style: { flex: 1, minWidth: 0 } }, h('div', { class: 'tname' }, name, ' ', h('small', { style: { color: 'var(--text-mute)', fontSize: '12px' } }, `[${x}, ${y}]`)), h('div', { class: 'chips', style: { marginTop: '4px' } }, ...chips))),
      ...lines.filter(l => l.kind === 'building' || l.kind === 'income' || l.kind === 'supply' || l.kind === 'stage').map(l => h('div', { class: `insp-note ${l.kind}` }, l.text)),
      !visible ? h('div', { class: 'insp-note' }, 'Out of sight — information may be out of date.') : null
    );
  }

  buildingName(def) {
    const stage = def.stage !== undefined && def.building === 'farm' ? ['Tilled Field', 'Growing Farm', 'Ripe Farm'][def.stage] : null;
    if (stage) return stage;
    const map = { camp: 'War Camp', crate: 'Supply Crate', airdrop: 'Airdrop', crate_empty: 'Empty Crate', outpost: 'Outpost', mine: 'Gold Mine', watchtower: 'Watchtower', shrine: 'Shrine of Vigor', forge: 'Forge', library: 'Academy', obelisk: 'Obelisk of Renown', ruins: def.stage ? 'Explored Ruins' : 'Ancient Ruins' };
    return map[def.building] || def.building;
  }

  clearInspector() {
    clear(this.el.inspector);
    this.el.inspector.classList.add('is-empty');
    this.last.insp = null;
  }
}
