/*
 * Idle villagers: plays an AI match and reports, every few minutes, each computer player's villagers that have been
 * idle for more than 20 s, with what they were last doing and what the AI last told them.
 *   npx tsx tools/idletest.ts [minutes] [players] [seed] [map]
 */
import { Game } from '../src/sim/game';
import { AIPlayer } from '../src/ai/ai';
import { issueCommand } from '../src/sim/commands';

const minutes = Number(process.argv[2] ?? 40);
const np = Number(process.argv[3] ?? 4);
const seed = Number(process.argv[4] ?? 2024);
const map = (process.argv[5] ?? 'oasis') as 'oasis';
const civs = ['carthaginians', 'gauls', 'parthians', 'han', 'latins', 'hellenes', 'suebi', 'kushites'];
const game = new Game({
  seed, mapType: map, mapSize: np <= 2 ? 120 : np <= 4 ? 168 : 220,
  players: Array.from({ length: np }, (_, i) => ({ name: `AI${i + 1}`, civ: civs[(i + seed) % civs.length], color: i, team: i + 1, human: false, difficulty: (process.env.DIFF ?? 'hard') as 'hard' })),
  resources: (process.env.RES ?? 'standard') as 'standard', popLimit: 200, reveal: 'normal', victory: 'standard', startAge: Number(process.env.AGE ?? 0) as 0,
});
const ais = game.players.filter((p) => !p.isGaia).map((p) => new AIPlayer(game, p.id, (process.env.DIFF ?? 'hard') as 'hard'));

// what the AI last ordered each villager (wrap issueCommand as the AI sees it)
const lastCmd = new Map<number, string>();
const proto = AIPlayer.prototype as unknown as { cmd: (c: { c: string; units?: number[]; target?: number }) => boolean };
const origCmd = proto.cmd;
proto.cmd = function (this: AIPlayer, c) {
  const ok = origCmd.call(this, c);
  for (const id of c.units ?? []) {
    const t = c.target ? game.get(c.target) : undefined;
    lastCmd.set(id, `${c.c}${t ? ' ' + t.type + '#' + t.id : ''}${ok ? '' : ' (refused)'} @${game.time.toFixed(0)}`);
  }
  return ok;
};
void issueCommand;

const idleSince = new Map<number, number>();
for (let m = 1; m <= minutes; m++) {
  for (let i = 0; i < 1200; i++) {
    game.step();
    for (const ai of ais) if (!game.players[ai.pid].defeated && (game.tickCount + ai.pid * 3) % 10 === 0) ai.update();
    game.events.length = 0;
    if (game.tickCount % 20) continue;
    for (const u of game.units) {
      if (!u.alive || !u.def.gatherer || u.def.naval) continue;
      // standing about: idle, or holding an order but neither walking nor working
      const standing = !u.garrisonedIn && !u.moving && u.anim !== 'work' && u.anim !== 'attack';
      if (standing) { if (!idleSince.has(u.id)) idleSince.set(u.id, game.time); }
      else idleSince.delete(u.id);
    }
  }
  if (m % Number(process.env.EVERY ?? 5)) continue;
  const lines: string[] = [];
  for (const p of game.players) {
    if (p.isGaia || p.defeated) continue;
    const vills = game.units.filter((u) => u.alive && u.owner === p.id && u.def.gatherer && !u.def.naval);
    const idle = vills.filter((u) => (idleSince.get(u.id) ?? Infinity) < game.time - 20);
    lines.push(`  P${p.id} age ${p.age} pop ${p.pop}/${p.popCap}: ${vills.length} villagers, ${idle.length} idle > 20 s  res ${Object.values(p.res).map((v) => Math.round(v)).join('/')}`);
    const kinds = new Map<string, number>();
    for (const u of idle) {
      const k = `${u.order.t}${u.returning ? '/returning' : ''}${u.path.length ? '/has path' : '/no path'}`;
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
    }
    if (kinds.size) lines.push(`      ${[...kinds].map(([k, n]) => `${k}: ${n}`).join(', ')}`);
    for (const u of idle.slice(0, 3)) {
      const o = u.order as { target?: number };
      const t = o.target ? game.get(o.target) : undefined;
      lines.push(`      #${u.id} standing ${(game.time - idleSince.get(u.id)!).toFixed(0)} s at (${u.x.toFixed(1)},${u.z.toFixed(1)}) order ${u.order.t} ${t ? t.type + '#' + t.id + (t.alive ? '' : ' (gone)') : ''}${t && game.isUnreachable(t.id, game.teamOf[u.owner]) ? ' UNREACHABLE' : ''} ret ${u.returning} drop ${u.dropId} carry ${u.carryAmount.toFixed(0)} navFailed ${u.navFailed} repathIn ${(u.repathAt - game.time).toFixed(1)}; AI last: ${lastCmd.get(u.id) ?? '-'}`);
    }
  }
  console.log(`min ${m}:\n${lines.join('\n')}`);
}
