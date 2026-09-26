import type { Unit } from './entities';

/** Uniform grid of units, rebuilt every tick with a counting sort. */
export class SpatialHash {
  readonly cell: number;
  readonly cols: number;
  private counts: Int32Array;
  private starts: Int32Array;
  private items: Unit[] = [];
  private tmpCell: Int32Array = new Int32Array(0);
  private fillArr: Int32Array;

  constructor(mapSize: number, cell = 2) {
    this.cell = cell;
    this.cols = Math.ceil(mapSize / cell);
    this.counts = new Int32Array(this.cols * this.cols);
    this.starts = new Int32Array(this.cols * this.cols + 1);
    this.fillArr = new Int32Array(this.cols * this.cols);
  }

  private cellOf(x: number, z: number): number {
    let cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    if (cx < 0) cx = 0;
    if (cz < 0) cz = 0;
    if (cx >= this.cols) cx = this.cols - 1;
    if (cz >= this.cols) cz = this.cols - 1;
    return cz * this.cols + cx;
  }

  rebuild(units: Unit[]): void {
    const counts = this.counts;
    counts.fill(0);
    if (this.tmpCell.length < units.length) this.tmpCell = new Int32Array(units.length * 2);
    let live = 0;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (!u.alive || u.garrisonedIn) {
        this.tmpCell[i] = -1;
        continue;
      }
      const c = this.cellOf(u.x, u.z);
      this.tmpCell[i] = c;
      counts[c]++;
      live++;
    }
    const starts = this.starts;
    let acc = 0;
    for (let c = 0; c < counts.length; c++) {
      starts[c] = acc;
      acc += counts[c];
    }
    starts[counts.length] = acc;
    if (this.items.length < live) this.items.length = live;
    const fill = this.fillArr;
    fill.fill(0);
    for (let i = 0; i < units.length; i++) {
      const c = this.tmpCell[i];
      if (c < 0) continue;
      this.items[starts[c] + fill[c]++] = units[i];
    }
  }

  /** Calls fn for each unit whose center lies within radius r of (x,z). */
  query(x: number, z: number, r: number, fn: (u: Unit, d2: number) => void): void {
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - r) / c)), x1 = Math.min(this.cols - 1, Math.floor((x + r) / c));
    const z0 = Math.max(0, Math.floor((z - r) / c)), z1 = Math.min(this.cols - 1, Math.floor((z + r) / c));
    const r2 = r * r;
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const ci = cz * this.cols + cx;
        const s = this.starts[ci], e = this.starts[ci + 1];
        for (let k = s; k < e; k++) {
          const u = this.items[k];
          const dx = u.x - x, dz = u.z - z;
          const d2 = dx * dx + dz * dz;
          if (d2 <= r2) fn(u, d2);
        }
      }
    }
  }

  /** Returns the best unit by score (lower is better) within radius; filter returns score or -1 to skip. */
  best(x: number, z: number, r: number, score: (u: Unit, d2: number) => number): Unit | null {
    let best: Unit | null = null;
    let bs = Infinity;
    this.query(x, z, r, (u, d2) => {
      const s = score(u, d2);
      if (s >= 0 && s < bs) {
        bs = s;
        best = u;
      }
    });
    return best;
  }
}
