import { Game } from '../src/sim/game';
import { AIPlayer } from '../src/ai/ai';
const game = new Game({ seed: 99, mapType: 'mediterranean', mapSize: 120, players: [
  { name: 'A', civ: 'han', color: 0, team: 1, human: false, difficulty: 'standard' },
  { name: 'B', civ: 'latins', color: 1, team: 2, human: false, difficulty: 'standard' }],
  resources: 'standard', popLimit: 200, reveal: 'normal', victory: 'standard', startAge: 0 });
const ais = [new AIPlayer(game, 1, 'standard'), new AIPlayer(game, 2, 'standard')];
while (game.time < 16 * 60) {
  game.step();
  for (const ai of ais) if ((game.tickCount + ai.pid * 3) % 10 === 0) ai.update();
  game.events.length = 0;
}
const m = game.map;
for (const d of game.buildings.filter((b) => b.type === 'dock')) {
  console.log('dock owner', d.owner, 'at', d.tx, d.tz, 'built', d.built);
  // print a small ascii map around the dock: W water free, # blocked water, . land, D dock
  for (let z = d.tz - 4; z < d.tz + 7; z++) {
    let row = '';
    for (let x = d.tx - 4; x < d.tx + 7; x++) {
      const i = m.idx(x, z);
      const own = m.obstacle[i] === d.id;
      row += own ? 'D' : m.tileWater(x, z) ? (m.navalBlocked[i] ? '#' : 'w') : '.';
    }
    console.log('  ', row);
  }
}
const ships = game.units.filter((u) => u.def.fisher);
console.log('fishing ships', ships.length, 'returning', ships.filter((s) => s.returning).length);
for (const u of ships.filter((s) => s.returning).slice(0, 4)) {
  const dock = game.building(u.dropId);
  console.log(u.owner, u.x.toFixed(1), u.z.toFixed(1), 'dropId', u.dropId, dock ? `${dock.tx},${dock.tz}` : '-', 'path', u.path, 'reach', u.navReachable, 'failed', u.navFailed);
}
