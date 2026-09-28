import * as THREE from 'three';
import type { AnimState } from './anim';
import { BAKED_STRIDE, restPose, sampleClip, type BakedClip, type BakedRig } from './models/baked';
import { makeSkinDepthMaterial, makeWorldMaterial } from './materials';

/*
 * Draws the baked units (villagers, scout): every part is an InstancedMesh whose instances sit on their bone; skinned
 * parts also get per-instance skinning data (the extra bones' motion relative to the part, or the horse's joint
 * angles). Poses come from the baked clips, picked and timed from the unit's state.
 */

interface Batch {
  rig: BakedRig;
  meshes: THREE.InstancedMesh[];
  /** Per part: its per-instance skinning attributes (empty for rigid parts). */
  attrs: THREE.InstancedBufferAttribute[][];
  capacity: number;
  /** Units drawn this frame. */
  count: number;
  /** Instances per part this frame (a tool or load only gets the units that show it). */
  counts: number[];
}

export class BakedUnits {
  private batches = new Map<string, Batch>();
  private pose = new Float32Array(64 * BAKED_STRIDE);
  private world: THREE.Matrix4[] = [];
  private unit = new THREE.Matrix4();
  private local = new THREE.Matrix4();
  private inv = new THREE.Matrix4();
  private rel = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private d = new THREE.Vector3();
  private color = new THREE.Color();

  constructor(private group: THREE.Group) {
    for (let i = 0; i < 64; i++) this.world.push(new THREE.Matrix4());
  }

  begin(): void {
    for (const b of this.batches.values()) {
      b.count = 0;
      b.counts.fill(0);
    }
  }

  end(): void {
    for (const b of this.batches.values()) {
      for (let k = 0; k < b.meshes.length; k++) {
        const m = b.meshes[k];
        m.count = b.counts[k];
        m.visible = b.counts[k] > 0;
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
        for (const a of b.attrs[k]) a.needsUpdate = true;
      }
    }
  }

  private batch(rig: BakedRig): Batch {
    let b = this.batches.get(rig.id);
    if (!b) {
      b = { rig, meshes: [], attrs: [], capacity: 0, count: 0, counts: rig.parts.map(() => 0) };
      this.batches.set(rig.id, b);
      this.grow(b, 16);
    }
    return b;
  }

