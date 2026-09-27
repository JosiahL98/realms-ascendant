// Unit viewer: every unit in the game, drawn with the game's own models, materials and animations.
// Built into a single script by tools/viewer/build.mjs and embedded in a review page.
import * as THREE from 'three';
import { UNIT_LIST } from '../../src/data/units';
import { CIVS } from '../../src/data/civs';
import type { UnitDef } from '../../src/data/types';
import { getRig, type Rig } from '../../src/render/models/units';
import { animate, activeVariant, BONE_STRIDE, type AnimState } from '../../src/render/anim';
import { makeWorldMaterial, worldUniforms } from '../../src/render/materials';
import { makeDetailTextures } from '../../src/render/textures';
import { installGrading } from '../../src/render/post';
import type { AnimName, WorkTool } from '../../src/sim/entities';

type Mode = 'one' | 'all';
type Anim = 'idle' | 'walk' | 'attack' | 'work' | 'die';

const TEAMS = [
  { name: 'Blue', hex: 0x2f5fe0 }, { name: 'Red', hex: 0xd42a1e }, { name: 'Green', hex: 0x2fa82f }, { name: 'Yellow', hex: 0xe8d12a },
  { name: 'Teal', hex: 0x22b8c8 }, { name: 'Purple', hex: 0x9a3cd8 }, { name: 'Grey', hex: 0x9a9a9a }, { name: 'Orange', hex: 0xf07c14 },
];
const TOOLS: WorkTool[] = ['axe', 'pick', 'hammer', 'hoe', 'basket', 'spear', 'rod'];
const TOOL_NAMES: Record<string, string> = { axe: 'Chop wood', pick: 'Mine', hammer: 'Build', hoe: 'Farm', basket: 'Forage', spear: 'Hunt', rod: 'Fish' };

// ---------------------------------------------------------------------------------------------- catalogue
const GROUPS: [string, (u: UnitDef) => boolean][] = [
  ['Villagers and civilians', (u) => !!u.gatherer || !!u.trader],
  ['Priests', (u) => !!u.monk],
  ['Infantry', (u) => u.classes.includes('infantry')],
  ['Archers and gunners', (u) => u.classes.includes('archer') && !u.classes.includes('cavalry') && !u.classes.includes('mounted')],
  ['Cavalry', (u) => u.classes.includes('cavalry') || u.classes.includes('mounted')],
  ['Siege', (u) => u.classes.includes('siege')],
  ['Ships', (u) => !!u.naval],
  ['Animals', (u) => !!u.animal],
  ['Other', () => true],
];
const ENTRIES: { def: UnitDef; group: string; n: number }[] = [];
{
  const used = new Set<string>();
  let n = 1;
  for (const [group, test] of GROUPS) {
    for (const def of UNIT_LIST) {
      if (used.has(def.id) || !test(def)) continue;
      used.add(def.id);
      ENTRIES.push({ def, group, n: n++ });
    }
  }
}

// ---------------------------------------------------------------------------------------------- renderer
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $('stage');
const canvas = $<HTMLCanvasElement>('view');
installGrading();
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.CustomToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
worldUniforms.uDetailTex.value = makeDetailTextures(11);
worldUniforms.uDetailGain.value = 1.9;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2b2217);
scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x6a5a3a, 1.35));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

function groundTexture(water: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = water ? '#24506a' : '#7d7a3e';
  g.fillRect(0, 0, 512, 512);
  let seed = water ? 3 : 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * 512, y = rnd() * 512, r = 2 + rnd() * 7, k = rnd();
    g.fillStyle = water ? (k < 0.5 ? 'rgba(40,96,120,0.35)' : 'rgba(20,60,86,0.3)')
      : k < 0.5 ? 'rgba(96,104,48,0.35)' : k < 0.8 ? 'rgba(140,128,70,0.3)' : 'rgba(70,78,36,0.35)';
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = water ? 'rgba(200,230,240,0.08)' : 'rgba(40,36,18,0.2)';
  g.lineWidth = 2;
  for (let i = 0; i <= 512; i += 128) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
const GROUND = 160;
const grassTex = groundTexture(false), waterTex = groundTexture(true);
grassTex.repeat.set(GROUND / 4, GROUND / 4);
waterTex.repeat.set(GROUND / 4, GROUND / 4);
const groundMat = new THREE.MeshLambertMaterial({ map: grassTex });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND, GROUND).rotateX(-Math.PI / 2), groundMat);
ground.receiveShadow = true;
scene.add(ground);

const unitMat = makeWorldMaterial({ fog: 'none', detail: true });

