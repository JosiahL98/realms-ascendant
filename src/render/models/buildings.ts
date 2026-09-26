import * as THREE from 'three';
import type { ArchStyle } from '../../data/types';
import { GeoBuilder } from '../geo';
import { DETAIL as D } from '../textures';

export interface BuildingModel {
  main: THREE.BufferGeometry;
  pc: THREE.BufferGeometry;
  height: number;
  /** Optional animated part (windmill sails) rotating about +z axis through pivot. */
  sails?: { geo: THREE.BufferGeometry; pivot: [number, number, number] };
}

interface Pal {
  style: ArchStyle;
  wall: number;
  wallMat: number;
  wall2: number;
  trim: number;
  roof: number;
  roofMat: number;
  stone: number;
  base: number;
  wood: number;
  door: number;
  accent: number;
  metal: number;
}

const PALS: Record<ArchStyle, Pal> = {
  mediterranean: {
    style: 'mediterranean', wall: 0xe9dfc8, wallMat: D.plaster, wall2: 0xd9c9a6, trim: 0x8a6a48, roof: 0xb4552c, roofMat: D.tiles,
    stone: 0xc9bea6, base: 0xa89a82, wood: 0x6b4a2c, door: 0x4a3018, accent: 0xefe8d8, metal: 0x707070,
  },
  northern: {
    style: 'northern', wall: 0x8c6238, wallMat: D.logs, wall2: 0xd8cbb0, trim: 0x4e331c, roof: 0xc4a15c, roofMat: D.thatch,
    stone: 0x8e8b84, base: 0x76716a, wood: 0x6a4526, door: 0x3a2412, accent: 0x5a3a20, metal: 0x606060,
  },
  desert: {
    style: 'desert', wall: 0xd4ab74, wallMat: D.plaster, wall2: 0xc49a64, trim: 0x7a5a3a, roof: 0xdcbc8c, roofMat: D.plaster,
    stone: 0xcaae84, base: 0xae8f60, wood: 0x6b4a2c, door: 0x3e2a18, accent: 0x2f7f8f, metal: 0x707070,
  },
  eastern: {
    style: 'eastern', wall: 0xece4d0, wallMat: D.plaster, wall2: 0xd8ccb0, trim: 0x9e2c1c, roof: 0x46525c, roofMat: D.tiles,
    stone: 0x9c988e, base: 0x7e7a70, wood: 0x9a2e1e, door: 0x5a1a10, accent: 0xd4a93a, metal: 0x606060,
  },
};

/* ------------------------------------------------------------------------------------------ */
/* Shared parts                                                                                 */
/* ------------------------------------------------------------------------------------------ */

function plinth(g: GeoBuilder, p: Pal, w: number, d: number, h = 0.12): void {
  g.c(p.base, 0.05).mt(D.stone).box(0, -0.4, 0, w, 0.4 + h, d);
  g.mt(0);
}

/** Walls with style-specific framing. faces bitmask like GeoBuilder.box (default: no bottom). */
function walls(g: GeoBuilder, p: Pal, x: number, y: number, z: number, w: number, h: number, d: number, opts: { color?: number; mat?: number; frame?: boolean } = {}): void {
  g.c(opts.color ?? p.wall, 0.03).mt(opts.mat ?? p.wallMat).box(x, y, z, w, h, d, 0b111101);
  g.mt(0);
  const frame = opts.frame ?? true;
  if (!frame) return;
  const t = 0.05;
  if (p.style === 'northern' && (opts.mat ?? p.wallMat) !== D.logs) {
    // half-timbering on the visible faces
    g.c(p.trim, 0.06);
    for (const [fx, fz, fw, fd] of [[x, z + d / 2, w, 0], [x + w / 2, z, 0, d]] as [number, number, number, number][]) {
      const len = fw || fd;
      const n = Math.max(2, Math.round(len / 0.5));
      for (let i = 0; i <= n; i++) {
        const o = -len / 2 + (i * len) / n;
        if (fw) g.box(fx + o, y, fz + 0.01, t, h, t);
        else g.box(fx + 0.01, y, fz + o, t, h, t);
      }
      if (fw) g.box(fx, y + h - t, fz + 0.01, fw, t, t).box(fx, y + h * 0.5, fz + 0.01, fw, t, t);
      else g.box(fx + 0.01, y + h - t, fz, t, t, fd).box(fx + 0.01, y + h * 0.5, fz, t, t, fd);
    }
  } else if (p.style === 'eastern') {
    g.c(p.trim, 0.05);
    for (const [cx, cz] of [[x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x - w / 2, z + d / 2], [x + w / 2, z + d / 2]])
      g.cyl(cx, y, cz, 0.07, 0.07, h, 6);
    g.box(x, y + h - 0.08, z + d / 2 + 0.005, w, 0.08, 0.02).box(x + w / 2 + 0.005, y + h - 0.08, z, 0.02, 0.08, d);
  } else if (p.style === 'mediterranean') {
    g.c(p.wall2, 0.03).box(x, y + h - 0.06, z, w + 0.04, 0.06, d + 0.04);
    g.c(p.base, 0.04).mt(D.stone).box(x, y, z, w + 0.03, 0.12, d + 0.03);
    g.mt(0);
  } else if (p.style === 'desert') {
    // protruding roof beams
    g.c(p.trim, 0.08);
    const n = Math.max(2, Math.round(w / 0.35));
    for (let i = 0; i < n; i++) g.box(x - w / 2 + (i + 0.5) * (w / n), y + h - 0.12, z + d / 2 + 0.05, 0.05, 0.05, 0.1);
    const m = Math.max(2, Math.round(d / 0.35));
    for (let i = 0; i < m; i++) g.box(x + w / 2 + 0.05, y + h - 0.12, z - d / 2 + (i + 0.5) * (d / m), 0.1, 0.05, 0.05);
  }
}

/** Style roof over a w x d rectangle at height y. Returns top height. */
function roof(g: GeoBuilder, p: Pal, x: number, y: number, z: number, w: number, d: number, k = 1): number {
  const m = Math.min(w, d);
  switch (p.style) {
    case 'mediterranean': {
      const h = 0.32 * m * k;
      g.c(p.roof, 0.05).mt(D.tiles).hip(x, y, z, w, h, d, 0.1);
      g.mt(0);
      return y + h;
    }
    case 'northern': {
      const h = 0.62 * m * k;
      g.c(p.roof, 0.06).mt(D.thatch);
      if (w >= d) g.gable(x, y, z, w, h, d, 0.14, p.wall2);
      else {
        g.push().translate(x, 0, z).rotateY(Math.PI / 2);
        g.gable(0, y, 0, d, h, w, 0.14, p.wall2);
        g.pop();
      }
      g.mt(0);
      // ridge beam
      g.c(p.trim, 0.05);
      if (w >= d) g.box(x, y + h - 0.02, z, w + 0.3, 0.06, 0.08);
      else g.box(x, y + h - 0.02, z, 0.08, 0.06, d + 0.3);
      return y + h;
    }
    case 'desert': {
      g.c(p.wall2, 0.03).mt(D.plaster).box(x, y, z, w + 0.06, 0.07, d + 0.06);
      g.c(p.wall, 0.04).crenels(x, y + 0.07, z, w + 0.06, d + 0.06, 0.12, 0.08);
      g.mt(0);
      return y + 0.2;
    }
    case 'eastern': {
      const h = 0.4 * m * k;
      g.c(p.roof, 0.04).mt(D.tiles).pagoda(x, y, z, w, h, d, 0.28 * Math.min(1.2, k), 0.14);
      g.mt(0);
      g.c(p.accent, 0.05).box(x, y + h, z, Math.max(0.1, w * 0.25), 0.06, 0.06);
      return y + h;
    }
  }
}

function dome(g: GeoBuilder, p: Pal, x: number, y: number, z: number, r: number, color?: number): number {
  g.c(color ?? p.wall2, 0.04).mt(D.plaster).cyl(x, y, z, r * 1.02, r * 1.02, 0.12, 12, { top: false });
  g.dome(x, y + 0.12, z, r, r * 0.95, 12);
  g.mt(0);
  g.c(p.accent, 0.05).cyl(x, y + 0.12 + r * 0.95 - 0.02, z, 0.03, 0.02, 0.22, 5).sphere(x, y + 0.12 + r * 0.95 + 0.2, z, 0.05, 5, 4);
  return y + 0.12 + r;
}

function door(g: GeoBuilder, p: Pal, x: number, y: number, z: number, w: number, h: number, face: 'z' | 'x' = 'z'): void {
  g.c(p.door, 0.05).mt(D.planks);
  if (face === 'z') g.box(x, y, z + 0.015, w, h, 0.04);
  else g.box(x + 0.015, y, z, 0.04, h, w);
  g.mt(0);
  if (p.style === 'mediterranean' || p.style === 'desert') {
    // arch lintel
    g.c(p.style === 'desert' ? p.trim : p.stone, 0.04);
    if (face === 'z') g.box(x, y + h, z + 0.02, w + 0.1, 0.07, 0.05);
    else g.box(x + 0.02, y + h, z, 0.05, 0.07, w + 0.1);
  }
}

