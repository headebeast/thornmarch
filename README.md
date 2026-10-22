# Thornmarch Tactics — web / cross-platform core

Thornmarch is a web edition of the open-source *Ancient Empires Reloaded*: classic turn-based tactics, rebuilt as one codebase that runs in a browser, installs as a PWA, and can be wrapped
for desktop (Steam), Android and iOS. Includes **Frontier** (a huge fog-shrouded realm to farm, scout and conquer) and
**Battle Royale** (20–60 warbands, simultaneous turns, pure last-one-standing — no gas, no shrinking zone).

```
npm start          # http://localhost:3080  (or run ../play-browser-edition.bat)
npm test           # headless engine / AI / rules suite (no browser needed)
npm run verify     # everything before a release: tests, server hardening tests, build, release checks
npm run build      # → dist/  (upload this; see DEPLOY.md)
```

**Publishing:** read [`DEPLOY.md`](DEPLOY.md) — hosting recipes (one Node server, static site + game server, static only), the
pre-launch checklist (rename the game, publish the source, SITE_URL) and operations notes.

Requires Node 18+. No runtime dependencies.

---

## Architecture — a portable core and thin shells

```
public/js/
  ── PORTABLE CORE (no DOM, no window, no Math.random — runs in Node, workers, any shell) ──
  engine/     gameState.js · combat.js · pathfinding.js · rng.js · ruleSet.js
  rules/      reusable rule modules (fogOfWar.js)
  modes/      registry.js · classic.js (Skirmish, Campaign) · frontier/ (content, generator, modules)
  ai/         aiController.js (classic) · frontierAI.js
  art/        procedural pixel-art: spriteBuilder, palettes, themes, units, buildings, tileComposer
  data/       contentDatabase.js (tiles/units/abilities/maps + content packs)

  ── SHELL (browser specifics, swappable) ──
  config/     brand.js (the game's name — rename here) · deploy.js (server URL, online on/off, source link, from <meta> tags)
  platform/   platform.js   fullscreen, storage, haptics, wake-lock, `window.aeiiHost` bridge · perfMonitor.js (FPS)
  pwa/        the installable-app layer, no DOM except where noted: protocol.js (page ↔ worker words, shared with the build) ·
              config.js (every timing and snooze choice) · updateManager.js (talks to the service worker) · snooze.js ·
              updateController.js (banner rules, reminder timer, "ask first") · installManager.js · pwa.js (wiring)
  renderer/   camera.js · canvasRenderer.js · minimap.js
  input/      pointerController.js   mouse + touch + pen through Pointer Events
  ui/         hud, menus, setup, shop, codex, lobby (safe DOM, no innerHTML) · updateBanner.js · updateConfirm.js · installControl.js · pwaSettings.js
  network/    multiplayerClient.js
  data/       assetLoader.js   (ContentDatabase + images)
  app/App.js  composition root
```

**Why this matters:** every game rule lives in the core, which is exercised headlessly by `npm test`
(AI vs AI games, determinism, scripted rule scenarios). A new platform only needs a new shell.

### Determinism
All randomness goes through `engine/rng.js` (seeded mulberry32) — combat spread, ruin rewards and the Frontier map
generator. The same seed gives the same result on every machine, so online matches only exchange
`{mode, config, seed}` and then relay player actions; the server can later validate by re-simulating.

### Modes are composition
```js
registerMode({ id, name, setup:[…schema…], createMatch(config, db) → { mapData, rules, options, createAI, view } })
```
The menu, the setup screen (`ui/modeSetup.js`, built from the `setup` schema, with live map preview), the HUD widgets
and the AI all come from the registered definition. See `modes/frontier/index.js`.

### Rule modules — how Frontier features move to Skirmish later
Behaviour hooks into the engine through `RuleSet` modules (`engine/ruleSet.js` documents every hook):
`income`, `popCap`, `actions`, `performAction`, `recruitSite`, `truncateMove`, `turnStart`, `checkVictory`, …

| Module | Where | Already reusable in other modes |
|---|---|---|
| Fog of war (+ stealth, ambush) | `rules/fogOfWar.js` | **Yes — Skirmish has a "Fog of war" toggle today** |
| Movement profiles | `rules/movementProfiles.js` | **Yes — Skirmish toggle; Frontier & Royale use it** |
| Economy (income, supply, outposts, forge, academy, ruins) | `modes/frontier/modules/economy.js` | needs the Frontier tile pack |
| Farming, Builder, Renown, unit abilities | `modes/frontier/modules/` | drop-in once the pack is registered |

To move a feature to Skirmish: register the module in `classic.js` (and its content pack, if it has one).

