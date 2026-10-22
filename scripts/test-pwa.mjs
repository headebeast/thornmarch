// Tests for the installable-app layer: the update system (snooze, manager, controller), install handling and the real
// generated service worker — all without a browser (scripts/lib/pwaFakes.mjs and swSandbox.mjs stand in for it).
//   node scripts/test-pwa.mjs

import { SnoozeStore, makeLaunchId } from '../public/js/pwa/snooze.js';
import { UpdateManager, PHASE } from '../public/js/pwa/updateManager.js';
import { UpdateController } from '../public/js/pwa/updateController.js';
import { InstallManager } from '../public/js/pwa/installManager.js';
import { SNOOZE_OPTIONS, PWA } from '../public/js/pwa/config.js';
import { SW_MESSAGE } from '../public/js/pwa/protocol.js';
import { describeVersion, parseVersion } from '../public/js/pwa/version.js';
import { composeServiceWorker, swParts } from './lib/serviceWorker.mjs';
import { loadServiceWorker } from './lib/swSandbox.mjs';
import { FakeClock, FakeContainer, FakeWorker, FakeStorage, fakePage, flush } from './lib/pwaFakes.mjs';

let failures = 0;
let checks = 0;
const check = (ok, msg) => {
  checks++;
  if (!ok) failures++;
  console.log(ok ? `  ✓ ${msg}` : `  ✗ FAIL: ${msg}`);
};
const section = t => console.log(`\n== ${t}`);
const MIN = 60 * 1000;

// ---------------------------------------------------------------------------------------------------------------------
section('Versions');
check(parseVersion('2.1.0+29bc1d705f').short === '29bc1d' && describeVersion('2.1.0+29bc1d705f') === 'v2.1.0 · 29bc1d', 'a version string is shown as "v2.1.0 · 29bc1d"');
check(describeVersion('') === 'unknown version' && describeVersion('dev') === 'vdev', 'odd values never throw');

// ---------------------------------------------------------------------------------------------------------------------
section('Snooze ("remind me later")');
{
  const clock = new FakeClock();
  const storage = new FakeStorage();
  const make = launchId => new SnoozeStore({ storage, launchId, now: clock.now });
  const s = make('L1');
  const V = '2.2.0+bbbbbbbbbb';
  check(s.status(V) === null, 'nothing is snoozed at first');
  const st = s.snooze('30m', V);
  check(st && st.until === clock.now() + 30 * MIN && s.remainingMs(V) === 30 * MIN, '"30 minutes" stores a deadline half an hour away');
  clock.advance(29 * MIN);
  check(s.status(V) !== null, 'still snoozed after 29 minutes');
  clock.advance(1 * MIN);
  check(s.status(V) === null && storage.get('aeii_update_snooze') === null, 'over after 30 minutes — and the record is cleared');
  s.snooze('1h', V);
  clock.advance(59 * MIN);
  check(s.status(V) !== null && s.remainingMs(V) === 1 * MIN, '"1 hour" lasts an hour');
  clock.advance(2 * MIN);
  check(s.status(V) === null, '…and ends');
  s.snooze('launch', V);
  check(s.status(V).launch === 'L1' && s.remainingMs(V) === null, '"next launch" has no deadline');
  clock.advance(30 * 24 * 60 * MIN);
  check(s.status(V) !== null, 'a launch-snooze does not expire with time');
  check(make('L1').status(V) !== null, 'it survives a reload (same launch id)');
  check(make('L2').status(V) === null && storage.get('aeii_update_snooze') === null, 'it ends in the next launch (new launch id)');
  s.snooze('30m', V);
  check(s.status('2.3.0+cccccccccc') === null, 'a snooze belongs to one build: a newer build is announced again');
  s.snooze('30m', V);
  clock.t -= 10 * 24 * 60 * MIN;
  check(s.status(V) === null, 'a clock that jumped far backwards cannot hide the update for days');
  let threw = false;
  try {
    s.snooze('forever', V);
  } catch {
    threw = true;
  }
  check(threw, 'an unknown choice is refused');
  const sess = new Map();
  const session = { getItem: k => sess.get(k) ?? null, setItem: (k, v) => sess.set(k, v) };
  const id = makeLaunchId(session);
  check(id && makeLaunchId(session) === id, 'the launch id is stable within a session');
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  check(typeof makeLaunchId(broken) === 'string' && makeLaunchId(null).length > 3, 'with sessionStorage unavailable it still returns an id');
  check(SNOOZE_OPTIONS.map(o => o.id).join() === '30m,1h,launch', 'the choices are 30 minutes, 1 hour and next launch');
}