function windowAt(g: GeoBuilder, p: Pal, x: number, y: number, z: number, face: 'z' | 'x', s = 0.16): void {
  g.c(0x241a12, 0.02);
  if (face === 'z') g.box(x, y, z + 0.012, s, s * 1.2, 0.03);
  else g.box(x + 0.012, y, z, 0.03, s * 1.2, s);
  g.c(p.style === 'eastern' ? p.trim : p.trim, 0.05);
  if (face === 'z') g.box(x, y - 0.03, z + 0.03, s + 0.06, 0.03, 0.04);
  else g.box(x + 0.03, y - 0.03, z, 0.04, 0.03, s + 0.06);
}

function flag(g: GeoBuilder, pc: GeoBuilder, x: number, y: number, z: number, h = 1.0, size = 0.32): void {
  g.c(0x4e3620, 0.05).cyl(x, y, z, 0.022, 0.018, h, 5);
  g.c(0xd4a93a).sphere(x, y + h + 0.02, z, 0.035, 5, 3);
  pc.c(0xffffff, 0.04).mt(D.cloth).box(x + size / 2 + 0.02, y + h - size * 0.62, z, size, size * 0.58, 0.02);
  pc.c(0xcccccc, 0.04).box(x + size + 0.02, y + h - size * 0.62, z, 0.06, size * 0.58, 0.021);
  pc.mt(0);
}

function banner(pc: GeoBuilder, g: GeoBuilder, x: number, y: number, z: number, w: number, h: number, face: 'z' | 'x'): void {
  pc.c(0xf0f0f0, 0.03).mt(D.cloth);
  if (face === 'z') pc.box(x, y - h, z + 0.02, w, h, 0.02);
  else pc.box(x + 0.02, y - h, z, 0.02, h, w);
  pc.mt(0);
  g.c(0xd4a93a, 0.05);
  if (face === 'z') g.box(x, y, z + 0.03, w + 0.06, 0.03, 0.03);
  else g.box(x + 0.03, y, z, 0.03, 0.03, w + 0.06);
}

function post(g: GeoBuilder, p: Pal, x: number, y: number, z: number, h: number, r = 0.045): void {
  if (p.style === 'mediterranean') {
    g.c(p.accent, 0.03).cyl(x, y, z, r * 1.25, r * 1.1, h, 8);
    g.c(p.stone, 0.03).box(x, y + h - 0.04, z, r * 3, 0.05, r * 3).box(x, y, z, r * 3, 0.05, r * 3);
  } else if (p.style === 'eastern') {
    g.c(p.trim, 0.04).cyl(x, y, z, r, r, h, 6);
  } else if (p.style === 'desert') {
    g.c(p.wall2, 0.04).box(x, y, z, r * 2.4, h, r * 2.4);
  } else g.c(p.wood, 0.08).cyl(x, y, z, r, r * 0.9, h, 5);
}

/** Open shed: posts + roof. */
function shed(g: GeoBuilder, p: Pal, x: number, z: number, w: number, d: number, h: number): number {
  const r = 0.045;
  for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) post(g, p, x + (px * (w / 2 - r)), 0, z + (pz * (d / 2 - r)), h, r);
  if (w > 1.6) {
    post(g, p, x, 0, z + d / 2 - r, h, r);
    post(g, p, x, 0, z - d / 2 + r, h, r);
  }
  g.c(p.trim, 0.06).box(x, h - 0.06, z + d / 2 - r, w, 0.07, 0.07).box(x, h - 0.06, z - d / 2 + r, w, 0.07, 0.07);
  return roof(g, p, x, h, z, w, d, 0.85);
}

function crate(g: GeoBuilder, x: number, y: number, z: number, s = 0.2): void {
  g.c(0x8a6a40, 0.08).mt(D.planks).box(x, y, z, s, s, s);
  g.mt(0);
}
function barrel(g: GeoBuilder, x: number, y: number, z: number, s = 0.12): void {
  g.c(0x7a5230, 0.06).cyl(x, y, z, s, s * 1.1, s * 2.2, 7);
  g.c(0x404040).cyl(x, y + s * 0.5, z, s * 1.06, s * 1.1, 0.02, 7).cyl(x, y + s * 1.6, z, s * 1.1, s * 1.06, 0.02, 7);
}
function amphora(g: GeoBuilder, x: number, y: number, z: number): void {
  g.c(0xb86a3a, 0.08).sphere(x, y + 0.12, z, 0.07, 6, 5, 1, 1.4, 1).cyl(x, y + 0.2, z, 0.03, 0.035, 0.08, 5);
}
function logPile(g: GeoBuilder, x: number, z: number, n = 3, len = 0.9): void {
  g.c(0x6a4a2a, 0.08);
  let k = 0;
  for (let row = 0; row < n; row++)
    for (let i = 0; i < n - row; i++) {
      g.push().translate(x - len / 2, 0.07 + row * 0.12, z + (i - (n - row - 1) / 2) * 0.13).rotateZ(-Math.PI / 2);
      g.c(k++ % 2 ? 0x6a4a2a : 0x5e4024, 0.06).cyl(0, 0, 0, 0.065, 0.065, len, 6);
      g.pop();
    }
  // log ends
  g.c(0xc8a064, 0.04);
  for (let row = 0; row < n; row++)
    for (let i = 0; i < n - row; i++) g.box(x + len / 2 + 0.005, 0.02 + row * 0.12, z + (i - (n - row - 1) / 2) * 0.13, 0.01, 0.1, 0.1);
}

/* ------------------------------------------------------------------------------------------ */
/* Buildings                                                                                    */
/* ------------------------------------------------------------------------------------------ */

type Maker = (g: GeoBuilder, pc: GeoBuilder, p: Pal) => number;

const house: Maker = (g, pc, p) => {
  plinth(g, p, 1.6, 1.6, 0.06);
  if (p.style === 'desert') {
    walls(g, p, 0, 0, 0, 1.35, 0.9, 1.3);
    let top = roof(g, p, 0, 0.9, 0, 1.35, 1.3);
    walls(g, p, -0.25, 0.97, -0.2, 0.7, 0.45, 0.7, { frame: false });
    roof(g, p, -0.25, 1.42, -0.2, 0.7, 0.7);
    top = 1.62;
    door(g, p, 0.2, 0, 0.65, 0.26, 0.48);
    windowAt(g, p, 0.68, 0.55, -0.2, 'x');
    pc.c(0xf2f2f2, 0.04).mt(D.cloth);
    pc.push().translate(0.35, 1.2, 0.35).rotateX(-0.35).box(0, 0, 0, 0.5, 0.02, 0.4).pop();
    g.c(0x6b4a2c).cyl(0.12, 0.97, 0.52, 0.015, 0.015, 0.25, 4).cyl(0.58, 0.97, 0.52, 0.015, 0.015, 0.25, 4);
    return top;
  }
  const h = p.style === 'northern' ? 0.62 : 0.72;
  walls(g, p, 0, 0, 0, 1.3, h, 1.2);
  const top = roof(g, p, 0, h, 0, 1.3, 1.2);
  door(g, p, 0.25, 0, 0.6, 0.26, 0.46);
  windowAt(g, p, -0.25, h * 0.55, 0.6, 'z');
  windowAt(g, p, 0.65, h * 0.55, 0.1, 'x');
  if (p.style === 'northern') {
    g.c(0x8a8680, 0.06).mt(D.stone).box(-0.4, 0, -0.35, 0.22, top + 0.1, 0.22);
    g.mt(0);
  }
  if (p.style === 'eastern') {
    g.c(p.accent).sphere(0.5, 0.52, 0.66, 0.05, 6, 4);
  }
  pc.c(0xeeeeee, 0.03).mt(D.cloth);
  pc.push().translate(0.25, 0.58, 0.72).rotateX(-0.5).box(0, 0, 0, 0.42, 0.02, 0.26).pop();
  pc.mt(0);
  return top;
};

