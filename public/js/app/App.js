// Composition root — wires the platform-agnostic core (engine, rules, modes, AI) to the browser shell
// (canvas renderer, camera, pointer input, HUD, menus, network). Nothing here holds game rules.

import { PLAYER_TYPES, TEAMS } from '../config/constants.js';
import { AssetLoader } from '../data/assetLoader.js';
import { SoundManager } from '../audio/soundManager.js';
import { GameEngine } from '../engine/gameState.js';
import { installModeContent, getMode, listModes } from '../modes/registry.js';
import '../modes/classic.js';
import '../modes/frontier/index.js';
import '../modes/royale/index.js';
import { MapEditor } from '../editor/mapEditor.js';
import { MultiplayerClient } from '../network/multiplayerClient.js';
import { Camera } from '../renderer/camera.js';
import { CanvasRenderer } from '../renderer/canvasRenderer.js';
import { Minimap } from '../renderer/minimap.js';
import { PointerController } from '../input/pointerController.js';
import { platform } from '../platform/platform.js';
import { generateFrontierMap } from '../modes/frontier/mapGenerator.js';
import { Hud } from '../ui/hud.js';
import { RoyaleSession } from './royaleSession.js';
import { MainMenu } from '../ui/mainMenu.js';
import { ModeSetup } from '../ui/modeSetup.js';
import { RecruitShop } from '../ui/recruitShop.js';
import { Codex } from '../ui/codex.js';
import { Lobby } from '../ui/lobby.js';
import { CampaignPicker } from '../ui/campaignPicker.js';
import { EditorPanel } from '../ui/editorPanel.js';
import { Modal, hasOpenModal } from '../ui/modal.js';
import { createBackdrop } from '../ui/mapPreview.js';
import { h, show } from '../ui/dom.js';
import { glyph } from '../ui/icons.js';
import { deploy } from '../config/deploy.js';
import { AboutBox } from '../ui/about.js';
import { SettingsBox } from '../ui/settings.js';
import { UpdateBanner } from '../ui/updateBanner.js';
import { UpdateConfirm } from '../ui/updateConfirm.js';
import { createInstallButton } from '../ui/installControl.js';
import { createPwa } from '../pwa/pwa.js';
import { PerfOverlay } from '../ui/perfOverlay.js';
import { PerfMonitor } from '../platform/perfMonitor.js';
import { settings } from '../config/settings.js';
import { Tracker } from '../analytics/tracker.js';
import { consent } from '../analytics/consent.js';
import { ConsentBanner } from '../ui/consentBanner.js';

const TARGETING = ['ATTACK', 'SUMMON', 'HEAL', 'CUSTOM'];

const ACTION_INFO = {
  attack: { label: 'Attack', icon: 'attack', hotkey: 'A', primary: true },
  occupy: { label: 'Capture', icon: 'occupy', hotkey: 'C', primary: true },
  repair: { label: 'Repair', icon: 'hammer', hotkey: 'C', primary: true },
  summon: { label: 'Summon', icon: 'summon', hotkey: 'S' },
  heal: { label: 'Heal', icon: 'heal', hotkey: 'H' },
  buy: { label: 'Recruit', icon: 'buy', hotkey: 'B' },
  standby: { label: 'Wait', icon: null, hotkey: 'Space', glyph: 'hourglass' }
};

export class App {
  /** @param {{pwa?: ReturnType<typeof createPwa>}} o  main.js starts the PWA layer before the game; without it the app makes (and starts) its own */
  constructor({ pwa = null } = {}) {
    this.ownsPwa = !pwa;
    this.pwa = pwa || createPwa();
    this.assets = new AssetLoader();
    this.sound = new SoundManager();
    this.canvas = document.getElementById('game-canvas');
    this.camera = new Camera();
    this.renderer = new CanvasRenderer(this.canvas, this.assets, this.camera);
    this.game = new GameEngine(
      this.assets,
      this.sound,
      () => this.onGameChanged(),
      (x, y, text, color) => this.renderer.addFloatingText(x, y, text, color),
      (type, data) => this.onGameEvent(type, data)
    );
    this.editor = new MapEditor(this.assets);
    this.net = new MultiplayerClient(ev => this.onNet(ev));
    this.perf = new PerfMonitor();
    this.tracker = new Tracker({ perf: this.perf, getNet: () => this.net.stats, isOnline: () => this.net.connected });
    this.lastResult = null; // how the current match ended, for the usage statistics

    this.match = null;
    this.ai = null;
    this.viewTeam = null;
    this.themeId = 'frost';
    this.keys = new Set();
    this.previewTouch = null;
    this.lastTurnTeam = null;
    this.running = false;
    this.royale = null; // Battle Royale session, when one is running
  }

  // ---------------------------------------------------------------------------------------------
  async start() {
    this.renderer.resize();
    await this.assets.loadAll((pct, msg) => {
      document.getElementById('loading-bar-fill').style.width = `${pct}%`;
      document.getElementById('loading-status').textContent = msg;
    });

    // canvas text (damage numbers, HP) needs the pixel face loaded before first use
    try {
      await document.fonts.load('20px "Jersey 15"');
    } catch (_) {
      /* fall back to system fonts */
    }

    // Content packs declared by modes: data first, then their procedural art
    installModeContent(this.assets);
    const artInstalled = new Set();
    for (const mode of listModes()) {
      for (const pack of mode.contentPacks || []) {
        const art = mode.art?.[pack.id];
        if (art && !artInstalled.has(pack.id)) {
          this.assets.installPackArt(pack, art);
          artInstalled.add(pack.id);
        }
      }
    }

    if (this.ownsPwa) this.pwa.start();
    this.buildUi();
    this.bindInput();
    this.bindWindow();
    this.tracker.init();
    this.consentBanner = this.tracker.available ? new ConsentBanner({ onChoose: state => consent.set(state) }) : null;
    this.showMenu();
    document.getElementById('loading-overlay').classList.add('hidden');
    this.running = true;
    requestAnimationFrame(t => this.frame(t));

    // home-screen shortcuts open straight at a mode's setup: /?play=royale
    const play = new URLSearchParams(location.search).get('play');
    if (['royale', 'frontier', 'skirmish'].includes(play)) this.openSetup(play);

    const room = new URLSearchParams(location.search).get('room');
    if (room && deploy.online) {
      this.lobby.open();
      setTimeout(() => this.net.joinRoom(room), 500);
    }
  }