### Content packs
`ContentDatabase.registerPack({ abilities, units, tiles })` appends new content after the base game's and resolves
cross-references by key. Frontier ships **10 units** (Peasant, Outrider, Knight, Pikeman, Crossbowman, Ranger, Druid,
Alchemist, Sapper, Griffin Rider), **7 abilities** and **9 building types** (52 tile variants: per owner, per growth stage).
Art is painted in code (`art/`) with a tiny sprite toolkit — rim lighting + outlines — so a pack is just JS, no binaries.

Terrain **themes** are palette remaps of the original tileset (`art/themes.js`): `frost` (original) and `meadow`.
Shorelines and road junctions are autotiled from `public/data/autotile.json`, which `scripts/analyze-autotile.mjs`
recovered *from the original tile pixels*.

### Movement profiles — every unit moves its own way
`config/movement.js` + `rules/movementProfiles.js`. Each unit has its own **move points** and a **movement class** that prices
every terrain (plains, road, forest, hills/snowdrifts, mountain, water, buildings). Ability skills (Flying, Crawler, Fighter of
the Sea/Forest/Mountain, Pathfinder) still override on top, exactly as in the original game.

| Class | Examples | Character |
|---|---|---|
| Flying | Dragon (8 MP), Ghost, Spirit, Griffin Rider | terrain costs 1 everywhere; flies over ground enemies (but not enemy flyers) |
| Beast | Wolf (7 MP), Wolfarcher | glides through forest/hills/mountains |
| Mounted / Heavy cavalry | Outrider (8 MP), Knight | fast on plains and roads, crippled by forest, mountains, water |
| Woodland | Ranger, Druid | forests and hills cost 1 |
| Light foot | Archer (5 MP), Sorceress, Peasant | hills/snowdrifts cost 1 |
| Armoured | Paladin, Golem, Pikeman, Sapper | forests and hills drag, mountains/water brutal |
| War machine | Catapult | cannot enter mountains or water — needs roads and open ground |
| Aquatic / Amphibious | Aqua & Ice Elemental, Slime | water is cheap |

`node scripts/audit-movement.mjs` prints the full unit × terrain table (`--classic` shows the original uniform costs).
Campaign keeps the original costs; Skirmish has a "Unit movement profiles" toggle (on by default); Frontier and Battle Royale
always use them. The Codex has a **Movement** tab, the inspector shows each unit's class and what the hovered terrain costs it.

### Battle Royale — 20 / 40 / 60 warbands, simultaneous turns
`modes/royale/`. Real-time was rejected (needs an authoritative real-time server, loses tactical depth, poor on touch) and strict
turn order was rejected (60 players waiting for 59). Instead **everyone plans at once under a timer, then all orders resolve together**:

1. **Plan** (15/25/45 s): give each fighter a destination and an action (attack, heal, explore, or — on a building — claim,
   recruit, forge, study). Bots plan instantly.
2. **Resolve**: orders execute through the ordinary engine commands in a seeded *initiative order that rotates every round*;
   you watch what your warband can see.
3. **Round end**: crates, airdrops and ruins power fighters up; income is paid; eliminated warbands are scored.

**Gold, buildings and your warband** (`holdings.js`, `modules/economy.js`). Everyone lands on a **War Camp** with 300 gold, three
fighters and a Gold Mine and a few crates in sight. Every building starts unclaimed; a fighter standing on one can **claim** it (an
order action). Ownership is kept in `game.holds`, not in the tile, so 60 warbands need no extra art — the renderer paints a banner
and a coloured rim over whatever is held, and a bobbing arrow marks every building worth a visit.

| Building | Held, it… |
|---|---|
| **War Camp** (your start, can be seized) | +6 gold/round, trains any fighter, mends 15 HP, sees 5 tiles |
| **Outpost** | +4 gold/round, trains cheap fighters (≤300g) far from home, mends 10 HP |
| **Gold Mine** | +20 gold/round |
| **Forge** | a fighter standing here pays 120g for +8 attack (twice per fighter) |
| **Academy** | a fighter studying here gains 60 XP |
| **Shrine** | restores 40 HP/round to your fighters on or beside it; unclaimed, it mends 15 to the one resting on it |
| **Watchtower** | +15 defence and sight 8 |

Everyone also earns 6 gold a round. A warband holds at most **5 fighters**; each fighter it has already raised makes the next one 25 %
dearer (war weariness), and a freshly planted banner cannot be seized for 3 rounds. When only ~30 % of the warbands remain, the
**war chests are sealed**: no more recruiting and camps stop healing, so what is left on the island is all there will be.
Orders for all of this are plain JSON (`{unitId, move, act:{type:'recruit', item}}`) so they travel through the lockstep referee;
the server whitelists the action types and clamps `item`.

**There is no gas or zone.** The island never shrinks and nothing hurts you for standing still. What ends a Battle Royale is
that the survivors can *find* each other and that fighting pays (`modes/royale/modules/hunt.js`, `march.js`):

