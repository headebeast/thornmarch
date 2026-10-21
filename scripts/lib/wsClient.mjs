// Minimal RFC 6455 client on raw sockets (no dependencies) for tests: it can refuse to pong, send garbage, and report how the
// server answered the handshake — everything a polite browser client never does.

import net from 'net';
import crypto from 'crypto';

function frame(opcode, payload) {
  const p = Buffer.isBuffer(payload) ? payload : Buffer.from(payload ?? '');
  const mask = crypto.randomBytes(4);
  const head =
    p.length < 126 ? Buffer.from([0x80 | opcode, 0x80 | p.length]) : p.length < 65536 ? Buffer.from([0x80 | opcode, 0x80 | 126, p.length >> 8, p.length & 255]) : null;
  const header = head || Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(p.length)); return b; })()]);
  const masked = Buffer.from(p.map((b, i) => b ^ mask[i % 4]));
  return Buffer.concat([header, mask, masked]);
}

/**
 * Resolves { status, client } where `status` is the HTTP status of the handshake (101 = connected).
 * opts: { path='/ws', origin, headers:{}, key }
 */
export function openSocket(port, { path = '/ws', origin, headers = {}, key = crypto.randomBytes(16).toString('base64'), host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, host);
    let buf = Buffer.alloc(0);
    let upgraded = false;
    const client = {
      sock,
      messages: [],
      pings: 0,
      closed: false,
      send: o => sock.write(frame(0x1, JSON.stringify(o))),
      sendText: t => sock.write(frame(0x1, t)),
      pong: () => sock.write(frame(0xa, '')),
      raw: b => sock.write(b),
      last: type => [...client.messages].reverse().find(m => m.type === type)
    };
    sock.on('close', () => (client.closed = true));
    sock.on('error', () => (client.closed = true));
    sock.on('connect', () => {
      const lines = [`GET ${path} HTTP/1.1`, `Host: ${host}:${port}`, 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Key: ${key}`, 'Sec-WebSocket-Version: 13'];
      if (origin) lines.push(`Origin: ${origin}`);
      for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);
      sock.write(lines.join('\r\n') + '\r\n\r\n');
    });
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      if (!upgraded) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(buf.subarray(0, i).toString())?.[1]);
        buf = buf.subarray(i + 4);
        upgraded = true;
        resolve({ status, client });
        if (status !== 101) return;
      }
      for (;;) {
        if (buf.length < 2) break;
        const opcode = buf[0] & 0x0f;
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
        const payload = buf.subarray(off, off + len);
        buf = buf.subarray(off + len);
        if (opcode === 0x9) client.pings++;
        else if (opcode === 0x1) client.messages.push(JSON.parse(payload.toString()));
      }
    });
    sock.on('error', reject);
  });
}
