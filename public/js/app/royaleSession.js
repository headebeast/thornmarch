// Battle Royale session (client): runs the round loop for the human at the keyboard.
//
//   PLAN     everybody plans at once; the human gives each fighter a destination and an action
//   LOCKED   orders submitted (online: waiting for the other players)
//   RESOLVE  all orders play out together; the player watches what their warband can see
//
// Offline the session owns the clock. Online the server owns it (lockstep): it sends ROUND_PLAN, collects ORDERS, and
// broadcasts every player's orders in ROUND_ORDERS; each client resolves the round locally and reports a state hash.

import { PLAYER_TYPES, TEAMS } from '../config/constants.js';
import { RoyaleRound } from '../modes/royale/round.js';
import { getReachableTiles, getAttackableTargets, getHealableTargets } from '../engine/pathfinding.js';
import { RoyaleHud } from '../ui/royaleHud.js';
import { Modal } from '../ui/modal.js';
import { glyph } from '../ui/icons.js';
import { h } from '../ui/dom.js';
import { LOOT_TEXT } from '../modes/royale/content.js';
import { huntStatus, PING_MEMORY } from '../modes/royale/modules/hunt.js';
import { RecruitShop } from '../ui/recruitShop.js';
import { ECONOMY, HOLDINGS, isHolding, holdingAt, tileOptions, rosterFor, recruitPrice, squadSize, incomeOf, warChestsSealed } from '../modes/royale/holdings.js';

/** Short tags drawn over a fighter's destination for each kind of order. */
const ACT_LABEL = { explore: 'explore', claim: 'claim', recruit: 'recruit', temper: 'forge', study: 'study' };

const wait = ms => new Promise(r => setTimeout(r, ms));

export class RoyaleSession {
  /**
   * @param {import('./App.js').App} app
   * @param {object} match
   * @param {{team:number, net?:object}} opts  `team` = the local human's warband
   */
  constructor(app, match, { team, net = null }) {
    this.app = app;
    this.game = app.game;
    this.match = match;
    this.team = team;
    this.net = net;
    this.round = new RoyaleRound(this.game, match.createAI(this.game));
    this.rhud = new RoyaleHud(app.hud);
    this.shop = new RecruitShop({ assets: app.assets, onBuy: (team, index) => this.buyOrder(index) });
    this.options = []; // what the selected fighter could do at its destination
    this.planMs = (match.royale?.planSeconds || 25) * 1000;
    this.state = 'IDLE';
    this.orders = new Map(); // unitId -> order
    this.selected = null;
    this.mode = 'move'; // 'move' | 'target'
    this.dest = null;
    this.reach = [];
    this.field = null;
    this.targets = [];
    this.deadline = 0;
    this.spectating = false;
    this.destroyed = false;
    this.resultShown = false;
  }

  // ------------------------------------------------------------------------------------------------
  start() {
    const { app, game } = this;
    game.teamNames = { ...game.teamNames, ...this.match.teamNames };
    this.rhud.attach();
    app.renderer.holdingIds = new Set(Object.keys(HOLDINGS));
    this.rhud.setTeam(this.team, game.teamNames[this.team]);
    this.refreshOverlays();
    app.minimap.overlay = (ctx, sx, sy) => this.drawMinimapOverlay(ctx, sx, sy);
    this.beginRound();
  }

  destroy() {
    this.destroyed = true;
    this.rhud.detach();
    this.shop.modal.destroy();
    this.app.renderer.plan = null;
    this.app.renderer.stormView = null;
    this.app.renderer.huntView = null;
    this.app.renderer.holdingIds = null;
    this.app.minimap.overlay = null;
    this.result?.destroy();
  }

  get alive() {
    return !this.game.players[this.team].eliminated;
  }

  squad() {
    return this.game.units.filter(u => u.team === this.team && u.currentHp > 0).sort((a, b) => a.id - b.id);
  }

  teamName(t) {
    return this.game.teamNames?.[t] || TEAMS[t]?.name || `Team ${t + 1}`;
  }

