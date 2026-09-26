import * as THREE from 'three';
import type { WeaponKind } from '../../data/types';
import { GeoBuilder } from '../geo';
import { DETAIL as D } from '../textures';

type V3 = [number, number, number];

export type AnimStyle = 'human' | 'rider' | 'quad' | 'elephant' | 'ram' | 'mangonel' | 'scorpion' | 'trebuchet' | 'cart' | 'bombard' | 'ship';

export interface Bone {
  name: string;
  parent: number;
  pivot: V3;
}
export interface RigPart {
  bone: number;
  pc: boolean;
  variant: string;
  geo: THREE.BufferGeometry;
}
export interface Rig {
  id: string;
  bones: Bone[];
  parts: RigPart[];
  style: AnimStyle;
  weapon: WeaponKind;
  height: number;
  b: Record<string, number>;
  variants: string[];
  /** Mounted model: rider bones are prefixed 'r'. */
  mounted: boolean;
  quadKind?: 'sheep' | 'deer' | 'boar' | 'wolf' | 'horse' | 'camel';
}

class RigBuilder {
  bones: Bone[] = [];
  b: Record<string, number> = {};
  private builders = new Map<string, { bone: number; pc: boolean; variant: string; g: GeoBuilder }>();
  private seed = 1;

  bone(name: string, parent: string | null, pivot: V3): this {
    this.b[name] = this.bones.length;
    this.bones.push({ name, parent: parent === null ? -1 : this.b[parent], pivot });
    return this;
  }
  g(bone: string, pc = false, variant = ''): GeoBuilder {
    const key = `${bone}|${pc ? 1 : 0}|${variant}`;
    let e = this.builders.get(key);
    if (!e) {
      e = { bone: this.b[bone], pc, variant, g: new GeoBuilder(this.seed++) };
      this.builders.set(key, e);
    }
    return e.g;
  }
  build(id: string, style: AnimStyle, weapon: WeaponKind, height: number, mounted = false): Rig {
    const parts: RigPart[] = [];
    const variants = new Set<string>();
    for (const e of this.builders.values()) {
      if (e.g.isEmpty()) continue;
      parts.push({ bone: e.bone, pc: e.pc, variant: e.variant, geo: e.g.build() });
      if (e.variant) variants.add(e.variant);
    }
    return { id, bones: this.bones, parts, style, weapon, height, b: this.b, variants: [...variants], mounted };
  }
}

/* ========================================================================================== */
/* Humanoid                                                                                    */
/* ========================================================================================== */

type Helmet = 'none' | 'cap' | 'conical' | 'full' | 'plumed' | 'crested' | 'hood' | 'wide' | 'turban' | 'wolf' | 'galea' | 'phrygian' | 'feather' | 'scarf' | 'topknot';
type Shield = 'none' | 'round' | 'kite' | 'scutum' | 'hoplon' | 'small';

interface HumanOpts {
  skin?: number;
  hair?: number;
  tunic?: number;
  legs?: number;
  boots?: number;
  helmet?: Helmet;
  helmetColor?: number;
  armor?: 'none' | 'leather' | 'mail' | 'plate' | 'lamellar' | 'bronze';
  cape?: boolean;
  shield?: Shield;
  weapon: WeaponKind;
  female?: boolean;
  bare?: boolean;
  robe?: boolean;
  beard?: boolean;
  quiver?: boolean;
  elite?: boolean;
  sash?: boolean;
  bulk?: number;
}

const SKINS = [0xe0b48c, 0xc89066, 0xa8704a, 0x7a4a2e, 0x5a3420];

