/* Scenario tests for individual game mechanics: npx tsx tools/mechtest.ts */
import { Game, type GameSetup } from '../src/sim/game';
import { issueCommand } from '../src/sim/commands';
import { completeTech } from '../src/sim/buildingAI';
import type { Unit } from '../src/sim/entities';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};

function fresh(map: GameSetup['mapType'] = 'steppe', seed = 321): Game {
  const g = new Game({
    seed, mapType: map, mapSize: 120,
    players: [
      { name: 'A', civ: 'hellenes', color: 0, team: 1, human: true, difficulty: 'standard' },
      { name: 'B', civ: 'gauls', color: 1, team: 2, human: true, difficulty: 'standard' },
    ],
    resources: 'high', popLimit: 200, reveal: 'all', victory: 'standard', startAge: 0,
  });
  // clear the middle of the map for scenarios
  const c = g.map.n / 2;
  for (const r of [...g.resources]) if (Math.abs(r.x - c) < 18 && Math.abs(r.z - c) < 18) g.removeResource(r);
  for (const u of [...g.units]) if (Math.abs(u.x - c) < 18 && Math.abs(u.z - c) < 18) g.killUnit(u, 0);
  g.map.refreshAll();
  g.events.length = 0;
  for (const p of g.players) if (!p.isGaia) {
    p.res = { food: 20000, wood: 20000, gold: 20000, stone: 20000 };
  }
  return g;
}
const run = (g: Game, secs: number, until?: () => boolean) => {
  for (let i = 0; i < secs * 20; i++) {
    g.step();
    g.events.length = 0;
    if (until && until()) return true;
  }
  return false;
};
const ageTo = (g: Game, pid: number, age: number) => {
  const techs = ['feudalAge', 'castleAge', 'imperialAge'];
  for (let a = g.players[pid].age; a < age; a++) completeTech(g, g.players[pid], techs[a]);
};

/* ---------------------------------------------------------------- conversion */
{
  const g = fresh();
  ageTo(g, 1, 2);
  const monk = g.spawnUnit('monk', 1, 55, 60);
  const target = g.spawnUnit('manAtArms', 2, 62, 60);
  target.stance = 'passive';
  g.recomputePop(1); g.recomputePop(2);
  issueCommand(g, 1, { c: 'convert', units: [monk.id], target: target.id });
  const ok = run(g, 30, () => target.owner === 1);
  check('priest converts an enemy soldier', ok, `owner=${target.owner} faith=${monk.faith.toFixed(0)}`);
}

/* ---------------------------------------------------------------- relic */
{
  const g = fresh();
  ageTo(g, 1, 2);
  const mon = g.createBuilding('monastery', 1, 52, 52, true);
  const relic = g.addResource('relic', 'gold', 0, 58, 60, false);
  const monk = g.spawnUnit('monk', 1, 55, 58);
  g.recomputePop(1);
  issueCommand(g, 1, { c: 'relic', units: [monk.id], target: relic.id });
  run(g, 20, () => monk.relicId !== 0);
  check('priest picks up relic', monk.relicId === relic.id);
  issueCommand(g, 1, { c: 'garrison', units: [monk.id], target: mon.id });
  run(g, 20, () => mon.relics.length > 0);
  check('relic stored in temple', mon.relics.length === 1);
  const gold0 = g.players[1].res.gold;
  run(g, 20);
  check('relic generates gold', g.players[1].res.gold - gold0 > 8, `+${(g.players[1].res.gold - gold0).toFixed(1)} in 20s`);
}

/* ---------------------------------------------------------------- trade */
{
  const g = fresh();
  ageTo(g, 1, 1);
  const m1 = g.createBuilding('market', 1, 40, 58, true);
  const m2 = g.createBuilding('market', 1, 76, 58, true);
  const cart = g.spawnUnit('tradeCart', 1, 45, 60);
  g.recomputePop(1);
  const gold0 = g.players[1].res.gold;
  issueCommand(g, 1, { c: 'trade', units: [cart.id], target: m2.id });
  run(g, 120);
  check('trade cart earns gold', g.players[1].res.gold > gold0, `+${(g.players[1].res.gold - gold0).toFixed(0)} gold in 120s (home ${m1.id})`);
}

