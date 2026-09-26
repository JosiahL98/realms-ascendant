import * as THREE from 'three';
import type { Game } from '../sim/game';
import type { ResourceNode } from '../sim/entities';
import { berryModel, carcassModel, felledModel, goldModel, relicModel, stoneModel, treeModel, TREE_VARIANTS } from './models/nature';
import { makeWorldMaterial } from './materials';
import { InstBatch } from './instBatch';

const TREE_SUBS = 3;

/** Trees, mines, bushes, carcasses and relics. */
export class PropView {
  group = new THREE.Group();
  private trees: InstBatch[] = [];
  private felled: InstBatch[] = [];
  private gold: InstBatch[] = [];
  private stone: InstBatch[] = [];
  private berries: InstBatch[] = [];
  private carcass = new Map<string, InstBatch>();
  private relic: InstBatch;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private staticDirty = true;
  private lastResVersion = -1;
  private lastVisionVersion = -1;
  private unseen: ResourceNode[] | null = null;
  private matTree = makeWorldMaterial({ fog: 'origin', sway: true });
  private mat = makeWorldMaterial({ fog: 'origin' });

  constructor() {
    for (let v = 0; v < TREE_VARIANTS; v++) {
      for (let s = 0; s < TREE_SUBS; s++) this.trees.push(new InstBatch(this.group, treeModel(v, s), this.matTree, { cap: 512, color: true }));
      this.felled.push(new InstBatch(this.group, felledModel(v), this.mat, { cap: 64 }));
    }
    for (let s = 0; s < 3; s++) {
      this.gold.push(new InstBatch(this.group, goldModel(s), this.mat, { cap: 64 }));
      this.stone.push(new InstBatch(this.group, stoneModel(s), this.mat, { cap: 64 }));
    }
    for (let s = 0; s < 2; s++) this.berries.push(new InstBatch(this.group, berryModel(s), this.mat, { cap: 64 }));
    for (const k of ['sheep', 'deer', 'boar']) this.carcass.set(k, new InstBatch(this.group, carcassModel(k), this.mat, { cap: 16, shadow: false }));
    this.relic = new InstBatch(this.group, relicModel(), this.mat, { cap: 16 });
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
      for (const b of this.felled) b.begin();
      for (const r of game.resources) {
        if (!r.alive || r.type !== 'tree' || !r.seen) continue;
        const y = game.map.heightAt(r.x, r.z);
        const v = Math.min(TREE_VARIANTS - 1, r.variant);
        if (r.felled) {
          this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r.fellAngle);
          this.m.compose(this.p.set(r.x, y, r.z), this.q, this.s.set(1, 1, 1));
          this.felled[v].add(this.m);
        } else {
          this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r.rot);
          const sc = r.scale;
          this.m.compose(this.p.set(r.x, y - 0.05, r.z), this.q, this.s.set(sc, sc * (0.92 + (r.id % 7) * 0.03), sc));
          const tint = 0xd8d8d8 + ((r.id * 2654435761) >>> 0) % 0x28 * 0x010101;
          this.trees[v * TREE_SUBS + (r.id % TREE_SUBS)].add(this.m, tint);
        }
      }
      for (const b of this.trees) b.end();
      for (const b of this.felled) b.end();
    }
    // dynamic resources: every frame
    for (const b of this.gold) b.begin();
    for (const b of this.stone) b.begin();
    for (const b of this.berries) b.begin();
    for (const b of this.carcass.values()) b.begin();
    this.relic.begin();
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
    for (const b of this.carcass.values()) b.end();
    this.relic.end();
  }
}