/** One unit on screen: an instanced mesh per rig part (count 1), posed exactly as the game's UnitView does. */
class Figure {
  group = new THREE.Group();
  rig: Rig;
  meshes: THREE.InstancedMesh[];
  pose: Float32Array;
  world: THREE.Matrix4[];
  constructor(public def: UnitDef, public x: number, public z: number) {
    this.rig = getRig(def.model);
    this.meshes = this.rig.parts.map((part) => {
      const m = new THREE.InstancedMesh(part.geo, unitMat, 1);
      m.frustumCulled = false;
      m.castShadow = true;
      if (part.pc) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3).fill(1), 3);
      this.group.add(m);
      return m;
    });
    this.pose = new Float32Array(this.rig.bones.length * BONE_STRIDE);
    this.world = Array.from({ length: this.rig.bones.length + 1 }, () => new THREE.Matrix4());
    scene.add(this.group);
  }
  dispose(): void {
    scene.remove(this.group);
    for (const m of this.meshes) m.dispose();
  }
  update(time: number, anim: Anim, tool: WorkTool, facing: number, team: THREE.Color): void {
    const def = this.def;
    const reload = Math.max(0.8, def.reload || 1);
    const period = anim === 'attack' ? reload : anim === 'die' ? 3.2 : 1;
    const packsUp = !!def.packs;
    const st: AnimState = {
      anim: (anim === 'walk' ? 'walk' : anim) as AnimName,
      t: time % period,
      time,
      speed: def.speed,
      moving: anim === 'walk',
      attackDelay: def.attackDelay ?? (def.range > 0 ? 0.35 : 0.45),
      reload,
      tool: anim === 'work' ? tool : null,
      seed: 0.3,
      packed: packsUp ? anim === 'walk' : false,
    };
    animate(this.rig, st, this.pose);
    const y = def.naval ? -0.02 : 0;
    const q = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, facing);
    this.world[0].compose(new THREE.Vector3(this.x, y, this.z), q, new THREE.Vector3(1, 1, 1));
    const e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(), local = new THREE.Matrix4();
    for (let i = 0; i < this.rig.bones.length; i++) {
      const bone = this.rig.bones[i];
      const o = i * BONE_STRIDE;
      e.set(this.pose[o], this.pose[o + 1], this.pose[o + 2]);
      const sc = this.pose[o + 6];
      local.compose(p.set(bone.pivot[0] + this.pose[o + 3], bone.pivot[1] + this.pose[o + 4], bone.pivot[2] + this.pose[o + 5]),
        q.setFromEuler(e), s.set(sc, sc, sc));
      const parent = bone.parent < 0 ? this.world[0] : this.world[bone.parent + 1];
      this.world[i + 1].multiplyMatrices(parent, local);
    }
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.rig.parts.forEach((part, k) => {
      const show = activeVariant(this.rig, part.variant, st.tool, null, st.packed, false, anim === 'work');
      this.meshes[k].setMatrixAt(0, show ? this.world[part.bone + 1] : zero);
      this.meshes[k].instanceMatrix.needsUpdate = true;
      if (part.pc) {
        this.meshes[k].setColorAt(0, team);
        this.meshes[k].instanceColor!.needsUpdate = true;
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------- state and views
const state = { mode: 'one' as Mode, sel: 0, anim: 'walk' as Anim, tool: 'axe' as WorkTool, team: 0, view: 'game', size: 'close' };
try {
  const saved = JSON.parse(localStorage.getItem('unit-viewer-1') || 'null');
  if (saved) Object.assign(state, saved);
} catch { /* storage unavailable */ }
const save = () => { try { localStorage.setItem('unit-viewer-1', JSON.stringify(state)); } catch { /* ignore */ } };
if (state.sel >= ENTRIES.length) state.sel = 0;

let figures: Figure[] = [];
let rosterWidth = 30, rosterDepth = 20;
const labels: { el: HTMLElement; f: Figure }[] = [];
const labelLayer = $('labels');

function layout(): void {
  for (const f of figures) f.dispose();
  figures = [];
  labelLayer.textContent = '';
  labels.length = 0;
  if (state.mode === 'one') {
    figures.push(new Figure(ENTRIES[state.sel].def, 0, 0));
  } else {
    // one row per group, laid out across the screen as the game camera sees it
    let row = 0;
    rosterWidth = 0;
    for (const [group] of GROUPS) {
      const list = ENTRIES.filter((e) => e.group === group);
      if (!list.length) continue;
      const spacing = group === 'Ships' ? 3.4 : group === 'Siege' ? 2.2 : 1.35;
      rosterWidth = Math.max(rosterWidth, list.length * spacing);
      list.forEach((e, i) => {
        // screen-right is world (+x, -z); rows go down the screen (+x, +z)
        const along = (i - (list.length - 1) / 2) * spacing;
        const down = row;
        const f = new Figure(e.def, along * Math.SQRT1_2 + down * Math.SQRT1_2, -along * Math.SQRT1_2 + down * Math.SQRT1_2);
        figures.push(f);
        const el = document.createElement('div');
        el.className = 'num';
        el.textContent = String(e.n);
        labelLayer.appendChild(el);
        labels.push({ el, f });
      });
      // the row behind archers is cavalry, whose horses stand taller: leave more room
      row += group === 'Ships' ? 5 : ['Siege', 'Cavalry', 'Archers and gunners'].includes(group) ? 4.4 : 3.2;
    }
    const mid = row / 2 - 1;
    center.set(mid * Math.SQRT1_2, 0.4, mid * Math.SQRT1_2);
    rosterDepth = row;
  }
  const water = state.mode === 'one' && !!ENTRIES[state.sel].def.naval;
  groundMat.map = water ? waterTex : grassTex;
  groundMat.needsUpdate = true;
  layoutCamera();
}

const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
const orbit = { yaw: Math.PI / 4, pitch: Math.PI / 6 };
const center = new THREE.Vector3(0, 0.5, 0);
let zoomScale = 1;
function unitHeight(): number {
  const r = getRig(ENTRIES[state.sel].def.model);
  return Math.max(0.9, r.height || 1);
}
function layoutCamera(): void {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  let zoom: number;
  // the whole roster fits the widest row across and all rows down (rows recede at the camera's 30 degrees)
  if (state.mode === 'all') zoom = (state.size === 'game' ? 62 : Math.min(w / (rosterWidth + 2), h / (rosterDepth * 0.5 + 2.5))) * zoomScale;
  else {
    const def = ENTRIES[state.sel].def;
    const extent = def.naval ? 3.2 : unitHeight() * 1.5 + 0.4;
    zoom = state.size === 'game' ? 62 : Math.min(w / (extent * 1.5), h / extent) * zoomScale;
    center.set(0, unitHeight() * 0.45, 0);
  }
  cam.left = -w / 2 / zoom; cam.right = w / 2 / zoom; cam.top = h / 2 / zoom; cam.bottom = -h / 2 / zoom;
  const yaw = state.view === 'game' ? Math.PI / 4 : orbit.yaw, pitch = state.view === 'game' ? Math.PI / 6 : orbit.pitch;
  const d = new THREE.Vector3(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw));
  cam.position.copy(center).addScaledVector(d, 60);
  cam.lookAt(center);
  cam.updateProjectionMatrix();
  const span = state.mode === 'all' ? 40 : 6;
  const sd = new THREE.Vector3(-0.55, 0.78, 0.3).normalize();
  sun.position.copy(center).addScaledVector(sd, 30);
  sun.target.position.copy(center);
  Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 1, far: 80 });
  sun.shadow.camera.updateProjectionMatrix();
}

