import { Game } from '../src/sim/game';
import { AIPlayer } from '../src/ai/ai';
const game = new Game({ seed: 99, mapType: 'mediterranean', mapSize: 120, players: [
  { name: 'A', civ: 'han', color: 0, team: 1, human: false, difficulty: 'standard' },
  { name: 'B', civ: 'latins', color: 1, team: 2, human: false, difficulty: 'standard' }],
  resources: 'standard', popLimit: 200, reveal: 'normal', victory: 'standard', startAge: 0 });
const ais = [new AIPlayer(game, 1, 'standard'), new AIPlayer(game, 2, 'standard')];
while (game.time < 14 * 60) {
  game.step();
  for (const ai of ais) if ((game.tickCount + ai.pid * 3) % 10 === 0) ai.update();
  game.events.length = 0;
}
for (const u of game.units.filter((u) => u.def.fisher && u.owner === 1)) {
  const t = u.order.t === 'gather' ? game.get(u.order.target) : undefined;
  const dock = game.buildings.find((b) => b.owner === 1 && b.type === 'dock');
  console.log(u.id, u.order.t, u.anim, 'ret', u.returning, 'carry', u.carryAmount.toFixed(1), 'pos', u.x.toFixed(1), u.z.toFixed(1),
    'target', t ? `${t.kind}:${(t as any).type} ${t.x.toFixed(1)},${t.z.toFixed(1)} d=${Math.hypot(t.x - u.x, t.z - u.z).toFixed(1)}` : '-',
    'dock', dock ? `${dock.tx},${dock.tz}` : '-', 'path', u.path.length / 2, 'idx', u.pathIdx, 'navFailed', u.navFailed, 'reach', u.navReachable, 'water', game.map.tileWater(Math.floor(u.x), Math.floor(u.z)));
}
