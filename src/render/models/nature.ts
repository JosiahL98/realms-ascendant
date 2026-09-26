import * as THREE from 'three';
import { GeoBuilder } from '../geo';
import { DETAIL } from '../textures';

export const TREE_VARIANTS = 4;

/** Returns [treeGeometry, felledLogGeometry] for a tree variant. */
export function treeModel(variant: number, sub: number): THREE.BufferGeometry {
  const g = new GeoBuilder(100 + variant * 17 + sub * 3);
  g.aoHeight = 0.5;
  switch (variant) {
    case 0: {
      // broadleaf oak
      g.c(0x5b4028, 0.06).cyl(0, 0, 0, 0.11, 0.07, 1.15, 6, { smooth: true });
      g.push().translate(0, 0.9, 0).rotateZ(0.7).c(0x5b4028).cyl(0, 0, 0, 0.05, 0.03, 0.45, 5).pop();
      g.push().translate(0, 0.85, 0).rotateZ(-0.6).rotateY(1.2).cyl(0, 0, 0, 0.05, 0.03, 0.42, 5).pop();
      const greens = [0x3b6a22, 0x4a7a2a, 0x557f2e, 0x2f5a1c];
      const blobs: [number, number, number, number][] = [
        [0, 1.55, 0, 0.62], [0.32, 1.35, 0.12, 0.45], [-0.3, 1.38, -0.1, 0.46], [0.08, 1.4, -0.34, 0.42], [-0.1, 1.95, 0.08, 0.42],
      ];
      blobs.forEach(([x, y, z, r], i) => g.c(greens[(i + sub) % greens.length], 0.16).blob(x, y, z, r * (0.95 + sub * 0.05), 0.22, 0.85, 7));
      break;
    }
    case 1: {
      // pine
      g.c(0x4e3620, 0.05).cyl(0, 0, 0, 0.09, 0.05, 0.7, 6);
      const tiers = 4 + (sub % 2);
      for (let i = 0; i < tiers; i++) {
        const t = i / tiers;
        const r = 0.62 * (1 - t * 0.75);
        const y = 0.35 + i * 0.42;
        g.c(i % 2 ? 0x24442a : 0x2c5230, 0.12).cyl(0, y, 0, r, r * 0.12, 0.7, 7, { smooth: false, top: true, bottom: true, rot: i * 0.4 });
      }
      g.c(0x24442a, 0.1).cone(0, 0.35 + tiers * 0.42, 0, 0.14, 0.35, 6, false);
      break;
    }
    case 2: {
      // palm
      let x = 0, z = 0;
      const lean = 0.07 + sub * 0.03;
      for (let i = 0; i < 6; i++) {
        g.c(i % 2 ? 0x8a6a42 : 0x7a5c38, 0.05).cyl(x, i * 0.3, z, 0.075, 0.065, 0.31, 6);
        x += lean;
      }
      const top = 1.8;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + sub;
        const dx = Math.cos(a), dz = Math.sin(a);
        g.c(i % 2 ? 0x4b862c : 0x3d7424, 0.12);
        const len = 0.95;
        const mid: [number, number, number] = [x + dx * len * 0.55, top + 0.12, z + dz * len * 0.55];
        const tip: [number, number, number] = [x + dx * len, top - 0.35, z + dz * len];
        const w = 0.16;
        const px = -dz * w, pz = dx * w;
        g.tri([x, top, z], [mid[0] + px, mid[1], mid[2] + pz], [mid[0] - px, mid[1], mid[2] - pz]);
        g.tri([x, top, z], [mid[0] - px, mid[1], mid[2] - pz], [mid[0] + px, mid[1], mid[2] + pz]);
        g.tri(tip, [mid[0] - px, mid[1], mid[2] - pz], [mid[0] + px, mid[1], mid[2] + pz]);
        g.tri(tip, [mid[0] + px, mid[1], mid[2] + pz], [mid[0] - px, mid[1], mid[2] - pz]);
      }
      g.c(0x5a3a1a, 0.1).sphere(x + 0.06, top - 0.05, z, 0.06, 5, 4).sphere(x - 0.05, top - 0.07, z + 0.04, 0.06, 5, 4);
      break;
    }
    default: {
      // Mediterranean cypress / olive
      if (sub % 2 === 0) {
        g.c(0x4a3420, 0.05).cyl(0, 0, 0, 0.07, 0.05, 0.4, 5);
        g.c(0x2d4a24, 0.14).blob(0, 1.25, 0, 0.3, 0.14, 3.2, 8);
      } else {
        g.c(0x6a5a44, 0.08).cyl(0, 0, 0, 0.12, 0.08, 0.7, 6);
        g.push().translate(0.03, 0.6, 0).rotateZ(0.5).cyl(0, 0, 0, 0.06, 0.04, 0.4, 5).pop();
        g.c(0x6b7d48, 0.18).blob(0, 1.0, 0, 0.55, 0.3, 0.6, 7).blob(0.3, 0.95, 0.2, 0.35, 0.3, 0.7, 6).blob(-0.25, 1.05, -0.15, 0.38, 0.3, 0.7, 6);
      }
    }
  }
  return g.build();
}

