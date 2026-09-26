import * as THREE from 'three';
import { RNG } from '../../util/rng';
import { GeoBuilder } from '../geo';

/**
 * Foliage built from alpha-tested "cards" textured with painted leaf clumps and grass tufts.
 * The atlas is 4x2 tiles (row 0 is the top of the image, the texture is not flipped):
 * [0] broadleaf, [1] pine needles, [2] palm frond, [3] small silvery leaves (olive),
 * [4] green grass, [5] dry grass, [6] flowering grass, [7] reeds. Grass tiles grow up from their bottom edge.
 */
export const LEAF_BROAD = 0;
export const LEAF_NEEDLE = 1;
export const LEAF_FROND = 2;
export const LEAF_SMALL = 3;
export const GRASS_GREEN = 4;
export const GRASS_DRY = 5;
export const GRASS_FLOWERS = 6;
export const REEDS = 7;

const TILE = 256;
const COLS = 4;
const ROWS = 2;
/** Size of one tile in UV space. */
const DU = 1 / COLS;
const DV = 1 / ROWS;

function tileOrigin(k: number): [number, number] {
  return [(k % COLS) * DU, Math.floor(k / COLS) * DV];
}

/** A tuft of blades growing from the bottom centre of the tile. */
function paintTuft(ctx: CanvasRenderingContext2D, ox: number, oy: number, S: number, rng: RNG, kind: number): void {
  ctx.lineCap = 'round';
  const base = oy + S - 3;
  const reeds = kind === REEDS;
  const blades = reeds ? 26 : kind === GRASS_FLOWERS ? 34 : 46;
  const tips: [number, number][] = [];
  for (let i = 0; i < blades; i++) {
    const x0 = ox + S / 2 + rng.range(-0.22, 0.22) * S;
    const h = (reeds ? rng.range(0.6, 0.97) : rng.range(0.35, 0.9)) * S;
    const lean = rng.range(-0.35, 0.35) * (reeds ? 0.35 : 1) + (x0 - (ox + S / 2)) / S;
    const x1 = x0 + lean * h * 0.6, y1 = base - h;
    let r: number, g: number, b: number;
    if (kind === GRASS_DRY) {
      const dry = rng.next();
      r = 150 + dry * 40; g = 128 + dry * 30; b = 70 + dry * 20;
      if (rng.chance(0.25)) { r = 104; g = 118; b = 56; }
    } else if (reeds) {
      r = 78 + rng.int(-10, 12); g = 104 + rng.int(-12, 14); b = 52 + rng.int(-8, 8);
    } else {
      r = 86 + rng.int(-12, 16); g = 120 + rng.int(-16, 20); b = 42 + rng.int(-8, 10);
    }
    // blade: a tapered curve, darker at the root
    const w = (reeds ? 4.2 : 3.4) * rng.range(0.8, 1.2);
    const cxm = x0 + lean * h * 0.15, cym = base - h * 0.55;
    ctx.fillStyle = `rgb(${Math.round(r * 0.62)},${Math.round(g * 0.62)},${Math.round(b * 0.62)})`;
    ctx.beginPath();
    ctx.moveTo(x0 - w, base);
    ctx.quadraticCurveTo(cxm - w * 0.6, cym, x1, y1);
    ctx.quadraticCurveTo(cxm + w * 0.6, cym, x0 + w, base);
    ctx.fill();
    // lit upper part
    ctx.strokeStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
    ctx.lineWidth = w * 0.7;
    ctx.beginPath();
    ctx.moveTo(cxm, cym + h * 0.1);
    ctx.quadraticCurveTo((cxm + x1) / 2 - lean * 4, (cym + y1) / 2, x1, y1 + 2);
    ctx.stroke();
    tips.push([x1, y1]);
  }
  if (kind === GRASS_FLOWERS) {
    const cols = ['#f4f0e0', '#f2d23a', '#b87ad8', '#e8e4f0', '#d84a3a'];
    for (let i = 0; i < 14; i++) {
      const [x, y] = tips[rng.int(0, tips.length - 1)];
      ctx.fillStyle = cols[rng.int(0, cols.length - 1)];
      for (let p = 0; p < 5; p++) {
        const a = (p / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * 4.5, y + Math.sin(a) * 4.5, 3.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#e8b020';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (reeds) {
    // cattails
    for (let i = 0; i < 5; i++) {
      const x = ox + S / 2 + rng.range(-0.18, 0.18) * S, top = oy + rng.range(0.05, 0.3) * S;
      ctx.strokeStyle = 'rgb(92,110,60)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.lineTo(x, top);
      ctx.stroke();
      ctx.fillStyle = 'rgb(104,68,36)';
      ctx.beginPath();
      ctx.ellipse(x, top + 22, 6, 20, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function paintLeafClump(ctx: CanvasRenderingContext2D, ox: number, oy: number, S: number, rng: RNG, kind: number): void {
  const cx = ox + S / 2, cy = oy + S / 2;
  if (kind === LEAF_FROND) {
    // palm frond: a stem running from the top (base) to the bottom (tip) with leaflets angled towards the tip
    ctx.lineCap = 'round';
    for (let i = 0; i < 46; i++) {
      const t = i / 46;
      const y = oy + S * 0.03 + t * S * 0.9;
      const len = S * 0.44 * Math.sin(Math.PI * Math.min(1, 0.08 + t * 1.05)) + 5;
      for (const side of [-1, 1]) {
        const g = 106 + rng.int(-18, 22);
        ctx.strokeStyle = rng.chance(0.06) ? `rgb(${138 + rng.int(-10, 10)},${124 + rng.int(-10, 10)},66)`
          : `rgb(${68 + rng.int(-10, 14)},${g},${40 + rng.int(-8, 10)})`;
        ctx.lineWidth = 3.2 + rng.next() * 2;
        ctx.beginPath();
        ctx.moveTo(cx, y);
        ctx.quadraticCurveTo(cx + side * len * 0.5, y + 5, cx + side * len, y + 18 + t * 10);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgb(104,90,48)';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(cx, oy + 2);
    ctx.lineTo(cx, oy + S - 6);
    ctx.stroke();
    return;
  }
  if (kind === LEAF_NEEDLE) {
    // conifer: dense bundles of needles with bristly edges, lighter towards the top-left
    ctx.lineCap = 'round';
    const R = S * 0.38;
    for (let i = 0; i < 80; i++) {
      const a = rng.range(0, Math.PI * 2), r = Math.pow(rng.next(), 0.7) * R;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      const lit = 0.72 + ((cx - x) + (cy - y)) / (S * 1.3) + rng.range(-0.08, 0.1);
      const col = (k: number) => `rgb(${Math.round(46 * lit * k)},${Math.round(90 * lit * k)},${Math.round(56 * lit * k)})`;
      ctx.fillStyle = col(0.82);
      ctx.beginPath();
      ctx.arc(x, y, rng.range(7, 13), 0, Math.PI * 2);
      ctx.fill();
      for (let k = 0; k < 16; k++) {
        const b = rng.range(0, Math.PI * 2), l = rng.range(9, 20);
        ctx.strokeStyle = col(rng.range(0.88, 1.18));
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(b) * 3, y + Math.sin(b) * 3);
        ctx.lineTo(x + Math.cos(b) * l, y + Math.sin(b) * l);
        ctx.stroke();
      }
    }
    return;
  }
  // broadleaf / small leaves: many overlapping leaf ellipses, lighter towards the top-left rim
  const small = kind === LEAF_SMALL;
  const count = small ? 900 : 380;
  const size: [number, number] = small ? [4, 7.5] : [6, 12];
  const R = S * 0.46;
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = Math.pow(rng.next(), 0.55) * R;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    const lit = 0.66 + ((cx - x) + (cy - y)) / (S * 1.5) + (r / R) * 0.2 + rng.range(-0.12, 0.12);
    let rr: number, gg: number, bb: number;
    const pick = rng.next();
    if (small) {
      if (pick < 0.6) { rr = 100; gg = 122; bb = 84; } else { rr = 126; gg = 142; bb = 108; }
    } else if (pick < 0.45) { rr = 60; gg = 104; bb = 36; } else if (pick < 0.85) { rr = 80; gg = 122; bb = 44; } else { rr = 112; gg = 138; bb = 50; }
    ctx.fillStyle = `rgb(${Math.round(rr * lit)},${Math.round(gg * lit)},${Math.round(bb * lit)})`;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rng.range(0, Math.PI));
    const w = rng.range(size[0], size[1]);
    ctx.beginPath();
    ctx.ellipse(0, 0, w, w * 0.48, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!small && w > 8) {
      // midrib
      ctx.strokeStyle = 'rgba(30,50,20,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-w * 0.8, 0);
      ctx.lineTo(w * 0.8, 0);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/** 2x2 box filter (2x1 or 1x2 once a side reaches 1); colours are weighted by alpha so transparent texels do not darken the edges. */
function downsample(src: Uint8Array, w: number, h: number): Uint8Array {
  const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
  const sx = w > 1 ? 2 : 1, sy = h > 1 ? 2 : 1;
  const out = new Uint8Array(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let dy = 0; dy < sy; dy++) {
        for (let dx = 0; dx < sx; dx++) {
          const i = ((y * sy + dy) * w + x * sx + dx) * 4;
          const wt = src[i + 3] + 1;
          r += src[i] * wt;
          g += src[i + 1] * wt;
          b += src[i + 2] * wt;
          a += src[i + 3];
          wsum += wt;
        }
      }
      const o = (y * nw + x) * 4;
      out[o] = r / wsum;
      out[o + 1] = g / wsum;
      out[o + 2] = b / wsum;
      out[o + 3] = a / (sx * sy);
    }
  }
  return out;
}

function coverage(data: Uint8Array, w: number, x0: number, y0: number, q: number, scale: number): number {
  let n = 0;
  for (let y = y0; y < y0 + q; y++) {
    for (let x = x0; x < x0 + q; x++) if (data[(y * w + x) * 4 + 3] * scale >= 127.5) n++;
  }
  return n / (q * q);
}

/**
 * Alpha-tested foliage thins out in the smaller mip levels because averaging lowers alpha. Each tile's
 * alpha is scaled so the fraction of texels passing the test stays the same as in the full-size image.
 */
function preserveCoverage(data: Uint8Array, w: number, target: number[]): void {
  const q = w / COLS;
  for (let k = 0; k < COLS * ROWS; k++) {
    const x0 = (k % COLS) * q, y0 = Math.floor(k / COLS) * q;
    let lo = 1, hi = 6;
    for (let it = 0; it < 12; it++) {
      const mid = (lo + hi) / 2;
      if (coverage(data, w, x0, y0, q, mid) < target[k]) lo = mid;
      else hi = mid;
    }
    const s = (lo + hi) / 2;
    for (let y = y0; y < y0 + q; y++) {
      for (let x = x0; x < x0 + q; x++) {
        const i = (y * w + x) * 4 + 3;
        data[i] = Math.min(255, Math.round(data[i] * s));
      }
    }
  }
}

let atlas: THREE.DataTexture | null = null;

export function foliageAtlas(): THREE.DataTexture {
  if (atlas) return atlas;
  const S = TILE, W = S * COLS, H = S * ROWS;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, W, H);
  const rng = new RNG(4242);
  for (let k = 0; k < COLS * ROWS; k++) {
    const ox = (k % COLS) * S, oy = Math.floor(k / COLS) * S;
    if (k < GRASS_GREEN) paintLeafClump(ctx, ox, oy, S, rng, k);
    else paintTuft(ctx, ox, oy, S, rng, k);
  }
  const base = new Uint8Array(ctx.getImageData(0, 0, W, H).data);
  // give fully transparent texels the tile's mean leaf colour so filtering never pulls in black
  const target: number[] = [];
  for (let k = 0; k < COLS * ROWS; k++) {
    const x0 = (k % COLS) * S, y0 = Math.floor(k / COLS) * S;
    let r = 0, g = 0, b = 0, wsum = 0;
    for (let y = y0; y < y0 + S; y++) {
      for (let x = x0; x < x0 + S; x++) {
        const i = (y * W + x) * 4, a = base[i + 3];
        r += base[i] * a;
        g += base[i + 1] * a;
        b += base[i + 2] * a;
        wsum += a;
      }
    }
    wsum = Math.max(1, wsum);
    for (let y = y0; y < y0 + S; y++) {
      for (let x = x0; x < x0 + S; x++) {
        const i = (y * W + x) * 4;
        if (base[i + 3] < 4) {
          base[i] = r / wsum;
          base[i + 1] = g / wsum;
          base[i + 2] = b / wsum;
          base[i + 3] = 0;
        }
      }
    }
    target.push(coverage(base, W, x0, y0, S, 1));
  }
  const mipmaps: { data: Uint8Array; width: number; height: number }[] = [{ data: base, width: W, height: H }];
  let cur: Uint8Array = base, w = W, h = H;
  while (w > 1 || h > 1) {
    const next = downsample(cur, w, h);
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
    if (w / COLS >= 8) preserveCoverage(next, w, target);
    mipmaps.push({ data: next, width: w, height: h });
    cur = next;
  }
  const tex = new THREE.DataTexture(base, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.mipmaps = mipmaps;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  atlas = tex;
  return tex;
}

/** Direction towards the camera (30 degrees elevation, 45 degrees azimuth); cards lean towards it so canopies look full. */
const VIEW = new THREE.Vector3(Math.cos(Math.PI / 6) * Math.SQRT1_2, Math.sin(Math.PI / 6), Math.cos(Math.PI / 6) * Math.SQRT1_2);
const UP = new THREE.Vector3(0, 1, 0);
/** Keep samples 4 texels inside a tile so neighbouring tiles never bleed in. */
const INSET_U = 4 / (TILE * COLS);
const INSET_V = 4 / (TILE * ROWS);

interface CardSpec {
  c: THREE.Vector3;
  size: number;
  quad: number;
  /** Outward canopy normal used for lighting. */
  n: THREE.Vector3;
  shade: number;
  /** Lower the card's bottom edge (drooping pine branches). */
  droop?: number;
}

class CardBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];

  vert(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, shade: number): void {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.col.push(shade, shade, shade);
  }

  card(cd: CardSpec, rng: RNG): void {
    const f = cd.n.clone().multiplyScalar(0.55).add(VIEW).normalize();
    // tangent frame with a random roll around the facing direction
    const t0 = new THREE.Vector3().crossVectors(UP, f);
    if (t0.lengthSq() < 1e-4) t0.set(1, 0, 0);
    t0.normalize();
    const b0 = new THREE.Vector3().crossVectors(f, t0).normalize();
    const roll = rng.range(0, Math.PI * 2);
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const t = t0.clone().multiplyScalar(cr).addScaledVector(b0, sr);
    const b = b0.clone().multiplyScalar(cr).addScaledVector(t0, -sr);
    const h = cd.size / 2;
    const [u0, v0] = tileOrigin(cd.quad);
    const n = cd.n.clone().lerp(UP, 0.2).normalize();
    const corner = (sx: number, sy: number) => {
      const p = cd.c.clone().addScaledVector(t, sx * h).addScaledVector(b, sy * h);
      if (cd.droop && sy < 0) p.y -= cd.droop;
      return { p, u: u0 + (sx < 0 ? INSET_U : DU - INSET_U), v: v0 + (sy > 0 ? INSET_V : DV - INSET_V) };
    };
    const vs = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    for (const i of [0, 1, 2, 0, 2, 3]) this.vert(vs[i].p, n, vs[i].u, vs[i].v, cd.shade);
  }

  /**
   * A palm frond: a V-folded ribbon from `base` along the horizontal direction `dir`, arching up and then drooping.
   * The texture's stem runs down the middle of the frond tile.
   */
  frond(base: THREE.Vector3, dir: THREE.Vector3, len: number, width: number, arch: number, droop: number, shade: number): void {
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const segs = 4;
    const [u0, v0] = tileOrigin(LEAF_FROND);
    const uc = u0 + DU / 2;
    const spine: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const s = i / segs;
      spine.push(base.clone().addScaledVector(dir, len * s).addScaledVector(UP, arch * s - droop * s * s));
    }
    const fold = 0.35;
    const halfWidth = (s: number) => width * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, 0.1 + s * 1.02)));
    for (let i = 0; i < segs; i++) {
      const s0 = i / segs, s1 = (i + 1) / segs;
      const w0 = halfWidth(s0), w1 = halfWidth(s1);
      const va = v0 + INSET_V + (DV - 2 * INSET_V) * s0, vb = v0 + INSET_V + (DV - 2 * INSET_V) * s1;
      for (const sd of [-1, 1]) {
        const e0 = spine[i].clone().addScaledVector(side, sd * w0).addScaledVector(UP, -fold * w0);
        const e1 = spine[i + 1].clone().addScaledVector(side, sd * w1).addScaledVector(UP, -fold * w1);
        const ue = sd < 0 ? u0 + INSET_U : u0 + DU - INSET_U;
        const n = UP.clone().addScaledVector(side, sd * 0.35).addScaledVector(dir, 0.25).normalize();
        const quad = [
          { p: spine[i], u: uc, v: va },
          { p: e0, u: ue, v: va },
          { p: e1, u: ue, v: vb },
          { p: spine[i + 1], u: uc, v: vb },
        ];
        for (const k of [0, 1, 2, 0, 2, 3]) this.vert(quad[k].p, n, quad[k].u, quad[k].v, shade);
      }
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const SUN = new THREE.Vector3(-0.4, 0.8, 0.3).normalize();

/** Cards scattered over an ellipsoid canopy, biased towards its shell; inner and lower cards are darker. */
function canopy(out: CardSpec[], rng: RNG, center: THREE.Vector3, rad: THREE.Vector3, count: number, size: [number, number], quad: number): void {
  for (let i = 0; i < count; i++) {
    const u = rng.range(-0.85, 1), a = rng.range(0, Math.PI * 2);
    const s = Math.sqrt(1 - u * u);
    const r = 0.5 + Math.sqrt(rng.next()) * 0.5;
    const dir = new THREE.Vector3(s * Math.cos(a), u, s * Math.sin(a));
    const c = center.clone().add(new THREE.Vector3(dir.x * rad.x * r, dir.y * rad.y * r, dir.z * rad.z * r));
    const n = new THREE.Vector3(dir.x / rad.x, dir.y / rad.y, dir.z / rad.z).normalize();
    const shade = (0.72 + 0.28 * r) * (0.86 + 0.14 * (0.5 + 0.5 * n.dot(SUN))) * (0.9 + 0.1 * u) + rng.range(-0.04, 0.04);
    out.push({ c, n, size: rng.range(size[0], size[1]), quad, shade: Math.min(1.1, shade) });
  }
}

/** Trunk/branches (vertex-coloured, no texture) and leaf-card geometry for a tree variant. */
export function treeParts(variant: number, sub: number): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
  const rng = new RNG(1000 + variant * 37 + sub * 11);
  const g = new GeoBuilder(200 + variant * 17 + sub * 3);
  g.aoHeight = 0.5;
  const cards: CardSpec[] = [];
  const cb = new CardBuilder();
  switch (variant) {
    case 0: {
      // broadleaf oak: stout trunk forking into limbs that disappear into a lumpy crown
      const k = 0.92 + sub * 0.06;
      g.c(0x5b4028, 0.06).cyl(0, 0, 0, 0.12, 0.075, 1.15 * k, 7, { smooth: true });
      for (let i = 0; i < 4; i++) {
        g.push().translate(0, 0.8 * k + i * 0.07, 0).rotateY(i * 1.7 + sub).rotateZ(0.8).c(0x5b4028).cyl(0, 0, 0, 0.05, 0.025, 0.55, 5).pop();
      }
      const top = 1.5 * k;
      // dark core so gaps between cards show shadowed foliage rather than sky-lit ground
      g.c(0x2a4a1a, 0.12).blob(0, top, 0, 0.46 * k, 0.15, 0.8, 7);
      canopy(cards, rng, new THREE.Vector3(0, top, 0), new THREE.Vector3(0.7, 0.55, 0.7).multiplyScalar(k), 30, [0.55, 0.8], LEAF_BROAD);
      // a few sub-crowns make the silhouette lumpy
      for (let i = 0; i < 3; i++) {
        const a = i * 2.1 + sub * 1.3;
        canopy(cards, rng, new THREE.Vector3(Math.cos(a) * 0.42 * k, top - 0.15 + i * 0.12, Math.sin(a) * 0.42 * k),
          new THREE.Vector3(0.36, 0.32, 0.36).multiplyScalar(k), 7, [0.42, 0.6], LEAF_BROAD);
      }
      break;
    }
    case 1: {
      // pine: tall trunk with whorls of drooping needle branches narrowing to a spire
      const H = 2.35 + sub * 0.15;
      const tiers = 6 + (sub % 2);
      const topY = 0.5 + ((tiers - 1) / tiers) * (H - 0.75);
      g.c(0x4e3620, 0.05).cyl(0, 0, 0, 0.09, 0.03, topY + 0.12, 6);
      for (let ti = 0; ti < tiers; ti++) {
        const tt = ti / tiers;
        const y = 0.5 + tt * (H - 0.75);
        const R = 0.7 * (1 - tt * 0.8);
        g.c(0x1e3a24, 0.1).cyl(0, y - 0.22, 0, R * 0.62, R * 0.12, 0.5, 7, { top: false, bottom: true, rot: ti * 0.5 });
        const n = Math.max(4, 8 - ti);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + ti * 0.9 + rng.range(-0.25, 0.25);
          const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
          const c = new THREE.Vector3(dir.x * R * 0.55, y, dir.z * R * 0.55);
          const nrm = dir.clone().multiplyScalar(0.75).add(new THREE.Vector3(0, 0.65, 0)).normalize();
          cards.push({ c, n: nrm, size: R * 1.2 + 0.22, quad: LEAF_NEEDLE, shade: 0.74 + tt * 0.3 + rng.range(-0.05, 0.05), droop: 0.1 + R * 0.12 });
        }
      }
      cards.push({ c: new THREE.Vector3(0, topY + 0.2, 0), n: UP.clone(), size: 0.32, quad: LEAF_NEEDLE, shade: 1.05 });
      break;
    }
    case 2: {
      // palm: slender leaning trunk with a crown of arching fronds
      const lean = (0.05 + sub * 0.025) * 6, Ht = 1.8, segs = 7;
      for (let i = 0; i < segs; i++) {
        const s0 = i / segs, s1 = (i + 1) / segs;
        const x0 = lean * s0 * s0, y0 = Ht * s0, x1 = lean * s1 * s1, y1 = Ht * s1;
        const len = Math.hypot(x1 - x0, y1 - y0);
        g.push().translate(x0, y0, 0).rotateZ(-Math.atan2(x1 - x0, y1 - y0));
        g.c(i % 2 ? 0x8a6a42 : 0x7a5c38, 0.05).cyl(0, 0, 0, 0.08 - s0 * 0.02, 0.08 - s1 * 0.02, len + 0.02, 7);
        g.pop();
      }
      const x = lean;
      const top = new THREE.Vector3(x, 1.84, 0);
      g.c(0x5a3a1a, 0.1).sphere(x + 0.06, 1.76, 0, 0.06, 5, 4).sphere(x - 0.05, 1.74, 0.04, 0.06, 5, 4);
      const fronds = 9;
      for (let i = 0; i < fronds; i++) {
        const a = (i / fronds) * Math.PI * 2 + sub + rng.range(-0.15, 0.15);
        const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        const young = i % 3 === 0;
        cb.frond(top, dir, young ? 0.8 : 1.0, 0.2, young ? 0.4 : 0.32, young ? 0.35 : 0.62, 0.92 + rng.range(-0.06, 0.08));
      }
      break;
    }
    default: {
      if (sub % 2 === 0) {
        // Mediterranean cypress: tall narrow flame of dark needles
        g.c(0x4a3420, 0.05).cyl(0, 0, 0, 0.07, 0.04, 1.6, 5);
        g.c(0x1c3420, 0.1).blob(0, 1.3, 0, 0.19, 0.12, 5, 7);
        canopy(cards, rng, new THREE.Vector3(0, 1.3, 0), new THREE.Vector3(0.28, 1.05, 0.28), 38, [0.34, 0.46], LEAF_NEEDLE);
        for (const c of cards) c.shade *= 0.9;
      } else {
        // olive: gnarled trunk, wide silvery crown
        g.c(0x6a5a44, 0.08).cyl(0, 0, 0, 0.12, 0.08, 0.7, 6);
        g.push().translate(0.03, 0.6, 0).rotateZ(0.55).cyl(0, 0, 0, 0.06, 0.035, 0.45, 5).pop();
        g.push().translate(-0.03, 0.6, 0).rotateZ(-0.6).rotateY(1).cyl(0, 0, 0, 0.06, 0.035, 0.42, 5).pop();
        g.c(0x56664a, 0.12).blob(0, 1.0, 0, 0.36, 0.15, 0.6, 7);
        canopy(cards, rng, new THREE.Vector3(0, 1.0, 0), new THREE.Vector3(0.68, 0.4, 0.68), 38, [0.5, 0.68], LEAF_SMALL);
      }
    }
  }
  for (const cd of cards) cb.card(cd, rng);
  return { trunk: g.build(), leaves: cb.build() };
}

/**
 * A grass (or reed) tuft: three vertical cards crossing at 60 degrees, standing on the ground at the origin.
 * Normals point up so tufts are lit like the ground they grow from; roots are darker.
 */
export function tuftGeometry(tile: number, width: number, height: number): THREE.BufferGeometry {
  const cb = new CardBuilder();
  const [u0, v0] = tileOrigin(tile);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    const dx = Math.cos(a) * width / 2, dz = Math.sin(a) * width / 2;
    const quad = [
      { p: new THREE.Vector3(-dx, 0, -dz), u: u0 + INSET_U, v: v0 + DV - INSET_V, s: 0.72 },
      { p: new THREE.Vector3(dx, 0, dz), u: u0 + DU - INSET_U, v: v0 + DV - INSET_V, s: 0.72 },
      { p: new THREE.Vector3(dx, height, dz), u: u0 + DU - INSET_U, v: v0 + INSET_V, s: 1.05 },
      { p: new THREE.Vector3(-dx, height, -dz), u: u0 + INSET_U, v: v0 + INSET_V, s: 1.05 },
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) cb.vert(quad[i].p, UP, quad[i].u, quad[i].v, quad[i].s);
  }
  return cb.build();
}

/** Leaf cards for a low forage bush. */
export function bushLeaves(sub: number): THREE.BufferGeometry {
  const rng = new RNG(600 + sub);
  const cb = new CardBuilder();
  const cards: CardSpec[] = [];
  canopy(cards, rng, new THREE.Vector3(0, 0.28, 0), new THREE.Vector3(0.4, 0.28, 0.4), 22, [0.34, 0.48], LEAF_BROAD);
  canopy(cards, rng, new THREE.Vector3(0.17, 0.2, 0.14), new THREE.Vector3(0.26, 0.2, 0.26), 8, [0.3, 0.4], LEAF_BROAD);
  for (const cd of cards) {
    cd.shade = Math.min(1.15, cd.shade * 1.1);
    cb.card(cd, rng);
  }
  return cb.build();
}

/** Leaf cards for the crown of a felled tree lying along +z. */
export function felledLeaves(variant: number): THREE.BufferGeometry {
  const rng = new RNG(77 + variant);
  const cb = new CardBuilder();
  if (variant === 2) {
    const base = new THREE.Vector3(0, 0.12, 1.2);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      cb.frond(base, new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), 0.6, 0.16, 0.05, 0.1, 0.85);
    }
    return cb.build();
  }
  const cards: CardSpec[] = [];
  const quad = variant === 1 || variant === 3 ? LEAF_NEEDLE : LEAF_BROAD;
  canopy(cards, rng, new THREE.Vector3(0, 0.25, 1.3), new THREE.Vector3(0.4, 0.25, 0.5), 12, [0.4, 0.55], quad);
  for (const cd of cards) cb.card(cd, rng);
  return cb.build();
}
