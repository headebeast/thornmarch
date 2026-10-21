// Balance sweep for Battle Royale pacing: plays whole bot-only matches and reports how many rounds each takes.
//   node scripts/tune-royale.mjs '[{}, {"danger":2,"mid":4}]' 20,40,60 A,B,C
//   args: JSON list of overrides (keys of TUNING in modes/royale/ai.js, HORN in modules/hunt.js, MARCH in modules/march.js, ECONOMY in holdings.js),
//         comma-separated field sizes, comma-separated seeds.
// Every config starts from the shipped defaults. A result equal to the round cap means the match was called on time.

import { loadDatabase, silentSound } from './lib/nodeContent.mjs';
import { GameEngine } from '../public/js/engine/gameState.js';
import { getMode } from '../public/js/modes/registry.js';
import '../public/js/modes/royale/index.js';
import { RoyaleRound } from '../public/js/modes/royale/round.js';
import { TUNING } from '../public/js/modes/royale/ai.js';
import { HORN } from '../public/js/modes/royale/modules/hunt.js';
import { MARCH } from '../public/js/modes/royale/modules/march.js';
import { ECONOMY } from '../public/js/modes/royale/holdings.js';

const db = loadDatabase();
const defaults = { tuning: { ...TUNING }, horn: { ...HORN }, march: { ...MARCH }, economy: { ...ECONOMY } };
const target = key => (key in TUNING ? TUNING : key in HORN ? HORN : key in MARCH ? MARCH : ECONOMY);

async function run(players, seed) {
  const m = getMode('royale').createMatch({ players, seed, plan: 25, teams: Object.fromEntries(Array.from({ length: players }, (_, i) => [i, 'AI'])) }, db);
  const g = new GameEngine(db, silentSound);
  g.initGame(m.mapData, m.playerConfig, { ...m.options, rules: m.rules });
  const rr = new RoyaleRound(g, m.createAI(g));
  while (g.phase !== 'GAME_OVER' && rr.round < 300) {
    rr.beginRound();
    rr.planBots();
    await rr.resolve({});
    if (rr.endRound()) break;
  }
  return rr.round;
}

const configs = JSON.parse(process.argv[2] || '[{}]');
const sizes = (process.argv[3] || '20,40,60').split(',').map(Number);
const seeds = (process.argv[4] || 'A,B,C').split(',');

for (const override of configs) {
  Object.assign(TUNING, defaults.tuning);
  Object.assign(HORN, defaults.horn);
  Object.assign(MARCH, defaults.march);
  Object.assign(ECONOMY, defaults.economy);
  for (const [k, v] of Object.entries(override)) target(k)[k] = v;
  const rows = [];
  for (const players of sizes) {
    const rounds = [];
    for (const seed of seeds) rounds.push(await run(players, seed));
    rows.push(`${players}: ${rounds.join('/')} avg ${Math.round(rounds.reduce((a, b) => a + b, 0) / rounds.length)}`);
  }
  console.log(JSON.stringify(override), '→', rows.join('   '));
}
