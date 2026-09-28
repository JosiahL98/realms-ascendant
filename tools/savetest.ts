/*
 * Saved-game round trip: plays an AI match for a while, saves it, restores the save into a second game, then runs the
 * original and the restored copy on side by side and checks they stay identical tick for tick (the simulation is
 * deterministic, so anything the save forgot shows up as a divergence).
 *   npx tsx tools/savetest.ts [minutes before saving] [minutes after] [players] [seed]
 */
import { Game } from '../src/sim/game';
import { AIPlayer } from '../src/ai/ai';
import { restoreGame, snapshotGame } from '../src/sim/save';

const before = Number(process.argv[2] ?? 14);
const after = Number(process.argv[3] ?? 6);
const np = Number(process.argv[4] ?? 3);
const seed = Number(process.argv[5] ?? 4242);
const civs = ['carthaginians', 'gauls', 'parthians', 'han', 'latins', 'hellenes', 'suebi', 'kushites'];
const setup = {
  seed, mapType: 'steppe' as const, mapSize: np <= 2 ? 120 : 168,
  players: Array.from({ length: np }, (_, i) => ({ name: `AI${i + 1}`, civ: civs[(i + seed) % civs.length], color: i, team: i + 1, human: false, difficulty: 'hard' as const })),
  resources: 'standard' as const, popLimit: 200, reveal: 'normal' as const, victory: 'standard' as const, startAge: 0 as const,
};

function run(game: Game, ais: AIPlayer[], ticks: number, each?: (t: number) => void): void {
  for (let i = 0; i < ticks; i++) {
    game.step();
    for (const ai of ais) if (!game.players[ai.pid].defeated && (game.tickCount + ai.pid * 3) % 10 === 0) ai.update();
    game.events.length = 0;
    each?.(i);
  }
}

/** Everything that matters about the game's state, as one string. */
function fingerprint(g: Game): string {
  const r = (x: number) => Math.round(x * 1e4);
  const parts: string[] = [`t${g.tickCount} id${g.nextId} m${Object.values(g.market).join(',')}`];
  for (const p of g.players) parts.push(`P${p.id}:${Object.values(p.res).map(r).join(',')}:a${p.age}:pop${p.pop}/${p.popCap}:${[...p.researched].sort().join('.')}`);
  for (const u of g.units) if (u.alive) parts.push(`U${u.id}:${u.type}:${u.owner}:${r(u.x)},${r(u.z)}:${r(u.hp)}:${u.order.t}:${u.carryType}${r(u.carryAmount)}`);
  for (const b of g.buildings) if (b.alive) parts.push(`B${b.id}:${b.type}:${b.owner}:${r(b.hp)}:${r(b.progress)}:${b.queue.map((q) => q.id).join('.')}`);
  for (const x of g.resources) if (x.alive) parts.push(`R${x.id}:${r(x.amount)}`);
  return parts.join('\n');
}

const t0 = performance.now();
const game = new Game(setup);
const ais = game.players.filter((p) => !p.isGaia).map((p) => new AIPlayer(game, p.id, 'hard'));
run(game, ais, Math.round(before * 60 / 0.05));
const units = game.units.filter((u) => u.alive).length, blds = game.buildings.filter((b) => b.alive).length;
console.log(`played ${before} min: ${units} units, ${blds} buildings, ages ${game.players.filter((p) => !p.isGaia).map((p) => p.age).join('/')} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);

// save, and store as IndexedDB would (a structured clone)
const ts = performance.now();
const snap = snapshotGame(game, ais.map((a) => [a.pid, a.saveState()]), {});
const stored = structuredClone(snap);
const size = JSON.stringify(stored, (_k, v) => (ArrayBuffer.isView(v) ? `<${(v as Uint8Array).byteLength} bytes>` : v instanceof Map ? [...v] : v instanceof Set ? [...v] : v)).length
  + [stored.map.terrain, stored.map.heights, stored.map.obstacle, stored.map.gateOwner, stored.map.farmAt, ...stored.explored.map((e) => e[1])].reduce((a, v) => a + v.byteLength, 0);
console.log(`saved in ${(performance.now() - ts).toFixed(0)} ms, about ${(size / 1024).toFixed(0)} KB`);

const tr = performance.now();
const copy = restoreGame(stored);
const ais2 = copy.players.filter((p) => !p.isGaia).map((p) => {
  const ai = new AIPlayer(copy, p.id, 'hard');
  const s = stored.ai.find(([pid]) => pid === p.id);
  if (s) ai.loadState(s[1]);
  return ai;
});
console.log(`restored in ${(performance.now() - tr).toFixed(0)} ms`);

const f0a = fingerprint(game), f0b = fingerprint(copy);
if (f0a !== f0b) {
  const a = f0a.split('\n'), b = f0b.split('\n');
  const i = a.findIndex((l, k) => l !== b[k]);
  console.log(`!! differs straight after loading, first at:\n   ${a[i]}\n   ${b[i]}`);
  process.exit(1);
}
// run both on, comparing every second of game time
const ticks = Math.round(after * 60 / 0.05);
let bad = -1;
for (let s = 0; s < ticks / 20 && bad < 0; s++) {
  run(game, ais, 20);
  run(copy, ais2, 20);
  const a = fingerprint(game), b = fingerprint(copy);
  if (a !== b) {
    bad = s;
    const la = a.split('\n'), lb = b.split('\n');
    const i = la.findIndex((l, k) => l !== lb[k]);
    console.log(`!! diverged ${s + 1} s after loading, first at:\n   original ${la[i]}\n   restored ${lb[i]}`);
  }
}
if (bad < 0) console.log(`ok: original and restored game identical for ${after} min after loading (${game.units.filter((u) => u.alive).length} units)`);
process.exitCode = bad < 0 ? 0 : 1;
