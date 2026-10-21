// Hardening tests for the HTTP + WebSocket server. It spawns the real server on a free port with tight limits and attacks it.
//   node scripts/test-server.mjs

import { spawn } from 'child_process';
import http from 'http';
import net from 'net';
import zlib from 'zlib';
import path from 'path';
import { fileURLToPath } from 'url';
import { openSocket } from './lib/wsClient.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
let checks = 0;
const check = (ok, msg) => {
  checks++;
  if (!ok) failures++;
  console.log(ok ? `  ✓ ${msg}` : `  ✗ FAIL: ${msg}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function freePort() {
  return new Promise(resolve => {
    const s = net.createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function startServer(env) {
  return new Promise((resolve, reject) => {
    freePort().then(port => {
      const child = spawn(process.execPath, ['server/server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ...env } });
      let out = '';
      const done = () => resolve({ port, child, out: () => out, stop: () => new Promise(r => (child.once('exit', r), child.kill('SIGKILL'))) });
      child.stdout.on('data', d => {
        out += d;
        if (out.includes('listening')) done();
      });
      child.stderr.on('data', d => (out += d));
      child.on('error', reject);
      setTimeout(() => reject(new Error('server did not start:\n' + out)), 8000);
    });
  });
}

function request(port, { method = 'GET', url = '/', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

const rawHttp = (port, text) =>
  new Promise(resolve => {
    const s = net.connect(port, '127.0.0.1', () => s.write(text));
    let got = '';
    s.on('data', d => (got += d));
    s.on('close', () => resolve(got));
    s.on('error', () => resolve(got));
    setTimeout(() => (s.destroy(), resolve(got)), 1500);
  });

// ================================================================================================================
const A = await startServer({ MAX_PER_IP: '3', MSG_BURST: '5', MSG_PER_SEC: '1', MAX_ROOMS: '1', PING_MS: '200', DEAD_MS: '700', ALLOWED_ORIGINS: 'https://play.example.com' });
const { port } = A;
try {
  console.log('\n== Static files');
  const index = await request(port, { url: '/' });
  check(index.status === 200 && /text\/html/.test(index.headers['content-type']) && index.body.toString().includes('game-canvas'), 'GET / serves the game');
  check(/default-src 'self'/.test(index.headers['content-security-policy']) && /object-src 'none'/.test(index.headers['content-security-policy']), 'a strict Content-Security-Policy is sent');
  check(index.headers['x-content-type-options'] === 'nosniff' && index.headers['x-frame-options'] === 'SAMEORIGIN' && !!index.headers['referrer-policy'], 'nosniff, frame and referrer headers are sent');

  const rawJs = (await request(port, { url: '/js/main.js' })).body;
  const gz = await request(port, { url: '/js/main.js', headers: { 'Accept-Encoding': 'gzip' } });
  check(gz.headers['content-encoding'] === 'gzip' && zlib.gunzipSync(gz.body).equals(rawJs) && gz.body.length < rawJs.length, `gzip works and round-trips (${rawJs.length} → ${gz.body.length} bytes)`);
  const br = await request(port, { url: '/js/app/App.js', headers: { 'Accept-Encoding': 'br, gzip' } });
  check(br.headers['content-encoding'] === 'br' && zlib.brotliDecompressSync(br.body).length > br.body.length, 'brotli is preferred when offered');
  const etag = gz.headers.etag;
  const again = await request(port, { url: '/js/main.js', headers: { 'If-None-Match': etag } });
  check(!!etag && again.status === 304 && again.body.length === 0, 'an unchanged file answers 304 Not Modified');
  check(/no-cache/.test(gz.headers['cache-control']), 'code is revalidated on every load, never served stale');
  const png = await request(port, { url: '/assets/icons/icon-192.png' });
  check(png.status === 200 && /max-age=\d+/.test(png.headers['cache-control']) && !png.headers['content-encoding'], 'images are cached and not re-compressed');

  const head = await request(port, { method: 'HEAD', url: '/' });
  check(head.status === 200 && head.body.length === 0 && Number(head.headers['content-length']) > 100, 'HEAD returns headers only');
  const mp3 = (await request(port, { url: '/assets/audio/' })).status; // directory: not listed
  check(mp3 === 404, 'directories are not listed');
  const ranged = await request(port, { url: '/assets/icons/icon-512.png', headers: { Range: 'bytes=0-99' } });
  check(ranged.status === 206 && ranged.body.length === 100 && /^bytes 0-99\/\d+$/.test(ranged.headers['content-range']), 'byte-range requests work (audio seeking, Safari)');
  const bad = await request(port, { url: '/assets/icons/icon-512.png', headers: { Range: 'bytes=999999999-' } });
  check(bad.status === 416, 'an unsatisfiable range is refused');

  console.log('\n== Hostile requests');
  const trav = await request(port, { url: '/..%2f..%2fpackage.json' });
  check((trav.status === 403 || trav.status === 404) && !trav.body.toString().includes('"name"'), 'path traversal is refused');
  const trav2 = await rawHttp(port, 'GET /../../server/server.mjs HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
  check(!trav2.includes('createStaticHandler'), 'raw ../ traversal does not leak server code');
  const malformed = await request(port, { url: '/%E0%A4%A' });
  check(malformed.status === 400, 'a malformed percent-escape is a 400, not a crash');
  const nul = await request(port, { url: '/index.html%00.png' });
  check(nul.status === 400, 'a NUL byte in the path is refused');
  const post = await request(port, { method: 'POST', url: '/' });
  check(post.status === 405 && /GET/.test(post.headers.allow), 'other methods are 405');
  const garbage = await rawHttp(port, 'THIS IS NOT HTTP\r\n\r\n');
  check(/400/.test(garbage), 'garbage on the HTTP port gets a clean 400');
  const health = await request(port, { url: '/healthz' });
  const hj = JSON.parse(health.body.toString());
  check(health.status === 200 && hj.ok === true && typeof hj.version === 'string', 'the server is still alive after all of that (/healthz)');

  console.log('\n== WebSocket handshake');
  check((await openSocket(port, { path: '/nope' })).status === 404, 'only /ws upgrades');
  check((await openSocket(port, { origin: 'https://evil.example' })).status === 403, 'a foreign browser origin is refused (no cross-site hijacking)');
  const okSame = await openSocket(port, { origin: `http://127.0.0.1:${port}` });
  check(okSame.status === 101, 'the server’s own origin is accepted');
  okSame.client.sock.destroy();
  const okListed = await openSocket(port, { origin: 'https://play.example.com' });
  check(okListed.status === 101, 'an origin listed in ALLOWED_ORIGINS is accepted');
  okListed.client.sock.destroy();
  const noOrigin = await openSocket(port);
  check(noOrigin.status === 101, 'non-browser clients (no Origin) are accepted');
  noOrigin.client.sock.destroy();
  check((await openSocket(port, { key: 'short' })).status === 400, 'a malformed Sec-WebSocket-Key is refused');
  await sleep(100);

  console.log('\n== Limits');
  const held = [];
  for (let i = 0; i < 3; i++) held.push((await openSocket(port)).client);
  const fourth = await openSocket(port);
  check(fourth.status === 429, 'a fourth connection from one address is refused (MAX_PER_IP=3)');
  held.forEach(c => c.sock.destroy());
  await sleep(150);

  const flood = (await openSocket(port)).client;
  for (let i = 0; i < 60; i++) flood.send({ type: 'LIST_ROOMS' });
  await sleep(300);
  const answered = flood.messages.filter(m => m.type === 'ROOM_LIST').length;
  check(answered >= 1 && answered <= 8, `a message flood is throttled (${answered} of 60 answered)`);
  flood.sock.destroy();
  await sleep(150);

  const big = (await openSocket(port)).client;
  big.raw(Buffer.alloc(300 * 1024, 0x81));
  await sleep(200);
  check(big.closed, 'an oversized frame drops the connection');
  check((await request(port, { url: '/healthz' })).status === 200, 'and the server keeps serving');
  await sleep(100);

  const r1 = (await openSocket(port)).client;
  r1.send({ type: 'CREATE_ROOM', roomName: 'one', modeId: 'skirmish', maxPlayers: 2 });
  await sleep(150);
  const r2 = (await openSocket(port)).client;
  r2.send({ type: 'CREATE_ROOM', roomName: 'two', modeId: 'skirmish', maxPlayers: 2 });
  await sleep(150);
  check(!!r1.last('ROOM_JOINED') && !r2.last('ROOM_JOINED') && /full/.test(r2.last('ERROR')?.text || ''), 'room creation stops at MAX_ROOMS with a friendly message');
  r1.sock.destroy();
  r2.sock.destroy();
  await sleep(150);

  console.log('\n== Heartbeat');
  const quiet = (await openSocket(port)).client;
  await sleep(500);
  check(quiet.pings >= 1, `the server pings idle clients (${quiet.pings} pings)`);
  await sleep(500);
  check(quiet.closed, 'a client that never answers is dropped (dead-peer detection)');
  const alive = (await openSocket(port)).client;
  for (let i = 0; i < 8; i++) {
    await sleep(150);
    alive.pong();
  }
  check(!alive.closed, 'a client that answers pings stays connected');
  alive.sock.destroy();
} finally {
  await A.stop();
}

console.log(failures ? `\n${failures} of ${checks} check(s) FAILED` : `\nServer hardening OK — all ${checks} checks passed ✓`);
process.exit(failures ? 1 : 0);
