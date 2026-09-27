import * as THREE from 'three';

/*
 * Units modelled in Blender and animated offline (tools/units): the villagers and the scout. Their geometry, vertex
 * colours, skinning data and animation clips are baked into public/units/*.json by tools/units/bake.cjs.
 */

export interface BakedBone {
  name: string;
  parent: number;
  pivot: [number, number, number];
}

export interface BakedPart {
  bone: number;
  /** Tinted by the player colour. */
  pc: boolean;
  /** 'tool:axe', 'carry:wood', ... or '' for always shown. */
  variant: string;
  geo: THREE.BufferGeometry;
  /** '' rigid; 'lbs' blends in up to two more bones (skirt, fishing line); 'bend' turns the horse's joints. */
  skin: '' | 'lbs' | 'bend';
  skinBones: number[];
}

export interface BakedClip {
  dur: number;
  fps: number;
  frames: number;
  loop: boolean;
  /** Bones held at a fixed pose for the whole clip: [bone, qx, qy, qz, qw, px, py, pz]. */
  statics: number[][];
  /** Animated bones and their frames (int16: rotation x 32767, offset x 4096). */
  bones: number[];
  data: Int16Array;
}

export interface BakedRig {
  id: string;
  height: number;
  bones: BakedBone[];
  parts: BakedPart[];
  clips: Map<string, BakedClip>;
  meta: { walkSpeed?: number; attackHit: number; gaits?: Record<string, { speed: number }>; bend?: string[] };
  /** Bone index by name. */
  b: Record<string, number>;
  /** For 'bend' skinning: the neck and upper-leg joints (relative to the body bone) and their bone indices. */
  bendPivots: THREE.Vector3[];
  bendBones: number[];
}

/** Floats per bone in a sampled pose: rotation (x, y, z, w) and offset (x, y, z). */
export const BAKED_STRIDE = 7;

const rigs = new Map<string, BakedRig>();

function decode(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

interface RawPart {
  bone: number; pc: boolean; variant: string; pos: number[]; nrm: number[]; col: number[]; idx: number[];
  skin?: 'lbs' | 'bend'; skinBones?: number[]; w?: number[]; si?: number[];
}
interface RawClip { dur: number; fps: number; frames: number; loop: boolean; statics: number[][]; bones: number[]; data: string }
interface RawRig { id: string; height: number; bones: BakedBone[]; parts: RawPart[]; clips: Record<string, RawClip>; meta: BakedRig['meta'] }

function build(raw: RawRig): BakedRig {
  const b = Object.fromEntries(raw.bones.map((bn, i) => [bn.name, i]));
  const parts: BakedPart[] = raw.parts.map((p) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(p.nrm, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(p.col, 3));
    geo.setIndex(p.idx);
    if (p.skin === 'lbs') geo.setAttribute('skinW', new THREE.Float32BufferAttribute(p.w!, 2));
    if (p.skin === 'bend') {
      geo.setAttribute('skinW', new THREE.Float32BufferAttribute(p.w!, 1));
      geo.setAttribute('skinIdx', new THREE.Float32BufferAttribute(p.si!, 1));
    }
    geo.computeBoundingSphere();
    return { bone: p.bone, pc: p.pc, variant: p.variant, geo, skin: p.skin ?? '', skinBones: p.skinBones ?? [] };
  });
  const clips = new Map<string, BakedClip>();
  for (const [name, c] of Object.entries(raw.clips)) clips.set(name, { ...c, data: decode(c.data) });
  const bendNames = raw.meta.bend ?? [];
  const body = b.body;
  const piv = (i: number) => new THREE.Vector3(...raw.bones[i].pivot);
  return {
    id: raw.id, height: raw.height, bones: raw.bones, parts, clips, meta: raw.meta, b,
    bendBones: bendNames.map((n) => b[n]),
    bendPivots: body === undefined ? [] : bendNames.map((n) => piv(b[n]).sub(piv(body))),
  };
}

/** Loads the baked units (at game start). Missing files leave those units on their procedural models. */
export async function loadBakedRigs(): Promise<void> {
  const base = import.meta.env.BASE_URL ?? '/';
  await Promise.all(['villager', 'villagerF', 'scout'].map(async (id) => {
    if (rigs.has(id)) return;
    try {
      const res = await fetch(`${base}units/${id}.json`);
      if (!res.ok) return;
      rigs.set(id, build(await res.json() as RawRig));
    } catch {
      // keep the procedural model
    }
  }));
}

export function getBakedRig(model: string): BakedRig | undefined {
  return rigs.get(model);
}

/** Height of a baked model, if it is one (for picking and health bars). */
export function bakedHeight(model: string): number | undefined {
  return rigs.get(model)?.height;
}

/** Resets a pose buffer to the rest pose. */
export function restPose(out: Float32Array, n: number): void {
  for (let i = 0; i < n; i++) {
    const o = i * BAKED_STRIDE;
    out[o] = out[o + 1] = out[o + 2] = 0;
    out[o + 3] = 1;
    out[o + 4] = out[o + 5] = out[o + 6] = 0;
  }
}

/** Writes a clip's bones at time t into the pose (other bones untouched), blending between the baked frames. */
export function sampleClip(clip: BakedClip, t: number, out: Float32Array): void {
  for (const s of clip.statics) {
    const o = s[0] * BAKED_STRIDE;
    for (let k = 0; k < 7; k++) out[o + k] = s[k + 1];
  }
  const nb = clip.bones.length;
  if (!nb) return;
  let f0: number, f1: number, w: number;
  if (clip.loop) {
    const u = ((t % clip.dur) + clip.dur) % clip.dur / clip.dur * clip.frames;
    f0 = Math.floor(u) % clip.frames;
    f1 = (f0 + 1) % clip.frames;
    w = u - Math.floor(u);
  } else {
    const u = Math.max(0, Math.min(clip.frames - 1, t * clip.fps));
    f0 = Math.floor(u);
    f1 = Math.min(clip.frames - 1, f0 + 1);
    w = u - f0;
  }
  const d = clip.data;
  const a0 = f0 * nb * 7, a1 = f1 * nb * 7;
  for (let j = 0; j < nb; j++) {
    const o = clip.bones[j] * BAKED_STRIDE;
    const i0 = a0 + j * 7, i1 = a1 + j * 7;
    // rotation: normalised blend (frames are close; the baker keeps them in one hemisphere)
    let x = d[i0] + (d[i1] - d[i0]) * w, y = d[i0 + 1] + (d[i1 + 1] - d[i0 + 1]) * w;
    let z = d[i0 + 2] + (d[i1 + 2] - d[i0 + 2]) * w, qw = d[i0 + 3] + (d[i1 + 3] - d[i0 + 3]) * w;
    const len = Math.hypot(x, y, z, qw) || 1;
    x /= len; y /= len; z /= len; qw /= len;
    out[o] = x; out[o + 1] = y; out[o + 2] = z; out[o + 3] = qw;
    for (let k = 4; k < 7; k++) out[o + k] = (d[i0 + k] + (d[i1 + k] - d[i0 + k]) * w) / 4096;
  }
}