/** Adds humanoid bones under `parent` (prefix for rider bones) and geometry. */
function human(rb: RigBuilder, o: HumanOpts, prefix = '', parent: string | null = null, seated = false): void {
  const P = (n: string) => prefix + n;
  const skin = o.skin ?? SKINS[0];
  const bulk = o.bulk ?? 1;
  if (!parent) {
    rb.bone(P('root'), null, [0, 0, 0]);
    parent = P('root');
  }
  const hipY = seated ? 0 : 0.4;
  rb.bone(P('hips'), parent, [0, hipY, 0]);
  rb.bone(P('torso'), P('hips'), [0, 0.03, 0]);
  rb.bone(P('head'), P('torso'), [0, 0.31, 0]);
  rb.bone(P('armL'), P('torso'), [0.135 * bulk, 0.27, 0]);
  rb.bone(P('armR'), P('torso'), [-0.135 * bulk, 0.27, 0]);
  rb.bone(P('handL'), P('armL'), [0, -0.25, 0.01]);
  rb.bone(P('handR'), P('armR'), [0, -0.25, 0.01]);
  if (!seated) {
    rb.bone(P('legL'), P('hips'), [0.068, 0, 0]);
    rb.bone(P('legR'), P('hips'), [-0.068, 0, 0]);
  }
  rb.bone(P('carry'), P('torso'), [0, 0.12, 0.13]);

  const tunicPc = o.tunic === undefined;
  const tunicCol = o.tunic ?? 0xffffff;
  const legCol = o.legs ?? 0x6a5236;
  const bootCol = o.boots ?? 0x3a2a1c;

  // Legs
  if (!seated) {
    for (const side of ['legL', 'legR']) {
      const g = rb.g(P(side));
      g.c(legCol, 0.05).cyl(0, -0.33, 0, 0.042, 0.05, 0.33, 6);
      g.c(bootCol, 0.05).box(0, -0.4, 0.012, 0.075, 0.09, 0.13);
      if (o.armor === 'plate') g.c(0xb8bcc4, 0.04).cyl(0, -0.3, 0.005, 0.047, 0.052, 0.18, 6);
      if (o.armor === 'bronze') g.c(0xb88a3a, 0.05).cyl(0, -0.3, 0.01, 0.046, 0.05, 0.16, 6);
    }
  } else {
    // seated legs, part of hips, splayed around the mount
    const g = rb.g(P('hips'));
    for (const s of [1, -1]) {
      g.push().translate(s * 0.1, -0.02, 0.05).rotateX(-1.2).rotateZ(s * 0.35);
      g.c(legCol, 0.05).cyl(0, -0.22, 0, 0.04, 0.045, 0.22, 5);
      g.pop();
      g.push().translate(s * 0.16, -0.18, 0.1).rotateX(-0.2);
      g.c(legCol, 0.05).cyl(0, -0.2, 0, 0.036, 0.04, 0.2, 5);
      g.c(bootCol, 0.05).box(0, -0.25, 0.02, 0.06, 0.07, 0.11);
      g.pop();
    }
  }
  // Hips/belt and tunic skirt
  const hips = rb.g(P('hips'), tunicPc);
  if (o.robe) {
    hips.c(tunicCol, 0.04).mt(D.cloth).cyl(0, -0.4, 0, 0.17, 0.12, 0.44, 8);
    hips.mt(0);
  } else if (o.female) {
    hips.c(tunicCol, 0.04).mt(D.cloth).cyl(0, -0.32, 0, 0.16, 0.11, 0.36, 8);
    hips.mt(0);
  } else if (!o.bare || true) {
    hips.c(tunicCol, 0.04).cyl(0, -0.13, 0, 0.125 * bulk, 0.105 * bulk, 0.16, 8);
  }
  rb.g(P('hips')).c(0x4a3020, 0.05).cyl(0, 0.0, 0, 0.108 * bulk, 0.108 * bulk, 0.035, 8);

  // Torso
  const torsoPc = rb.g(P('torso'), tunicPc && !o.bare);
  if (o.bare) {
    rb.g(P('torso')).c(skin, 0.04).cyl(0, 0, 0, 0.1 * bulk, 0.125 * bulk, 0.29, 7);
  } else {
    torsoPc.c(tunicCol, 0.04).cyl(0, 0, 0, 0.1 * bulk, 0.125 * bulk, 0.29, 7);
  }
  const tg = rb.g(P('torso'));
  switch (o.armor) {
    case 'mail':
      tg.c(0x8a8e94, 0.05).cyl(0, 0.04, 0, 0.108 * bulk, 0.13 * bulk, 0.25, 7);
      break;
    case 'plate':
      tg.c(0xc4c8d0, 0.03).cyl(0, 0.05, 0, 0.11 * bulk, 0.135 * bulk, 0.24, 7);
      tg.c(0xb0b4bc, 0.04).sphere(0.13 * bulk, 0.26, 0, 0.055, 6, 4, 1, 0.7, 1).sphere(-0.13 * bulk, 0.26, 0, 0.055, 6, 4, 1, 0.7, 1);
      break;
    case 'leather':
      tg.c(0x7a5230, 0.06).cyl(0, 0.05, 0, 0.105 * bulk, 0.128 * bulk, 0.22, 7);
      break;
    case 'lamellar':
      tg.c(0x6a2a20, 0.05).cyl(0, 0.04, 0, 0.108 * bulk, 0.13 * bulk, 0.24, 7);
      tg.c(0xb09050).box(0, 0.12, 0.118, 0.16, 0.02, 0.01).box(0, 0.2, 0.118, 0.18, 0.02, 0.01);
      break;
    case 'bronze':
      tg.c(0xc0923a, 0.04).cyl(0, 0.05, 0, 0.11 * bulk, 0.134 * bulk, 0.24, 7);
      break;
  }
  if (o.sash) rb.g(P('torso'), true).c(0xffffff).push().translate(0, 0.14, 0).rotateZ(0.6).cyl(0, -0.02, 0, 0.13, 0.13, 0.05, 7).pop();
  if (o.cape) {
    const cp = rb.g(P('torso'), true);
    cp.c(0xdddddd, 0.04).mt(D.cloth).push().translate(0, 0.28, -0.12).rotateX(0.12).box(0, -0.5, 0, 0.26, 0.5, 0.025).pop();
    cp.mt(0);
  }
  if (o.quiver) {
    tg.push().translate(0.06, 0.12, -0.13).rotateZ(0.4).c(0x6a4a2a).cyl(0, 0, 0, 0.035, 0.04, 0.22, 6).c(0xe8e0d0).box(0, 0.22, 0, 0.05, 0.05, 0.05).pop();
  }
  // Head
  const hg = rb.g(P('head'));
  hg.c(skin, 0.03).cyl(0, -0.02, 0, 0.03, 0.03, 0.04, 5);
  hg.sphere(0, 0.078, 0.005, 0.074, 8, 6, 1, 1.08, 1);
  hg.c(0x201814).box(0.025, 0.085, 0.066, 0.012, 0.012, 0.01).box(-0.025, 0.085, 0.066, 0.012, 0.012, 0.01);
  const hair = o.hair ?? 0x3a2616;
  if (o.beard) hg.c(hair, 0.06).sphere(0, 0.035, 0.035, 0.05, 6, 4, 1, 0.9, 0.8);
  const helmCol = o.helmetColor ?? 0x9a9ea6;
  switch (o.helmet ?? 'none') {
    case 'none':
      hg.c(hair, 0.06).sphere(0, 0.1, -0.008, 0.07, 8, 5, 1.02, 0.85, 1.02);
      if (o.female) hg.sphere(0, 0.05, -0.05, 0.06, 6, 5, 1, 1.4, 0.8);
      break;
    case 'scarf':
      rb.g(P('head'), true).c(0xeeeeee, 0.04).sphere(0, 0.1, -0.01, 0.075, 8, 5, 1.05, 0.95, 1.05);
      rb.g(P('head'), true).c(0xdddddd).box(0, 0.02, -0.06, 0.08, 0.1, 0.02);
      break;
    case 'cap':
      hg.c(0x7a5230, 0.05).sphere(0, 0.11, -0.005, 0.07, 8, 4, 1.05, 0.7, 1.05);
      break;
    case 'hood':
      hg.c(0x5a6a3a, 0.05).sphere(0, 0.1, -0.012, 0.078, 8, 5, 1.05, 1.0, 1.08).cone(0, 0.14, -0.06, 0.04, 0.08, 5);
      break;
    case 'conical':
      hg.c(helmCol, 0.03).cone(0, 0.1, 0, 0.078, 0.11, 8).c(0x8a8e94).cyl(0, 0.03, 0.06, 0.012, 0.012, 0.06, 4);
      break;
    case 'full':
      hg.c(helmCol, 0.03).cyl(0, 0.02, 0, 0.078, 0.076, 0.12, 8, { top: true });
      hg.c(0x202020).box(0, 0.08, 0.075, 0.09, 0.012, 0.01);
      break;
    case 'plumed':
      hg.c(helmCol, 0.03).cyl(0, 0.02, 0, 0.078, 0.076, 0.12, 8, { top: true });
      hg.c(0x202020).box(0, 0.08, 0.075, 0.09, 0.012, 0.01);
      rb.g(P('head'), true).c(0xffffff, 0.05).sphere(0, 0.17, -0.02, 0.05, 6, 4, 0.5, 1.2, 1.3);
      break;
    case 'crested':
      hg.c(0xc0923a, 0.03).sphere(0, 0.1, 0, 0.075, 8, 5, 1.05, 0.95, 1.05).box(0, 0.02, 0.06, 0.02, 0.07, 0.02);
      rb.g(P('head'), true).c(0xffffff, 0.05).box(0, 0.14, -0.01, 0.025, 0.1, 0.16);
      break;
    case 'galea':
      hg.c(0xb8bcc4, 0.03).sphere(0, 0.1, 0, 0.074, 8, 5, 1.05, 0.9, 1.05).box(0, 0.05, -0.07, 0.14, 0.05, 0.02);
      hg.c(0xc02020, 0.05).box(0, 0.16, 0, 0.025, 0.08, 0.14);
      break;
    case 'wide':
      hg.c(0x3a2a1a, 0.05).cyl(0, 0.12, 0, 0.13, 0.13, 0.015, 10).cyl(0, 0.12, 0, 0.06, 0.05, 0.06, 8);
      break;
    case 'turban':
      hg.c(0xe8e0d0, 0.05).sphere(0, 0.125, 0, 0.08, 8, 5, 1.05, 0.8, 1.05);
      break;
    case 'phrygian':
      hg.c(helmCol, 0.04).sphere(0, 0.11, -0.01, 0.075, 8, 5, 1.02, 1, 1.05).push().translate(0, 0.17, 0.02).rotateX(0.6).cone(0, 0, 0, 0.045, 0.1, 6).pop();
      break;
    case 'feather':
      hg.c(hair, 0.06).sphere(0, 0.1, -0.008, 0.07, 8, 5, 1.02, 0.85, 1.02);
      rb.g(P('head'), true).c(0xffffff).cyl(0, 0.09, 0, 0.074, 0.074, 0.025, 8);
      hg.c(0xf0f0e0).push().translate(0, 0.14, -0.06).rotateX(-0.3).box(0, 0, 0, 0.015, 0.14, 0.02).pop();
      break;
    case 'wolf':
      hg.c(0x6a6a66, 0.1).sphere(0, 0.12, -0.02, 0.085, 8, 5, 1.1, 0.9, 1.2).box(0.04, 0.2, -0.01, 0.025, 0.05, 0.02).box(-0.04, 0.2, -0.01, 0.025, 0.05, 0.02);
      hg.c(0x5a5a56).box(0, 0.1, 0.085, 0.06, 0.04, 0.05);
      rb.g(P('torso')).c(0x6a6a66, 0.12).push().translate(0, 0.28, -0.1).box(0, -0.35, 0, 0.26, 0.38, 0.04).pop();
      break;
    case 'topknot':
      hg.c(0x1a1410, 0.04).sphere(0, 0.1, -0.008, 0.07, 8, 5, 1.02, 0.85, 1.02).sphere(0, 0.18, -0.01, 0.03, 6, 4);
      break;
  }
  // Arms
  for (const side of ['armL', 'armR']) {
    const ag = rb.g(P(side), tunicPc && !o.bare && !o.robe);
    const sleeveCol = o.bare ? skin : tunicCol;
    if (o.bare) rb.g(P(side)).c(skin, 0.04).cyl(0, -0.24, 0, 0.032, 0.038, 0.24, 6);
    else if (o.robe) rb.g(P(side), true).c(tunicCol, 0.04).cyl(0, -0.24, 0, 0.045, 0.045, 0.25, 6);
    else ag.c(sleeveCol, 0.04).cyl(0, -0.13, 0, 0.037, 0.04, 0.13, 6);
    const ng = rb.g(P(side));
    if (!o.bare && !o.robe) ng.c(skin, 0.04).cyl(0, -0.24, 0, 0.03, 0.034, 0.12, 6);
    if (o.armor === 'plate') ng.c(0xb8bcc4, 0.04).cyl(0, -0.24, 0, 0.036, 0.038, 0.12, 6);
    if (o.armor === 'mail') ng.c(0x8a8e94, 0.05).cyl(0, -0.14, 0, 0.041, 0.043, 0.13, 6);
    ng.c(skin, 0.03).sphere(0, -0.255, 0.005, 0.03, 5, 4);
  }
  // Shield (left hand)
  const sg = rb.g(P('handL'));
  const sp = rb.g(P('handL'), true);
  switch (o.shield ?? 'none') {
    case 'round':
      sp.push().translate(0.03, 0.05, 0.03).rotateZ(Math.PI / 2).rotateY(0.25);
      sp.c(0xffffff, 0.03).cyl(0, -0.012, 0, 0.13, 0.13, 0.024, 10);
      sp.pop();
      sg.push().translate(0.045, 0.05, 0.03).rotateZ(Math.PI / 2).rotateY(0.25).c(0xb09040).cyl(0, 0, 0, 0.03, 0.03, 0.02, 6).pop();
      break;
    case 'small':
      sp.push().translate(0.03, 0.03, 0.03).rotateZ(Math.PI / 2).rotateY(0.25).c(0xffffff, 0.03).cyl(0, -0.01, 0, 0.09, 0.09, 0.02, 8).pop();
      break;
    case 'hoplon':
      sp.push().translate(0.04, 0.06, 0.03).rotateZ(Math.PI / 2).rotateY(0.25).c(0xffffff, 0.03).cyl(0, -0.012, 0, 0.16, 0.16, 0.024, 12).pop();
      sg.push().translate(0.055, 0.06, 0.03).rotateZ(Math.PI / 2).rotateY(0.25).c(0xc0923a).cyl(0, 0, 0, 0.16, 0.15, 0.01, 12, { top: false }).pop();
      break;
    case 'kite':
      sp.push().translate(0.04, 0.02, 0.03).rotateY(Math.PI / 2 + 0.25);
      sp.c(0xffffff, 0.03).box(0, -0.08, 0, 0.18, 0.26, 0.022);
      sp.pop();
      break;
    case 'scutum':
      sp.push().translate(0.045, 0.02, 0.04).rotateY(Math.PI / 2 + 0.2);
      sp.c(0xffffff, 0.03).box(0, -0.16, 0, 0.2, 0.38, 0.025);
      sp.pop();
      sg.push().translate(0.06, 0.02, 0.04).rotateY(Math.PI / 2 + 0.2).c(0xd4a93a).box(0, 0.02, 0.01, 0.04, 0.04, 0.02).pop();
      break;
  }
  weaponGeo(rb.g(P('handR')), rb.g(P('handL')), o.weapon, o.elite);
}

