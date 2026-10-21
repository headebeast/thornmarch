// Modular Zero-Dependency HTTP + RFC 6455 WebSocket Multiplayer Server
// Serves the Ancient Empires II Browser Game AND synchronizes online multiplayer rooms

import http from 'http';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createStaticHandler, contentSecurityPolicy } from './staticFiles.mjs';
import { readConfig, TokenBucket, IpCounter, clientIp, originAllowed } from './limits.mjs';
import { brandTitle } from '../public/js/config/brand.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG = readConfig(); // PORT, HOST, STATIC_DIR, ALLOWED_ORIGINS, TRUST_PROXY, MAX_* … (see DEPLOY.md)
const STATIC_DIR = CONFIG.staticDir || path.join(__dirname, '../public');
const PORT = CONFIG.port;

const MAX_FRAME = 256 * 1024; // refuse absurd payloads
const MAX_CONFIG_BYTES = 8 * 1024;

// Multiplayer state
const clients = new Map(); // id -> { id, socket, username, roomCode }
const rooms = new Map();   // code -> { code, name, hostId, modeId, config, maxPlayers, started, players: [{id, username, team}] }

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// RFC 6455 WebSocket Frame Helpers (Zero external dependencies!)
/** What clients may see of a room — never the timers or round-clock internals. */
function publicRoom(room) {
  return {
    code: room.code,
    name: room.name,
    hostId: room.hostId,
    modeId: room.modeId,
    config: room.config,
    maxPlayers: room.maxPlayers,
    started: room.started,
    players: room.players
  };
}