  buildUi() {
    const a = this.assets;
    const cmd = (name, arg) => this.onCommand(name, arg);

    // an always-ready realm for the animated menu backdrop and the featured card
    const fr = getMode('frontier');
    const backdropMap = generateFrontierMap({ size: 48, players: 2, seed: 'WELCOME', theme: 'meadow' }, a, a.autotile);
    this.installButton = createInstallButton({ install: this.pwa.install, notify: text => this.hud.toast(text, 'good') });
    this.menu = new MainMenu({ assets: a, platform, backdropMap, extraFoot: [this.installButton.node], onChoose: id => this.onMenu(id) });
    this.menu.mount();
    this.backdrop = createBackdrop(this.menu.canvas, a, backdropMap);

    this.hud = new Hud({ assets: a, platform, onCommand: cmd });
    this.hud.mount();
    this.minimap = new Minimap(this.hud.el.minimapCanvas, a, this.camera, (tx, ty) => this.camera.focus(tx, ty, this.camera.ts, true));

    this.shop = new RecruitShop({ assets: a, onBuy: (team, idx, x, y) => this.recruit(team, idx, x, y) });
    this.codex = new Codex({ assets: a });
    this.campaign = new CampaignPicker({ assets: a, onPlay: id => this.startMode('campaign', { mapId: id }) });
    this.editorPanel = new EditorPanel({
      assets: a,
      editor: this.editor,
      themeId: () => 'frost',
      onSave: name => this.saveEditorMap(name),
      onPlay: name => this.playEditorMap(name),
      onExit: () => this.showMenu(),
      onResize: (w, hgt) => {
        this.editor.resize(w, hgt);
        this.camera.setMap(this.editor.map);
        this.camera.fit();
        this.editorPanel.render();
      }
    });
    this.editorPanel.mount();

    this.lobby = new Lobby({
      net: this.net,
      modes: listModes().filter(m => m.id !== 'campaign'),
      copy: t => platform.copy(t),
      onHost: id => this.hostOnline(id),
      onStartMatch: () => this.net.startMatch()
    });

    this.settingsBox = new SettingsBox({ onErase: () => this.tracker.forget(), pwa: this.pwa, notify: text => this.hud.toast(text, 'good') });
    // the update announcement: the controller decides WHEN, these draw it and ask before anything reloads
    this.updateConfirm = new UpdateConfirm();
    this.pwa.updates.attach({ confirm: view => this.updateConfirm.ask(view), context: () => this.busyContext() });
    this.updateBanner = new UpdateBanner({ controller: this.pwa.updates, anchor: () => this.hud.el.top, notify: text => this.hud.toast(text, 'good') });
    this.perfOverlay = new PerfOverlay({ perf: this.perf, getNet: () => this.net.stats, isOnline: () => this.net.connected, anchor: () => this.hud.el.top });
    const applySettings = () => this.perfOverlay.configure({ showFps: settings.get('showFps'), showNet: settings.get('showNet') });
    settings.subscribe(applySettings);
    applySettings();

    this.victory = new Modal({ title: 'Battle over', width: 460, dismissable: false });
    this.victoryTitle = h('h2', null, '');
    this.victorySub = h('p', { style: { color: 'var(--text-dim)' } }, '');
    this.victory.body.append(h('div', { class: 'victory-card' }, this.victoryTitle, this.victorySub, h('button', { class: 'btn btn-gold', onclick: () => (this.victory.close(), this.showMenu()) }, 'Return to menu')));

    this.cover = h('div', { class: 'modal-backdrop hidden', style: { zIndex: 150, background: 'rgba(4,6,12,0.97)' } });
    document.body.appendChild(this.cover);
  }

  // ---------------------------------------------------------------------------------------------
  // Menu & modes
  // ---------------------------------------------------------------------------------------------
  onMenu(id) {
    this.sound.playPrompt();
    if (id === 'campaign') this.campaign.open();
    else if (id === 'skirmish' || id === 'frontier' || id === 'royale') this.openSetup(id);
    else if (id === 'online') this.lobby.open();
    else if (id === 'editor') this.startEditor();
    else if (id === 'codex') this.codex.open();
    else if (id === 'fullscreen') this.onCommand('fullscreen');
    else if (id === 'audio') this.onCommand('audio');
    else if (id === 'about') (this.about ??= new AboutBox()).open();
    else if (id === 'settings') this.settingsBox.open();
  }

  openSetup(modeId) {
    const mode = getMode(modeId);
    new ModeSetup({
      assets: this.assets,
      mode,
      startLabel: modeId === 'frontier' ? 'Enter the Frontier' : 'Begin Battle',
      onStart: config => this.startMode(modeId, config)
    }).open();
  }

  startMode(modeId, config) {
    const mode = getMode(modeId);
    const match = mode.createMatch(config, this.assets);
    this.beginMatch(match);
  }