/** Weapon geometry in hand space (arm points -y; +z is forward). */
function weaponGeo(r: GeoBuilder, l: GeoBuilder, w: WeaponKind, elite?: boolean): void {
  const steel = elite ? 0xd8dce4 : 0xb8bcc4;
  const wood = 0x6a4a2a;
  switch (w) {
    case 'sword':
      r.push().rotateX(1.0);
      r.c(0x4a3020).box(0, -0.03, 0, 0.022, 0.08, 0.022).c(elite ? 0xd4a93a : 0x6a6a6a).box(0, 0.045, 0, 0.08, 0.018, 0.022);
      r.c(steel, 0.02).box(0, 0.055, 0, 0.034, 0.3, 0.012);
      r.pop();
      break;
    case 'greatsword':
      r.push().rotateX(1.0);
      r.c(0x4a3020).box(0, -0.06, 0, 0.024, 0.13, 0.024).c(elite ? 0xd4a93a : 0x6a6a6a).box(0, 0.065, 0, 0.12, 0.02, 0.024);
      r.c(steel, 0.02).box(0, 0.075, 0, 0.04, 0.46, 0.014);
      r.pop();
      break;
    case 'axe':
      r.push().rotateX(1.1);
      r.c(wood).cyl(0, -0.08, 0, 0.014, 0.014, 0.4, 4);
      r.c(steel, 0.02).box(0, 0.24, 0.04, 0.012, 0.1, 0.09);
      r.pop();
      break;
    case 'club':
      r.push().rotateX(1.1).c(0x5a3a1a).cyl(0, -0.03, 0, 0.018, 0.04, 0.34, 6).pop();
      break;
    case 'spear':
      r.c(wood).cyl(0, -0.35, 0, 0.012, 0.012, 1.1, 4).c(steel).cone(0, 0.75, 0, 0.022, 0.1, 4);
      break;
    case 'pike':
      r.c(wood).cyl(0, -0.4, 0, 0.012, 0.012, 1.55, 4).c(steel).cone(0, 1.15, 0, 0.02, 0.1, 4);
      break;
    case 'halberd':
      r.c(wood).cyl(0, -0.35, 0, 0.013, 0.013, 1.25, 4).c(steel).cone(0, 0.9, 0, 0.02, 0.1, 4);
      r.c(steel).box(0, 0.78, 0.04, 0.012, 0.12, 0.08).box(0, 0.8, -0.03, 0.01, 0.04, 0.05);
      break;
    case 'lance':
      r.push().rotateX(Math.PI / 2 - 0.15).c(wood).cyl(0, -0.3, 0, 0.014, 0.012, 1.3, 4).c(steel).cone(0, 1.0, 0, 0.02, 0.1, 4).pop();
      break;
    case 'fireLance':
      r.c(wood).cyl(0, -0.35, 0, 0.012, 0.012, 1.1, 4).c(steel).cone(0, 0.75, 0, 0.022, 0.1, 4);
      r.c(0x8a7a3a).cyl(0, 0.52, 0.03, 0.028, 0.028, 0.2, 6).c(0xa82a1a).cyl(0, 0.55, 0.03, 0.03, 0.03, 0.03, 6);
      break;
    case 'bow':
    case 'longbow': {
      const L = w === 'longbow' ? 0.36 : 0.26;
      l.c(0x5a3a1a, 0.04);
      l.push().translate(0, 0.02, 0.05);
      l.push().rotateX(-0.35).box(0, 0, 0, 0.02, L, 0.02).pop();
      l.push().rotateX(0.35).box(0, -L, 0, 0.02, L, 0.02).pop();
      l.c(0xe8e0d0).box(0, -L * 0.94, -0.12, 0.005, L * 1.88, 0.005);
      l.pop();
      break;
    }
    case 'crossbow':
      r.push().rotateX(Math.PI / 2 - 0.1);
      r.c(wood).box(0, -0.05, 0, 0.03, 0.34, 0.035);
      r.c(0x5a5a5a).box(0, 0.24, 0, 0.3, 0.025, 0.025);
      r.pop();
      break;
    case 'gun':
      r.push().rotateX(Math.PI / 2 - 0.1);
      r.c(wood).box(0, -0.08, 0, 0.035, 0.18, 0.04);
      r.c(0x4a4a4a).cyl(0, 0.05, 0, 0.022, 0.02, 0.36, 6);
      r.pop();
      break;
    case 'javelin':
      r.c(wood).cyl(0, -0.2, 0, 0.01, 0.01, 0.7, 4).c(steel).cone(0, 0.5, 0, 0.016, 0.07, 4);
      break;
    case 'staff':
      r.c(0x7a5a38).cyl(0, -0.3, 0, 0.014, 0.012, 1.0, 5);
      r.c(0xd4a93a).sphere(0, 0.72, 0, 0.035, 6, 4).box(0, 0.78, 0, 0.012, 0.08, 0.012);
      break;
    default:
      break;
  }
}

function toolVariants(rb: RigBuilder, prefix = ''): void {
  const P = (n: string) => prefix + n;
  const wood = 0x6a4a2a;
  // axe
  let r = rb.g(P('handR'), false, 'tool:axe');
  r.push().rotateX(1.1).c(wood).cyl(0, -0.08, 0, 0.013, 0.013, 0.38, 4).c(0x9a9ea6).box(0, 0.22, 0.035, 0.012, 0.09, 0.08).pop();
  // pick
  r = rb.g(P('handR'), false, 'tool:pick');
  r.push().rotateX(1.1).c(wood).cyl(0, -0.08, 0, 0.013, 0.013, 0.38, 4).c(0x7a7e86).push().translate(0, 0.28, 0).rotateX(Math.PI / 2).cyl(0, -0.12, 0, 0.01, 0.018, 0.24, 4).pop().pop();
  // hammer
  r = rb.g(P('handR'), false, 'tool:hammer');
  r.push().rotateX(1.1).c(wood).cyl(0, -0.03, 0, 0.012, 0.012, 0.22, 4).c(0x6a6a6a).box(0, 0.18, 0, 0.05, 0.05, 0.1).pop();
  // hoe
  r = rb.g(P('handR'), false, 'tool:hoe');
  r.push().rotateX(0.9).c(wood).cyl(0, -0.3, 0, 0.012, 0.012, 0.75, 4).c(0x7a7e86).box(0, 0.44, 0.04, 0.07, 0.02, 0.08).pop();
  // spear (hunting)
  r = rb.g(P('handR'), false, 'tool:spear');
  r.c(wood).cyl(0, -0.25, 0, 0.011, 0.011, 0.85, 4).c(0xb8bcc4).cone(0, 0.6, 0, 0.02, 0.08, 4);
  // fishing rod
  r = rb.g(P('handR'), false, 'tool:rod');
  r.push().rotateX(0.7).c(0x8a6a3a).cyl(0, -0.1, 0, 0.01, 0.006, 0.9, 4).pop();
  // basket
  const lb = rb.g(P('handL'), false, 'tool:basket');
  lb.c(0xa88450, 0.06).mt(D.thatch).cyl(0, -0.08, 0.05, 0.07, 0.085, 0.09, 7);
  lb.mt(0);
  // carried goods
  const cw = rb.g(P('carry'), false, 'carry:wood');
  cw.push().rotateZ(Math.PI / 2).c(0x6a4a2a).cyl(0.03, -0.15, 0, 0.035, 0.035, 0.3, 5).cyl(-0.03, -0.14, 0.02, 0.035, 0.035, 0.28, 5).cyl(0, -0.16, -0.04, 0.03, 0.03, 0.32, 5).pop();
  const cf = rb.g(P('carry'), false, 'carry:food');
  cf.c(0xa02a2a, 0.08).sphere(0, 0, 0, 0.075, 6, 5, 1.2, 0.8, 1).c(0xe8e0d0).cyl(0.07, -0.01, 0, 0.012, 0.012, 0.06, 4);
  const cg = rb.g(P('carry'), false, 'carry:gold');
  cg.c(0x8a6a3a, 0.06).mt(D.cloth).sphere(0, 0, 0, 0.07, 6, 5);
  cg.mt(0);
  cg.c(0xf0c830, 0.1).blob(0, 0.06, 0.02, 0.04, 0.3, 0.8, 5);
  const cs = rb.g(P('carry'), false, 'carry:stone');
  cs.c(0xa8a49a, 0.08).mt(D.stone).box(0, -0.06, 0, 0.14, 0.11, 0.1);
  cs.mt(0);
}

/* ========================================================================================== */
/* Mounts                                                                                      */
/* ========================================================================================== */

interface MountOpts {
  kind: 'horse' | 'camel';
  coat: number;
  barding?: 'none' | 'cloth' | 'mail' | 'plate' | 'gold';
  light?: boolean;
}