function sendWsJson(socket, obj) {
  if (!socket || socket.destroyed) return;
  let json;
  try {
    json = JSON.stringify(obj);
  } catch (err) {
    console.error('[send] could not serialise message', obj?.type, err.message);
    return; // a bad payload must never take the whole server down
  }
  const payload = Buffer.from(json, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text frame
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

function decodeWsFrames(buffer) {
  const messages = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const firstByte = buffer[offset];
    const secondByte = buffer[offset + 1];
    const opcode = firstByte & 0x0f;
    const isMasked = (secondByte & 0x80) !== 0;
    let payloadLen = secondByte & 0x7f;
    let headerLen = 2;

    if (payloadLen === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLen = buffer.readUInt16BE(offset + 2);
      headerLen = 4;
    } else if (payloadLen === 127) {
      if (offset + 10 > buffer.length) break;
      payloadLen = Number(buffer.readBigUInt64BE(offset + 2));
      headerLen = 10;
    }

    const maskLen = isMasked ? 4 : 0;
    if (offset + headerLen + maskLen + payloadLen > buffer.length) break;

    const payloadStart = offset + headerLen + maskLen;
    const payload = Buffer.alloc(payloadLen);
    if (isMasked) {
      const mask = buffer.subarray(offset + headerLen, offset + headerLen + 4);
      for (let i = 0; i < payloadLen; i++) {
        payload[i] = buffer[payloadStart + i] ^ mask[i % 4];
      }
    } else {
      buffer.copy(payload, 0, payloadStart, payloadStart + payloadLen);
    }

    offset = payloadStart + payloadLen;
    if (opcode === 0x08) {
      messages.push({ close: true });
    } else if (opcode === 0x09) {
      messages.push({ ping: true });
    } else if (opcode === 0x0a) {
      messages.push({ pong: true });
    } else if (opcode === 0x01) {
      messages.push({ text: payload.toString('utf8') });
    }
  }
  return { messages, remaining: buffer.subarray(offset) };
}

function broadcastToRoom(roomCode, msg, excludeId = null) {
  const room = rooms.get(roomCode);
  if (!room) return;
  for (const p of room.players) {
    if (p.id === excludeId) continue;
    const cl = clients.get(p.id);
    if (cl) sendWsJson(cl.socket, msg);
  }
}

function removeClientFromRoom(client) {
  if (!client.roomCode) return;
  const room = rooms.get(client.roomCode);
  client.roomCode = null;
  if (!room) return;
  const leaver = room.players.find(p => p.id === client.id);
  room.players = room.players.filter(p => p.id !== client.id);
  if (room.started && room.modeId === 'royale' && leaver) {
    room.pendingBots.push(leaver.team);
    delete room.orders?.[leaver.team];
    room.acks?.delete(String(leaver.team));
    if (room.phase === 'plan' && room.players.length && room.players.every(p => room.orders[p.team])) royaleCloseOrders(room);
    else if (room.phase === 'resolve' && room.players.length && room.players.every(p => room.acks.has(String(p.team)))) royaleNext(room);
  }
  if (room.players.length === 0) {
    royaleClear(room);
    rooms.delete(room.code);
  } else {
    if (room.hostId === client.id) {
      room.hostId = room.players[0].id;
    }
    broadcastToRoom(room.code, { type: 'ROOM_UPDATED', room: publicRoom(room) });
  }
}

function sanitizeConfig(cfg) {
  try {
    const json = JSON.stringify(cfg ?? {});
    if (json.length > MAX_CONFIG_BYTES) return {};
    return JSON.parse(json);
  } catch (_) {
    return {};
  }
}

function sendError(client, text) {
  sendWsJson(client.socket, { type: 'ERROR', text });
}


// ---------------------------------------------------------------------------------------------------------------
// Battle Royale referee (deterministic lockstep). The server never simulates the game: it times the planning phase,
// collects every human's orders, broadcasts the bundle, then waits for all clients to confirm they ended the round
// in the same state (hash). Bots are simulated identically by every client.
// ---------------------------------------------------------------------------------------------------------------
const ORDER_ACTS = new Set(['attack', 'heal', 'explore', 'claim', 'recruit', 'temper', 'study', 'wait']);

function cleanOrders(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const o of raw.slice(0, 32)) {
    if (!o || !Number.isInteger(o.unitId)) continue;
    const move = o.move && Number.isInteger(o.move.x) && Number.isInteger(o.move.y) ? { x: o.move.x, y: o.move.y } : null;
    const act =
      o.act && ORDER_ACTS.has(o.act.type)
        ? {
            type: o.act.type,
            ...(Number.isInteger(o.act.targetId) ? { targetId: o.act.targetId } : {}),
            ...(Number.isInteger(o.act.item) && o.act.item >= 0 && o.act.item < 256 ? { item: o.act.item } : {})
          }
        : null;
    out.push({ unitId: o.unitId, move, act });
  }
  return out;
}

function royaleInit(room) {
  room.round = 0;
  room.phase = 'idle';
  room.orders = {};
  room.acks = new Map();
  room.pendingBots = [];
  room.finished = false;
  room.planMs = Math.max(8, Math.min(120, Number(room.config?.plan) || 25)) * 1000;
}

function royaleClear(room) {
  clearTimeout(room.planTimer);
  clearTimeout(room.ackTimer);
}

function royaleStartPlan(room) {
  if (room.finished || !rooms.has(room.code) || room.players.length === 0) return royaleClear(room);
  room.round += 1;
  room.phase = 'plan';
  room.orders = {};
  broadcastToRoom(room.code, { type: 'ROUND_PLAN', round: room.round, ms: room.planMs, botTeams: room.pendingBots.splice(0) });
  clearTimeout(room.planTimer);
  room.planTimer = setTimeout(() => royaleCloseOrders(room), room.planMs + 1500); // grace for network latency
}

function royaleCloseOrders(room) {
  if (room.phase !== 'plan') return;
  clearTimeout(room.planTimer);
  room.phase = 'resolve';
  room.acks = new Map();
  broadcastToRoom(room.code, { type: 'ROUND_ORDERS', round: room.round, orders: room.orders });
  clearTimeout(room.ackTimer);
  room.ackTimer = setTimeout(() => royaleNext(room), 30000); // a stalled client must not freeze everyone
}

