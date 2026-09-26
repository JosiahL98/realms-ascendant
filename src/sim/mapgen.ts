import { Noise2D } from '../util/noise';
import { RNG } from '../util/rng';
import type { Game } from './game';
import { T } from './map';
import { finishConstruction } from './buildingAI';

export type MapType = 'steppe' | 'highlands' | 'forest' | 'oasis' | 'mediterranean' | 'rivers';

export interface MapInfo {
  id: MapType;
  name: string;
  description: string;
}

export const MAP_TYPES: MapInfo[] = [
  { id: 'steppe', name: 'Steppe', description: 'Open grassland with scattered woods and gentle hills. Aggressive play thrives here.' },
  { id: 'highlands', name: 'Highlands', description: 'Rolling hills, lakes and thick pine woods. Hold the high ground.' },
  { id: 'forest', name: 'Hercynian Forest', description: 'An endless forest with narrow paths. Walls are easy, rushes are hard.' },
  { id: 'oasis', name: 'Oasis', description: 'Desert sands around a green oasis rich with wood and gold.' },
  { id: 'mediterranean', name: 'Middle Sea', description: 'The heart of the Punic world: players ring a great inland sea.' },
  { id: 'rivers', name: 'Twin Rivers', description: 'Two rivers divide the land, crossable only at shallow fords.' },
];

export const MAP_SIZES = [
  { name: 'Tiny (2 players)', size: 120 },
  { name: 'Small (3 players)', size: 144 },
  { name: 'Medium (4 players)', size: 168 },
  { name: 'Normal (6 players)', size: 200 },
  { name: 'Large (8 players)', size: 220 },
];

interface Style {
  base: number;
  alt: number;
  patch: number;
  hills: number;
  forestAmount: number;
  treeTypes: number[];
  lakes: number;
  sea: boolean;
  rivers: boolean;
  desert: boolean;
}

const STYLES: Record<MapType, Style> = {
  steppe: { base: T.dryGrass, alt: T.grass, patch: T.dirt, hills: 1.3, forestAmount: 0.16, treeTypes: [0, 0, 3], lakes: 0, sea: false, rivers: false, desert: false },
  highlands: { base: T.grass, alt: T.dryGrass, patch: T.dirt, hills: 2.6, forestAmount: 0.24, treeTypes: [1, 1, 0], lakes: 3, sea: false, rivers: false, desert: false },
  forest: { base: T.grass, alt: T.forest, patch: T.dirt, hills: 1.0, forestAmount: 0.62, treeTypes: [1, 0, 1], lakes: 0, sea: false, rivers: false, desert: false },
  oasis: { base: T.sand, alt: T.dirt, patch: T.dryGrass, hills: 1.1, forestAmount: 0.05, treeTypes: [2, 2, 2], lakes: 0, sea: false, rivers: false, desert: true },
  mediterranean: { base: T.grass, alt: T.dryGrass, patch: T.dirt, hills: 1.4, forestAmount: 0.14, treeTypes: [3, 3, 0], lakes: 0, sea: true, rivers: false, desert: false },
  rivers: { base: T.grass, alt: T.dryGrass, patch: T.dirt, hills: 1.0, forestAmount: 0.17, treeTypes: [0, 1, 3], lakes: 0, sea: false, rivers: true, desert: false },
};

const START_RES = {
  standard: { food: 200, wood: 200, gold: 100, stone: 200 },
  medium: { food: 500, wood: 500, gold: 300, stone: 300 },
  high: { food: 1000, wood: 1000, gold: 1000, stone: 1000 },
};