function mount(rb: RigBuilder, o: MountOpts): void {
  rb.bone('root', null, [0, 0, 0]);
  const camel = o.kind === 'camel';
  const bodyY = camel ? 0.76 : 0.62;
  rb.bone('body', 'root', [0, bodyY, 0]);
  rb.bone('neck', 'body', camel ? [0, 0.06, 0.42] : [0, 0.12, 0.42]);
  const legY = -0.1;
  const lx = 0.11, lzF = 0.33, lzB = -0.33;
  rb.bone('legFL', 'body', [lx, legY, lzF]);
  rb.bone('legFR', 'body', [-lx, legY, lzF]);
  rb.bone('legBL', 'body', [lx, legY, lzB]);
  rb.bone('legBR', 'body', [-lx, legY, lzB]);
  rb.bone('tail', 'body', [0, 0.08, -0.5]);
  const b = rb.g('body');
  const coat = o.coat;
  b.c(coat, 0.05).sphere(0, 0, 0, 0.21, 10, 7, 1.0, 1.08, 2.35);
  b.sphere(0, 0.02, 0.3, 0.2, 8, 6, 0.95, 1.05, 1.05);
  b.sphere(0, 0.03, -0.3, 0.21, 8, 6, 1, 1, 1.05);
  if (camel) b.c(coat, 0.06).sphere(0, 0.22, -0.04, 0.2, 8, 6, 1, 1.15, 1.35);
  const pcB = rb.g('body', true);
  switch (o.barding ?? 'cloth') {
    case 'cloth':
      pcB.c(0xffffff, 0.04).mt(D.cloth).box(0, 0.1, -0.04, 0.46, 0.12, 0.34);
      pcB.mt(0);
      b.c(0x4a2a18).box(0, 0.21, -0.04, 0.2, 0.05, 0.26);
      break;
    case 'mail':
      b.c(0x8a8e94, 0.05).sphere(0, -0.01, 0, 0.215, 9, 6, 1.02, 1.05, 2.25);
      pcB.c(0xffffff, 0.04).mt(D.cloth).box(0, 0.1, -0.04, 0.46, 0.12, 0.34);
      pcB.mt(0);
      b.c(0x4a2a18).box(0, 0.21, -0.04, 0.2, 0.06, 0.26);
      break;
    case 'plate':
    case 'gold':
      pcB.c(0xffffff, 0.04).mt(D.cloth).box(0, 0.06, 0, 0.47, 0.16, 0.98);
      pcB.c(0xe8e8e8, 0.04).box(0.235, -0.2, 0, 0.025, 0.28, 0.94).box(-0.235, -0.2, 0, 0.025, 0.28, 0.94);
      pcB.box(0, -0.2, 0.47, 0.44, 0.24, 0.025).box(0, -0.2, -0.47, 0.44, 0.24, 0.025);
      pcB.mt(0);
      b.c(o.barding === 'gold' ? 0xd4a93a : 0xb8bcc4, 0.04).box(0, 0.2, -0.04, 0.24, 0.06, 0.3);
      b.c(o.barding === 'gold' ? 0xd4a93a : 0xb8bcc4, 0.04).sphere(0, 0.06, 0.42, 0.13, 7, 5, 1.1, 0.9, 0.8);
      break;
    case 'none':
      b.c(0x6a4a2a).box(0, 0.2, -0.04, 0.18, 0.05, 0.22);
      break;
  }
  const n = rb.g('neck');
  if (camel) {
    n.c(coat, 0.05).push().rotateX(0.35).cyl(0, 0, 0, 0.085, 0.07, 0.4, 7).pop();
    n.push().translate(0, 0.36, 0.14).rotateX(1.3).cyl(0, 0, 0, 0.065, 0.05, 0.2, 6).pop();
    n.sphere(0, 0.4, 0.3, 0.07, 6, 5, 0.9, 0.85, 1.5);
  } else {
    n.c(coat, 0.05).push().rotateX(0.6).cyl(0, 0, 0, 0.105, 0.075, 0.36, 8).pop();
    n.push().translate(0, 0.29, 0.2).rotateX(1.3).cyl(0, 0, 0, 0.07, 0.048, 0.27, 8).pop();
    n.c(0x2a1c14, 0.05).push().translate(0, 0.2, 0.04).rotateX(0.6).box(0, 0, 0, 0.035, 0.3, 0.07).pop();
    n.c(coat, 0.05).box(0.04, 0.37, 0.15, 0.025, 0.07, 0.035).box(-0.04, 0.37, 0.15, 0.025, 0.07, 0.035);
    if (o.barding === 'plate' || o.barding === 'gold') n.c(o.barding === 'gold' ? 0xd4a93a : 0xb8bcc4).push().translate(0, 0.29, 0.2).rotateX(1.3).cyl(0, 0.08, 0, 0.076, 0.055, 0.15, 7).pop();
    if (o.barding === 'plate' || o.barding === 'gold') rb.g('neck', true).c(0xffffff, 0.04).mt(D.cloth).push().rotateX(0.6).cyl(0, 0, 0, 0.115, 0.09, 0.28, 8).pop();
  }
  const legLen = camel ? 0.66 : 0.52;
  for (const lg of ['legFL', 'legFR', 'legBL', 'legBR']) {
    const g = rb.g(lg);
    const lw = camel ? 1.15 : 1;
    g.c(coat, 0.05).cyl(0, -legLen * 0.5, 0, 0.042 * lw, 0.066 * lw, legLen * 0.5, 6);
    g.cyl(0, -legLen, 0, 0.03 * lw, 0.042 * lw, legLen * 0.5, 6);
    g.c(camel ? 0x8a7050 : 0x1e1612).box(0, -legLen, 0.01, 0.06, 0.045, 0.07);
  }
  rb.g('tail').c(camel ? coat : 0x2a1c14, 0.05).push().rotateX(2.6).cyl(0, 0, 0, 0.035, 0.015, 0.32, 5).pop();
}

/* ========================================================================================== */
/* Model catalogue                                                                              */
/* ========================================================================================== */

function humanRig(id: string, o: HumanOpts, height = 0.86): Rig {
  const rb = new RigBuilder();
  human(rb, o);
  return rb.build(id, 'human', o.weapon, height);
}

function riderRig(id: string, m: MountOpts, o: HumanOpts): Rig {
  const rb = new RigBuilder();
  mount(rb, m);
  human(rb, o, 'r', 'body', true);
  // position rider hips on the saddle
  rb.bones[rb.b['rhips']].pivot = [0, m.kind === 'camel' ? 0.42 : 0.28, -0.04];
  const rig = rb.build(id, 'rider', o.weapon, m.kind === 'camel' ? 1.7 : 1.45, true);
  rig.quadKind = m.kind;
  return rig;
}

function villagerRig(id: string, female: boolean): Rig {
  const rb = new RigBuilder();
  human(rb, female
    ? { weapon: 'none', female: true, helmet: 'scarf', legs: 0x8a6a4a, skin: SKINS[1] }
    : { weapon: 'none', helmet: 'none', hair: 0x5a3a1c, legs: 0x7a5a3a, beard: true });
  toolVariants(rb);
  return rb.build(id, 'human', 'none', 0.86);
}

function quadRig(id: string, kind: 'sheep' | 'deer' | 'boar' | 'wolf'): Rig {
  const rb = new RigBuilder();
  const dims = {
    sheep: { h: 0.26, len: 0.2, r: 0.16, leg: 0.2, col: 0xeeeae0, head: 0x2a2420 },
    deer: { h: 0.38, len: 0.22, r: 0.12, leg: 0.36, col: 0x9a6a3c, head: 0x8a5e34 },
    boar: { h: 0.24, len: 0.22, r: 0.15, leg: 0.18, col: 0x3e3028, head: 0x342820 },
    wolf: { h: 0.3, len: 0.22, r: 0.11, leg: 0.28, col: 0x7a7872, head: 0x6a6862 },
  }[kind];
  rb.bone('root', null, [0, 0, 0]);
  rb.bone('body', 'root', [0, dims.h, 0]);
  rb.bone('head', 'body', [0, 0.06, dims.len + 0.06]);
  rb.bone('legFL', 'body', [0.07, -0.03, dims.len * 0.7]);
  rb.bone('legFR', 'body', [-0.07, -0.03, dims.len * 0.7]);
  rb.bone('legBL', 'body', [0.07, -0.03, -dims.len * 0.7]);
  rb.bone('legBR', 'body', [-0.07, -0.03, -dims.len * 0.7]);
  rb.bone('tail', 'body', [0, 0.04, -dims.len - 0.08]);
  const b = rb.g('body');
  if (kind === 'sheep') b.c(dims.col, 0.1).blob(0, 0.02, 0, dims.r, 0.18, 0.95, 7).blob(0, 0.03, 0.1, dims.r * 0.85, 0.2, 0.9, 6).blob(0, 0.03, -0.1, dims.r * 0.9, 0.2, 0.9, 6);
  else b.c(dims.col, 0.06).sphere(0, 0, 0, dims.r, 8, 6, 1, 1, (dims.len + dims.r) / dims.r);
  if (kind === 'boar') b.c(0x2a2018, 0.1).box(0, dims.r * 0.8, 0.05, 0.04, 0.06, dims.len * 1.4);
  if (kind === 'deer') b.c(0xe8dcc0).sphere(0, -0.02, -dims.len - 0.05, 0.05, 5, 4);
  const h = rb.g('head');
  switch (kind) {
    case 'sheep':
      h.c(dims.head, 0.05).sphere(0, 0, 0.02, 0.065, 6, 5, 0.9, 0.9, 1.3).c(dims.col).sphere(0, 0.04, -0.02, 0.06, 6, 4);
      h.c(dims.head).box(0.06, 0.02, 0, 0.05, 0.02, 0.03).box(-0.06, 0.02, 0, 0.05, 0.02, 0.03);
      break;
    case 'deer':
      h.c(dims.col, 0.05).push().rotateX(0.4).cyl(0, -0.05, -0.02, 0.05, 0.04, 0.18, 6).pop();
      h.sphere(0, 0.14, 0.07, 0.06, 6, 5, 0.9, 0.9, 1.5);
      h.c(0x5a3a1a).push().translate(0.03, 0.19, 0.05).rotateZ(-0.4).cyl(0, 0, 0, 0.01, 0.006, 0.18, 4).pop().push().translate(-0.03, 0.19, 0.05).rotateZ(0.4).cyl(0, 0, 0, 0.01, 0.006, 0.18, 4).pop();
      break;
    case 'boar':
      h.c(dims.head, 0.06).sphere(0, -0.02, 0.05, 0.1, 7, 5, 0.9, 0.85, 1.4).c(0x6a4a3a).cyl(0, -0.04, 0.18, 0.045, 0.045, 0.03, 6);
      h.c(0xf0e8d0).push().translate(0.05, -0.06, 0.15).rotateX(-0.8).cone(0, 0, 0, 0.012, 0.07, 4).pop().push().translate(-0.05, -0.06, 0.15).rotateX(-0.8).cone(0, 0, 0, 0.012, 0.07, 4).pop();
      break;
    case 'wolf':
      h.c(dims.head, 0.05).sphere(0, 0.02, 0.04, 0.075, 7, 5, 0.9, 0.9, 1.2).push().translate(0, 0.0, 0.1).rotateX(Math.PI / 2).cyl(0, 0, 0, 0.04, 0.025, 0.1, 5).pop();
      h.cone(0.035, 0.07, 0.02, 0.022, 0.07, 4).cone(-0.035, 0.07, 0.02, 0.022, 0.07, 4);
      break;
  }
  for (const lg of ['legFL', 'legFR', 'legBL', 'legBR']) {
    const g = rb.g(lg);
    g.c(kind === 'sheep' ? 0x2a2420 : dims.col, 0.05).cyl(0, -dims.leg, 0, 0.022, 0.03, dims.leg, 5);
    g.c(0x1e1612).box(0, -dims.leg, 0.005, 0.03, 0.025, 0.035);
  }
  const t = rb.g('tail');
  if (kind === 'wolf') t.c(dims.col, 0.06).push().rotateX(2.3).cyl(0, 0, 0, 0.035, 0.02, 0.22, 5).pop();
  else if (kind === 'boar') t.c(dims.col).push().rotateX(2.6).cyl(0, 0, 0, 0.01, 0.008, 0.08, 4).pop();
  const rig = rb.build(id, 'quad', kind === 'boar' || kind === 'wolf' ? 'bite' : 'none', dims.h + 0.2);
  rig.quadKind = kind;
  return rig;
}

