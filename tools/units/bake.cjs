// Bakes the new unit models for the game: vertex colours, merged parts, skinning data and animation clips sampled
// from the same pose code the review pages used (villager poses, horse gaits, rider thrust).
//   node tools/units/bake.cjs <export-dir> <out-dir>
// <export-dir> holds the Blender exports (villager_m.json, villager_f.json, horse_light.json, rider_light.json);
// <out-dir> receives villager.json, villagerF.json and scout.json.
process.removeAllListeners('warning');
const THREE = require('three');
const fs = require('fs');
const path = require('path');
const { makeHumanPose } = require('../review/human-pose.cjs');
const { GAITS, makeHorseGait } = require('../review/horse-gait.cjs');
const { makeRiderPose } = require('../review/rider-pose.cjs');

const [inDir, outDir, only] = process.argv.slice(2);
const { dieOptions } = require('../review/lowest.cjs');
const load = (f) => JSON.parse(fs.readFileSync(path.join(inDir, f), 'utf8'));
fs.mkdirSync(outDir, { recursive: true });

const lin = (hex) => new THREE.Color(hex);
const shade = (ao) => 0.26 + 0.74 * Math.pow(ao, 1.2);
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const r3 = (x) => Math.round(x * 1e3) / 1e3;

// ------------------------------------------------------------------------------------------------ palettes
// (as on the approved review pages; 'team' parts are left white and tinted by the player colour in the game)
const VILLAGER_KIT = {
  skin: 0xe0b48c, team2: 0xe2dac8, leather: 0x7a5230, wrap: 0x9a8466, shoe: 0x4a3020, wood: 0x6a4a2a, iron: 0xa8acb4,
  cord: 0xd8ccb0, wicker: 0xb08a4e, woodend: 0xc49a62, meat: 0xa8322a, sack: 0x9a7a52, gold: 0xf0c030, stone: 0xa4a098,
};
const VILLAGER_HAIR = 0x3a2616, VILLAGER_BEARD = 0x33200f;
const RIDER_KIT = {
  skin: 0xe0b48c, hair: 0x3a2616, eye: 0x140e0a, leather: 0x7a5230, darkleather: 0x3e2a1a, trousers: 0x6a5236,
  wood: 0x6a4a2a, iron: 0xa8acb4, bronze: 0xb88a3a, trim: 0xd8c89a,
};
const BAY = { coat: 0x8a5a32, points: 0x1c1612, hair: 0x19130f };
const HOOF = 0x2e2a26, HORN = 0x2a2420, NOSTRIL = 0x140f0c, EYE = 0x0c0907;

function mix(c, hex, w) {
  const b = lin(hex);
  c.r += (b.r - c.r) * w; c.g += (b.g - c.g) * w; c.b += (b.b - c.b) * w;
}

/** Linear vertex colour of part p's vertex i (white for player-colour parts). */
function villagerColor(p, i) {
  if (p.mat === 'team') return new THREE.Color(1, 1, 1);
  const c = lin(VILLAGER_KIT[p.mat] ?? VILLAGER_KIT.leather);
  const m = p.masks || {};
  if (m.hair) mix(c, VILLAGER_HAIR, m.hair[i]);
  if (m.beard) mix(c, VILLAGER_BEARD, m.beard[i]);
  return c;
}
function scoutColor(p, i) {
  const m = p.masks || {};
  if (p.mat === 'team') return new THREE.Color(1, 1, 1);
  const horsePart = p.mat === 'coat' || ((p.mat === 'hair' || p.mat === 'eye') && !p.bone.startsWith('r'));
  if (horsePart) {
    const c = lin(p.mat === 'hair' ? BAY.hair : p.mat === 'eye' ? EYE : BAY.coat);
    if (p.mat === 'coat') {
      if (m.points) mix(c, BAY.points, m.points[i]);
      if (m.hoof) mix(c, HOOF, m.hoof[i]);
      if (m.horn) mix(c, HORN, m.horn[i] * 0.9);
      if (m.nostril) mix(c, NOSTRIL, m.nostril[i] * 0.85);
    }
    return c;
  }
  const c = lin(RIDER_KIT[p.mat] ?? RIDER_KIT.leather);
  if (m.hair) mix(c, RIDER_KIT.hair, m.hair[i]);
  return c;
}