// ---------------------------------------------------------------------------------------------------------------------
/** A manager wired to fakes. */
function rig({ controller = true, enabled = true } = {}) {
  const clock = new FakeClock();
  const container = new FakeContainer({ controller: controller ? new FakeWorker({ state: 'activated', version: '2.1.0+aaaaaaaaaa' }) : null });
  const page = fakePage();
  const manager = new UpdateManager({ container, doc: page.doc, win: page.win, currentVersion: '2.1.0+aaaaaaaaaa', enabled, reload: page.reload, now: clock.now, timers: clock.timers });
  const newWorker = (o = {}) => new FakeWorker({ version: '2.2.0+bbbbbbbbbb', ...o });
  /** The server has a new build: the next check finds it, and it finishes installing. */
  const deploy = (o = {}) => {
    const w = newWorker(o);
    container.registration.onUpdate = () => w;
    return w;
  };
  return { clock, container, reg: container.registration, page, manager, newWorker, deploy };
}

section('Update manager — start-up');
{
  let r = rig({ enabled: false });
  await r.manager.start();
  check(r.manager.state.phase === PHASE.UNSUPPORTED && r.container.registered.length === 0, 'disabled (unbuilt dev page): no service worker is registered');
  check((await r.manager.check()).result === 'unsupported', '…and checking says so');

  r = rig();
  r.container.failRegister = true;
  await r.manager.start();
  check(r.manager.state.phase === PHASE.UNSUPPORTED && /SecurityError/.test(r.manager.state.error), 'a refused registration is reported, not thrown');

  r = rig();
  await r.manager.start();
  check(r.manager.state.phase === PHASE.IDLE && r.manager.state.offlineReady, 'a normal start is idle and offline-ready');
  check(r.container.registered[0].url === '/sw.js' && r.container.registered[0].options.updateViaCache === 'none' && r.container.registered[0].options.scope === '/', 'registers /sw.js, never reading it from the HTTP cache');

  r = rig();
  const waiting = r.newWorker({ state: 'installed' });
  r.reg.waiting = waiting;
  await r.manager.start();
  await flush();
  check(r.manager.state.phase === PHASE.AVAILABLE && r.manager.state.next === '2.2.0+bbbbbbbbbb', 'a build that arrived while the game was closed is announced, with its version');

  r = rig({ controller: false });
  r.reg.waiting = r.newWorker({ state: 'installed' });
  await r.manager.start();
  await flush();
  check(r.manager.state.phase === PHASE.IDLE, 'a hard-reloaded page (no controller) is not offered an update it cannot switch to');

  r = rig({ controller: false });
  await r.manager.start();
  const first = r.newWorker();
  r.reg.installing = first;
  r.reg.dispatchEvent(new Event('updatefound'));
  first.setState('installed');
  await flush();
  r.container.switchTo(first); // the very first install claims the page
  await flush();
  check(r.manager.state.phase === PHASE.IDLE && r.page.reloads === 0 && r.manager.state.offlineReady, 'the first install claiming the page is not an "update" and does not reload');
}