function elephantRig(id: string, elite: boolean): Rig {
  const rb = new RigBuilder();
  const s = elite ? 1.08 : 1;
  rb.bone('root', null, [0, 0, 0]);
  rb.bone('body', 'root', [0, 0.78 * s, 0]);
  rb.bone('head', 'body', [0, 0.12 * s, 0.5 * s]);
  rb.bone('trunk', 'head', [0, -0.08 * s, 0.2 * s]);
  rb.bone('legFL', 'body', [0.17 * s, -0.12, 0.3 * s]);
  rb.bone('legFR', 'body', [-0.17 * s, -0.12, 0.3 * s]);
  rb.bone('legBL', 'body', [0.17 * s, -0.12, -0.32 * s]);
  rb.bone('legBR', 'body', [-0.17 * s, -0.12, -0.32 * s]);
  rb.bone('tail', 'body', [0, 0.05, -0.62 * s]);
  // rider in the howdah
  rb.bone('rhips', 'body', [0, 0.42 * s, -0.08]);
  rb.bone('rtorso', 'rhips', [0, 0.03, 0]);
  rb.bone('rhead', 'rtorso', [0, 0.31, 0]);
  rb.bone('rarmL', 'rtorso', [0.135, 0.27, 0]);
  rb.bone('rarmR', 'rtorso', [-0.135, 0.27, 0]);
  rb.bone('rhandL', 'rarmL', [0, -0.25, 0.01]);
  rb.bone('rhandR', 'rarmR', [0, -0.25, 0.01]);
  const skin = 0x7e7a76;
  const b = rb.g('body');
  b.c(skin, 0.05).sphere(0, 0, 0, 0.36 * s, 10, 7, 1, 0.95, 1.55);
  const pc = rb.g('body', true);
  pc.c(0xffffff, 0.04).mt(D.cloth).box(0, 0.2 * s, -0.05, 0.76 * s, 0.14 * s, 0.56 * s);
  pc.mt(0);
  b.c(0xd4a93a).box(0, 0.19 * s, -0.05, 0.78 * s, 0.03, 0.58 * s);
  b.c(0x6a4a2a, 0.06).mt(D.planks).box(0, 0.33 * s, -0.08, 0.36 * s, 0.14, 0.4 * s);
  b.mt(0);
  b.c(0x5a3a1c).cyl(0.16 * s, 0.33 * s, 0.1, 0.012, 0.012, 0.42, 4).cyl(-0.16 * s, 0.33 * s, 0.1, 0.012, 0.012, 0.42, 4).cyl(0.16 * s, 0.33 * s, -0.26, 0.012, 0.012, 0.42, 4).cyl(-0.16 * s, 0.33 * s, -0.26, 0.012, 0.012, 0.42, 4);
  rb.g('body', true).c(0xdddddd, 0.04).mt(D.cloth).hip(0, 0.33 * s + 0.42, -0.08, 0.38 * s, 0.12, 0.42 * s, 0.03);
  const h = rb.g('head');
  h.c(skin, 0.05).sphere(0, 0, 0.05, 0.22 * s, 8, 6, 0.95, 1, 1);
  h.c(skin, 0.06).sphere(0.2 * s, 0.03, -0.02, 0.16 * s, 6, 5, 0.3, 1.1, 1).sphere(-0.2 * s, 0.03, -0.02, 0.16 * s, 6, 5, 0.3, 1.1, 1);
  h.c(0xf0ead8).push().translate(0.08 * s, -0.12, 0.18).rotateX(-1.1).cyl(0, 0, 0, 0.025, 0.012, 0.3 * s, 5).pop();
  h.push().translate(-0.08 * s, -0.12, 0.18).rotateX(-1.1).cyl(0, 0, 0, 0.025, 0.012, 0.3 * s, 5).pop();
  if (elite) h.c(0xd4a93a).box(0, 0.12, 0.2, 0.2, 0.08, 0.04);
  const t = rb.g('trunk');
  t.c(skin, 0.05).cyl(0, -0.25 * s, 0, 0.05, 0.075, 0.25 * s, 6).cyl(0, -0.5 * s, 0.02, 0.035, 0.05, 0.25 * s, 6);
  for (const lg of ['legFL', 'legFR', 'legBL', 'legBR']) {
    rb.g(lg).c(skin, 0.05).cyl(0, -0.66 * s, 0, 0.1 * s, 0.11 * s, 0.66 * s, 7).c(0xd8d0c0).cyl(0, -0.66 * s, 0, 0.105 * s, 0.105 * s, 0.03, 7);
  }
  rb.g('tail').c(skin).push().rotateX(2.8).cyl(0, 0, 0, 0.025, 0.015, 0.3, 4).pop();
  // rider
  const rt = rb.g('rtorso', true);
  rt.c(0xffffff).cyl(0, 0, 0, 0.1, 0.12, 0.29, 7);
  rb.g('rhips').c(0x6a5236).cyl(0, -0.1, 0, 0.12, 0.12, 0.12, 7);
  rb.g('rhead').c(SKINS[3], 0.03).sphere(0, 0.075, 0.005, 0.068, 8, 6, 1, 1.1, 1).c(0xe8e0d0).sphere(0, 0.12, 0, 0.078, 8, 5, 1.05, 0.8, 1.05);
  for (const a of ['rarmL', 'rarmR']) rb.g(a).c(SKINS[3]).cyl(0, -0.24, 0, 0.03, 0.036, 0.24, 6);
  rb.g('rhandR').c(0x6a4a2a).cyl(0, -0.3, 0, 0.012, 0.012, 1.0, 4).c(0xb8bcc4).cone(0, 0.7, 0, 0.022, 0.1, 4);
  return rb.build(id, 'elephant', 'tusk', 1.7 * s);
}


function wheel(g: GeoBuilder, x: number, y: number, z: number, r: number, color = 0x4a3420): void {
  g.push().translate(x, y, z).rotateZ(Math.PI / 2);
  g.c(color, 0.06).cyl(0, -0.025, 0, r, r, 0.05, 10);
  g.c(0x2a2018).cyl(0, 0.026, 0, r * 0.25, r * 0.25, 0.01, 6);
  g.pop();
}

function ramRig(id: string, tier: number): Rig {
  const rb = new RigBuilder();
  rb.bone('root', null, [0, 0, 0]);
  rb.bone('body', 'root', [0, 0, 0]);
  rb.bone('wheelF', 'body', [0, 0.16, 0.32]);
  rb.bone('wheelB', 'body', [0, 0.16, -0.32]);
  rb.bone('ram', 'body', [0, 0.36, 0]);
  const b = rb.g('body');
  const len = 1.0 + tier * 0.1;
  b.c(0x6a4a2a, 0.06).mt(D.planks).box(0, 0.2, 0, 0.62, 0.12, len);
  b.mt(0);
  // roof
  const roofCol = tier === 2 ? 0x7a7e86 : 0x7a5a3a;
  b.c(roofCol, 0.06).mt(tier === 2 ? D.stone : D.planks).gable(0, 0.62, 0, 0.66, 0.34, len * 0.98, 0.04);
  b.mt(0);
  if (tier >= 1) b.c(0x9a9ea6).box(0, 0.93, 0, 0.08, 0.05, len);
  for (const x of [0.28, -0.28]) for (const z of [0.4, 0, -0.4]) b.c(0x5a3a1c).box(x, 0.3, z * len, 0.05, 0.34, 0.05);
  rb.g('body', true).c(0xffffff, 0.04).mt(D.cloth).box(0, 0.33, len / 2 - 0.02, 0.5, 0.25, 0.02);
  for (const w of ['wheelF', 'wheelB']) {
    const g = rb.g(w);
    wheel(g, 0.33, 0, 0, 0.16);
    wheel(g, -0.33, 0, 0, 0.16);
  }
  const r = rb.g('ram');
  r.push().rotateX(Math.PI / 2).c(0x5a3a1c, 0.05).cyl(0, -len * 0.45, 0, 0.07, 0.07, len * 1.05, 7).pop();
  r.c(0x7a7e86).push().translate(0, 0, len * 0.6).rotateX(Math.PI / 2).cyl(0, 0, 0, 0.085, 0.07, 0.12, 7).pop();
  if (tier >= 1) r.c(0x6a6e76).sphere(0, 0, len * 0.66, 0.09, 6, 5);
  return rb.build(id, 'ram', 'none', 1.1);
}

function mangonelRig(id: string, tier: number): Rig {
  const rb = new RigBuilder();
  rb.bone('root', null, [0, 0, 0]);
  rb.bone('body', 'root', [0, 0, 0]);
  rb.bone('wheelF', 'body', [0, 0.14, 0.3]);
  rb.bone('wheelB', 'body', [0, 0.14, -0.3]);
  rb.bone('arm', 'body', [0, 0.38, -0.05]);
  const b = rb.g('body');
  b.c(0x6a4a2a, 0.06).box(0.24, 0.12, 0, 0.08, 0.1, 0.9).box(-0.24, 0.12, 0, 0.08, 0.1, 0.9).box(0, 0.12, 0.35, 0.5, 0.08, 0.08).box(0, 0.12, -0.35, 0.5, 0.08, 0.08);
  b.c(0x5a3a1c).box(0.22, 0.2, -0.05, 0.06, 0.32, 0.06).box(-0.22, 0.2, -0.05, 0.06, 0.32, 0.06);
  b.box(0, 0.5, 0.18, 0.5, 0.07, 0.07);
  b.c(0x8a7a5a, 0.1).mt(D.thatch).box(0, 0.45, 0.18, 0.3, 0.06, 0.1);
  b.mt(0);
  if (tier >= 1) b.c(0x7a7e86).box(0.24, 0.22, -0.05, 0.1, 0.06, 0.2).box(-0.24, 0.22, -0.05, 0.1, 0.06, 0.2);
  rb.g('body', true).c(0xffffff, 0.04).mt(D.cloth).box(0.28, 0.14, 0.2, 0.02, 0.1, 0.25).box(-0.28, 0.14, 0.2, 0.02, 0.1, 0.25);
  for (const w of ['wheelF', 'wheelB']) {
    const g = rb.g(w);
    wheel(g, 0.3, 0, 0, 0.14);
    wheel(g, -0.3, 0, 0, 0.14);
  }
  const a = rb.g('arm');
  a.c(0x5a3a1c, 0.05).box(0, 0, 0, 0.07, 0.07, 0.07).push().rotateX(-1.3).box(0, 0, 0, 0.06, 0.65, 0.06).pop();
  a.push().rotateX(-1.3).translate(0, 0.62, 0).c(0x4a3020).cyl(0, 0, 0, 0.1, 0.12, 0.08, 7).c(0x8a8680).sphere(0, 0.09, 0, 0.08 + tier * 0.02, 6, 5).pop();
  return rb.build(id, 'mangonel', 'none', 0.9);
}