// ------------------------------------------------------------------------------------------------ parts
/**
 * Baked occlusion, softened across each part: a few passes of averaging with neighbouring vertices, so contact
 * shadows (under a sleeve's hem, at a wrist) fade out instead of streaking along coarse triangles.
 */
function softAO(p, passes = 3) {
  const n = p.ao.length;
  const nb = Array.from({ length: n }, () => new Set());
  for (let i = 0; i < p.idx.length; i += 3) {
    const a = p.idx[i], b = p.idx[i + 1], c = p.idx[i + 2];
    nb[a].add(b); nb[a].add(c); nb[b].add(a); nb[b].add(c); nb[c].add(a); nb[c].add(b);
  }
  let ao = Float32Array.from(p.ao);
  for (let k = 0; k < passes; k++) {
    const next = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = ao[i] * 2, w = 2;
      for (const j of nb[i]) { sum += ao[j]; w++; }
      next[i] = sum / w;
    }
    ao = next;
  }
  return ao;
}

const BEND = ['neck', 'legFL', 'legFR', 'legBL', 'legBR'];

/**
 * Merges exported parts that share a bone, player-colour flag, variant and kind of skinning. Skinning is either
 * 'lbs' (up to two extra bones blended in, e.g. the skirt's thigh bones or the fishing line's float) or 'bend' (the
 * horse's neck and upper legs turning about their joints by weight).
 */
