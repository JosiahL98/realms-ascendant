import * as THREE from 'three';
import type { Game } from '../sim/game';
import type { ArchStyle } from '../data/types';
import { buildingModel, foundationModel, scaffoldModel, type BuildingModel } from './models/buildings';
import { rubbleModel } from './models/nature';
import { makeWorldMaterial } from './materials';
import { InstBatch } from './instBatch';

interface BBatch {
  model: BuildingModel;
  main: InstBatch;
  pc: InstBatch;
  sails: InstBatch | null;
}

interface Rubble {
  x: number;
  z: number;
  y: number;
  w: number;
  h: number;
  t0: number;
}

export class BuildingView {
  group = new THREE.Group();
  private batches = new Map<string, BBatch>();
  private foundations = new Map<string, InstBatch>();
  private scaffolds = new Map<string, InstBatch>();
  private rubbleBatch: InstBatch;
  rubble: Rubble[] = [];
  private m = new THREE.Matrix4();
  private m2 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private matMain = makeWorldMaterial({ fog: 'origin', clip: true, detail: true });
  private matPlain = makeWorldMaterial({ fog: 'origin' });

  constructor() {
    this.rubbleBatch = new InstBatch(this.group, rubbleModel(), this.matPlain, { shadow: false });
  }

  private batch(type: string, style: ArchStyle): BBatch {
    const key = type + ':' + style;
    let b = this.batches.get(key);
    if (!b) {
      const model = buildingModel(type, style);
      b = {
        model,
        main: new InstBatch(this.group, model.main, this.matMain, { clip: true }),
        pc: new InstBatch(this.group, model.pc, this.matMain, { clip: true, color: true }),
        sails: model.sails ? new InstBatch(this.group, model.sails.geo, this.matPlain) : null,
      };
      this.batches.set(key, b);
    }
    return b;
  }

  private foundation(w: number, h: number): InstBatch {
    const key = `${w}x${h}`;
    let b = this.foundations.get(key);
    if (!b) {
      b = new InstBatch(this.group, foundationModel(w, h), this.matPlain, { shadow: false });
      this.foundations.set(key, b);
    }
    return b;
  }

  private scaffold(w: number, h: number, height: number): InstBatch {
    const hh = Math.max(1, Math.round(height * 2) / 2);
    const key = `${w}x${h}x${hh}`;
    let b = this.scaffolds.get(key);
    if (!b) {
      b = new InstBatch(this.group, scaffoldModel(w, h, hh), this.matPlain, { shadow: true });
      this.scaffolds.set(key, b);
    }
    return b;
  }

  addRubble(game: Game, x: number, z: number, w: number, h: number): void {
    this.rubble.push({ x, z, y: game.map.heightAt(x, z), w, h, t0: game.time });
  }

  update(game: Game, localTeam: number, colorOf: (owner: number) => number, inView: (x: number, z: number, r: number) => boolean): void {
    for (const b of this.batches.values()) {
      b.main.begin();
      b.pc.begin();
      b.sails?.begin();
    }
    for (const f of this.foundations.values()) f.begin();
    for (const f of this.scaffolds.values()) f.begin();
    const bit = 1 << (localTeam & 15);
    const time = game.time;
    for (const b of game.buildings) {
      if (!b.alive) continue;
      const own = game.teamOf[b.owner] === localTeam;
      if (!own && !(b.seenBy & bit)) continue;
      if (!inView(b.x, b.z, Math.max(b.w, b.h) + 3)) continue;
      const style = game.players[b.owner].civ.style;
      const bb = this.batch(b.type, style);
      const rot = b.rotated ? Math.PI / 2 : 0;
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rot);
      this.m.compose(this.p.set(b.x, b.baseY, b.z), this.q, this.s);
      let clip = 1000;
      if (!b.built) clip = b.progress <= 0.001 ? -1 : Math.max(0.05, b.progress * bb.model.height);
      let color = colorOf(b.owner);
      if (b.def.foodCapacity) {
        const cap = (b.def.foodCapacity ?? 175) + game.players[b.owner].farmFood;
        const f = Math.max(0, Math.min(1, b.food / cap));
        color = cropColor(f, b.built);
      }
      bb.main.add(this.m, undefined, clip);
      bb.pc.add(this.m, color, clip);
      if (!b.built) {
        if (!b.def.walkable) this.foundation(b.def.size[0], b.def.size[1]).add(this.m);
        if (b.progress > 0.001 && !b.def.walkable && !b.def.wall) this.scaffold(b.def.size[0], b.def.size[1], Math.min(bb.model.height, b.progress * bb.model.height + 0.6)).add(this.m);
      } else if (bb.sails && bb.model.sails) {
        const pv = bb.model.sails.pivot;
        this.m2.makeRotationZ(time * 1.1 + b.id);
        this.m2.setPosition(pv[0], pv[1], pv[2]);
        bb.sails.add(this.m.clone().multiply(this.m2));
      }
    }
    for (const b of this.batches.values()) {
      b.main.end();
      b.pc.end();
      b.sails?.end();
    }
    for (const f of this.foundations.values()) f.end();
    for (const f of this.scaffolds.values()) f.end();

    // rubble
    this.rubbleBatch.begin();
    const keep: Rubble[] = [];
    for (const r of this.rubble) {
      const age = time - r.t0;
      if (age > 40) continue;
      keep.push(r);
      const sink = age > 30 ? (age - 30) * 0.03 : 0;
      this.q.identity();
      this.m.compose(this.p.set(r.x, r.y - sink, r.z), this.q, this.s.set(r.w * 0.9, Math.min(r.w, r.h) * 0.6, r.h * 0.9));
      this.rubbleBatch.add(this.m);
      this.s.set(1, 1, 1);
    }
    this.rubble = keep;
    this.rubbleBatch.end();
  }
}

function cropColor(f: number, built: boolean): number {
  if (!built) return 0x8a7a50;
  // lush green -> ripe gold -> stubble brown
  const c1 = new THREE.Color(0x6aa83a), c2 = new THREE.Color(0xd8c050), c3 = new THREE.Color(0x8a6a3a);
  const c = f > 0.5 ? c2.lerp(c1, (f - 0.5) * 2) : c3.lerp(c2, f * 2);
  return c.getHex();
}
