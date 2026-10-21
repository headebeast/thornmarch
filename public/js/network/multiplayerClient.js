// Real-time multiplayer client (WebSocket).
// Rooms carry a mode id + its setup config; a match start is just "modeId + config + seed", every client rebuilds
// the identical world locally (deterministic generator + seeded RNG), then actions are relayed.

import { platform } from '../platform/platform.js';
import { deploy } from '../config/deploy.js';
import { NetStats } from './netStats.js';

const MAX_RETRIES = 6;

export class MultiplayerClient {
  constructor(onEvent = () => {}) {
    this.ws = null;
    this.connected = false;
    this.playerId = null;
    this.username = platform.storage.get('aeii_username', `Commander_${Math.floor(100 + Math.random() * 899)}`);
    this.currentRoom = null;
    this.assignedTeam = null;
    this.onEvent = onEvent;
    this.queue = [];
    this.wantOpen = false; // the player is using online features: keep the line open
    this.retries = 0;
    this.retryTimer = null;
    this.stats = new NetStats(); // ping / jitter / probe loss, shown by the FPS & connection overlay
    this.probeTimer = null;
    this.probeId = 0;
  }

  connect() {
    this.wantOpen = true;
    clearTimeout(this.retryTimer);
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    try {
      this.ws = new WebSocket(deploy.socketUrl);
    } catch (err) {
      // a mistyped server address throws synchronously — report it like any other failed connection
      console.error('WebSocket:', err);
      this.onEvent({ type: 'DISCONNECTED', inMatch: false });
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.retries = 0;
      this.startProbes();
      this.send({ type: 'HELLO', username: this.username });
      for (const m of this.queue.splice(0)) this.send(m);
      this.onEvent({ type: 'CONNECTED' });
    };

    this.ws.onmessage = ev => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (err) {
        return console.error('WS parse error', err);
      }
      if (msg.type === 'PONG') return void this.stats.received(msg.id, performance.now()); // internal: never reaches the game
      if (msg.type === 'WELCOME') this.playerId = msg.playerId;
      else if (msg.type === 'ROOM_JOINED' || msg.type === 'ROOM_UPDATED') {
        this.currentRoom = msg.room;
        const me = msg.room.players.find(p => p.id === this.playerId);
        this.assignedTeam = me ? me.team : null;
      } else if (msg.type === 'ROOM_LEFT') {
        this.currentRoom = null;
        this.assignedTeam = null;
      }
      this.onEvent(msg);
    };

    this.ws.onclose = () => {
      const inMatch = !!this.currentRoom?.started;
      this.stopProbes();
      this.connected = false;
      this.currentRoom = null;
      this.assignedTeam = null;
      this.onEvent({ type: 'DISCONNECTED', inMatch });
      // In a lobby the line is quietly re-opened. Mid-match there is no way back in (the server has already handed the seat
      // to a bot), so the game is told instead and offers the way out.
      if (this.wantOpen && !inMatch && this.retries < MAX_RETRIES) {
        const delay = Math.min(15000, 1000 * 2 ** this.retries++);
        this.onEvent({ type: 'RECONNECTING', attempt: this.retries, delay });
        this.retryTimer = setTimeout(() => this.connect(), delay);
      }
    };
  }

  /** A tiny PING every two seconds; the server's PONG gives round-trip time, and silence counts as loss. */
  startProbes() {
    this.stopProbes();
    this.probeTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      const now = performance.now();
      this.stats.sweep(now);
      const id = ++this.probeId;
      this.stats.sent(id, now);
      this.ws.send(JSON.stringify({ type: 'PING', id }));
    }, 2000);
  }

  stopProbes() {
    clearInterval(this.probeTimer);
    this.probeTimer = null;
    this.stats.reset();
  }

  /** The player is done with online features: close the line and stop retrying. */
  disconnect() {
    this.wantOpen = false;
    clearTimeout(this.retryTimer);
    this.ws?.close();
  }

  setUsername(name) {
    this.username = (name || '').trim().slice(0, 24) || this.username;
    platform.storage.set('aeii_username', this.username);
    this.send({ type: 'SET_USERNAME', username: this.username });
  }

  listRooms() {
    this.send({ type: 'LIST_ROOMS' });
  }

  createRoom({ roomName, modeId, config, maxPlayers }) {
    this.send({ type: 'CREATE_ROOM', roomName: roomName || `${this.username}'s battle`, modeId, config, maxPlayers });
  }

  joinRoom(code) {
    this.send({ type: 'JOIN_ROOM', roomCode: (code || '').trim().toUpperCase() });
  }

  leaveRoom() {
    this.send({ type: 'LEAVE_ROOM' });
  }

  startMatch() {
    this.send({ type: 'START_MATCH' });
  }

  sendGameAction(action) {
    if (this.currentRoom) this.send({ type: 'GAME_ACTION', action });
  }

  sendChat(text) {
    if (text?.trim()) this.send({ type: 'CHAT', text: text.trim() });
  }

  send(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
    else if (payload.type !== 'HELLO' && this.queue.length < 20) this.queue.push(payload);
  }
}