function mergeParts(model, colorOf) {
  const boneIndex = Object.fromEntries(model.bones.map((b, i) => [b.name, i]));
  const groups = new Map();
  for (const p of model.parts) {
    const m = p.masks || {};
    const bend = BEND.some((k) => m[k]);
    const lbsBones = Object.keys(m).filter((k) => boneIndex[k] !== undefined && !BEND.includes(k));
    const skin = bend ? 'bend' : lbsBones.length ? 'lbs:' + lbsBones.join(',') : '';
    const pc = p.mat === 'team';
    const key = [p.bone, pc ? 1 : 0, p.variant || '', skin].join('|');
    if (!groups.has(key)) groups.set(key, { bone: boneIndex[p.bone], pc, variant: p.variant || '', skin, lbsBones, src: [] });
    groups.get(key).src.push(p);
  }
  const out = [];
  for (const g of groups.values()) {
    const pos = [], nrm = [], col = [], idx = [], w = [], si = [];
    for (const p of g.src) {
      const base = pos.length / 3;
      const m = p.masks || {};
      const ao = softAO(p);
      for (let i = 0; i < p.ao.length; i++) {
        pos.push(r4(p.pos[i * 3]), r4(p.pos[i * 3 + 1]), r4(p.pos[i * 3 + 2]));
        nrm.push(r3(p.nrm[i * 3]), r3(p.nrm[i * 3 + 1]), r3(p.nrm[i * 3 + 2]));
        const c = colorOf(p, i).multiplyScalar(shade(ao[i]));
        col.push(r3(c.r), r3(c.g), r3(c.b));
        if (g.skin === 'bend') {
          let best = 0, bi = 0;
          BEND.forEach((k, j) => { const v = m[k] ? m[k][i] : 0; if (v > best) { best = v; bi = j; } });
          w.push(r3(best));
          si.push(bi);
        } else if (g.skin) {
          w.push(r3(m[g.lbsBones[0]] ? m[g.lbsBones[0]][i] : 0), r3(g.lbsBones[1] && m[g.lbsBones[1]] ? m[g.lbsBones[1]][i] : 0));
        }
      }
      for (const k of p.idx) idx.push(base + k);
    }
    const part = { bone: g.bone, pc: g.pc, variant: g.variant, pos, nrm, col, idx };
    if (g.skin === 'bend') Object.assign(part, { skin: 'bend', w, si });
    else if (g.skin) Object.assign(part, { skin: 'lbs', skinBones: g.lbsBones.map((n) => boneIndex[n]), w });
    out.push(part);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ clips
/**
 * Samples a pose function into a clip over `bones` (names): per frame, each bone's local rotation and offset.
 * Channels that never change are stored once; the rest as int16 (rotation / 32767, offset / 4096 m).
 */
function bakeClip(allBones, bones, poseAt, dur, fps, loop) {
  const n = loop ? Math.max(2, Math.round(dur * fps)) : Math.max(2, Math.round(dur * fps) + 1);
  const frames = [];
  for (let f = 0; f < n; f++) frames.push(poseAt(loop ? (f / n) * dur : Math.min(dur, f / fps)));
  const idxOf = Object.fromEntries(allBones.map((b, i) => [b.name, i]));
  const statics = [], anim = [], data = [];
  const val = (pose, b) => {
    const e = pose[b];
    const q = e && e.q ? e.q : [0, 0, 0, 1];
    const p = e && e.p ? e.p : [0, 0, 0];
    return [...q, ...p];
  };
  const animBones = [];
  for (const b of bones) {
    const v0 = val(frames[0], b);
    const moves = frames.some((fr) => val(fr, b).some((x, k) => Math.abs(x - v0[k]) > 2e-4));
    if (moves) animBones.push(b);
    else if (v0.some((x, k) => Math.abs(x - (k === 3 ? 1 : 0)) > 1e-5)) statics.push([idxOf[b], ...v0.map((x) => Math.round(x * 1e5) / 1e5)]);
  }
  for (const fr of frames) {
    for (const b of animBones) {
      const v = val(fr, b);
      // keep quaternions in one hemisphere across frames so blending between them takes the short way
      for (let k = 0; k < 4; k++) data.push(Math.round(v[k] * 32767));
      for (let k = 4; k < 7; k++) data.push(Math.max(-32767, Math.min(32767, Math.round(v[k] * 4096))));
    }
  }
  for (const b of animBones) anim.push(idxOf[b]);
  // hemisphere fix: flip a frame's quaternion when it points away from the previous one
  const stride = animBones.length * 7;
  for (let f = 1; f < n; f++) {
    for (let j = 0; j < animBones.length; j++) {
      const a = (f - 1) * stride + j * 7, c = f * stride + j * 7;
      const dot = data[a] * data[c] + data[a + 1] * data[c + 1] + data[a + 2] * data[c + 2] + data[a + 3] * data[c + 3];
      if (dot < 0) for (let k = 0; k < 4; k++) data[c + k] = -data[c + k];
    }
  }
  return { dur, fps: n / dur, frames: n, loop, statics, bones: anim, data: Buffer.from(new Int16Array(data).buffer).toString('base64') };
}

/** A looping clip from a function that is not periodic: the last second blends back into the first. */
const seamless = (fn, dur) => (t) => {
  const w = Math.max(0, Math.min(1, t - (dur - 1)));
  if (w <= 0) return fn(t);
  const a = fn(t), b = fn(t - dur);
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k.startsWith('_')) continue;
    const qa = new THREE.Quaternion().fromArray(a[k]?.q || [0, 0, 0, 1]), qb = new THREE.Quaternion().fromArray(b[k]?.q || [0, 0, 0, 1]);
    const pa = a[k]?.p || [0, 0, 0], pb = b[k]?.p || [0, 0, 0];
    out[k] = { q: qa.slerp(qb, w).toArray(), p: pa.map((x, i) => x + (pb[i] - x) * w) };
  }
  return out;
};