export function felledModel(variant: number): THREE.BufferGeometry {
  const g = new GeoBuilder(7 + variant);
  const bark = variant === 2 ? 0x8a6a42 : variant === 1 ? 0x4e3620 : 0x5b4028;
  g.c(bark, 0.05).cyl(0, 0, 0, 0.1, 0.08, 0.12, 6);
  g.c(0xc9a36a, 0.03).cyl(0, 0.12, 0, 0.1, 0.1, 0.005, 6);
  g.push().translate(0, 0.1, 0.06).rotateX(Math.PI / 2 - 0.08);
  g.c(bark, 0.06).cyl(0, 0, 0, 0.1, 0.07, 1.15, 6);
  g.pop();
  return g.build();
}

export function goldModel(sub: number): THREE.BufferGeometry {
  const g = new GeoBuilder(300 + sub);
  g.c(0x6e6048, 0.12).blob(0, 0.12, 0, 0.44, 0.25, 0.5, 7);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + sub;
    const r = 0.2 + (i % 3) * 0.08;
    g.c(i % 2 ? 0xe8c030 : 0xd6a41c, 0.15).blob(Math.cos(a) * r, 0.2 + (i % 2) * 0.06, Math.sin(a) * r, 0.13 + (i % 3) * 0.03, 0.3, 0.8, 5);
  }
  g.c(0xf2d24a, 0.12).blob(0, 0.36, 0, 0.16, 0.3, 0.9, 5);
  return g.build();
}

export function stoneModel(sub: number): THREE.BufferGeometry {
  const g = new GeoBuilder(400 + sub);
  const cols = [0x9c9a92, 0x88857c, 0xaaa79c, 0x7c7a72];
  g.c(cols[sub % 4], 0.12).blob(0, 0.15, 0, 0.42, 0.3, 0.6, 6);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + sub * 0.7;
    g.c(cols[(i + sub) % 4], 0.14).blob(Math.cos(a) * 0.27, 0.16, Math.sin(a) * 0.27, 0.18 + (i % 2) * 0.05, 0.35, 0.8, 5);
  }
  g.c(0xb8b5aa, 0.1).blob(0.05, 0.38, -0.02, 0.17, 0.3, 0.8, 5);
  return g.build();
}

/** Dark core and berries of a forage bush; the leaves are cards (see bushLeaves). */
export function berryModel(sub: number): THREE.BufferGeometry {
  const g = new GeoBuilder(500 + sub);
  g.c(0x24421c, 0.15).blob(0, 0.26, 0, 0.3, 0.2, 0.75, 7);
  g.c(0x203c1a, 0.15).blob(0.16, 0.2, 0.13, 0.2, 0.2, 0.8, 6);
  const rng = (i: number) => ((Math.sin(i * 91.7 + sub * 13.1) * 43758.5453) % 1 + 1) % 1;
  for (let i = 0; i < 20; i++) {
    const th = rng(i) * Math.PI * 2, ph = 0.25 + rng(i + 50) * 1.15;
    const r = 0.38 + rng(i + 90) * 0.08;
    const x = Math.cos(th) * Math.sin(ph) * r, y = 0.28 + Math.cos(ph) * r * 0.72, z = Math.sin(th) * Math.sin(ph) * r;
    g.c(i % 3 ? 0xc0203e : 0x7a1a60, 0.1).sphere(x, y, z, 0.05, 5, 3);
  }
  return g.build();
}

