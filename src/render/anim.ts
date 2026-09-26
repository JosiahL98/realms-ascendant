import type { AnimName, WorkTool } from '../sim/entities';
import type { Rig } from './models/units';

export interface AnimState {
  anim: AnimName;
  /** Seconds since the animation started. */
  t: number;
  /** Global time (for continuous cycles). */
  time: number;
  speed: number;
  moving: boolean;
  attackDelay: number;
  reload: number;
  tool: WorkTool;
  seed: number;
  packed: boolean;
}

export const BONE_STRIDE = 7;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function R(out: Float32Array, i: number | undefined, rx: number, ry = 0, rz = 0): void {
  if (i === undefined) return;
  const o = i * BONE_STRIDE;
  out[o] = rx;
  out[o + 1] = ry;
  out[o + 2] = rz;
}
function AR(out: Float32Array, i: number | undefined, rx: number, ry = 0, rz = 0): void {
  if (i === undefined) return;
  const o = i * BONE_STRIDE;
  out[o] += rx;
  out[o + 1] += ry;
  out[o + 2] += rz;
}
function T(out: Float32Array, i: number | undefined, tx: number, ty: number, tz: number): void {
  if (i === undefined) return;
  const o = i * BONE_STRIDE;
  out[o + 3] = tx;
  out[o + 4] = ty;
  out[o + 5] = tz;
}

export function resetPose(out: Float32Array, n: number): void {
  for (let i = 0; i < n; i++) {
    const o = i * BONE_STRIDE;
    out[o] = out[o + 1] = out[o + 2] = out[o + 3] = out[o + 4] = out[o + 5] = 0;
    out[o + 6] = 1;
  }
}

/* ------------------------------------------------------------------------------------------ */

