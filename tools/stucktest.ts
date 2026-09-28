/*
 * Movement check: plays AI matches and records units that keep trying to move but get nowhere, and what is in their
 * way: another unit, a blocked tile (tree, mine, building, water), or nothing obvious.
 *   npx tsx tools/stucktest.ts [minutes] [players] [seed] [map]
 * A unit counts as stuck when it has been walking towards the same place for 3 s of game time and got less than half
 * a tile nearer to it. DETAIL=1 describes units stuck with no obvious blocker; TRACE=<cause> prints the last moments of
 * a few units stuck for that cause (e.g. TRACE="unit(work)"); GATHER=1 prints the resources gathered.
 */
import { Game } from '../src/sim/game';
import { AIPlayer } from '../src/ai/ai';
import type { Unit } from '../src/sim/entities';

const minutes = Number(process.argv[2] ?? 20);
const np = Number(process.argv[3] ?? 4);
const seed = Number(process.argv[4] ?? 31337);
const map = (process.argv[5] ?? 'steppe') as 'steppe';
const civs = ['carthaginians', 'gauls', 'parthians', 'han', 'latins', 'hellenes', 'suebi', 'kushites'];
const game = new Game({
  seed, mapType: map, mapSize: np <= 2 ? 120 : 168,
  players: Array.from({ length: np }, (_, i) => ({ name: `AI${i + 1}`, civ: civs[(i + seed) % civs.length], color: i, team: i + 1, human: false, difficulty: 'hard' as const })),
  resources: 'standard', popLimit: 200, reveal: 'normal', victory: 'standard', startAge: 0,
});
const ais = game.players.filter((p) => !p.isGaia).map((p) => new AIPlayer(game, p.id, 'hard'));

interface Track { x: number; z: number; since: number; moveTime: number; stuck: boolean; start: number; gx: number; gz: number; gd: number }
const tracks = new Map<number, Track>();
const episodes: { id: number; type: string; order: string; cause: string; dur: number; t: number }[] = [];
const WINDOW = 3;

function cause(u: Unit): string {
  const m = game.map, n = m.n;
  const ahead = (d: number) => [u.x + Math.sin(u.facing) * d, u.z + Math.cos(u.facing) * d];
  // another unit in the way (overlapping or just ahead)
  let unitBlock = '';
  game.spatial.query(u.x, u.z, u.radius + 0.8, (v, d2) => {
    if (v === u || !v.alive || v.garrisonedIn || unitBlock) return;
    const dx = v.x - u.x, dz = v.z - u.z;
    const along = dx * Math.sin(u.facing) + dz * Math.cos(u.facing);
    if (along > 0 && d2 < (u.radius + v.radius + 0.15) ** 2) unitBlock = v.moving ? 'unit(moving)' : `unit(${v.anim})`;
  });
  // a blocked tile just ahead, or standing in one
  const here = m.idx(Math.floor(u.x), Math.floor(u.z));
  if (u.def.naval ? m.navalBlocked[here] : m.landBlocked[here]) return 'inside blocked tile';
  for (const d of [0.25, 0.45]) {
    const [ax, az] = ahead(d);
    const tx = Math.floor(ax), tz = Math.floor(az);
    if (tx < 0 || tz < 0 || tx >= n || tz >= n) return 'map edge';
    const i = m.idx(tx, tz);
    if (u.def.naval ? m.navalBlocked[i] : m.landBlocked[i]) {
      const ob = game.get(m.obstacle[i]);
      const what = ob ? (ob.kind === 'resource' ? ob.type : ob.kind === 'building' ? 'building' : 'unit') : m.terrain[i] >= 5 && m.terrain[i] <= 7 ? 'water' : 'blocked';
      return `tile ahead: ${what}${unitBlock ? ' + ' + unitBlock : ''}`;
    }
  }
  if (unitBlock) return unitBlock;
  if (!u.path.length) return 'no path';
  if (process.env.DETAIL) {
    const wx = u.path[u.pathIdx * 2], wz = u.path[u.pathIdx * 2 + 1];
    const dw = Math.hypot(wx - u.x, wz - u.z);
    const head = Math.atan2(wx - u.x, wz - u.z) - u.facing;
    const clear = game.pathfinder.setDomain(!!u.def.naval).lineClear(u.x, u.z, wx, wz, game.teamOf[u.owner], 0);
    let near = 0;
    game.spatial.query(u.x, u.z, 1.2, (v) => { if (v !== u && v.alive && !v.garrisonedIn) near++; });
    const o = u.order as { target?: number };
    const t = o.target ? game.get(o.target) : undefined;
    return `no obvious blocker [wp ${u.pathIdx + 1}/${u.path.length / 2} at ${dw.toFixed(2)}, turn ${(((head + Math.PI * 3) % (Math.PI * 2)) - Math.PI).toFixed(2)}, line ${clear ? 'clear' : 'BLOCKED'}, ${near} near, ret ${u.returning}, tgt ${t ? (t.kind === 'resource' ? t.type : t.kind === 'building' ? t.type : t.type) : '-'}]`;
  }
  return 'no obvious blocker';
}