/* ---------------------------------------------------------------- walls & gates */
{
  const g = fresh();
  ageTo(g, 1, 1);
  // a wall line across z = 60 from x=40..80 with a gate in the middle
  for (let x = 40; x <= 80; x++) if (x < 58 || x > 60) g.createBuilding('stoneWall', 1, x, 60, true);
  g.createBuilding('gate', 1, 58, 60, true, true);
  const enemy = g.spawnUnit('militia', 2, 60, 66);
  const mine = g.spawnUnit('militia', 1, 60.5, 66);
  g.recomputePop(1); g.recomputePop(2);
  issueCommand(g, 2, { c: 'move', units: [enemy.id], x: 60, z: 54 });
  issueCommand(g, 1, { c: 'move', units: [mine.id], x: 60.5, z: 54 });
  run(g, 25);
  check('gate lets own unit through', mine.z < 60, `own z=${mine.z.toFixed(1)}`);
  check('wall and gate stop enemies', enemy.z > 60, `enemy z=${enemy.z.toFixed(1)}`);
}

/* ---------------------------------------------------------------- trebuchet */
{
  const g = fresh();
  ageTo(g, 1, 3);
  const tower = g.createBuilding('watchTower', 2, 70, 60, true);
  const treb = g.spawnUnit('trebuchet', 1, 55, 60.5);
  g.recomputePop(1);
  issueCommand(g, 1, { c: 'attack', units: [treb.id], target: tower.id });
  const hp0 = tower.hp;
  run(g, 40);
  check('trebuchet unpacks and damages a tower', !treb.packed && (tower.hp < hp0 || !tower.alive), `hp ${hp0}→${tower.alive ? tower.hp.toFixed(0) : 'destroyed'}`);
}

/* ---------------------------------------------------------------- town center arrows + town bell */
{
  const g = fresh();
  const tc = g.buildings.find((b) => b.owner === 1 && b.type === 'townCenter')!;
  const vills = g.units.filter((u) => u.owner === 1 && u.type === 'villager');
  issueCommand(g, 1, { c: 'townBell', on: true });
  run(g, 20);
  check('town bell garrisons villagers', tc.garrison.length === vills.length, `${tc.garrison.length}/${vills.length}`);
  const raider = g.spawnUnit('scout', 2, tc.x + 5, tc.z);
  raider.stance = 'passive';
  g.recomputePop(2);
  const hp0 = raider.hp;
  run(g, 6);
  check('town center shoots arrows at enemies', raider.hp < hp0 || !raider.alive, `hp ${hp0}→${raider.alive ? raider.hp.toFixed(0) : 'dead'}`);
  issueCommand(g, 1, { c: 'townBell', on: false });
  run(g, 2);
  check('all clear releases villagers', tc.garrison.length === 0);
}

/* ---------------------------------------------------------------- market */
{
  const g = fresh();
  ageTo(g, 1, 1);
  g.createBuilding('market', 1, 50, 50, true);
  const p = g.players[1];
  const gold0 = p.res.gold, price0 = g.market.wood;
  issueCommand(g, 1, { c: 'market', action: 'sell', res: 'wood' });
  check('selling wood gives gold and lowers price', p.res.gold > gold0 && g.market.wood < price0, `gold +${p.res.gold - gold0}, price ${price0}→${g.market.wood}`);
}

/* ---------------------------------------------------------------- tech effects */
{
  const g = fresh();
  const v = g.units.find((u) => u.owner === 1 && u.type === 'villager')!;
  const hp0 = v.stats.hp;
  completeTech(g, g.players[1], 'loom');
  check('Loom raises villager HP', v.stats.hp === hp0 + 15 && v.stats.pierceArmor === 2, `hp ${hp0}→${v.stats.hp}`);
  ageTo(g, 1, 1);
  const m = g.spawnUnit('militia', 1, 50, 50);
  completeTech(g, g.players[1], 'manAtArmsUp');
  check('Man-at-Arms upgrade converts existing militia', m.type === 'manAtArms');
}

/* ---------------------------------------------------------------- age up via TC */
{
  const g = fresh();
  const tc = g.buildings.find((b) => b.owner === 1 && b.type === 'townCenter')!;
  let r = issueCommand(g, 1, { c: 'research', building: tc.id, tech: 'feudalAge' });
  check('Feudal Age requires two Dark Age buildings', !r.ok, r.err);
  g.createBuilding('barracks', 1, tc.tx + 8, tc.tz, true);
  g.createBuilding('mill', 1, tc.tx - 5, tc.tz, true);
  r = issueCommand(g, 1, { c: 'research', building: tc.id, tech: 'feudalAge' });
  check('Feudal Age research starts with requirements met', r.ok, r.err);
  run(g, 135);
  check('player reaches the Feudal Age', g.players[1].age === 1);
}

/* ---------------------------------------------------------------- wonder */
{
  const g = fresh();
  ageTo(g, 1, 3);
  const w = g.createBuilding('wonder', 1, 50, 50, false);
  g.finishConstructionNow(w);
  const won = run(g, 620, () => g.over);
  check('defended wonder wins the game', won && g.winnerTeam === g.teamOf[1]);
}