// ------------------------------------------------------------------------------------------------ villagers
function hemOf(model) {
  const sk = model.parts.find((p) => p.name === 'skirt');
  const piv = model.bones.find((b) => b.name === sk.bone).pivot;
  let y = Infinity, r = 0;
  for (let i = 0; i < sk.pos.length; i += 3) y = Math.min(y, sk.pos[i + 1] + piv[1]);
  for (let i = 0; i < sk.pos.length; i += 3) if (sk.pos[i + 1] + piv[1] < y + 0.01) r = Math.max(r, Math.hypot(sk.pos[i] + piv[0], sk.pos[i + 2] + piv[2]));
  return { y, r };
}

function bakeVillager(file, id) {
  const model = load(file);
  const P = makeHumanPose(THREE, model.bones, { hem: hemOf(model) });
  const names = model.bones.map((b) => b.name);
  const clips = {};
  const walkT = 1 / P.WALK.freq;
  const tools = ['axe', 'pick', 'hammer', 'hoe', 'basket', 'spear', 'rod'];
  clips.idle = bakeClip(model.bones, names, seamless((t) => P.pose('idle', t), 12), 12, 8, true);
  clips.walk = bakeClip(model.bones, names, (t) => P.pose('walk', t), walkT, 30, true);
  clips.carryIdle = bakeClip(model.bones, names, seamless((t) => P.pose('idle', t, true), 12), 12, 8, true);
  clips.carryWalk = bakeClip(model.bones, names, (t) => P.pose('walk', t, true), walkT, 30, true);
  for (const tool of tools) {
    clips['idle:' + tool] = bakeClip(model.bones, names, seamless((t) => P.pose('idle', t, false, tool), 12), 12, 4, true);
    clips['walk:' + tool] = bakeClip(model.bones, names, (t) => P.pose('walk', t, false, tool), walkT, 30, true);
    const w = P.WORK[tool];
    clips['work:' + tool] = bakeClip(model.bones, names, (t) => P.pose('work', t, false, tool), w.period, tool === 'rod' ? 12 : 30, true);
  }
  for (const tool of ['none', ...tools]) {
    const tl = tool === 'none' ? null : tool;
    clips['attack:' + tool] = bakeClip(model.bones, names, (t) => P.pose('attack', t, false, tl), P.ATTACK, 30, false);
  }
  clips.die = bakeClip(model.bones, names, (t) => P.pose('die', t, false, null), P.DIE.len, 30, false);
  const meta = { kind: 'villager', walkSpeed: P.WALK.speed, attackHit: P.ATTACK * 0.5 };
  return { id, height: 0.95, bones: model.bones.map((b) => ({ name: b.name, parent: b.parent ? names.indexOf(b.parent) : -1, pivot: b.pivot })),
    parts: mergeParts(model, villagerColor), clips, meta };
}