  // ------------------------------------------------------------------------------------------------
  // Round loop
  // ------------------------------------------------------------------------------------------------
  beginRound() {
    const g = this.game;
    this.round.beginRound();
    this.refreshOverlays();
    this.orders.clear();
    this.deselect();
    if (g.phase === 'GAME_OVER') return this.finish();
    if (this.net) {
      this.state = 'WAIT_PLAN'; // the server starts the clock once every client has caught up
      this.pushHud();
    } else this.startPlan(this.planMs);
  }

  startPlan(ms) {
    this.round.planBots();
    this.state = 'PLAN';
    this.planMs = ms;
    this.deadline = performance.now() + ms;
    this.game.currentTeamIndex = this.game.activeTeams.indexOf(this.team);
    this.setPlanView();
    this.pushHud();
    if (!this.alive) return this.lock(); // spectating: nothing to plan
    const sq = this.squad();
    if (this.round.round === 1) {
      const gold = this.game.players[this.team].gold;
      this.app.hud.toast(`${gold} gold: to spend — press Recruit… at your War Camp, or march on the Gold Mine nearby`, 'good');
    }
    else if (this.game.hunt.horn) this.app.hud.toast(this.game.hunt.final ? 'Final hunt — every warband is marked' : 'War horn! Every warband is marked on the map', 'good');
    else this.app.hud.toast(`Round ${this.round.round} — plan your moves`);
    if (!sq.length) this.lock();
    // round one: put the first decision on screen — the fighter standing on the War Camp, with "Recruit…" one tap away
    else if (this.round.round === 1) {
      const onCamp = sq.find(u => tileOptions(this.game, u).some(o => o.id === 'recruit'));
      if (onCamp) this.select(onCamp);
    }
  }

  /** Called every frame by the app. */
  tick(now) {
    if (this.destroyed) return;
    if (this.state === 'PLAN') {
      this.pushHud(now);
      if (!this.net && now >= this.deadline) this.lock();
    }
  }

  lock() {
    if (this.state !== 'PLAN') return;
    this.state = 'LOCKED';
    this.deselect();
    const orders = [...this.orders.values()].map(o => ({ unitId: o.unitId, move: o.move, act: o.act }));
    this.app.renderer.plan = null;
    this.app.hud.setActions(null);
    this.pushHud();
    if (this.net) this.net.sendGameAction({ type: 'ORDERS', round: this.round.round, orders });
    else this.resolveRound({ [this.team]: orders });
  }

  async resolveRound(humanOrders) {
    if (this.destroyed) return;
    this.state = 'RESOLVE';
    this.app.renderer.plan = null;
    this.pushHud();
    const watching = this.spectating;
    await this.round.resolve(humanOrders, {
      viewTeam: watching ? null : this.team,
      pace: ms => (watching || this.destroyed ? Promise.resolve() : wait(ms))
    });
    if (this.destroyed) return;
    const over = this.round.endRound();
    this.refreshOverlays();
    this.afterRound();
    if (this.net) this.net.sendGameAction({ type: 'ROUND_DONE', round: this.round.round, hash: this.round.stateHash() });
    this.app.onGameChanged(true);
    if (over) return this.finish();
    if (!this.alive && !this.resultShown && !this.spectating) {
      this.resultShown = true;
      if (this.net) {
        // never hold up the other players' clock: spectate straight away
        this.startSpectating();
        this.app.hud.toast(`Eliminated — #${this.placementOf()} of ${this.game.activeTeams.length}. Spectating.`, 'warn');
      } else {
        await this.showEliminated(); // pauses until the player chooses
        if (this.destroyed) return;
      }
    }
    if (this.spectating) await wait(this.net ? 400 : 900);
    this.beginRound();
  }

  afterRound() {
    this.pushHud();
  }

  placementOf() {
    const e = this.game.royale.eliminated.find(x => x.team === this.team);
    return e ? e.placement : this.round.aliveTeams().length + 1;
  }