function humanUpper(rig: Rig, s: AnimState, out: Float32Array, p: string, walking: boolean): void {
  const b = rig.b;
  const torso = b[p + 'torso'], armL = b[p + 'armL'], armR = b[p + 'armR'], handL = b[p + 'handL'], handR = b[p + 'handR'], head = b[p + 'head'];
  const w = rig.weapon;
  const polearm = w === 'spear' || w === 'pike' || w === 'halberd' || w === 'staff' || w === 'fireLance';
  const twoHandedGun = w === 'crossbow' || w === 'gun';
  // base holding pose
  if (polearm) {
    R(out, armR, -0.35, 0, -0.1);
    R(out, handR, 0.35);
  } else if (twoHandedGun) {
    R(out, armR, -0.95, 0, 0.1);
    R(out, handR, 0.95);
    R(out, armL, -1.05, 0, -0.45);
  } else if (w === 'bow' || w === 'longbow') {
    R(out, armL, -0.45, 0, 0.1);
    R(out, handL, 0.45);
    R(out, armR, -0.15, 0, -0.08);
  } else if (w === 'greatsword') {
    R(out, armR, -0.7, 0, 0.25);
    R(out, armL, -0.7, 0, -0.3);
  } else {
    R(out, armR, -0.3, 0, -0.1);
    R(out, armL, -0.15, 0, 0.12);
  }
  if (walking) {
    const ph = (s.time + s.seed) * Math.max(1.2, s.speed * 2.4) * Math.PI * 2 * 0.5;
    const sw = Math.sin(ph) * 0.35;
    if (!polearm && !twoHandedGun && w !== 'greatsword') AR(out, armR, sw * 0.6);
    if (w !== 'bow' && w !== 'longbow' && !twoHandedGun && w !== 'greatsword') AR(out, armL, -sw);
  } else {
    // idle breathing
    const br = Math.sin((s.time + s.seed) * 1.8) * 0.02;
    AR(out, armL, br);
    AR(out, armR, -br);
    AR(out, head, 0, Math.sin((s.time + s.seed * 3) * 0.4) * 0.15, 0);
  }

  const d = Math.max(0.2, s.attackDelay);
  if (s.anim === 'attack') {
    const t = s.t;
    if (w === 'bow' || w === 'longbow') {
      const draw = ease(t / d);
      const rel = t > d ? ease((t - d) / 0.4) : 0;
      R(out, armL, -1.5, 0.1, 0.05);
      R(out, handL, 1.5);
      R(out, armR, -1.5, 0, -0.1);
      T(out, armR, 0, 0, lerp(0.02, -0.1, draw) + rel * 0.1);
      AR(out, torso, 0, 0.35, 0);
    } else if (twoHandedGun) {
      const rec = t > d ? Math.max(0, 1 - (t - d) / 0.25) : 0;
      R(out, armR, -1.35 + rec * 0.3, 0, 0.1);
      R(out, handR, 1.35 - rec * 0.3);
      R(out, armL, -1.35 + rec * 0.3, 0, -0.45);
      T(out, armR, 0, 0, -rec * 0.05);
      AR(out, torso, 0, 0.2, 0);
    } else if (polearm || w === 'lance') {
      const wind = ease(t / (d * 0.6));
      const thr = t < d * 0.6 ? 0 : t < d ? ease((t - d * 0.6) / (d * 0.4)) : Math.max(0, 1 - (t - d) / 0.35);
      const arm = -0.35 - wind * 0.85;
      R(out, armR, arm, 0, -0.05);
      R(out, handR, Math.PI / 2 - arm - 0.1);
      T(out, armR, 0, 0, -0.06 * wind + thr * 0.18);
      R(out, armL, -0.9 * wind, 0, -0.35 * wind);
      AR(out, torso, 0.1 * thr, 0.25 * wind - 0.2 * thr, 0);
    } else if (w === 'javelin') {
      const wind = ease(t / (d * 0.7));
      const thr = t < d * 0.7 ? 0 : ease((t - d * 0.7) / (d * 0.3 + 0.1));
      R(out, armR, lerp(-0.3, -2.9, wind) + thr * 1.8, 0, -0.1);
      AR(out, torso, 0, 0.3 * wind - 0.4 * thr, 0);
    } else {
      // overhead swing (sword, axe, club, greatsword, none)
      const up = ease(t / (d * 0.65));
      const down = t < d * 0.65 ? 0 : ease((t - d * 0.65) / (d * 0.35));
      const rec = t > d ? ease((t - d) / 0.3) : 0;
      const arm = lerp(-0.3, -2.5, up) + down * 2.4 - rec * 0.1;
      R(out, armR, arm, 0, -0.15);
      if (w === 'greatsword') R(out, armL, arm, 0, -0.45);
      AR(out, torso, down * 0.15, 0.3 * up - 0.45 * down, 0);
    }
  } else if (s.anim === 'work') {
    const t = s.t + s.seed;
    const tool = s.tool;
    if (w === 'staff') {
      const sw = Math.sin(t * 2) * 0.15;
      R(out, armR, -1.9 + sw, 0, -0.1);
      R(out, handR, 1.9 - sw);
      R(out, armL, -1.9 - sw, 0, 0.1);
      AR(out, head, -0.2, 0, 0);
    } else if (tool === 'axe' || tool === 'pick') {
      const P = 1.15;
      const u = (t % P) / P;
      const up = ease(u / 0.55);
      const dn = u < 0.55 ? 0 : ease((u - 0.55) / 0.15);
      const arm = lerp(-0.5, -2.7, up) + dn * 2.3;
      R(out, armR, arm, 0, 0.15);
      R(out, armL, arm, 0, -0.4);
      AR(out, torso, 0.1 + dn * 0.15, 0, 0);
    } else if (tool === 'hammer' || tool === null) {
      const P = 0.65;
      const u = (t % P) / P;
      const arm = u < 0.6 ? lerp(-0.8, -2.0, ease(u / 0.6)) : lerp(-2.0, -0.7, ease((u - 0.6) / 0.4));
      R(out, armR, arm, 0, -0.1);
      R(out, armL, -0.7, 0, 0.1);
      AR(out, torso, 0.3, 0, 0);
    } else if (tool === 'hoe') {
      const P = 1.3;
      const u = (t % P) / P;
      const arm = u < 0.5 ? lerp(-0.5, -1.6, ease(u / 0.5)) : lerp(-1.6, -0.5, ease((u - 0.5) / 0.5));
      R(out, armR, arm, 0, 0.1);
      R(out, armL, arm + 0.2, 0, -0.35);
      AR(out, torso, 0.25, 0, 0);
    } else if (tool === 'basket') {
      AR(out, torso, 0.55, 0, 0);
      R(out, armR, -1.1 + Math.sin(t * 3) * 0.35, 0, -0.1);
      R(out, armL, -0.7, 0, 0.1);
    } else if (tool === 'spear') {
      AR(out, torso, 0.6, 0, 0);
      R(out, armR, -0.9 + Math.sin(t * 7) * 0.3, 0, -0.1);
      R(out, armL, -0.8, 0, 0.2);
    } else if (tool === 'rod') {
      R(out, armR, -1.0 + Math.sin(t * 1.2) * 0.08, 0, 0);
      R(out, armL, -0.9, 0, -0.3);
    } else {
      const P = 0.7;
      R(out, armR, -1.2 + Math.sin((t / P) * Math.PI * 2) * 0.5, 0, 0);
    }
  }
}