export function generateMap(game: Game): void {
  const setup = game.setup;
  const map = game.map;
  const n = map.n;
  const rng = new RNG(setup.seed * 7 + 13);
  const noise = new Noise2D(setup.seed);
  const noise2 = new Noise2D(setup.seed + 101);
  const noise3 = new Noise2D(setup.seed + 202);
  const style = STYLES[setup.mapType] ?? STYLES.steppe;
  const W = n + 1;
  const players = game.players.filter((p) => !p.isGaia);
  const np = players.length;

  /* ---------------- Player start positions ---------------- */
  // group players by team so teammates sit next to each other
  const order = [...players].sort((a, b) => a.team - b.team || a.id - b.id);
  const baseAngle = rng.range(0, Math.PI * 2);
  const radius = n * (style.sea ? 0.37 : 0.34);
  const starts = new Map<number, { x: number; z: number }>();
  order.forEach((p, i) => {
    const a = baseAngle + (i / np) * Math.PI * 2 + rng.range(-0.12, 0.12);
    const r = radius * rng.range(0.94, 1.04);
    starts.set(p.id, { x: Math.round(n / 2 + Math.cos(a) * r), z: Math.round(n / 2 + Math.sin(a) * r) });
  });
  const startList = [...starts.values()];
  const minStartDist = (x: number, z: number): number => {
    let d = Infinity;
    for (const s of startList) d = Math.min(d, Math.hypot(s.x - x, s.z - z));
    return d;
  };

  /* ---------------- Heights ---------------- */
  const h = map.heights;
  for (let z = 0; z <= n; z++) {
    for (let x = 0; x <= n; x++) {
      let v = noise.fbm(x / 38, z / 38, 4) * style.hills;
      v += noise2.fbm(x / 13, z / 13, 2) * 0.25 * style.hills;
      v = Math.max(v, -0.6) + 0.35;
      if (style.sea) {
        const d = Math.hypot(x - n / 2, z - n / 2) / (n / 2);
        const coast = 0.5 + noise3.fbm(x / 20, z / 20, 3) * 0.12;
        if (d < coast) v -= (coast - d) * 14;
      }
      h[z * W + x] = v;
    }
  }
  // lakes
  for (let l = 0; l < style.lakes; l++) {
    for (let tries = 0; tries < 40; tries++) {
      const lx = rng.range(n * 0.15, n * 0.85), lz = rng.range(n * 0.15, n * 0.85);
      if (minStartDist(lx, lz) < 26) continue;
      const lr = rng.range(4, 7);
      for (let z = 0; z <= n; z++)
        for (let x = 0; x <= n; x++) {
          const d = Math.hypot(x - lx, z - lz) + noise3.noise2(x / 5, z / 5) * 1.5;
          if (d < lr + 3) {
            const t = Math.max(0, 1 - d / (lr + 3));
            h[z * W + x] -= t * t * 5;
          }
        }
      break;
    }
  }
  // rivers: two meandering channels between players with fords
  const fordMask = new Uint8Array(n * n);
  if (style.rivers) {
    for (let r = 0; r < 2; r++) {
      const a = baseAngle + Math.PI / np + (r * Math.PI) / 1 + (np === 2 ? 0 : r * 0.3);
      const dx = Math.cos(a), dz = Math.sin(a);
      for (let t = -n; t <= n; t += 0.5) {
        const wob = noise3.noise2(t / 25, r * 10) * 8;
        const cx = n / 2 + dx * t - dz * wob, cz = n / 2 + dz * t + dx * wob;
        const isFord = Math.abs(((t + n * 2) % 30) - 15) < 2.5;
        for (let oz = -3; oz <= 3; oz++)
          for (let ox = -3; ox <= 3; ox++) {
            const x = Math.round(cx + ox), z = Math.round(cz + oz);
            if (x < 0 || z < 0 || x > n || z > n) continue;
            const d = Math.hypot(ox, oz);
            if (d > 2.6) continue;
            if (isFord) {
              if (x < n && z < n) fordMask[z * n + x] = 1;
              h[z * W + x] = Math.min(h[z * W + x], -0.1);
            } else h[z * W + x] = Math.min(h[z * W + x], -0.8 - (2.6 - d) * 0.2);
          }
      }
    }
  }
  // flatten around player starts
  for (const s of startList) {
    const target = 0.5;
    for (let z = Math.max(0, s.z - 16); z <= Math.min(n, s.z + 16); z++)
      for (let x = Math.max(0, s.x - 16); x <= Math.min(n, s.x + 16); x++) {
        const d = Math.hypot(x - s.x, z - s.z);
        if (d > 16) continue;
        const t = d < 9 ? 1 : 1 - (d - 9) / 7;
        const k = z * W + x;
        h[k] = h[k] * (1 - t) + target * t;
      }
  }
  // gentle smoothing pass
  const tmp = new Float32Array(h);
  for (let z = 1; z < n; z++)
    for (let x = 1; x < n; x++) {
      const k = z * W + x;
      tmp[k] = (h[k] * 4 + h[k - 1] + h[k + 1] + h[k - W] + h[k + W]) / 8;
    }
  h.set(tmp);

  /* ---------------- Terrain types ---------------- */
  const wl = map.waterLevel;
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const k = z * n + x;
      const th = (h[z * W + x] + h[z * W + x + 1] + h[(z + 1) * W + x] + h[(z + 1) * W + x + 1]) / 4;
      let t: number = style.base;
      const pv = noise2.fbm(x / 16, z / 16, 3);
      if (pv > 0.18) t = style.alt;
      if (noise3.fbm(x / 9 + 50, z / 9, 2) > 0.42) t = style.patch;
      if (style.desert) {
        const d = Math.hypot(x - n / 2, z - n / 2);
        if (d < n * 0.16) t = T.grass;
        else if (d < n * 0.2) t = T.dryGrass;
      }
      if (th < wl - 0.02) {
        t = fordMask[k] ? T.shallows : th < wl - 1.2 ? T.deep : T.water;
      } else if (fordMask[k]) t = T.shallows;
      else if (th < wl + 0.3) t = T.sand;
      map.terrain[k] = t;
    }
  }
  // sand beaches next to water
  for (let z = 0; z < n; z++)
    for (let x = 0; x < n; x++) {
      const k = z * n + x;
      if (map.terrain[k] === T.water || map.terrain[k] === T.deep || map.terrain[k] === T.shallows) continue;
      let nearWater = false;
      for (let dz = -1; dz <= 1 && !nearWater; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, zz = z + dz;
          if (xx < 0 || zz < 0 || xx >= n || zz >= n) continue;
          const tt = map.terrain[zz * n + xx];
          if (tt === T.water || tt === T.deep) {
            nearWater = true;
            break;
          }
        }
      if (nearWater && !style.rivers) map.terrain[k] = T.sand;
    }
  map.refreshAll();

  /* ---------------- Player bases ---------------- */
  const reserved = new Uint8Array(n * n);
  const reserve = (x0: number, z0: number, w: number, hh: number, pad = 0): void => {
    for (let z = z0 - pad; z < z0 + hh + pad; z++)
      for (let x = x0 - pad; x < x0 + w + pad; x++) if (x >= 0 && z >= 0 && x < n && z < n) reserved[z * n + x] = 1;
  };
  const tileFree = (x: number, z: number): boolean => {
    if (x < 1 || z < 1 || x >= n - 1 || z >= n - 1) return false;
    const k = z * n + x;
    return !map.landBlocked[k] && !reserved[k] && map.terrain[k] !== T.shallows;
  };
  const areaFree = (x0: number, z0: number, w: number, hh: number): boolean => {
    for (let z = z0; z < z0 + hh; z++) for (let x = x0; x < x0 + w; x++) if (!tileFree(x, z)) return false;
    return true;
  };
  const findSpot = (cx: number, cz: number, rMin: number, rMax: number, w: number, hh: number, avoid = 0): { x: number; z: number } | null => {
    for (let i = 0; i < 300; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(rMin, rMax);
      const x = Math.round(cx + Math.cos(a) * r - w / 2), z = Math.round(cz + Math.sin(a) * r - hh / 2);
      if (!areaFree(x - 1, z - 1, w + 2, hh + 2)) continue;
      if (avoid > 0 && minStartDist(x, z) < avoid) continue;
      return { x, z };
    }
    return null;
  };
  const cluster = (sx: number, sz: number, count: number, place: (x: number, z: number) => void): number => {
    const tiles: [number, number][] = [[sx, sz]];
    const used = new Set<number>([sz * n + sx]);
    let placed = 0;
    while (tiles.length && placed < count) {
      const i = rng.int(0, Math.min(tiles.length - 1, 2));
      const [x, z] = tiles.splice(i, 1)[0];
      if (!tileFree(x, z)) continue;
      place(x, z);
      reserved[z * n + x] = 1;
      placed++;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        const k = nz * n + nx;
        if (!used.has(k)) {
          used.add(k);
          tiles.push([nx, nz]);
        }
      }
    }
    return placed;
  };
  const addTree = (x: number, z: number, type: number): void => {
    const r = game.addResource('tree', 'wood', 100, x, z, true);
    r.variant = type;
    r.rot = rng.range(0, Math.PI * 2);
    r.scale = rng.range(0.85, 1.15);
    map.terrain[z * n + x] = map.terrain[z * n + x] === T.sand ? T.sand : T.forest;
  };
  const pickTree = (): number => rng.pick(style.treeTypes);

  const res = START_RES[setup.resources] ?? START_RES.standard;
  for (const p of players) {
    const s = starts.get(p.id)!;
    p.res = { ...res };
    for (const b of p.civ.bonuses) {
      if ((b.age ?? 0) > 0) continue;
      for (const e of b.effects) if (e.kind === 'resource') p.res[e.res] += e.value;
    }
    const tcx = s.x - 2, tcz = s.z - 2;
    // clear any obstacles (none yet) & reserve the base area
    const tc = game.createBuilding('townCenter', p.id, tcx, tcz, true);
    finishConstruction(game, tc);
    reserve(tcx, tcz, 4, 4, 3);
    const vills = p.civ.start?.villagers ?? 3;
    for (let i = 0; i < vills; i++) {
      const a = (i / vills) * Math.PI * 2 + 0.4;
      game.spawnUnit('villager', p.id, s.x + Math.cos(a) * 3.2, s.z + Math.sin(a) * 3.2);
    }
    game.spawnUnit('scout', p.id, s.x + 3.5, s.z - 3.5);

    // Berries: 6-7 bushes
    const bs = findSpot(s.x, s.z, 7, 9, 3, 3);
    if (bs) cluster(bs.x + 1, bs.z + 1, 7, (x, z) => game.addResource('berries', 'forage', 125, x, z, true));
    // Gold: main (7) near, secondary (4) further
    const g1 = findSpot(s.x, s.z, 10, 13, 3, 3);
    if (g1) cluster(g1.x + 1, g1.z + 1, 7, (x, z) => game.addResource('gold', 'gold', 800, x, z, true));
    const g2 = findSpot(s.x, s.z, 17, 22, 3, 3);
    if (g2) cluster(g2.x + 1, g2.z + 1, 4, (x, z) => game.addResource('gold', 'gold', 800, x, z, true));
    // Stone: 5 near, 4 further
    const s1 = findSpot(s.x, s.z, 11, 15, 3, 3);
    if (s1) cluster(s1.x + 1, s1.z + 1, 5, (x, z) => game.addResource('stone', 'stone', 350, x, z, true));
    const s2 = findSpot(s.x, s.z, 18, 24, 3, 3);
    if (s2) cluster(s2.x + 1, s2.z + 1, 4, (x, z) => game.addResource('stone', 'stone', 350, x, z, true));
    // Sheep: 4 near TC, 2 pairs further
    for (let i = 0; i < 4; i++) {
      const sp = findSpot(s.x, s.z, 4, 7, 1, 1);
      if (sp) {
        const sh = game.spawnUnit('sheep', p.id, sp.x + 0.5, sp.z + 0.5);
        sh.homeX = sh.x;
        sh.homeZ = sh.z;
      }
    }
    for (let k = 0; k < 2; k++) {
      const sp = findSpot(s.x, s.z, 13, 20, 2, 2);
      if (!sp) continue;
      for (let i = 0; i < 2; i++) {
        const sh = game.spawnUnit('sheep', 0, sp.x + 0.5 + i, sp.z + 0.5);
        sh.homeX = sh.x;
        sh.homeZ = sh.z;
      }
    }
    // Boar x2
    for (let k = 0; k < 2; k++) {
      const sp = findSpot(s.x, s.z, 14, 19, 1, 1);
      if (sp) {
        const b = game.spawnUnit('boar', 0, sp.x + 0.5, sp.z + 0.5);
        b.homeX = b.x;
        b.homeZ = b.z;
      }
    }
    // Deer herd (3-4)
    const dp = findSpot(s.x, s.z, 16, 22, 3, 3);
    if (dp) {
      const cnt = rng.int(3, 4);
      for (let i = 0; i < cnt; i++) {
        const d = game.spawnUnit('deer', 0, dp.x + rng.range(0, 3), dp.z + rng.range(0, 3));
        d.homeX = d.x;
        d.homeZ = d.z;
      }
    }
    // Main woodline near base + straggler trees
    const wp = findSpot(s.x, s.z, 9, 12, 5, 5);
    if (wp) {
      const cx = wp.x + 2, cz = wp.z + 2;
      const tt = pickTree();
      for (let z = cz - 5; z <= cz + 5; z++)
        for (let x = cx - 5; x <= cx + 5; x++) {
          const d = Math.hypot(x - cx, z - cz) + noise3.noise2(x / 3, z / 3) * 1.8;
          if (d < 4.2 && tileFree(x, z) && Math.hypot(x - s.x, z - s.z) > 6.5) addTree(x, z, rng.chance(0.8) ? tt : pickTree());
        }
    }
    for (let i = 0; i < 4; i++) {
      const sp = findSpot(s.x, s.z, 5, 8, 1, 1);
      if (sp) addTree(sp.x, sp.z, pickTree());
    }
    reserve(s.x - 9, s.z - 9, 18, 18, 0);
  }

  /* ---------------- Forests ---------------- */
  const forestNoise = new Noise2D(setup.seed + 555);
  const thr = 1 - style.forestAmount * 2.2;
  for (let z = 1; z < n - 1; z++) {
    for (let x = 1; x < n - 1; x++) {
      if (!tileFree(x, z)) continue;
      const msd = minStartDist(x, z);
      if (msd < 12) continue;
      let v = forestNoise.fbm(x / 14, z / 14, 3);
      v = (v + 1) / 2 + forestNoise.noise2(x / 3.5, z / 3.5) * 0.06;
      // forests thin out near bases; the edge of the map is thickly wooded
      const edge = Math.min(x, z, n - 1 - x, n - 1 - z);
      if (edge < 4) v += 0.25;
      if (msd < 18) v -= (18 - msd) * 0.03;
      if (map.terrain[z * n + x] === T.sand && style.desert) v -= 0.25;
      if (v > thr && rng.chance(0.93)) addTree(x, z, pickTree());
    }
  }
  // Oasis grove
  if (style.desert) {
    for (let z = 0; z < n; z++)
      for (let x = 0; x < n; x++) {
        const d = Math.hypot(x - n / 2, z - n / 2);
        if (d > n * 0.08 && d < n * 0.14 && tileFree(x, z) && rng.chance(0.55)) addTree(x, z, 2);
      }
  }

  /* ---------------- Neutral resources ---------------- */
  const neutralSpot = (w: number, minD: number): { x: number; z: number } | null => {
    for (let i = 0; i < 400; i++) {
      const x = rng.int(6, n - 8), z = rng.int(6, n - 8);
      if (minStartDist(x, z) < minD) continue;
      if (!areaFree(x - 1, z - 1, w + 2, w + 2)) continue;
      return { x, z };
    }
    return null;
  };
  const extraGold = Math.max(2, Math.round(np * 1.5));
  for (let i = 0; i < extraGold; i++) {
    const sp = neutralSpot(3, 26);
    if (sp) cluster(sp.x + 1, sp.z + 1, rng.int(5, 7), (x, z) => game.addResource('gold', 'gold', 800, x, z, true));
  }
  for (let i = 0; i < np; i++) {
    const sp = neutralSpot(3, 26);
    if (sp) cluster(sp.x + 1, sp.z + 1, rng.int(4, 5), (x, z) => game.addResource('stone', 'stone', 350, x, z, true));
  }
  // Relics
  const relics = np <= 2 ? 5 : Math.min(9, np + 3);
  for (let i = 0; i < relics; i++) {
    const sp = neutralSpot(1, 22);
    if (!sp) continue;
    const r = game.addResource('relic', 'gold', 0, sp.x, sp.z, false);
    r.rot = rng.range(0, Math.PI * 2);
    reserved[sp.z * n + sp.x] = 1;
  }
  // Wolves
  for (let i = 0; i < np * 2; i++) {
    const sp = neutralSpot(1, 30);
    if (sp) {
      const w = game.spawnUnit('wolf', 0, sp.x + 0.5, sp.z + 0.5);
      w.homeX = w.x;
      w.homeZ = w.z;
    }
  }
  // Extra deer herds
  for (let i = 0; i < np; i++) {
    const sp = neutralSpot(3, 24);
    if (!sp) continue;
    for (let k = 0; k < 3; k++) {
      const d = game.spawnUnit('deer', 0, sp.x + rng.range(0, 3), sp.z + rng.range(0, 3));
      d.homeX = d.x;
      d.homeZ = d.z;
    }
  }

  /* ---------------- Fish ---------------- */
  const isWaterT = (x: number, z: number) => map.inBounds(x, z) && (map.terrain[z * n + x] === T.water || map.terrain[z * n + x] === T.deep);
  const landWithin = (x: number, z: number, r: number): boolean => {
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, zz = z + dz;
        if (map.inBounds(xx, zz) && !isWaterT(xx, zz)) return true;
      }
    return false;
  };
  const fishAt: { x: number; z: number }[] = [];
  const farFromFish = (x: number, z: number, d: number) => fishAt.every((f) => Math.hypot(f.x - x, f.z - z) >= d);
  const addFish = (x: number, z: number, amount: number) => {
    const r = game.addResource('fish', 'fish', amount, x, z, false);
    r.rot = rng.range(0, Math.PI * 2);
    fishAt.push({ x, z });
  };
  for (const s of startList) {
    let placed = 0;
    for (let i = 0; i < 500 && placed < 4; i++) {
      const x = s.x + rng.int(-24, 24), z = s.z + rng.int(-24, 24);
      if (!isWaterT(x, z) || !landWithin(x, z, 1)) continue;
      if (Math.hypot(x - s.x, z - s.z) < 8 || !farFromFish(x, z, 2.5)) continue;
      addFish(x, z, 200);
      placed++;
    }
  }
  const deepCount = style.sea ? np * 5 : style.lakes ? 2 * style.lakes : style.rivers ? np * 2 : 2;
  for (let i = 0, placed = 0; i < 3000 && placed < deepCount; i++) {
    const x = rng.int(2, n - 3), z = rng.int(2, n - 3);
    if (!isWaterT(x, z) || landWithin(x, z, style.sea ? 3 : 1) || !farFromFish(x, z, 5)) continue;
    addFish(x, z, 250);
    placed++;
  }

  map.refreshAll();
  ensureConnectivity(game, startList);
}

