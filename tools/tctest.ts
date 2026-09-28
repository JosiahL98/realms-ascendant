/*
 * Town Center loss: plays an AI match, burns one player's Town Center down, and follows whether it raises a new one.
 *   npx tsx tools/tctest.ts [minutes before] [minutes after] [seed] [difficulty]
 */
import { Game } from '../src/sim/game';
import { AIPlayer } from '../src/ai/ai';

const before = Number(process.argv[2] ?? 9);
const after = Number(process.argv[3] ?? 8);
const seed = Number(process.argv[4] ?? 5);
const diff = (process.argv[5] ?? 'standard') as 'standard';
const game = new Game({
  seed, mapType: 'steppe', mapSize: 120,
  players: [0, 1].map((i) => ({ name: `AI${i + 1}`, civ: ['gauls', 'latins'][i], color: i, team: i + 1, human: false, difficulty: diff })),
  resources: 'standard', popLimit: 200, reveal: 'normal', victory: 'standard', startAge: 0,
});
const ais = game.players.filter((p) => !p.isGaia).map((p) => new AIPlayer(game, p.id, diff));
const run = (secs: number, each?: () => void) => {
  for (let i = 0; i < secs * 20; i++) {
    game.step();
    for (const ai of ais) if (!game.players[ai.pid].defeated && (game.tickCount + ai.pid * 3) % 10 === 0) ai.update();
    game.events.length = 0;
    if (i % 200 === 0) each?.();
  }
};
run(before * 60);
const pid = 2, p = game.players[pid];
const tcs = () => game.buildings.filter((b) => b.alive && b.owner === pid && b.type === 'townCenter');
const vills = () => game.units.filter((u) => u.alive && u.owner === pid && u.def.gatherer).length;
for (const tc of tcs()) game.destroyBuilding(tc, 1);
console.log(`${before} min: burned player ${pid}'s Town Center (age ${p.age}, ${vills()} villagers, res ${JSON.stringify(Object.fromEntries(Object.entries(p.res).map(([k, v]) => [k, Math.round(v)])))})`);
let placedAt = -1, builtAt = -1;
run(after * 60, () => {
  const t = tcs();
  if (t.length && placedAt < 0) placedAt = game.time;
  if (t.some((b) => b.built) && builtAt < 0) builtAt = game.time;
});
const t0 = before * 60;
console.log(placedAt >= 0 ? `new Town Center placed ${(placedAt - t0).toFixed(0)} s later` : 'no new Town Center placed');
console.log(builtAt >= 0 ? `finished ${(builtAt - t0).toFixed(0)} s later` : 'not finished');
console.log(`${before + after} min: ${vills()} villagers, age ${p.age}, res ${JSON.stringify(Object.fromEntries(Object.entries(p.res).map(([k, v]) => [k, Math.round(v)])))}`);
process.exitCode = builtAt >= 0 ? 0 : 1;