// ------------------------------------------------------------------------------------------------ scout (horse + rider)
function bakeScout() {
  const horse = load('horse_light.json');
  const rider = load('rider_light.json');
  // one skeleton: the horse's bones, then the rider's (which hang off the horse's body)
  const bones = [...horse.bones];
  for (const b of rider.bones) if (!bones.some((o) => o.name === b.name)) bones.push(b);
  const model = { bones, parts: [...horse.parts, ...rider.parts] };
  const names = bones.map((b) => b.name);
  const horseBones = horse.bones.map((b) => b.name);
  const riderBones = rider.bones.map((b) => b.name).filter((n) => !horseBones.includes(n));
  const gait = makeHorseGait(horse.bones);
  const rp = makeRiderPose(THREE, rider.bones);
  const euler = (e) => ({ q: new THREE.Quaternion().setFromEuler(new THREE.Euler(e.rx || 0, 0, e.rz || 0)).toArray(), p: [0, e.py || 0, 0] });
  const horsePose = (raw) => Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, euler(v)]));
  const clips = {};
  clips['horse:stand'] = bakeClip(bones, horseBones, (t) => horsePose(gait.stand(t)), 4 * Math.PI, 8, true);
  for (const g of ['walk', 'trot', 'canter']) {
    const G = GAITS[g];
    clips['horse:' + g] = bakeClip(bones, horseBones, (t) => horsePose(gait.pose(G, t)), 1 / G.freq, 30, true);
    clips['rider:hold:' + g] = bakeClip(bones, riderBones, (t) => rp.pose('hold', t, G), 1 / G.freq, 30, true);
  }
  clips['rider:hold'] = bakeClip(bones, riderBones, seamless((t) => rp.pose('hold', t, null), 14), 14, 6, true);
  clips['rider:attack'] = bakeClip(bones, riderBones, (t) => rp.pose('attack', t, null), rp.ATTACK_PERIOD, 30, false);
  clips.die = bakeClip(bones, names, scoutDeath(model, gait, rp, horseBones), 1.6, 30, false);
  const meta = {
    kind: 'scout',
    gaits: Object.fromEntries(['walk', 'trot', 'canter'].map((g) => [g, { speed: GAITS[g].speed }])),
    // the thrust lands at half-way through the rider's attack
    attackHit: rp.ATTACK_PERIOD * 0.5,
    bend: BEND,
  };
  return { id: 'scout', height: 1.7, bones: bones.map((b) => ({ name: b.name, parent: b.parent ? names.indexOf(b.parent) : -1, pivot: b.pivot })),
    parts: mergeParts(model, scoutColor), clips, meta };
}

/**
 * The scout's death: the horse stumbles, its forelegs buckling, then rolls onto its right side and comes to rest on
 * the ground; the rider goes down with it. The resting height is measured on the model so nothing sinks.
 */
function scoutDeath(model, gait, rp, horseBones) {
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const qx = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
  const qz = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
  const ROLL = Math.PI / 2 * 0.96;
  const pivot = new THREE.Vector3(-0.12, 0, 0);   // the right hooves: the horse rolls over them
  const at = (t, lift) => {
    const u = t / 1.6;
    const stumble = ss(0, 0.3, u);
    const fall = Math.min(1, Math.max(0, (u - 0.15) / 0.55)) ** 2;
    const base = Object.fromEntries(Object.entries(gait.stand(0)).map(([k, v]) => [k, {
      q: new THREE.Quaternion().setFromEuler(new THREE.Euler(v.rx || 0, 0, v.rz || 0)).toArray(), p: [0, 0, 0],
    }]));
    const R = qz(ROLL * fall).multiply(qx(0.08 * stumble * (1 - fall)));
    const p = pivot.clone().sub(pivot.clone().applyQuaternion(R)).add(new THREE.Vector3(0, lift * fall - 0.04 * stumble * (1 - fall), 0));
    base.root = { q: R.toArray(), p: p.toArray() };
    for (const k of ['FL', 'FR']) base['leg' + k + '2'] = { q: qx(0.55 * stumble * (1 - 0.6 * fall)).toArray(), p: [0, 0, 0] };
    base.neck = { q: qx(0.35 * stumble - 0.25 * fall).toArray(), p: [0, 0, 0] };
    const riderPose = rp.pose('hold', 0, null);
    for (const [k, v] of Object.entries(riderPose)) if (!k.startsWith('_')) base[k] = v;
    base.rtorso = { q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35 * stumble - 0.2 * fall, 0, 0.3 * fall)).toArray(), p: [0, 0, 0] };
    return base;
  };
  // how high the lying horse must rest so its lowest point is on the ground
  const low = lowestPoint(model, at(1.6, 0), horseBones);
  const lift = -low + 0.004;
  return (t) => at(t, lift);
}