const townCenter: Maker = (g, pc, p) => {
  plinth(g, p, 3.8, 3.8, 0.1);
  // courtyard paving
  g.c(p.base, 0.05).mt(D.stone).box(0.3, 0.1, 0.3, 3.0, 0.03, 3.0);
  g.mt(0);
  // main hall
  const hh = 1.2;
  walls(g, p, -0.35, 0.1, -0.35, 2.3, hh, 2.3);
  // upper storey
  walls(g, p, -0.5, 0.1 + hh, -0.5, 1.5, 0.7, 1.5, { color: p.wall2 });
  let top = roof(g, p, -0.5, 0.1 + hh + 0.7, -0.5, 1.5, 1.5, 1.1);
  // lower roof skirt around the upper storey
  if (p.style !== 'desert') {
    g.c(p.roof, 0.05).mt(p.roofMat);
    g.box(-0.35, 0.1 + hh, 0.62, 2.45, 0.08, 0.5).box(0.62, 0.1 + hh, -0.35, 0.5, 0.08, 2.45);
    g.mt(0);
  } else roof(g, p, -0.35, 0.1 + hh, -0.35, 2.3, 2.3);
  door(g, p, -0.35, 0.1, 0.8, 0.5, 0.7);
  door(g, p, 0.8, 0.1, -0.35, 0.5, 0.7, 'x');
  for (const o of [-0.95, 0.25]) {
    windowAt(g, p, o, 0.75, 0.8, 'z', 0.2);
    windowAt(g, p, 0.8, 0.75, o, 'x', 0.2);
  }
  // tower at the back corner
  const tx = -1.35, tz = -1.35;
  g.c(p.stone, 0.04).mt(D.stone).box(tx, 0.1, tz, 0.85, 2.6, 0.85, 0b111101);
  g.mt(0);
  if (p.style === 'northern') {
    g.c(p.roof, 0.06).mt(D.thatch).cone(tx, 2.7, tz, 0.72, 1.0, 8, false);
    g.mt(0);
    top = Math.max(top, 3.7);
  } else if (p.style === 'desert') {
    dome(g, p, tx, 2.7, tz, 0.38);
    top = Math.max(top, 3.3);
  } else if (p.style === 'eastern') {
    roof(g, p, tx, 2.7, tz, 0.85, 0.85, 1.2);
    top = Math.max(top, 3.2);
  } else {
    g.c(p.stone, 0.04).crenels(tx, 2.7, tz, 0.85, 0.85, 0.14, 0.12);
    g.c(p.roof, 0.05).mt(D.tiles).hip(tx, 2.84, tz, 0.7, 0.45, 0.7, 0.05);
    g.mt(0);
    top = Math.max(top, 3.3);
  }
  windowAt(g, p, tx, 2.2, tz + 0.425, 'z', 0.14);
  windowAt(g, p, tx + 0.425, 2.2, tz, 'x', 0.14);
  // front porch / colonnade
  for (let i = 0; i < 4; i++) {
    post(g, p, -1.3 + i * 0.63, 0.13, 1.45, 0.95);
    post(g, p, 1.45, 0.13, -1.3 + i * 0.63, 0.95);
  }
  g.c(p.trim, 0.05).box(0.1, 1.05, 1.45, 3.0, 0.08, 0.12).box(1.45, 1.05, 0.1, 0.12, 0.08, 3.0);
  // porch roofs
  g.c(p.roof, 0.05).mt(p.style === 'desert' ? D.plaster : p.roofMat);
  g.push().translate(0.1, 1.13, 1.2).rotateX(0.25).box(0, 0, 0, 3.1, 0.06, 0.6).pop();
  g.push().translate(1.2, 1.13, 0.1).rotateZ(-0.25).box(0, 0, 0, 0.6, 0.06, 3.1).pop();
  g.mt(0);
  // well & props in the courtyard
  g.c(p.stone, 0.05).mt(D.stone).cyl(0.95, 0.12, 0.95, 0.2, 0.2, 0.22, 8, { top: false });
  g.mt(0);
  g.c(0x203040).cyl(0.95, 0.3, 0.95, 0.17, 0.17, 0.02, 8);
  barrel(g, 1.55, 0.13, 1.7, 0.1);
  crate(g, 1.72, 0.13, 1.4, 0.18);
  // flags
  flag(g, pc, tx + 0.3, 2.7, tz + 0.3, 1.0, 0.36);
  flag(g, pc, 0.25, 0.1 + hh + 0.7, 0.3, 0.9, 0.3);
  banner(pc, g, -0.35, 1.2, 0.83, 0.5, 0.35, 'z');
  banner(pc, g, 0.83, 1.2, -0.35, 0.5, 0.35, 'x');
  return top;
};

const barracks: Maker = (g, pc, p) => {
  plinth(g, p, 2.9, 2.9, 0.06);
  walls(g, p, -0.1, 0, -0.55, 2.5, 1.0, 1.5);
  const top = roof(g, p, -0.1, 1.0, -0.55, 2.5, 1.5);
  door(g, p, -0.1, 0, 0.2, 0.45, 0.65);
  windowAt(g, p, -0.8, 0.6, 0.2, 'z');
  windowAt(g, p, 0.6, 0.6, 0.2, 'z');
  windowAt(g, p, 1.15, 0.6, -0.55, 'x');
  // training yard fence
  g.c(p.wood, 0.08);
  for (let i = 0; i < 7; i++) g.cyl(-1.35 + i * 0.45, 0, 1.35, 0.03, 0.03, 0.4, 4);
  for (let i = 0; i < 4; i++) g.cyl(1.35, 0, 0.3 + i * 0.35, 0.03, 0.03, 0.4, 4);
  g.box(0, 0.3, 1.35, 2.7, 0.04, 0.04).box(1.35, 0.3, 0.8, 0.04, 0.04, 1.1);
  // weapon rack with spears
  g.c(p.wood).box(-0.9, 0, 0.8, 0.6, 0.06, 0.12).box(-0.9, 0.35, 0.8, 0.6, 0.04, 0.08);
  for (let i = 0; i < 5; i++) {
    g.c(0x7a5a38).cyl(-1.15 + i * 0.12, 0, 0.8, 0.012, 0.012, 0.75, 4);
    g.c(0xb0b0b0).cone(-1.15 + i * 0.12, 0.75, 0.8, 0.025, 0.08, 4);
  }
  // training dummy
  g.c(p.wood).cyl(0.55, 0, 0.85, 0.035, 0.035, 0.7, 5).box(0.55, 0.52, 0.85, 0.4, 0.05, 0.05);
  g.c(0xc8a868, 0.1).mt(D.thatch).sphere(0.55, 0.45, 0.85, 0.12, 6, 5, 1, 1.4, 1);
  g.mt(0);
  // shields on wall
  for (const x of [-0.8, 0.6]) {
    pc.c(0xffffff, 0.04).cyl(x, 0.95, 0.24, 0.1, 0.1, 0.03, 8, { rot: 0 });
  }
  flag(g, pc, 1.1, 1.0, -1.2, 0.9);
  return top;
};

const archeryRange: Maker = (g, pc, p) => {
  plinth(g, p, 2.9, 2.9, 0.05);
  walls(g, p, -0.2, 0, -1.0, 2.4, 0.95, 0.7);
  roof(g, p, -0.2, 0.95, -1.0, 2.4, 0.7);
  const top = shed(g, p, -0.2, -0.2, 2.4, 0.9, 1.0);
  windowAt(g, p, 1.0, 0.55, -1.0, 'x');
  // targets
  for (const [x, z] of [[-0.9, 1.0], [0.1, 1.15], [1.0, 0.8]] as [number, number][]) {
    g.c(p.wood).cyl(x - 0.12, 0, z - 0.05, 0.02, 0.02, 0.45, 4).cyl(x + 0.12, 0, z - 0.05, 0.02, 0.02, 0.45, 4);
    g.push().translate(x, 0.42, z).rotateX(Math.PI / 2 - 0.25);
    g.c(0xd8c088, 0.06).mt(D.thatch).cyl(0, 0, 0, 0.22, 0.22, 0.06, 12);
    g.mt(0);
    g.c(0xffffff).cyl(0, 0.061, 0, 0.16, 0.16, 0.004, 12, { top: true });
    g.c(0xc02020).cyl(0, 0.066, 0, 0.1, 0.1, 0.004, 12, { top: true });
    g.c(0xffe040).cyl(0, 0.071, 0, 0.04, 0.04, 0.004, 8, { top: true });
    g.pop();
  }
  // arrows sticking in ground
  g.c(0x7a5a38);
  for (let i = 0; i < 6; i++) g.push().translate(-0.4 + i * 0.12, 0, 0.55 + (i % 2) * 0.1).rotateX(0.3).cyl(0, 0, 0, 0.008, 0.008, 0.3, 3).pop();
  // bow rack
  g.c(p.wood).box(0.9, 0, -0.3, 0.08, 0.6, 0.5);
  pc.c(0xffffff, 0.04).mt(D.cloth).box(-0.2, 0.75, 0.26, 1.2, 0.2, 0.02);
  pc.mt(0);
  flag(g, pc, -1.2, 0.95, -1.2, 0.8);
  return top;
};

const stable: Maker = (g, pc, p) => {
  plinth(g, p, 2.9, 2.9, 0.05);
  walls(g, p, -0.15, 0, -0.55, 2.5, 0.95, 1.5);
  const top = roof(g, p, -0.15, 0.95, -0.55, 2.5, 1.5);
  // stall openings with horse heads
  for (let i = 0; i < 4; i++) {
    const x = -1.1 + i * 0.62;
    g.c(0x2a1c12).box(x, 0.3, 0.215, 0.36, 0.45, 0.03);
    g.c(p.trim).box(x, 0.28, 0.23, 0.4, 0.05, 0.05);
    if (i % 2 === 0) {
      g.c(i === 0 ? 0x6a4228 : 0x3a2a20, 0.06).box(x, 0.42, 0.28, 0.12, 0.14, 0.2);
      g.box(x, 0.39, 0.4, 0.09, 0.09, 0.12);
    }
  }
  // paddock fence
  g.c(p.wood, 0.08);
  for (let i = 0; i < 7; i++) g.cyl(-1.35 + i * 0.45, 0, 1.35, 0.03, 0.03, 0.42, 4);
  for (let i = 0; i < 4; i++) g.cyl(1.35, 0, 0.3 + i * 0.35, 0.03, 0.03, 0.42, 4);
  g.box(0, 0.32, 1.35, 2.7, 0.04, 0.04).box(0, 0.18, 1.35, 2.7, 0.04, 0.04).box(1.35, 0.32, 0.8, 0.04, 0.04, 1.1);
  // hay bales & trough
  g.c(0xd8c070, 0.08).mt(D.thatch).box(-0.9, 0, 0.75, 0.4, 0.25, 0.28).box(-0.55, 0, 0.8, 0.28, 0.22, 0.38).box(-0.75, 0.25, 0.78, 0.35, 0.2, 0.26);
  g.mt(0);
  g.c(p.wood).box(0.5, 0, 0.7, 0.6, 0.16, 0.2);
  g.c(0x3060a0).box(0.5, 0.14, 0.7, 0.52, 0.02, 0.14);
  pc.c(0xffffff, 0.04).mt(D.cloth).box(-0.15, 0.95, 0.24, 2.3, 0.1, 0.02);
  pc.mt(0);
  flag(g, pc, 1.1, 0.95, -1.25, 0.8);
  return top;
};

