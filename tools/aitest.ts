/* Headless AI vs AI match: npx tsx tools/aitest.ts [minutes] [players] [seed] [map] [difficulty] */
import { Game } from '../src/sim/game';
import { AIPlayer } from '../src/ai/ai';
import { AGE_NAMES } from '../src/data/types';

const minutes = Number(process.argv[2] ?? 20);
const np = Number(process.argv[3] ?? 2);
const seed = Number(process.argv[4] ?? 777);
const map = (process.argv[5] ?? 'steppe') as 'steppe';
const diff = (process.argv[6] ?? 'standard') as 'standard';
const civs = ['carthaginians', 'gauls', 'parthians', 'han', 'latins', 'hellenes', 'suebi', 'kushites'];
const game = new Game({
  seed, mapType: map, mapSize: np <= 2 ? 120 : np <= 4 ? 168 : 200,
  players: Array.from({ length: np }, (_, i) => ({ name: `AI${i + 1}`, civ: civs[(i + seed) % civs.length], color: i, team: i + 1, human: false, difficulty: diff })),
  resources: 'standard', popLimit: 200, reveal: 'normal', victory: 'standard', startAge: 0,
});
const ais = game.players.filter((p) => !p.isGaia).map((p) => new AIPlayer(game, p.id, diff));
const t0 = performance.now();
const pathStats = new Map<string, number>();
(globalThis as any).__pathStats = pathStats;
let lastReport = 0;
const report = () => {
  const lines = game.players.filter((p) => !p.isGaia).map((p) => {
    const units = game.units.filter((u) => u.alive && u.owner === p.id);
    const vills = units.filter((u) => u.def.gatherer).length;
    const mil = units.filter((u) => !u.def.gatherer && !u.def.animal).length;
    const idle = units.filter((u) => u.def.gatherer && u.order.t === 'idle').length;
    const dist: Record<string, number> = {};
    for (const u of units) if (u.def.gatherer) { const k = (u.order.t === 'gather' ? (u.gatherKind ?? '?') : u.order.t) + '/' + (u.returning ? 'ret' : u.anim); dist[k] = (dist[k] ?? 0) + 1; }
    const blds = game.buildings.filter((b) => b.alive && b.owner === p.id);
    const bt: Record<string, number> = {};
    for (const b of blds) bt[b.type] = (bt[b.type] ?? 0) + 1;
    const r = p.res;
    return `  ${p.name} ${p.civ.name.padEnd(13)} ${AGE_NAMES[p.age].padEnd(12)} pop ${p.pop}/${p.popCap} vill ${vills} (idle ${idle}) mil ${mil} F${Math.floor(r.food)} W${Math.floor(r.wood)} G${Math.floor(r.gold)} S${Math.floor(r.stone)} gF${Math.floor(p.stats.gathered.food)} gW${Math.floor(p.stats.gathered.wood)} kills ${p.stats.unitsKilled} lost ${p.stats.unitsLost} ${p.defeated ? 'DEFEATED' : ''}\n     ${Object.entries(bt).map(([k, v]) => `${k}:${v}`).join(' ')}
     vills: ${Object.entries(dist).map(([k, v]) => `${k}:${v}`).join(' ')}`;
  });
  console.log(`t=${Math.floor(game.time / 60)}m  (${((performance.now() - t0) / 1000).toFixed(1)}s real)\n${lines.join('\n')}`);
};
while (game.time < minutes * 60 && !game.over) {
  game.step();
  for (const ai of ais) if ((game.tickCount + ai.pid * 3) % 10 === 0) ai.update();
  game.events.length = 0;
  if (game.time - lastReport >= 120) {
    lastReport = game.time;
    report();
  }
}
report();
console.log('game over:', game.over, 'winner team', game.winnerTeam, 'paths', game.pathfinder.searches);
console.log([...pathStats].sort((a, b) => b[1] - a[1]).slice(0, 15));
const idleV = game.units.filter((u) => u.alive && u.owner === 1 && u.def.builder && u.order.t === 'idle');
console.log('AI1 idle villagers:', idleV.length, 'garrisoned', idleV.filter((u) => u.garrisonedIn).length);
for (const u of idleV.slice(0, 6)) console.log('  ', u.id, 'last', u.lastGatherKind, 'pos', u.x.toFixed(0), u.z.toFixed(0), 'garr', u.garrisonedIn, 'carry', u.carryType, u.carryAmount.toFixed(0));
const pl = game.players[1];
console.log('AI1 res', pl.res, 'trees alive', game.resources.filter((r) => r.type === 'tree').length, 'gold nodes', game.resources.filter((r) => r.type === 'gold').length, 'stone', game.resources.filter((r) => r.type === 'stone').length);