  // ------------------------------------------------------------------------------------------------
  // Online messages
  // ------------------------------------------------------------------------------------------------
  onNet(msg) {
    if (msg.type === 'ROUND_PLAN') {
      if (msg.botTeams) for (const t of msg.botTeams) if (this.game.players[t]) this.game.players[t].type = PLAYER_TYPES.AI;
      if (this.state === 'WAIT_PLAN' && msg.round === this.round.round) this.startPlan(msg.ms);
    } else if (msg.type === 'ROUND_ORDERS') {
      if (msg.round === this.round.round && (this.state === 'LOCKED' || this.state === 'PLAN' || this.state === 'WAIT_PLAN')) {
        if (this.state === 'PLAN') this.lockSilently();
        this.resolveRound(msg.orders || {});
      }
    } else if (msg.type === 'DESYNC') {
      this.app.hud.toast('Game state diverged from the server — please rejoin.', 'warn');
    }
  }

  lockSilently() {
    this.state = 'LOCKED';
    this.deselect();
    this.app.renderer.plan = null;
    this.app.hud.setActions(null);
  }

  // ------------------------------------------------------------------------------------------------
  // Planning input
  // ------------------------------------------------------------------------------------------------
  onTap(tx, ty, pointerType) {
    if (this.state !== 'PLAN' || !this.alive) return;
    const g = this.game;
    const r = this.app.renderer;
    const unitAt = g.getUnitAtFor(this.team, tx, ty);
    const own = unitAt && unitAt.team === this.team && unitAt.currentHp > 0 ? unitAt : null;

    // touch: first tap previews (path / damage), second tap commits
    if (pointerType === 'touch' && this.selected) {
      const valid = this.mode === 'move' ? this.reach.some(p => p.x === tx && p.y === ty) : this.targets.some(t => t.x === tx && t.y === ty);
      if (valid && !(r.hover.x === tx && r.hover.y === ty)) {
        r.hover = { x: tx, y: ty };
        return;
      }
    }

    if (this.mode === 'target' && this.selected) {
      const t = this.targets.find(q => q.x === tx && q.y === ty);
      if (t) return this.setAct(t.kind === 'heal' ? { type: 'heal', targetId: t.unit.id } : { type: 'attack', targetId: t.unit.id }, t.unit);
      if (own && own !== this.selected) return this.select(own);
      return this.finishOrder(); // tapped elsewhere: keep the move, no attack
    }

    if (this.selected) {
      if (this.reach.some(p => p.x === tx && p.y === ty)) return this.setMove(tx, ty);
      if (own) return this.select(own);
      return this.deselect();
    }
    if (own) this.select(own);
  }

  select(unit) {
    this.selected = unit;
    const { reachable, field } = getReachableTiles(this.game, unit);
    this.reach = reachable;
    this.field = field;
    this.mode = 'move';
    this.dest = null;
    this.targets = [];
    this.setPlanView();
    const has = this.orders.has(unit.id);
    this.app.hud.setPromptBar(`${unit.name}: pick a destination`, [
      ...this.optionItems(unit, unit.x, unit.y),
      { id: 'r:hold', label: 'Hold', hint: 'stay and fight', iconNode: glyph('hourglass', 3) },
      ...(has ? [{ id: 'r:clear', label: 'Clear order', iconNode: glyph('close', 3) }] : []),
      { id: 'r:cancel', label: 'Back', cancel: true, iconNode: glyph('back', 3) }
    ]);
    this.app.inspectAt(unit.x, unit.y);
  }

  deselect() {
    this.selected = null;
    this.mode = 'move';
    this.dest = null;
    this.reach = [];
    this.targets = [];
    this.field = null;
    if (this.state === 'PLAN') {
      this.setPlanView();
      this.app.hud.setActions(null);
    }
  }

  orderFor(unit) {
    let o = this.orders.get(unit.id);
    if (!o) {
      o = { unitId: unit.id, move: null, act: null };
      this.orders.set(unit.id, o);
    }
    return o;
  }