  private grow(b: Batch, cap: number): void {
    const rig = b.rig;
    const old = b.meshes;
    const oldAttrs = b.attrs;
    const pivots = rig.bendPivots.flatMap((v) => [v.x, v.y, v.z]);
    b.attrs = [];
    b.meshes = rig.parts.map((part, k) => {
      const mat = makeWorldMaterial({ fog: 'none', detail: true, ...(part.skin ? { skin: part.skin, bendPivots: part.skin === 'bend' ? pivots : undefined } : {}) });
      const m = new THREE.InstancedMesh(part.geo, mat, cap);
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = false;
      m.count = 0;
      if (part.skin) m.customDepthMaterial = makeSkinDepthMaterial(part.skin, part.skin === 'bend' ? pivots : undefined);
      if (part.pc) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      // per-instance skinning data lives on the part's geometry (one batch per model, so it is not shared)
      const attrs: THREE.InstancedBufferAttribute[] = [];
      const add = (name: string, size: number) => {
        const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size);
        const prev = oldAttrs[k]?.find((o) => (o as unknown as { name: string }).name === name);
        if (prev) a.array.set((prev.array as Float32Array).subarray(0, Math.min(prev.array.length, cap * size)));
        (a as unknown as { name: string }).name = name;
        part.geo.setAttribute(name, a);
        attrs.push(a);
      };
      if (part.skin === 'lbs') {
        add('iSkinQ0', 4); add('iSkinT0', 3); add('iSkinQ1', 4); add('iSkinT1', 3);
      } else if (part.skin === 'bend') {
        add('iBendA', 4); add('iBendB', 4);
      }
      b.attrs.push(attrs);
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

  /** Draws one unit (or corpse) of a baked model. */
  draw(rig: BakedRig, x: number, y: number, z: number, facing: number, st: AnimState, color: number,
    carry: string | null, working: boolean, scale: number, relic = false): void {
    scale *= rig.meta.scale ?? 1;
    const b = this.batch(rig);
    if (b.count >= b.capacity) this.grow(b, b.capacity * 2);
    b.count++;
    const nb = rig.bones.length;
    if (this.pose.length < nb * BAKED_STRIDE) this.pose = new Float32Array(nb * BAKED_STRIDE);
    while (this.world.length < nb) this.world.push(new THREE.Matrix4());
    restPose(this.pose, nb);
    for (const [clip, t] of pickClips(rig, st, carry, relic)) sampleClip(clip, t, this.pose);

    // bones
    this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, facing);
    this.unit.compose(this.p.set(x, y, z), this.q, this.s.set(scale, scale, scale));
    const pose = this.pose;
    for (let i = 0; i < nb; i++) {
      const bone = rig.bones[i];
      const o = i * BAKED_STRIDE;
      const pp = bone.parent >= 0 ? rig.bones[bone.parent].pivot : null;
      this.p.set(bone.pivot[0] - (pp ? pp[0] : 0) + pose[o + 4], bone.pivot[1] - (pp ? pp[1] : 0) + pose[o + 5], bone.pivot[2] - (pp ? pp[2] : 0) + pose[o + 6]);
      this.q.set(pose[o], pose[o + 1], pose[o + 2], pose[o + 3]);
      this.local.compose(this.p, this.q, this.one);
      this.world[i].multiplyMatrices(bone.parent >= 0 ? this.world[bone.parent] : this.unit, this.local);
    }

    // parts
    this.color.setHex(color);
    for (let k = 0; k < rig.parts.length; k++) {
      const part = rig.parts[k];
      const mesh = b.meshes[k];
      let show = true;
      if (part.variant.startsWith('tool:')) show = !carry && st.tool === part.variant.slice(5);
      else if (part.variant.startsWith('carry:')) show = !working && carry === part.variant.slice(6);
      else if (part.variant === 'relic') show = relic;
      else if (part.variant === 'packed') show = st.packed;      // the trebuchet on its cart
      else if (part.variant === 'unpacked') show = !st.packed;   // or standing
      if (!show) continue;
      const idx = b.counts[k]++;
      mesh.setMatrixAt(idx, this.world[part.bone]);
      if (part.pc) mesh.setColorAt(idx, this.color);
      const attrs = b.attrs[k];
      if (part.skin === 'lbs') {
        // each extra bone's motion seen from the part's bone: v' = r v + (r d + t), d = part pivot - bone pivot
        this.inv.copy(this.world[part.bone]).invert();
        const pv = rig.bones[part.bone].pivot;
        for (let j = 0; j < 2; j++) {
          const qa = attrs[j * 2].array as Float32Array, ta = attrs[j * 2 + 1].array as Float32Array;
          const sb = part.skinBones[j];
          if (sb === undefined) {
            qa.set([0, 0, 0, 1], idx * 4);
            ta.set([0, 0, 0], idx * 3);
            continue;
          }
          this.rel.multiplyMatrices(this.inv, this.world[sb]);
          this.rel.decompose(this.p, this.q, this.s);
          const bp = rig.bones[sb].pivot;
          this.d.set(pv[0] - bp[0], pv[1] - bp[1], pv[2] - bp[2]).applyQuaternion(this.q).add(this.p);
          qa[idx * 4] = this.q.x; qa[idx * 4 + 1] = this.q.y; qa[idx * 4 + 2] = this.q.z; qa[idx * 4 + 3] = this.q.w;
          ta[idx * 3] = this.d.x; ta[idx * 3 + 1] = this.d.y; ta[idx * 3 + 2] = this.d.z;
        }
      } else if (part.skin === 'bend') {
        // the joints' turn about x (and the forelegs' lift in the shoulder), from the pose
        const A = attrs[0].array as Float32Array, B = attrs[1].array as Float32Array;
        const ang = (bi: number) => {
          const o = bi * BAKED_STRIDE;
          return 2 * Math.atan2(pose[o], pose[o + 3]);
        };
        const lift = (bi: number) => pose[bi * BAKED_STRIDE + 5];
        const bb = rig.bendBones;
        A[idx * 4] = ang(bb[0]); A[idx * 4 + 1] = ang(bb[1]); A[idx * 4 + 2] = ang(bb[2]); A[idx * 4 + 3] = ang(bb[3]);
        B[idx * 4] = ang(bb[4]); B[idx * 4 + 1] = lift(bb[1]); B[idx * 4 + 2] = lift(bb[2]); B[idx * 4 + 3] = 0;
      }
    }
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Which clips, at what time                                                                    */
/* ------------------------------------------------------------------------------------------ */

type Layer = [BakedClip, number];

function clip(rig: BakedRig, name: string): BakedClip | undefined {
  return rig.clips.get(name);
}

function pickClips(rig: BakedRig, st: AnimState, carry: string | null, relic: boolean): Layer[] {
  const kind = rig.meta.kind ?? (rig.id === 'scout' ? 'scout' : 'villager');
  if (kind === 'scout') return scoutClips(rig, st);
  if (kind === 'animal') return animalClips(rig, st);
  if (kind === 'siege') return siegeClips(rig, st);
  if (kind === 'ship') return shipClips(rig, st);
  if (kind === 'soldier') return soldierClips(rig, st, relic);
  return villagerClips(rig, st, carry);
}

function soldierClips(rig: BakedRig, st: AnimState, relic: boolean): Layer[] {
  const out: Layer[] = [];
  const push = (name: string, t: number) => {
    const c = clip(rig, name);
    if (c) out.push([c, t]);
  };
  if (st.anim === 'die') push('die', st.t);
  else if (st.anim === 'attack' && rig.clips.has('attack')) push('attack', st.t * (rig.meta.attackHit / Math.max(0.1, st.attackDelay)));
  else if (st.anim === 'work' && !st.moving && rig.clips.has('work')) push('work', st.t + st.seed);
  else {
    // a priest carrying a relic holds it in both arms
    const carrying = relic && rig.clips.has('carryWalk');
    const walkT = st.time * (st.speed / (rig.meta.walkSpeed ?? 0.8)) + st.seed;
    if (st.moving) push(carrying ? 'carryWalk' : 'walk', walkT);
    // between blows the weapon stays at the guard (a pike levelled, a sword raised) rather than going back to rest
    else if (st.guard && rig.clips.has('guard')) push('guard', st.time + st.seed);
    else push(carrying ? 'carryIdle' : 'idle', st.time + st.seed * 7);
  }
  return out;
}

function villagerClips(rig: BakedRig, st: AnimState, carry: string | null): Layer[] {
  const out: Layer[] = [];
  const push = (name: string, t: number) => {
    const c = clip(rig, name);
    if (c) out.push([c, t]);
  };
  const tool = st.tool;
  if (st.anim === 'die') {
    push('die', st.t);
    return out;
  }
  if (st.anim === 'attack') {
    // the blow lands when the game resolves the attack
    push('attack:' + (tool ?? 'none'), st.t * (rig.meta.attackHit / Math.max(0.1, st.attackDelay)));
    return out;
  }
  if (st.anim === 'work' && !st.moving) {
    push('work:' + (tool ?? 'hammer'), st.t + st.seed);
    return out;
  }
  const walking = st.moving;
  // walking clips are timed by distance so the feet stay planted at any speed
  const walkT = st.time * (st.speed / (rig.meta.walkSpeed ?? 0.8)) + st.seed;
  const idleT = st.time + st.seed * 7;
  if (carry) push(walking ? 'carryWalk' : 'carryIdle', walking ? walkT : idleT);
  else if (tool) push((walking ? 'walk:' : 'idle:') + tool, walking ? walkT : idleT);
  else push(walking ? 'walk' : 'idle', walking ? walkT : idleT);
  return out;
}

/** Ships: riding the swell, rowing (and a full sail) under way, casting the net, heeling as they shoot, sinking. */
function shipClips(rig: BakedRig, st: AnimState): Layer[] {
  const out: Layer[] = [];
  const push = (name: string, t: number) => {
    const c = clip(rig, name);
    if (c) out.push([c, t]);
  };
  if (st.anim === 'die') {
    push('die', st.t);
    return out;
  }
  push(st.moving ? 'row' : 'idle', st.time + st.seed * 5);
  if (st.anim === 'work' && !st.moving) push('work', st.t + st.seed);
  if (st.anim === 'attack') push('attack', st.t * (rig.meta.attackHit / Math.max(0.1, st.attackDelay)));
  return out;
}

/** Siege engines: wheels turning with the distance travelled, the engine's attack, its collapse. */
function siegeClips(rig: BakedRig, st: AnimState): Layer[] {
  const out: Layer[] = [];
  const push = (name: string, t: number) => {
    const c = clip(rig, name);
    if (c) out.push([c, t]);
  };
  if (st.anim === 'die') {
    push('die', st.t);
    return out;
  }
  if (st.moving) push('move', st.time * st.speed / (rig.meta.moveDist ?? 1) + st.seed);
  // the shot leaves (or the ram strikes) when the game resolves the attack
  if (st.anim === 'attack') push('attack', st.t * (rig.meta.attackHit / Math.max(0.1, st.attackDelay)));
  return out;
}

/** Animals: a gait picked by speed (the one whose own speed is nearest), standing (grazing), a bite, a fall. */
function animalClips(rig: BakedRig, st: AnimState): Layer[] {
  const out: Layer[] = [];
  const push = (name: string, t: number) => {
    const c = clip(rig, name);
    if (c) out.push([c, t]);
  };
  if (st.anim === 'die') {
    push('die', st.t);
    return out;
  }
  const gaits = rig.meta.gaits ?? {};
  if (st.moving && st.speed > 0.01) {
    let best = '', err = Infinity;
    for (const [g, v] of Object.entries(gaits)) {
      const e = Math.abs(Math.log(st.speed / v.speed));
      if (e < err) { err = e; best = g; }
    }
    // timed by distance: the feet stay planted whatever the speed
    if (best) push(best, st.time * (st.speed / gaits[best].speed) + st.seed);
  } else {
    push('stand', st.time + st.seed * 11);
  }
  if (st.anim === 'attack') push('attack', st.t * (rig.meta.attackHit / Math.max(0.1, st.attackDelay)));
  return out;
}

function scoutClips(rig: BakedRig, st: AnimState): Layer[] {
  const out: Layer[] = [];
  const push = (name: string, t: number) => {
    const c = clip(rig, name);
    if (c) out.push([c, t]);
  };
  if (st.anim === 'die') {
    push('die', st.t);
    return out;
  }
  const gaits = rig.meta.gaits ?? {};
  // the gait whose own speed is nearest the unit's (a horse trots from about 0.9 and canters from about 1.45)
  let gait: string | null = null;
  if (st.moving && st.speed > 0.01) {
    let err = Infinity;
    for (const [g, v] of Object.entries(gaits)) {
      const e = Math.abs(Math.log(st.speed / v.speed));
      if (e < err) { err = e; gait = g; }
    }
  }
  if (gait && gaits[gait]) {
    // timed by distance: the hooves stay planted whatever the unit's speed
    const t = st.time * (st.speed / gaits[gait].speed) + st.seed;
    push('horse:' + gait, t);
    if (st.anim !== 'attack') push('rider:hold:' + gait, t);
  } else {
    push('horse:stand', st.time + st.seed * 11);
    if (st.anim !== 'attack') push('rider:hold', st.time + st.seed * 5);
  }
  if (st.anim === 'attack') {
    const t = st.t * (rig.meta.attackHit / Math.max(0.1, st.attackDelay));
    push('mount:attack', t);   // an elephant gores and stamps as its driver thrusts
    push('rider:attack', t);
  }
  return out;
}