let shown = 0;
const ticks = Math.round(minutes * 60 / 0.05);
const t0 = performance.now();
for (let i = 0; i < ticks; i++) {
  game.step();
  for (const ai of ais) if (!game.players[ai.pid].defeated && (game.tickCount + ai.pid * 3) % 10 === 0) ai.update();
  game.events.length = 0;
  if (game.tickCount % 5) continue;
  for (const u of game.units) {
    if (!u.alive || u.garrisonedIn || u.def.animal) { tracks.delete(u.id); continue; }
    let tr = tracks.get(u.id);
    if (!u.moving) {
      if (tr?.stuck) episodes.push({ id: u.id, type: u.type, order: u.order.t, cause: (tr as Track & { cause?: string }).cause ?? '?', dur: game.time - tr.start, t: tr.start });
      tracks.delete(u.id);
      continue;
    }
    const goalDist = Math.hypot(u.navGoalX - u.x, u.navGoalZ - u.z);
    if (!tr) { tracks.set(u.id, { x: u.x, z: u.z, since: game.time, moveTime: 0, stuck: false, start: game.time, gx: u.navGoalX, gz: u.navGoalZ, gd: goalDist }); continue; }
    if (process.env.TRACE) {
      const h = ((tr as unknown as { h?: string[] }).h ??= []);
      h.push(`t${game.tickCount} (${u.x.toFixed(2)},${u.z.toFixed(2)}) ${u.anim} path[${u.pathIdx}/${u.path.length / 2}] wp ${u.path.length ? u.path[u.pathIdx * 2]?.toFixed(2) + ',' + u.path[u.pathIdx * 2 + 1]?.toFixed(2) : '-'} stuck ${u.stuckTime} goal ${u.navGoalX.toFixed(1)},${u.navGoalZ.toFixed(1)} tgt ${(u.order as { target?: number }).target ?? '-'} ret ${u.returning}`);
      if (h.length > 14) h.shift();
    }
    if (game.time - tr.since >= WINDOW) {
      // stuck: heading for the same place all along and no nearer to it (a turn for home is not being stuck)
      const sameGoal = Math.abs(u.navGoalX - tr.gx) < 0.8 && Math.abs(u.navGoalZ - tr.gz) < 0.8;
      const gained = tr.gd - goalDist;
      if (sameGoal && gained < 0.5 && Math.hypot(u.x - tr.x, u.z - tr.z) < 1.5) {
        if (!tr.stuck) {
          tr.stuck = true; tr.start = game.time - WINDOW; (tr as Track & { cause?: string }).cause = cause(u);
          if (process.env.TRACE && (tr as Track & { cause?: string }).cause!.startsWith(process.env.TRACE!) && shown < 4) {
            shown++;
            console.log(`${u.type}#${u.id} ${(tr as Track & { cause?: string }).cause}`);
            for (const l of (tr as unknown as { h: string[] }).h) console.log('   ' + l);
          }
        }
      } else if (tr.stuck) {
        episodes.push({ id: u.id, type: u.type, order: u.order.t, cause: (tr as Track & { cause?: string }).cause ?? '?', dur: game.time - tr.start, t: tr.start });
        tr.stuck = false;
      }
      tr.x = u.x; tr.z = u.z; tr.since = game.time; tr.gx = u.navGoalX; tr.gz = u.navGoalZ; tr.gd = goalDist;
    }
  }
}
for (const [id, tr] of tracks) if (tr.stuck) { const u = game.unit(id); if (u) episodes.push({ id, type: u.type, order: u.order.t, cause: (tr as Track & { cause?: string }).cause ?? '?', dur: game.time - tr.start, t: tr.start }); }

const unitSeconds = game.units.length;
const gathered = game.players.filter((p) => !p.isGaia).reduce((a, p) => a + p.stats.gathered.food + p.stats.gathered.wood + p.stats.gathered.gold + p.stats.gathered.stone, 0);
if (process.env.GATHER) console.log(`gathered ${gathered.toFixed(0)}`);
const total = episodes.reduce((a, e) => a + e.dur, 0);
console.log(`${minutes} min, ${np} players, seed ${seed}: ${episodes.length} stuck episodes, ${total.toFixed(0)} unit-seconds stuck (${((performance.now() - t0) / 1000).toFixed(0)} s to run)`);
const by = new Map<string, { n: number; s: number }>();
for (const e of episodes) {
  const k = e.cause.replace(/\(.*?\)/g, (m) => m);
  const v = by.get(k) ?? { n: 0, s: 0 };
  v.n++; v.s += e.dur;
  by.set(k, v);
}
for (const [k, v] of [...by].sort((a, b) => b[1].s - a[1].s)) console.log(`  ${k.padEnd(40)} ${String(v.n).padStart(4)} episodes ${v.s.toFixed(0).padStart(6)} s`);
const byOrder = new Map<string, number>();
for (const e of episodes) byOrder.set(e.order, (byOrder.get(e.order) ?? 0) + e.dur);
console.log('  by order:', [...byOrder].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(0)}s`).join(', '));
if (process.env.LONG) for (const e of episodes.filter((x) => x.dur > 8).slice(0, 20)) console.log(`   ${e.type} #${e.id} ${e.order} at ${e.t.toFixed(0)}s for ${e.dur.toFixed(0)}s: ${e.cause}`);
void unitSeconds;