function humanLegs(rig: Rig, s: AnimState, out: Float32Array, walking: boolean): void {
  const b = rig.b;
  if (walking) {
    const ph = (s.time + s.seed) * Math.max(1.2, s.speed * 2.4) * Math.PI * 2 * 0.5;
    const sw = Math.sin(ph) * 0.55;
    R(out, b.legL, sw);
    R(out, b.legR, -sw);
    T(out, b.hips, 0, Math.abs(Math.cos(ph)) * 0.025, 0);
  }
}

function dieHuman(rig: Rig, s: AnimState, out: Float32Array): void {
  const e = ease(s.t / 0.55);
  R(out, rig.b.root, -Math.PI / 2 * e * 0.98, 0, 0);
  T(out, rig.b.root, 0, 0.04 * e, 0);
  R(out, rig.b.armL, -2.2 * e, 0, 0.5 * e);
  R(out, rig.b.armR, -2.0 * e, 0, -0.6 * e);
  R(out, rig.b.legL, 0.2 * e);
  R(out, rig.b.legR, -0.15 * e);
  R(out, rig.b.head, -0.3 * e);
}

function gait(rig: Rig, s: AnimState, out: Float32Array, freq: number, amp: number, walking: boolean): number {
  const b = rig.b;
  if (!walking) return 0;
  const ph = (s.time + s.seed) * freq * Math.PI * 2;
  const sw = Math.sin(ph) * amp;
  R(out, b.legFL, sw);
  R(out, b.legBR, sw);
  R(out, b.legFR, -sw);
  R(out, b.legBL, -sw);
  return ph;
}