  beginMatch(match) {
    this.editor.active = false;
    this.editorPanel.show(false);
    this.match = match;
    this.lastResult = null;
    this.consentBanner?.hide();
    this.tracker.screen(`play:${match.modeId}`);
    this.tracker.playStart(match.modeId, { players: String(match.mapData?.activeTeams?.length ?? ''), online: String(!!match.online) });
    this.themeId = match.view?.theme || 'frost';
    this.lastTurnTeam = null;
    this.previewTouch = null;
    this.ai = match.createAI(this.game);

    this.menu.show(false);
    this.backdrop.stop();
    const modeDef = getMode(match.modeId);
    this.hud.setTheme(this.themeId);
    this.hud.configure({ supply: true, ...(modeDef?.hud || {}) });
    this.hud.setVisible(true);
    this.hud.setAudio(this.sound.muted);
    this.hud.clearInspector();

    // Seat the local viewpoint before the first turn so fog and AI pacing are right from move one
    this.viewTeam = null;
    this.game.initGame(match.mapData, match.playerConfig, { ...match.options, rules: match.rules });
    this.renderer.setMatch(this.game, this.themeId);
    this.minimap.setGame(this.game, this.viewTeam);
    this.updateViewTeam();
    this.applyInsets();

    if (match.view?.focus === 'commander') {
      const cmdr = this.game.units.find(u => u.team === this.viewTeam && u.isCommander) || this.game.units.find(u => u.team === this.viewTeam);
      this.camera.focus(cmdr?.x ?? 0, cmdr?.y ?? 0, this.camera.focusTs(), false);
    } else this.camera.fit(false);

    this.sound.playMusic('good');
    this.hud.showBanner(this.game.campaignMeta);
    this.hud.toast(match.title, 'good');
    platform.keepAwake();

    if (this.game.simultaneous) {
      // Battle Royale: everyone plans at once; the session owns the round loop
      const localTeam = match.online && this.net.assignedTeam !== null ? this.net.assignedTeam : Number(Object.keys(match.playerConfig).find(t => match.playerConfig[t] === PLAYER_TYPES.LOCAL) ?? 0);
      this.viewTeam = localTeam;
      this.renderer.setViewTeam(localTeam);
      this.minimap.setViewTeam(localTeam);
      const mine = this.game.units.find(u => u.team === localTeam);
      this.camera.focus(mine?.x ?? 0, mine?.y ?? 0, this.camera.focusTs(), false);
      this.game.vision?.recompute(localTeam);
      this.royale = new RoyaleSession(this, match, { team: localTeam, net: match.online ? this.net : null });
      this.royale.start();
      this.hud.toast(platform.isTouch ? 'Tap a fighter, then a destination' : 'Click a fighter, then a destination', 'good');
      return;
    }
    if (match.playerConfig && Object.values(match.playerConfig).includes(PLAYER_TYPES.LOCAL)) this.hud.toast(platform.isTouch ? 'Tap a unit to begin' : 'Click a unit to begin');
    this.onGameChanged();
  }

  /** The line to the multiplayer server dropped in the middle of an online match. */
  connectionLost() {
    if (this.lostModal) return;
    const m = (this.lostModal = new Modal({ title: 'Connection lost', width: 460, dismissable: false, disposable: true }));
    const back = () => {
      m.close();
      this.lostModal = null;
      this.leaveToMenu();
    };
    m.body.append(
      h(
        'div',
        { class: 'victory-card' },
        h('p', { style: { color: 'var(--text-dim)' } }, 'You were disconnected from the match. In a Battle Royale a bot now plays your warband, but there is no way back into a running game.'),
        h('button', { class: 'btn btn-gold', onclick: back }, 'Return to menu')
      )
    );
    m.open();
  }

  /**
   * What would be lost if the page reloaded right now — the update confirmation names it. Nothing is autosaved: a match in
   * progress is gone after a reload, and the map editor keeps a map only once Save has been pressed.
   */
  busyContext() {
    if (this.editor.active) return { busy: true, kind: 'editor', text: 'The map editor is open. A map is only kept once you press Save, so anything unsaved would be lost.' };
    const over = this.game.phase === 'GAME_OVER' || this.royale?.state === 'OVER';
    if (this.match && !over) return { busy: true, kind: 'match', text: `You are in the middle of “${this.match.title}”. Matches are not saved, so this one would be lost.` };
    return { busy: false };
  }

  /** How the running match ended — reported to the usage statistics when the player leaves it. */
  noteResult(result, { rounds = 0, place = null } = {}) {
    this.lastResult = { result, rounds, place };
  }

  /** Leave whatever is running (and any online room) and return to the main menu. */
  leaveToMenu() {
    if (this.net.currentRoom) this.net.leaveRoom();
    this.showMenu();
  }

  showMenu() {
    if (this.match) this.tracker.playEnd(this.lastResult?.result ?? 'quit', this.lastResult ?? {});
    this.tracker.screen('menu');
    if (consent.needsAsk) this.consentBanner?.show();
    this.royale?.destroy();
    this.royale = null;
    this.game.reset();
    this.editor.active = false;
    this.editorPanel.show(false);
    this.hud.setVisible(false);
    this.hud.setActions(null);
    this.victory.close();
    this.cover.classList.add('hidden');
    this.renderer.setMatch(null);
    this.match = null;
    this.ai = null;
    this.menu.show(true);
    this.menu.setAudio(this.sound.muted);
    this.menu.setFullscreen(platform.fullscreen.isActive());
    this.backdrop.start();
    this.sound.playMusic('menu');
  }

