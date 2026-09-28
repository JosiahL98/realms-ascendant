// Simulation cost: time per tick in a big AI match (8 players by default, as in a spectator game).
//   npx tsx tools/ticktest.ts [players] [minutes]
import { Game } from '../src/sim/game';
import { AIPlayer } from '../src/ai/ai';

const np = Number(process.argv[2] ?? 8), minutes = Number(process.argv[3] ?? 30);
const civs = ['carthaginians', 'gauls', 'parthians', 'han', 'latins', 'hellenes', 'suebi', 'kushites'];
const game = new Game({
  seed: 2024, mapType: 'steppe', mapSize: 220,
  players: Array.from({ length: np }, (_, i) => ({ name: `AI${i}`, civ: civs[i % 8], color: i, team: i + 1, human: false, difficulty: 'hard' as const })),
  resources: 'standard', popLimit: 200, reveal: 'normal', victory: 'standard', startAge: 0, spectator: true,
});
const ais = game.players.filter((p) => !p.isGaia).map((p) => new AIPlayer(game, p.id, 'hard'));
let last = performance.now();
for (let m = 1; m <= minutes; m++) {
  for (let i = 0; i < 1200; i++) {
    game.step();
    for (const ai of ais) if (!game.players[ai.pid].defeated && (game.tickCount + ai.pid * 3) % 10 === 0) ai.update();
    game.events.length = 0;
  }
  const now = performance.now();
  if (m % 5 === 0) console.log(`min ${m}: ${((now - last) / 1200).toFixed(2)} ms/tick, ${game.units.filter((u) => u.alive).length} units`);
  last = now;
}
