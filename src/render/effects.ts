import * as THREE from 'three';
import type { Game } from '../sim/game';
import { TICK } from '../sim/game';
import type { ProjectileKind } from '../data/types';
import { GeoBuilder } from './geo';
import { makeWorldMaterial } from './materials';
import { InstBatch } from './instBatch';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grow: number;
  r: number;
  g: number;
  b: number;
  a: number;
  additive: boolean;
  gravity: number;
}

const MAX_PARTICLES = 3000;

function projectileGeo(kind: ProjectileKind): THREE.BufferGeometry {
  const g = new GeoBuilder(9);
  switch (kind) {
    case 'arrow':
      g.push().rotateX(Math.PI / 2).c(0x6a4a2a).cyl(0, -0.2, 0, 0.012, 0.012, 0.4, 3).c(0x9a9ea6).cone(0, 0.2, 0, 0.02, 0.06, 3).c(0xf0f0f0).box(0, -0.2, 0, 0.05, 0.08, 0.004).pop();
      break;
    case 'bolt':
      g.push().rotateX(Math.PI / 2).c(0x5a3a1a).cyl(0, -0.25, 0, 0.02, 0.02, 0.5, 4).c(0x9a9ea6).cone(0, 0.25, 0, 0.03, 0.08, 4).pop();
      break;
    case 'javelin':
      g.push().rotateX(Math.PI / 2).c(0x7a5a38).cyl(0, -0.3, 0, 0.012, 0.012, 0.6, 3).c(0x9a9ea6).cone(0, 0.3, 0, 0.018, 0.07, 3).pop();
      break;
    case 'stone':
    case 'boulder':
      g.c(0x8a8680, 0.1).blob(0, 0, 0, kind === 'boulder' ? 0.16 : 0.11, 0.3, 1, 6);
      break;
    case 'bullet':
      g.c(0x2a2a2a).sphere(0, 0, 0, 0.03, 5, 4);
      break;
    case 'cannonball':
      g.c(0x2a2a2a).sphere(0, 0, 0, 0.08, 7, 5);
      break;
    case 'fire':
      g.c(0xffa030).sphere(0, 0, 0, 0.08, 5, 4);
      break;
  }
  return g.build();
}

function flagGeo(): { pole: THREE.BufferGeometry; cloth: THREE.BufferGeometry } {
  const g = new GeoBuilder(3);
  g.c(0x5a3e24).cyl(0, 0, 0, 0.025, 0.02, 0.9, 5).c(0xd4a93a).sphere(0, 0.92, 0, 0.04, 5, 4);
  const c = new GeoBuilder(4);
  c.c(0xffffff, 0.02).box(0.2, 0.55, 0, 0.36, 0.3, 0.02);
  return { pole: g.build(), cloth: c.build() };
}

export class Effects {
  group = new THREE.Group();
  private projBatches = new Map<ProjectileKind, InstBatch>();
  private particles: Particle[] = [];
  private points: THREE.Points;
  private pointsAdd: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private posA: Float32Array;
  private colA: Float32Array;
  private sizeA: Float32Array;
  private ringBatch: InstBatch;
  private squareBatch: InstBatch;
  private markerBatch: InstBatch;
  private flagPole: InstBatch;
  private flagCloth: InstBatch;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  markers: { x: number; z: number; t0: number; color: number }[] = [];
  pointScale = { value: 64 };