section('Update manager — finding updates');
{
  let r = rig();
  await r.manager.start();
  const states = [];
  r.manager.on('state', s => states.push(s.phase));
  let w = r.deploy({ note: 'Camps and gold' });
  const p = r.manager.check({ manual: true });
  await flush();
  check(r.manager.state.checking, 'while checking, the state says so');
  w.setState('installed');
  const res = await p;
  check(res.result === 'available' && r.manager.state.phase === PHASE.AVAILABLE && r.manager.state.next === '2.2.0+bbbbbbbbbb' && r.manager.state.note === 'Camps and gold' && !r.manager.state.checking, 'a manual check finds the new build, waits for it to finish downloading, and reads its version and note');
  check(r.page.reloads === 0 && w.received.every(m => m.type !== SW_MESSAGE.SKIP_WAITING), 'finding an update never switches or reloads by itself');
  r.clock.advance(5 * 60 * 60 * 1000);
  check(r.page.reloads === 0 && r.manager.state.phase === PHASE.AVAILABLE, 'five hours later it is still waiting for the player, nothing reloaded');

  r = rig();
  await r.manager.start();
  const mute = r.deploy({ answers: false });
  const p2 = r.manager.check({ manual: true });
  await flush();
  mute.setState('installed');
  await flush();
  r.clock.advance(PWA.infoTimeoutMs + 10);
  const res2 = await p2;
  check(res2.result === 'available' && r.manager.state.next === null, 'a worker that never describes itself is announced without a version number');

  r = rig();
  await r.manager.start();
  const none = await r.manager.check({ manual: true });
  check(none.result === 'current' && r.manager.state.phase === PHASE.IDLE && r.manager.state.checkedAt > 0 && !r.manager.state.checking, 'no new build: "current"');
  r.reg.failUpdate = true;
  const bad = await r.manager.check({ manual: true });
  check(bad.result === 'error' && r.manager.state.phase === PHASE.IDLE && /offline/.test(r.manager.state.error) && !/Failed to fetch/.test(r.manager.state.error), 'offline: "error" with a human message, and the game carries on');
  r.reg.failUpdate = false;

  r = rig();
  await r.manager.start();
  r.clock.advance(PWA.checkEveryMs + 1000);
  await flush();
  check(r.reg.updates === 1, 'the game asks for updates by itself every 15 minutes');
  r.page.show('hidden');
  r.clock.advance(5 * 1000);
  r.page.show('visible');
  await flush();
  check(r.reg.updates === 1, 'coming back to the window within a minute does not ask again');
  r.clock.advance(2 * MIN);
  r.page.show('hidden');
  r.page.show('visible');
  await flush();
  check(r.reg.updates === 2, '…but after a while it does');
  r.clock.advance(2 * MIN);
  r.page.win.dispatchEvent(new Event('online'));
  await flush();
  check(r.reg.updates === 3, 'regaining the network asks too');

  r = rig();
  await r.manager.start();
  const old = r.deploy();
  const pa = r.manager.check({ manual: true });
  await flush();
  old.setState('installed');
  await pa;
  const newer = r.newWorker({ version: '2.3.0+cccccccccc' });
  r.reg.installing = newer;
  r.reg.dispatchEvent(new Event('updatefound'));
  old.setState('redundant');
  newer.setState('installed');
  await flush();
  check(r.manager.state.phase === PHASE.AVAILABLE && r.manager.state.next === '2.3.0+cccccccccc', 'a build that supersedes a waiting one replaces the announcement');
}

{
  // regression (found in a real browser): update() can answer after the install finished, before "installed" is delivered
  const r = rig();
  await r.manager.start();
  r.reg.lateEvents = true;
  r.deploy({ note: 'late' });
  const res = await r.manager.check({ manual: true });
  check(res.result === 'available' && r.manager.state.phase === PHASE.AVAILABLE && r.manager.state.next === '2.2.0+bbbbbbbbbb' && r.manager.state.note === 'late', 'a manual check reports "available" even when the browser finished installing before it delivered the event');
  await flush();
  check(r.manager.state.phase === PHASE.AVAILABLE, '…and the late event changes nothing (no double announcement)');
}

{
  // the game failed to start: look for a fixed build and switch to it (nothing is running, nothing to lose)
  let r = rig();
  const early = r.manager.recover(); // called before registration has even finished
  await flush();
  check((await early) === false && r.page.reloads === 0, 'boot failure, no newer build: nothing happens');

  r = rig();
  const fix = r.newWorker({ state: 'installed' });
  r.reg.waiting = fix;
  const recovered = r.manager.recover();
  await flush();
  check(fix.received.some(m => m.type === SW_MESSAGE.SKIP_WAITING), 'boot failure with a newer build already waiting: it is told to take over, without any question');
  r.container.switchTo(fix);
  check((await recovered) === true && r.page.reloads === 1, '…and the page reloads into the fixed build');

  r = rig();
  await r.manager.start();
  const published = r.deploy();
  const rec = r.manager.recover();
  await flush();
  published.setState('installed');
  await flush();
  check(published.received.some(m => m.type === SW_MESSAGE.SKIP_WAITING), 'boot failure: a fixed build found by looking is switched to as well');
  r.container.switchTo(published);
  check((await rec) === true && r.page.reloads === 1, '…and the page reloads');

  r = rig({ enabled: false });
  check((await r.manager.recover()) === false, 'a dev copy (no service worker) has nothing to recover to');
}