  // ---------------------------------------------------------------------------------------------
  // Editor
  // ---------------------------------------------------------------------------------------------
  startEditor() {
    this.consentBanner?.hide();
    this.tracker.screen('editor');
    this.menu.show(false);
    this.backdrop.stop();
    this.themeId = 'frost';
    this.editor.active = true;
    this.renderer.themeSet = this.assets.getTheme('frost');
    this.renderer.setMatch(null, 'frost');
    this.renderer.themeSet = this.assets.getTheme('frost');
    this.renderer.setViewTeam(null);
    this.camera.setMap(this.editor.map);
    this.hud.setVisible(true);
    this.hud.configure({ supply: false, renown: false, minimap: false });
    this.hud.setActions(null);
    this.hud.clearInspector();
    this.applyInsets();
    this.camera.fit(false);
    this.editorPanel.show(true);
  }

  saveEditorMap(name) {
    const saved = this.editor.saveToLocalStorage(name || 'Custom Battle');
    this.hud.toast(`Saved “${saved.name}” — find it under Skirmish`, 'good');
    return saved;
  }

  playEditorMap(name) {
    const saved = this.saveEditorMap(name);
    this.startMode('skirmish', { mapData: saved, teams: { 0: PLAYER_TYPES.LOCAL, 1: PLAYER_TYPES.AI, 2: PLAYER_TYPES.AI, 3: PLAYER_TYPES.AI } });
  }

  // ---------------------------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------------------------
  frame(now) {
    if (!this.running) return;
    this.perf.tick(now);
    this.perfOverlay.tick(now);
    this.camera.update(now);
    this.applyKeyboardPan(now);
    if (this.editor.active) this.renderer.render(null, this.editor);
    else if (this.game.map && this.match) {
      this.renderer.render(this.game, null);
      this.royale?.tick(now);
      if (this.hud.el.minimapWrap && !this.hud.el.minimapWrap.classList.contains('hidden')) {
        if (!this._mm || now - this._mm > 120) {
          this._mm = now;
          this.minimap.draw();
        }
      }
    }
    requestAnimationFrame(t => this.frame(t));
  }

  applyKeyboardPan(now) {
    const dt = Math.min(50, now - (this._lastPan || now));
    this._lastPan = now;
    if (!this.keys.size || hasOpenModal()) return;
    let dx = 0;
    let dy = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('a')) dx += 1;
    if (this.keys.has('ArrowRight') || this.keys.has('d')) dx -= 1;
    if (this.keys.has('ArrowUp') || this.keys.has('w')) dy += 1;
    if (this.keys.has('ArrowDown') || this.keys.has('s')) dy -= 1;
    if (dx || dy) {
      const v = (dt / 1000) * 9 * this.camera.ts;
      this.camera.pan(dx * v, dy * v);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Window / viewport / input wiring
  // ---------------------------------------------------------------------------------------------
  bindWindow() {
    const onResize = () => {
      const dpr = this.renderer.resize();
      this.pointer.setDpr(dpr);
      this.applyInsets();
      this.camera.reflow();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 120));
    platform.fullscreen.onChange(active => {
      this.hud.setFullscreen(active);
      this.menu.setFullscreen(active);
      setTimeout(onResize, 80);
    });
    this.hud.setFullscreen(platform.fullscreen.isActive());
    new ResizeObserver(onResize).observe(this.canvas);
  }

  applyInsets() {
    const dpr = this.renderer.dpr || 1;
    const i = this.hud.insets();
    this.camera.setInsets({ top: i.top * dpr, bottom: i.bottom * dpr, left: i.left * dpr, right: i.right * dpr });
  }

