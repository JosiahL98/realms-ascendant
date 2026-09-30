/* Forest generation regression: npm run foresttest */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Game } from '../src/sim/game';
import { MAP_SIZES } from '../src/sim/mapgen';

function makeGame(size: number, players: number, seed: number): Game {
  return new Game({
    seed, mapType: 'forest', mapSize: size,
    players: Array.from({ length: players }, (_, i) => ({
      name: `Player ${i + 1}`, civ: 'gauls', color: i, team: i + 1,
      human: i === 0, difficulty: 'standard' as const,
    })),
    resources: 'standard', popLimit: 200, reveal: 'normal', victory: 'standard', startAge: 0,
  });
}

/** Four-neighbour movement deliberately excludes diagonal corner squeezing. */
function search(game: Game, start: number, target = -1, blockedAt = -1): { path: number[]; reached: number } {
  const n = game.map.n;
  const parent = new Int32Array(n * n).fill(-1);
  const queue = new Int32Array(n * n);
  const bx = blockedAt % n, bz = Math.floor(blockedAt / n);
  const push = (k: number, from: number): void => {
    if (parent[k] !== -1 || game.map.landBlocked[k]) return;
    // Occupying a nine-tile-wide clearing must still leave a separate way around.
    if (blockedAt >= 0 && Math.abs(k % n - bx) <= 4 && Math.abs(Math.floor(k / n) - bz) <= 4) return;
    parent[k] = from;
    queue[tail++] = k;
  };
  let head = 0, tail = 0;
  push(start, start);
  while (head < tail) {
    const k = queue[head++];
    if (k === target) {
      const path = [k];
      while (path[path.length - 1] !== start) path.push(parent[path[path.length - 1]]);
      return { path: path.reverse(), reached: tail };
    }
    const x = k % n, z = Math.floor(k / n);
    if (x > 0) push(k - 1, k);
    if (x < n - 1) push(k + 1, k);
    if (z > 0) push(k - n, k);
    if (z < n - 1) push(k + n, k);
  }
  return { path: [], reached: tail };
}

function startTiles(game: Game): number[] {
  const n = game.map.n;
  return game.buildings.filter(b => b.type === 'townCenter').map(b => {
    // The inner base clearing is protected during generation; use its north edge.
    const tile = (b.tz - 1) * n + b.tx + 2;
    assert.equal(game.map.landBlocked[tile], 0, `Player ${b.owner} has a blocked base exit`);
    return tile;
  });
}

function generationFingerprint(game: Game): string {
  return createHash('sha256').update(JSON.stringify({
    terrain: [...game.map.terrain], heights: [...game.map.heights], obstacle: [...game.map.obstacle],
    resources: game.resources.filter(r => r.alive).map(r => [r.id, r.type, r.x, r.z, r.amount, r.variant, r.rot, r.scale]),
    units: game.units.map(u => [u.id, u.type, u.owner, u.x, u.z]),
  })).digest('hex');
}

const seeds = [1, 42, 8675309];
const failures: string[] = [];
let generated = 0, bypasses = 0;
for (const { size } of MAP_SIZES) {
  let minTrees = 1, maxTrees = 0, minReachable = 1;
  for (let players = 2; players <= 8; players++) {
    for (const seed of seeds) {
      const label = `${size} tiles, ${players} players, seed ${seed}`;
      try {
        const game = makeGame(size, players, seed);
        generated++;
        const starts = startTiles(game);
        for (const base of game.buildings.filter(b => b.type === 'townCenter')) {
          const nearby = game.resources.filter(r => r.alive && Math.hypot(r.x - base.x, r.z - base.z) <= 25);
          // Placement attempts and cluster sizes vary; each essential resource must remain available.
          for (const type of ['tree', 'berries', 'gold', 'stone'] as const) {
            assert(nearby.some(r => r.type === type), `Player ${base.owner} is missing nearby starting ${type}`);
          }
        }
        const coverage = game.resources.filter(r => r.alive && r.type === 'tree').length / (size * size);
        minTrees = Math.min(minTrees, coverage);
        maxTrees = Math.max(maxTrees, coverage);
        // Roughly half the eligible tiles inside stands contain trees. Clearings,
        // bases and trails bring whole-map coverage below that local 50% density.
        assert(coverage >= 0.15 && coverage <= 0.35, `Tree coverage ${(100 * coverage).toFixed(1)}% is outside the half-filled-forest range`);
        const open = game.map.landBlocked.reduce((count, blocked) => count + (blocked ? 0 : 1), 0);
        const reachable = search(game, starts[0]).reached / open;
        minReachable = Math.min(minReachable, reachable);
        // Small gaps inside dense stands are expected; most open ground must be useful.
        assert(reachable >= 0.8, `Only ${(100 * reachable).toFixed(1)}% of open land is reachable from the first base`);

        for (let i = 1; i < starts.length; i++) {
          assert(search(game, starts[0], starts[i]).path.length > 0, `Player ${i + 1} cannot reach player 1`);
        }
        // Distant opponents exercise routes across the forest, beyond base clearings.
        for (let i = 0; i < starts.length; i++) {
          const target = starts[(i + Math.floor(starts.length / 2)) % starts.length];
          const path = search(game, starts[i], target).path;
          assert(path.length > 0, `Player ${i + 1} cannot reach the opposite base`);
          const midpoint = path[Math.floor(path.length / 2)];
          assert(search(game, starts[i], target, midpoint).path.length > 0, `Player ${i + 1} has no alternate route when the main route is blocked`);
          bypasses++;
        }
        if (players === 2 && seed === seeds[0]) {
          assert.equal(generationFingerprint(makeGame(size, players, seed)), generationFingerprint(game), 'Same-seed generation differs');
        }
      } catch (error) {
        failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  console.log(`${size} tiles: trees ${(100 * minTrees).toFixed(1)}–${(100 * maxTrees).toFixed(1)}%; reachable open land ≥${(100 * minReachable).toFixed(1)}%`);
}
if (failures.length) {
  for (const failure of failures) console.error(failure);
  console.error(`${failures.length} of ${generated} forest maps failed`);
  process.exitCode = 1;
} else {
  console.log(`Passed ${generated} forest maps, ${bypasses} alternate routes, and deterministic generation at every map size.`);
}