section('Update manager — applying');
{
  let r = rig();
  await r.manager.start();
  let w = r.deploy();
  let p = r.manager.check({ manual: true });
  await flush();
  w.setState('installed');
  await p;
  const applying = r.manager.apply();
  await flush();
  check(r.manager.state.phase === PHASE.APPLYING && w.received.some(m => m.type === SW_MESSAGE.SKIP_WAITING) && r.page.reloads === 0, 'apply asks the waiting worker to take over, and waits');
  r.container.switchTo(w);
  check((await applying) === true && r.page.reloads === 1, 'when the worker has taken over, the page reloads — exactly once');
  r.container.switchTo(w);
  check(r.page.reloads === 1, 'a second controller change does not reload again');

  r = rig();
  await r.manager.start();
  w = r.deploy();
  p = r.manager.check({ manual: true });
  await flush();
  w.setState('installed');
  await p;
  const stuck = r.manager.apply();
  await flush();
  r.clock.advance(PWA.applyTimeoutMs + 10);
  check((await stuck) === false && r.manager.state.phase === PHASE.AVAILABLE && /Close every window/.test(r.manager.state.error) && r.page.reloads === 0, 'a worker that never takes over: no reload, back to "available" with a plain explanation');

  r = rig();
  await r.manager.start();
  check((await r.manager.apply()) === false && r.page.reloads === 0, 'nothing waiting: apply does nothing');

  r = rig();
  await r.manager.start();
  const other = r.newWorker({ state: 'activated' });
  r.container.switchTo(other); // another window applied the update
  await flush();
  check(r.manager.state.phase === PHASE.STALE && r.page.reloads === 0 && r.manager.state.next === '2.2.0+bbbbbbbbbb', 'another window updated: this page is "stale" (not reloaded behind the player\'s back), with the new version');
  check((await r.manager.apply()) === true && r.page.reloads === 1, 'confirming a stale page just reloads it');
}

// ---------------------------------------------------------------------------------------------------------------------
section('Update controller — banner rules');
/** manager + controller + a ready update. */
async function readyController({ launchId = 'L1', storage = new FakeStorage(), clock, confirmWith = true } = {}) {
  const r = rig();
  if (clock) r.clock = clock;
  await r.manager.start();
  const snooze = new SnoozeStore({ storage, launchId, now: r.clock.now });
  const ctl = new UpdateController({ manager: r.manager, snooze, now: r.clock.now, timers: r.clock.timers });
  const asked = [];
  ctl.attach({ confirm: async v => (asked.push(v), confirmWith), context: () => ({ busy: true, kind: 'match', text: 'in a match' }) });
  ctl.start();
  const changes = [];
  ctl.on('change', v => changes.push(v));
  const w = r.deploy();
  const p = r.manager.check({ manual: true });
  await flush();
  w.setState('installed');
  await p;
  return { ...r, ctl, asked, changes, worker: w, storage };
}
{
  let c = await readyController();
  check(c.ctl.view.visible && c.ctl.view.kind === 'update' && c.ctl.view.next === '2.2.0+bbbbbbbbbb' && c.ctl.view.busy.busy, 'an available update is shown, with what the player is doing');
  check(c.changes.at(-1).visible, 'the screen is told through a "change" event');

  const st = c.ctl.snooze('30m');
  check(!c.ctl.view.visible && c.ctl.view.available && st.until, '"remind me in 30 minutes" hides the banner but the update stays available');
  check(c.clock.pending >= 1, 'a wake-up timer is set');
  c.clock.advance(29 * MIN);
  check(!c.ctl.view.visible, 'still hidden after 29 minutes');
  c.clock.advance(1 * MIN + 100);
  check(c.ctl.view.visible && c.changes.at(-1).visible, 'the banner comes back by itself when the time is up');

  c.ctl.snooze('1h');
  c.clock.advance(59 * MIN);
  check(!c.ctl.view.visible, '1 hour: hidden at 59 minutes');
  c.clock.advance(1 * MIN + 100);
  check(c.ctl.view.visible, '1 hour: back at 60 minutes');

  c.ctl.snooze('launch');
  c.clock.advance(7 * 24 * 60 * MIN);
  check(!c.ctl.view.visible, 'next-launch: still hidden days later in the same launch');
  const sameStorage = c.storage;
  const nextLaunch = await readyController({ storage: sameStorage, launchId: 'L2' });
  check(nextLaunch.ctl.view.visible, 'next-launch: shown again in the next launch');

  c.ctl.remindNow();
  check(c.ctl.view.visible, '"remind me now" brings it back');

  c.ctl.snooze('1h');
  const newer = c.newWorker({ version: '2.3.0+cccccccccc' });
  c.reg.installing = newer;
  c.reg.dispatchEvent(new Event('updatefound'));
  newer.setState('installed');
  await flush();
  check(c.ctl.view.visible && c.ctl.view.next === '2.3.0+cccccccccc', 'a snooze never hides a NEWER build');

  const idle = await (async () => {
    const r = rig();
    await r.manager.start();
    const ctl = new UpdateController({ manager: r.manager, snooze: new SnoozeStore({ storage: new FakeStorage(), launchId: 'x', now: r.clock.now }), now: r.clock.now, timers: r.clock.timers });
    return ctl;
  })();
  check(idle.snooze('30m') === null && !idle.view.visible && !idle.view.available, 'nothing to postpone when no update exists');
}