export function carcassModel(kind: string): THREE.BufferGeometry {
  const g = new GeoBuilder(600);
  const col = kind === 'sheep' ? 0xe8e4d8 : kind === 'deer' ? 0x9a6a3c : 0x4a3a30;
  g.c(col, 0.08).sphere(0, 0.14, 0, 0.3, 7, 5, 1.2, 0.5, 0.75);
  g.c(0x9a2a24, 0.1).sphere(0.1, 0.2, 0.05, 0.14, 6, 4, 1.2, 0.5, 1);
  g.c(col, 0.08).sphere(-0.38, 0.1, 0, 0.12, 6, 4);
  g.c(0x3a2a20).cyl(0.1, 0.05, 0.2, 0.025, 0.02, 0.3, 4).cyl(-0.12, 0.05, 0.22, 0.025, 0.02, 0.28, 4);
  return g.build();
}

export function fishModel(): THREE.BufferGeometry {
  const g = new GeoBuilder(900);
  g.c(0xb8c4cc, 0.08).sphere(0, 0, 0, 0.06, 6, 4, 0.5, 0.5, 1.6);
  g.c(0x8a98a4).tri([0, 0, -0.08], [0, 0.04, -0.14], [0, -0.04, -0.14]).tri([0, 0, -0.08], [0, -0.04, -0.14], [0, 0.04, -0.14]);
  return g.build();
}

export function relicModel(): THREE.BufferGeometry {
  const g = new GeoBuilder(700);
  g.c(0xd4a93a, 0.08).box(0, 0, 0, 0.36, 0.22, 0.26);
  g.c(0xb8862a, 0.06).gable(0, 0.22, 0, 0.36, 0.12, 0.26, 0.02);
  g.c(0xf4e2a0, 0.05).sphere(0, 0.36, 0, 0.05, 6, 4);
  g.c(0x8a2020).box(0, 0.08, 0.131, 0.1, 0.08, 0.005);
  g.c(0x2050a0).box(0.12, 0.08, 0.131, 0.05, 0.05, 0.005).box(-0.12, 0.08, 0.131, 0.05, 0.05, 0.005);
  return g.build();
}

export function rubbleModel(): THREE.BufferGeometry {
  const g = new GeoBuilder(800);
  const cols = [0x6a625a, 0x7a7068, 0x5a4a3a, 0x8a8278, 0x4a3a2a];
  g.c(0x4a4038, 0.1).blob(0, 0, 0, 0.45, 0.2, 0.25, 8);
  for (let i = 0; i < 14; i++) {
    const a = i * 2.4, r = 0.1 + (i % 5) * 0.08;
    g.c(cols[i % cols.length], 0.15).blob(Math.cos(a) * r, 0.04, Math.sin(a) * r, 0.07 + (i % 3) * 0.03, 0.4, 0.7, 5);
  }
  g.c(0x3a2a1a, 0.1).push().translate(0.1, 0.08, 0).rotateZ(1.3).rotateY(0.6).box(0, 0, 0, 0.04, 0.5, 0.04).pop();
  g.push().translate(-0.15, 0.06, 0.1).rotateX(1.4).rotateY(-0.4).box(0, 0, 0, 0.035, 0.45, 0.035).pop();
  return g.build();
}

/** Flat ground marker ring used for selection circles. */
export function ringGeometry(inner: number, outer: number, seg = 32): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(inner, outer, seg);
  g.rotateX(-Math.PI / 2);
  return g;
}

export const DETAIL_IDS = DETAIL;