/* ---------------------------------------------------------------- transport ship */
{
  const g = fresh('mediterranean', 99);
  ageTo(g, 1, 1);
  // find a coastal water tile and a land tile across the sea
  const m = g.map;
  // the main sea is the largest body of water; use opposite coasts of it
  const sizes = new Map<number, number>();
  for (let i = 0; i < m.n * m.n; i++) if (m.waterBody[i]) sizes.set(m.waterBody[i], (sizes.get(m.waterBody[i]) ?? 0) + 1);
  const sea = [...sizes].sort((a, b) => b[1] - a[1])[0][0];
  let shore: { x: number; z: number } | null = null, far: { x: number; z: number } | null = null;
  for (let z = 5; z < m.n - 5 && !shore; z++) for (let x = 5; x < m.n - 5; x++) {
    if (m.waterBody[m.idx(x, z)] === sea && !m.tileWater(x - 1, z) && !m.landBlocked[m.idx(x - 1, z)] && !m.navalBlocked[m.idx(x, z)]) { shore = { x: x + 0.5, z: z + 0.5 }; break; }
  }
  for (let z = m.n - 6; z > 5 && !far; z--) for (let x = m.n - 6; x > 5; x--) {
    if (m.waterBody[m.idx(x, z)] === sea && !m.tileWater(x + 1, z) && !m.landBlocked[m.idx(x + 1, z)] && !m.navalBlocked[m.idx(x, z)]) { far = { x: x + 1.5, z: z + 0.5 }; break; }
  }
  if (shore && far) {
    const ship = g.spawnUnit('transportShip', 1, shore.x, shore.z);
    const troops: Unit[] = [];
    for (let i = 0; i < 3; i++) troops.push(g.spawnUnit('spearman', 1, shore.x - 1.5, shore.z + (i - 1) * 0.5));
    g.recomputePop(1);
    issueCommand(g, 1, { c: 'garrison', units: troops.map((t) => t.id), target: ship.id });
    run(g, 20, () => ship.cargo.length === 3);
    check('troops board the transport', ship.cargo.length === 3, `${ship.cargo.length}/3`);
    issueCommand(g, 1, { c: 'unloadAt', units: [ship.id], x: far.x, z: far.z });
    run(g, 150, () => ship.cargo.length === 0);
    const landed = troops.filter((t) => !t.garrisonedIn && Math.hypot(t.x - far!.x, t.z - far!.z) < 8).length;
    check('transport unloads troops across the sea', ship.cargo.length === 0 && landed >= 2, `landed near target: ${landed}`);
  } else check('transport scenario setup', false, 'no shore found');
}

/* ---------------------------------------------------------------- naval combat */
{
  const g = fresh('mediterranean', 99);
  ageTo(g, 1, 2); ageTo(g, 2, 2);
  const c = g.map.n / 2;
  const fire = [g.spawnUnit('fireShip', 1, c - 3, c), g.spawnUnit('fireShip', 1, c - 3, c + 1.5)];
  const galley = g.spawnUnit('galley', 2, c + 4, c);
  g.recomputePop(1); g.recomputePop(2);
  issueCommand(g, 1, { c: 'attack', units: fire.map((f) => f.id), target: galley.id });
  run(g, 40, () => !galley.alive);
  check('fire ships sink a galley', !galley.alive);
}

/* ---------------------------------------------------------------- relic victory */
{
  const g = fresh();
  ageTo(g, 1, 2);
  const mon = g.createBuilding('monastery', 1, 50, 50, true);
  for (const r of g.resources) if (r.alive && r.type === 'relic') {
    r.heldBy = mon.id;
    mon.relics.push(r.id);
  }
  const won = run(g, 620, () => g.over);
  check('holding every relic for 600s wins', won && g.winnerTeam === g.teamOf[1], `relics ${mon.relics.length}`);
}

/* ---------------------------------------------------------------- starting age */
{
  const g = new Game({
    seed: 5, mapType: 'steppe', mapSize: 120,
    players: [
      { name: 'A', civ: 'latins', color: 0, team: 1, human: true, difficulty: 'standard' },
      { name: 'B', civ: 'suebi', color: 1, team: 2, human: false, difficulty: 'standard' },
    ],
    resources: 'standard', popLimit: 200, reveal: 'normal', victory: 'standard', startAge: 2,
  });
  const vills = g.units.filter((u) => u.owner === 1 && u.type === 'villager').length;
  check('Castle Age start', g.players[1].age === 2 && g.players[2].age === 2 && vills === 9, `age ${g.players[1].age}, villagers ${vills}`);
}

console.log(failures ? `\n${failures} FAILED` : '\nall mechanics passed');
process.exit(failures ? 1 : 0);