  setMove(x, y) {
    const u = this.selected;
    const o = this.orderFor(u);
    o.move = x === u.x && y === u.y ? null : { x, y };
    o.act = null;
    this.dest = { x, y };
    const g = this.game;
    const enemies = getAttackableTargets(g, u, x, y).filter(t => t.type === 'unit').map(t => ({ x: t.x, y: t.y, unit: t.unit, kind: 'attack' }));
    const heals = getHealableTargets(g, u, x, y).map(t => ({ x: t.x, y: t.y, unit: t.unit, kind: 'heal' }));
    this.targets = [...enemies, ...heals];
    this.options = tileOptions(g, u, x, y, this.spare(u));
    // the obvious one-tap thing happens by default (claim it, explore it); the player can still pick a fight or skip it
    const obvious = this.options.find(opt => opt.ok && opt.id !== 'recruit');
    if (obvious) o.act = { type: obvious.id };
    if (this.targets.length || this.options.length) {
      this.mode = 'target';
      this.setPlanView();
      const items = [...this.optionItems(u, x, y, this.options), { id: 'r:noact', label: this.targets.length ? 'No action' : 'Do nothing', iconNode: glyph('hourglass', 3) }];
      this.app.hud.setPromptBar(this.targets.length ? 'Choose a target — or pick an action' : `${u.name}: what now?`, items);
    } else this.finishOrder();
  }

  setAct(act, targetUnit) {
    const o = this.orderFor(this.selected);
    o.act = act;
    o.targetId = targetUnit?.id;
    this.finishOrder();
  }

  finishOrder() {
    this.deselect();
    this.pushHud();
  }

  onAction(id) {
    if (this.state !== 'PLAN' || !this.selected) return;
    if (id === 'r:hold') {
      this.orders.set(this.selected.id, { unitId: this.selected.id, move: null, act: null });
      this.app.renderer.hover = { x: -1, y: -1 };
      // a held unit still shoots whoever is in reach
      this.dest = { x: this.selected.x, y: this.selected.y };
      return this.setMove(this.selected.x, this.selected.y);
    }
    if (id === 'r:clear') {
      this.orders.delete(this.selected.id);
      return this.finishOrder();
    }
    if (id === 'r:cancel') return this.deselect();
    if (id === 'r:noact') {
      const o = this.orderFor(this.selected);
      o.act = null;
      return this.finishOrder();
    }
    if (id.startsWith('r:b:')) return this.buildingAction(id.slice(4));
  }

  /** A building option chosen from the prompt bar (claim, recruit, forge, study, explore). */
  buildingAction(kind) {
    const u = this.selected;
    const o = this.orderFor(u);
    if (this.mode === 'move') {
      // picked straight after selecting: the fighter stays where it is
      o.move = null;
      this.dest = { x: u.x, y: u.y };
    }
    if (kind === 'recruit') return this.openShop();
    o.act = { type: kind };
    this.finishOrder();
  }

  /** Where the selected fighter will be standing when it acts. */
  at() {
    return this.mode === 'target' && this.dest ? this.dest : { x: this.selected.x, y: this.selected.y };
  }

  /** Gold and squad places this round's OTHER orders already commit, so two fighters cannot spend the same coin. */
  spare(unit) {
    const g = this.game;
    let gold = g.players[this.team].gold;
    let recruits = 0;
    for (const [id, order] of this.orders) {
      if (id === unit.id || !order.act) continue;
      if (order.act.type === 'recruit') {
        gold -= recruitPrice(g, this.team, g.assets.getUnitTemplate(order.act.item));
        recruits++;
      } else if (order.act.type === 'temper') gold -= HOLDINGS.forge.cost;
    }
    return { gold, recruits };
  }

  /** Prompt-bar buttons for what `unit` could do on (x, y). */
  optionItems(unit, x, y, options = tileOptions(this.game, unit, x, y, this.spare(unit))) {
    return options.map(o => ({ id: `r:b:${o.id}`, label: o.label, hint: o.ok ? o.hint : o.reason, cost: o.ok ? o.cost : 0, icon: o.icon, primary: o.primary && o.ok, disabled: !o.ok }));
  }

