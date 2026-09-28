import * as THREE from 'three';
import type { Game } from '../sim/game';
import type { Unit, AnimName, WorkTool } from '../sim/entities';
import { UNITS } from '../data/units';
import { lerpAngle } from '../util/math';
import { getRig, type Rig } from './models/units';
import { animate, activeVariant, BONE_STRIDE, type AnimState } from './anim';
import { makeWorldMaterial } from './materials';
import { getBakedRig } from './models/baked';
import { BakedUnits } from './bakedView';

interface Batch {
  rig: Rig;
  meshes: THREE.InstancedMesh[];
  capacity: number;
  count: number;
}

interface Corpse {
  type: string;
  model: string;
  owner: number;
  x: number;
  z: number;
  facing: number;
  t0: number;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class UnitView {
  group = new THREE.Group();
  private batches = new Map<string, Batch>();
  private pose = new Float32Array(40 * BONE_STRIDE);
  private world: THREE.Matrix4[] = [];
  private local = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private tmpColor = new THREE.Color();
  corpses: Corpse[] = [];
  private mat: THREE.MeshLambertMaterial;
  private matFade: THREE.MeshLambertMaterial;
  /** Screen-space info for picking, filled each frame. */
  drawn: Unit[] = [];
  /** Units modelled in Blender with baked animation (villagers, scout). */
  private baked: BakedUnits;

  constructor() {
    for (let i = 0; i < 40; i++) this.world.push(new THREE.Matrix4());
    this.mat = makeWorldMaterial({ fog: 'none', detail: true });
    this.matFade = this.mat;
    this.baked = new BakedUnits(this.group);
  }

  private batch(model: string): Batch {
    let b = this.batches.get(model);
    if (!b) {
      const rig = getRig(model);
      b = { rig, meshes: [], capacity: 0, count: 0 };
      this.batches.set(model, b);
      this.grow(b, 16);
    }
    return b;
  }

  private grow(b: Batch, cap: number): void {
    const old = b.meshes;
    b.meshes = b.rig.parts.map((part, k) => {
      const m = new THREE.InstancedMesh(part.geo, this.mat, cap);
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = false;
      m.count = 0;
      if (part.pc) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      const o = old[k];
      if (o) {
        (m.instanceMatrix.array as Float32Array).set(o.instanceMatrix.array as Float32Array);
        if (o.instanceColor && m.instanceColor) (m.instanceColor.array as Float32Array).set(o.instanceColor.array as Float32Array);
      }
      this.group.add(m);
      return m;
    });
    for (const m of old) {
      this.group.remove(m);
      m.dispose();
    }
    b.capacity = cap;
  }

  addCorpse(game: Game, type: string, owner: number, x: number, z: number, facing: number): void {
    const def = UNITS[type];
    if (!def) return;
    this.corpses.push({ type, model: def.model, owner, x, z, facing, t0: game.time });
  }

  update(game: Game, alpha: number, localTeam: number, inView: (x: number, z: number) => boolean, colorOf: (owner: number) => number): void {
    for (const b of this.batches.values()) b.count = 0;
    this.baked.begin();
    this.drawn.length = 0;
    const time = game.time;
    const vis = game.vision.visible.get(localTeam);
    const n = game.map.n;
    for (const u of game.units) {
      if (!u.alive || u.garrisonedIn) continue;
      const x = u.px + (u.x - u.px) * alpha;
      const z = u.pz + (u.z - u.pz) * alpha;
      if (!inView(x, z)) continue;
      if (game.teamOf[u.owner] !== localTeam && vis) {
        const tx = Math.floor(x), tz = Math.floor(z);
        if (tx < 0 || tz < 0 || tx >= n || tz >= n || !vis[tz * n + tx]) continue;
      }
      this.drawn.push(u);
      let model = u.def.model;
      if (model === 'villager' && u.id % 2 === 1) model = 'villagerF';
      const facing = lerpAngle(u.pfacing, u.facing, alpha);
      const y = u.def.naval ? game.map.waterLevel : u.def.animal ? game.map.heightAt(x, z) : Math.max(game.map.heightAt(x, z), game.map.waterLevel - 0.25);
      const moving = Math.abs(u.x - u.px) + Math.abs(u.z - u.pz) > 1e-4;
      const carry = u.carryAmount > 0.5 ? u.carryType : null;
      this.drawOne(model, x, y, z, facing, {
        anim: moving && u.anim !== 'attack' ? (u.anim === 'carry' ? 'carry' : 'walk') : u.anim,
        t: time - u.animStart + alpha * 0.05,
        time: time + alpha * 0.05,
        speed: u.stats.speed,
        moving,
        attackDelay: u.def.attackDelay ?? (u.stats.range > 0 ? 0.35 : 0.45),
        reload: u.stats.reload,
        tool: u.def.gatherer ? (u.anim === 'work' || u.order.t === 'gather' || u.order.t === 'build' || u.order.t === 'repair' ? u.tool : null) : null,
        seed: (u.id % 97) * 0.37,
        packed: u.packed,
        guard: !moving && u.cooldown > 0 && u.targetId !== 0,
      }, colorOf(u.owner), carry, u.relicId > 0, u.anim === 'work', 1);
    }
    // corpses
    const keep: Corpse[] = [];
    for (const c of this.corpses) {
      const age = time - c.t0;
      if (age > 14) continue;
      keep.push(c);
      if (!inView(c.x, c.z)) continue;
      const vx = Math.floor(c.x), vz = Math.floor(c.z);
      if (vis && game.teamOf[c.owner] !== localTeam && (vx < 0 || vz < 0 || vx >= n || vz >= n || !vis[vz * n + vx])) continue;
      const sink = age > 9 ? (age - 9) * 0.06 : 0;
      const naval = UNITS[c.type]?.naval;
      const y = (naval ? game.map.waterLevel : game.map.heightAt(c.x, c.z)) - sink;
      this.drawOne(c.model, c.x, y, c.z, c.facing, {
        anim: 'die', t: age, time, speed: 0, moving: false, attackDelay: 0.4, reload: 1, tool: null, seed: 0, packed: true,
      }, colorOf(c.owner), null, false, false, age > 9 ? Math.max(0.01, 1 - (age - 9) / 5) : 1);
    }
    this.corpses = keep;
    this.baked.end();
    for (const b of this.batches.values()) {
      for (const m of b.meshes) {
        m.count = b.count;
        m.visible = b.count > 0;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
  }

  private drawOne(model: string, x: number, y: number, z: number, facing: number, st: AnimState, color: number,
    carry: string | null, relic: boolean, working: boolean, scale: number): void {
    const baked = getBakedRig(model);
    if (baked) {
      this.baked.draw(baked, x, y, z, facing, st, color, carry, working, scale, relic);
      return;
    }
    const b = this.batch(model);
    if (b.count >= b.capacity) this.grow(b, b.capacity * 2);
    const idx = b.count++;
    const rig = b.rig;
    const nb = rig.bones.length;
    if (this.pose.length < nb * BONE_STRIDE) this.pose = new Float32Array(nb * BONE_STRIDE);
    animate(rig, st, this.pose);
    // root transform
    const root = this.world[0];
    this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, facing);
    root.compose(this.p.set(x, y, z), this.q, this.s.set(scale, scale, scale));
    // bones
    const pose = this.pose;
    for (let i = 0; i < nb; i++) {
      const bone = rig.bones[i];
      const o = i * BONE_STRIDE;
      this.e.set(pose[o], pose[o + 1], pose[o + 2]);
      this.q.setFromEuler(this.e);
      const sc = pose[o + 6];
      this.local.compose(this.p.set(bone.pivot[0] + pose[o + 3], bone.pivot[1] + pose[o + 4], bone.pivot[2] + pose[o + 5]), this.q, this.s.set(sc, sc, sc));
      const parent = bone.parent < 0 ? root : this.world[bone.parent + 1];
      this.world[i + 1].multiplyMatrices(parent, this.local);
    }
    this.tmpColor.setHex(color);
    for (let k = 0; k < rig.parts.length; k++) {
      const part = rig.parts[k];
      const mesh = b.meshes[k];
      const show = activeVariant(rig, part.variant, st.tool, carry, st.packed, relic, working);
      mesh.setMatrixAt(idx, show ? this.world[part.bone + 1] : ZERO);
      if (part.pc) mesh.setColorAt(idx, this.tmpColor);
    }
  }
}

export type { AnimName, WorkTool };