// drag to turn, wheel or pinch to zoom
const pointers = new Map<number, { x: number; y: number }>();
let pinch0 = 0;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); }
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 1 && Math.abs(dx) + Math.abs(dy) > 0) {
    if (state.view === 'game') { orbit.yaw = Math.PI / 4; orbit.pitch = Math.PI / 6; setState({ view: 'free' }); }
    orbit.yaw -= dx * 0.008;
    orbit.pitch = Math.min(1.45, Math.max(0.03, orbit.pitch + dy * 0.006));
    layoutCamera();
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch0 > 0) { zoomScale = Math.min(6, Math.max(0.25, zoomScale * d / pinch0)); layoutCamera(); }
    pinch0 = d;
  }
});
const release = (e: PointerEvent) => { pointers.delete(e.pointerId); pinch0 = 0; };
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomScale = Math.min(6, Math.max(0.25, zoomScale * Math.exp(-e.deltaY * 0.0012))); layoutCamera(); }, { passive: false });

// ---------------------------------------------------------------------------------------------- side list and controls
const list = $('list');
{
  let current = '';
  for (const e of ENTRIES) {
    if (e.group !== current) {
      current = e.group;
      const h = document.createElement('h3');
      h.textContent = current;
      list.appendChild(h);
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.sel = String(e.n - 1);
    b.innerHTML = `<span class="n">${e.n}</span><span class="nm">${e.def.name}</span>${e.def.civ ? `<span class="civ">${CIVS[e.def.civ]?.name ?? e.def.civ}</span>` : ''}`;
    list.appendChild(b);
  }
}
const teamBox = $('teams');
TEAMS.forEach((t, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.team = String(i);
  b.innerHTML = `<span class="swatch" style="background:#${t.hex.toString(16).padStart(6, '0')}"></span>${t.name}`;
  teamBox.appendChild(b);
});
const toolBox = $('tools');
for (const t of TOOLS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.tool = String(t);
  b.textContent = TOOL_NAMES[t as string];
  toolBox.appendChild(b);
}

function describe(): void {
  const e = ENTRIES[state.sel], d = e.def;
  const info = $('info');
  if (state.mode === 'all') {
    info.innerHTML = `<h2>The whole roster</h2><p>All ${ENTRIES.length} units, one row per group, numbered as in the list. Drag to turn, scroll to zoom. Pick one in the list to look at it on its own.</p>`;
    return;
  }
  const age = ['Dark', 'Feudal', 'Castle', 'Imperial'][d.age] ?? '';
  const stats: [string, string][] = [
    ['Hit points', String(d.hp)], ['Attack', `${d.attack} ${d.attackType}`], ['Armour', `${d.meleeArmor} melee, ${d.pierceArmor} pierce`],
    ['Speed', String(d.speed)], ...(d.range > 0 ? [['Range', String(d.range)] as [string, string]] : []),
  ];
  info.innerHTML = `<h2><span class="n">${e.n}</span> ${d.name}</h2>
    <p class="meta">${e.group}${d.civ ? ` · unique to the ${CIVS[d.civ]?.name ?? d.civ}` : ''}${d.animal ? '' : ` · ${age} Age`}</p>
    <p>${d.description}</p>
    <dl class="stats">${stats.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    ${d.model === 'scout' ? '<p class="note">A new version of this unit is in review: <a href="https://claude.ai/artifact/HKuuTtbaE2VyBEATZ3Fj6L" target="_blank" rel="noopener">The Cavalryman</a>.</p>' : ''}`;
}

function setState(patch: Partial<typeof state>): void {
  const relayout = patch.mode !== undefined && patch.mode !== state.mode || patch.sel !== undefined && patch.sel !== state.sel;
  Object.assign(state, patch);
  save();
  if (relayout) { zoomScale = 1; layout(); }
  sync();
}
function sync(): void {
  const pressed = (attr: string, val: unknown) => document.querySelectorAll<HTMLElement>(`[data-${attr}]`)
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === String(val))));
  pressed('mode', state.mode);
  pressed('anim', state.anim);
  pressed('tool', state.tool);
  pressed('team', state.team);
  pressed('view', state.view);
  pressed('size', state.size);
  document.querySelectorAll<HTMLElement>('[data-sel]').forEach((b) => {
    b.setAttribute('aria-current', String(state.mode === 'one' && Number(b.dataset.sel) === state.sel));
  });
  const def = ENTRIES[state.sel].def;
  $('tool-group').hidden = !(state.anim === 'work' && (state.mode === 'all' || def.gatherer));
  describe();
  layoutCamera();
}
document.addEventListener('click', (ev) => {
  const b = (ev.target as HTMLElement).closest('button');
  if (!b) return;
  const d = b.dataset;
  if (d.sel !== undefined) setState({ mode: 'one', sel: Number(d.sel) });
  else if (d.mode) setState({ mode: d.mode as Mode });
  else if (d.anim) setState({ anim: d.anim as Anim });
  else if (d.tool) setState({ tool: d.tool as WorkTool });
  else if (d.team) setState({ team: Number(d.team) });
  else if (d.view) { orbit.yaw = Math.PI / 4; orbit.pitch = Math.PI / 6; setState({ view: d.view }); }
  else if (d.size) { zoomScale = 1; setState({ size: d.size }); }
});
document.addEventListener('keydown', (ev) => {
  if (state.mode !== 'one' || (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp')) return;
  ev.preventDefault();
  setState({ sel: (state.sel + (ev.key === 'ArrowDown' ? 1 : ENTRIES.length - 1)) % ENTRIES.length });
});
new ResizeObserver(layoutCamera).observe(stage);

// ---------------------------------------------------------------------------------------------- loop
const dye = (hex: number) => { const c = new THREE.Color(hex), hsl = { h: 0, s: 0, l: 0 }; c.getHSL(hsl); return c.setHSL(hsl.h, hsl.s * 0.82, hsl.l * 0.9); };
const tmp = new THREE.Vector3();
const start = performance.now();
function frame(now: number): void {
  const time = (now - start) / 1000;
  const team = dye(TEAMS[state.team].hex);
  const facing = state.mode === 'one' && state.view !== 'game' ? 0 : Math.PI * 0.25;
  for (const f of figures) {
    // animals and ships have no work animation; fall back to walking
    const anim = state.anim === 'work' && !f.def.gatherer ? 'idle' : state.anim;
    f.update(time, anim, state.tool, facing - Math.PI / 2 + (state.mode === 'one' ? 0.35 : 0), team);
  }
  renderer.render(scene, cam);
  for (const { el, f } of labels) {
    tmp.set(f.x, -0.05, f.z).project(cam);
    el.style.left = ((tmp.x + 1) / 2) * stage.clientWidth + 'px';
    el.style.top = ((1 - tmp.y) / 2) * stage.clientHeight + 'px';
  }
  requestAnimationFrame(frame);
}
layout();
sync();
requestAnimationFrame(frame);
(window as unknown as { __ready: boolean }).__ready = true;