const blacksmith: Maker = (g, pc, p) => {
  plinth(g, p, 2.9, 2.9, 0.05);
  walls(g, p, -0.35, 0, -0.35, 2.0, 1.0, 2.0);
  const top = roof(g, p, -0.35, 1.0, -0.35, 2.0, 2.0);
  // chimney
  g.c(0x77736a, 0.05).mt(D.stone).box(-0.9, 0, -0.9, 0.4, top + 0.35, 0.4);
  g.mt(0);
  g.c(0x222222).box(-0.9, top + 0.35, -0.9, 0.28, 0.02, 0.28);
  // open workshop front with awning
  g.c(0x1e1410).box(-0.35, 0.05, 0.66, 1.1, 0.7, 0.03);
  g.c(0xff7a20).box(-0.55, 0.1, 0.62, 0.35, 0.2, 0.05);
  post(g, p, 0.35, 0, 1.2, 0.85);
  post(g, p, -1.05, 0, 1.2, 0.85);
  pc.c(0xffffff, 0.05).mt(D.cloth).push().translate(-0.35, 0.9, 0.95).rotateX(0.3).box(0, 0, 0, 1.6, 0.03, 0.6).pop();
  pc.mt(0);
  // anvil
  g.c(0x3a3a3a, 0.05).box(0.6, 0, 1.0, 0.18, 0.2, 0.12).box(0.6, 0.2, 1.0, 0.34, 0.08, 0.14);
  g.c(p.wood).cyl(0.6, 0, 1.0, 0.12, 0.12, 0.1, 6);
  // quench barrel, weapons
  barrel(g, 1.05, 0, 0.55, 0.12);
  g.c(0x9a9a9a).box(1.1, 0, -0.3, 0.05, 0.6, 0.05).box(1.18, 0, -0.1, 0.04, 0.55, 0.12);
  flag(g, pc, 0.95, 1.0, -1.2, 0.7);
  return top + 0.35;
};

const market: Maker = (g, pc, p) => {
  plinth(g, p, 3.8, 3.8, 0.05);
  g.c(p.base, 0.05).mt(D.stone).box(0, 0.05, 0, 3.4, 0.03, 3.4);
  g.mt(0);
  walls(g, p, -0.6, 0.05, -0.6, 1.8, 1.1, 1.8);
  const top = roof(g, p, -0.6, 1.15, -0.6, 1.8, 1.8);
  door(g, p, -0.6, 0.05, 0.3, 0.45, 0.65);
  door(g, p, 0.3, 0.05, -0.6, 0.45, 0.65, 'x');
  // stalls with player-colored canopies
  const stalls: [number, number][] = [[1.2, 1.2], [-0.8, 1.35], [1.35, -0.8], [0.2, 1.35]];
  stalls.forEach(([x, z], i) => {
    for (const [dx, dz] of [[-0.3, -0.25], [0.3, -0.25], [-0.3, 0.25], [0.3, 0.25]]) g.c(p.wood).cyl(x + dx, 0.05, z + dz, 0.02, 0.02, 0.7, 4);
    g.c(p.wood, 0.06).mt(D.planks).box(x, 0.05, z + 0.12, 0.62, 0.32, 0.18);
    g.mt(0);
    pc.c(i % 2 ? 0xffffff : 0xd8d8d8, 0.04).mt(D.cloth).push().translate(x, 0.78, z).rotateX(0.18).box(0, 0, 0, 0.72, 0.03, 0.62).pop();
    pc.mt(0);
    const goods = [0xd84a2a, 0xe8c040, 0x5a9a3a, 0x8a4ab0];
    for (let k = 0; k < 4; k++) g.c(goods[(k + i) % 4], 0.1).sphere(x - 0.2 + k * 0.13, 0.42, z + 0.12, 0.05, 5, 4);
  });
  for (let i = 0; i < 4; i++) amphora(g, -1.5 + i * 0.18, 0.05, 0.6);
  barrel(g, 0.6, 0.05, 0.5, 0.11);
  crate(g, 0.85, 0.05, 0.3, 0.2);
  crate(g, 0.8, 0.25, 0.32, 0.16);
  flag(g, pc, -1.3, 1.15, -1.3, 0.9);
  return top;
};

const mill: Maker = (g, pc, p) => {
  plinth(g, p, 1.7, 1.7, 0.04);
  let top: number;
  if (p.style === 'desert' || p.style === 'eastern') {
    walls(g, p, 0, 0, 0, 1.0, 1.4, 1.0, { frame: false });
    top = roof(g, p, 0, 1.4, 0, 1.0, 1.0);
  } else {
    g.c(p.style === 'northern' ? p.wall : p.wall, 0.04).mt(p.wallMat).cyl(0, 0, 0, 0.55, 0.42, 1.45, 10, { top: false });
    g.mt(0);
    g.c(p.roof, 0.06).mt(p.roofMat).cone(0, 1.45, 0, 0.52, 0.55, 10, false);
    g.mt(0);
    top = 2.0;
  }
  door(g, p, 0.0, 0, 0.5, 0.24, 0.42);
  windowAt(g, p, 0.52, 0.95, 0, 'x', 0.13);
  // grain sacks
  g.c(0xd8c8a0, 0.08).mt(D.cloth).sphere(0.55, 0.12, 0.6, 0.14, 6, 5, 1, 0.9, 0.8).sphere(0.72, 0.1, 0.4, 0.12, 6, 5, 1, 0.9, 0.8);
  g.mt(0);
  flag(g, pc, -0.6, 0, 0.6, 0.9, 0.22);
  // sails (animated)
  const s = new GeoBuilder(77);
  s.c(0x5a3e24, 0.05).cyl(0, 0, 0, 0.05, 0.05, 0.12, 6).box(0, 0, 0, 0.06, 0.06, 0.06);
  for (let i = 0; i < 4; i++) {
    s.push().rotateZ((i * Math.PI) / 2);
    s.c(0x5a3e24, 0.05).box(0, 0.05, 0.08, 0.04, 0.9, 0.03);
    s.c(p.style === 'eastern' ? 0xd8cfb8 : 0xe8e0cc, 0.06).mt(D.cloth).box(0.1, 0.2, 0.09, 0.16, 0.72, 0.01);
    s.mt(0);
    s.pop();
  }
  // attach sails to +z face at top
  const pivotY = p.style === 'desert' || p.style === 'eastern' ? 1.2 : 1.3;
  const pivotZ = p.style === 'desert' || p.style === 'eastern' ? 0.52 : 0.5;
  (g as unknown as { _sails: unknown })._sails = { geo: s.build(), pivot: [0, pivotY, pivotZ] };
  return Math.max(top, pivotY + 0.9);
};

const lumberCamp: Maker = (g, pc, p) => {
  plinth(g, p, 1.8, 1.8, 0.03);
  const top = shed(g, p, -0.2, -0.2, 1.2, 1.1, 0.85);
  logPile(g, 0.2, 0.55, 3, 0.9);
  logPile(g, -0.3, -0.25, 2, 0.7);
  // stump + axe
  g.c(0x6a4a2a).cyl(0.6, 0, -0.5, 0.12, 0.12, 0.18, 7);
  g.c(0xc8a064).cyl(0.6, 0.18, -0.5, 0.12, 0.12, 0.005, 7);
  g.push().translate(0.62, 0.18, -0.5).rotateZ(-0.6).c(0x7a5a38).cyl(0, 0, 0, 0.012, 0.012, 0.3, 4).c(0x9a9a9a).box(0.0, 0.26, 0, 0.1, 0.06, 0.015).pop();
  // saw horse
  g.c(p.wood).push().translate(-0.55, 0, 0.6).box(0, 0.25, 0, 0.45, 0.04, 0.04).rotateX(0.35).box(-0.18, 0, 0, 0.03, 0.28, 0.03).box(0.18, 0, 0, 0.03, 0.28, 0.03).pop();
  flag(g, pc, -0.75, 0, -0.75, 1.0, 0.22);
  return top;
};