- **War horns** — every few rounds a horn sounds and every living warband is *marked on everybody's map* (position only, the fog
  stays). Horns come every 8 rounds, then 5, then 3 as the field thins, and every round once 4 warbands remain (**Final Hunt**).
  Old markers linger as "last known position" for 6 rounds.
- **Spoils** — fallen fighters sometimes drop a crate; a wiped-out warband drops an arsenal that every warband can see.
- **Forced march** — while a warband has no enemy in sight its fighters move 50 % farther (double once the war chests are sealed),
  so crossing a 160-tile island is quick; the moment an enemy is seen movement is back to the normal profile.
- **Time called** — a stand-off safety net (110 / 130 / 150 rounds for 20 / 40 / 60 warbands): the strongest warband (living
  fighters, then HP, then kills) takes the island. Bot-only matches finish by last-one-standing before it.

The classic closing storm is still available as an option (setup → *Closing storm*: slow / normal / fast); it is off by default.
Bots (`ai.js`, `botEconomy.js`, `botNav.js`) claim what is near, recruit the best-value fighter they can afford, forge and study,
follow horn markers, sweep ground they have not explored, and route around lakes and ridges with a cost-to-goal search whose memo is
keyed so that it can never change a result.

The island (96² / 128² / 160²) has spawn rings that place every warband equally far from the action, a seven-kind building mix in
its towns (every kind appears on every island) and loot crates. Rule modules: `economy`, `loot`, `scoreboard`, `hunt`, `march`
(+ fog of war and movement profiles; `storm` only when asked). A 60-warband match simulates to a winner in ~8 s of CPU:
`node scripts/sim-royale.mjs 60`. Typical length with bots: 20 → ~65 rounds, 40 → ~90, 60 → ~95. Add a building: one entry in
`HOLDINGS` (and a tile if it is not a Frontier one).

**Online = deterministic lockstep.** The server (`server/server.mjs`) is only a referee: it times the planning phase, collects every
human's orders, broadcasts the bundle, and waits for all clients to report the same state hash (mismatch → `DESYNC`). Every client
simulates the match, bots included, identically. A player who disconnects is replaced by a bot at the next round boundary.
Caveat: lockstep trusts clients with the full simulation, so a modified client can peek at fogged state — competitive play would need
an authoritative server running the (already Node-ready) engine.

### Settings, diagnostics and statistics
Menu → **Settings** (or the gear in the in-game bar): *Show FPS counter* (frame rate, frame time, slowest recent frame) and *Show connection quality*
(ping, jitter and packet loss; loss = probe replies that never came back, because browsers hide raw TCP loss). Both draw a small read-out under the
top bar (`ui/perfOverlay.js`, `platform/perfMonitor.js`, `network/netStats.js`). The same menu holds the privacy choices. Consent-based anonymous usage
statistics (`analytics/`, `public/js/analytics/`, `netlify/functions/`) feed the password-protected dashboard at `/admin/`; see DEPLOY.md §3c.

### Installable app, offline play and updates
`manifest.webmanifest` (installable, shortcuts to the three modes, store screenshots, a real maskable icon) · a generated
**service worker** (`pwa/sw/*.js`, assembled by `scripts/build.mjs`) that downloads the whole game at install, opens offline, saves
music the first time it plays and **never takes over by itself** · an in-app update system:

> new build found → banner (**Update** / **Later**) → *Update* asks **Cancel / Update and reload** (warns if a match or the editor is open) →
> *Later* offers 30 minutes · 1 hour · next time I open the game → Settings → *App & updates* shows version, check and install.

Every part is its own small file: change a timing in `public/js/pwa/config.js`, the wording in `ui/updateBanner.js` /
`ui/updateConfirm.js`, the cache strategy in `pwa/sw/04-fetch.js`, the look in `css/pwa.css`. `?muted=1` on the address starts the
game silent (tests, recordings). `npm run test:pwa` exercises all of it — including the real generated worker — without a browser.

### Tests & tools
| Command | What it checks |
|---|---|
| `npm test` | engine, AIs, Frontier rules, movement profiles, Battle Royale (20/40/60, horns, spoils, forced march, time called, no idle warbands, claims/recruits/forge/academy/shrine, recruit weariness, sealed chests, lockstep with building orders), determinism |
| `node scripts/test-online-royale.mjs` | the referee protocol against a running server (join, rounds, drop → bot, desync, order sanitising) |
| `npm run test:server` | server hardening: CSP/headers, gzip/brotli/304/ranges, hostile URLs, origin checks, per-address and flood limits, oversized frames, heartbeat (spawns its own server) |
| `npm run test:analytics` | usage statistics: validation, privacy rules (IP masking, no names/chat), aggregation, token auth, erase, retention, abuse limits, file store, real HTTP routes |
| `npm run test:pwa` | update system (snooze, manager, controller), install handling, and the real generated service worker: install/activate/fetch/music ranges/offline, "never takes over by itself" |
| `npm run check` | pre-publish checks: every import resolves and exports what is imported, every asset path exists, JSON/manifest/licence files, build output |
| `npm run build` | `dist/`: branded index.html + manifest, versioned offline service worker, `_headers`, robots/sitemap, size report |
| `node scripts/audit-movement.mjs` | unit × terrain movement table |
| `node scripts/sim-royale.mjs 60 SEED [maxRounds] [storm]` | headless 60-warband match |
| `node scripts/tune-royale.mjs '[{"danger":2}]' 20,40,60 A,B,C` | balance sweep: how many rounds do bot matches take with these pacing knobs |
| `node scripts/preview-royale.mjs <dir> 60` | renders an island to PNG |
| `__aeii.auditInput()` (browser console) | every reachable tile can be hovered/clicked |