function scorpionRig(id: string, heavy: boolean): Rig {
  const rb = new RigBuilder();
  rb.bone('root', null, [0, 0, 0]);
  rb.bone('body', 'root', [0, 0, 0]);
  rb.bone('wheelF', 'body', [0, 0.12, 0.2]);
  rb.bone('wheelB', 'body', [0, 0.12, -0.25]);
  rb.bone('bow', 'body', [0, 0.46, 0.1]);
  const b = rb.g('body');
  b.c(0x6a4a2a, 0.06).box(0, 0.12, -0.02, 0.4, 0.08, 0.7);
  b.c(0x5a3a1c).cyl(0, 0.16, 0, 0.05, 0.05, 0.28, 6);
  b.c(0x6a4a2a).box(0, 0.42, -0.05, 0.08, 0.08, 0.7);
  rb.g('body', true).c(0xffffff, 0.04).mt(D.cloth).box(0, 0.2, 0.33, 0.3, 0.12, 0.02);
  for (const w of ['wheelF', 'wheelB']) {
    const g = rb.g(w);
    wheel(g, 0.24, 0, 0, 0.12);
    wheel(g, -0.24, 0, 0, 0.12);
  }
  const bw = rb.g('bow');
  bw.c(heavy ? 0x6a6e76 : 0x5a3a1c, 0.05).push().rotateY(0.35).box(0.18, 0, 0, 0.36, 0.05, 0.05).pop().push().rotateY(-0.35).box(-0.18, 0, 0, 0.36, 0.05, 0.05).pop();
  bw.c(0xe8e0d0).box(0, 0, -0.14, 0.62, 0.01, 0.01);
  bw.c(0x3a2a1a).box(0, 0.03, 0.05, 0.02, 0.02, 0.5).c(0xb8bcc4).cone(0, 0.03, 0.3, 0.02, 0.05, 4);
  return rb.build(id, 'scorpion', 'none', 0.8);
}

function bombardRig(id: string): Rig {
  const rb = new RigBuilder();
  rb.bone('root', null, [0, 0, 0]);
  rb.bone('body', 'root', [0, 0, 0]);
  rb.bone('wheelF', 'body', [0, 0.2, 0.05]);
  rb.bone('wheelB', 'body', [0, 0.2, 0.05]);
  rb.bone('barrel', 'body', [0, 0.32, 0.05]);
  const b = rb.g('body');
  b.c(0x6a4a2a, 0.06).box(0, 0.12, -0.2, 0.3, 0.12, 0.7).box(0, 0.05, -0.6, 0.12, 0.06, 0.25);
  rb.g('body', true).c(0xffffff, 0.04).mt(D.cloth).box(0, 0.25, -0.35, 0.28, 0.02, 0.2);
  wheel(rb.g('wheelF'), 0.25, 0, 0, 0.22);
  wheel(rb.g('wheelF'), -0.25, 0, 0, 0.22);
  const br = rb.g('barrel');
  br.push().rotateX(Math.PI / 2 - 0.08).c(0x3a3a3a, 0.04).cyl(0, -0.2, 0, 0.12, 0.09, 0.85, 10).c(0x5a5a5a).cyl(0, 0.6, 0, 0.11, 0.11, 0.06, 10).pop();
  return rb.build(id, 'bombard', 'none', 0.8);
}

function trebuchetRig(id: string): Rig {
  const rb = new RigBuilder();
  rb.bone('root', null, [0, 0, 0]);
  rb.bone('body', 'root', [0, 0, 0]);
  rb.bone('wheelF', 'body', [0, 0.15, 0.45]);
  rb.bone('wheelB', 'body', [0, 0.15, -0.45]);
  rb.bone('arm', 'body', [0, 1.55, 0]);
  // unpacked: tall A-frame
  const u = rb.g('body', false, 'unpacked');
  u.c(0x6a4a2a, 0.06).box(0.35, 0.05, 0, 0.1, 0.1, 1.4).box(-0.35, 0.05, 0, 0.1, 0.1, 1.4).box(0, 0.05, 0.6, 0.8, 0.1, 0.1).box(0, 0.05, -0.6, 0.8, 0.1, 0.1);
  for (const s of [0.3, -0.3]) {
    u.push().translate(s, 0.1, 0.45).rotateX(-0.28).box(0, 0, 0, 0.08, 1.52, 0.08).pop();
    u.push().translate(s, 0.1, -0.45).rotateX(0.28).box(0, 0, 0, 0.08, 1.52, 0.08).pop();
  }
  u.c(0x5a3a1c).box(0, 1.52, 0, 0.72, 0.08, 0.08);
  rb.g('body', true, 'unpacked').c(0xffffff, 0.04).mt(D.cloth).box(0.41, 0.3, 0.2, 0.02, 0.3, 0.5).box(-0.41, 0.3, 0.2, 0.02, 0.3, 0.5);
  const a = rb.g('arm', false, 'unpacked');
  a.c(0x5a3a1c, 0.05).push().rotateX(-0.9).box(0, -0.55, 0, 0.08, 2.1, 0.08).pop();
  a.push().rotateX(-0.9).translate(0, -0.55, 0).c(0x4a4a4a).box(0, -0.25, 0, 0.3, 0.3, 0.3).pop();
  a.push().rotateX(-0.9).translate(0, 1.5, 0).c(0x8a7a5a).box(0, 0, 0, 0.02, 0.4, 0.02).pop();
  // packed: cart with folded beam
  const p = rb.g('body', false, 'packed');
  p.c(0x6a4a2a, 0.06).box(0, 0.18, 0, 0.55, 0.1, 1.5);
  p.c(0x5a3a1c).push().translate(0, 0.35, 0).rotateX(Math.PI / 2).cyl(0, -0.9, 0, 0.06, 0.06, 1.9, 6).pop();
  p.c(0x6a4a2a).box(0.18, 0.28, 0.2, 0.08, 0.2, 0.9).box(-0.18, 0.28, 0.2, 0.08, 0.2, 0.9);
  p.c(0x4a4a4a).box(0, 0.28, -0.5, 0.26, 0.2, 0.26);
  rb.g('body', true, 'packed').c(0xffffff, 0.04).mt(D.cloth).box(0, 0.42, 0.3, 0.4, 0.04, 0.6);
  for (const w of ['wheelF', 'wheelB']) {
    const g = rb.g(w, false, 'packed');
    wheel(g, 0.32, 0, 0, 0.15);
    wheel(g, -0.32, 0, 0, 0.15);
  }
  return rb.build(id, 'trebuchet', 'none', 2.2);
}

function cartRig(id: string): Rig {
  const rb = new RigBuilder();
  rb.bone('root', null, [0, 0, 0]);
  rb.bone('body', 'root', [0, 0, -0.2]);
  rb.bone('wheelF', 'body', [0, 0.18, 0]);
  rb.bone('wheelB', 'body', [0, 0.18, 0]);
  rb.bone('mule', 'root', [0, 0.42, 0.42]);
  rb.bone('legFL', 'mule', [0.08, -0.04, 0.2]);
  rb.bone('legFR', 'mule', [-0.08, -0.04, 0.2]);
  rb.bone('legBL', 'mule', [0.08, -0.04, -0.2]);
  rb.bone('legBR', 'mule', [-0.08, -0.04, -0.2]);
  const b = rb.g('body');
  b.c(0x7a5a38, 0.06).mt(D.planks).box(0, 0.25, 0, 0.5, 0.2, 0.6);
  b.mt(0);
  b.c(0x5a3a1c).box(0.12, 0.3, 0.45, 0.03, 0.03, 0.5).box(-0.12, 0.3, 0.45, 0.03, 0.03, 0.5);
  b.c(0xb86a3a).sphere(0.12, 0.5, 0.1, 0.07, 6, 5, 1, 1.3, 1).sphere(-0.1, 0.5, -0.1, 0.07, 6, 5, 1, 1.3, 1);
  rb.g('body', true).c(0xffffff, 0.04).mt(D.cloth).gable(0, 0.45, 0, 0.5, 0.22, 0.5, 0.02);
  wheel(rb.g('wheelF'), 0.29, 0, 0, 0.18);
  wheel(rb.g('wheelF'), -0.29, 0, 0, 0.18);
  const m = rb.g('mule');
  m.c(0x6a5a4a, 0.05).sphere(0, 0, 0, 0.13, 7, 5, 0.9, 0.9, 2.1).push().translate(0, 0.05, 0.25).rotateX(0.8).cyl(0, 0, 0, 0.06, 0.05, 0.22, 6).pop();
  m.sphere(0, 0.18, 0.42, 0.06, 6, 4, 0.9, 0.9, 1.6).box(0.03, 0.26, 0.36, 0.015, 0.08, 0.02).box(-0.03, 0.26, 0.36, 0.015, 0.08, 0.02);
  for (const lg of ['legFL', 'legFR', 'legBL', 'legBR']) rb.g(lg).c(0x6a5a4a, 0.05).cyl(0, -0.38, 0, 0.022, 0.03, 0.38, 5);
  return rb.build(id, 'cart', 'none', 0.9);
}

