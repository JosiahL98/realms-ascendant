import * as THREE from 'three';
import type { Game } from '../sim/game';
import type { Building, Entity, ResourceNode, Unit } from '../sim/entities';
import { worldUniforms } from './materials';
import { makeDetailTextures } from './textures';
import { TerrainView } from './terrainView';
import { UnitView } from './unitView';
import { BuildingView } from './buildingView';
import { PropView } from './propView';
import { GroundDetailView } from './groundView';
import { Effects } from './effects';
import { getRig } from './models/units';
import { buildingModel } from './models/buildings';
import type { TextureAssets } from './assets';
import { PostFX, installGrading, loadQuality, saveQuality, type GraphicsQuality } from './post';
import { BUILDINGS } from '../data/buildings';

export const CAM_ELEV = Math.PI / 6; // 30 degrees -> 2:1 diamonds
export const CAM_AZIM = Math.PI / 4;

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  terrain: TerrainView;
  units = new UnitView();
  buildings = new BuildingView();
  props = new PropView();
  ground: GroundDetailView;
  fx = new Effects();
  game: Game;
  localPlayer: number;
  localTeam: number;
  /** Camera target on the ground. */
  camX = 0;
  camZ = 0;
  /** Pixels per world unit. */
  zoom = 62;
  width = 1;
  height = 1;
  private fogTex: THREE.DataTexture;
  private fogData: Uint8Array;
  private fogVersion = -1;
  private camDir = new THREE.Vector3();
  private tmpV = new THREE.Vector3();
  private ghost: THREE.Group | null = null;
  private ghostKey = '';
  private ghostMats: [THREE.MeshLambertMaterial, THREE.MeshLambertMaterial];
  private ghostGrid: THREE.Mesh;
  private viewPoly: { x: number; z: number }[] = [];
  private lastFrame = performance.now();
  selectedIds = new Set<number>();
  hoverId = 0;
  /** Composer for the high-quality path; null when rendering straight to the canvas. */
  post: PostFX | null = null;
  quality: GraphicsQuality = 'medium';

  constructor(canvas: HTMLCanvasElement, game: Game, localPlayer: number, assets: TextureAssets | null = null) {
    this.game = game;
    this.localPlayer = localPlayer;
    this.localTeam = game.teamOf[localPlayer];
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    installGrading();
    const tm = new URLSearchParams(location.search).get('tm') ?? 'graded';
    this.gl.toneMapping = tm === 'none' ? THREE.NoToneMapping : tm === 'agx' ? THREE.AgXToneMapping : tm === 'aces' ? THREE.ACESFilmicToneMapping
      : tm === 'neutral' ? THREE.NeutralToneMapping : THREE.CustomToneMapping;
    this.gl.toneMappingExposure = Number(new URLSearchParams(location.search).get('exposure') ?? 1.08);
    this.scene.background = new THREE.Color(0x000000);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
    this.camDir.set(Math.cos(CAM_ELEV) * Math.sin(CAM_AZIM), Math.sin(CAM_ELEV), Math.cos(CAM_ELEV) * Math.cos(CAM_AZIM));

    this.hemi = new THREE.HemisphereLight(0xcfe0ff, 0x6a5a3a, 1.35);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    worldUniforms.uMapSize.value = game.map.n;
    worldUniforms.uDetailTex.value = assets?.detail ?? makeDetailTextures(11);
    worldUniforms.uDetailGain.value = assets?.detail ? 2.0 : 1.9;
    const n = game.map.n;
    this.fogData = new Uint8Array(n * n);
    this.fogTex = new THREE.DataTexture(this.fogData, n, n, THREE.RedFormat, THREE.UnsignedByteType);
    this.fogTex.magFilter = this.fogTex.minFilter = THREE.LinearFilter;
    this.fogTex.needsUpdate = true;
    worldUniforms.uFogTex.value = this.fogTex;

    this.terrain = new TerrainView(game.map, assets?.terrain ?? null);
    this.scene.add(this.terrain.mesh, this.terrain.water);
    this.ground = new GroundDetailView(game);
    this.scene.add(this.ground.group);
    this.scene.add(this.units.group, this.buildings.group, this.props.group, this.fx.group);

    this.ghostMats = [
      new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.6, color: 0xa0ffa0, depthWrite: false }),
      new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.6, color: 0xff8080, depthWrite: false }),
    ];
    const gg = new THREE.PlaneGeometry(1, 1);
    gg.rotateX(-Math.PI / 2);
    this.ghostGrid = new THREE.Mesh(gg, new THREE.MeshBasicMaterial({ color: 0x40ff40, transparent: true, opacity: 0.25, depthWrite: false }));
    this.ghostGrid.visible = false;
    this.ghostGrid.renderOrder = 3;
    this.scene.add(this.ghostGrid);

    // precompile a few common rigs
    for (const id of ['villager', 'villagerF', 'scout', 'sheep']) getRig(id);
    this.resize();
    this.applyQuality((new URLSearchParams(location.search).get('quality') as GraphicsQuality | null) ?? loadQuality());
  }

  setQuality(q: GraphicsQuality): void {
    saveQuality(q);
    this.applyQuality(q);
  }

  private applyQuality(q: GraphicsQuality): void {
    this.quality = q;
    this.post?.dispose();
    this.post = q === 'high' ? new PostFX(this.gl, this.scene, this.camera) : null;
    this.post?.setSize(this.width, this.height);
    this.sun.castShadow = q !== 'low';
    this.ground.group.visible = q !== 'low';
  }

  resize(): void {
    const c = this.gl.domElement;
    const w = c.clientWidth || window.innerWidth, h = c.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    this.gl.setSize(w, h, false);
    this.post?.setSize(w, h);
    this.updateCamera();
  }

  setZoom(z: number): void {
    this.zoom = Math.max(28, Math.min(120, z));
    this.updateCamera();
  }

  centerOn(x: number, z: number): void {
    const n = this.game.map.n;
    this.camX = Math.max(-4, Math.min(n + 4, x));
    this.camZ = Math.max(-4, Math.min(n + 4, z));
    this.updateCamera();
  }

  updateCamera(): void {
    const w = this.width / 2 / this.zoom, h = this.height / 2 / this.zoom;
    const cam = this.camera;
    cam.left = -w;
    cam.right = w;
    cam.top = h;
    cam.bottom = -h;
    const ty = this.game.map.surfaceAt(this.camX, this.camZ) * 0 + 0.3;
    const d = 150;
    cam.position.set(this.camX + this.camDir.x * d, ty + this.camDir.y * d, this.camZ + this.camDir.z * d);
    cam.lookAt(this.camX, ty, this.camZ);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    // sun follows the view
    const sunDir = new THREE.Vector3(-0.55, 0.78, 0.3).normalize();
    this.sun.position.set(this.camX + sunDir.x * 60, sunDir.y * 60, this.camZ + sunDir.z * 60);
    this.sun.target.position.set(this.camX, 0, this.camZ);
    this.sun.target.updateMatrixWorld();
    const R = Math.max(this.width, this.height * 2) / this.zoom * 0.62 + 4;
    const sc = this.sun.shadow.camera;
    sc.left = -R;
    sc.right = R;
    sc.top = R;
    sc.bottom = -R;
    sc.near = 1;
    sc.far = 160;
    sc.updateProjectionMatrix();
    this.fx.pointScale.value = this.zoom * Math.min(window.devicePixelRatio, 2);
    // view polygon on the ground (for culling and minimap)
    this.viewPoly = [
      this.screenToGroundFlat(0, 0), this.screenToGroundFlat(this.width, 0),
      this.screenToGroundFlat(this.width, this.height), this.screenToGroundFlat(0, this.height),
    ];
  }

  /** Ground polygon visible on screen (at height 0). */
  getViewPolygon(): { x: number; z: number }[] {
    return this.viewPoly;
  }

  /** Quick conservative check whether a ground point is within view (with margin in tiles). */
  inView = (x: number, z: number, margin = 2): boolean => {
    // project to screen space directly
    const v = this.tmpV.set(x, this.game.map.heightAt(x, z), z).project(this.camera);
    const mx = (margin * this.zoom * 1.5) / this.width, my = (margin * this.zoom * 1.5) / this.height;
    return v.x > -1 - mx && v.x < 1 + mx && v.y > -1 - my - 0.1 && v.y < 1 + my + 0.25;
  };

  project(x: number, y: number, z: number): { x: number; y: number } {
    const v = this.tmpV.set(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.width, y: (-v.y * 0.5 + 0.5) * this.height };
  }

  private ray(sx: number, sy: number): { o: THREE.Vector3; d: THREE.Vector3 } {
    const nx = (sx / this.width) * 2 - 1, ny = -(sy / this.height) * 2 + 1;
    const o = new THREE.Vector3(nx, ny, -1).unproject(this.camera);
    const d = this.camDir.clone().multiplyScalar(-1);
    return { o, d };
  }

  private screenToGroundFlat(sx: number, sy: number): { x: number; z: number } {
    const { o, d } = this.ray(sx, sy);
    const t = (0 - o.y) / d.y;
    return { x: o.x + d.x * t, z: o.z + d.z * t };
  }

  /** Intersect the screen ray with the terrain heightfield. */
  screenToGround(sx: number, sy: number): { x: number; z: number } {
    const { o, d } = this.ray(sx, sy);
    const map = this.game.map;
    // start above the highest possible terrain
    let t = (4 - o.y) / d.y;
    const tEnd = (-10 - o.y) / d.y;
    const step = 0.2;
    let prevT = t;
    let prevAbove = true;
    for (; t < tEnd; t += step) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const h = map.surfaceAt(x, z);
      const above = y > h;
      if (!above && prevAbove) {
        // bisection
        let a = prevT, b = t;
        for (let i = 0; i < 12; i++) {
          const m = (a + b) / 2;
          const yy = o.y + d.y * m, xx = o.x + d.x * m, zz = o.z + d.z * m;
          if (yy > map.surfaceAt(xx, zz)) a = m;
          else b = m;
        }
        return { x: o.x + d.x * b, z: o.z + d.z * b };
      }
      prevAbove = above;
      prevT = t;
    }
    return this.screenToGroundFlat(sx, sy);
  }

  /** Pick the front-most entity under the cursor. */
  pick(sx: number, sy: number, filter?: (e: Entity) => boolean): Entity | null {
    const { o, d } = this.ray(sx, sy);
    const g = this.game;
    let best: Entity | null = null;
    let bt = Infinity;
    const test = (e: Entity, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
      if (filter && !filter(e)) return;
      const t = rayBox(o, d, x0, y0, z0, x1, y1, z1);
      if (t !== null && t < bt) {
        bt = t;
        best = e;
      }
    };
    for (const u of this.units.drawn) {
      if (!u.alive) continue;
      const rig = getRig(u.def.model);
      const r = Math.max(0.28, u.radius * 1.2);
      const y = g.map.surfaceAt(u.x, u.z);
      test(u, u.x - r, y, u.z - r, u.x + r, y + rig.height * 0.95, u.z + r);
    }
    const bit = 1 << (this.localTeam & 15);
    for (const b of g.buildings) {
      if (!b.alive) continue;
      if (this.localTeam >= 0 && g.teamOf[b.owner] !== this.localTeam && !(b.seenBy & bit)) continue;
      const hgt = b.built ? buildingModel(b.type, g.players[b.owner].civ.style).height * 0.8 : 0.4;
      test(b, b.tx + 0.05, b.baseY - 0.2, b.tz + 0.05, b.tx + b.w - 0.05, b.baseY + hgt, b.tz + b.h - 0.05);
    }
    if (!best || (best as Entity).kind !== 'unit') {
      const exp = g.vision.explored.get(this.localTeam);
      const n = g.map.n;
      // resources: only check near the ground point for speed
      const gp = this.screenToGround(sx, sy);
      for (const r of g.resources) {
        if (!r.alive || (r.type === 'relic' && r.heldBy)) continue;
        if (Math.abs(r.x - gp.x) > 4 || Math.abs(r.z - gp.z) > 4) continue;
        if (exp && !exp[Math.floor(r.z) * n + Math.floor(r.x)]) continue;
        const y = g.map.heightAt(r.x, r.z);
        const hgt = r.type === 'tree' ? (r.felled ? 0.3 : 2.0) : r.type === 'relic' ? 0.4 : 0.6;
        const rr = r.type === 'tree' ? 0.42 : 0.45;
        test(r, r.x - rr, y, r.z - rr, r.x + rr, y + hgt, r.z + rr);
      }
    }
    return best;
  }

  /** Own/visible units whose screen position lies within the rectangle. */
  unitsInRect(x0: number, y0: number, x1: number, y1: number): Unit[] {
    const out: Unit[] = [];
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
    for (const u of this.units.drawn) {
      if (!u.alive) continue;
      const rig = getRig(u.def.model);
      const p = this.project(u.x, this.game.map.surfaceAt(u.x, u.z) + rig.height * 0.4, u.z);
      if (p.x >= ax && p.x <= bx && p.y >= ay && p.y <= by) out.push(u);
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Placement ghost                                                      */
  /* ------------------------------------------------------------------ */

  showGhost(type: string | null, tx = 0, tz = 0, ok = true, rotated = false): void {
    if (!type) {
      if (this.ghost) this.ghost.visible = false;
      this.ghostGrid.visible = false;
      return;
    }
    const g = this.game;
    const style = g.players[this.localPlayer].civ.style;
    const key = type + ':' + style;
    if (this.ghostKey !== key) {
      if (this.ghost) this.scene.remove(this.ghost);
      const model = buildingModel(type, style);
      this.ghost = new THREE.Group();
      this.ghost.add(new THREE.Mesh(model.main, this.ghostMats[0]));
      this.ghost.add(new THREE.Mesh(model.pc, this.ghostMats[0]));
      this.ghost.renderOrder = 4;
      this.scene.add(this.ghost);
      this.ghostKey = key;
    }
    const sz = BUILDINGS[type]?.size ?? [1, 1];
    const bw = rotated ? sz[1] : sz[0];
    const bh = rotated ? sz[0] : sz[1];
    const fh = g.map.footprintHeight(Math.max(0, tx), Math.max(0, tz), bw, bh);
    const m = ok ? this.ghostMats[0] : this.ghostMats[1];
    this.ghost!.children.forEach((c) => ((c as THREE.Mesh).material = m));
    this.ghost!.visible = true;
    this.ghost!.position.set(tx + bw / 2, fh.max, tz + bh / 2);
    this.ghost!.rotation.y = rotated ? Math.PI / 2 : 0;
    this.ghostGrid.visible = true;
    this.ghostGrid.position.set(tx + bw / 2, fh.max + 0.06, tz + bh / 2);
    this.ghostGrid.scale.set(bw, 1, bh);
    (this.ghostGrid.material as THREE.MeshBasicMaterial).color.setHex(ok ? 0x40ff40 : 0xff3030);
  }

  /* ------------------------------------------------------------------ */
  /* Per-frame                                                            */
  /* ------------------------------------------------------------------ */

  /** Whose eyes the world is drawn through: a team, or -1 to see everything (spectating). */
  setViewTeam(team: number): void {
    this.localTeam = team;
    this.fogVersion = -1;
  }

  private updateFog(): void {
    const v = this.game.vision;
    if (v.version === this.fogVersion) return;
    this.fogVersion = v.version;
    const vis = v.visible.get(this.localTeam), exp = v.explored.get(this.localTeam);
    const d = this.fogData;
    if (!vis || !exp) {
      d.fill(255);
    } else {
      for (let i = 0; i < d.length; i++) d[i] = vis[i] ? 255 : exp[i] ? 125 : 0;
    }
    this.fogTex.needsUpdate = true;
  }

  private dyes = new Map<number, number>();

  /** Player colour as a cloth dye on models: a little deeper and less saturated than the UI swatch. */
  colorOf = (owner: number): number => {
    let c = this.dyes.get(owner);
    if (c === undefined) {
      const hsl = { h: 0, s: 0, l: 0 };
      const col = new THREE.Color(this.game.players[owner]?.color.hex ?? 0xffffff);
      col.getHSL(hsl);
      c = col.setHSL(hsl.h, hsl.s * 0.82, hsl.l * 0.9).getHex();
      this.dyes.set(owner, c);
    }
    return c;
  };

  render(alpha: number): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const g = this.game;
    worldUniforms.uTime.value = now / 1000;
    this.updateFog();
    this.units.update(g, alpha, this.localTeam, (x, z) => this.inView(x, z, 2), this.colorOf);
    this.buildings.update(g, this.localTeam, this.colorOf, (x, z, r) => this.inView(x, z, r));
    this.props.update(g, this.localTeam);
    this.ground.update(g);
    this.fx.update(g, alpha, dt, now / 1000);
    this.updateSelectionFx(alpha);
    if (this.post) this.post.render();
    else this.gl.render(this.scene, this.camera);
  }

  private updateSelectionFx(alpha: number): void {
    const g = this.game;
    const fx = this.fx;
    fx.beginRings();
    for (const id of this.selectedIds) {
      const e = g.get(id);
      if (!e || !e.alive) continue;
      const col = e.owner === this.localPlayer ? 0xffffff : g.isEnemy(this.localPlayer, e.owner) ? 0xff4040 : e.owner === 0 ? 0xe8e0a0 : 0x60ff60;
      if (e.kind === 'unit') {
        if (e.garrisonedIn) continue;
        const x = e.px + (e.x - e.px) * alpha, z = e.pz + (e.z - e.pz) * alpha;
        fx.ring(x, g.map.surfaceAt(x, z), z, Math.max(0.28, e.radius * 1.35), col);
      } else if (e.kind === 'building') {
        fx.square(e.x, e.baseY, e.z, e.w, e.h, col);
        if (e.rally && e.owner === this.localPlayer) fx.rallyFlag(e.rally.x, g.map.surfaceAt(e.rally.x, e.rally.z), e.rally.z, this.colorOf(e.owner));
      } else {
        fx.ring(e.x, g.map.heightAt(e.x, e.z), e.z, 0.5, col);
      }
    }
    fx.endRings();
  }
}

function rayBox(o: THREE.Vector3, d: THREE.Vector3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number | null {
  let tmin = -Infinity, tmax = Infinity;
  const axes: [number, number, number, number][] = [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]];
  for (const [oo, dd, a, b] of axes) {
    if (Math.abs(dd) < 1e-9) {
      if (oo < a || oo > b) return null;
      continue;
    }
    let t1 = (a - oo) / dd, t2 = (b - oo) / dd;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

export type { Building, ResourceNode };