  bindInput() {
    this.pointer = new PointerController(this.canvas, {
      dpr: this.renderer.dpr,
      isPainting: () => this.editor.active,
      onTap: info => this.onTap(info),
      onHover: p => this.onHover(p),
      onLeave: () => (this.renderer.showHover = false),
      onPan: (dx, dy) => this.camera.pan(dx, dy),
      onZoom: (f, sx, sy) => this.camera.zoomAt(f, sx, sy),
      onCancel: () => this.cancelInteraction(),
      onPaint: p => this.paint(p)
    });
    this.pointer.setDpr(this.renderer.dpr);

    // Wheel-zoom must work everywhere on the battlefield — including while the cursor is over a HUD plate
    this.hud.root.addEventListener(
      'wheel',
      e => {
        if (e.target.closest('.modal-backdrop')) return;
        this.pointer.wheel(e);
      },
      { passive: false }
    );

    window.addEventListener('keydown', e => this.onKey(e));
    window.addEventListener('keyup', e => this.keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
    window.addEventListener('blur', () => this.keys.clear());
  }

  onKey(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (hasOpenModal()) return;

    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) {
      e.preventDefault();
      this.keys.add(k);
      return;
    }
    if (k === 'f') return this.onCommand('fullscreen');
    if (k === 'm') return this.onCommand('audio');
    if (!this.match || this.editor.active) return;
    if (this.royale) {
      if (k === 'e' || k === 'Enter' || k === ' ') {
        e.preventDefault();
        return this.royale.lock();
      }
      if (k === 'Escape') return this.royale.cancel();
      if (k === 'p') return this.royale.autoPlan();
    }
    if (['w', 'a', 's', 'd'].includes(k) && this.game.phase === 'IDLE') {
      this.keys.add(k);
      return;
    }

    if (k === '+' || k === '=') return this.camera.zoomAt(1.2);
    if (k === '-' || k === '_') return this.camera.zoomAt(1 / 1.2);
    if (k === 'g' || k === 'Home') return this.onCommand('focus');
    if (k === 'Escape') return this.cancelInteraction();
    if (k === 'e' && this.canLocalPlayerAct() && this.game.phase === 'IDLE') return this.onCommand('endTurn');

    const sel = this.game.selectedUnit;
    if (k === 'b' && sel && this.game.phase === 'MOVE' && sel.isCommander && !sel.hasMoved && this.canLocalPlayerAct()) return this.triggerUnitAction('buy');
    if (sel && this.game.phase === 'ACTION' && this.canLocalPlayerAct()) {
      const map = { a: 'attack', c: this.game.availableActions.includes('repair') ? 'repair' : 'occupy', s: 'summon', h: 'heal', b: 'buy', ' ': 'standby' };
      const id = map[k];
      if (id && this.game.availableActions.includes(id)) {
        e.preventDefault();
        this.triggerUnitAction(id);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Commands from HUD
  // ---------------------------------------------------------------------------------------------
  async onCommand(name, arg) {
    switch (name) {
      case 'zoomIn': return this.camera.zoomAt(1.25);
      case 'zoomOut': return this.camera.zoomAt(1 / 1.25);
      case 'fit': {
        if (this.camera.mode === 'fit') {
          this.camera.fill(true);
          this.hud.toast('Fill screen — drag to explore');
        } else {
          this.camera.fit(true);
          this.hud.toast('Fit whole map');
        }
        return;
      }
      case 'focus': {
        const t = this.viewTeam;
        const u = this.game.units.find(x => x.team === t && x.isCommander) || this.game.units.find(x => x.team === t);
        if (u) this.camera.focus(u.x, u.y, Math.max(this.camera.ts, this.camera.focusTs()), true);
        return;
      }
      case 'fullscreen': {
        const active = await platform.fullscreen.toggle();
        this.hud.setFullscreen(active);
        this.menu.setFullscreen(active);
        return;
      }
      case 'audio': {
        const muted = this.sound.toggleMute();
        this.hud.setAudio(muted);
        this.menu.setAudio(muted);
        return;
      }
      case 'codex': return this.codex.open();
      case 'settings': return this.settingsBox.open();
      case 'menu': return this.confirmLeave();
      case 'endTurn': {
        if (this.royale) return this.royale.lock();
        if (!this.canLocalPlayerAct()) return;
        this.sound.playPrompt();
        this.send({ type: 'END_TURN' });
        this.game.endTurn();
        return;
      }
      case 'action': {
        if (typeof arg === 'string' && arg.startsWith('r:')) {
          if (arg === 'r:auto') return this.royale?.autoPlan();
          return this.royale?.onAction(arg);
        }
        if (arg === 'cancel') {
          this.game.actionTargets = [];
          this.game.pendingAction = null;
          this.game.phase = 'ACTION';
          this.game.notify();
        } else if (arg === 'undo') {
          this.cancelInteraction();
        } else this.triggerUnitAction(arg);
      }
    }
  }

  confirmLeave() {
    const m = new Modal({ title: 'Leave battle?', width: 420, disposable: true });
    m.body.append(
      h('p', { style: { color: 'var(--text-dim)' } }, 'Your current battle will be abandoned.'),
      h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'flex-end' } }, h('button', { class: 'btn btn-ghost', onclick: () => m.destroy() }, 'Keep playing'), h('button', { class: 'btn btn-gold', onclick: () => (m.destroy(), this.net.currentRoom && this.net.leaveRoom(), this.showMenu()) }, 'Leave'))
    );
    m.open();
  }

  // ---------------------------------------------------------------------------------------------
  // Pointer logic
  // ---------------------------------------------------------------------------------------------
  tileAt(sx, sy) {
    return this.camera.screenToTile(sx, sy);
  }

  onHover(p) {
    const t = this.tileAt(p.sx, p.sy);
    this.renderer.showHover = true;
    this.renderer.hover = { x: t.x, y: t.y };
    this.inspectAt(t.x, t.y);
  }

  inspectAt(x, y) {
    if (this.editor.active || !this.match) return;
    this.hud.inspect(this.game, x, y, this.viewTeam);
  }

  paint(p) {
    if (!this.editor.active) return;
    const t = this.tileAt(p.sx, p.sy);
    this.editor.applyBrush(t.x, t.y);
  }

  cancelInteraction() {
    if (this.editor.active || !this.match) return;
    if (this.game.phase === 'GAME_OVER') return;
    if (!this.canLocalPlayerAct()) return;
    if (TARGETING.includes(this.game.phase)) return this.onCommand('action', 'cancel');
    if (this.game.selectedUnit) {
      this.send({ type: 'CANCEL' });
      this.game.cancelSelection();
    }
  }

  onTap({ sx, sy, pointerType }) {
    const t = this.tileAt(sx, sy);
    if (this.editor.active) {
      this.editor.applyBrush(t.x, t.y);
      return;
    }
    if (!this.match) return;
    if (this.royale) {
      this.renderer.showHover = true;
      if (pointerType !== 'touch') this.renderer.hover = { x: t.x, y: t.y };
      this.royale.onTap(t.x, t.y, pointerType);
      this.inspectAt(t.x, t.y);
      return;
    }
    const g = this.game;
    this.renderer.showHover = true;

    // Touch has no hover, so aiming takes two taps: the first previews (path / damage), the second commits.
    if (pointerType === 'touch' && this.canLocalPlayerAct()) {
      const aiming = g.phase === 'MOVE' || TARGETING.includes(g.phase);
      const valid =
        (g.phase === 'MOVE' && g.reachable.some(r => r.x === t.x && r.y === t.y)) ||
        (TARGETING.includes(g.phase) && g.actionTargets.some(a => a.x === t.x && a.y === t.y));
      const same = this.renderer.hover.x === t.x && this.renderer.hover.y === t.y;
      if (aiming && valid && !same) {
        this.renderer.hover = { x: t.x, y: t.y };
        this.inspectAt(t.x, t.y);
        platform.haptic(8);
        return;
      }
    }
    this.renderer.hover = { x: t.x, y: t.y };
    this.inspectAt(t.x, t.y);
    this.onMapTileClicked(t.x, t.y);
  }

