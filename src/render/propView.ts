import * as THREE from 'three';
import type { Game } from '../sim/game';
import type { ResourceNode } from '../sim/entities';
import { berryModel, carcassModel, felledModel, fishModel, goldModel, relicModel, stoneModel, TREE_VARIANTS } from './models/nature';
import { bushLeaves, felledLeaves, treeParts } from './models/foliage';
import { makeWorldMaterial } from './materials';
import { InstBatch } from './instBatch';

const TREE_SUBS = 3;

/** Per-tree foliage tint: brightness plus a slight shift between yellow-green and blue-green. */
function leafTint(hash: number): number {
  const f = 0.84 + ((hash >>> 8) % 41) / 255;
  const w = (((hash >>> 16) % 21) - 10) / 110;
  const r = Math.min(255, Math.round(255 * f * (1 + w)));
  const g = Math.round(255 * f);
  const b = Math.min(255, Math.round(255 * f * (1 - w * 0.6)));
  return (r << 16) | (g << 8) | b;
}

/** Trees, mines, bushes, carcasses and relics. */
export class PropView {
  group = new THREE.Group();
  private trees: InstBatch[] = [];
  private leaves: InstBatch[] = [];
  private felled: InstBatch[] = [];
  private felledLeaves: InstBatch[] = [];
  private gold: InstBatch[] = [];
  private stone: InstBatch[] = [];
  private berries: InstBatch[] = [];
  private berryLeaves: InstBatch[] = [];
  private carcass = new Map<string, InstBatch>();
  private relic: InstBatch;
  private fish: InstBatch;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private staticDirty = true;
  private lastResVersion = -1;
  private lastVisionVersion = -1;
  private unseen: ResourceNode[] | null = null;
  private matTree = makeWorldMaterial({ fog: 'origin', sway: true });
  private matLeaves = makeWorldMaterial({ fog: 'origin', sway: true, leaves: true });
  private matLeavesStill = makeWorldMaterial({ fog: 'origin', leaves: true });
  private mat = makeWorldMaterial({ fog: 'origin' });

  constructor() {
    for (let v = 0; v < TREE_VARIANTS; v++) {
      for (let s = 0; s < TREE_SUBS; s++) {
        const parts = treeParts(v, s);
        this.trees.push(new InstBatch(this.group, parts.trunk, this.matTree, { cap: 512, color: true }));
        this.leaves.push(new InstBatch(this.group, parts.leaves, this.matLeaves, { cap: 512, color: true, noAO: true }));
      }
      this.felled.push(new InstBatch(this.group, felledModel(v), this.mat, { cap: 64 }));
      this.felledLeaves.push(new InstBatch(this.group, felledLeaves(v), this.matLeavesStill, { cap: 64, noAO: true }));
    }
    for (let s = 0; s < 3; s++) {
      this.gold.push(new InstBatch(this.group, goldModel(s), this.mat, { cap: 64 }));
      this.stone.push(new InstBatch(this.group, stoneModel(s), this.mat, { cap: 64 }));
    }
    for (let s = 0; s < 2; s++) {
      this.berries.push(new InstBatch(this.group, berryModel(s), this.mat, { cap: 64 }));
      this.berryLeaves.push(new InstBatch(this.group, bushLeaves(s), this.matLeavesStill, { cap: 64, noAO: true }));
    }
    for (const k of ['sheep', 'deer', 'boar']) this.carcass.set(k, new InstBatch(this.group, carcassModel(k), this.mat, { cap: 16, shadow: false }));
    this.relic = new InstBatch(this.group, relicModel(), this.mat, { cap: 16 });
    this.fish = new InstBatch(this.group, fishModel(), this.mat, { cap: 128, shadow: false });
  }

  markDirty(): void {
    this.staticDirty = true;
  }

