import * as THREE from 'three';
import { Noise2D } from '../util/noise';
import { RNG } from '../util/rng';

/** Simple float RGBA pixel buffer with wrap-around drawing helpers for tileable textures. */
class Pix {
  readonly w: number;
  readonly h: number;
  d: Float32Array;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.d = new Float32Array(w * h * 4);
  }
  set(x: number, y: number, r: number, g: number, b: number, a = 1): void {
    x = ((x % this.w) + this.w) % this.w;
    y = ((y % this.h) + this.h) % this.h;
    const i = (y * this.w + x) * 4;
    this.d[i] = r;
    this.d[i + 1] = g;
    this.d[i + 2] = b;
    this.d[i + 3] = a;
  }
  blend(x: number, y: number, r: number, g: number, b: number, a: number, height?: number): void {
    x = ((Math.round(x) % this.w) + this.w) % this.w;
    y = ((Math.round(y) % this.h) + this.h) % this.h;
    const i = (y * this.w + x) * 4;
    const d = this.d;
    d[i] += (r - d[i]) * a;
    d[i + 1] += (g - d[i + 1]) * a;
    d[i + 2] += (b - d[i + 2]) * a;
    if (height !== undefined) d[i + 3] += (height - d[i + 3]) * a;
  }
  get(x: number, y: number): [number, number, number, number] {
    x = ((x % this.w) + this.w) % this.w;
    y = ((y % this.h) + this.h) % this.h;
    const i = (y * this.w + x) * 4;
    return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]];
  }
  dot(cx: number, cy: number, r: number, c: number[], a: number, height?: number): void {
    const R = Math.ceil(r);
    for (let y = -R; y <= R; y++)
      for (let x = -R; x <= R; x++) {
        const d = Math.hypot(x, y);
        if (d > r) continue;
        const f = a * Math.min(1, (r - d) * 1.5);
        this.blend(cx + x, cy + y, c[0], c[1], c[2], f, height);
      }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: number[], a: number, height?: number): void {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 1.5) + 1;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.blend(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, c[0], c[1], c[2], a, height);
    }
  }
  /** Wrap-around 3x3 box blur. */
  blur(passes = 1): void {
    for (let p = 0; p < passes; p++) {
      const src = new Float32Array(this.d);
      for (let y = 0; y < this.h; y++)
        for (let x = 0; x < this.w; x++) {
          for (let c = 0; c < 4; c++) {
            let s = 0;
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                const xx = (x + dx + this.w) % this.w, yy = (y + dy + this.h) % this.h;
                s += src[(yy * this.w + xx) * 4 + c];
              }
            this.d[(y * this.w + x) * 4 + c] = s / 9;
          }
        }
    }
  }
  toBytes(out: Uint8Array, offset: number): void {
    const d = this.d;
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      out[offset + i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
    }
  }
}

const c255 = (r: number, g: number, b: number): number[] => [r / 255, g / 255, b / 255];

/** Periodic fbm via sampling the noise on a circle-mapped torus approximation. */
function tileNoise(n: Noise2D, x: number, y: number, period: number, freq: number, oct = 4): number {
  return n.fbmTile((x / period) * freq, (y / period) * freq, freq, oct);
}

function baseFill(p: Pix, n: Noise2D, cA: number[], cB: number[], freq: number, contrast = 1.0, height = 0.5): void {
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      let v = tileNoise(n, x, y, p.w, freq, 4) * contrast;
      v += tileNoise(n, x + 1000, y, p.w, freq * 4, 2) * 0.35;
      const t = Math.min(1, Math.max(0, v * 0.9 + 0.5));
      p.set(x, y, cA[0] + (cB[0] - cA[0]) * t, cA[1] + (cB[1] - cA[1]) * t, cA[2] + (cB[2] - cA[2]) * t, height);
    }
}

function grainNoise(p: Pix, rng: RNG, amt: number): void {
  for (let i = 0; i < p.d.length; i += 4) {
    const k = (rng.next() - 0.5) * amt;
    p.d[i] += k;
    p.d[i + 1] += k;
    p.d[i + 2] += k;
  }
}

export const TERRAIN_TEX_SIZE = 256;

