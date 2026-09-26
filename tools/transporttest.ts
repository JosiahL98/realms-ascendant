import { Game } from '../src/sim/game';
import { issueCommand } from '../src/sim/commands';
import { completeTech } from '../src/sim/buildingAI';
const g = new Game({ seed: 99, mapType: 'mediterranean', mapSize: 120, players: [
  { name: 'A', civ: 'hellenes', color: 0, team: 1, human: true, difficulty: 'standard' },
  { name: 'B', civ: 'gauls', color: 1, team: 2, human: true, difficulty: 'standard' }],
  resources: 'high', popLimit: 200, reveal: 'all', victory: 'standard', startAge: 0 });
completeTech(g, g.players[1], 'feudalAge');
const m = g.map;
let shore: any = null, far: any = null;
for (let z = 5; z < m.n - 5 && !shore; z++) for (let x = 5; x < m.n - 5; x++) {
  if (m.tileWater(x, z) && !m.tileWater(x - 1, z) && !m.landBlocked[m.idx(x - 1, z)] && !m.navalBlocked[m.idx(x, z)]) { shore = { x: x + 0.5, z: z + 0.5 }; break; }
}
for (let z = m.n - 6; z > 5 && !far; z--) for (let x = m.n - 6; x > 5; x--) {
  if (m.tileWater(x, z) && !m.tileWater(x + 1, z) && !m.landBlocked[m.idx(x + 1, z)] && !m.navalBlocked[m.idx(x, z)]) { far = { x: x + 1.5, z: z + 0.5 }; break; }
}
console.log('shore', shore, 'body', m.bodyAt(shore.x, shore.z), 'far', far, 'body near far', m.bodyAt(far.x - 1, far.z));
const ship = g.spawnUnit('transportShip', 1, shore.x, shore.z);
const troops = [0, 1, 2].map((i) => g.spawnUnit('spearman', 1, shore.x - 1.5, shore.z + (i - 1) * 0.5));
g.recomputePop(1);
issueCommand(g, 1, { c: 'garrison', units: troops.map((t) => t.id), target: ship.id });
for (let i = 0; i < 400 && ship.cargo.length < 3; i++) g.step();
console.log('boarded', ship.cargo.length);
console.log(issueCommand(g, 1, { c: 'unloadAt', units: [ship.id], x: far.x, z: far.z }));
for (let s = 0; s < 150; s += 10) {
  for (let i = 0; i < 200; i++) g.step();
  console.log(`t+${s + 10}s ship ${ship.x.toFixed(1)},${ship.z.toFixed(1)} order ${ship.order.t} cargo ${ship.cargo.length} path ${ship.path.length / 2} failed ${ship.navFailed} reach ${ship.navReachable} d=${Math.hypot(far.x - ship.x, far.z - ship.z).toFixed(1)}`);
  if (!ship.cargo.length) break;
}
console.log('troops', troops.map((t) => `${t.x.toFixed(1)},${t.z.toFixed(1)} g${t.garrisonedIn} ${t.order.t}`));
