# Publishing the game

The game is a folder of static files (the client) plus one small Node program (`server/server.mjs`) that serves those files
**and** runs the online multiplayer rooms. Single-player modes need only the files. There is nothing to install — no npm
dependencies, no database.

## Live deployment

| | |
|---|---|
| Game (single-player, Battle Royale vs bots) | https://thornmarch.netlify.app — Netlify site `thornmarch` |
| Source code | https://github.com/headebeast/thornmarch |
| Players' dashboard | https://thornmarch.netlify.app/admin/ — sign in with the key (kept in `DASHBOARD-KEY.txt` next to this project, never in git) |
| Privacy notice | https://thornmarch.netlify.app/privacy.html |
| Online rooms | **not running yet** — they need the Node game server on a host that runs a program all day |

**Turning on online play (about five minutes, needs a Fly.io account):**

```bash
flyctl auth login            # opens a browser; Fly asks for a payment card on new accounts
flyctl apps create thornmarch-game
npm run deploy:server        # builds the Docker image remotely and deploys (fly.toml is ready; the machine sleeps when nobody is connected)
```

Then in `netlify.toml` set `ONLINE = "on"` and `SERVER_URL = "wss://thornmarch-game.fly.dev"`, and run
`netlify deploy --prod --dir dist --site 2f3986dd-9f17-4d3f-9b1e-e0634e6c04ca` (or push to GitHub if the site is Git-connected).
Check: `https://thornmarch-game.fly.dev/healthz` answers `{"ok":true,…}` and the menu shows **Online Battle**.

Any other host works too — see section 2 above.

## 0. Before you publish — the checklist

| | |
|---|---|
| ✅ **The game has its own name** (Thornmarch) — "Ancient Empires" belongs to its original publisher. Change it again any time in `public/js/config/brand.js`. A web search found no existing standalone game by that name, but that is not a legal trademark search. | |
| ☐ **Publish the source code** (a public repository is the easiest way) and give the address as `SOURCE_URL` when you build. The GPL requires that players can get the source of what they are running; the About box shows the link. | |
| ☐ **Keep the licence files** `public/LICENSE.txt` and `public/CREDITS.txt` (already in the build). | |
| ☐ **Know your address** and give it as `SITE_URL` so link previews (Discord, X, Facebook…) work. | |
| ☐ **Serve over HTTPS.** Installing the game as an app, full-screen and the offline cache need a secure origin. | |
| ☐ Run `npm run verify` — tests, server hardening tests, build, release checks. All green? Ship. `node scripts/check-release.mjs --strict` also fails while the reminders above are open. | |

## 1. Build

```bash
SITE_URL=https://play.example.com \
SOURCE_URL=https://github.com/you/your-repo \
npm run build          # → dist/
```

| Variable | Meaning | Default |
|---|---|---|
| `SITE_URL` | Public address of the game (canonical link, link-preview image) | – |
| `SOURCE_URL` | Where the source code is published (About box) | – |
| `SERVER_URL` | `wss://…` address of the multiplayer server when it is **not** the same host as the page | same host |
| `ONLINE` | `off` hides all online play (use on a host with no server) | `on` |

`dist/` is the whole client: HTML, JS (76 small ES modules, ~170 KB gzipped), art, `manifest.webmanifest`, a **generated service
worker** (offline play; its cache name is a hash of the files, so an update can never mix old and new files) and `_headers`
(security headers + cache rules for Netlify / Cloudflare Pages). Total ≈ 4 MB, of which the music (2.8 MB) streams on demand.

## 2. Pick a way to host it

### A. One Node server does everything (recommended — online play just works)

Any host that runs Node 18+ or Docker: a VPS, Render, Railway, Fly.io, a home server…

```bash
npm run build
STATIC_DIR=dist PORT=3080 TRUST_PROXY=1 node server/server.mjs
```

or with Docker (the image builds the client for you):

```bash
docker build -t aeii --build-arg SITE_URL=https://play.example.com --build-arg SOURCE_URL=https://github.com/you/repo .
docker run -d --restart unless-stopped -p 3080:3080 aeii
```