function monkRig(id: string): Rig {
  const rb = new RigBuilder();
  human(rb, { weapon: 'staff', robe: true, tunic: 0xe8dcc0, helmet: 'hood', skin: SKINS[1], sash: true });
  // relic carried variant
  rb.g('carry', false, 'relic').c(0xd4a93a, 0.08).box(0, -0.05, 0.03, 0.16, 0.12, 0.12).c(0xf4e2a0).sphere(0, 0.09, 0.03, 0.03, 5, 4);
  return rb.build(id, 'human', 'staff', 0.86);
}

/* ========================================================================================== */
/* Ships                                                                                       */
/* ========================================================================================== */

/** Boat hull along z (bow at +z) with its waterline at y=0. */
function hull(g: GeoBuilder, len: number, wid: number, top: number, color: number, deckColor = 0x9a7a4a, round = 0.5): void {
  const N = 9;
  const secs: [number, number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const z = -len / 2 + t * len;
    const u = t * 2 - 1;
    const w = wid * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u), 2.2)), round) + 0.01;
    const lift = Math.pow(Math.abs(u), 3) * 0.12;
    secs.push([z, w, top + lift]);
  }
  const ring = (s: [number, number, number]): [number, number, number][] => {
    const [z, w, t] = s;
    return [[-w, t, z], [-w * 0.75, t * 0.3, z], [0, -0.12, z], [w * 0.75, t * 0.3, z], [w, t, z]];
  };
  g.c(color, 0.05).mt(D.planks);
  for (let i = 0; i < N; i++) {
    const a = ring(secs[i]), b = ring(secs[i + 1]);
    for (let k = 0; k < 4; k++) g.quad(a[k], b[k], b[k + 1], a[k + 1]);
  }
  g.c(deckColor, 0.05);
  for (let i = 0; i < N; i++) {
    const a = ring(secs[i]), b = ring(secs[i + 1]);
    g.quad(a[4], b[4], b[0], a[0]);
  }
  g.mt(0);
  // gunwale trim
  g.c(0x4a3018, 0.05);
  for (let i = 0; i < N; i++) {
    const a = secs[i], b = secs[i + 1];
    for (const sgn of [-1, 1]) g.quad([sgn * a[1], a[2], a[0]], [sgn * b[1], b[2], b[0]], [sgn * b[1], b[2] + 0.03, b[0]], [sgn * a[1], a[2] + 0.03, a[0]]);
  }
}

interface ShipOpts {
  len: number;
  wid: number;
  hullCol: number;
  mast?: number;
  sail?: 'square' | 'lateen' | 'none';
  masts?: number;
  oars?: number;
  shields?: boolean;
  castle?: boolean;
  cannons?: boolean;
  cargo?: boolean;
  fire?: boolean;
  kegs?: boolean;
  net?: boolean;
  crew?: number;
  ram?: boolean;
}

function shipRig(id: string, o: ShipOpts): Rig {
  const rb = new RigBuilder();
  rb.bone('root', null, [0, 0, 0]);
  rb.bone('hull', 'root', [0, 0, 0]);
  rb.bone('sail', 'hull', [0, 0.3, 0.05]);
  rb.bone('oarsL', 'hull', [o.wid * 0.9, 0.2, 0]);
  rb.bone('oarsR', 'hull', [-o.wid * 0.9, 0.2, 0]);
  rb.bone('net', 'hull', [0, 0.25, -o.len * 0.42]);
  const h = rb.g('hull');
  const top = 0.24;
  hull(h, o.len, o.wid, top, o.hullCol);
  if (o.ram) h.c(0x9a7a3a).push().translate(0, 0.02, o.len / 2 + 0.05).rotateX(Math.PI / 2).cone(0, 0, 0, 0.06, 0.25, 5).pop();
  if (o.castle) {
    h.c(o.hullCol, 0.05).mt(D.planks).box(0, top, -o.len * 0.36, o.wid * 1.6, 0.26, o.len * 0.22);
    h.box(0, top, o.len * 0.36, o.wid * 1.4, 0.18, o.len * 0.16);
    h.mt(0);
    h.c(0x4a3018).box(0, top + 0.26, -o.len * 0.36, o.wid * 1.7, 0.04, o.len * 0.23);
  }
  const masts = o.masts ?? (o.sail === 'none' ? 0 : 1);
  const mh = o.mast ?? 1.0;
  for (let m = 0; m < masts; m++) {
    const mz = masts === 1 ? 0.05 : (m === 0 ? o.len * 0.18 : -o.len * 0.18);
    h.c(0x5a3a1a, 0.04).cyl(0, top, mz, 0.03, 0.022, mh, 6);
    h.c(0x5a3a1a).box(0, top + mh * 0.85, mz, o.wid * 2.2, 0.03, 0.03);
    const sp = rb.g('sail', true);
    sp.mt(D.cloth);
    if (o.sail === 'lateen') {
      sp.c(0xffffff, 0.04).tri([0, top + mh * 0.95 - 0.3, mz + 0.35], [0, top + 0.15 - 0.3, mz + 0.3], [0, top + 0.15 - 0.3, mz - 0.35]);
      sp.tri([0, top + mh * 0.95 - 0.3, mz + 0.35], [0, top + 0.15 - 0.3, mz - 0.35], [0, top + 0.15 - 0.3, mz + 0.3]);
    } else if (o.sail !== 'none') {
      const sw = o.wid * 2.0, sh = mh * 0.62;
      sp.c(0xffffff, 0.04).box(0, top + mh * 0.25 - 0.3, mz + 0.03, sw, sh, 0.03);
      sp.c(0xdddddd, 0.04).box(0, top + mh * 0.25 - 0.3 + sh * 0.45, mz + 0.05, sw, sh * 0.12, 0.01);
    }
    sp.mt(0);
    h.c(0xd4a93a).sphere(0, top + mh + 0.02, mz, 0.035, 5, 3);
  }
  if (masts) rb.g('hull', true).c(0xffffff).box(0.05, top + mh + 0.1, -0.02, 0.14, 0.08, 0.01);
  if (o.oars) {
    for (const side of ['oarsL', 'oarsR']) {
      const g = rb.g(side);
      const s = side === 'oarsL' ? 1 : -1;
      for (let i = 0; i < o.oars; i++) {
        const z = -o.len * 0.3 + (i / Math.max(1, o.oars - 1)) * o.len * 0.6;
        g.c(0x7a5a38).push().translate(0, 0, z).rotateZ(s * 1.1).cyl(0, 0, 0, 0.012, 0.012, 0.42, 4).pop();
      }
    }
  }
  if (o.shields) {
    const pc = rb.g('hull', true);
    const n = Math.round(o.len * 3.5);
    for (let i = 0; i < n; i++) {
      const z = -o.len * 0.36 + (i / (n - 1)) * o.len * 0.72;
      for (const s of [1, -1]) pc.c(i % 2 ? 0xffffff : 0xcccccc).push().translate(s * (o.wid * 0.98), top + 0.05, z).rotateZ(s * Math.PI / 2).cyl(0, 0, 0, 0.07, 0.07, 0.02, 8).pop();
    }
  }
  if (o.cannons) {
    const n = 3;
    for (let i = 0; i < n; i++) for (const s of [1, -1]) h.c(0x2a2a2a).push().translate(s * o.wid * 0.95, top - 0.02, -0.3 + i * 0.3).rotateZ(-s * Math.PI / 2).cyl(0, 0, 0, 0.035, 0.03, 0.18, 6).pop();
  }
  if (o.cargo) {
    h.c(0x7a5230, 0.06).mt(D.planks).box(0.08, top, -0.2, 0.18, 0.16, 0.18).box(-0.1, top, 0.15, 0.18, 0.14, 0.2);
    h.mt(0);
    h.c(0xb86a3a).sphere(-0.08, top + 0.08, -0.25, 0.06, 6, 4, 1, 1.3, 1);
  }
  if (o.fire) {
    h.c(0x5a5a5a).cyl(0, top, o.len * 0.38, 0.07, 0.09, 0.12, 7);
    h.c(0xff7a1a).sphere(0, top + 0.16, o.len * 0.38, 0.07, 6, 4);
    h.c(0x3a3a3a).push().translate(0, top + 0.1, o.len * 0.4).rotateX(1.2).cyl(0, 0, 0, 0.025, 0.02, 0.3, 5).pop();
  }
  if (o.kegs) {
    for (let i = 0; i < 4; i++) h.c(0x6a4a2a, 0.06).cyl(-0.08 + (i % 2) * 0.16, top, -0.15 + Math.floor(i / 2) * 0.22, 0.07, 0.07, 0.15, 7);
    h.c(0x2a2a2a).sphere(0, top + 0.2, 0, 0.05, 5, 4);
  }
  if (o.net) {
    rb.g('net').c(0xb0a890, 0.1).push().rotateX(0.6).box(0, -0.2, 0, 0.3, 0.4, 0.01).pop();
    rb.g('net').c(0x5a3a1a).cyl(0, 0, 0, 0.012, 0.012, 0.3, 4);
  }
  // crew figures
  const crew = o.crew ?? 1;
  for (let i = 0; i < crew; i++) {
    const z = (i - (crew - 1) / 2) * (o.len * 0.5 / Math.max(1, crew));
    const x = crew > 1 ? (i % 2 ? 0.08 : -0.08) : 0;
    rb.g('hull', true).c(0xffffff).cyl(x, top, z, 0.045, 0.055, 0.2, 6);
    rb.g('hull').c(SKINS[1]).sphere(x, top + 0.26, z, 0.045, 6, 4);
  }
  return rb.build(id, 'ship', 'none', 0.9 + mh * 0.5);
}