  canLocalPlayerAct() {
    const g = this.game;
    if (!g.map || !this.match || g.phase === 'GAME_OVER') return false;
    const p = g.getCurrentPlayer();
    if (!p || p.type !== PLAYER_TYPES.LOCAL) return false;
    if (g.mode === 'online' && this.net.assignedTeam !== null) return g.getCurrentTeam() === this.net.assignedTeam;
    return true;
  }

  send(action) {
    if (this.game.mode === 'online') this.net.sendGameAction(action);
  }

  onMapTileClicked(x, y) {
    const g = this.game;
    if (!g.map || x < 0 || y < 0 || x >= g.map.width || y >= g.map.height) return;
    if (!this.canLocalPlayerAct()) return;

    const team = g.getCurrentTeam();
    const clicked = g.getUnitAtFor(this.viewTeam ?? team, x, y);
    const tile = this.assets.getTile(g.map.tiles[x][y]);

    if (g.phase === 'IDLE') {
      if (clicked && clicked.team === team && !clicked.standby) {
        this.send({ type: 'SELECT_UNIT', x, y });
        g.selectUnit(clicked);
        platform.haptic(8);
      } else if (!clicked || (clicked.isCommander && clicked.team === team)) {
        if (g.getRecruitSite(team, x, y)) this.openShop(x, y);
      }
      return;
    }

    if (g.phase === 'MOVE') {
      if (g.reachable.some(r => r.x === x && r.y === y)) {
        this.send({ type: 'MOVE_UNIT', x, y });
        g.moveSelectedUnitTo(x, y);
      } else if (clicked && clicked.team === team && !clicked.standby && clicked !== g.selectedUnit) {
        // switch selection straight to another ready unit
        g.cancelSelection();
        this.send({ type: 'CANCEL' });
        this.send({ type: 'SELECT_UNIT', x, y });
        g.selectUnit(clicked);
      } else {
        this.send({ type: 'CANCEL' });
        g.cancelSelection();
      }
      return;
    }

    if (TARGETING.includes(g.phase)) {
      const hit = g.actionTargets.some(t => t.x === x && t.y === y);
      const u = g.selectedUnit;
      if (hit && u) {
        if (g.phase === 'ATTACK') (this.send({ type: 'EXECUTE_ATTACK', x, y }), g.executeAttack(u, x, y));
        else if (g.phase === 'SUMMON') (this.send({ type: 'EXECUTE_SUMMON', x, y }), g.executeSummon(u, x, y));
        else if (g.phase === 'HEAL') (this.send({ type: 'EXECUTE_HEAL', x, y }), g.executeHeal(u, x, y));
        else {
          const id = g.pendingAction;
          this.send({ type: 'EXECUTE_CUSTOM', id, x, y });
          g.executeCustomAction(u, id, { x, y });
        }
      } else {
        this.onCommand('action', 'cancel');
      }
    }
  }

  triggerUnitAction(id) {
    const g = this.game;
    const u = g.selectedUnit;
    if (!u || !this.canLocalPlayerAct()) return;
    if (id === 'buy') {
      g.cancelSelection();
      this.send({ type: 'CANCEL' });
      this.openShop(u.x, u.y);
      return;
    }
    g.beginActionTargeting(id);
    // actions that resolved immediately (no targeting phase) must be mirrored to remote players
    if (!TARGETING.includes(g.phase)) this.send({ type: 'UNIT_IMMEDIATE_ACTION', actionName: id });
  }

  openShop(x, y) {
    const team = this.game.getCurrentTeam();
    const occ = this.game.getUnitAt(x, y);
    if (occ && !(occ.isCommander && occ.team === team)) {
      this.renderer.addFloatingText(x, y, 'Move the unit off first!', '#facc15');
      return;
    }
    this.shop.open(this.game, team, x, y);
  }

  recruit(team, index, x, y) {
    this.send({ type: 'RECRUIT_UNIT', team, unitIndex: index, x, y });
    this.game.recruitUnit(team, index, x, y);
  }

  // ---------------------------------------------------------------------------------------------
  // Engine → UI
  // ---------------------------------------------------------------------------------------------
  updateViewTeam() {
    const g = this.game;
    if (!g.map || g.simultaneous) return;
    let t = this.viewTeam;
    if (g.mode === 'online' && this.net.assignedTeam !== null) t = this.net.assignedTeam;
    else {
      const cur = g.getCurrentPlayer();
      if (cur?.type === PLAYER_TYPES.LOCAL) t = g.getCurrentTeam();
      else if (t === null || t === undefined) t = Object.values(g.players).find(p => p.type === PLAYER_TYPES.LOCAL)?.team ?? g.getCurrentTeam();
    }
    if (t !== this.viewTeam) {
      this.viewTeam = t;
      this.renderer.setViewTeam(t);
      this.minimap.setViewTeam(t);
    }
    if (this.ai) this.ai.viewTeam = this.viewTeam;
  }

  onGameEvent(type, data) {
    this.renderer.onGameEvent(type, data);
    this.royale?.onGameEvent(type, data);
    if (type === 'tile') this.minimap?.markDirty();
    else if (type === 'renown' && data.team === this.viewTeam && data.amount >= 3 && data.reason !== 'holdings') this.hud.toast(`+${data.amount} Renown`, 'good');
  }

