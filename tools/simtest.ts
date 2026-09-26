/* Headless simulation smoke test: run with `npx tsx tools/simtest.ts` */
import { Game, type GameSetup } from '../src/sim/game';
import { issueCommand } from '../src/sim/commands';

const setup: GameSetup = {
  seed: 12345,
  mapType: 'steppe',
  mapSize: 120,
  players: [
    { name: 'Alice', civ: 'carthaginians', color: 0, team: 1, human: true, difficulty: 'standard' },
    { name: 'Bob', civ: 'gauls', color: 1, team: 2, human: false, difficulty: 'standard' },
  ],
  resources: 'standard',
  popLimit: 200,
  reveal: 'all',
  victory: 'conquest',
  startAge: 0,
};

const t0 = performance.now();
const game = new Game(setup);
console.log(`Map generated in ${(performance.now() - t0).toFixed(0)} ms: ${game.units.length} units, ${game.buildings.length} buildings, ${game.resources.length} resources`);

const p1 = game.players[1];
const tc = game.buildings.find((b) => b.owner === 1 && b.type === 'townCenter')!;
const vills = game.units.filter((u) => u.owner === 1 && u.type === 'villager');
console.log('P1 start', p1.res, 'pop', p1.pop, '/', p1.popCap, 'TC at', tc.tx, tc.tz);

// Villager 0 -> berries, villager 1 -> wood, villager 2 builds a house then wood
const nearest = (type: string) => {
  let best = null as null | (typeof game.resources)[number];
  let bd = Infinity;
  for (const r of game.resources) {
    if (r.type !== type) continue;
    const d = Math.hypot(r.x - tc.x, r.z - tc.z);
    if (d < bd) {
      bd = d;
      best = r;
    }
  }
  return best!;
};
const berries = nearest('berries');
const tree = nearest('tree');
console.log('berries at', berries.tx, berries.tz, 'dist', Math.hypot(berries.x - tc.x, berries.z - tc.z).toFixed(1));
console.log('tree at', tree.tx, tree.tz, 'dist', Math.hypot(tree.x - tc.x, tree.z - tc.z).toFixed(1));
console.log(issueCommand(game, 1, { c: 'gather', units: [vills[0].id], target: berries.id }));
console.log(issueCommand(game, 1, { c: 'gather', units: [vills[1].id], target: tree.id }));
// find a house spot
let placed = false;
for (let r = 5; r < 12 && !placed; r++) {
  for (let a = 0; a < 16 && !placed; a++) {
    const x = Math.round(tc.x + Math.cos(a) * r), z = Math.round(tc.z + Math.sin(a) * r);
    const res = issueCommand(game, 1, { c: 'build', units: [vills[2].id], building: 'house', tx: x, tz: z });
    if (res.ok) {
      placed = true;
      console.log('house placed at', x, z);
    }
  }
}
console.log(issueCommand(game, 1, { c: 'train', building: tc.id, unit: 'villager', count: 3 }));
console.log(issueCommand(game, 1, { c: 'rally', buildings: [tc.id], x: tree.x, z: tree.z, target: tree.id }));

const report = () => {
  const vs = game.units.filter((u) => u.owner === 1 && u.type === 'villager');
  console.log(
    `t=${game.time.toFixed(0)}s res=${JSON.stringify(Object.fromEntries(Object.entries(p1.res).map(([k, v]) => [k, Math.floor(v)])))} pop=${p1.pop}/${p1.popCap} ` +
      vs.map((v) => `${v.id}:${v.order.t}${v.returning ? '(ret)' : ''}/${v.anim}/${v.carryAmount.toFixed(1)}`).join(' '),
  );
};
const tStart = performance.now();
for (let i = 0; i < 20 * 180; i++) {
  game.step();
  if (i % (20 * 20) === 0) report();
}
report();
console.log(`180s simulated in ${(performance.now() - tStart).toFixed(0)} ms; paths=${game.pathfinder.searches} expanded=${game.pathfinder.expanded}`);
const house = game.buildings.find((b) => b.owner === 1 && b.type === 'house');
console.log('house built:', house?.built, 'progress', house?.progress.toFixed(2));

// Combat test: spawn militia for both near the map center
const cx = 60, cz = 60;
const a = [], b = [];
for (let i = 0; i < 6; i++) {
  a.push(game.spawnUnit('manAtArms', 1, cx - 3, cz + i * 0.6));
  b.push(game.spawnUnit('archer', 2, cx + 3, cz + i * 0.6));
}
game.recomputePop(1);
game.recomputePop(2);
issueCommand(game, 1, { c: 'attack', units: a.map((u) => u.id), target: b[0].id });
for (let i = 0; i < 20 * 40; i++) game.step();
console.log('after 40s combat: men-at-arms alive', a.filter((u) => u.alive).length, 'archers alive', b.filter((u) => u.alive).length);
console.log('events sample:', game.events.slice(-5));
console.log('MAA hp:', a.map((u) => u.hp.toFixed(0)).join(','));
// Ranged duel test: 8 archers vs 6 militia starting far apart; archers attack-move
const g2 = new Game({ ...setup, seed: 99 });
const A: ReturnType<typeof g2.spawnUnit>[] = [], M: ReturnType<typeof g2.spawnUnit>[] = [];
for (let i = 0; i < 8; i++) A.push(g2.spawnUnit('archer', 1, 50, 50 + i * 0.5));
for (let i = 0; i < 6; i++) M.push(g2.spawnUnit('militia', 2, 62, 50 + i * 0.6));
g2.recomputePop(1); g2.recomputePop(2);
issueCommand(g2, 2, { c: 'move', units: M.map((u) => u.id), x: 50, z: 52, attackMove: true });
let shots = 0, hits = 0;
for (let i = 0; i < 20 * 60; i++) {
  g2.step();
  for (const e of g2.events) { if (e.e === 'shoot' && e.owner === 1) shots++; if (e.e === 'hit' && e.owner === 1) hits++; }
  g2.events.length = 0;
}
console.log('archers alive', A.filter((u) => u.alive).length, 'militia alive', M.filter((u) => u.alive).length, 'archer shots', shots, 'hits', hits);