/** Terrain detail textures in the order of terrain ids (see sim/map.ts T). */
export function makeTerrainTextures(seed = 7): THREE.DataArrayTexture {
  const S = TERRAIN_TEX_SIZE;
  const layers = 11;
  const data = new Uint8Array(S * S * 4 * layers);
  const rng = new RNG(seed);
  const n = new Noise2D(seed);

  const grass = (lush: boolean): Pix => {
    const p = new Pix(S, S);
    if (lush) baseFill(p, n, c255(52, 92, 30), c255(96, 132, 48), 3, 1.2, 0.5);
    else baseFill(p, n, c255(118, 116, 58), c255(162, 146, 82), 3, 1.1, 0.45);
    for (let i = 0; i < 9000; i++) {
      const x = rng.range(0, S), y = rng.range(0, S);
      const a = rng.range(-0.6, 0.6) - Math.PI / 2;
      const l = rng.range(2, 5);
      const light = rng.chance(0.5);
      const col = lush
        ? (light ? c255(128, 168, 66) : c255(38, 72, 22))
        : (light ? c255(190, 172, 104) : rng.chance(0.4) ? c255(92, 110, 46) : c255(104, 92, 50));
      p.line(x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, col, 0.35, light ? 0.8 : 0.6);
    }
    for (let i = 0; i < (lush ? 40 : 15); i++) {
      const c = rng.pick([c255(230, 220, 90), c255(240, 240, 235), c255(200, 120, 190)]);
      p.dot(rng.range(0, S), rng.range(0, S), 1, c, 0.8, 0.9);
    }
    return p;
  };

  const dirt = (): Pix => {
    const p = new Pix(S, S);
    baseFill(p, n, c255(92, 66, 42), c255(136, 104, 70), 4, 1.2, 0.3);
    for (let i = 0; i < 700; i++) {
      const r = rng.range(0.6, 2.2);
      const c = rng.chance(0.5) ? c255(160, 140, 112) : c255(70, 52, 36);
      p.dot(rng.range(0, S), rng.range(0, S), r, c, 0.6, rng.chance(0.5) ? 0.55 : 0.25);
    }
    for (let i = 0; i < 25; i++) {
      let x = rng.range(0, S), y = rng.range(0, S);
      let a = rng.range(0, Math.PI * 2);
      for (let k = 0; k < 12; k++) {
        const nx = x + Math.cos(a) * 3, ny = y + Math.sin(a) * 3;
        p.line(x, y, nx, ny, c255(64, 46, 30), 0.3, 0.1);
        x = nx;
        y = ny;
        a += rng.range(-0.8, 0.8);
      }
    }
    grainNoise(p, rng, 0.05);
    return p;
  };

  const sand = (): Pix => {
    const p = new Pix(S, S);
    baseFill(p, n, c255(196, 168, 110), c255(226, 204, 148), 3, 0.9, 0.35);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const w = Math.sin((x + y * 0.3) * (Math.PI * 2 / 16) + tileNoise(n, x, y, S, 2, 2) * 4);
        p.blend(x, y, 0.62, 0.52, 0.34, Math.max(0, w) * 0.12);
      }
    grainNoise(p, rng, 0.07);
    for (let i = 0; i < 200; i++) p.dot(rng.range(0, S), rng.range(0, S), rng.range(0.5, 1.2), c255(150, 130, 96), 0.5);
    return p;
  };

  const forest = (): Pix => {
    const p = new Pix(S, S);
    baseFill(p, n, c255(46, 56, 26), c255(88, 76, 42), 4, 1.2, 0.6);
    for (let i = 0; i < 2600; i++) {
      const c = rng.pick([c255(122, 84, 40), c255(96, 62, 30), c255(84, 96, 38), c255(150, 110, 50), c255(60, 80, 30)]);
      const x = rng.range(0, S), y = rng.range(0, S);
      const a = rng.range(0, Math.PI);
      const l = rng.range(1.5, 3.5);
      p.line(x - Math.cos(a) * l, y - Math.sin(a) * l, x + Math.cos(a) * l, y + Math.sin(a) * l, c, 0.55, 0.7);
    }
    grainNoise(p, rng, 0.06);
    return p;
  };

  const bed = (a: number[], b: number[]): Pix => {
    const p = new Pix(S, S);
    baseFill(p, n, a, b, 3, 1, 0.3);
    for (let i = 0; i < 300; i++) p.dot(rng.range(0, S), rng.range(0, S), rng.range(0.6, 2), c255(120, 112, 90), 0.4);
    grainNoise(p, rng, 0.05);
    return p;
  };

  const snow = (): Pix => {
    const p = new Pix(S, S);
    baseFill(p, n, c255(200, 210, 225), c255(245, 247, 252), 3, 1, 0.5);
    grainNoise(p, rng, 0.04);
    return p;
  };

  const road = (): Pix => {
    const p = new Pix(S, S);
    baseFill(p, n, c255(70, 60, 48), c255(90, 78, 60), 4, 1, 0.1);
    const cell = 16;
    for (let cy = 0; cy < S / cell; cy++)
      for (let cx = 0; cx < S / cell; cx++) {
        const ox = cx * cell + rng.range(3, cell - 3), oy = cy * cell + rng.range(3, cell - 3);
        const r = rng.range(5, 7.5);
        const shade = rng.range(0.8, 1.15);
        const base = c255(150 * shade, 138 * shade, 118 * shade);
        p.dot(ox, oy, r, base, 0.95, 0.8);
        p.dot(ox - 1.5, oy - 1.5, r * 0.5, c255(180 * shade, 170 * shade, 150 * shade), 0.4, 0.9);
      }
    grainNoise(p, rng, 0.05);
    return p;
  };

  const textures = [
    grass(true), // grass
    grass(false), // dryGrass
    dirt(), // dirt
    sand(), // sand
    forest(), // forest
    bed(c255(150, 138, 100), c255(176, 164, 124)), // shallows
    bed(c255(96, 96, 76), c255(120, 116, 90)), // water bed
    bed(c255(56, 66, 64), c255(76, 86, 82)), // deep bed
    snow(), // snow
    road(), // road
    bed(c255(96, 88, 76), c255(132, 124, 108)), // rock (steep slopes)
  ];
  textures.forEach((p, i) => p.toBytes(data, i * S * S * 4));
  // same height encoding as the photo textures: alpha in 128..255
  for (let i = 3; i < data.length; i += 4) data[i] = 128 + (data[i] >> 1);
  const tex = new THREE.DataArrayTexture(data, S, S, layers);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export const DETAIL = {
  none: 0,
  stone: 1,
  planks: 2,
  thatch: 3,
  tiles: 4,
  plaster: 5,
  brick: 6,
  logs: 7,
  cloth: 8,
} as const;