function royaleNext(room) {
  if (room.phase !== 'resolve') return;
  clearTimeout(room.ackTimer);
  // all clients must agree on the post-round state
  const tally = new Map();
  for (const h of room.acks.values()) tally.set(h, (tally.get(h) || 0) + 1);
  if (tally.size > 1) {
    const majority = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const odd = [...room.acks.entries()].filter(([, h]) => h !== majority).map(([team]) => Number(team));
    console.warn(`[royale ${room.code}] DESYNC in round ${room.round}: teams ${odd.join(',')}`);
    broadcastToRoom(room.code, { type: 'DESYNC', round: room.round, teams: odd });
  }
  room.phase = 'between';
  setTimeout(() => royaleStartPlan(room), 350);
}

function royaleAction(room, client, action) {
  const me = room.players.find(p => p.id === client.id);
  if (!me || !action || typeof action.type !== 'string') return;
  if (action.type === 'ORDERS') {
    if (room.phase !== 'plan' || action.round !== room.round) return;
    room.orders[me.team] = cleanOrders(action.orders);
    if (room.players.every(p => room.orders[p.team])) royaleCloseOrders(room);
  } else if (action.type === 'ROUND_DONE') {
    if (room.phase !== 'resolve' || action.round !== room.round) return;
    room.acks.set(String(me.team), Number(action.hash) >>> 0);
    if (room.players.every(p => room.acks.has(String(p.team)))) royaleNext(room);
  } else if (action.type === 'MATCH_END') {
    room.finished = true;
    royaleClear(room);
  }
}

