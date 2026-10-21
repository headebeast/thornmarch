// Headless Battle Royale simulation: N bot warbands to the last survivor.
//   node scripts/sim-royale.mjs [players=20] [seed=SIM] [maxRounds=200] [storm=off|slow|normal|fast]
import { loadDatabase, silentSound } from './lib/nodeContent.mjs';
import { GameEngine } from '../public/js/engine/gameState.js';
import { getMode } from '../public/js/modes/registry.js';
import '../public/js/modes/royale/index.js';
import { RoyaleRound } from '../public/js/modes/royale/round.js';

const players = Number(process.argv[2] || 20);
const seed = process.argv[3] || 'SIM';
const maxRounds = Number(process.argv[4] || 200);
const storm = process.argv[5] || 'off';
const db = loadDatabase();
const t0 = performance.now();
const match = getMode('royale').createMatch({ players, seed, storm, plan: 25, teams: Object.fromEntries(Array.from({ length: players }, (_, i) => [i, 'AI'])) }, db);
const tGen = performance.now() - t0;
const game = new GameEngine(db, silentSound);
const tInit0 = performance.now();
game.initGame(match.mapData, match.playerConfig, { ...match.options, rules: match.rules });
const tInit = performance.now() - tInit0;
const ai = match.createAI(game);
const rr = new RoyaleRound(game, ai);

let slowest = 0;
const tRun = performance.now();
const log = [];
while (game.phase !== 'GAME_OVER' && rr.round < maxRounds) {
  const t1 = performance.now();
  rr.beginRound();
  rr.planBots();
  const tPlan = performance.now() - t1;
  const t2 = performance.now();
  await rr.resolve({});
  const over = rr.endRound();
  const tRes = performance.now() - t2;
  slowest = Math.max(slowest, tPlan + tRes);
  const alive = rr.aliveTeams().length;
  if (rr.round % 5 === 0 || over) log.push(`r${rr.round}: alive ${alive} units ${game.units.length} plan ${tPlan.toFixed(0)}ms resolve ${tRes.toFixed(0)}ms horns ${game.hunt.horn ? 'ON' : '-'}`);
  if (over) break;
}
console.log(log.join('\n'));
const r = game.royale;
console.log(JSON.stringify({
  players, map: `${game.map.width}x${game.map.height}`, genMs: Math.round(tGen), initMs: Math.round(tInit),
  rounds: rr.round, endedBy: game.royale.endedBy || 'last standing', cap: game.hunt.cap, over: game.phase === 'GAME_OVER', winner: game.winnerTeam, winnerName: match.teamNames[game.winnerTeam],
  totalMs: Math.round(performance.now() - tRun), slowestRoundMs: Math.round(slowest),
  eliminated: r.eliminated.length, topKills: Object.entries(r.kills).sort((a, b) => b[1] - a[1]).slice(0, 3),
  hash: rr.stateHash()
}));