  openShop() {
    const g = this.game;
    const u = this.selected;
    const pos = this.at();
    const hold = holdingAt(g, pos.x, pos.y);
    if (!hold?.def.recruit) return;
    const spare = this.spare(u);
    this.shop.open(g, this.team, pos.x, pos.y, {
      title: `${hold.def.name} — recruit a fighter`,
      roster: rosterFor(g, hold.def.recruit),
      price: tpl => recruitPrice(g, this.team, tpl),
      supply: () => `${squadSize(g, this.team) + spare.recruits}/${ECONOMY.squadCap}`,
      check: tpl => {
        const price = recruitPrice(g, this.team, tpl);
        if (warChestsSealed(g)) return { ok: false, reason: 'Recruiting is closed' };
        if (squadSize(g, this.team) + spare.recruits >= ECONOMY.squadCap) return { ok: false, reason: `Warband is full (${ECONOMY.squadCap})` };
        if (spare.gold < price) return { ok: false, reason: 'Not enough gold' };
        return { ok: true, price };
      }
    });
  }

  /** The shop's answer: the fighter on the building will train this recruit when the round resolves. */
  buyOrder(index) {
    if (!this.selected || this.state !== 'PLAN') return;
    const o = this.orderFor(this.selected);
    o.act = { type: 'recruit', item: index };
    this.finishOrder();
  }

  cancel() {
    if (this.selected) this.deselect();
  }

  /** Give every unit without an order a sensible default: bot-style planning for the local team ("auto-plan"). */
  autoPlan() {
    if (this.state !== 'PLAN') return;
    const planned = this.round.planner.planTeam(this.game, this.team);
    for (const o of planned) if (!this.orders.has(o.unitId)) this.orders.set(o.unitId, { unitId: o.unitId, move: o.move, act: o.act });
    this.deselect();
    this.pushHud();
  }

  // ------------------------------------------------------------------------------------------------
  // View state
  // ------------------------------------------------------------------------------------------------
  setPlanView() {
    const r = this.app.renderer;
    if (this.state !== 'PLAN' && !(this.state === 'IDLE')) return;
    const orders = [];
    for (const o of this.orders.values()) {
      const unit = this.game.units.find(u => u.id === o.unitId);
      if (!unit || unit.currentHp <= 0) continue;
      const tgt = o.act?.targetId ? this.game.units.find(u => u.id === o.act.targetId) : null;
      orders.push({ unit, move: o.move, target: tgt && tgt.currentHp > 0 ? { x: tgt.x, y: tgt.y } : null, label: ACT_LABEL[o.act?.type] || null });
    }
    r.plan = { selected: this.selected, mode: this.mode, reachable: this.reach, pathField: this.field, dest: this.dest, targets: this.targets, orders, squad: this.squad() };
  }

  /** Hand the renderer the round's zone (only when a storm runs) and war-horn markers. */
  refreshOverlays() {
    const { game } = this;
    const st = game.storm;
    if (st) this.app.renderer.stormView = { current: st.current, next: st.next };
    const hunt = game.hunt;
    this.app.renderer.huntView = hunt?.pings.length
      ? { pings: this.pingsForMe(hunt), round: hunt.round, pingRound: hunt.pingRound, memory: PING_MEMORY }
      : null;
  }

  /** The horn marks everyone; you do not need a marker on your own warband (spectators see all of them). */
  pingsForMe(hunt) {
    return this.spectating || !this.alive ? hunt.pings : hunt.pings.filter(p => p.team !== this.team);
  }

  stormText() {
    const st = this.game.storm;
    if (!st) return '';
    if (st.suddenDeath) return 'SUDDEN DEATH';
    if (!st.next) return 'Final circle';
    const n = st.roundsToShrink;
    return n <= 0 ? 'Closing now' : n === 1 ? 'Closes next round' : `Closes in ${n} rounds`;
  }

  pushHud(now = performance.now()) {
    const g = this.game;
    const st = g.storm;
    const squad = this.squad();
    const inStorm = st && squad.some(u => Math.hypot(u.x - st.current.x, u.y - st.current.y) > st.current.r);
    this.rhud.update({
      round: this.round.round,
      state: this.state,
      left: Math.max(0, (this.deadline - now) / 1000),
      total: this.planMs / 1000,
      alive: this.round.aliveTeams().length,
      teams: g.activeTeams.length,
      kills: g.royale?.kills?.[this.team] ?? 0,
      stormText: this.stormText(),
      closing: st && st.next && st.roundsToShrink <= 1,
      inStorm,
      hunt: huntStatus(g),
      gold: g.players[this.team]?.gold ?? 0,
      income: incomeOf(g, this.team),
      squadMax: ECONOMY.squadCap,
      orders: this.orders.size,
      squad: squad.length
    });
    if (this.state === 'PLAN') this.setPlanView();
  }

