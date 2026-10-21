// Online lobby — room browser, hosting, in-room chat. All user-supplied text is inserted as text nodes.

import { TEAMS } from '../config/constants.js';
import { h, clear, show } from './dom.js';
import { glyph } from './icons.js';
import { Modal } from './modal.js';

export class Lobby {
  /**
   * @param {{net, modes:Array, onHost:(modeId:string)=>void, onCopy:(text:string)=>void}} o
   */
  constructor({ net, modes, onHost, onStartMatch, copy }) {
    this.net = net;
    this.modes = modes;
    this.onHost = onHost;
    this.onStartMatch = onStartMatch;
    this.copy = copy;
    this.modal = new Modal({ title: 'Online Battle', width: 900 });
    this.status = h('span', { class: 'conn' }, 'Connecting…');
    this.modal.headExtra.append(this.status);

    this.nameInput = h('input', { class: 'input', maxlength: 24, value: net.username, 'aria-label': 'Commander name', onchange: e => net.setUsername(e.target.value) });
    this.rooms = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
    this.codeInput = h('input', { class: 'input', placeholder: 'ROOM CODE', maxlength: 6, style: { textTransform: 'uppercase', letterSpacing: '0.2em', fontFamily: 'var(--font-px)' }, onkeydown: e => e.key === 'Enter' && this.join() });
    this.lobbyView = h(
      'div',
      { class: 'lobby-split' },
      h('div', { class: 'lobby-box plate flat' }, h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, h('h4', null, 'Open rooms'), h('button', { class: 'btn btn-sm', onclick: () => net.listRooms() }, 'Refresh')), this.rooms, h('div', { class: 'insp-divider' }), h('div', { style: { display: 'flex', gap: '8px' } }, this.codeInput, h('button', { class: 'btn btn-sm btn-gold', onclick: () => this.join() }, 'Join'))),
      h('div', { class: 'lobby-box plate flat' }, h('h4', null, 'Host a battle'), h('p', { style: { fontSize: '13px', color: 'var(--text-dim)' } }, 'Pick a mode, tune the rules, then share the room code. Empty slots are played by the AI.'), ...modes.map(m => h('button', { class: 'btn', onclick: () => this.onHost(m.id) }, glyph('play', 2), m.name, h('span', { style: { color: 'var(--text-mute)', fontSize: '12px', marginLeft: '6px' } }, m.tagline))))
    );

    this.roomTitle = h('h4', null, 'Room');
    this.players = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });
    this.chat = h('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite' });
    this.chatInput = h('input', { class: 'input', placeholder: 'Say something to your allies and rivals…', maxlength: 200, onkeydown: e => e.key === 'Enter' && this.sendChat() });
    this.startBtn = h('button', { class: 'btn btn-gold', onclick: () => this.onStartMatch() }, glyph('play', 2), 'Start match');
    this.copyBtn = h('button', { class: 'btn btn-sm', onclick: () => this.copyLink() }, 'Copy invite link');
    this.roomView = h(
      'div',
      { class: 'lobby-box plate flat hidden' },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, this.roomTitle, h('div', { style: { display: 'flex', gap: '8px' } }, this.copyBtn, h('button', { class: 'btn btn-sm btn-ghost', onclick: () => net.leaveRoom() }, 'Leave'))),
      this.players,
      this.chat,
      h('div', { style: { display: 'flex', gap: '8px' } }, this.chatInput, h('button', { class: 'btn btn-sm', onclick: () => this.sendChat() }, 'Send')),
      this.startBtn
    );

    this.modal.body.append(h('div', { class: 'field' }, h('label', null, 'Your commander name'), this.nameInput), this.lobbyView, this.roomView);
  }

  open() {
    this.nameInput.value = this.net.username;
    this.net.connect();
    this.modal.open();
    setTimeout(() => this.net.listRooms(), 300);
  }

  join() {
    const code = this.codeInput.value.trim();
    if (code) this.net.joinRoom(code);
  }

  sendChat() {
    const t = this.chatInput.value.trim();
    if (t) this.net.sendChat(t);
    this.chatInput.value = '';
  }

  async copyLink() {
    if (!this.net.currentRoom) return;
    const url = `${location.origin}/?room=${this.net.currentRoom.code}`;
    const ok = await this.copy(url);
    this.copyBtn.textContent = ok ? 'Link copied!' : url;
    setTimeout(() => (this.copyBtn.textContent = 'Copy invite link'), 2200);
  }

  setConnection(state) {
    this.status.textContent = state === 'ok' ? 'Connected' : state === 'bad' ? 'Disconnected — the multiplayer server is unreachable' : state === 'wait' ? 'Reconnecting…' : 'Connecting…';
    this.status.className = `conn ${state}`;
  }

  renderRooms(list) {
    clear(this.rooms);
    if (!list.length) return this.rooms.append(h('div', { class: 'empty' }, 'No open rooms yet — host one!'));
    for (const r of list) {
      const m = this.modes.find(x => x.id === r.modeId);
      this.rooms.append(h('div', { class: 'room-row' }, h('div', null, h('b', null, `[${r.code}] ${r.name}`), h('small', null, `${m?.name || r.modeId} · ${r.playerCount}/${r.maxPlayers} players${r.started ? ' · in progress' : ''}`)), h('button', { class: 'btn btn-sm btn-gold', disabled: r.started || r.playerCount >= r.maxPlayers, onclick: () => this.net.joinRoom(r.code) }, 'Join')));
    }
  }

  renderRoom(room) {
    show(this.lobbyView, false);
    show(this.roomView, true);
    const mode = this.modes.find(m => m.id === room.modeId);
    this.roomTitle.textContent = `Room ${room.code} — ${room.name} · ${mode?.name || ''}`;
    clear(this.players);
    for (const p of room.players) {
      const t = TEAMS[p.team] || TEAMS[0];
      this.players.append(h('span', { class: 'player-pill' }, h('span', { class: 'team-flag', style: { '--team': t.color, width: '12px', height: '16px' } }), p.username, p.id === room.hostId ? ' ★' : ''));
    }
    const isHost = room.hostId === this.net.playerId;
    this.startBtn.disabled = !isHost;
    this.startBtn.lastChild.textContent = isHost ? 'Start match' : 'Waiting for host…';
  }

  leftRoom() {
    show(this.lobbyView, true);
    show(this.roomView, false);
    clear(this.chat);
    this.net.listRooms();
  }

  addChat(sender, text) {
    this.chat.append(h('div', null, h('b', null, `${sender}: `), text));
    this.chat.scrollTop = this.chat.scrollHeight;
  }
}