  update(game: Game, localTeam: number): void {
    const exp = game.vision.explored.get(localTeam);
    const n = game.map.n;
    if (game.resourcesVersion !== this.lastResVersion) {
      this.lastResVersion = game.resourcesVersion;
      this.staticDirty = true;
      this.unseen = null;
    }
    if (game.vision.version !== this.lastVisionVersion) {
      this.lastVisionVersion = game.vision.version;
      if (!this.unseen) this.unseen = game.resources.filter((r) => r.alive && !r.seen);
      let changed = false;
      const keep: ResourceNode[] = [];
      for (const r of this.unseen) {
        if (!r.alive) continue;
        if (!exp || exp[r.tz * n + r.tx]) {
          r.seen = true;
          changed = true;
        } else keep.push(r);
      }
      this.unseen = keep;
      if (changed) this.staticDirty = true;
    }
    if (this.staticDirty) {
      this.staticDirty = false;
      for (const b of this.trees) b.begin();
      for (const b of this.leaves) b.begin();
      for (const b of this.felled) b.begin();
      for (const b of this.felledLeaves) b.begin();
      for (const r of game.resources) {
        if (!r.alive || r.type !== 'tree' || !r.seen) continue;
        const y = game.map.heightAt(r.x, r.z);
        const v = Math.min(TREE_VARIANTS - 1, r.variant);
        if (r.felled) {
          this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r.fellAngle);
          this.m.compose(this.p.set(r.x, y, r.z), this.q, this.s.set(1, 1, 1));
          this.felled[v].add(this.m);
          this.felledLeaves[v].add(this.m);
        } else {
          this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r.rot);
          const sc = r.scale;
          this.m.compose(this.p.set(r.x, y - 0.05, r.z), this.q, this.s.set(sc, sc * (0.92 + (r.id % 7) * 0.03), sc));
          const hash = (r.id * 2654435761) >>> 0;
          const tint = 0xd8d8d8 + (hash % 0x28) * 0x010101;
          const k = v * TREE_SUBS + (r.id % TREE_SUBS);
          this.trees[k].add(this.m, tint);
          this.leaves[k].add(this.m, leafTint(hash));
        }
      }
      for (const b of this.trees) b.end();
      for (const b of this.leaves) b.end();
      for (const b of this.felled) b.end();
      for (const b of this.felledLeaves) b.end();
    }
    // dynamic resources: every frame
    for (const b of this.gold) b.begin();
    for (const b of this.stone) b.begin();
    for (const b of this.berries) b.begin();
    for (const b of this.berryLeaves) b.begin();
    for (const b of this.carcass.values()) b.begin();
    this.relic.begin();
    this.fish.begin();
    const now = performance.now() / 1000;
    const vis = game.vision.visible.get(localTeam);
    for (const r of game.resources) {
      if (!r.alive || r.type === 'tree') continue;
      if (r.type === 'relic') {
        if (r.heldBy) continue;
        const tx = Math.floor(r.x), tz = Math.floor(r.z);
        if (exp && !exp[tz * n + tx]) continue;
        this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r.rot);
        this.m.compose(this.p.set(r.x, game.map.heightAt(r.x, r.z), r.z), this.q, this.s.set(1, 1, 1));
        this.relic.add(this.m);
        continue;
      }
      if (!r.seen) continue;
      if (r.type === 'fish') {
        const count = Math.max(1, Math.ceil((r.amount / r.maxAmount) * 5));
        for (let k = 0; k < count; k++) {
          const a = now * (0.5 + (k % 3) * 0.15) + k * 1.3 + r.id;
          const rad = 0.18 + (k % 2) * 0.12;
          this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -a);
          this.m.compose(this.p.set(r.x + Math.cos(a) * rad, game.map.waterLevel - 0.05 - (k % 3) * 0.04, r.z + Math.sin(a) * rad), this.q, this.s.set(1, 1, 1));
          this.fish.add(this.m);
        }
        continue;
      }
      const frac = r.maxAmount > 0 ? r.amount / r.maxAmount : 1;
      const y = game.map.heightAt(r.x, r.z);
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r.rot + r.id * 1.7);
      if (r.type === 'gold' || r.type === 'stone') {
        const sc = 0.55 + 0.5 * Math.sqrt(frac);
        this.m.compose(this.p.set(r.x, y, r.z), this.q, this.s.set(sc * 1.05, sc, sc * 1.05));
        (r.type === 'gold' ? this.gold : this.stone)[r.id % 3].add(this.m);
      } else if (r.type === 'berries') {
        const sc = 0.75 + 0.25 * frac;
        this.m.compose(this.p.set(r.x, y, r.z), this.q, this.s.set(sc, sc, sc));
        this.berries[r.id % 2].add(this.m);
        this.berryLeaves[r.id % 2].add(this.m);
      } else if (r.type === 'carcass') {
        if (vis && !vis[Math.floor(r.z) * n + Math.floor(r.x)]) continue;
        const kind = r.carcassOf === 'sheep' ? 'sheep' : r.carcassOf === 'deer' ? 'deer' : 'boar';
        const sc = 0.6 + 0.5 * Math.sqrt(Math.max(0, frac));
        this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r.rot);
        this.m.compose(this.p.set(r.x, y, r.z), this.q, this.s.set(sc, sc, sc));
        this.carcass.get(kind)!.add(this.m);
      }
    }
    for (const b of this.gold) b.end();
    for (const b of this.stone) b.end();
    for (const b of this.berries) b.end();
    for (const b of this.berryLeaves) b.end();
    for (const b of this.carcass.values()) b.end();
    this.relic.end();
    this.fish.end();
  }
}