const miningCamp: Maker = (g, pc, p) => {
  plinth(g, p, 1.8, 1.8, 0.03);
  const top = shed(g, p, -0.2, -0.25, 1.2, 1.0, 0.85);
  // ore cart
  g.c(p.wood, 0.06).mt(D.planks).box(0.45, 0.12, 0.5, 0.45, 0.2, 0.3);
  g.mt(0);
  g.c(0x3a2a1a).push().translate(0.3, 0.1, 0.66).rotateX(Math.PI / 2).cyl(0, 0, 0, 0.09, 0.09, 0.03, 8).pop();
  g.push().translate(0.6, 0.1, 0.66).rotateX(Math.PI / 2).cyl(0, 0, 0, 0.09, 0.09, 0.03, 8).pop();
  g.c(0xe0b030, 0.15).blob(0.4, 0.34, 0.5, 0.1, 0.3, 0.7, 5).c(0x9a968a, 0.15).blob(0.52, 0.33, 0.48, 0.09, 0.3, 0.7, 5);
  // stone blocks
  g.c(0xb0aca0, 0.06).mt(D.stone).box(-0.5, 0, 0.55, 0.3, 0.18, 0.22).box(-0.2, 0, 0.62, 0.22, 0.18, 0.2).box(-0.38, 0.18, 0.58, 0.26, 0.16, 0.2);
  g.mt(0);
  // pickaxes
  g.c(0x7a5a38).push().translate(0.7, 0, -0.3).rotateZ(0.3).cyl(0, 0, 0, 0.012, 0.012, 0.45, 4).c(0x777777).box(0, 0.43, 0, 0.26, 0.04, 0.03).pop();
  flag(g, pc, -0.75, 0, -0.75, 1.0, 0.22);
  return top;
};

const farm: Maker = (g) => {
  // soil (crops drawn in the pc layer, tinted by remaining food)
  g.c(0x6e4e30, 0.04).mt(D.planks).box(0, -0.2, 0, 2.94, 0.23, 2.94);
  g.mt(0);
  g.c(0x5a3e24, 0.06);
  for (let i = 0; i < 8; i++) g.box(-1.3 + i * 0.37, 0.03, 0, 0.1, 0.02, 2.8);
  // corner stones and fence posts
  g.c(0x8a8478, 0.1);
  for (const [x, z] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) g.blob(x, 0.05, z, 0.08, 0.3, 0.7, 5);
  return 0.4;
};

function farmCrops(): THREE.BufferGeometry {
  const pc = new GeoBuilder(91);
  for (let i = 0; i < 8; i++)
    for (let j = 0; j < 9; j++) {
      const x = -1.3 + i * 0.37 + 0.18, z = -1.3 + j * 0.32;
      pc.c(j % 2 ? 0xffffff : 0xe8e8e8, 0.15).cone(x, 0.02, z, 0.09, 0.28, 4, false);
      pc.cone(x + 0.05, 0.02, z + 0.12, 0.07, 0.22, 4, false);
    }
  return pc.build();
}

const outpost: Maker = (g, pc, p) => {
  g.c(p.wood, 0.08);
  for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) g.cyl(x, 0, z, 0.04, 0.035, 1.7, 5);
  g.push().translate(0, 0.7, 0.3).rotateZ(0.9).box(0, 0, 0, 0.03, 0.8, 0.03).pop();
  g.push().translate(0.3, 0.7, 0).rotateX(0.9).box(0, 0, 0, 0.03, 0.8, 0.03).pop();
  g.c(p.wood, 0.06).mt(D.planks).box(0, 1.6, 0, 0.8, 0.07, 0.8);
  g.mt(0);
  g.c(p.wood).box(0, 1.67, 0.38, 0.8, 0.2, 0.04).box(0.38, 1.67, 0, 0.04, 0.2, 0.8);
  const top = roof(g, p, 0, 2.05, 0, 0.7, 0.7, 1.1);
  for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) g.c(p.wood).cyl(x, 1.67, z, 0.025, 0.025, 0.4, 4);
  g.c(0xff9a30).sphere(0.3, 1.9, 0.3, 0.05, 5, 4);
  flag(g, pc, -0.3, 2.05, -0.3, 0.45, 0.18);
  return top;
};

const palisade: Maker = (g) => {
  const pts: [number, number][] = [[-0.3, -0.3], [0, -0.3], [0.3, -0.3], [-0.3, 0], [0, 0], [0.3, 0], [-0.3, 0.3], [0, 0.3], [0.3, 0.3]];
  pts.forEach(([x, z], i) => {
    const h = 1.0 + ((i * 37) % 7) * 0.03;
    g.c(i % 2 ? 0x7a5634 : 0x6a4a2c, 0.08).cyl(x, 0, z, 0.13, 0.12, h, 6);
    g.c(0x8a6a44, 0.08).cone(x, h, z, 0.12, 0.18, 6, false);
  });
  g.c(0x4a3420).box(0, 0.6, 0, 0.9, 0.06, 0.9, 0b111100);
  return 1.2;
};

const stoneWall: Maker = (g, _pc, p) => {
  const col = p.style === 'desert' ? p.wall2 : p.style === 'eastern' ? 0xa8a498 : p.stone;
  g.c(col, 0.04).mt(D.stone).box(0, -0.3, 0, 1.0, 1.55, 1.0, 0b111101);
  g.c(col, 0.05).crenels(0, 1.25, 0, 1.0, 1.0, 0.16, 0.16);
  g.mt(0);
  if (p.style === 'eastern') {
    g.c(p.roof, 0.04).mt(D.tiles).box(0, 1.25, 0, 1.04, 0.06, 1.04);
    g.mt(0);
  }
  return 1.45;
};

const gate: Maker = (g, pc, p) => {
  // modelled 1 wide (x) by 3 long (z)
  const col = p.style === 'desert' ? p.wall2 : p.stone;
  for (const z of [-1.05, 1.05]) {
    g.c(col, 0.04).mt(D.stone).box(0, -0.3, z, 1.0, 2.0, 0.9, 0b111101);
    g.c(col, 0.05).crenels(0, 1.7, z, 1.0, 0.9, 0.16, 0.16);
    g.mt(0);
    if (p.style === 'eastern' || p.style === 'mediterranean') {
      g.c(p.roof, 0.05).mt(D.tiles).hip(0, 1.86, z, 0.9, 0.35, 0.8, 0.06);
      g.mt(0);
    }
  }
  // lintel over the passage
  g.c(col, 0.04).mt(D.stone).box(0, 1.1, 0, 1.0, 0.6, 1.3);
  g.c(col, 0.05).crenels(0, 1.7, 0, 1.0, 1.3, 0.16, 0.16);
  g.mt(0);
  // raised portcullis bars
  g.c(0x3a3a3a);
  for (let i = 0; i < 5; i++) g.box(0, 0.95, -0.5 + i * 0.25, 0.04, 0.2, 0.03);
  pc.c(0xffffff, 0.04).mt(D.cloth).box(0.52, 1.05, 0, 0.02, 0.45, 0.5);
  pc.mt(0);
  return 2.2;
};

function tower(level: number): Maker {
  return (g, pc, p) => {
    const w = 0.72 + level * 0.08;
    const h = 2.1 + level * 0.45;
    g.c(p.style === 'desert' ? p.wall2 : p.stone, 0.04).mt(D.stone);
    if (p.style === 'northern' && level < 2) g.cyl(0, -0.3, 0, w * 0.62, w * 0.55, h + 0.3, 10, { top: true });
    else g.box(0, -0.3, 0, w, h + 0.3, w, 0b111101);
    g.mt(0);
    windowAt(g, p, 0, h * 0.55, w / 2, 'z', 0.1);
    windowAt(g, p, w / 2, h * 0.7, 0, 'x', 0.1);
    door(g, p, 0, 0, w / 2, 0.18, 0.34);
    let top: number;
    if (level === 0) {
      // wooden hoarding platform with roof
      g.c(p.wood, 0.06).mt(D.planks).box(0, h, 0, w + 0.2, 0.28, w + 0.2);
      g.mt(0);
      top = roof(g, p, 0, h + 0.28, 0, w + 0.2, w + 0.2, 1.2);
    } else {
      g.c(p.style === 'desert' ? p.wall2 : p.stone, 0.05).mt(D.stone).box(0, h, 0, w + 0.14, 0.12, w + 0.14);
      g.crenels(0, h + 0.12, 0, w + 0.14, w + 0.14, 0.16, 0.12);
      g.mt(0);
      if (level === 2) {
        g.c(p.style === 'desert' ? p.wall2 : p.stone, 0.04).mt(D.stone).box(0, h + 0.12, 0, w * 0.6, 0.5, w * 0.6);
        g.mt(0);
        if (p.style === 'desert') top = dome(g, p, 0, h + 0.62, 0, w * 0.34);
        else if (p.style === 'northern') {
          g.c(p.roof, 0.06).mt(D.thatch).cone(0, h + 0.62, 0, w * 0.5, 0.7, 8, false);
          g.mt(0);
          top = h + 1.32;
        } else top = roof(g, p, 0, h + 0.62, 0, w * 0.62, w * 0.62, 1.4);
      } else top = h + 0.28;
    }
    flag(g, pc, w / 2 - 0.08, top - 0.05, -w / 2 + 0.08, 0.5 + level * 0.1, 0.2 + level * 0.03);
    return top + 0.5;
  };
}

