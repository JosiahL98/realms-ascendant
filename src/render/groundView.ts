import * as THREE from 'three';
import type { Game } from '../sim/game';
import { T } from '../sim/map';
import { RNG } from '../util/rng';
import { makeWorldMaterial } from './materials';
import { GRASS_DRY, GRASS_FLOWERS, GRASS_GREEN, REEDS, bushLeaves, tuftGeometry } from './models/foliage';
import { pebbleModel } from './models/nature';

/** Tiles per side of a culling chunk. */
const CHUNK = 16;

interface DetailKind {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  scale: [number, number];
  /** Alpha-tested cards are left out of the ambient-occlusion pass. */
  cards: boolean;
  /** Brightness range and green/yellow hue jitter of the per-instance tint. */
  bright: [number, number];
  hue: number;
}

interface Layer {
  mesh: THREE.InstancedMesh;
  /** Every candidate instance; the mesh shows those whose tile is still free. */
  matrices: Float32Array;
  colors: Float32Array;
  tiles: Int32Array;
}

function hash2(x: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1). */
function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fz;
}

/**
 * Decorative ground clutter: grass tufts, flowers, reeds along shores, pebbles and small shrubs. Placement is
 * decided once from the terrain; tufts under buildings, farms and mines are hidden whenever buildings change.
 */
export class GroundDetailView {
  group = new THREE.Group();
  private layers: Layer[] = [];
  private lastBuildings = -1;