  constructor() {
    const mat = makeWorldMaterial({ fog: 'none' });
    const kinds: ProjectileKind[] = ['arrow', 'bolt', 'javelin', 'stone', 'boulder', 'bullet', 'cannonball', 'fire'];
    for (const k of kinds) this.projBatches.set(k, new InstBatch(this.group, projectileGeo(k), mat, { cap: 64, shadow: k === 'stone' || k === 'boulder' }));

    const mkPoints = (additive: boolean): [THREE.Points, Float32Array, Float32Array, Float32Array] => {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(MAX_PARTICLES * 3);
      const col = new Float32Array(MAX_PARTICLES * 4);
      const size = new Float32Array(MAX_PARTICLES);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('pcolor', new THREE.BufferAttribute(col, 4));
      geo.setAttribute('psize', new THREE.BufferAttribute(size, 1));
      const m = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: { uScale: this.pointScale },
        vertexShader: `
          attribute vec4 pcolor; attribute float psize; uniform float uScale; varying vec4 vC;
          void main() { vC = pcolor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = psize * uScale; }
        `,
        fragmentShader: `
          varying vec4 vC;
          void main() { vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; if (r > 1.0) discard; float a = vC.a * (1.0 - r * r); gl_FragColor = vec4(vC.rgb, a); }
        `,
      });
      const pts = new THREE.Points(geo, m);
      pts.frustumCulled = false;
      pts.renderOrder = 5;
      return [pts, pos, col, size];
    };
    [this.points, this.pos, this.col, this.size] = mkPoints(false);
    [this.pointsAdd, this.posA, this.colA, this.sizeA] = mkPoints(true);
    this.group.add(this.points, this.pointsAdd);

    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const ring = new THREE.RingGeometry(0.86, 1.0, 28);
    ring.rotateX(-Math.PI / 2);
    this.ringBatch = new InstBatch(this.group, ring, ringMat, { cap: 64, color: true, shadow: false, receive: false });
    this.ringBatch.mesh.renderOrder = 2;
    const sq = new THREE.BufferGeometry();
    {
      const pts: number[] = [];
      const o = 1, i = 0.93;
      const quad = (a: number[], b: number[], c: number[], d: number[]) => pts.push(...a, ...b, ...c, ...a, ...c, ...d);
      quad([-o, 0, -o], [-o, 0, o], [-i, 0, o], [-i, 0, -o]);
      quad([i, 0, -o], [i, 0, o], [o, 0, o], [o, 0, -o]);
      quad([-i, 0, -o], [-i, 0, -i], [i, 0, -i], [i, 0, -o]);
      quad([-i, 0, i], [-i, 0, o], [i, 0, o], [i, 0, i]);
      sq.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      sq.computeVertexNormals();
    }
    const sqMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.squareBatch = new InstBatch(this.group, sq, sqMat, { cap: 16, color: true, shadow: false, receive: false });
    this.squareBatch.mesh.renderOrder = 2;
    const mk = new THREE.RingGeometry(0.5, 0.75, 20);
    mk.rotateX(-Math.PI / 2);
    this.markerBatch = new InstBatch(this.group, mk, ringMat.clone(), { cap: 8, color: true, shadow: false, receive: false });
    const f = flagGeo();
    this.flagPole = new InstBatch(this.group, f.pole, mat, { cap: 4 });
    this.flagCloth = new InstBatch(this.group, f.cloth, mat, { cap: 4, color: true });
  }

  /* ---------------- particles ---------------- */
  spawn(x: number, y: number, z: number, opts: Partial<Particle> & { count?: number; spread?: number; speed?: number }): void {
    const count = opts.count ?? 1;
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const sp = opts.spread ?? 0.1;
      const spd = opts.speed ?? 0.3;
      const a = Math.random() * Math.PI * 2;
      this.particles.push({
        x: x + (Math.random() - 0.5) * sp * 2, y: y + (Math.random() - 0.5) * sp, z: z + (Math.random() - 0.5) * sp * 2,
        vx: (opts.vx ?? 0) + Math.cos(a) * spd * Math.random(), vy: (opts.vy ?? 0.5) * (0.6 + Math.random() * 0.8), vz: (opts.vz ?? 0) + Math.sin(a) * spd * Math.random(),
        life: 0, max: (opts.max ?? 1) * (0.7 + Math.random() * 0.6), size: (opts.size ?? 0.2) * (0.7 + Math.random() * 0.6), grow: opts.grow ?? 0.5,
        r: opts.r ?? 0.6, g: opts.g ?? 0.6, b: opts.b ?? 0.6, a: opts.a ?? 0.6, additive: opts.additive ?? false, gravity: opts.gravity ?? 0,
      });
    }
  }

  smoke(x: number, y: number, z: number, amount = 1, dark = false): void {
    const c = dark ? 0.25 : 0.55;
    this.spawn(x, y, z, { count: amount, r: c, g: c, b: c * 0.95, a: 0.45, size: 0.35, grow: 1.2, max: 2.5, vy: 0.45, speed: 0.08, spread: 0.15 });
  }
  fire(x: number, y: number, z: number, amount = 1): void {
    this.spawn(x, y, z, { count: amount, r: 1, g: 0.55, b: 0.15, a: 0.8, size: 0.28, grow: -0.1, max: 0.6, vy: 0.9, speed: 0.1, spread: 0.2, additive: true });
  }
  dust(x: number, y: number, z: number, amount = 4, big = false): void {
    this.spawn(x, y, z, { count: amount, r: 0.55, g: 0.46, b: 0.34, a: 0.5, size: big ? 0.5 : 0.22, grow: 1.0, max: big ? 1.6 : 0.8, vy: 0.3, speed: big ? 1.2 : 0.5, spread: big ? 0.6 : 0.15 });
  }
  sparks(x: number, y: number, z: number, amount = 4): void {
    this.spawn(x, y, z, { count: amount, r: 1, g: 0.85, b: 0.4, a: 0.9, size: 0.08, grow: -0.5, max: 0.35, vy: 1.4, speed: 1.2, spread: 0.05, additive: true, gravity: 5 });
  }
  chips(x: number, y: number, z: number, color: [number, number, number]): void {
    this.spawn(x, y, z, { count: 2, r: color[0], g: color[1], b: color[2], a: 0.95, size: 0.06, grow: 0, max: 0.5, vy: 1.5, speed: 0.8, spread: 0.05, gravity: 6 });
  }
  glow(x: number, y: number, z: number, amount = 10): void {
    this.spawn(x, y, z, { count: amount, r: 1, g: 0.95, b: 0.6, a: 0.8, size: 0.2, grow: -0.2, max: 1.2, vy: 0.8, speed: 0.6, spread: 0.3, additive: true });
  }

  private updateParticles(dt: number): void {
    const alive: Particle[] = [];
    for (const p of this.particles) {
      p.life += dt;
      if (p.life >= p.max) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy -= p.gravity * dt;
      p.vx *= 0.98;
      p.vz *= 0.98;
      alive.push(p);
    }
    this.particles = alive;
    let n = 0, na = 0;
    for (const p of this.particles) {
      const k = p.life / p.max;
      const alpha = p.a * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85);
      const size = Math.max(0.01, p.size * (1 + p.grow * k));
      if (p.additive) {
        this.posA.set([p.x, p.y, p.z], na * 3);
        this.colA.set([p.r, p.g, p.b, alpha], na * 4);
        this.sizeA[na] = size;
        na++;
      } else {
        this.pos.set([p.x, p.y, p.z], n * 3);
        this.col.set([p.r, p.g, p.b, alpha], n * 4);
        this.size[n] = size;
        n++;
      }
    }
    for (const [pts, cnt] of [[this.points, n], [this.pointsAdd, na]] as [THREE.Points, number][]) {
      const g = pts.geometry;
      g.setDrawRange(0, cnt);
      g.getAttribute('position').needsUpdate = true;
      g.getAttribute('pcolor').needsUpdate = true;
      g.getAttribute('psize').needsUpdate = true;
    }
  }

  /* ---------------- projectiles ---------------- */
  private updateProjectiles(game: Game, alpha: number): void {
    for (const b of this.projBatches.values()) b.begin();
    const now = game.time + alpha * TICK;
    for (const pr of game.projectiles) {
      if (pr.done) continue;
      const u = Math.min(1, Math.max(0, (now - pr.t0) / pr.dur));
      const x = pr.sx + (pr.tx - pr.sx) * u;
      const z = pr.sz + (pr.tz - pr.sz) * u;
      const y = pr.sy + (pr.ty - pr.sy) * u + pr.arc * 4 * u * (1 - u);
      const dx = pr.tx - pr.sx, dz = pr.tz - pr.sz;
      const dy = pr.ty - pr.sy + pr.arc * 4 * (1 - 2 * u);
      const yaw = Math.atan2(dx, dz);
      const pitch = -Math.atan2(dy, Math.hypot(dx, dz));
      this.e.set(pitch, yaw, 0, 'YXZ');
      this.q.setFromEuler(this.e);
      this.m.compose(this.p.set(x, y, z), this.q, this.s.set(1, 1, 1));
      this.projBatches.get(pr.kind)?.add(this.m);
      if (pr.kind === 'fire') this.fire(x, y, z, 1);
      if (pr.kind === 'cannonball' && Math.random() < 0.3) this.smoke(x, y, z, 1, false);
    }
    for (const b of this.projBatches.values()) b.end();
  }

  /* ---------------- selection rings & markers ---------------- */
  beginRings(): void {
    this.ringBatch.begin();
    this.squareBatch.begin();
    this.flagPole.begin();
    this.flagCloth.begin();
  }
  ring(x: number, y: number, z: number, r: number, color: number): void {
    this.q.identity();
    this.m.compose(this.p.set(x, y + 0.04, z), this.q, this.s.set(r, 1, r * 0.95));
    this.ringBatch.add(this.m, color);
  }
  square(x: number, y: number, z: number, w: number, h: number, color: number): void {
    this.q.identity();
    this.m.compose(this.p.set(x, y + 0.05, z), this.q, this.s.set(w / 2 + 0.05, 1, h / 2 + 0.05));
    this.squareBatch.add(this.m, color);
  }
  rallyFlag(x: number, y: number, z: number, color: number): void {
    this.q.identity();
    this.m.compose(this.p.set(x, y, z), this.q, this.s.set(1, 1, 1));
    this.flagPole.add(this.m);
    this.flagCloth.add(this.m, color);
  }
  endRings(): void {
    this.ringBatch.end();
    this.squareBatch.end();
    this.flagPole.end();
    this.flagCloth.end();
  }

  addMarker(x: number, z: number, t0: number, color: number): void {
    this.markers.push({ x, z, t0, color });
  }

  update(game: Game, alpha: number, dt: number, realTime: number): void {
    this.updateProjectiles(game, alpha);
    this.updateParticles(dt);
    this.markerBatch.begin();
    const keep: typeof this.markers = [];
    for (const mk of this.markers) {
      const age = realTime - mk.t0;
      if (age > 0.6) continue;
      keep.push(mk);
      const r = 0.9 - age * 1.0;
      this.q.identity();
      this.m.compose(this.p.set(mk.x, game.map.surfaceAt(mk.x, mk.z) + 0.06, mk.z), this.q, this.s.set(r, 1, r));
      this.markerBatch.add(this.m, mk.color);
    }
    this.markers = keep;
    this.markerBatch.end();
  }
}