section('Update controller — confirming');
{
  let c = await readyController({ confirmWith: false });
  // (if the controller wrongly went ahead it would wait forever for a switch that never comes: report that as a failure, not a hang)
  const answer = await Promise.race([c.ctl.requestApply(), flush(10).then(() => 'went ahead without being asked')]);
  check(answer === 'cancelled' && c.asked.length === 1 && c.worker.received.every(m => m.type !== SW_MESSAGE.SKIP_WAITING), 'Cancel: nothing is applied');
  check(c.ctl.view.visible && c.ctl.view.phase === PHASE.AVAILABLE && c.page.reloads === 0, '…and the banner is exactly as it was');
  check(c.asked[0].busy.busy && c.asked[0].next, 'the question carries what the player is doing and the new version');

  c = await readyController({ confirmWith: true });
  const go = c.ctl.requestApply();
  await flush();
  check(c.worker.received.some(m => m.type === SW_MESSAGE.SKIP_WAITING) && c.page.reloads === 0, 'Confirm: the new build is told to take over');
  c.container.switchTo(c.worker);
  check((await go) === 'applied' && c.page.reloads === 1, '…and the game reloads once');

  c = await readyController();
  c.ctl.confirm = null;
  check((await c.ctl.requestApply()) === 'cancelled' && c.worker.received.every(m => m.type !== SW_MESSAGE.SKIP_WAITING), 'with no way to ask, it never acts');

  c = await readyController();
  let release;
  c.ctl.confirm = () => new Promise(r => (release = r));
  const first = c.ctl.requestApply();
  check((await c.ctl.requestApply()) === 'busy', 'a second press while the question is open is ignored');
  release(false);
  check((await first) === 'cancelled' && (await (async () => { c.ctl.confirm = async () => false; return c.ctl.requestApply(); })()) === 'cancelled', 'after an answer the button works again');

  c = await readyController();
  c.ctl.confirm = async () => {
    throw new Error('dialog crashed');
  };
  let threw = false;
  try {
    await c.ctl.requestApply();
  } catch {
    threw = true;
  }
  c.ctl.confirm = async () => false;
  check(threw && (await c.ctl.requestApply()) === 'cancelled' && c.worker.received.every(m => m.type !== SW_MESSAGE.SKIP_WAITING), 'a crashing dialog applies nothing and does not lock the button');

  c = await readyController();
  c.ctl.snooze('1h');
  c.ctl.confirm = async () => false;
  check((await c.ctl.requestApply()) === 'cancelled' && !c.ctl.view.visible && c.ctl.view.snoozed, 'cancelling from Settings leaves a snooze untouched');

  const r = rig();
  await r.manager.start();
  const ctl = new UpdateController({ manager: r.manager, snooze: new SnoozeStore({ storage: new FakeStorage(), launchId: 'x', now: r.clock.now }), now: r.clock.now, timers: r.clock.timers });
  check((await ctl.requestApply()) === 'unavailable', 'no update: "unavailable"');

  const s = rig();
  await s.manager.start();
  s.container.switchTo(s.newWorker({ state: 'activated' }));
  await flush();
  const sctl = new UpdateController({ manager: s.manager, snooze: new SnoozeStore({ storage: new FakeStorage(), launchId: 'x', now: s.clock.now }), now: s.clock.now, timers: s.clock.timers });
  sctl.start();
  check(sctl.view.kind === 'reload' && sctl.view.visible, 'updated in another window: the banner asks for a reload');
  sctl.snooze('30m');
  check(!sctl.view.visible, '…and can be snoozed too');
}