export function animate(rig: Rig, s: AnimState, out: Float32Array): void {
  resetPose(out, rig.bones.length);
  const b = rig.b;
  const walking = s.moving || s.anim === 'walk' || s.anim === 'carry';
  switch (rig.style) {
    case 'human': {
      if (s.anim === 'die') {
        dieHuman(rig, s, out);
        return;
      }
      humanLegs(rig, s, out, walking);
      humanUpper(rig, s, out, '', walking && s.anim !== 'attack');
      if (s.anim === 'carry') {
        R(out, b.armL, -0.7, 0, -0.35);
        R(out, b.armR, -0.7, 0, 0.35);
      }
      return;
    }
    case 'rider': {
      if (s.anim === 'die') {
        const e = ease(s.t / 0.7);
        R(out, b.root, 0, 0, (Math.PI / 2) * e * 0.95);
        T(out, b.root, 0, 0.12 * e, 0);
        R(out, b.legFL, 0.4 * e);
        R(out, b.legBL, -0.3 * e);
        return;
      }
      const ph = gait(rig, s, out, Math.max(1.4, s.speed * 1.5), 0.6, walking);
      if (walking) {
        T(out, b.body, 0, Math.abs(Math.sin(ph)) * 0.035, 0);
        R(out, b.neck, Math.sin(ph) * 0.08);
        R(out, b.tail, Math.sin(ph * 0.5) * 0.15);
      } else {
        const graze = Math.max(0, Math.sin((s.time + s.seed * 7) * 0.25));
        R(out, b.neck, graze * 0.6);
        R(out, b.tail, Math.sin(s.time * 1.5 + s.seed) * 0.12);
      }
      humanUpper(rig, s, out, 'r', walking);
      return;
    }
    case 'quad': {
      if (s.anim === 'die') {
        const e = ease(s.t / 0.5);
        R(out, b.root, 0, 0, (Math.PI / 2) * e);
        T(out, b.root, 0, 0.08 * e, 0);
        return;
      }
      const kind = rig.quadKind;
      const freq = kind === 'deer' ? Math.max(1.6, s.speed * 2) : Math.max(1.8, s.speed * 2.6);
      const ph = gait(rig, s, out, freq, 0.55, walking);
      if (walking) T(out, b.body, 0, Math.abs(Math.sin(ph)) * 0.02, 0);
      else {
        const graze = Math.max(0, Math.sin((s.time + s.seed * 5) * 0.35));
        R(out, b.head, graze * 0.7);
      }
      R(out, b.tail, Math.sin(s.time * 3 + s.seed) * 0.2);
      if (s.anim === 'attack') {
        const u = clamp01(s.t / Math.max(0.3, s.attackDelay + 0.2));
        T(out, b.body, 0, 0, Math.sin(u * Math.PI) * 0.12);
        R(out, b.head, -Math.sin(u * Math.PI) * 0.4);
      }
      return;
    }
    case 'elephant': {
      if (s.anim === 'die') {
        const e = ease(s.t / 0.9);
        R(out, b.root, 0, 0, (Math.PI / 2) * e * 0.9);
        T(out, b.root, 0, 0.2 * e, 0);
        return;
      }
      const ph = gait(rig, s, out, Math.max(0.8, s.speed * 1.3), 0.32, walking);
      if (walking) T(out, b.body, 0, Math.abs(Math.sin(ph)) * 0.03, 0);
      R(out, b.trunk, Math.sin(s.time * 1.3 + s.seed) * 0.15, 0, Math.sin(s.time * 0.9 + s.seed) * 0.12);
      R(out, b.tail, Math.sin(s.time * 2 + s.seed) * 0.2);
      if (s.anim === 'attack') {
        const u = clamp01(s.t / Math.max(0.4, s.attackDelay + 0.3));
        R(out, b.head, -Math.sin(u * Math.PI) * 0.35 + (u > 0.5 ? Math.sin((u - 0.5) * 2 * Math.PI) * 0.3 : 0));
        R(out, b.trunk, -Math.sin(u * Math.PI) * 0.8);
        R(out, b.legFL, -Math.sin(u * Math.PI) * 0.4);
      }
      humanUpper(rig, { ...s }, out, 'r', false);
      return;
    }
    case 'ship': {
      const bob = Math.sin((s.time + s.seed) * 1.3) * 0.02;
      if (s.anim === 'die') {
        const e = ease(s.t / 2.5);
        T(out, b.root, 0, -0.9 * e + bob, 0);
        R(out, b.root, 0.25 * e, 0, 0.5 * e);
        return;
      }
      T(out, b.hull, 0, bob, 0);
      R(out, b.hull, Math.sin((s.time + s.seed) * 0.8) * 0.025, 0, Math.sin((s.time + s.seed) * 1.1) * 0.035);
      if (walking) {
        const ph = (s.time + s.seed) * 3.2;
        R(out, b.oarsL, Math.sin(ph) * 0.45, 0, 0);
        R(out, b.oarsR, Math.sin(ph) * 0.45, 0, 0);
        const sc = 1 + Math.sin(s.time * 2) * 0.03;
        const o = b.sail * BONE_STRIDE;
        out[o + 6] = sc;
      }
      if (s.anim === 'work') R(out, b.net, 0.6 + Math.sin(s.time * 1.5) * 0.2);
      return;
    }
    case 'ram':
    case 'mangonel':
    case 'scorpion':
    case 'bombard':
    case 'cart':
    case 'trebuchet': {
      if (s.anim === 'die') {
        const e = ease(s.t / 0.8);
        R(out, b.root, 0.15 * e, 0, 0.35 * e);
        T(out, b.root, 0, -0.15 * e, 0);
        return;
      }
      if (walking) {
        const roll = (s.time + s.seed) * s.speed * 5.5;
        R(out, b.wheelF, roll);
        R(out, b.wheelB, roll);
        if (rig.style === 'cart') gait(rig, s, out, Math.max(1.4, s.speed * 2.2), 0.5, true);
      }
      if (s.anim === 'attack') {
        const t = s.t, d = Math.max(0.3, s.attackDelay);
        if (rig.style === 'ram') {
          const back = ease(t / (d * 0.7));
          const hit = t < d * 0.7 ? 0 : t < d ? ease((t - d * 0.7) / (d * 0.3)) : Math.max(0, 1 - (t - d) / 0.6);
          T(out, b.ram, 0, 0, -0.22 * back * (1 - hit) + 0.12 * hit);
        } else if (rig.style === 'mangonel') {
          const sw = t < d ? ease(t / d) : Math.max(0, 1 - (t - d) / Math.max(1, s.reload * 0.6));
          R(out, b.arm, sw * 1.9);
        } else if (rig.style === 'trebuchet') {
          const sw = t < d ? ease(t / d) : Math.max(0, 1 - (t - d) / Math.max(2, s.reload * 0.7));
          R(out, b.arm, sw * 2.5);
        } else if (rig.style === 'scorpion' || rig.style === 'bombard') {
          const rec = t > d ? Math.max(0, 1 - (t - d) / 0.4) : 0;
          T(out, rig.style === 'scorpion' ? b.bow : b.barrel, 0, 0, -rec * 0.12);
        }
      }
      return;
    }
  }
}

/** Which geometry variants should be visible. */
export function activeVariant(rig: Rig, variant: string, tool: WorkTool, carry: string | null, packed: boolean, relic: boolean, working: boolean): boolean {
  if (!variant) return true;
  if (variant.startsWith('tool:')) {
    const t = variant.slice(5);
    if (tool === t) return true;
    return false;
  }
  if (variant.startsWith('carry:')) return !working && carry === variant.slice(6);
  if (variant === 'packed') return packed;
  if (variant === 'unpacked') return !packed;
  if (variant === 'relic') return relic;
  return true;
}