/** Carve paths through trees so every start can reach every other start by land. */
function ensureConnectivity(game: Game, starts: { x: number; z: number }[]): void {
  const map = game.map;
  const n = map.n;
  if (starts.length < 2) return;
  const flood = (sx: number, sz: number): Uint8Array => {
    const seen = new Uint8Array(n * n);
    const q: number[] = [];
    // start from a free tile next to the TC
    const push = (x: number, z: number) => {
      if (x < 0 || z < 0 || x >= n || z >= n) return;
      const k = z * n + x;
      if (seen[k] || map.landBlocked[k]) return;
      seen[k] = 1;
      q.push(k);
    };
    for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) push(sx + dx, sz + dz);
    while (q.length) {
      const k = q.pop()!;
      const x = k % n, z = (k / n) | 0;
      push(x + 1, z);
      push(x - 1, z);
      push(x, z + 1);
      push(x, z - 1);
    }
    return seen;
  };
  for (let iter = 0; iter < starts.length * 2; iter++) {
    const seen = flood(starts[0].x, starts[0].z);
    const bad = starts.find((s) => {
      for (let dz = -4; dz <= 4; dz++)
        for (let dx = -4; dx <= 4; dx++) {
          const x = s.x + dx, z = s.z + dz;
          if (x >= 0 && z >= 0 && x < n && z < n && seen[z * n + x]) return false;
        }
      return true;
    });
    if (!bad) return;
    // carve a corridor from the unreachable start toward the first start, removing trees
    const a = starts[0];
    const steps = Math.ceil(Math.hypot(bad.x - a.x, bad.z - a.z) * 2);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = bad.x + (a.x - bad.x) * t, cz = bad.z + (a.z - bad.z) * t;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const x = Math.round(cx + dx), z = Math.round(cz + dz);
          if (x < 0 || z < 0 || x >= n || z >= n) continue;
          const id = map.obstacle[z * n + x];
          const e = id ? game.get(id) : undefined;
          if (e && e.kind === 'resource' && e.type === 'tree') game.removeResource(e);
          if (map.terrain[z * n + x] === T.water || map.terrain[z * n + x] === T.deep) {
            map.terrain[z * n + x] = T.shallows;
            map.refreshTile(x, z);
          }
        }
    }
    map.version++;
  }
}