  onGameChanged() {
    const g = this.game;
    if (!g.map || !this.match) return;
    if (g.simultaneous) return; // Battle Royale drives its own HUD (royaleSession)
    const prevView = this.viewTeam;
    this.updateViewTeam();

    const act = this.canLocalPlayerAct();
    this.hud.updateTurn(g, this.viewTeam, act);
    this.hud.updateResources(g, this.viewTeam);
    this.syncActionBar();
    this.maybeCover(prevView);

    // announce the start of the local player's turn
    const cur = g.getCurrentTeam();
    if (cur !== this.lastTurnTeam) {
      this.lastTurnTeam = cur;
      if (act && g.phase !== 'GAME_OVER' && g.turnNumber > 1) this.hud.toast(`Your turn — day ${g.turnNumber}`, 'good');
    }

    // refresh the inspector for the selected unit
    const sel = g.selectedUnit;
    if (sel && this.canLocalPlayerAct()) this.inspectAt(sel.x, sel.y);

    if (g.phase === 'GAME_OVER' && g.winnerTeam !== null) return this.showVictory();

    const p = g.getCurrentPlayer();
    if (p?.type === PLAYER_TYPES.AI && this.ai && !this.ai.isThinking) {
      this.ai.viewTeam = this.viewTeam;
      this.ai.playTurn();
    }
  }

  /** Hot-seat + fog: hide the board between human turns so nobody sees the other's army. */
  maybeCover(prevView) {
    const g = this.game;
    const fog = !!g.vision && !g.vision.revealAll;
    const humans = Object.values(g.players).filter(p => p.type === PLAYER_TYPES.LOCAL).length;
    if (!fog || humans < 2 || g.mode === 'online') return;
    const cur = g.getCurrentPlayer();
    if (cur?.type !== PLAYER_TYPES.LOCAL || prevView === this.viewTeam || g.turnNumber === 1 && prevView === null) return;
    const t = TEAMS[g.getCurrentTeam()];
    this.cover.replaceChildren(h('div', { class: 'victory-card plate' }, h('div', { class: 'eyebrow' }, 'Pass the device'), h('h2', { style: { color: t.light } }, `${t.name} ARMY`), h('p', { style: { color: 'var(--text-dim)' } }, 'Fog of war is on. Hand over the screen, then tap to begin your turn.'), h('button', { class: 'btn btn-gold', onclick: () => this.cover.classList.add('hidden') }, 'I am ready')));
    show(this.cover, true);
  }

  syncActionBar() {
    const g = this.game;
    const u = g.selectedUnit;
    if (!this.canLocalPlayerAct() || !u) return this.hud.setActions(null);

    if (TARGETING.includes(g.phase)) {
      const label = g.phase === 'ATTACK' ? 'Choose a target to attack' : g.phase === 'HEAL' ? 'Choose an ally to heal' : g.phase === 'SUMMON' ? 'Choose a grave to raise' : 'Choose a target';
      return this.hud.setTargetPrompt(label);
    }
    if (g.phase === 'MOVE' && u.isCommander && !u.hasMoved && g.getRecruitSite(u.team, u.x, u.y)) {
      return this.hud.setActions([{ id: 'buy', label: 'Recruit', icon: 'buy', hotkey: 'B', primary: true, hint: 'or pick a tile to move' }]);
    }
    if (g.phase !== 'ACTION') return this.hud.setActions(null);

    const items = [];
    let primarySet = false;
    for (const id of g.availableActions) {
      const base = ACTION_INFO[id];
      let info;
      if (base) info = { id, label: base.label, icon: base.icon, hotkey: base.hotkey, primary: !!base.primary, iconNode: base.glyph ? glyph(base.glyph, 3) : null };
      else {
        const d = g.rules.first('describeAction', g, id, u);
        if (!d) continue;
        info = { id, label: d.label, icon: d.icon || 'hammer', hint: d.hint, cost: d.cost, primary: false };
      }
      if (id === 'occupy' && this.assets.getTile(g.map.tiles[u.x][u.y]).isCastle) info.label = 'Capture Keep';
      if (info.primary && !primarySet) primarySet = true;
      else info.primary = false;
      items.push(info);
    }
    if (u.hasMoved && !u.hasActed && !u.ambushed) items.push({ id: 'undo', label: 'Undo move', iconNode: glyph('back', 3), cancel: true, hotkey: 'Esc' });
    this.hud.setActions(items);
  }

  showVictory() {
    const g = this.game;
    const w = TEAMS[g.winnerTeam] || TEAMS[0];
    const renown = g.renown && g.renownGoal && g.renown[g.winnerTeam] >= g.renownGoal;
    this.noteResult(this.match?.playerConfig?.[g.winnerTeam] === PLAYER_TYPES.LOCAL ? 'won' : 'lost', { rounds: g.turnNumber });
    this.victory.title.textContent = renown ? 'Renown victory' : 'Victory';
    this.victoryTitle.textContent = `${w.name} ARMY WINS`;
    this.victoryTitle.style.color = w.light;
    this.victorySub.textContent = `${renown ? 'Renowned across the realm' : 'Triumph'} on day ${g.turnNumber} · ${this.match.title}`;
    this.hud.setActions(null);
    this.victory.open();
  }