  drawMinimapOverlay(ctx, sx, sy) {
    this.drawMinimapStorm(ctx, sx, sy);
    this.drawMinimapHoldings(ctx, sx, sy);
    this.drawMinimapPings(ctx, sx, sy);
  }

  /** Buildings you know about: a banner-coloured square when held, a hollow gold one while up for grabs. */
  drawMinimapHoldings(ctx, sx, sy) {
    const g = this.game;
    const vis = g.vision && !g.vision.revealAll ? g.vision : null;
    const me = this.spectating || !this.alive ? null : this.team;
    for (const s of g.structures) {
      const tile = g.assets.getTile(g.map.tiles[s.x][s.y]);
      if (!isHolding(tile.building)) continue;
      const owner = g.holds?.[s.y * g.map.width + s.x] ?? -1;
      const seen = !vis || me === null || owner === me || vis.isVisible(me, s.x, s.y);
      if (vis && me !== null && !seen && !vis.isExplored(me, s.x, s.y)) continue;
      const x = Math.round(s.x * sx);
      const y = Math.round(s.y * sy);
      const size = tile.building === 'camp' ? 5 : 3;
      if (owner >= 0 && seen) {
        ctx.fillStyle = '#0a0d16';
        ctx.fillRect(x - 1, y - 1, size + 2, size + 2);
        ctx.fillStyle = TEAMS[owner]?.light || '#fff';
        ctx.fillRect(x, y, size, size);
      } else {
        ctx.strokeStyle = '#ffe08a';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
      }
    }
  }

