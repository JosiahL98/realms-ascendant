import { RNG } from './rng';

/** Seeded 2D simplex noise with fractal helpers. Output of noise2 is roughly in [-1, 1]. */
export class Noise2D {
  private perm = new Uint8Array(512);
  private gx = new Float32Array(12);
  private gy = new Float32Array(12);

  constructor(seed: number) {
    const rng = new RNG(seed);
    const p: number[] = [];
    for (let i = 0; i < 256; i++) p.push(i);
    rng.shuffle(p);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    const grads = [
      [1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0],
      [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7],
    ];
    grads.forEach((g, i) => {
      this.gx[i] = g[0];
      this.gy[i] = g[1];
    });
  }

  noise2(xin: number, yin: number): number {
    const F2 = 0.5 * (Math.sqrt(3) - 1);
    const G2 = (3 - Math.sqrt(3)) / 6;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    const perm = this.perm;
    let n0 = 0, n1 = 0, n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const gi = perm[ii + perm[jj]] % 12;
      t0 *= t0;
      n0 = t0 * t0 * (this.gx[gi] * x0 + this.gy[gi] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const gi = perm[ii + i1 + perm[jj + j1]] % 12;
      t1 *= t1;
      n1 = t1 * t1 * (this.gx[gi] * x1 + this.gy[gi] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const gi = perm[ii + 1 + perm[jj + 1]] % 12;
      t2 *= t2;
      n2 = t2 * t2 * (this.gx[gi] * x2 + this.gy[gi] * y2);
    }
    return 70 * (n0 + n1 + n2);
  }

  /** Fractal Brownian motion, output roughly in [-1, 1]. */
  fbm(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise2(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  /** Tileable fbm over a period (used for seamless textures). */
  fbmTile(x: number, y: number, period: number, octaves = 4): number {
    // Blend 4 samples for seamless wrap.
    const u = x / period, v = y / period;
    const a = this.fbm(x, y, octaves);
    const b = this.fbm(x - period, y, octaves);
    const c = this.fbm(x, y - period, octaves);
    const d = this.fbm(x - period, y - period, octaves);
    const ab = a * (1 - u) + b * u;
    const cd = c * (1 - u) + d * u;
    return ab * (1 - v) + cd * v;
  }
}