/** Grayscale detail maps for building surfaces, sampled triplanar in object space. */
export function makeDetailTextures(seed = 11): THREE.DataArrayTexture {
  const S = 128;
  const layers = 8;
  const data = new Uint8Array(S * S * 4 * layers);
  const rng = new RNG(seed);
  const n = new Noise2D(seed + 3);
  const gray = (p: Pix, x: number, y: number, v: number): void => p.set(x, y, v, v, v, 1);
  const base = (p: Pix, mean: number, amp: number, freq: number): void => {
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) gray(p, x, y, mean + tileNoise(n, x, y, S, freq, 3) * amp);
  };
  const addGrain = (p: Pix, amt: number): void => grainNoise(p, rng, amt);

  // 1: stone blocks (4 rows per unit of 64px -> blocks 16px tall)
  const stone = new Pix(S, S);
  base(stone, 0.52, 0.06, 4);
  {
    const rowH = 16;
    for (let r = 0; r < S / rowH; r++) {
      const off = (r % 2) * 12 + rng.int(0, 6);
      let x = off;
      while (x < off + S) {
        const bw = rng.int(18, 30);
        const shade = rng.range(-0.07, 0.07);
        for (let yy = r * rowH; yy < (r + 1) * rowH; yy++)
          for (let xx = x; xx < x + bw; xx++) {
            const [v] = stone.get(xx, yy);
            gray(stone, xx, yy, v + shade);
          }
        // mortar
        for (let yy = r * rowH; yy < (r + 1) * rowH; yy++) gray(stone, x, yy, 0.32);
        x += bw;
      }
      for (let xx = 0; xx < S; xx++) {
        gray(stone, xx, r * rowH, 0.3);
        const [v] = stone.get(xx, r * rowH + 1);
        gray(stone, xx, r * rowH + 1, v + 0.06);
      }
    }
    addGrain(stone, 0.06);
  }
  // 2: planks (vertical boards)
  const planks = new Pix(S, S);
  {
    const bw = 11;
    for (let x = 0; x < S; x++) {
      const board = Math.floor(x / bw);
      const shade = ((board * 7919) % 13) / 13 * 0.1 - 0.05;
      for (let y = 0; y < S; y++) {
        const grain = Math.sin(y * 0.15 + board * 3 + tileNoise(n, x * 4, y, S, 2, 2) * 3) * 0.04;
        let v = 0.52 + shade + grain;
        if (x % bw === 0) v = 0.3;
        gray(planks, x, y, v);
      }
    }
    addGrain(planks, 0.05);
  }
  // 3: thatch (vertical straw streaks with layered rows)
  const thatch = new Pix(S, S);
  {
    base(thatch, 0.5, 0.05, 3);
    for (let i = 0; i < 2600; i++) {
      const x = rng.range(0, S), y = rng.range(0, S);
      const l = rng.range(6, 14);
      const v = rng.range(0.35, 0.7);
      thatch.line(x, y, x + rng.range(-1, 1), y + l, [v, v, v], 0.5);
    }
    for (let r = 0; r < 8; r++) for (let x = 0; x < S; x++) {
      const y = r * 16 + Math.round(Math.sin(x * 0.2) * 1.5);
      const [v] = thatch.get(x, y);
      gray(thatch, x, y, v * 0.7);
    }
  }
  // 4: roof tiles (rows of curved tiles)
  const tiles = new Pix(S, S);
  {
    const tw = 10, th = 12;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const row = Math.floor(y / th);
        const xo = (x + (row % 2) * (tw / 2)) % tw;
        const u = xo / tw;
        const vy = (y % th) / th;
        let v = 0.45 + Math.sin(u * Math.PI) * 0.18 - vy * 0.1;
        if (vy > 0.85) v = 0.3;
        if (xo < 0.8) v = 0.32;
        gray(tiles, x, y, v + tileNoise(n, x, y, S, 3, 2) * 0.04);
      }
    addGrain(tiles, 0.04);
  }
  // 5: plaster
  const plaster = new Pix(S, S);
  base(plaster, 0.53, 0.05, 3);
  for (let i = 0; i < 10; i++) {
    let x = rng.range(0, S), y = rng.range(0, S);
    let a = rng.range(0, Math.PI * 2);
    for (let k = 0; k < 6; k++) {
      const nx = x + Math.cos(a) * 2.5, ny = y + Math.sin(a) * 2.5;
      plaster.line(x, y, nx, ny, [0.4, 0.4, 0.4], 0.4);
      x = nx;
      y = ny;
      a += rng.range(-0.9, 0.9);
    }
  }
  addGrain(plaster, 0.04);
  // 6: brick
  const brick = new Pix(S, S);
  {
    const bh = 8, bw = 16;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const row = Math.floor(y / bh);
        const xo = (x + (row % 2) * (bw / 2)) % bw;
        const id = Math.floor((x + (row % 2) * (bw / 2)) / bw) * 31 + row * 17;
        let v = 0.5 + (((id * 2654435761) >>> 0) % 100) / 100 * 0.12 - 0.06;
        if (y % bh === 0 || xo === 0) v = 0.33;
        gray(brick, x, y, v);
      }
    addGrain(brick, 0.05);
  }
  // 7: logs (horizontal rounded logs)
  const logs = new Pix(S, S);
  {
    const lh = 14;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const vy = (y % lh) / lh;
        let v = 0.36 + Math.sin(vy * Math.PI) * 0.22;
        v += Math.sin(x * 0.4 + Math.floor(y / lh) * 2 + tileNoise(n, x, y * 3, S, 2, 2) * 2) * 0.03;
        gray(logs, x, y, v);
      }
    addGrain(logs, 0.04);
  }
  // 8: cloth
  const cloth = new Pix(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) gray(cloth, x, y, 0.52 + ((x + y) % 4 === 0 ? -0.03 : 0.01) + tileNoise(n, x, y, S, 2, 2) * 0.05);

  [stone, planks, thatch, tiles, plaster, brick, logs, cloth].forEach((p, i) => p.toBytes(data, i * S * S * 4));
  const tex = new THREE.DataArrayTexture(data, S, S, layers);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Tileable value noise used for macro variation of the terrain. */
export function makeNoiseTexture(seed = 5): THREE.DataTexture {
  const S = 256;
  const n = new Noise2D(seed);
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      data[i] = Math.round((tileNoise(n, x, y, S, 4, 4) * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((tileNoise(n, x + 500, y, S, 8, 3) * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((tileNoise(n, x, y + 500, S, 16, 2) * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