/** Lowest world y of the named bones' parts under a pose (rigid, rest shape; enough for the resting height). */
function lowestPoint(model, pose, onlyBones) {
  const root = new THREE.Group(), G = {};
  const piv = Object.fromEntries(model.bones.map((b) => [b.name, new THREE.Vector3(...b.pivot)]));
  for (const b of model.bones) {
    const g = new THREE.Group();
    g.position.copy(piv[b.name]).sub(b.parent ? piv[b.parent] : new THREE.Vector3());
    const e = pose[b.name];
    if (e && e.q) g.quaternion.fromArray(e.q);
    if (e && e.p) g.position.add(new THREE.Vector3(...e.p));
    G[b.name] = g;
    (b.parent ? G[b.parent] : root).add(g);
  }
  root.updateMatrixWorld(true);
  let low = Infinity;
  const v = new THREE.Vector3();
  for (const p of model.parts) {
    if (!onlyBones.includes(p.bone)) continue;
    for (let i = 0; i < p.pos.length; i += 3) low = Math.min(low, v.set(p.pos[i], p.pos[i + 1], p.pos[i + 2]).applyMatrix4(G[p.bone].matrixWorld).y);
  }
  return low;
}

// ------------------------------------------------------------------------------------------------ soldiers
const SKINS = [0xe0b48c, 0xc89066, 0xa8704a, 0x7a4a2e, 0x5a3420];
const SOLDIER_KIT = {
  skin: SKINS[0], hair: 0x3a2616, beard: 0x33200f, legs: 0x6a5236, linen: 0xe2dac8, leather: 0x7a5230, darkleather: 0x3e2a1a,
  wrap: 0x9a8466, shoe: 0x4a3020, steel: 0xb8bcc4, mail: 0x8a8e94, bronze: 0xc0923a, gold: 0xd4a93a, lacquer: 0x6a2a20,
  fur: 0x6a6a66, feather: 0xf0f0e0, turban: 0xe8e0d0, hood: 0x5a6a3a, hat: 0x3a2a1a, wood: 0x6a4a2a, cord: 0xd8ccb0,
  darksteel: 0x4a4a4a,
};
/** Per-unit colours and build, as in the game's procedural models (units.ts). */
const SOLDIER_LOOK = {
  skirmisher: { hair: 0x6a4a2a },
  legionary: { legs: 0xb03020 }, eliteLegionary: { legs: 0xb03020 },
  gaesatae: { hair: 0xc89040, legs: 0x3a6a3a, scale: 1.08 }, eliteGaesatae: { hair: 0xd8a850, legs: 0x3a6a3a, scale: 1.12 },
  berserker: { hair: 0x8a5a2a, legs: 0x5a4a3a, scale: 1.1 }, eliteBerserker: { hair: 0x8a5a2a, legs: 0x5a4a3a, scale: 1.15 },
  bowman: { skin: SKINS[4], legs: 0xe8e0d0 }, eliteBowman: { skin: SKINS[4], legs: 0xe8e0d0 },
  fireLancer: { skin: SKINS[1], helm: 0x5a2a20 }, eliteFireLancer: { skin: SKINS[1], helm: 0xd4a93a },
  monk: { skin: SKINS[1] },
};

function soldierColor(look) {
  const pal = { ...SOLDIER_KIT, ...look };
  return (p, i) => {
    if (p.mat === 'team') return new THREE.Color(1, 1, 1);
    let hex = pal[p.mat] ?? pal.leather;
    if (look.helm && p.name === 'helmet' && (p.mat === 'steel' || p.mat === 'gold')) hex = look.helm;
    const c = lin(hex);
    const m = p.masks || {};
    if (m.hair) mix(c, pal.hair, m.hair[i]);
    if (m.beard) mix(c, pal.beard ?? pal.hair, m.beard[i]);
    return c;
  };
}

