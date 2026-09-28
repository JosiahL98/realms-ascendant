import { MinHeap } from '../util/heap';
import type { GameMap } from './map';

export interface PathGoal {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Allowed distance from the rect. */
  range: number;
}

const SQRT2 = Math.SQRT2;
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const COST = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2];

export class Pathfinder {
  private map: GameMap;
  private teamOf: Int8Array;
  private g: Float32Array;
  private parent: Int32Array;
  private seen: Uint32Array;
  private closed: Uint32Array;
  private gen = 1;
  private heap: MinHeap;
  /**
   * Tiles where units stand still (working, fighting, waiting), stamped for one search by a unit that got stuck in a
   * crowd: A* makes them costly and the path is not straightened through them, so it goes round.
   */
  private crowd: Uint8Array;
  private crowdOn = false;
  private crowdTiles: number[] = [];
  /** Statistics */
  searches = 0;
  expanded = 0;

  constructor(map: GameMap, teamOf: Int8Array) {
    this.map = map;
    this.teamOf = teamOf;
    const N = map.n * map.n;
    this.g = new Float32Array(N);
    this.parent = new Int32Array(N);
    this.seen = new Uint32Array(N);
    this.closed = new Uint32Array(N);
    this.heap = new MinHeap(4096);
    this.crowd = new Uint8Array(N);
  }

  /** Marks the tiles of standing units (world positions) as crowded for the next search. */
  setCrowd(points: number[]): void {
    this.clearCrowd();
    const n = this.map.n;
    for (let i = 0; i < points.length; i += 2) {
      const x = Math.floor(points[i]), z = Math.floor(points[i + 1]);
      if (x < 0 || z < 0 || x >= n || z >= n) continue;
      const k = z * n + x;
      if (!this.crowd[k]) {
        this.crowd[k] = 1;
        this.crowdTiles.push(k);
      }
    }
    this.crowdOn = this.crowdTiles.length > 0;
  }

  clearCrowd(): void {
    for (const k of this.crowdTiles) this.crowd[k] = 0;
    this.crowdTiles.length = 0;
    this.crowdOn = false;
  }

  /** When true, passability is evaluated for ships. */
  private naval = false;

  setDomain(naval: boolean): this {
    this.naval = naval;
    return this;
  }

  private pass(x: number, z: number, team: number): boolean {
    const m = this.map;
    if (x < 0 || z < 0 || x >= m.n || z >= m.n) return false;
    const i = z * m.n + x;
    if (this.naval) return m.navalBlocked[i] === 0;
    if (m.landBlocked[i] === 0) return true;
    const go = m.gateOwner[i];
    return go >= 0 && this.teamOf[go] === team;
  }

  /** True when a unit can walk the straight segment (with a little clearance). */
  lineClear(ax: number, az: number, bx: number, bz: number, team: number, clearance = 0.18): boolean {
    if (!this.traverse(ax, az, bx, bz, team)) return false;
    if (clearance <= 0) return true;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return true;
    const nx = (-dz / len) * clearance, nz = (dx / len) * clearance;
    return this.traverse(ax + nx, az + nz, bx + nx, bz + nz, team) && this.traverse(ax - nx, az - nz, bx - nx, bz - nz, team);
  }

