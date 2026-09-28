/*
 * Repair: damages buildings in an AI match and follows whether villagers mend them.
 *   npx tsx tools/repairtest.ts [minutes before] [seed]
 */
import { Game } from '../src/sim/game';
import { AIPlayer } from '../src/ai/ai';
import { issueCommand } from '../src/sim/commands';

const before = Number(process.argv[2] ?? 12);
const seed = Number(process.argv[3] ?? 5);
const game = new Game({ seed, mapType: 'steppe', mapSize: 120,
  players: [0, 1].map((i) => ({ name: `P${i + 1}`, civ: ['gauls', 'latins'][i], color: i, team: i + 1, human: i === 0 && !!process.env.HUMAN, difficulty: 'standard' as const })),
  resources: 'standard', popLimit: 200, reveal: 'normal', victory: 'standard', startAge: 0 });
const ais = game.players.filter((p) => !p.isGaia && !p.isHuman).map((p) => new AIPlayer(game, p.id, 'standard'));
const run = (secs: number) => {
  for (let i = 0; i < secs * 20; i++) {
    game.step();
    for (const ai of ais) if ((game.tickCount + ai.pid * 3) % 10 === 0) ai.update();
    game.events.length = 0;
  }
};
run(before * 60);
for (const pid of [1, 2]) {
  const p = game.players[pid];
  const bs = game.buildings.filter((b) => b.alive && b.built && b.owner === pid);
  // the Town Center to 40%, a house and one other building to half
  const pick = [bs.find((b) => b.type === 'townCenter'), bs.find((b) => b.type === 'house'), bs.find((b) => b.type !== 'townCenter' && b.type !== 'house')].filter(Boolean) as typeof bs;
  for (const b of pick) b.hp = b.stats.hp * (b.type === 'townCenter' ? 0.4 : 0.5);
  console.log(`P${pid}${p.isHuman ? ' (human)' : ''} res ${Object.values(p.res).map(Math.round).join('/')}: damaged ${pick.map((b) => b.type + '#' + b.id).join(', ')}`);
  if (process.env.HUMAN && pid === 1) {
    // three villagers stopped by the Town Center (idle villagers look for work, busy ones keep at theirs)
    const v = game.units.filter((u) => u.alive && u.owner === 1 && u.def.builder).slice(0, 3);
    const tc = pick[0];
    console.log('  stopped:', JSON.stringify(issueCommand(game, 1, { c: 'move', units: v.map((u) => u.id), x: tc.x + 3, z: tc.z + 3 })));
  }
  if (process.env.ORDER && pid === 1) {
    const v = game.units.filter((u) => u.alive && u.owner === 1 && u.def.builder).slice(0, 2);
    console.log('  ordered repair:', JSON.stringify(issueCommand(game, 1, { c: 'repair', units: v.map((u) => u.id), target: pick[0].id })));
  }
  (globalThis as unknown as { __picked: Map<number, typeof pick> }).__picked ??= new Map();
  (globalThis as unknown as { __picked: Map<number, typeof pick> }).__picked.set(pid, pick);
}
for (const s of [30, 60, 120]) {
  run(s === 30 ? 30 : s === 60 ? 30 : 60);
  const picked = (globalThis as unknown as { __picked: Map<number, { id: number; type: string; hp: number; stats: { hp: number }; alive: boolean }[]> }).__picked;
  const rows = [...picked].map(([pid, bs]) => `P${pid}: ${bs.map((b) => `${b.type} ${b.alive ? Math.round((b.hp / b.stats.hp) * 100) + '%' : 'gone'}`).join(', ')} (repairing: ${game.units.filter((u) => u.alive && u.owner === pid && u.order.t === 'repair').length})`);
  console.log(`after ${s} s: ${rows.join(' | ')}`);
}