function handleClientMessage(client, msg) {
  if (!msg || typeof msg.type !== 'string') return;

  if (msg.type === 'HELLO' || msg.type === 'SET_USERNAME') {
    client.username = String(msg.username || client.username || 'Commander').replace(/[\u0000-\u001f<>]/g, '').slice(0, 24) || 'Commander';
    if (client.roomCode) {
      const room = rooms.get(client.roomCode);
      const me = room?.players.find(p => p.id === client.id);
      if (me) {
        me.username = client.username;
        broadcastToRoom(room.code, { type: 'ROOM_UPDATED', room: publicRoom(room) });
      }
    }
  } else if (msg.type === 'LIST_ROOMS') {
    const list = Array.from(rooms.values()).map(r => ({
      code: r.code,
      name: r.name,
      modeId: r.modeId,
      maxPlayers: r.maxPlayers,
      started: r.started,
      playerCount: r.players.length
    }));
    sendWsJson(client.socket, { type: 'ROOM_LIST', rooms: list });
  } else if (msg.type === 'CREATE_ROOM') {
    removeClientFromRoom(client);
    if (rooms.size >= CONFIG.maxRooms) return sendError(client, 'The server is full right now — please try again in a minute.');
    let code;
    do code = generateRoomCode();
    while (rooms.has(code));
    const room = {
      code,
      name: String(msg.roomName || `${client.username}'s Room`).replace(/[\u0000-\u001f<>]/g, '').slice(0, 36),
      hostId: client.id,
      modeId: String(msg.modeId || 'skirmish').slice(0, 24),
      config: sanitizeConfig(msg.config),
      maxPlayers: Math.min(String(msg.modeId) === 'royale' ? 60 : 4, Math.max(2, Number(msg.maxPlayers) || 2)),
      started: false,
      players: [{ id: client.id, username: client.username, team: 0 }]
    };
    rooms.set(code, room);
    client.roomCode = code;
    sendWsJson(client.socket, { type: 'ROOM_JOINED', room: publicRoom(room) });
  } else if (msg.type === 'JOIN_ROOM') {
    const room = rooms.get(String(msg.roomCode || '').toUpperCase());
    if (!room) return sendError(client, 'That room no longer exists.');
    if (room.started) return sendError(client, 'That battle has already begun.');
    if (room.players.length >= room.maxPlayers) return sendError(client, 'That room is full.');
    if (client.roomCode !== room.code) removeClientFromRoom(client);
    if (!room.players.some(p => p.id === client.id)) {
      const used = new Set(room.players.map(p => p.team));
      let team = 0;
      while (used.has(team)) team++;
      room.players.push({ id: client.id, username: client.username, team });
    }
    client.roomCode = room.code;
    sendWsJson(client.socket, { type: 'ROOM_JOINED', room: publicRoom(room) });
    broadcastToRoom(room.code, { type: 'ROOM_UPDATED', room: publicRoom(room) }, client.id);
  } else if (msg.type === 'LEAVE_ROOM') {
    removeClientFromRoom(client);
    sendWsJson(client.socket, { type: 'ROOM_LEFT' });
  } else if (msg.type === 'CHAT') {
    if (!client.roomCode) return;
    const now = Date.now();
    if (now - (client.lastChat || 0) < 400) return; // flood guard
    client.lastChat = now;
    broadcastToRoom(client.roomCode, {
      type: 'CHAT_MESSAGE',
      sender: client.username,
      text: String(msg.text || '').replace(/[\u0000-\u001f]/g, '').slice(0, 200)
    });
  } else if (msg.type === 'START_MATCH') {
    const room = rooms.get(client.roomCode);
    if (!room || room.hostId !== client.id || room.started) return;
    room.started = true;
    broadcastToRoom(room.code, { type: 'MATCH_STARTED', room: publicRoom(room) });
    if (room.modeId === 'royale') {
      royaleInit(room);
      setTimeout(() => royaleStartPlan(room), 1500); // let every client build the island first
    }
  } else if (msg.type === 'GAME_ACTION') {
    const room = rooms.get(client.roomCode);
    if (!room || !room.started) return;
    if (room.modeId === 'royale') return royaleAction(room, client, msg.action);
    broadcastToRoom(room.code, { type: 'REMOTE_GAME_ACTION', action: msg.action, from: client.id }, client.id);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// HTTP: the static client, a health probe, and the WebSocket upgrade
// ---------------------------------------------------------------------------------------------------------------
const startedAt = Date.now();
const serveStatic = createStaticHandler({
  dir: STATIC_DIR,
  csp: contentSecurityPolicy({ connect: CONFIG.allowedOrigins.map(o => o.replace(/^http/, 'ws')) }),
  reportOnly: CONFIG.cspReportOnly,
  log: (...a) => console.error('[static]', ...a)
});
const ipCounter = new IpCounter(CONFIG.maxPerIp);

const server = http.createServer((req, res) => {
  if (req.url === '/healthz' || req.url.startsWith('/healthz?')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, version: CONFIG.version, uptime: Math.round((Date.now() - startedAt) / 1000), clients: clients.size, rooms: rooms.size }));
    return;
  }
  if (CONFIG.cspReportOnly && req.method === 'POST' && req.url === '/csp-report') {
    let body = '';
    req.on('data', c => {
      if (body.length < 8192) body += c;
    });
    req.on('end', () => {
      console.warn('[csp]', body.replace(/\s+/g, ' ').slice(0, 600));
      res.writeHead(204).end();
    });
    return;
  }
  serveStatic(req, res);
});
server.keepAliveTimeout = 65000;
server.headersTimeout = 20000;
server.requestTimeout = 30000;
server.maxHeadersCount = 60;
// malformed requests get a clean 400 instead of an unhandled error
server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  else socket.destroy();
});

const refuse = (socket, status, text) => {
  if (socket.writable) socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
};