function bakeSoldier(id) {
  const model = load('kit_' + id + '.json');
  const k = model.kit;
  const skirt = model.parts.some((p) => p.name === 'skirt');
  const base = { hem: skirt ? hemOf(model) : undefined, weapon: k.weapon, shield: k.shield.length > 0 };
  const P = makeHumanPose(THREE, model.bones, dieOptions(model, makeHumanPose, base));
  const names = model.bones.map((b) => b.name);
  const walkT = 1 / P.WALK.freq;
  const clips = {};
  clips.idle = bakeClip(model.bones, names, seamless((t) => P.pose('idle', t), 8), 8, 6, true);
  clips.walk = bakeClip(model.bones, names, (t) => P.pose('walk', t), walkT, 30, true);
  clips.die = bakeClip(model.bones, names, (t) => P.pose('die', t), P.DIE.len, 30, false);
  if (k.weapon === 'staff') {
    clips.work = bakeClip(model.bones, names, (t) => P.pose('work', t), 2.4, 15, true);
    clips.carryIdle = bakeClip(model.bones, names, seamless((t) => P.pose('idle', t, true), 8), 8, 6, true);
    clips.carryWalk = bakeClip(model.bones, names, (t) => P.pose('walk', t, true), walkT, 30, true);
  } else {
    clips.attack = bakeClip(model.bones, names, (t) => P.pose('attack', t), P.ATTACK, 30, false);
  }
  const look = SOLDIER_LOOK[id] || {};
  const meta = { kind: 'soldier', walkSpeed: P.WALK.speed, attackHit: P.ATTACK * 0.5, scale: look.scale || 1 };
  return { id, height: 1.0, bones: model.bones.map((b) => ({ name: b.name, parent: b.parent ? names.indexOf(b.parent) : -1, pivot: b.pivot })),
    parts: mergeParts(model, soldierColor(look)), clips, meta };
}

// ------------------------------------------------------------------------------------------------ compact encoding
/** Geometry as base64 typed arrays: positions int16 (1/8192 m), normals int8, colours and weights uint8, indices uint16. */
function pack(part) {
  const b64 = (arr) => Buffer.from(arr.buffer).toString('base64');
  const out = { ...part };
  out.pos = b64(Int16Array.from(part.pos, (x) => Math.round(x * 8192)));
  out.nrm = b64(Int8Array.from(part.nrm, (x) => Math.round(x * 127)));
  out.col = b64(Uint8Array.from(part.col, (x) => Math.max(0, Math.min(255, Math.round(x * 255)))));
  out.idx = b64(Uint16Array.from(part.idx));
  if (part.w) out.w = b64(Uint8Array.from(part.w, (x) => Math.round(x * 255)));
  if (part.si) out.si = b64(Uint8Array.from(part.si));
  out.n = part.idx.length;
  return out;
}

// ------------------------------------------------------------------------------------------------ write
const jobs = [
  ['villager', () => bakeVillager('villager_m.json', 'villager')],
  ['villagerF', () => bakeVillager('villager_f.json', 'villagerF')],
  ['scout', () => bakeScout()],
];
for (const f of fs.readdirSync(inDir)) {
  const m = f.match(/^kit_(\w+)\.json$/);
  if (m) jobs.push([m[1], () => bakeSoldier(m[1])]);
}
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(jobs.map(([id]) => id)));
for (const [id, make] of jobs) {
  if (only && !only.split(',').includes(id)) continue;
  const file = id + '.json';
  const data = make();
  const tris = data.parts.reduce((a, p) => a + p.idx.length / 3, 0);
  data.enc = 1;
  data.parts = data.parts.map(pack);
  const text = JSON.stringify(data);
  fs.writeFileSync(path.join(outDir, file), text);
  const frames = Object.values(data.clips).reduce((a, c) => a + c.frames, 0);
  console.log(`${file}: ${(text.length / 1024).toFixed(0)} KB, ${data.parts.length} meshes, ${tris} triangles, ${Object.keys(data.clips).length} clips (${frames} frames)`);
}