Put HTTPS in front (Caddy shown — it also forwards WebSockets automatically):

```
play.example.com {
    reverse_proxy 127.0.0.1:3080
}
```

nginx needs the upgrade headers for `/ws`:

```nginx
location / {
    proxy_pass http://127.0.0.1:3080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 120s;
}
```

Always set `TRUST_PROXY=1` behind a proxy (so the per-address limits see the real player, not the proxy). Health probe: `GET /healthz`
returns `{"ok":true,"version":…,"clients":…,"rooms":…}`.

### B. Static site + separate game server

Host `dist/` on Netlify / Cloudflare Pages / GitHub Pages / any CDN, and run the server (option A) somewhere else only for
online play. Build with the server's address, and tell the server which site may connect:

```bash
SERVER_URL=wss://game.example.com SITE_URL=https://play.example.com npm run build
# on the game server:
ALLOWED_ORIGINS=https://play.example.com STATIC_DIR=dist TRUST_PROXY=1 node server/server.mjs
```

On Netlify: build command `npm run build`, publish directory `dist` (`netlify.toml` is included); set `SITE_URL`, `SOURCE_URL`,
`SERVER_URL` as environment variables. The generated `dist/_headers` already allows the socket in the Content-Security-Policy.

### C. Static only (no online play)

`ONLINE=off npm run build`, upload `dist/` anywhere (GitHub Pages, itch.io as an HTML5 zip with `index.html` at the root, a bucket…).
The Online Battle entry disappears; every other mode, including Battle Royale against bots, works.

## 3. Running the server

Everything is an environment variable (see `server/limits.mjs`):