server.on('upgrade', (req, socket) => {
  socket.on('error', () => socket.destroy()); // resets during the handshake must never surface as unhandled errors
  const pathname = (req.url || '').split('?')[0];
  const key = String(req.headers['sec-websocket-key'] || '');
  if (pathname !== '/ws' || req.headers['upgrade']?.toLowerCase() !== 'websocket') return refuse(socket, 404, 'Not Found');
  if (req.headers['sec-websocket-version'] !== '13' || key.length !== 24) return refuse(socket, 400, 'Bad Request');
  if (!originAllowed(req.headers.origin, req.headers.host, CONFIG.allowedOrigins)) return refuse(socket, 403, 'Forbidden');
  const ip = clientIp(req, CONFIG.trustProxy);
  if (clients.size >= CONFIG.maxClients) return refuse(socket, 503, 'Service Unavailable');
  if (!ipCounter.tryAdd(ip)) return refuse(socket, 429, 'Too Many Requests');

  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);

  const clientId = crypto.randomUUID();
  const client = { id: clientId, socket, username: 'Commander', roomCode: null, ip };
  clients.set(clientId, client);
  sendWsJson(socket, { type: 'WELCOME', playerId: clientId });

  const bucket = new TokenBucket(CONFIG.msgBurst, CONFIG.msgPerSec);
  let strikes = 0;
  let lastSeen = Date.now();
  let recvBuf = Buffer.alloc(0);

  socket.on('data', chunk => {
    lastSeen = Date.now();
    recvBuf = Buffer.concat([recvBuf, chunk]);
    if (recvBuf.length > MAX_FRAME) {
      socket.destroy();
      return;
    }
    const { messages, remaining } = decodeWsFrames(recvBuf);
    recvBuf = remaining;
    for (const m of messages) {
      if (m.close) {
        socket.end();
        return;
      }
      if (m.ping) {
        if (socket.writable) socket.write(Buffer.from([0x8a, 0x00]));
        continue;
      }
      if (!m.text) continue;
      if (!bucket.take()) {
        // over the allowance: drop the message, and drop the connection if it keeps hammering
        if (++strikes > 200) return socket.destroy();
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(m.text);
      } catch (_) {
        continue; // not JSON: ignore
      }
      try {
        handleClientMessage(client, parsed);
      } catch (err) {
        console.error(`[handler] ${parsed?.type}:`, err); // a bug must be visible, never swallowed
      }
    }
  });

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    removeClientFromRoom(client);
    clients.delete(clientId);
    ipCounter.remove(ip);
  };
  // Heartbeat: a ping every PING_MS (browsers answer automatically); a peer silent for DEAD_MS is gone — a closed laptop or
  // dead Wi-Fi never sends a FIN, and without this its ghost would hold a seat (and a connection slot) forever.
  const heartbeat = setInterval(() => {
    if (Date.now() - lastSeen > CONFIG.deadMs) return socket.destroy();
    if (socket.writable) socket.write(Buffer.from([0x89, 0x00]));
  }, CONFIG.pingMs);
  heartbeat.unref();
  socket.setKeepAlive(true, 15000);
  socket.on('end', () => {
    cleanup();
    socket.destroy();
  });
  socket.on('close', cleanup);
  socket.on('error', () => {
    cleanup();
    socket.destroy();
  });
});

server.listen(PORT, CONFIG.host, () => {
  console.log(`${brandTitle()} · web & multiplayer server v${CONFIG.version}`);
  console.log(`  listening  http://${CONFIG.host === '0.0.0.0' ? 'localhost' : CONFIG.host}:${PORT}   (serving ${path.relative(process.cwd(), STATIC_DIR) || STATIC_DIR})`);
  console.log(`  limits     ${CONFIG.maxClients} clients, ${CONFIG.maxPerIp} per address, ${CONFIG.maxRooms} rooms · proxy ${CONFIG.trustProxy ? 'trusted' : 'not trusted'}`);
  if (CONFIG.allowedOrigins.length) console.log(`  origins    same-origin + ${CONFIG.allowedOrigins.join(', ')}`);
});

// A game server should survive a bug in one room: log it loudly and keep serving everyone else.
process.on('uncaughtException', err => console.error('[uncaught]', err));
process.on('unhandledRejection', err => console.error('[unhandled rejection]', err));

// Graceful shutdown (deploys, container stops): tell every player, then leave.
function shutdown(signal) {
  console.log(`${signal} — shutting down`);
  server.close();
  for (const c of clients.values()) {
    sendWsJson(c.socket, { type: 'ERROR', text: 'The server is restarting — please reconnect in a moment.' });
    c.socket.end(Buffer.from([0x88, 0x00]));
  }
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