const temple: Maker = (g, pc, p) => {
  if (p.style === 'mediterranean') {
    // classical temple on a stepped base
    for (let i = 0; i < 3; i++) {
      g.c(p.stone, 0.03).mt(D.stone).box(0, -0.3 + i * 0.1, 0, 2.7 - i * 0.14, 0.4 - (i ? 0.3 : 0), 2.3 - i * 0.14);
    }
    g.mt(0);
    const y0 = 0.2;
    walls(g, p, 0, y0, -0.1, 1.5, 1.1, 1.2, { frame: false, color: p.accent });
    const cols: [number, number][] = [];
    for (let i = 0; i < 6; i++) cols.push([-1.05 + i * 0.42, 0.85]);
    for (let i = 0; i < 6; i++) cols.push([-1.05 + i * 0.42, -0.95]);
    for (let i = 1; i < 4; i++) {
      cols.push([-1.05, 0.85 - i * 0.45]);
      cols.push([1.05, 0.85 - i * 0.45]);
    }
    for (const [x, z] of cols) post(g, p, x, y0, z, 1.1, 0.07);
    g.c(p.accent, 0.03).box(0, y0 + 1.1, -0.05, 2.3, 0.14, 1.95);
    g.c(p.roof, 0.05).mt(D.tiles).gable(0, y0 + 1.24, -0.05, 2.3, 0.42, 1.95, 0.06, p.accent);
    g.mt(0);
    door(g, p, 0, y0, 0.5, 0.35, 0.65);
    // altar with fire
    g.c(p.stone).box(0.6, 0.2, 1.05, 0.25, 0.25, 0.25);
    g.c(0xff8a2a).sphere(0.6, 0.5, 1.05, 0.07, 5, 4);
    banner(pc, g, -0.5, 1.2, 0.87, 0.2, 0.5, 'z');
    banner(pc, g, 0.5, 1.2, 0.87, 0.2, 0.5, 'z');
    return y0 + 1.66;
  }
  if (p.style === 'northern') {
    // druidic ring around a timber hall
    plinth(g, p, 2.9, 2.9, 0.03);
    walls(g, p, 0, 0, -0.2, 1.4, 0.8, 1.6);
    const top = roof(g, p, 0, 0.8, -0.2, 1.4, 1.6, 1.2);
    door(g, p, 0, 0, 0.6, 0.3, 0.55);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const x = Math.cos(a) * 1.25, z = Math.sin(a) * 1.25;
      if (Math.hypot(x, z - 0.6) < 0.4) continue;
      g.c(0x8a8880, 0.1).mt(D.stone).push().translate(x, 0, z).rotateY(-a).box(0, 0, 0, 0.14, 0.75 + (i % 3) * 0.12, 0.26).pop();
    }
    g.mt(0);
    // sacred oak and fire bowl
    g.c(0x5b4028).cyl(0.95, 0, 0.95, 0.06, 0.05, 0.6, 5);
    g.c(0x3b6a22, 0.15).blob(0.95, 0.8, 0.95, 0.32, 0.25, 0.9, 6);
    g.c(0x555555).cyl(-0.9, 0, 0.9, 0.1, 0.14, 0.15, 7);
    g.c(0xff8a2a).sphere(-0.9, 0.2, 0.9, 0.08, 5, 4);
    flag(g, pc, 0.55, 0.8, -0.95, 0.8);
    return top;
  }
  if (p.style === 'desert') {
    // fire temple (chahartaq): domed pavilion on four arches
    plinth(g, p, 2.9, 2.9, 0.15);
    const y0 = 0.15;
    for (const [x, z] of [[-0.75, -0.75], [0.75, -0.75], [-0.75, 0.75], [0.75, 0.75]])
      g.c(p.wall, 0.04).mt(D.plaster).box(x, y0, z, 0.55, 1.2, 0.55);
    g.c(p.wall, 0.04).mt(D.plaster).box(0, y0 + 1.2, 0, 2.05, 0.35, 2.05);
    g.mt(0);
    // arch shadows
    g.c(0x3a2a1a).box(0, y0, 0.78, 0.9, 0.95, 0.02).box(0.78, y0, 0, 0.02, 0.95, 0.9);
    g.c(p.trim).box(0, y0 + 1.2, 1.035, 2.05, 0.06, 0.02).box(1.035, y0 + 1.2, 0, 0.02, 0.06, 2.05);
    const top = dome(g, p, 0, y0 + 1.55, 0, 0.8, 0x3a8a9a);
    g.c(0x777777).cyl(0, y0, 0, 0.18, 0.22, 0.35, 8);
    g.c(0xff8a2a).sphere(0, y0 + 0.45, 0, 0.12, 6, 5);
    banner(pc, g, -0.4, y0 + 1.45, 1.05, 0.3, 0.4, 'z');
    banner(pc, g, 1.05, y0 + 1.45, -0.4, 0.3, 0.4, 'x');
    return top;
  }
  // eastern pagoda temple
  plinth(g, p, 2.9, 2.9, 0.18);
  let y = 0.18;
  let w = 1.6;
  for (let t = 0; t < 3; t++) {
    const h = t === 0 ? 0.8 : 0.5;
    walls(g, p, 0, y, 0, w, h, w);
    y = roof(g, p, 0, y + h, 0, w + 0.2, w + 0.2, 0.7);
    y -= 0.12;
    w *= 0.72;
  }
  g.c(p.accent).cyl(0, y, 0, 0.03, 0.02, 0.6, 5);
  for (let i = 0; i < 4; i++) g.sphere(0, y + 0.15 + i * 0.12, 0, 0.06 - i * 0.008, 6, 4);
  door(g, p, 0, 0.18, 0.8, 0.35, 0.55);
  g.c(0x777777).cyl(0.9, 0.18, 1.0, 0.1, 0.12, 0.25, 6);
  banner(pc, g, -0.5, 0.95, 0.82, 0.2, 0.55, 'z');
  banner(pc, g, 0.82, 0.95, -0.5, 0.2, 0.55, 'x');
  return y + 0.7;
};

const university: Maker = (g, pc, p) => {
  plinth(g, p, 3.8, 3.8, 0.1);
  const y0 = 0.1;
  walls(g, p, -0.3, y0, -0.3, 2.6, 1.3, 2.6);
  let top = roof(g, p, -0.3, y0 + 1.3, -0.3, 2.6, 2.6, 0.8);
  // observatory dome / tower
  if (p.style === 'northern') {
    g.c(p.stone, 0.04).mt(D.stone).cyl(-1.1, y0, -1.1, 0.45, 0.42, 2.4, 10);
    g.c(p.roof, 0.06).mt(D.thatch).cone(-1.1, y0 + 2.4, -1.1, 0.55, 0.8, 10, false);
    g.mt(0);
    top = Math.max(top, y0 + 3.2);
  } else {
    g.c(p.wall2, 0.04).mt(D.plaster).cyl(-0.3, top - 0.15, -0.3, 0.6, 0.6, 0.35, 12);
    g.mt(0);
    top = dome(g, p, -0.3, top + 0.2, -0.3, 0.58, p.style === 'desert' ? 0x3a8a9a : p.style === 'eastern' ? p.roof : 0xb8b0a0);
  }
  // front colonnade
  for (let i = 0; i < 6; i++) post(g, p, -1.55 + i * 0.55, y0, 1.35, 1.1, 0.06);
  for (let i = 0; i < 5; i++) post(g, p, 1.35, y0, -1.55 + i * 0.55, 1.1, 0.06);
  g.c(p.style === 'mediterranean' ? p.accent : p.trim, 0.04).box(-0.1, y0 + 1.1, 1.35, 3.3, 0.12, 0.2).box(1.35, y0 + 1.1, -0.2, 0.2, 0.12, 3.1);
  door(g, p, -0.3, y0, 1.0, 0.5, 0.8);
  for (const o of [-1.2, 0.6]) windowAt(g, p, o, 0.75, 1.0, 'z', 0.22);
  for (const o of [-1.2, 0.2]) windowAt(g, p, 1.0, 0.75, o, 'x', 0.22);
  // scrolls & globe
  g.c(0x8a6a40).box(1.6, y0, 1.6, 0.3, 0.3, 0.3);
  g.c(0x4a7ab0).sphere(1.6, y0 + 0.42, 1.6, 0.12, 8, 6);
  banner(pc, g, -1.0, 1.1, 1.02, 0.35, 0.5, 'z');
  banner(pc, g, 1.02, 1.1, -1.0, 0.35, 0.5, 'x');
  return top;
};