  /** Amanatides–Woo grid traversal; checks every tile the segment touches. */
  private traverse(ax: number, az: number, bx: number, bz: number, team: number): boolean {
    let x = Math.floor(ax), z = Math.floor(az);
    const ex = Math.floor(bx), ez = Math.floor(bz);
    const startBlocked = !this.pass(x, z, team);
    const dx = bx - ax, dz = bz - az;
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - ax : ax - x) * tDeltaX : Infinity;
    let tMaxZ = dz !== 0 ? (dz > 0 ? z + 1 - az : az - z) * tDeltaZ : Infinity;
    let guard = 0;
    let leftStart = !startBlocked;
    while (x !== ex || z !== ez) {
      if (++guard > 2000) return false;
      if (Math.abs(tMaxX - tMaxZ) < 1e-9) {
        // passing exactly through a corner: both neighbours must be free
        if (!this.pass(x + stepX, z, team) || !this.pass(x, z + stepZ, team)) {
          if (leftStart) return false;
        }
        x += stepX;
        z += stepZ;
        tMaxX += tDeltaX;
        tMaxZ += tDeltaZ;
      } else if (tMaxX < tMaxZ) {
        x += stepX;
        tMaxX += tDeltaX;
      } else {
        z += stepZ;
        tMaxZ += tDeltaZ;
      }
      if (!this.pass(x, z, team)) {
        // allow escaping from a blocked start region
        if (leftStart) return false;
      } else leftStart = true;
      if (this.crowdOn && this.crowd[z * this.map.n + x] && (x !== ex || z !== ez)) return false;
    }
    return true;
  }

  /**
   * A* from world position to goal. Returns flat [x0,z0,x1,z1,...] waypoints (excluding the start),
   * or null if nothing useful. If the goal is unreachable, returns a path to the closest reachable tile.
   */
  findPath(sx: number, sz: number, goal: PathGoal, team: number, maxNodes = 30000): { path: number[]; reached: boolean } {
    const m = this.map;
    const n = m.n;
    this.searches++;
    const gx = (goal.x0 + goal.x1) / 2, gz = (goal.z0 + goal.z1) / 2;
    const isPoint = goal.x1 - goal.x0 < 1e-6 && goal.z1 - goal.z0 < 1e-6 && goal.range < 0.01;

    // Fast path: direct line (not when going round a crowd: the direct line is what was blocked).
    const cx = Math.min(Math.max(sx, goal.x0 - goal.range), goal.x1 + goal.range);
    const cz = Math.min(Math.max(sz, goal.z0 - goal.range), goal.z1 + goal.range);
    if (this.crowdOn) {
      // go on to A*
    } else if (isPoint) {
      if (this.pass(Math.floor(gx), Math.floor(gz), team) && this.lineClear(sx, sz, gx, gz, team)) {
        return { path: [gx, gz], reached: true };
      }
    } else if (this.lineClear(sx, sz, cx, cz, team) && this.pass(Math.floor(cx), Math.floor(cz), team)) {
      return { path: [cx, cz], reached: true };
    }

    let stx = Math.min(n - 1, Math.max(0, Math.floor(sx)));
    let stz = Math.min(n - 1, Math.max(0, Math.floor(sz)));
    const gen = ++this.gen;
    if (gen >= 0xfffffff0) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.gen = 1;
    }
    const heap = this.heap;
    heap.clear();
    const startIdx = stz * n + stx;
    this.g[startIdx] = 0;
    this.parent[startIdx] = -1;
    this.seen[startIdx] = gen;
    const tol = goal.range + 0.75;
    const h = (x: number, z: number): number => {
      const px = x + 0.5, pz = z + 0.5;
      const ddx = Math.max(goal.x0 - goal.range - px, 0, px - goal.x1 - goal.range);
      const ddz = Math.max(goal.z0 - goal.range - pz, 0, pz - goal.z1 - goal.range);
      const mn = Math.min(ddx, ddz), mx = Math.max(ddx, ddz);
      return mx + (SQRT2 - 1) * mn;
    };
    const isGoal = (x: number, z: number): boolean => {
      const px = x + 0.5, pz = z + 0.5;
      const ddx = px < goal.x0 ? goal.x0 - px : px > goal.x1 ? px - goal.x1 : 0;
      const ddz = pz < goal.z0 ? goal.z0 - pz : pz > goal.z1 ? pz - goal.z1 : 0;
      return ddx * ddx + ddz * ddz <= tol * tol;
    };
    heap.push(startIdx, h(stx, stz) * 1.001);
    let best = startIdx, bestH = h(stx, stz);
    let found = -1;
    let expanded = 0;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      const x = cur % n, z = (cur / n) | 0;
      if (isGoal(x, z) && (cur !== startIdx || this.pass(x, z, team))) {
        found = cur;
        break;
      }
      if (++expanded > maxNodes) break;
      const gc = this.g[cur];
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d], nz = z + DZ[d];
        if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
        if (!this.pass(nx, nz, team)) continue;
        if (d >= 4 && (!this.pass(x + DX[d], z, team) || !this.pass(x, z + DZ[d], team))) continue;
        const ni = nz * n + nx;
        if (this.closed[ni] === gen) continue;
        const ng = gc + COST[d] + (this.crowdOn && this.crowd[ni] ? 3 : 0);
        if (this.seen[ni] !== gen || ng < this.g[ni]) {
          this.seen[ni] = gen;
          this.g[ni] = ng;
          this.parent[ni] = cur;
          const hh = h(nx, nz);
          if (hh < bestH) {
            bestH = hh;
            best = ni;
          }
          heap.push(ni, ng + hh * 1.001);
        }
      }
    }
    this.expanded += expanded;
    const endIdx = found >= 0 ? found : best;
    const reached = found >= 0;
    // Reconstruct
    const tiles: number[] = [];
    let c = endIdx;
    while (c !== -1 && c !== startIdx) {
      tiles.push(c);
      c = this.parent[c];
    }
    tiles.reverse();
    const pts: number[] = [];
    for (const t of tiles) pts.push((t % n) + 0.5, ((t / n) | 0) + 0.5);
    // Append precise end point.
    if (reached) {
      if (isPoint) {
        if (this.pass(Math.floor(gx), Math.floor(gz), team)) pts.push(gx, gz);
      }
    }
    if (pts.length === 0) return { path: [], reached };
    return { path: this.smooth(sx, sz, pts, team), reached };
  }

  private smooth(sx: number, sz: number, pts: number[], team: number): number[] {
    const out: number[] = [];
    let ax = sx, az = sz;
    let i = 0;
    const count = pts.length / 2;
    while (i < count) {
      // advance j as far as the straight line stays clear
      let j = i;
      while (j + 1 < count && this.lineClear(ax, az, pts[(j + 1) * 2], pts[(j + 1) * 2 + 1], team)) j++;
      out.push(pts[j * 2], pts[j * 2 + 1]);
      ax = pts[j * 2];
      az = pts[j * 2 + 1];
      i = j + 1;
    }
    return out;
  }

  /** Nearest passable tile center to (x,z) by spiral search. */
  nearestPassable(x: number, z: number, team: number, maxR = 12): { x: number; z: number } | null {
    const tx = Math.floor(x), tz = Math.floor(z);
    if (this.pass(tx, tz, team)) return { x, z };
    for (let r = 1; r <= maxR; r++) {
      let best: { x: number; z: number } | null = null;
      let bd = Infinity;
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (!this.pass(tx + dx, tz + dz, team)) continue;
          const cx = tx + dx + 0.5, cz = tz + dz + 0.5;
          const d = (cx - x) ** 2 + (cz - z) ** 2;
          if (d < bd) {
            bd = d;
            best = { x: cx, z: cz };
          }
        }
      if (best) return best;
    }
    return null;
  }

  isPassable(x: number, z: number, team: number): boolean {
    return this.pass(Math.floor(x), Math.floor(z), team);
  }
}
