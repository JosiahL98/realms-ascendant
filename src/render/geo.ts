import * as THREE from 'three';
import { RNG } from '../util/rng';

type V3 = [number, number, number];

const tmpV = new THREE.Vector3();
const tmpN = new THREE.Vector3();

/**
 * Immediate-mode builder for low-poly procedural models. Produces a non-indexed geometry with
 * per-vertex color and a 'matId' attribute selecting a detail texture.
 */
export class GeoBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private mat: number[] = [];
  private m = new THREE.Matrix4();
  private nm = new THREE.Matrix3();
  private stack: THREE.Matrix4[] = [];
  private color = new THREE.Color(1, 1, 1);
  private jitter = 0.05;
  private matId = 0;
  private rng: RNG;
  /** Darken vertices near the ground (fake ambient occlusion). */
  aoHeight = 0;

  constructor(seed = 1) {
    this.rng = new RNG(seed);
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  push(): this {
    this.stack.push(this.m.clone());
    return this;
  }
  pop(): this {
    this.m = this.stack.pop() ?? new THREE.Matrix4();
    return this;
  }
  translate(x: number, y: number, z: number): this {
    this.m.multiply(new THREE.Matrix4().makeTranslation(x, y, z));
    return this;
  }
  rotateX(a: number): this {
    this.m.multiply(new THREE.Matrix4().makeRotationX(a));
    return this;
  }
  rotateY(a: number): this {
    this.m.multiply(new THREE.Matrix4().makeRotationY(a));
    return this;
  }
  rotateZ(a: number): this {
    this.m.multiply(new THREE.Matrix4().makeRotationZ(a));
    return this;
  }
  scale(x: number, y: number, z: number): this {
    this.m.multiply(new THREE.Matrix4().makeScale(x, y, z));
    return this;
  }

  /** Set current color (sRGB hex) and per-face brightness jitter. */
  c(hex: number, jitter = 0.05): this {
    this.color.setHex(hex);
    this.jitter = jitter;
    return this;
  }
  /** Set current detail material id. */
  mt(id: number): this {
    this.matId = id;
    return this;
  }

  private faceColor(): [number, number, number] {
    const k = 1 + (this.rng.next() - 0.5) * 2 * this.jitter;
    return [this.color.r * k, this.color.g * k, this.color.b * k];
  }

  private emit(p: V3, n: V3, c: [number, number, number]): void {
    tmpV.set(p[0], p[1], p[2]).applyMatrix4(this.m);
    this.nm.getNormalMatrix(this.m);
    tmpN.set(n[0], n[1], n[2]).applyMatrix3(this.nm).normalize();
    this.pos.push(tmpV.x, tmpV.y, tmpV.z);
    this.nor.push(tmpN.x, tmpN.y, tmpN.z);
    this.col.push(c[0], c[1], c[2]);
    this.mat.push(this.matId);
  }

  tri(a: V3, b: V3, c: V3, na?: V3, nb?: V3, nc?: V3, color?: [number, number, number]): this {
    const col = color ?? this.faceColor();
    if (!na) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      na = nb = nc = [nx, ny, nz];
    }
    this.emit(a, na, col);
    this.emit(b, nb!, col);
    this.emit(c, nc!, col);
    return this;
  }

  /** Quad a-b-c-d counter-clockwise seen from the front. */
  quad(a: V3, b: V3, c: V3, d: V3): this {
    const col = this.faceColor();
    this.tri(a, b, c, undefined, undefined, undefined, col);
    this.tri(a, c, d, undefined, undefined, undefined, col);
    return this;
  }

  /** Axis-aligned box with bottom-center at (x,y,z). */
  box(x: number, y: number, z: number, w: number, h: number, d: number, faces = 0b111111): this {
    const x0 = x - w / 2, x1 = x + w / 2, y0 = y, y1 = y + h, z0 = z - d / 2, z1 = z + d / 2;
    if (faces & 1) this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]); // top
    if (faces & 2) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); // bottom
    if (faces & 4) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); // +z
    if (faces & 8) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]); // -z
    if (faces & 16) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]); // +x
    if (faces & 32) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]); // -x
    return this;
  }

  /** Box centered at (x,y,z). */
  boxC(x: number, y: number, z: number, w: number, h: number, d: number): this {
    return this.box(x, y - h / 2, z, w, h, d);
  }

  /** Frustum/cylinder with bottom center at (x,y,z). */
  cyl(x: number, y: number, z: number, rb: number, rt: number, h: number, seg = 8, opts: { top?: boolean; bottom?: boolean; smooth?: boolean; rot?: number } = {}): this {
    const top = opts.top ?? true, bottom = opts.bottom ?? false, smooth = opts.smooth ?? true;
    const rot = opts.rot ?? 0;
    const slope = (rb - rt) / h;
    for (let i = 0; i < seg; i++) {
      const a0 = rot + (i / seg) * Math.PI * 2, a1 = rot + ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const p00: V3 = [x + c0 * rb, y, z + s0 * rb], p01: V3 = [x + c1 * rb, y, z + s1 * rb];
      const p10: V3 = [x + c0 * rt, y + h, z + s0 * rt], p11: V3 = [x + c1 * rt, y + h, z + s1 * rt];
      if (smooth) {
        const nl = Math.hypot(1, slope);
        const n0: V3 = [c0 / nl, slope / nl, s0 / nl], n1: V3 = [c1 / nl, slope / nl, s1 / nl];
        const col = this.faceColor();
        if (rt > 1e-5) {
          this.tri(p00, p10, p11, n0, n0, n1, col);
          this.tri(p00, p11, p01, n0, n1, n1, col);
        } else this.tri(p00, p10, p01, n0, [0, 1, 0], n1, col);
      } else {
        if (rt > 1e-5) this.quad(p00, p10, p11, p01);
        else this.tri(p00, p10, p01);
      }
      if (top && rt > 1e-5) this.tri([x, y + h, z], p11, p10);
      if (bottom) this.tri([x, y, z], p00, p01);
    }
    return this;
  }

  cone(x: number, y: number, z: number, r: number, h: number, seg = 8, smooth = true): this {
    return this.cyl(x, y, z, r, 0, h, seg, { top: false, bottom: false, smooth });
  }

  /** Ellipsoid centered at (x,y,z). */
  sphere(x: number, y: number, z: number, r: number, wSeg = 8, hSeg = 6, sx = 1, sy = 1, sz = 1, flat = false): this {
    const pt = (i: number, j: number): { p: V3; n: V3 } => {
      const th = (i / wSeg) * Math.PI * 2, ph = (j / hSeg) * Math.PI;
      const nx = Math.sin(ph) * Math.cos(th), ny = Math.cos(ph), nz = Math.sin(ph) * Math.sin(th);
      return { p: [x + nx * r * sx, y + ny * r * sy, z + nz * r * sz], n: [nx / sx, ny / sy, nz / sz] };
    };
    for (let j = 0; j < hSeg; j++)
      for (let i = 0; i < wSeg; i++) {
        const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
        const col = this.faceColor();
        if (flat) {
          if (j !== 0) this.tri(a.p, b.p, c.p, undefined, undefined, undefined, col);
          if (j !== hSeg - 1) this.tri(a.p, c.p, d.p, undefined, undefined, undefined, col);
        } else {
          if (j !== 0) this.tri(a.p, b.p, c.p, a.n, b.n, c.n, col);
          if (j !== hSeg - 1) this.tri(a.p, c.p, d.p, a.n, c.n, d.n, col);
        }
      }
    return this;
  }

  /** Irregular blob (low-poly rock/foliage) centered at (x,y,z). */
  blob(x: number, y: number, z: number, r: number, rough = 0.2, sy = 1, seg = 7): this {
    const hSeg = Math.max(3, Math.round(seg * 0.7));
    const grid: V3[][] = [];
    for (let j = 0; j <= hSeg; j++) {
      const row: V3[] = [];
      for (let i = 0; i <= seg; i++) {
        const th = (i / seg) * Math.PI * 2, ph = (j / hSeg) * Math.PI;
        const k = 1 + (i === seg ? 0 : (this.rng.next() - 0.5) * 2 * rough);
        row.push([Math.sin(ph) * Math.cos(th) * r * k, Math.cos(ph) * r * sy * k, Math.sin(ph) * Math.sin(th) * r * k]);
      }
      row[seg] = row[0];
      grid.push(row);
    }
    for (let i = 0; i <= seg; i++) {
      grid[0][i] = grid[0][0];
      grid[hSeg][i] = grid[hSeg][0];
    }
    const off = (p: V3): V3 => [p[0] + x, p[1] + y, p[2] + z];
    for (let j = 0; j < hSeg; j++)
      for (let i = 0; i < seg; i++) {
        const a = off(grid[j][i]), b = off(grid[j][i + 1]), c = off(grid[j + 1][i + 1]), d = off(grid[j + 1][i]);
        if (j !== 0) this.tri(a, b, c);
        if (j !== hSeg - 1) this.tri(a, c, d);
      }
    return this;
  }

  /** Gable roof: base rectangle w (x) by d (z) at height y, ridge along x at y+h, with overhang. */
  gable(x: number, y: number, z: number, w: number, h: number, d: number, over = 0.08, gableColor?: number): this {
    const x0 = x - w / 2 - over, x1 = x + w / 2 + over, z0 = z - d / 2 - over, z1 = z + d / 2 + over;
    const yr = y + h;
    this.quad([x0, y, z1], [x1, y, z1], [x1, yr, z], [x0, yr, z]);
    this.quad([x1, y, z0], [x0, y, z0], [x0, yr, z], [x1, yr, z]);
    // gable ends (wall color if given)
    const saved = this.color.clone();
    const savedMat = this.matId;
    if (gableColor !== undefined) {
      this.color.setHex(gableColor);
      this.matId = 0;
    }
    const gx0 = x - w / 2, gx1 = x + w / 2;
    this.tri([gx1, y, z1 - over], [gx1, y, z0 + over], [gx1, yr - 0.02, z]);
    this.tri([gx0, y, z0 + over], [gx0, y, z1 - over], [gx0, yr - 0.02, z]);
    this.color.copy(saved);
    this.matId = savedMat;
    // underside
    this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]);
    return this;
  }

  /** Hip roof with ridge along the longer axis. */
  hip(x: number, y: number, z: number, w: number, h: number, d: number, over = 0.08): this {
    const x0 = x - w / 2 - over, x1 = x + w / 2 + over, z0 = z - d / 2 - over, z1 = z + d / 2 + over;
    const yr = y + h;
    if (w >= d) {
      const r = (w - d) / 2;
      const ra: V3 = [x - r, yr, z], rb: V3 = [x + r, yr, z];
      this.quad([x0, y, z1], [x1, y, z1], rb, ra);
      this.quad([x1, y, z0], [x0, y, z0], ra, rb);
      this.tri([x1, y, z1], [x1, y, z0], rb);
      this.tri([x0, y, z0], [x0, y, z1], ra);
    } else {
      const r = (d - w) / 2;
      const ra: V3 = [x, yr, z - r], rb: V3 = [x, yr, z + r];
      this.quad([x1, y, z1], [x1, y, z0], ra, rb);
      this.quad([x0, y, z0], [x0, y, z1], rb, ra);
      this.tri([x0, y, z1], [x1, y, z1], rb);
      this.tri([x1, y, z0], [x0, y, z0], ra);
    }
    this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]);
    return this;
  }

  /** Curved pagoda-style roof with upturned eaves. */
  pagoda(x: number, y: number, z: number, w: number, h: number, d: number, over = 0.35, lift = 0.18): this {
    const segs = 3;
    const x0 = x - w / 2 - over, x1 = x + w / 2 + over, z0 = z - d / 2 - over, z1 = z + d / 2 + over;
    const cx0 = x - w * 0.12, cx1 = x + w * 0.12, cz0 = z - d * 0.12, cz1 = z + d * 0.12;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    // concave profile: height as a function of t (0=eave, 1=ridge)
    const prof = (t: number) => y + h * Math.pow(t, 1.6) + lift * (1 - t) * (1 - t) * 0.0;
    for (let s = 0; s < segs; s++) {
      const t0 = s / segs, t1 = (s + 1) / segs;
      const y0 = prof(t0) + (s === 0 ? lift : 0), y1 = prof(t1);
      const r0 = [lerp(x0, cx0, t0), lerp(x1, cx1, t0), lerp(z0, cz0, t0), lerp(z1, cz1, t0)];
      const r1 = [lerp(x0, cx0, t1), lerp(x1, cx1, t1), lerp(z0, cz0, t1), lerp(z1, cz1, t1)];
      this.quad([r0[0], y0, r0[3]], [r0[1], y0, r0[3]], [r1[1], y1, r1[3]], [r1[0], y1, r1[3]]);
      this.quad([r0[1], y0, r0[2]], [r0[0], y0, r0[2]], [r1[0], y1, r1[2]], [r1[1], y1, r1[2]]);
      this.quad([r0[1], y0, r0[3]], [r0[1], y0, r0[2]], [r1[1], y1, r1[2]], [r1[1], y1, r1[3]]);
      this.quad([r0[0], y0, r0[2]], [r0[0], y0, r0[3]], [r1[0], y1, r1[3]], [r1[0], y1, r1[2]]);
    }
    const yt = prof(1);
    this.quad([cx0, yt, cz0], [cx0, yt, cz1], [cx1, yt, cz1], [cx1, yt, cz0]);
    this.quad([x0, y + lift, z0], [x1, y + lift, z0], [x1, y + lift, z1], [x0, y + lift, z1]);
    return this;
  }

  /** Dome (half ellipsoid) with base center at (x,y,z). */
  dome(x: number, y: number, z: number, r: number, h: number, seg = 10): this {
    const hs = Math.max(3, Math.round(seg / 2.5));
    for (let j = 0; j < hs; j++)
      for (let i = 0; i < seg; i++) {
        const p = (ii: number, jj: number): { p: V3; n: V3 } => {
          const th = (ii / seg) * Math.PI * 2, ph = (jj / hs) * (Math.PI / 2);
          const nx = Math.cos(ph) * Math.cos(th), ny = Math.sin(ph), nz = Math.cos(ph) * Math.sin(th);
          return { p: [x + nx * r, y + ny * h, z + nz * r], n: [nx / r, ny / h, nz / r] };
        };
        const a = p(i, j), b = p(i + 1, j), c = p(i + 1, j + 1), d = p(i, j + 1);
        const col = this.faceColor();
        this.tri(a.p, c.p, b.p, a.n, c.n, b.n, col);
        if (j !== hs - 1) this.tri(a.p, d.p, c.p, a.n, d.n, c.n, col);
      }
    return this;
  }

  /** Flat disc (e.g. ground decals) at height y. */
  disc(x: number, y: number, z: number, r: number, seg = 12): this {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      this.tri([x, y, z], [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r], [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r]);
    }
    return this;
  }

  /** Flat horizontal quad (w along x, d along z) at height y. */
  plane(x: number, y: number, z: number, w: number, d: number): this {
    return this.quad([x - w / 2, y, z - d / 2], [x - w / 2, y, z + d / 2], [x + w / 2, y, z + d / 2], [x + w / 2, y, z - d / 2]);
  }

  /** Crenellated parapet around a rectangle at height y. */
  crenels(x: number, y: number, z: number, w: number, d: number, size = 0.14, thick = 0.12): this {
    const step = size * 2;
    const nx = Math.max(2, Math.round(w / step)), nz = Math.max(2, Math.round(d / step));
    for (let i = 0; i < nx; i++) {
      const px = x - w / 2 + (i + 0.5) * (w / nx);
      this.box(px, y, z - d / 2 + thick / 2, (w / nx) * 0.55, size, thick);
      this.box(px, y, z + d / 2 - thick / 2, (w / nx) * 0.55, size, thick);
    }
    for (let i = 0; i < nz; i++) {
      const pz = z - d / 2 + (i + 0.5) * (d / nz);
      this.box(x - w / 2 + thick / 2, y, pz, thick, size, (d / nz) * 0.55);
      this.box(x + w / 2 - thick / 2, y, pz, thick, size, (d / nz) * 0.55);
    }
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const col = new Float32Array(this.col);
    if (this.aoHeight > 0) {
      for (let i = 0; i < this.pos.length / 3; i++) {
        const y = this.pos[i * 3 + 1];
        const k = 0.62 + 0.38 * Math.min(1, Math.max(0, y / this.aoHeight));
        col[i * 3] *= k;
        col[i * 3 + 1] *= k;
        col[i * 3 + 2] *= k;
      }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('matId', new THREE.Float32BufferAttribute(this.mat, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  isEmpty(): boolean {
    return this.pos.length === 0;
  }
}

/** Merge geometries built by GeoBuilder (same attributes). */
export function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const attrs = ['position', 'normal', 'color', 'matId'];
  const sizes = [3, 3, 3, 1];
  const out = new THREE.BufferGeometry();
  attrs.forEach((a, ai) => {
    let total = 0;
    for (const g of geos) total += (g.getAttribute(a)?.count ?? 0) * sizes[ai];
    const arr = new Float32Array(total);
    let off = 0;
    for (const g of geos) {
      const at = g.getAttribute(a) as THREE.BufferAttribute | undefined;
      if (!at) continue;
      arr.set(at.array as Float32Array, off);
      off += at.count * sizes[ai];
    }
    out.setAttribute(a, new THREE.BufferAttribute(arr, sizes[ai]));
  });
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}