| Variable | Default | |
|---|---|---|
| `PORT`, `HOST` | `3080`, `0.0.0.0` | |
| `STATIC_DIR` | `public` | folder to serve — use `dist` in production |
| `ALLOWED_ORIGINS` | – | comma list of extra sites allowed to open the multiplayer socket (the server's own origin is always allowed) |
| `TRUST_PROXY` | off | `1` behind a reverse proxy / PaaS |
| `MAX_CLIENTS` / `MAX_PER_IP` / `MAX_ROOMS` | 3000 / 24 / 600 | connection and room limits |
| `MSG_BURST` / `MSG_PER_SEC` | 40 / 20 | per-connection message allowance |
| `PING_MS` / `DEAD_MS` | 25000 / 90000 | heartbeat; a silent peer is dropped after `DEAD_MS` |
| `CSP_REPORT_ONLY` | off | `1` logs Content-Security-Policy violations (to the server console) instead of enforcing — handy when adding a CDN |

What the server does for you: strict security headers and CSP, gzip/brotli, ETag/304, byte-range audio, path-traversal and
malformed-URL protection, WebSocket origin checks, per-address and per-message limits, dead-peer detection, a room cap,
graceful shutdown (players are told), and it keeps running if one room hits a bug (the error is logged).

**Things to know**
- Room state lives in the server's memory: run **one process**, and a restart ends running online matches (waiting rooms vanish too).
  Single-player is unaffected.
- Battle Royale online is deterministic lockstep: the server is only a referee, so a 60-player room costs it almost nothing, but
  every player's browser simulates the whole match (a 60-warband round took 0.1–0.4 s on the development PC; slower phones will take longer — untested on real devices). A hacked
  client could peek at fogged information — fine for a casual game, not for money prizes.
- I have not load-tested thousands of simultaneous players; the limits above are conservative defaults, not measured capacity.
- Chat is plain text, length-capped and rate-limited, but not moderated. If you open it to the public, consider a profanity filter or
  turning chat off.

## 3b. What a multiplayer server needs

Online play = one small Node program (`server/server.mjs`, no dependencies) that is **always running** and reachable over **HTTPS/WSS**.

| Need | Why | Options |
|---|---|---|
| A host that runs a program 24/7 and allows WebSockets | rooms live in its memory | Fly.io, Render, Railway, a VPS (Hetzner ≈ €4/month, Oracle's always-free VM), or your own PC kept on |
| HTTPS (`wss://`) | browsers block plain `ws://` from an https page | all of the above provide it (a VPS needs Caddy — one line, see §2) |
| Node 18+ or Docker | the server | `Dockerfile` and `fly.toml` are included |
| Nothing else | no database, no accounts, no game logic on the server (it only times rounds and relays orders) | — |

Sizing: each player sends one tiny message per round, so a 256 MB machine is plenty for hundreds of players; it has not been load-tested. Netlify, GitHub Pages and Vercel **cannot** run it (they only serve files / short functions).

## 3c. Usage statistics and the dashboard

Players are asked once whether they agree to share anonymous usage statistics; nothing is recorded before "Allow" (see `public/privacy.html` — it is written to match the code exactly, so update it if you change what is collected).

| Recorded (after consent) | Never recorded |
|---|---|
| screens + time on each · labelled buttons pressed · matches (mode, players, result, length) · active minutes · scroll/zoom counts · average FPS / ping / loss · crashes · device class, OS, browser, language, time zone, referrer · **IP address, masked** (`203.0.113.77` → `203.0.113.0`) + a salted hash · **city-level location** from the host's geo-IP | names, chat, room names, match contents, click coordinates, the raw user-agent, anything typed |

- **Where it is stored:** Netlify Blobs on this deployment (`netlify/functions/*`), or a folder on disk on the Node server (`ANALYTICS_DIR`). One JSON file per play session, deleted after **90 days** (`ANALYTICS_RETENTION_DAYS`; a daily scheduled function does it).
- **Read it:** `/admin/` — needs `ANALYTICS_TOKEN`. The deployed key is in `DASHBOARD-KEY.txt`. To change it: `netlify env:set ANALYTICS_TOKEN <new> --secret --context production` and redeploy.
- **Keep whole IP addresses** instead of masked ones: `ANALYTICS_FULL_IP=1` (then update the privacy notice — it promises masking).
- **Erase:** players press *Settings → Erase my data*; operators can't be asked to find one person, because no name is stored — the random visitor id is the handle.
- **Turn it off for a deployment:** build without `ANALYTICS_URL` — no banner, no tracking code runs.
- **On the Node server** (e.g. Fly): `ANALYTICS_DIR=/data ANALYTICS_TOKEN=… node server/server.mjs` (put `/data` on a volume). Location is only known if a proxy supplies it (Cloudflare's `CF-IPCountry`); a bare VPS records country-less sessions.
- **Law, briefly:** collecting IP addresses and behaviour counts as personal data in the EU/UK and several other places. Consent-first, masking, 90-day deletion, an erase button and a plain notice are the usual safeguards, and are built in — but you are the operator: check the rules where your players live, and put a contact in the privacy notice if you collect from the EU.

## 4. Updating
Build again and replace `dist/` (or redeploy the container). Players on the old version keep playing it; the new version downloads in
the background and takes over at the main menu with a quick reload (never mid-match). Pages and code are always revalidated, so a
deploy shows up on the next visit.

## 5. Troubleshooting
| Symptom | Likely cause |
|---|---|
| Blank page, console says *Refused to load…* | A proxy/CDN is adding its own Content-Security-Policy, or you added a third-party script. Run with `CSP_REPORT_ONLY=1` to see what it blocks. |
| "Disconnected — the multiplayer server is unreachable" | The page cannot reach `/ws`: proxy missing the WebSocket upgrade headers, `SERVER_URL` wrong, or the page's origin is not in `ALLOWED_ORIGINS`. |
| Everyone gets "Too many requests" | Behind a proxy without `TRUST_PROXY=1` — all players look like one address. |
| Old version keeps showing | A CDN is caching `index.html` or `sw.js`: they must be served `Cache-Control: no-cache` (the provided `_headers` does this). |
| Music silent on the first tap | Browsers block audio until the first click/tap; it starts then. |