  /** War-horn markers: a banner-coloured ring and dot for every warband the horn revealed. */
  drawMinimapPings(ctx, sx, sy) {
    const hunt = this.game.hunt;
    const view = this.app.renderer.huntView;
    if (!hunt || !view) return;
    const age = hunt.round - hunt.pingRound;
    ctx.save();
    ctx.globalAlpha = age <= 0 ? 1 : Math.max(0.3, 1 - age / (PING_MEMORY + 1));
    for (const p of view.pings) {
      const t = TEAMS[p.team] || TEAMS[0];
      const x = (p.x + 0.5) * sx;
      const y = (p.y + 0.5) * sy;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = t.light;
      ctx.beginPath();
      ctx.arc(x, y, 4.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = t.color;
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawMinimapStorm(ctx, sx, sy) {
    const st = this.game.storm;
    if (!st) return;
    const ring = (z, color, dash) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.ellipse((z.x + 0.5) * sx, (z.y + 0.5) * sy, z.r * sx, z.r * sy, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    };
    ring(st.current, '#d19cff', []);
    if (st.next) ring(st.next, '#ffffff', [3, 3]);
  }

  // ------------------------------------------------------------------------------------------------
  // Events & results
  // ------------------------------------------------------------------------------------------------
  onGameEvent(type, data) {
    const g = this.game;
    if (type === 'eliminated') {
      const by = data.by >= 0 ? `by ${this.teamName(data.by)}` : this.game.storm ? 'in the storm' : 'on the island';
      this.rhud.feedAdd(`${this.teamName(data.team)} eliminated ${by} · ${data.placement - 1} left`, 'kill', TEAMS[data.team]?.light);
    } else if (type === 'storm') {
      this.rhud.feedAdd('The storm is closing in!', 'storm');
    } else if (type === 'claim') {
      const mine = data.team === this.team;
      if (mine) this.rhud.feedAdd(`You claimed the ${data.name}`, 'claim', TEAMS[this.team]?.light);
      else if (data.from === this.team) this.rhud.feedAdd(`${this.teamName(data.team)} seized your ${data.name}!`, 'kill', TEAMS[data.team]?.light);
      else if (this.game.isTileVisible(this.team, data.x, data.y)) this.rhud.feedAdd(`${this.teamName(data.team)} claimed a ${data.name}`, 'claim', TEAMS[data.team]?.light);
    } else if (type === 'recruit') {
      if (data.team === this.team) this.rhud.feedAdd(`${data.unit.name} joins your warband (−${data.price}g)`, 'claim', TEAMS[this.team]?.light);
    } else if (type === 'sealed') {
      this.rhud.feedAdd('The war chests are sealed — no more reinforcements', 'horn');
      this.app.hud.toast('War chests sealed — what is left on the island is all there will be', 'warn');
    } else if (type === 'horn') {
      this.rhud.feedAdd(data.final ? `Final hunt — ${data.warbands} warbands left, all marked` : `War horn — all ${data.warbands} warbands marked`, 'horn');
    } else if (type === 'spoils' && data.wiped) {
      this.rhud.feedAdd(`${this.teamName(data.team)} fell — their arsenal is marked on the map`, 'drop');
    } else if (type === 'airdrop') {
      this.rhud.feedAdd('Airdrop incoming — marked on the map!', 'drop');
    } else if (type === 'loot' && data.unit.team === this.team) {
      this.rhud.feedAdd(`${LOOT_TEXT[data.id].label}: ${LOOT_TEXT[data.id].detail}`, 'drop');
    }
  }

  /** Offline: modal that resolves when the player picks "watch" or leaves. */
  showEliminated() {
    return new Promise(resolve => {
      const e = this.game.royale.eliminated.find(x => x.team === this.team);
      const m = (this.result = new Modal({ title: 'Warband eliminated', width: 460, dismissable: false, disposable: true }));
      m.body.append(
        h(
          'div',
          { class: 'victory-card' },
          h('div', { class: 'eyebrow' }, 'Final standing'),
          h('h2', null, `#${this.placementOf()} of ${this.game.activeTeams.length}`),
          h('p', { style: { color: 'var(--text-dim)' } }, `Survived ${e?.round ?? this.round.round} rounds · ${this.game.royale.kills[this.team] || 0} kills`),
          h(
            'div',
            { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' } },
            h('button', { class: 'btn', onclick: () => (this.startSpectating(), resolve()) }, 'Watch the rest'),
            h('button', { class: 'btn btn-gold', onclick: () => (this.app.leaveToMenu(), resolve()) }, 'Back to menu')
          )
        )
      );
      m.open();
    });
  }

  startSpectating() {
    this.spectating = true;
    this.result?.close();
    const g = this.game;
    if (g.vision) g.vision.revealAll = true;
    this.app.renderer.setViewTeam(null);
    this.app.viewTeam = null;
    this.app.hud.toast('Spectating — the island is fully revealed');
  }

  finish() {
    this.state = 'OVER';
    this.net?.sendGameAction({ type: 'MATCH_END' });
    this.pushHud();
    this.app.hud.setActions(null);
    const g = this.game;
    if (this.result) this.result.close();
    const won = g.winnerTeam === this.team;
    const e = g.royale.eliminated.find(x => x.team === this.team);
    const timed = g.royale.endedBy === 'time'; // nobody finished the hunt: the strongest warband was named
    const ranked = timed ? g.royale.standings.indexOf(this.team) + 1 : 0;
    const placement = won ? 1 : e?.placement ?? (ranked || g.activeTeams.length);
    const m = (this.result = new Modal({ title: won ? 'Victory' : 'Battle over', width: 480, dismissable: false, disposable: true }));
    m.body.append(
      h(
        'div',
        { class: 'victory-card' },
        h('div', { class: 'eyebrow' }, timed ? 'Time called · strongest warband' : won ? 'Last banner standing' : 'The island has a winner'),
        h('h2', { style: { color: TEAMS[g.winnerTeam]?.light } }, won ? 'YOUR WARBAND WINS' : `${this.teamName(g.winnerTeam).toUpperCase()} WINS`),
        h('p', { style: { color: 'var(--text-dim)' } }, `You finished #${placement} of ${g.activeTeams.length} · ${g.royale.kills[this.team] || 0} kills · ${this.round.round} rounds`),
        h('button', { class: 'btn btn-gold', onclick: () => this.app.leaveToMenu() }, 'Return to menu')
      )
    );
    m.open();
  }
}