### Adding things
- **A unit:** add an entry to `modes/frontier/content.js` (`UNITS`) + a sprite function in `art/frontierUnits.js`.
- **A building:** add to `BUILDINGS` in `content.js` + a drawing in `art/frontierBuildings.js`; effects are data (`income`, `supply`, `renown`, `heal`, `action`).
- **A mode / mod:** one file calling `registerMode`.
- **Preview art:** `npm run preview:art` / `npm run preview:map` write PNGs to `.preview/`.

---

## Shipping to every platform

| Target | How | Status |
|---|---|---|
| Browser | `npm start`, host `public/` behind any static server + `server/server.mjs` for online | ✅ working |
| **PWA** (install from the website, offline, full-screen) | `manifest.webmanifest` + `sw.js` + icons are included; serve over HTTPS | ✅ included |
| **Desktop app / Steam** | Wrap `public/` in **Electron** or **Tauri**; expose `window.aeiiHost` (below); Steam via `steamworks.js` | pattern ready, shell not built |
| **Android / iOS** | **Capacitor** (`npx cap add android ios`) pointing at `public/` | pattern ready, shell not built |
| Dedicated/authoritative server | `import { GameEngine }` in Node — `scripts/lib/nodeContent.mjs` shows how | works today (tests use it) |

Native shells take over capabilities through one optional object — nothing else in the game changes:
```js
window.aeiiHost = {
  name: 'electron',
  fullscreen: { toggle: async () => {…}, isActive: () => … },
  storage:    { get: k => …, set: (k, v) => … },      // files / Steam Cloud
  haptic: ms => …, achievement: id => …, openUrl: url => …, quit: () => …
};
```

### Engine question: Rust + Bevy, Unity, Godot, or this?
For *this* game — 2D tile tactics with thousands of tiles, tens of units, turn-based — the browser engine is already far
faster than needed (a 96×96 realm renders in well under a millisecond per frame, AI turns in ~30 ms).
What decides the choice is **how you want to ship and change it**:

- **Stay on this core (recommended now).** Iteration is instant, the same code runs in the browser, in installs, in
  Electron/Tauri/Capacitor wrappers and on the server, and a headless test suite already covers the rules. It meets "one code
  base, every platform, fast".
- **Godot 4** — the best *future* option if you outgrow the web stack: 2D-first, exports to desktop/mobile/web/Steam,
  small builds, friendly scripting. The portable core translates cleanly because rules are data-driven.
- **Rust + Bevy** — the highest performance ceiling and great for simulation-heavy designs, but mobile/iOS tooling,
  UI tooling and iteration speed are still rough, and it would mean rewriting everything for no visible gain on a turn-based game.
- **Unity** — strongest mobile/console pipeline, but heavy, a licence relationship, and web builds are large; overkill here.

If you later want real-time or thousands of simultaneous units, revisit Godot/Bevy then — the rules/data layer is the part
worth keeping, and it is already separated.

---

## Licence & assets (important for Steam / stores)

- The original **Ancient Empires Reloaded** project (`../project_aeii`) is **GPL-3.0** for code; its assets may be used freely.
  The rules in `engine/` and `ai/` are ported from that code, so **anything you distribute built on this must also be GPL-3.0
  with source available** (selling on Steam is still possible under the GPL).
- **"Ancient Empires" is a trademark/IP of its original publisher.** Before a commercial release, give the game its own name
  and branding. The new Frontier units, buildings, map generator, UI, icons and code in this folder are original work.
- `public/assets/fonts/Jersey15.ttf` (Jersey 15, The Soft Type Project) is licensed under the SIL OFL 1.1 (`OFL-Jersey15.txt`).

### Before going public
- The game ships with `LICENSE.txt` (GPL-3) and `CREDITS.txt`; the About box credits the original project and links to your source
  (`SOURCE_URL` at build time). Publishing a GPL game means publishing its source.
- Rename it in `public/js/config/brand.js` — the one place the name lives.
