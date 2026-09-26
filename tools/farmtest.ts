import { Game } from '../src/sim/game';
import { issueCommand } from '../src/sim/commands';
const game = new Game({ seed: 5, mapType: 'steppe', mapSize: 120, players: [
  { name: 'A', civ: 'gauls', color: 0, team: 1, human: false, difficulty: 'standard' },
  { name: 'B', civ: 'gauls', color: 1, team: 2, human: false, difficulty: 'standard' }],
  resources: 'high', popLimit: 200, reveal: 'all', victory: 'standard', startAge: 0 });
const p = game.players[1];
const tc = game.buildings.find((b) => b.owner === 1 && b.type === 'townCenter')!;
p.res.wood = 5000;
// place farms touching the TC
const spots: [number, number][] = [[tc.tx - 3, tc.tz], [tc.tx + 4, tc.tz], [tc.tx, tc.tz - 3], [tc.tx, tc.tz + 4], [tc.tx - 3, tc.tz + 3]];
const vills = game.units.filter((u) => u.owner === 1 && u.type === 'villager');
while (vills.length < 5) vills.push(game.spawnUnit('villager', 1, tc.x + 3, tc.z + 3));
game.recomputePop(1);
const mill = game.createBuilding('mill', 1, tc.tx + 6, tc.tz + 6, true);
void mill;
const farms: number[] = [];
for (const [tx, tz] of spots) {
  const r = issueCommand(game, 1, { c: 'build', units: [], building: 'farm', tx, tz });
  console.log('farm', tx, tz, r);
  if (r.ok && r.id) farms.push(r.id);
}
// instantly finish farms
for (const id of farms) game.finishConstructionNow(game.building(id)!);
vills.slice(0, farms.length).forEach((v, i) => issueCommand(game, 1, { c: 'gather', units: [v.id], target: farms[i] }));
let last = p.stats.gathered.food;
for (let m = 1; m <= 5; m++) {
  for (let i = 0; i < 20 * 60; i++) game.step();
  const g = p.stats.gathered.food;
  console.log(`min ${m}: +${Math.round(g - last)} food (${((g - last) / 60 / farms.length).toFixed(3)} per farmer/s)`, vills.slice(0, farms.length).map((v) => `${v.order.t}/${v.anim}/${v.returning ? 'R' : ''}${v.carryAmount.toFixed(0)}`).join(' '));
  last = g;
}
const v0 = vills[0];
console.log('v0', v0.id, v0.order, v0.x.toFixed(1), v0.z.toFixed(1), 'farm0 farmer', game.building(farms[0])?.farmer);
