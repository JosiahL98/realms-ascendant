import type { Game } from './game';

/** Per-team visibility and exploration grids. Allied players share vision. */
export class Vision {
  private game: Game;
  readonly n: number;
  /** team -> visible grid (1 = currently seen) */
  visible = new Map<number, Uint8Array>();
  explored = new Map<number, Uint8Array>();
  private circles = new Map<number, Int16Array>();
  version = 0;

  constructor(game: Game) {
    this.game = game;
    this.n = game.map.n;
    for (const p of game.players) {
      if (p.isGaia) continue;
      if (!this.visible.has(p.team)) {
        this.visible.set(p.team, new Uint8Array(this.n * this.n));
        this.explored.set(p.team, new Uint8Array(this.n * this.n));
      }
    }
  }

  private circle(r: number): Int16Array {
    const key = Math.round(r * 2);
    let c = this.circles.get(key);
    if (!c) {
      const rr = key / 2;
      const offs: number[] = [];
      const R = Math.ceil(rr);
      for (let dz = -R; dz <= R; dz++)
        for (let dx = -R; dx <= R; dx++) if (dx * dx + dz * dz <= rr * rr + 0.5) offs.push(dx, dz);
      c = new Int16Array(offs);
      this.circles.set(key, c);
    }
    return c;
  }

  private stamp(vis: Uint8Array, exp: Uint8Array, x: number, z: number, r: number): void {
    const n = this.n;
    const cx = Math.floor(x), cz = Math.floor(z);
    const offs = this.circle(r);
    for (let i = 0; i < offs.length; i += 2) {
      const tx = cx + offs[i], tz = cz + offs[i + 1];
      if (tx < 0 || tz < 0 || tx >= n || tz >= n) continue;
      const k = tz * n + tx;
      vis[k] = 1;
      exp[k] = 1;
    }
  }

  update(initial: boolean): void {
    const g = this.game;
    const reveal = g.setup.reveal;
    for (const [team, vis] of this.visible) {
      const exp = this.explored.get(team)!;
      if (reveal === 'all') {
        vis.fill(1);
        exp.fill(1);
        continue;
      }
      if (initial && reveal === 'explored') exp.fill(1);
      vis.fill(0);
      for (const u of g.units) {
        if (!u.alive || u.garrisonedIn || u.owner === 0) continue;
        if (g.teamOf[u.owner] !== team) continue;
        this.stamp(vis, exp, u.x, u.z, u.stats.los);
      }
      for (const b of g.buildings) {
        if (!b.alive || b.owner === 0 || g.teamOf[b.owner] !== team) continue;
        const los = b.built ? b.stats.los : 2;
        this.stamp(vis, exp, b.x, b.z, los + Math.max(b.w, b.h) / 2);
      }
    }
    // Buildings remember being seen by teams
    const bit = (team: number) => 1 << (team & 15);
    for (const b of g.buildings) {
      if (!b.alive) continue;
      for (const [team, vis] of this.visible) {
        if (b.seenBy & bit(team)) continue;
        if (g.teamOf[b.owner] === team || vis[Math.floor(b.z) * this.n + Math.floor(b.x)] ||
          vis[b.tz * this.n + b.tx]) b.seenBy |= bit(team);
      }
    }
    this.version++;
  }

  isVisible(team: number, x: number, z: number): boolean {
    const vis = this.visible.get(team);
    if (!vis) return true;
    const tx = Math.floor(x), tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= this.n || tz >= this.n) return false;
    return vis[tz * this.n + tx] === 1;
  }

  isExplored(team: number, x: number, z: number): boolean {
    const exp = this.explored.get(team);
    if (!exp) return true;
    const tx = Math.floor(x), tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= this.n || tz >= this.n) return false;
    return exp[tz * this.n + tx] === 1;
  }

  static teamBit(team: number): number {
    return 1 << (team & 15);
  }
}