const siegeWorkshop: Maker = (g, pc, p) => {
  plinth(g, p, 3.8, 3.8, 0.05);
  walls(g, p, -0.6, 0, -1.3, 2.6, 1.2, 1.0);
  roof(g, p, -0.6, 1.2, -1.3, 2.6, 1.0);
  const top = shed(g, p, -0.3, 0.1, 3.0, 1.6, 1.35);
  // crane
  g.c(p.wood, 0.06);
  g.push().translate(1.3, 0, 1.3).rotateZ(0.12).box(0, 0, 0, 0.08, 2.4, 0.08).pop();
  g.push().translate(1.3, 2.2, 1.3).rotateZ(-1.1).box(0, 0, 0, 0.06, 1.2, 0.06).pop();
  g.c(0x3a2a1a).box(0.55, 1.4, 1.3, 0.02, 0.9, 0.02);
  g.c(0x8a8a8a).box(0.55, 1.3, 1.3, 0.14, 0.12, 0.14);
  // half-built mangonel
  g.c(0x7a5a38, 0.06).box(-0.5, 0.1, 0.9, 0.7, 0.1, 0.5).push().translate(-0.5, 0.2, 0.9).rotateZ(0.6).box(0, 0, 0, 0.06, 0.8, 0.06).pop();
  g.c(0x4a3420).push().translate(-0.85, 0.15, 1.15).rotateX(Math.PI / 2).cyl(0, 0, 0, 0.15, 0.15, 0.05, 10).pop();
  logPile(g, 0.3, 1.5, 3, 1.0);
  // big wheel leaning
  g.c(0x4a3420).push().translate(1.6, 0.3, 0.2).rotateZ(Math.PI / 2 - 0.25).cyl(0, 0, 0, 0.3, 0.3, 0.06, 12).pop();
  flag(g, pc, -1.7, 1.2, -1.7, 0.9);
  banner(pc, g, -0.6, 1.1, -0.78, 0.5, 0.35, 'z');
  return top;
};

const castle: Maker = (g, pc, p) => {
  plinth(g, p, 3.9, 3.9, 0.08);
  const col = p.style === 'desert' ? p.wall2 : p.stone;
  const wallH = 1.5;
  // curtain walls
  g.c(col, 0.04).mt(D.stone);
  g.box(0, 0.08, 1.55, 3.2, wallH, 0.5).box(0, 0.08, -1.55, 3.2, wallH, 0.5).box(1.55, 0.08, 0, 0.5, wallH, 3.2).box(-1.55, 0.08, 0, 0.5, wallH, 3.2);
  g.crenels(0, 0.08 + wallH, 0, 3.6, 3.6, 0.17, 0.15);
  g.mt(0);
  // gate
  g.c(0x2a1c12).box(0, 0.08, 1.81, 0.6, 0.85, 0.03);
  g.c(0x3a3a3a);
  for (let i = 0; i < 4; i++) g.box(-0.21 + i * 0.14, 0.08, 1.83, 0.03, 0.85, 0.02);
  g.c(col, 0.05).mt(D.stone).box(0, 0.93, 1.8, 0.8, 0.12, 0.06);
  g.mt(0);
  // keep
  const kh = 2.6;
  g.c(col, 0.04).mt(D.stone).box(-0.2, 0.08, -0.2, 1.7, kh, 1.7, 0b111101);
  g.mt(0);
  let top: number;
  if (p.style === 'mediterranean') {
    g.c(col, 0.05).mt(D.stone).crenels(-0.2, 0.08 + kh, -0.2, 1.7, 1.7, 0.18, 0.14);
    g.mt(0);
    top = roof(g, p, -0.2, 0.08 + kh, -0.2, 1.3, 1.3, 1.1);
  } else if (p.style === 'northern') {
    top = roof(g, p, -0.2, 0.08 + kh, -0.2, 1.7, 1.7, 0.9);
  } else if (p.style === 'desert') {
    g.c(col, 0.05).mt(D.stone).crenels(-0.2, 0.08 + kh, -0.2, 1.7, 1.7, 0.18, 0.14);
    g.mt(0);
    top = dome(g, p, -0.2, 0.08 + kh, -0.2, 0.62, 0x3a8a9a);
  } else {
    top = roof(g, p, -0.2, 0.08 + kh, -0.2, 1.8, 1.8, 0.8);
    walls(g, p, -0.2, top - 0.25, -0.2, 0.9, 0.5, 0.9, { color: p.wall });
    top = roof(g, p, -0.2, top + 0.25, -0.2, 1.1, 1.1, 0.8);
  }
  for (const o of [-0.6, 0.2]) {
    windowAt(g, p, o, 1.9, 0.65, 'z', 0.14);
    windowAt(g, p, 0.65, 1.9, o, 'x', 0.14);
  }
  // corner towers
  const th = 2.2;
  for (const [x, z] of [[-1.55, -1.55], [1.55, -1.55], [-1.55, 1.55], [1.55, 1.55]]) {
    g.c(col, 0.04).mt(D.stone);
    if (p.style === 'northern' || p.style === 'mediterranean' && false) g.cyl(x, 0.08, z, 0.48, 0.45, th, 10);
    else g.box(x, 0.08, z, 0.85, th, 0.85, 0b111101);
    g.mt(0);
    if (p.style === 'northern') {
      g.c(p.roof, 0.06).mt(D.thatch).cone(x, 0.08 + th, z, 0.55, 0.75, 10, false);
      g.mt(0);
    } else if (p.style === 'desert') {
      g.c(col, 0.05).mt(D.stone).crenels(x, 0.08 + th, z, 0.85, 0.85, 0.15, 0.12);
      g.mt(0);
      dome(g, p, x, 0.08 + th, z, 0.3, 0x3a8a9a);
    } else if (p.style === 'eastern') {
      roof(g, p, x, 0.08 + th, z, 0.8, 0.8, 1.1);
    } else {
      g.c(col, 0.05).mt(D.stone).crenels(x, 0.08 + th, z, 0.85, 0.85, 0.15, 0.12);
      g.mt(0);
      g.c(p.roof, 0.05).mt(D.tiles).hip(x, 0.08 + th + 0.12, z, 0.7, 0.4, 0.7, 0.05);
      g.mt(0);
    }
    windowAt(g, p, x, 1.4, z + 0.43, 'z', 0.1);
    windowAt(g, p, x + 0.43, 1.4, z, 'x', 0.1);
  }
  flag(g, pc, -0.2, top - 0.1, -0.2, 0.9, 0.42);
  flag(g, pc, 1.55, 2.6, 1.55, 0.6, 0.26);
  flag(g, pc, -1.55, 2.6, 1.55, 0.6, 0.26);
  flag(g, pc, 1.55, 2.6, -1.55, 0.6, 0.26);
  banner(pc, g, -0.2, 2.2, 0.66, 0.5, 0.7, 'z');
  banner(pc, g, 0.66, 2.2, -0.2, 0.5, 0.7, 'x');
  return top + 0.9;
};

