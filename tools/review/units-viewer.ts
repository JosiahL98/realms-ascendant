// A viewer for the baked unit models, drawn by the game's own renderer (BakedUnits). Served by Vite:
//   npm run dev, then /tools/review/units-viewer.html?units=knight,paladin&anim=attack
// Query: units (ids, default all), anim (idle | walk | trot | canter | attack | die | work), cols, dist.
// window.__shot({ anim, t, azim, elev, dist, target }) renders one frame and returns a PNG data URL (for scripts).
import * as THREE from 'three';
import { BakedUnits } from '../../src/render/bakedView';
import { getBakedRig, loadBakedRigs, type BakedRig } from '../../src/render/models/baked';
import { worldUniforms } from '../../src/render/materials';
import type { AnimState } from '../../src/render/anim';

const q = new URLSearchParams(location.search);
const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
white.needsUpdate = true;
worldUniforms.uFogTex.value = white;
worldUniforms.uMapSize.value = 1e6;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb9b49f);
scene.add(new THREE.HemisphereLight(0xfff4e0, 0x5a5040, 1.3));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
sun.position.set(-6, 10, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 0.5, far: 40 });
scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: 0x8a8460 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const group = new THREE.Group();
scene.add(group);
const units = new BakedUnits(group);
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);

const TEAM = [0x2a5ad8, 0xc83228, 0x2a9a3a, 0xd8c030, 0x7a3ac8, 0x2ab8c8, 0xe8e8e8, 0xe07a20];
let rigs: BakedRig[] = [];
let anim = q.get('anim') || 'idle';
let azim = 0.7, elev = 0.5, dist = Number(q.get('dist') || 0);
const target = new THREE.Vector3();
const COLS = Number(q.get('cols') || 0);
const SPACING = 2.4;

function layout(i: number, n: number): [number, number] {
  const cols = Math.min(n, COLS || Math.ceil(Math.sqrt(n * 1.6)));
  const r = Math.floor(i / cols), c = i % cols;
  return [(c - (cols - 1) / 2) * SPACING, -r * SPACING * 1.1];
}

function state(rig: BakedRig, a: string, t: number): AnimState {
  const gaits = rig.meta.gaits;
  let moving = false, speed = 0;
  if (a === 'walk' || a === 'trot' || a === 'canter') {
    moving = true;
    speed = gaits ? (gaits[a]?.speed ?? gaits.walk.speed) : rig.meta.walkSpeed ?? 0.8;
    if (!gaits && a !== 'walk') speed *= 1;
  }
  const name = (a === 'trot' || a === 'canter' ? 'walk' : a) as AnimState['anim'];
  return { anim: name, t, time: t, speed, moving, attackDelay: rig.meta.attackHit ?? 0.5, reload: 2, tool: null, seed: 0, packed: false };
}

function draw(t: number): void {
  units.begin();
  rigs.forEach((rig, i) => {
    const [x, z] = layout(i, rigs.length);
    const at = anim === 'attack' ? t % Math.max(1.6, (rig.meta.attackHit ?? 0.5) * 2 + 0.4) : anim === 'die' ? Math.min(t % 4, 3) : t;
    units.draw(rig, x, 0, z, 0, state(rig, anim, at), TEAM[i % TEAM.length], null, anim === 'work', 1, false);
  });
  units.end();
}

function place(): void {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  camera.position.set(target.x + dist * Math.cos(elev) * Math.sin(azim), target.y + dist * Math.sin(elev), target.z + dist * Math.cos(elev) * Math.cos(azim));
  camera.lookAt(target);
}

function labels(): void {
  const box = document.getElementById('labels')!;
  box.innerHTML = '';
  rigs.forEach((rig, i) => {
    const [x, z] = layout(i, rigs.length);
    const p = new THREE.Vector3(x, 0, z + 0.9).project(camera);
    if (p.z > 1) return;
    const d = document.createElement('div');
    d.textContent = rig.id;
    d.style.left = `${(p.x * 0.5 + 0.5) * innerWidth}px`;
    d.style.top = `${(-p.y * 0.5 + 0.5) * innerHeight}px`;
    box.appendChild(d);
  });
}

async function main(): Promise<void> {
  await loadBakedRigs();
  const res = await fetch('/units/index.json');
  const ids: string[] = q.get('units')?.split(',') ?? await res.json();
  rigs = ids.map((id) => getBakedRig(id)).filter((r): r is BakedRig => !!r);
  const n = rigs.length;
  const [x0, z0] = layout(0, n), [x1, z1] = layout(n - 1, n);
  target.set(0, 0.5, (z0 + z1) / 2);
  if (!dist) dist = Math.max(4, Math.abs(x1 - x0) * 1.3 + Math.abs(z1 - z0) * 1.1 + 3);
  const box = document.getElementById('anims')!;
  for (const a of ['idle', 'walk', 'trot', 'canter', 'attack', 'die', 'work']) {
    const b = document.createElement('button');
    b.textContent = a;
    b.className = a === anim ? 'on' : '';
    b.onclick = () => { anim = a; t0 = performance.now(); box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); };
    box.appendChild(b);
  }
  let drag: [number, number] | null = null;
  renderer.domElement.onpointerdown = (e) => { drag = [e.clientX, e.clientY]; };
  onpointerup = () => { drag = null; };
  onpointermove = (e) => {
    if (!drag) return;
    azim -= (e.clientX - drag[0]) * 0.008;
    elev = Math.min(1.4, Math.max(0.05, elev + (e.clientY - drag[1]) * 0.006));
    drag = [e.clientX, e.clientY];
  };
  renderer.domElement.onwheel = (e) => { dist *= e.deltaY > 0 ? 1.1 : 0.9; };
  let t0 = performance.now();
  const loop = () => {
    if (!(window as any).__still) {
      draw((performance.now() - t0) / 1000);
      place();
      renderer.render(scene, camera);
      labels();
    }
    requestAnimationFrame(loop);
  };
  loop();
  (window as any).__shot = (o: { anim?: string; t?: number; azim?: number; elev?: number; dist?: number; target?: number[]; w?: number; h?: number }) => {
    (window as any).__still = true;
    if (o.anim) anim = o.anim;
    if (o.azim !== undefined) azim = o.azim;
    if (o.elev !== undefined) elev = o.elev;
    if (o.dist !== undefined) dist = o.dist;
    if (o.target) target.set(o.target[0], o.target[1], o.target[2]);
    draw(o.t ?? 0);
    place();
    renderer.render(scene, camera);
    labels();
    return renderer.domElement.toDataURL('image/png');
  };
  (window as any).__ready = true;
}
main();
