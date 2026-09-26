/** Terrain ids. Kept as plain numbers for compact typed arrays. */
export const T = {
  grass: 0,
  dryGrass: 1,
  dirt: 2,
  sand: 3,
  forest: 4,
  shallows: 5,
  water: 6,
  deep: 7,
  snow: 8,
  road: 9,
} as const;
export type TerrainId = (typeof T)[keyof typeof T];
export const TERRAIN_COUNT = 10;

export const TERRAIN_NAMES = ['Grass', 'Steppe', 'Dirt', 'Sand', 'Forest', 'Shallows', 'Water', 'Deep Water', 'Snow', 'Road'];

export function isWaterTerrain(t: number): boolean {
  return t === T.water || t === T.deep;
}

export class GameMap {
  readonly n: number;
  terrain: Uint8Array;
  /** Corner heights, (n+1)^2. */
  heights: Float32Array;
  /** Entity id occupying the tile (building/tree/mine), 0 if none. */
  obstacle: Int32Array;
  /** 1 = blocked for land units. */
  landBlocked: Uint8Array;
  /** Gate tiles: owner player id (passable for owner & allies), -1 otherwise. */
  gateOwner: Int8Array;
  /** Walkable building (farm) id on tile, 0 if none. */
  farmAt: Int32Array;
  readonly waterLevel = -0.18;
  /** Incremented every time passability changes (for path cache invalidation). */
  version = 0;

  constructor(n: number) {
    this.n = n;
    this.terrain = new Uint8Array(n * n);
    this.heights = new Float32Array((n + 1) * (n + 1));
    this.obstacle = new Int32Array(n * n);
    this.landBlocked = new Uint8Array(n * n);
    this.gateOwner = new Int8Array(n * n).fill(-1);
    this.farmAt = new Int32Array(n * n);
  }

  idx(x: number, z: number): number {
    return z * this.n + x;
  }
  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.n && z < this.n;
  }

  cornerH(x: number, z: number): number {
    return this.heights[z * (this.n + 1) + x];
  }

  /** Bilinear terrain height at world position. */
  heightAt(x: number, z: number): number {
    const n = this.n;
    if (x < 0) x = 0;
    if (z < 0) z = 0;
    if (x > n - 0.001) x = n - 0.001;
    if (z > n - 0.001) z = n - 0.001;
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const w = n + 1;
    const h00 = this.heights[iz * w + ix];
    const h10 = this.heights[iz * w + ix + 1];
    const h01 = this.heights[(iz + 1) * w + ix];
    const h11 = this.heights[(iz + 1) * w + ix + 1];
    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  }

  /** Height of ground surface or water surface, whichever is higher. */
  surfaceAt(x: number, z: number): number {
    return Math.max(this.heightAt(x, z), this.waterLevel);
  }

  tileWater(x: number, z: number): boolean {
    return isWaterTerrain(this.terrain[this.idx(x, z)]);
  }

  /** Recompute land passability of one tile from terrain and obstacles. */
  refreshTile(x: number, z: number): void {
    const i = this.idx(x, z);
    const t = this.terrain[i];
    const blocked = isWaterTerrain(t) || this.obstacle[i] !== 0;
    this.landBlocked[i] = blocked ? 1 : 0;
  }

  refreshAll(): void {
    for (let z = 0; z < this.n; z++) for (let x = 0; x < this.n; x++) this.refreshTile(x, z);
    this.version++;
  }

  setObstacle(x0: number, z0: number, w: number, h: number, id: number): void {
    for (let z = z0; z < z0 + h; z++)
      for (let x = x0; x < x0 + w; x++) {
        if (!this.inBounds(x, z)) continue;
        this.obstacle[this.idx(x, z)] = id;
        this.refreshTile(x, z);
      }
    this.version++;
  }

  clearObstacle(x0: number, z0: number, w: number, h: number, id: number): void {
    for (let z = z0; z < z0 + h; z++)
      for (let x = x0; x < x0 + w; x++) {
        if (!this.inBounds(x, z)) continue;
        const i = this.idx(x, z);
        if (this.obstacle[i] === id) this.obstacle[i] = 0;
        if (this.gateOwner[i] >= 0) this.gateOwner[i] = -1;
        this.refreshTile(x, z);
      }
    this.version++;
  }

  /** Land passability for a given player's team (gates open for owner team). */
  passable(x: number, z: number, team: number, teamOf: Int8Array): boolean {
    if (x < 0 || z < 0 || x >= this.n || z >= this.n) return false;
    const i = z * this.n + x;
    if (this.landBlocked[i] === 0) return true;
    const g = this.gateOwner[i];
    return g >= 0 && teamOf[g] === team;
  }

  /** Average slope-free height of a footprint (for placing buildings). */
  footprintHeight(x0: number, z0: number, w: number, h: number): { avg: number; min: number; max: number } {
    let sum = 0, cnt = 0, min = Infinity, max = -Infinity;
    for (let z = z0; z <= z0 + h; z++)
      for (let x = x0; x <= x0 + w; x++) {
        const v = this.cornerH(Math.min(x, this.n), Math.min(z, this.n));
        sum += v;
        cnt++;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    return { avg: sum / cnt, min, max };
  }
}