const wonder: Maker = (g, pc, p) => {
  plinth(g, p, 4.9, 4.9, 0.15);
  if (p.style === 'desert') {
    // Meroitic steep pyramid with chapel
    g.c(p.stone, 0.03).mt(D.stone);
    const base = 3.6, h = 4.2;
    g.push().translate(-0.3, 0.15, -0.3).rotateY(Math.PI / 4);
    g.cyl(0, 0, 0, base / Math.SQRT2 * 1.0, 0.08, h, 4, { smooth: false, top: true });
    g.pop();
    g.mt(0);
    g.c(0xd4a93a).push().translate(-0.3, 0.15 + h - 0.1, -0.3).rotateY(Math.PI / 4).cone(0, 0, 0, 0.16, 0.3, 4, false).pop();
    walls(g, p, 0.9, 0.15, 1.3, 1.2, 1.0, 0.9);
    roof(g, p, 0.9, 1.15, 1.3, 1.2, 0.9);
    g.c(p.wall2).box(0.9, 0.15, 1.78, 1.5, 1.4, 0.2);
    door(g, p, 0.9, 0.15, 1.88, 0.35, 0.8);
    for (const x of [-1.6, 1.8]) for (const z of [1.9]) g.c(0x9a8a70).box(x, 0.15, z, 0.3, 0.5, 0.5);
    flag(g, pc, 1.6, 1.15, 1.0, 1.0);
    flag(g, pc, 0.2, 1.15, 1.0, 1.0);
    return 4.6;
  }
  if (p.style === 'eastern') {
    let y = 0.15;
    let w = 2.8;
    for (let t = 0; t < 5; t++) {
      const h = t === 0 ? 1.0 : 0.6;
      walls(g, p, 0, y, 0, w, h, w);
      y = roof(g, p, 0, y + h, 0, w + 0.3, w + 0.3, 0.55) - 0.15;
      w *= 0.8;
    }
    g.c(p.accent).cyl(0, y, 0, 0.05, 0.03, 1.0, 6);
    for (let i = 0; i < 6; i++) g.sphere(0, y + 0.2 + i * 0.13, 0, 0.09 - i * 0.01, 6, 4);
    door(g, p, 0, 0.15, 1.4, 0.5, 0.8);
    banner(pc, g, -0.8, 1.1, 1.42, 0.3, 0.7, 'z');
    banner(pc, g, 0.8, 1.1, 1.42, 0.3, 0.7, 'z');
    return y + 1.2;
  }
  if (p.style === 'northern') {
    // great hall ringed by a henge
    walls(g, p, -0.2, 0.15, -0.3, 2.6, 1.4, 1.8, { mat: D.logs });
    const top = roof(g, p, -0.2, 1.55, -0.3, 2.6, 1.8, 1.3);
    // carved dragon heads at gable ends
    g.c(0x4e331c).push().translate(1.25, top - 0.1, -0.3).rotateZ(-0.5).box(0, 0, 0, 0.08, 0.5, 0.08).pop();
    g.push().translate(-1.65, top - 0.1, -0.3).rotateZ(0.5).box(0, 0, 0, 0.08, 0.5, 0.08).pop();
    door(g, p, -0.2, 0.15, 0.6, 0.5, 0.9);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const x = Math.cos(a) * 2.15, z = Math.sin(a) * 2.15;
      g.c(0x8a8880, 0.1).mt(D.stone).push().translate(x, 0.15, z).rotateY(-a).box(0, 0, 0, 0.2, 1.1 + (i % 2) * 0.3, 0.32).pop();
      if (i % 2 === 0) {
        const a2 = ((i + 1) / 16) * Math.PI * 2;
        g.push().translate((x + Math.cos(a2) * 2.15) / 2, 1.55, (z + Math.sin(a2) * 2.15) / 2).rotateY(-(a + a2) / 2 + Math.PI / 2).box(0, 0, 0, 0.9, 0.18, 0.26).pop();
      }
    }
    g.mt(0);
    flag(g, pc, 1.0, 1.55, 0.5, 1.2, 0.4);
    flag(g, pc, -1.4, 1.55, 0.5, 1.2, 0.4);
    return top + 0.5;
  }
  // Mediterranean: Temple of Melqart on a grand platform with a golden roof
  for (let i = 0; i < 4; i++) g.c(p.stone, 0.03).mt(D.stone).box(0, 0.15 + i * 0.2, 0, 4.4 - i * 0.3, 0.2, 4.2 - i * 0.3);
  g.mt(0);
  const y0 = 0.95;
  walls(g, p, 0, y0, -0.2, 2.2, 1.7, 2.4, { color: p.accent, frame: false });
  const cols: [number, number][] = [];
  for (let i = 0; i < 8; i++) cols.push([-1.55 + i * 0.443, 1.45], [-1.55 + i * 0.443, -1.75]);
  for (let i = 1; i < 7; i++) cols.push([-1.55, 1.45 - i * 0.457], [1.55, 1.45 - i * 0.457]);
  for (const [x, z] of cols) post(g, p, x, y0, z, 1.7, 0.1);
  g.c(p.accent, 0.03).box(0, y0 + 1.7, -0.15, 3.3, 0.2, 3.4);
  g.c(0xd4a93a, 0.08).gable(0, y0 + 1.9, -0.15, 3.3, 0.65, 3.4, 0.08, p.accent);
  door(g, p, 0, y0, 0.97, 0.5, 1.0);
  // statues and braziers
  for (const x of [-1.2, 1.2]) {
    g.c(p.stone).box(x, 0.15, 2.0, 0.3, 0.3, 0.3);
    g.c(0xd4a93a).cyl(x, 0.45, 2.0, 0.1, 0.12, 0.5, 6).sphere(x, 1.0, 2.0, 0.08, 6, 4);
  }
  banner(pc, g, -0.8, y0 + 1.6, 1.5, 0.35, 0.9, 'z');
  banner(pc, g, 0.8, y0 + 1.6, 1.5, 0.35, 0.9, 'z');
  return y0 + 2.6;
};

const dock: Maker = (g, pc, p) => {
  // pier on piles over the water; the model's y=0 is the water surface
  g.c(0x4a3420, 0.06);
  for (const x of [-1.3, -0.45, 0.45, 1.3]) for (const z of [-1.3, -0.45, 0.45, 1.3]) g.cyl(x, -1.2, z, 0.07, 0.07, 1.45, 6);
  g.c(0x8a6a42, 0.06).mt(D.planks).box(0, 0.15, 0, 2.9, 0.1, 2.9);
  g.mt(0);
  g.c(0x5a3e24).box(0, 0.25, 1.43, 2.9, 0.05, 0.05).box(1.43, 0.25, 0, 0.05, 0.05, 2.9);
  for (const x of [-1.4, -0.7, 0, 0.7, 1.4]) g.cyl(x, 0.25, 1.43, 0.03, 0.03, 0.22, 4);
  // storehouse at the back
  walls(g, p, -0.55, 0.25, -0.65, 1.5, 0.75, 1.3);
  const top = roof(g, p, -0.55, 1.0, -0.65, 1.5, 1.3);
  door(g, p, -0.55, 0.25, 0.0, 0.3, 0.5);
  // crane
  g.c(p.wood, 0.06).cyl(1.0, 0.25, -0.9, 0.06, 0.05, 1.5, 6);
  g.push().translate(1.0, 1.7, -0.9).rotateZ(-1.2).box(0, 0, 0, 0.05, 1.0, 0.05).pop();
  g.c(0x3a2a1a).box(1.85, 1.2, -0.9, 0.015, 0.6, 0.015);
  // barrels & fish baskets
  barrel(g, 1.05, 0.25, 0.7, 0.1);
  barrel(g, 0.8, 0.25, 0.95, 0.1);
  g.c(0xa88450, 0.06).mt(D.thatch).cyl(0.4, 0.25, 1.0, 0.12, 0.14, 0.12, 7);
  g.mt(0);
  g.c(0xb8c0c8).sphere(0.4, 0.4, 1.0, 0.06, 5, 3, 1.5, 0.6, 1);
  flag(g, pc, 1.3, 0.25, 1.3, 1.1, 0.3);
  return top;
};

const MAKERS: Record<string, Maker> = {
  dock,
  house, townCenter, barracks, archeryRange, stable, blacksmith, market, mill, lumberCamp, miningCamp, farm, outpost,
  palisade, stoneWall, gate, watchTower: tower(0), guardTower: tower(1), keep: tower(2), monastery: temple, university,
  siegeWorkshop, castle, wonder,
};

const cache = new Map<string, BuildingModel>();

export function buildingModel(type: string, style: ArchStyle): BuildingModel {
  const key = type + ':' + style;
  const c = cache.get(key);
  if (c) return c;
  const g = new GeoBuilder(type.length * 31 + style.length);
  const pc = new GeoBuilder(5);
  g.aoHeight = 0.6;
  const maker = MAKERS[type] ?? house;
  const height = maker(g, pc, PALS[style]);
  const sails = (g as unknown as { _sails?: BuildingModel['sails'] })._sails;
  let pcGeo = pc.build();
  if (type === 'farm') pcGeo = farmCrops();
  const model: BuildingModel = { main: g.build(), pc: pcGeo, height, sails };
  cache.set(key, model);
  return model;
}

/** Scaffolding frame for construction sites. */
export function scaffoldModel(w: number, d: number, h: number): THREE.BufferGeometry {
  const g = new GeoBuilder(3);
  const hw = w / 2 - 0.05, hd = d / 2 - 0.05;
  g.c(0x8a6a44, 0.1);
  const nx = Math.max(2, Math.round(w / 0.8)), nz = Math.max(2, Math.round(d / 0.8));
  for (let i = 0; i <= nx; i++) {
    const x = -hw + (i * 2 * hw) / nx;
    g.cyl(x, 0, hd, 0.025, 0.025, h, 4).cyl(x, 0, -hd, 0.025, 0.025, h, 4);
  }
  for (let i = 1; i < nz; i++) {
    const z = -hd + (i * 2 * hd) / nz;
    g.cyl(hw, 0, z, 0.025, 0.025, h, 4).cyl(-hw, 0, z, 0.025, 0.025, h, 4);
  }
  for (let y = 0.5; y < h; y += 0.55) {
    g.box(0, y, hd, w - 0.1, 0.03, 0.03).box(0, y, -hd, w - 0.1, 0.03, 0.03);
    g.box(hw, y, 0, 0.03, 0.03, d - 0.1).box(-hw, y, 0, 0.03, 0.03, d - 0.1);
    g.c(0x9a7a50, 0.1).box(0, y + 0.02, hd - 0.12, w - 0.2, 0.02, 0.2);
    g.c(0x8a6a44, 0.1);
  }
  // diagonal braces
  g.push().translate(0, h / 2, hd).rotateZ(Math.atan2(h, w) ).box(0, -h / 2, 0, 0.03, Math.hypot(w, h) * 0.9, 0.03).pop();
  return g.build();
}

/** Foundation (dirt pad with stakes) for buildings under construction. */
export function foundationModel(w: number, d: number): THREE.BufferGeometry {
  const g = new GeoBuilder(4);
  g.c(0x7a5a3a, 0.06).box(0, -0.25, 0, w - 0.05, 0.28, d - 0.05);
  g.c(0x5a3e24, 0.1);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.cyl(x * (w / 2 - 0.1), 0, z * (d / 2 - 0.1), 0.03, 0.02, 0.25, 4);
  g.c(0xe0d8c0).box(0, 0.18, d / 2 - 0.1, w - 0.2, 0.01, 0.01).box(0, 0.18, -d / 2 + 0.1, w - 0.2, 0.01, 0.01).box(w / 2 - 0.1, 0.18, 0, 0.01, 0.01, d - 0.2).box(-w / 2 + 0.1, 0.18, 0, 0.01, 0.01, d - 0.2);
  return g.build();
}