// ---------------------------------------------------------------------------------------------------------------------
section('Install manager');
{
  const win = Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false, addEventListener() {} }) });
  const nav = { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120', maxTouchPoints: 0 };
  const im = new InstallManager({ win, nav });
  im.start();
  check(im.mode === 'browser' && !im.state.canPrompt, 'before the browser offers anything: "use the browser menu"');
  let prompted = 0;
  const ev = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: async () => void prompted++, userChoice: Promise.resolve({ outcome: 'accepted' }) });
  win.dispatchEvent(ev);
  check(im.mode === 'prompt' && ev.defaultPrevented, 'the browser offers install: we keep it and hide the browser\'s own bar');
  check((await im.prompt()) === 'accepted' && prompted === 1 && im.mode !== 'prompt', 'pressing Install shows the dialog once');
  check((await im.prompt()) === 'unavailable', '…and a second press has nothing to show');
  win.dispatchEvent(new Event('appinstalled'));
  check(im.mode === 'installed', 'installed during this visit');
  const standalone = new InstallManager({ win: Object.assign(new EventTarget(), { matchMedia: q => ({ matches: q === '(display-mode: standalone)', addEventListener() {} }) }), nav });
  check(standalone.mode === 'installed', 'running in its own window counts as installed');
  const iphone = new InstallManager({ win, nav: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari', maxTouchPoints: 5 } });
  const ipad = new InstallManager({ win, nav: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari', maxTouchPoints: 5 } });
  const mac = new InstallManager({ win, nav: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari', maxTouchPoints: 0 } });
  check(iphone.mode === 'ios' && ipad.mode === 'ios' && mac.mode === 'browser', 'iPhone and iPad get the Share → Add to Home Screen hint; a Mac does not');
  const refusing = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: async () => { throw new Error('no'); }, userChoice: Promise.resolve({}) });
  const im2 = new InstallManager({ win: new EventTarget(), nav });
  im2.start();
  im2.win.dispatchEvent(refusing);
  check((await im2.prompt()) === 'dismissed', 'a prompt that throws is reported as dismissed, not crashed');
}

// ---------------------------------------------------------------------------------------------------------------------
section('Service worker (the real generated code)');
const BODY = {
  '/': '<html>start</html>',
  '/index.html': '<html>start</html>',
  '/js/main.js': 'console.log("game")',
  '/css/base.css': 'body{}',
  '/privacy.html': '<html>privacy</html>',
  '/extra.json': '{"x":1}'
};
const PRECACHE = ['/', '/index.html', '/js/main.js', '/css/base.css', '/privacy.html'];
const AUDIO = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
const network = req => {
  const path = new URL(req.url).pathname;
  if (path === '/assets/audio/music/theme.mp3') return new Response(AUDIO, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
  if (path in BODY) return new Response(BODY[path], { status: 200, headers: { 'Content-Type': 'text/plain' } });
  return new Response('nope', { status: 404 });
};
const compose = (o = {}) => composeServiceWorker({ version: 'aeii-testbuild00', build: '2.2.0+testbuild00', media: 'aeii-media-aaaaaaaa', precache: PRECACHE, note: 'Hello', ...o });
const text = async res => Buffer.from(await res.arrayBuffer()).toString('utf8');
{
  const source = await compose();
  check(/__AEII_[A-Z]+__/.test(source) === false && swParts().length === 5, `the worker is built from ${swParts().length} parts with every placeholder filled`);
  let bad = false;
  try {
    await composeServiceWorker({ version: 'oops', build: 'x', media: 'aeii-media-a', precache: [] });
  } catch {
    bad = true;
  }
  check(bad, 'a cache name without the "aeii-" prefix is refused at build time (it could never be cleaned up)');

  const sw = loadServiceWorker(source, { fetchImpl: network });
  const L = sw.listeners;
  check(['install', 'activate', 'message', 'fetch'].every(t => L.has(t)), 'it listens for install, activate, message and fetch');

  // install
  await sw.dispatch('install');
  const snap = sw.stores.get('aeii-testbuild00');
  check(snap && [...snap.entries.keys()].map(h => new URL(h).pathname).sort().join() === [...PRECACHE].sort().join(), 'install downloads exactly the listed files into this build\'s cache');
  check(sw.calls.skipWaiting === 0, 'install does NOT take over: a new build waits for the player');

  const failing = loadServiceWorker(source, { fetchImpl: req => (req.url.endsWith('main.js') ? new Response('', { status: 404 }) : network(req)) });
  let installFailed = false;
  try {
    await failing.dispatch('install');
  } catch {
    installFailed = true;
  }
  check(installFailed, 'one missing file fails the whole install (an incomplete build never goes live)');

  // activate
  await sw.caches.open('aeii-oldbuild000');
  await sw.caches.open('aeii-media-bbbbbbbb');
  await sw.caches.open('aeii-media-aaaaaaaa');
  await sw.caches.open('somebody-elses-cache');
  await sw.dispatch('activate');
  const names = await sw.caches.keys();
  check(!names.includes('aeii-oldbuild000') && !names.includes('aeii-media-bbbbbbbb') && names.includes('aeii-testbuild00') && names.includes('aeii-media-aaaaaaaa') && names.includes('somebody-elses-cache'), 'activate removes older builds and old music, keeps the current ones and anybody else\'s caches');
  check(sw.calls.claim === 1, '…and takes control of open pages');

  // messages
  await sw.dispatch('message', { data: { type: SW_MESSAGE.SKIP_WAITING } });
  check(sw.calls.skipWaiting === 1, '"skip waiting" (new message) takes over');
  await sw.dispatch('message', { data: 'skipWaiting' });
  check(sw.calls.skipWaiting === 2, '"skipWaiting" (old releases\' message) still works, so already-open pages can update');
  await sw.dispatch('message', { data: { type: 'something-else' } });
  check(sw.calls.skipWaiting === 2, 'unknown messages are ignored');
  const ch = new MessageChannel();
  const info = new Promise(r => (ch.port1.onmessage = e => r(e.data)));
  await sw.dispatch('message', { data: { type: SW_MESSAGE.GET_INFO }, ports: [ch.port2] });
  const got = await info;
  ch.port1.close();
  check(got.version === '2.2.0+testbuild00' && got.note === 'Hello' && got.cache === 'aeii-testbuild00', '"which build are you?" is answered with version, release note and cache');
  const replies = [];
  await sw.dispatch('message', { data: { type: SW_MESSAGE.GET_INFO }, ports: [], source: { postMessage: m => replies.push(m) } });
  check(replies[0]?.version === '2.2.0+testbuild00', '…also to a sender without a channel');

  // fetch: pages and files
  const ask = async (path, o) => sw.dispatch('fetch', { request: sw.fakeRequest(path, o) });
  sw.calls.fetches.length = 0;
  let ev = await ask('/js/main.js');
  check((await text(await ev.response)) === 'console.log("game")' && sw.calls.fetches.length === 0, 'a game file is answered from the cache, without the network');
  ev = await ask('/?source=pwa', { mode: 'navigate' });
  check((await text(await ev.response)) === '<html>start</html>' && sw.calls.fetches.length === 0, 'the installed app\'s start address (/?source=pwa) opens from the cache');
  ev = await ask('/extra.json');
  check((await text(await ev.response)) === '{"x":1}' && sw.calls.fetches.length === 1, 'a file outside the snapshot comes from the network…');
  sw.calls.fetches.length = 0;
  ev = await ask('/extra.json');
  check((await text(await ev.response)) === '{"x":1}' && sw.calls.fetches.length === 0, '…and is kept for next time');
  ev = await ask('/missing.png');
  check((await ev.response).status === 404, 'a missing file stays a 404 (and is not cached)');
  sw.net.online = false;
  ev = await ask('/some/other/page', { mode: 'navigate' });
  check((await text(await ev.response)) === '<html>start</html>', 'offline, any page address opens the game');
  ev = await ask('/js/main.js');
  check((await text(await ev.response)) === 'console.log("game")', 'offline, the game files still load');
  let offlineRejected = false;
  try {
    ev = await ask('/not/cached.json');
    await ev.response;
  } catch {
    offlineRejected = true;
  }
  check(offlineRejected, 'offline, an uncached non-page request fails normally (nothing invented)');
  sw.net.online = true;

  // fetch: what it must leave alone
  for (const [label, path, opts] of [
    ['the multiplayer socket', '/ws', {}],
    ['the statistics API', '/api/collect', {}],
    ['the dashboard', '/admin/', {}],
    ['the health probe', '/healthz', {}],
    ['a POST', '/js/main.js', { method: 'POST' }],
    ['a partial-content request for a normal file', '/js/main.js', { headers: { Range: 'bytes=0-9' } }]
  ]) {
    ev = await ask(path, opts);
    check(!('response' in ev), `it never touches ${label}`);
  }
  ev = await sw.dispatch('fetch', { request: { url: 'https://other.example/x.js', method: 'GET', mode: 'cors', headers: new Headers() } });
  check(!('response' in ev), 'it never touches other websites');

  // music
  sw.calls.fetches.length = 0;
  ev = await ask('/assets/audio/music/theme.mp3', { headers: { Range: 'bytes=0-99' } });
  const first = await ev.response;
  check(first.status === 200 && sw.calls.fetches.length >= 2, 'the first play streams from the network and a complete copy is saved in the background');
  check((await sw.stores.get('aeii-media-aaaaaaaa').match('/assets/audio/music/theme.mp3')) !== undefined, 'the music is now in the music cache (not in the game snapshot)');
  sw.net.online = false;
  ev = await ask('/assets/audio/music/theme.mp3', { headers: { Range: 'bytes=100-199' } });
  const part = await ev.response;
  const bytes = Buffer.from(await part.arrayBuffer());
  check(part.status === 206 && part.headers.get('Content-Range') === 'bytes 100-199/1000' && bytes.equals(AUDIO.subarray(100, 200)), 'offline, seeking works: the exact requested bytes with a correct Content-Range');
  ev = await ask('/assets/audio/music/theme.mp3', { headers: { Range: 'bytes=900-' } });
  check(Buffer.from(await (await ev.response).arrayBuffer()).equals(AUDIO.subarray(900)), 'an open-ended range returns the rest of the file');
  ev = await ask('/assets/audio/music/theme.mp3', { headers: { Range: 'bytes=-50' } });
  check(Buffer.from(await (await ev.response).arrayBuffer()).equals(AUDIO.subarray(950)), 'a suffix range returns the last bytes');
  ev = await ask('/assets/audio/music/theme.mp3', { headers: { Range: 'bytes=5000-6000' } });
  check((await ev.response).status === 416, 'a range beyond the end is refused (416)');
  ev = await ask('/assets/audio/music/theme.mp3', { headers: { Range: 'bytes=0-9,20-29' } });
  const multi = await ev.response;
  check(multi.status === 200 && (await multi.arrayBuffer()).byteLength === 1000, 'several ranges at once: the whole file is returned (allowed by the standard)');
  ev = await ask('/assets/audio/music/theme.mp3');
  check((await ev.response).status === 200, 'a plain request for saved music is a normal 200');
  sw.net.online = true;
}

section('Service worker — the page and the worker agree');
{
  const source = await compose();
  check(source.includes(JSON.stringify(SW_MESSAGE)), 'the worker carries exactly the message names the page uses (one shared source)');
  const parts = swParts();
  check(parts.map(p => p.name).join() === '00-config.js,01-lifecycle.js,02-range.js,03-routes.js,04-fetch.js', 'the parts load in a fixed order');
  const other = await compose({ note: '' });
  check(source !== other, 'a different release note makes a different worker');
}

console.log(failures ? `\n${failures} of ${checks} check(s) FAILED` : `\nPWA OK — all ${checks} checks passed ✓`);
process.exit(failures ? 1 : 0);