  // ---------------------------------------------------------------------------------------------
  // Diagnostics: `__aeii.auditInput()` in the console. Selects a unit and checks that EVERY reachable tile can
  // be hovered and clicked (nothing invisible on top of the map) and that the unit lands where you click.
  // ---------------------------------------------------------------------------------------------
  auditInput() {
    const g = this.game;
    const unit = g.selectedUnit || g.units.find(u => u.team === this.viewTeam && !u.standby);
    if (!unit) return { error: 'no movable unit' };
    if (g.selectedUnit !== unit) g.selectUnit(unit);
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.renderer.dpr;
    const css = (tx, ty) => {
      const p = this.camera.tileToScreen(tx + 0.5, ty + 0.5);
      return { x: rect.left + p.x / dpr, y: rect.top + p.y / dpr };
    };
    const fire = (type, c, buttons) => this.canvas.dispatchEvent(new PointerEvent(type, { pointerId: 99, pointerType: 'mouse', button: 0, buttons, clientX: c.x, clientY: c.y, bubbles: true }));
    const result = { reachable: g.reachable.length, offscreen: 0, coveredBy: {}, wrongLanding: [], ok: 0 };
    for (const r of g.reachable.slice()) {
      const c = css(r.x, r.y);
      if (c.x < 0 || c.y < 0 || c.x > innerWidth || c.y > innerHeight) {
        result.offscreen++;
        continue;
      }
      const el = document.elementFromPoint(c.x, c.y);
      if (el !== this.canvas) {
        const k = el?.closest?.('.plate')?.className.split(' ').slice(0, 2).join('.') || el?.className || el?.tagName;
        result.coveredBy[k] = (result.coveredBy[k] || 0) + 1;
        continue;
      }
      fire('pointermove', c, 0);
      fire('pointerdown', c, 1);
      fire('pointerup', c, 0);
      if (unit.x === r.x && unit.y === r.y) result.ok++;
      else result.wrongLanding.push({ target: [r.x, r.y], landed: [unit.x, unit.y], ambush: !!unit.ambushed });
      g.cancelSelection();
      g.selectUnit(unit);
    }
    return result;
  }

  // ---------------------------------------------------------------------------------------------
  // Online
  // ---------------------------------------------------------------------------------------------
  hostOnline(modeId) {
    const mode = getMode(modeId);
    new ModeSetup({
      assets: this.assets,
      mode,
      online: true,
      startLabel: 'Open room',
      onStart: config => {
        const preview = mode.createMatch({ ...config, teams: {} }, this.assets);
        const teams = preview.mapData.activeTeams?.length || Object.keys(preview.playerConfig).length || 2;
        this.net.createRoom({ roomName: `${this.net.username}'s ${mode.name}`, modeId, config, maxPlayers: modeId === 'royale' ? Math.min(60, config.players || teams) : Math.min(4, teams) });
        this.lobby.open();
      }
    }).open();
  }

  onNet(msg) {
    if (!this.lobby) return;
    switch (msg.type) {
      case 'CONNECTED': return this.lobby.setConnection('ok');
      case 'DISCONNECTED':
        this.lobby.setConnection('bad');
        if (msg.inMatch) this.connectionLost();
        return;
      case 'RECONNECTING': return this.lobby.setConnection('wait');
      case 'ROOM_LIST': return this.lobby.renderRooms(msg.rooms || []);
      case 'ROOM_JOINED':
      case 'ROOM_UPDATED': return this.lobby.renderRoom(msg.room);
      case 'ROOM_LEFT': return this.lobby.leftRoom();
      case 'CHAT_MESSAGE': return this.lobby.addChat(msg.sender, msg.text);
      case 'ERROR': return this.hud?.toast(msg.text, 'warn'), this.lobby.addChat('Server', msg.text);
      case 'MATCH_STARTED': return this.startOnlineMatch(msg.room);
      case 'REMOTE_GAME_ACTION': return this.applyRemoteAction(msg.action);
      case 'ROUND_PLAN':
      case 'ROUND_ORDERS':
      case 'DESYNC': return this.royale?.onNet(msg);
    }
  }

  startOnlineMatch(room) {
    this.lobby.modal.close();
    const mode = getMode(room.modeId);
    const probe = mode.createMatch({ ...room.config, teams: {} }, this.assets);
    const slots = probe.mapData.activeTeams?.length ? probe.mapData.activeTeams : Object.keys(probe.playerConfig).map(Number);
    const teams = {};
    for (const t of slots) teams[t] = room.players.some(p => p.team === t) ? PLAYER_TYPES.LOCAL : PLAYER_TYPES.AI;
    const names = Object.fromEntries(room.players.map(p => [p.team, p.username]));
    this.beginMatch(mode.createMatch({ ...room.config, teams, names, online: true }, this.assets));
  }

  applyRemoteAction(a) {
    const g = this.game;
    if (!a || !g.map || !this.match) return;
    switch (a.type) {
      case 'SELECT_UNIT': { const u = g.getUnitAt(a.x, a.y); if (u) g.selectUnit(u); break; }
      case 'CANCEL': g.cancelSelection(); break;
      case 'MOVE_UNIT': g.moveSelectedUnitTo(a.x, a.y); break;
      case 'UNIT_IMMEDIATE_ACTION': g.beginActionTargeting(a.actionName); break;
      case 'EXECUTE_ATTACK': if (g.selectedUnit) g.executeAttack(g.selectedUnit, a.x, a.y); break;
      case 'EXECUTE_SUMMON': if (g.selectedUnit) g.executeSummon(g.selectedUnit, a.x, a.y); break;
      case 'EXECUTE_HEAL': if (g.selectedUnit) g.executeHeal(g.selectedUnit, a.x, a.y); break;
      case 'EXECUTE_CUSTOM': if (g.selectedUnit) g.executeCustomAction(g.selectedUnit, a.id, { x: a.x, y: a.y }); break;
      case 'RECRUIT_UNIT': g.recruitUnit(a.team, a.unitIndex, a.x ?? a.castleX, a.y ?? a.castleY); break;
      case 'END_TURN': g.endTurn(); break;
    }
  }
}