const RIGS = new Map<string, Rig>();
const DEFS: Record<string, () => Rig> = {
  villager: () => villagerRig('villager', false),
  villagerF: () => villagerRig('villagerF', true),
  militia: () => humanRig('militia', { weapon: 'sword', helmet: 'cap', armor: 'leather', shield: 'none' }),
  manAtArms: () => humanRig('manAtArms', { weapon: 'sword', helmet: 'conical', armor: 'mail', shield: 'round', beard: true }),
  longSwordsman: () => humanRig('longSwordsman', { weapon: 'sword', helmet: 'full', armor: 'mail', shield: 'kite' }),
  twoHanded: () => humanRig('twoHanded', { weapon: 'greatsword', helmet: 'full', armor: 'plate', shield: 'none' }),
  champion: () => humanRig('champion', { weapon: 'greatsword', helmet: 'plumed', armor: 'plate', cape: true, elite: true }),
  spearman: () => humanRig('spearman', { weapon: 'spear', helmet: 'cap', armor: 'leather', shield: 'round' }),
  pikeman: () => humanRig('pikeman', { weapon: 'pike', helmet: 'conical', armor: 'mail' }),
  halberdier: () => humanRig('halberdier', { weapon: 'halberd', helmet: 'full', armor: 'plate' }),
  archer: () => humanRig('archer', { weapon: 'bow', helmet: 'hood', quiver: true }),
  crossbowman: () => humanRig('crossbowman', { weapon: 'crossbow', helmet: 'conical', armor: 'leather', quiver: true }),
  arbalest: () => humanRig('arbalest', { weapon: 'crossbow', helmet: 'full', armor: 'mail', quiver: true, elite: true }),
  skirmisher: () => humanRig('skirmisher', { weapon: 'javelin', helmet: 'none', shield: 'small', hair: 0x6a4a2a }),
  eliteSkirmisher: () => humanRig('eliteSkirmisher', { weapon: 'javelin', helmet: 'conical', shield: 'round', armor: 'leather' }),
  handCannoneer: () => humanRig('handCannoneer', { weapon: 'gun', helmet: 'wide', armor: 'leather' }),
  monk: () => monkRig('monk'),
  scout: () => riderRig('scout', { kind: 'horse', coat: 0x8a5a32, barding: 'none', light: true }, { weapon: 'spear', helmet: 'cap', armor: 'leather' }),
  lightCav: () => riderRig('lightCav', { kind: 'horse', coat: 0x6a4228, barding: 'cloth' }, { weapon: 'sword', helmet: 'conical', armor: 'leather' }),
  hussar: () => riderRig('hussar', { kind: 'horse', coat: 0xe8e0d0, barding: 'cloth' }, { weapon: 'sword', helmet: 'plumed', armor: 'mail' }),
  knight: () => riderRig('knight', { kind: 'horse', coat: 0x3a2a20, barding: 'mail' }, { weapon: 'sword', helmet: 'full', armor: 'plate', shield: 'kite' }),
  cavalier: () => riderRig('cavalier', { kind: 'horse', coat: 0x5a3a24, barding: 'plate' }, { weapon: 'sword', helmet: 'plumed', armor: 'plate', shield: 'kite' }),
  paladin: () => riderRig('paladin', { kind: 'horse', coat: 0xe8e4dc, barding: 'gold' }, { weapon: 'sword', helmet: 'plumed', armor: 'plate', shield: 'kite', cape: true, elite: true }),
  camel: () => riderRig('camel', { kind: 'camel', coat: 0xc8a068, barding: 'cloth' }, { weapon: 'sword', helmet: 'turban', skin: SKINS[2] }),
  heavyCamel: () => riderRig('heavyCamel', { kind: 'camel', coat: 0xb8905a, barding: 'mail' }, { weapon: 'sword', helmet: 'conical', armor: 'mail', skin: SKINS[2] }),
  cavArcher: () => riderRig('cavArcher', { kind: 'horse', coat: 0x8a5a32, barding: 'cloth' }, { weapon: 'bow', helmet: 'hood', quiver: true }),
  heavyCavArcher: () => riderRig('heavyCavArcher', { kind: 'horse', coat: 0x5a3a24, barding: 'mail' }, { weapon: 'bow', helmet: 'conical', armor: 'mail', quiver: true }),
  warElephant: () => elephantRig('warElephant', false),
  eliteWarElephant: () => elephantRig('eliteWarElephant', true),
  legionary: () => humanRig('legionary', { weapon: 'sword', helmet: 'galea', armor: 'mail', shield: 'scutum', legs: 0xb03020 }),
  eliteLegionary: () => humanRig('eliteLegionary', { weapon: 'sword', helmet: 'galea', armor: 'plate', shield: 'scutum', cape: true, legs: 0xb03020, elite: true }),
  phalangite: () => humanRig('phalangite', { weapon: 'pike', helmet: 'crested', armor: 'bronze', shield: 'hoplon' }),
  elitePhalangite: () => humanRig('elitePhalangite', { weapon: 'pike', helmet: 'crested', armor: 'bronze', shield: 'hoplon', cape: true, elite: true }),
  gaesatae: () => humanRig('gaesatae', { weapon: 'greatsword', helmet: 'none', bare: true, hair: 0xc89040, legs: 0x3a6a3a, bulk: 1.08, beard: true }),
  eliteGaesatae: () => humanRig('eliteGaesatae', { weapon: 'greatsword', helmet: 'none', bare: true, hair: 0xd8a850, legs: 0x3a6a3a, bulk: 1.12, beard: true, cape: true, elite: true }),
  berserker: () => humanRig('berserker', { weapon: 'axe', helmet: 'wolf', bare: true, legs: 0x5a4a3a, bulk: 1.1, beard: true, hair: 0x8a5a2a }),
  eliteBerserker: () => humanRig('eliteBerserker', { weapon: 'axe', helmet: 'wolf', bare: true, legs: 0x5a4a3a, bulk: 1.15, beard: true, hair: 0x8a5a2a, shield: 'round', elite: true }),
  horseArcher: () => riderRig('horseArcher', { kind: 'horse', coat: 0xa06a3a, barding: 'cloth' }, { weapon: 'bow', helmet: 'phrygian', helmetColor: 0xe8e0d0, quiver: true, skin: SKINS[1] }),
  eliteHorseArcher: () => riderRig('eliteHorseArcher', { kind: 'horse', coat: 0xe0d8c8, barding: 'mail' }, { weapon: 'bow', helmet: 'phrygian', helmetColor: 0xd4a93a, armor: 'mail', quiver: true, skin: SKINS[1], elite: true }),
  bowman: () => humanRig('bowman', { weapon: 'longbow', helmet: 'feather', skin: SKINS[4], sash: true, legs: 0xe8e0d0, quiver: true }),
  eliteBowman: () => humanRig('eliteBowman', { weapon: 'longbow', helmet: 'feather', skin: SKINS[4], sash: true, legs: 0xe8e0d0, quiver: true, armor: 'leather', elite: true }),
  fireLancer: () => humanRig('fireLancer', { weapon: 'fireLance', helmet: 'conical', helmetColor: 0x5a2a20, armor: 'lamellar', skin: SKINS[1] }),
  eliteFireLancer: () => humanRig('eliteFireLancer', { weapon: 'fireLance', helmet: 'plumed', helmetColor: 0xd4a93a, armor: 'lamellar', skin: SKINS[1], cape: true, elite: true }),
  sheep: () => quadRig('sheep', 'sheep'),
  deer: () => quadRig('deer', 'deer'),
  boar: () => quadRig('boar', 'boar'),
  wolf: () => quadRig('wolf', 'wolf'),
  ram: () => ramRig('ram', 0),
  cappedRam: () => ramRig('cappedRam', 1),
  siegeRam: () => ramRig('siegeRam', 2),
  mangonel: () => mangonelRig('mangonel', 0),
  onager: () => mangonelRig('onager', 1),
  siegeOnager: () => mangonelRig('siegeOnager', 2),
  scorpion: () => scorpionRig('scorpion', false),
  heavyScorpion: () => scorpionRig('heavyScorpion', true),
  bombard: () => bombardRig('bombard'),
  trebuchet: () => trebuchetRig('trebuchet'),
  tradeCart: () => cartRig('tradeCart'),
  fishingShip: () => shipRig('fishingShip', { len: 1.0, wid: 0.26, hullCol: 0x8a6a42, mast: 0.8, sail: 'lateen', net: true, crew: 1 }),
  transportShip: () => shipRig('transportShip', { len: 1.45, wid: 0.4, hullCol: 0x7a5a38, mast: 1.0, sail: 'square', cargo: true, crew: 1 }),
  tradeCog: () => shipRig('tradeCog', { len: 1.3, wid: 0.44, hullCol: 0x8a6a42, mast: 1.1, sail: 'square', castle: true, cargo: true, crew: 1 }),
  galley: () => shipRig('galley', { len: 1.8, wid: 0.3, hullCol: 0x6a4a2a, mast: 1.0, sail: 'square', oars: 6, ram: true, crew: 3 }),
  warGalley: () => shipRig('warGalley', { len: 1.95, wid: 0.32, hullCol: 0x5a3e24, mast: 1.1, sail: 'square', oars: 7, ram: true, shields: true, crew: 3 }),
  galleon: () => shipRig('galleon', { len: 2.1, wid: 0.42, hullCol: 0x5a3e24, mast: 1.3, sail: 'square', masts: 2, castle: true, shields: true, crew: 3 }),
  fireShip: () => shipRig('fireShip', { len: 1.6, wid: 0.3, hullCol: 0x5a3a24, mast: 0.9, sail: 'square', oars: 5, fire: true, crew: 2 }),
  fastFireShip: () => shipRig('fastFireShip', { len: 1.7, wid: 0.3, hullCol: 0x4a3020, mast: 1.0, sail: 'square', oars: 6, fire: true, ram: true, crew: 2 }),
  demolitionShip: () => shipRig('demolitionShip', { len: 1.1, wid: 0.28, hullCol: 0x6a5a4a, sail: 'none', oars: 3, kegs: true, crew: 1 }),
  heavyDemolitionShip: () => shipRig('heavyDemolitionShip', { len: 1.25, wid: 0.3, hullCol: 0x5a4a3a, sail: 'none', oars: 4, kegs: true, crew: 1 }),
  cannonGalleon: () => shipRig('cannonGalleon', { len: 2.2, wid: 0.45, hullCol: 0x4a3220, mast: 1.3, sail: 'square', masts: 2, castle: true, cannons: true, crew: 2 }),
};

export function getRig(model: string): Rig {
  let r = RIGS.get(model);
  if (!r) {
    const f = DEFS[model] ?? DEFS.militia;
    r = f();
    r.id = model;
    RIGS.set(model, r);
  }
  return r;
}

export const RIG_IDS = Object.keys(DEFS);