  constructor(game: Game) {
    const grassMat = makeWorldMaterial({ fog: 'origin', leaves: true, grass: true });
    const shrubMat = makeWorldMaterial({ fog: 'origin', leaves: true });
    const rockMat = makeWorldMaterial({ fog: 'origin' });
    const kinds: DetailKind[] = [
      { geo: tuftGeometry(GRASS_GREEN, 0.42, 0.3), mat: grassMat, scale: [0.7, 1.25], cards: true, bright: [0.92, 1.15], hue: 0.1 },
      { geo: tuftGeometry(GRASS_DRY, 0.42, 0.28), mat: grassMat, scale: [0.7, 1.2], cards: true, bright: [0.88, 1.08], hue: 0.05 },
      { geo: tuftGeometry(GRASS_FLOWERS, 0.34, 0.24), mat: grassMat, scale: [0.8, 1.15], cards: true, bright: [0.92, 1.05], hue: 0.03 },
      { geo: tuftGeometry(REEDS, 0.5, 0.55), mat: grassMat, scale: [0.75, 1.2], cards: true, bright: [0.85, 1.05], hue: 0.05 },
      { geo: pebbleModel(0), mat: rockMat, scale: [0.6, 1.3], cards: false, bright: [0.85, 1.1], hue: 0 },
      { geo: pebbleModel(1), mat: rockMat, scale: [0.6, 1.3], cards: false, bright: [0.85, 1.1], hue: 0 },
      { geo: bushLeaves(1), mat: shrubMat, scale: [0.45, 0.7], cards: true, bright: [0.8, 1.02], hue: 0.08 },
    ];
    const [GREEN, DRY, FLOWERS, REED, ROCK_A, ROCK_B, SHRUB] = [0, 1, 2, 3, 4, 5, 6];
    const map = game.map, n = map.n;
    const seed = game.setup.seed;
    const rng = new RNG(seed ^ 0x5eed);
    const isWet = (x: number, z: number) => {
      if (x < 0 || z < 0 || x >= n || z >= n) return false;
      const t = map.terrain[z * n + x];
      return t === T.water || t === T.deep || t === T.shallows;
    };
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const col = new THREE.Color();
    const density = new Float32Array(kinds.length);
    for (let cz = 0; cz < n; cz += CHUNK) {
      for (let cx = 0; cx < n; cx += CHUNK) {
        const lists = kinds.map(() => ({ m: [] as number[], c: [] as number[], t: [] as number[] }));
        let minY = Infinity, maxY = -Infinity;
        for (let z = cz; z < Math.min(n, cz + CHUNK); z++) {
          for (let x = cx; x < Math.min(n, cx + CHUNK); x++) {
            const i = z * n + x;
            const t = map.terrain[i];
            if (t === T.deep || t === T.road) continue;
            // reeds like muddy or grassy banks, not sandy beaches
            const marsh = (xx: number, zz: number) => {
              if (xx < 0 || zz < 0 || xx >= n || zz >= n || isWet(xx, zz)) return false;
              const lt = map.terrain[zz * n + xx];
              return lt !== T.sand && lt !== T.snow;
            };
            const marshy = marsh(x + 1, z) || marsh(x - 1, z) || marsh(x, z + 1) || marsh(x, z - 1);
            const nearLand = (xx: number, zz: number) => xx >= 0 && zz >= 0 && xx < n && zz < n && !isWet(xx, zz);
            if (t === T.water) {
              // reeds standing in the shallow margin of lakes and rivers
              const edge = nearLand(x + 1, z) || nearLand(x - 1, z) || nearLand(x, z + 1) || nearLand(x, z - 1);
              if (!edge || map.heightAt(x + 0.5, z + 0.5) < map.waterLevel - 0.35) continue;
            }
            density.fill(0);
            // patchy: bare stretches, then clumps of thick growth
            const lush = 1.6 * Math.pow(Math.max(0, valueNoise(x / 6, z / 6, seed) * 1.6 - 0.45), 1.3);
            const bloom = Math.max(0, valueNoise(x / 4, z / 4, seed + 7) * 2 - 1.1);
            const shore = !isWet(x, z) && (isWet(x + 1, z) || isWet(x - 1, z) || isWet(x, z + 1) || isWet(x, z - 1));
            switch (t) {
              case T.grass:
                density[GREEN] = 1.4 * lush;
                density[FLOWERS] = 0.9 * bloom;
                density[ROCK_A] = density[ROCK_B] = 0.015;
                density[SHRUB] = 0.03 * lush;
                break;
              case T.dryGrass:
                density[DRY] = 1.1 * lush;
                density[GREEN] = 0.2 * lush;
                density[ROCK_A] = density[ROCK_B] = 0.03;
                density[SHRUB] = 0.015;
                break;
              case T.dirt:
                density[DRY] = 0.25 * lush;
                density[ROCK_A] = density[ROCK_B] = 0.07;
                break;
              case T.sand:
                density[DRY] = 0.1 * lush;
                density[ROCK_A] = density[ROCK_B] = 0.025;
                break;
              case T.forest:
                density[SHRUB] = 0.2;
                density[GREEN] = 0.35 * lush;
                break;
              case T.snow:
                density[ROCK_A] = density[ROCK_B] = 0.03;
                break;
              case T.shallows:
                density[REED] = marshy ? 1.2 : 0.1;
                break;
              case T.water:
                density[REED] = marshy ? 0.3 + 0.9 * lush : 0.4 * lush;
                break;
            }
            if (shore && t !== T.snow) density[REED] = t === T.sand ? 0.35 * lush : 0.6 + 0.8 * lush;
            for (let k = 0; k < kinds.length; k++) {
              let count = Math.floor(density[k]);
              if (rng.next() < density[k] - count) count++;
              for (let j = 0; j < count; j++) {
                const px = x + rng.range(0.08, 0.92), pz = z + rng.range(0.08, 0.92);
                const y = map.heightAt(px, pz);
                const kd = kinds[k];
                const sc = rng.range(kd.scale[0], kd.scale[1]);
                q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rng.range(0, Math.PI * 2));
                m.compose(p.set(px, y - 0.01, pz), q, s.set(sc, sc * rng.range(0.85, 1.15), sc));
                const L = lists[k];
                for (const e of m.elements) L.m.push(e);
                const b = rng.range(kd.bright[0], kd.bright[1]), h = rng.range(-kd.hue, kd.hue);
                col.setRGB(b * (1 + h), b, b * (1 - h * 0.6));
                L.c.push(col.r, col.g, col.b);
                L.t.push(i);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y + 0.6);
              }
            }
          }
        }
        const center = new THREE.Vector3(cx + CHUNK / 2, (minY + maxY) / 2, cz + CHUNK / 2);
        const radius = Math.hypot(CHUNK / 2 + 0.5, CHUNK / 2 + 0.5, (maxY - minY) / 2 + 0.5);
        lists.forEach((L, k) => {
          const count = L.t.length;
          if (!count) return;
          const kd = kinds[k];
          const mesh = new THREE.InstancedMesh(kd.geo, kd.mat, count);
          mesh.castShadow = false;
          mesh.receiveShadow = true;
          if (kd.cards) mesh.userData.noAO = true;
          mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
          mesh.boundingSphere = new THREE.Sphere(center, radius);
          this.group.add(mesh);
          this.layers.push({ mesh, matrices: new Float32Array(L.m), colors: new Float32Array(L.c), tiles: new Int32Array(L.t) });
        });
      }
    }
    this.update(game);
  }

  /** Hide clutter on tiles taken by buildings, farms or mines. */
  update(game: Game): void {
    if (game.buildingsVersion === this.lastBuildings) return;
    this.lastBuildings = game.buildingsVersion;
    const map = game.map;
    const covered = (tile: number) => {
      if (map.farmAt[tile]) return true;
      const id = map.obstacle[tile];
      if (!id) return false;
      const e = game.entities.get(id);
      return !!e && (e.kind === 'building' || (e.kind === 'resource' && e.type !== 'tree'));
    };
    for (const L of this.layers) {
      const im = L.mesh.instanceMatrix.array as Float32Array;
      const ic = L.mesh.instanceColor!.array as Float32Array;
      let count = 0;
      for (let j = 0; j < L.tiles.length; j++) {
        if (covered(L.tiles[j])) continue;
        im.set(L.matrices.subarray(j * 16, j * 16 + 16), count * 16);
        ic.set(L.colors.subarray(j * 3, j * 3 + 3), count * 3);
        count++;
      }
      L.mesh.count = count;
      L.mesh.visible = count > 0;
      L.mesh.instanceMatrix.needsUpdate = true;
      L.mesh.instanceColor!.needsUpdate = true;
    }
  }
}
