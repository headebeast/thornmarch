// Protocol-level test of the Battle Royale referee (no browser): N fake players join a room, play rounds by submitting
// orders and acknowledging with hashes, one leaves mid-match, then everyone disconnects. Verifies the server keeps the
// clock moving, reports DESYNC on hash mismatch, and never crashes.
//   node scripts/test-online-royale.mjs [port=3080]
// Minimal RFC 6455 client built on raw sockets (no dependencies), mirroring the server's own framing.

import net from 'net';
import crypto from 'crypto';

const PORT = Number(process.argv[2] || 3080);

function connect(name) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PORT, '127.0.0.1');
    const key = crypto.randomBytes(16).toString('base64');
    let buf = Buffer.alloc(0);
    let upgraded = false;
    const client = { name, messages: [], sock, send: o => sock.write(frame(JSON.stringify(o))) };
    sock.on('connect', () => sock.write(`GET /ws HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      if (!upgraded) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        buf = buf.subarray(i + 4);
        upgraded = true;
        resolve(client);
      }
      for (;;) {
        if (buf.length < 2) break;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) break;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) break;
          len = Number(buf.readBigUInt64BE(2));
          off = 10;
        }
        if (buf.length < off + len) break;
        client.messages.push(JSON.parse(buf.subarray(off, off + len).toString()));
        buf = buf.subarray(off + len);
      }
    });
    sock.on('error', reject);
  });
}

function frame(text) {
  const p = Buffer.from(text);
  const mask = crypto.randomBytes(4);
  const head = p.length < 126 ? Buffer.from([0x81, 0x80 | p.length]) : Buffer.from([0x81, 0x80 | 126, p.length >> 8, p.length & 255]);
  const masked = Buffer.from(p.map((b, i) => b ^ mask[i % 4]));
  return Buffer.concat([head, mask, masked]);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const last = (c, type) => [...c.messages].reverse().find(m => m.type === type);
let failures = 0;
const check = (ok, msg) => {
  console.log(ok ? `  ✓ ${msg}` : `  ✗ FAIL: ${msg}`);
  if (!ok) failures++;
};

const players = [];
for (const n of ['host', 'a', 'b', 'c']) players.push(await connect(n));
players.forEach((p, i) => p.send({ type: 'HELLO', username: `P${i}` }));
await sleep(200);
players[0].send({ type: 'CREATE_ROOM', roomName: 'proto', modeId: 'royale', config: { plan: 10, players: 20 }, maxPlayers: 20 });
await sleep(200);
const code = last(players[0], 'ROOM_JOINED').room.code;
for (const p of players.slice(1)) p.send({ type: 'JOIN_ROOM', roomCode: code });
await sleep(300);
check(last(players[0], 'ROOM_UPDATED').room.players.length === 4, '4 players in a royale room (capacity above the classic limit of 4 works)');

players[1].send({ type: 'START_MATCH' });
await sleep(200);
check(!last(players[1], 'MATCH_STARTED'), 'only the host can start');
players[0].send({ type: 'START_MATCH' });
await sleep(2300);
check(players.every(p => last(p, 'ROUND_PLAN')?.round === 1), 'server opens round 1 for everyone');

async function playRound(round, who, { badHashFor = null } = {}) {
  const orders = [
    { unitId: 1, move: { x: 3, y: 4 }, act: { type: 'recruit', item: 3 } }, // a building order with an item: kept
    { unitId: 2, move: null, act: { type: 'hack', item: 1 } }, // unknown action: dropped
    { unitId: 3, move: null, act: { type: 'claim', item: 99999 } }, // absurd item: stripped, the claim itself is fine
    { evil: true }
  ];
  for (const p of who) p.send({ type: 'GAME_ACTION', action: { type: 'ORDERS', round, orders } });
  await sleep(250);
  const bundles = who.map(p => last(p, 'ROUND_ORDERS'));
  check(bundles.every(b => b && b.round === round), `round ${round}: orders bundle delivered to all (${who.length})`);
  const teams = Object.keys(bundles[0].orders);
  const mine = bundles[0].orders[teams[0]];
  check(teams.length === who.length && mine.length === 3, `round ${round}: every player's orders present and sanitised`);
  check(mine[0].act?.type === 'recruit' && mine[0].act.item === 3 && mine[1].act === null && mine[2].act?.type === 'claim' && mine[2].act.item === undefined, `round ${round}: building orders keep their item, unknown actions and absurd items are dropped`);
  who.forEach((p, i) => p.send({ type: 'GAME_ACTION', action: { type: 'ROUND_DONE', round, hash: badHashFor === p ? 999 : 12345 } }));
  await sleep(700);
}

await playRound(1, players);
check(players.every(p => last(p, 'ROUND_PLAN')?.round === 2), 'round 2 opens once everyone acknowledged');
await playRound(2, players);

// a player disconnects: the others continue and are told which team is now a bot
players[3].sock.destroy();
await sleep(300);
const survivors = players.slice(0, 3);
await sleep(1000);
const plan3 = last(survivors[0], 'ROUND_PLAN');
check(plan3?.round === 3, 'round 3 opens');
check(last(survivors[0], 'ROOM_UPDATED')?.room.players.length === 3, 'the room noticed the abrupt disconnect (no ghost player)');
// the drop happened mid-plan: round 3 closes as soon as the three remaining players have submitted
await playRound(3, survivors, { badHashFor: survivors[2] });
check(!!last(survivors[0], 'DESYNC'), 'a mismatching state hash is reported as DESYNC');
await sleep(600);
const plan4 = last(survivors[0], 'ROUND_PLAN');
check(plan4?.round === 4 && plan4.botTeams?.includes(3), `round 4: the dropped warband (team 3) is handed to a bot (botTeams=${JSON.stringify(plan4?.botTeams)})`);

// nobody left alive: the server must survive all sockets vanishing mid-round
survivors.forEach(p => p.sock.destroy());
await sleep(500);
const alive = await connect('probe').then(p => { p.sock.destroy(); return true; }).catch(() => false);
check(alive, 'server still accepting connections after every client vanished');

console.log(failures ? `\n${failures} check(s) FAILED` : '\nOnline royale protocol OK ✓');
process.exit(failures ? 1 : 0);
