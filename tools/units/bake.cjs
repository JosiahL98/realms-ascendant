// Bakes the new unit models for the game: vertex colours, merged parts, skinning data and animation clips sampled
// from the same pose code the review pages used (villager poses, horse gaits, rider thrust).
//   node tools/units/bake.cjs <export-dir> <out-dir>
// <export-dir> holds the Blender exports (villager_m.json, villager_f.json, horse_light.json, kit_<unit>.json for foot
// soldiers, cav_<unit>.json for horsemen); <out-dir> receives <unit>.json for each and index.json.
process.removeAllListeners('warning');
const THREE = require('three');
const fs = require('fs');
const path = require('path');
const { makeHumanPose } = require('../review/human-pose.cjs');
const { GAITS, makeHorseGait } = require('../review/horse-gait.cjs');
const { makeRiderPose } = require('../review/rider-pose.cjs');
const { makeAnimalPose } = require('../review/animal-pose.cjs');
const SIEGE = require('../review/siege-pose.cjs');

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
/** Horse coats: body, points (lower legs, muzzle, ears), mane and tail, and white markings shown (blaze, socks). */
const COATS = {
  bay: BAY,
  darkBay: { coat: 0x4e3020, points: 0x16110e, hair: 0x120e0b },
  black: { coat: 0x2a2320, points: 0x1c1816, hair: 0x141110 },
  grey: { coat: 0xc4c0b8, points: 0x6a6660, hair: 0xd4d0c8, dapple: 0x9a968e },
  chestnut: { coat: 0xa0582a, points: 0x8a4a22, hair: 0x7a3e1c, white: 0xece6da },
  mule: { coat: 0x5e4c3c, points: 0x2e241c, hair: 0x241c16 },
  camel: { coat: 0xc09a62, points: 0x9a7446, hair: 0x8a6a40, belly: 0xd8bc8e, hoof: 0x3a3026 },
  elephant: { coat: 0x86817c, points: 0x625e5a, hair: 0x4a4644, hoof: 0xd8d0c0, inner: 0x9a7a74, horn: 0xf0e8d6 },
};
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
/** Colours of a horseman: the horse in its coat, the rider and tack in the kit palette (see riderLook). */
function riderColor(coat = BAY, look = {}) {
  const pal = { ...SOLDIER_KIT, ...RIDER_KIT, ...look };
  return (p, i) => {
    const m = p.masks || {};
    if (p.mat === 'team') return new THREE.Color(1, 1, 1);
    const horsePart = p.mat === 'coat' || (['hair', 'eye', 'horn'].includes(p.mat) && !p.bone.startsWith('r'));
    if (horsePart) {
      if (p.mat === 'horn') return lin(coat.horn ?? 0xf0e8d6);
      const c = lin(p.mat === 'hair' ? coat.hair : p.mat === 'eye' ? EYE : coat.coat);
      if (p.mat === 'coat') {
        if (m.dapple && coat.dapple) mix(c, coat.dapple, m.dapple[i] * 0.6);
        if (m.belly && coat.belly) mix(c, coat.belly, m.belly[i]);
        if (m.inner && coat.inner) mix(c, coat.inner, m.inner[i] * 0.5);
        if (m.points) mix(c, coat.points, m.points[i]);
        if (coat.white) {
          if (m.blaze) mix(c, coat.white, m.blaze[i]);
          if (m.sock) mix(c, coat.white, m.sock[i]);
        }
        if (m.hoof) mix(c, coat.hoof ?? HOOF, m.hoof[i]);
        if (m.horn) mix(c, HORN, m.horn[i] * 0.9);
        if (m.nostril) mix(c, NOSTRIL, m.nostril[i] * 0.85);
      }
      return c;
    }
    let hex = pal[p.mat] ?? pal.leather;
    if (look.helm && p.name === 'helmet') hex = look.helm;
    const c = lin(hex);
    if (m.hair) mix(c, pal.hair, m.hair[i]);
    return c;
  };
}
/** Per-unit colours of the horsemen (as the game's procedural models had them). */
const RIDER_LOOK = {
  horseArcher: { skin: 0xc89066, helm: 0xa83a24 }, eliteHorseArcher: { skin: 0xc89066, helm: 0xd4a93a },
  paladin: { helm: 0xd4a93a },
  camel: { skin: 0xa8704a }, heavyCamel: { skin: 0xa8704a },
  warElephant: { skin: 0x7a4a2e }, eliteWarElephant: { skin: 0x7a4a2e },
};

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

// ------------------------------------------------------------------------------------------------ horsemen (horse + rider)
function bakeRider(file, id) {
  const rider = load(file);
  const kit = rider.kit || { name: id, weapon: 'spear', coat: 'bay' };
  const mount = kit.mount || 'horse';
  const horse = load(mount === 'horse' ? 'horse_light.json' : `mount_${mount}_light.json`);
  // one skeleton: the horse's bones, then the rider's (which hang off the horse's body)
  const bones = [...horse.bones];
  for (const b of rider.bones) if (!bones.some((o) => o.name === b.name)) bones.push(b);
  const model = { bones, parts: [...horse.parts, ...rider.parts] };
  const names = bones.map((b) => b.name);
  const horseBones = horse.bones.map((b) => b.name);
  const riderBones = rider.bones.map((b) => b.name).filter((n) => !horseBones.includes(n));
  // a horse's own gaits (horse-gait.cjs), or a camel's or elephant's (animal-pose.cjs)
  const AP = mount === 'horse' ? null : makeAnimalPose(horse.bones, mount);
  const gait = AP ? { ...AP.gait, stand: AP.stand } : makeHorseGait(horse.bones);
  const gaits = AP ? AP.gaits : GAITS;
  const rp = makeRiderPose(THREE, rider.bones, {}, rider.kit || null);
  const euler = (e) => ({ q: new THREE.Quaternion().setFromEuler(new THREE.Euler(e.rx || 0, e.ry || 0, e.rz || 0)).toArray(), p: [0, e.py || 0, e.pz || 0] });
  const horsePose = (raw) => Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, euler(v)]));
  const clips = {};
  clips['horse:stand'] = AP ? bakeClip(bones, horseBones, seamless((t) => horsePose(AP.stand(t)), 14), 14, 8, true)
    : bakeClip(bones, horseBones, (t) => horsePose(gait.stand(t)), 4 * Math.PI, 8, true);
  for (const [g, G] of Object.entries(gaits)) {
    clips['horse:' + g] = bakeClip(bones, horseBones, (t) => horsePose(gait.pose(G, t)), 1 / G.freq, 30, true);
    clips['rider:hold:' + g] = bakeClip(bones, riderBones, (t) => rp.pose('hold', t, G), 1 / G.freq, 30, true);
  }
  // the elephant fights too: it gores and stamps while its driver thrusts
  if (mount === 'elephant') {
    const names0 = Object.keys(AP.attack(0.5));
    clips['mount:attack'] = bakeClip(bones, names0, (t) => horsePose(AP.attack(t * AP.ATTACK / rp.ATTACK_PERIOD)), rp.ATTACK_PERIOD, 30, false);
  }
  clips['rider:hold'] = bakeClip(bones, riderBones, seamless((t) => rp.pose('hold', t, null), 14), 14, 6, true);
  clips['rider:attack'] = bakeClip(bones, riderBones, (t) => rp.pose('attack', t, null), rp.ATTACK_PERIOD, 30, false);
  clips.die = bakeClip(bones, names, scoutDeath(model, gait, rp, horseBones), 1.6, 30, false);
  const meta = {
    kind: 'scout',
    gaits: Object.fromEntries(Object.entries(gaits).map(([g, G]) => [g, { speed: G.speed }])),
    // the thrust (cut, loose) lands half-way through the rider's attack
    attackHit: rp.ATTACK_PERIOD * 0.5,
    bend: BEND,
  };
  return { id, height: mount === 'elephant' ? 2.3 : mount === 'camel' ? 2.0 : 1.7, bones: bones.map((b) => ({ name: b.name, parent: b.parent ? names.indexOf(b.parent) : -1, pivot: b.pivot })),
    parts: mergeParts(model, riderColor(COATS[kit.coat] || BAY, RIDER_LOOK[id] || {})), clips, meta };
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

// ------------------------------------------------------------------------------------------------ animals
const ANIMAL_LOOK = {
  sheep: { coat: 0x2e2824, wool: 0xe6e0cc, points: 0x241e1a },
  deer: { coat: 0x8e5a2e, belly: 0xd8c4a0, rump: 0xf0e8d8, points: 0x2a2018, nose: 0x141210, horn: 0xb8a078 },
  boar: { coat: 0x4a3c32, points: 0x2a2018, belly: 0x5e4c3e, nose: 0x7a5a4c, horn: 0xf0e8d0, bristle: 0x201814 },
  wolf: { coat: 0x7a7268, belly: 0xd8d2c6, saddle: 0x2e2a26, points: 0x8a7a62, nose: 0x141210 },
};
const HOOFC = 0x1e1a16;

function animalColor(look) {
  return (p, i) => {
    const m = p.masks || {};
    if (p.mat === 'eye') return lin(EYE);
    if (p.mat === 'horn') return lin(look.horn);
    if (p.mat === 'bristle') return lin(look.bristle);
    const c = lin(look.coat);
    for (const k of ['belly', 'rump', 'saddle', 'points', 'wool', 'nose']) if (m[k] && look[k] !== undefined) mix(c, look[k], m[k][i]);
    if (m.hoof) mix(c, HOOFC, m.hoof[i]);
    return c;
  };
}

function bakeAnimal(file, id) {
  const model = load(file);
  const P = makeAnimalPose(model.bones, id);
  const names = model.bones.map((b) => b.name);
  const conv = (raw) => Object.fromEntries(Object.entries(raw).map(([k, e]) => [k, {
    q: new THREE.Quaternion().setFromEuler(new THREE.Euler(e.rx || 0, 0, e.rz || 0)).toArray(), p: [0, e.py || 0, e.pz || 0],
  }]));
  const clips = {};
  clips.stand = bakeClip(model.bones, names, seamless((t) => conv(P.stand(t)), 14), 14, 8, true);
  for (const [g, G] of Object.entries(P.gaits)) clips[g] = bakeClip(model.bones, names, (t) => conv(P.gait.pose(G, t)), 1 / G.freq, 30, true);
  if (id === 'boar' || id === 'wolf') clips.attack = bakeClip(model.bones, ['body', 'neck'], (t) => conv(P.attack(t)), P.ATTACK, 30, false);
  clips.die = bakeClip(model.bones, names, animalDeath(model, P), 1.2, 30, false);
  const meta = {
    kind: 'animal',
    gaits: Object.fromEntries(Object.entries(P.gaits).map(([g, G]) => [g, { speed: G.speed }])),
    attackHit: P.ATTACK * 0.55,
    bend: BEND,
  };
  const top = Math.max(...model.bones.map((b) => b.pivot[1]));
  return { id, height: Math.max(0.45, top + 0.15), bones: model.bones.map((b) => ({ name: b.name, parent: b.parent ? names.indexOf(b.parent) : -1, pivot: b.pivot })),
    parts: mergeParts(model, animalColor(ANIMAL_LOOK[id])), clips, meta };
}

/** An animal's death: the legs give, and it rolls onto its right side, resting on the ground (height measured). */
function animalDeath(model, P) {
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const qx = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), a);
  const qz = (a) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
  const LX = model.bones.find((b) => b.name === 'legFR').pivot[0];
  const pivot = new THREE.Vector3(LX, 0, 0);
  const at = (t, lift) => {
    const u = t / 1.2;
    const buckle = ss(0, 0.35, u);
    const fall = Math.min(1, Math.max(0, (u - 0.1) / 0.55)) ** 2;
    const out = {};
    const R = qz(Math.PI / 2 * 0.95 * fall);
    const p = pivot.clone().sub(pivot.clone().applyQuaternion(R)).add(new THREE.Vector3(0, lift * fall - 0.05 * buckle * (1 - fall), 0));
    out.root = { q: R.toArray(), p: p.toArray() };
    for (const k of ['FL', 'FR', 'BL', 'BR']) {
      out['leg' + k] = { q: qx((k[0] === 'F' ? -0.3 : 0.3) * buckle).toArray(), p: [0, 0, 0] };
      out['leg' + k + '2'] = { q: qx((k[0] === 'F' ? 0.7 : -0.6) * buckle).toArray(), p: [0, 0, 0] };
    }
    out.neck = { q: qx(0.25 * buckle - 0.35 * fall).toArray(), p: [0, 0, 0] };
    return out;
  };
  const low = lowestPoint(model, at(1.2, 0), model.bones.map((b) => b.name));
  const lift = -low + 0.003;
  return (t) => at(t, lift);
}

// ------------------------------------------------------------------------------------------------ siege engines
const SIEGE_KIT = {
  wood: 0x7a5230, darkwood: 0x4a3020, plank: 0x9a7a4a, hide: 0x9a7a54, iron: 0x6a6e74, darkiron: 0x2e2e30,
  rope: 0xc0a878, stone: 0x9a968e, bronze: 0xb88a3a, sack: 0x9a7a52, clay: 0xa8583a, darkleather: 0x3e2a1a,
};
const siegeColor = (p) => (p.mat === 'team' ? new THREE.Color(1, 1, 1) : lin(SIEGE_KIT[p.mat] ?? SIEGE_KIT.wood));
const eul = (e) => ({ q: new THREE.Quaternion().setFromEuler(new THREE.Euler(e.rx || 0, e.ry || 0, e.rz || 0)).toArray(), p: [e.px || 0, e.py || 0, e.pz || 0] });
const eulPose = (raw) => Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, eul(v)]));

function bakeSiege(file, id) {
  const model = load(file);
  const { kind, height, wheel } = model.meta;
  const names = model.bones.map((b) => b.name);
  const clips = {};
  clips.idle = bakeClip(model.bones, names, () => ({}), 1, 2, true);
  // one full turn of the wheels; the renderer times it by the distance travelled
  clips.move = bakeClip(model.bones, ['wheelF', 'wheelB'], (t) => eulPose(SIEGE.roll(t)), 1, 24, true);
  const A = SIEGE.ATTACKS[kind];
  clips.attack = bakeClip(model.bones, names.filter((n) => !['root', 'body', 'wheelF', 'wheelB'].includes(n)), (t) => eulPose(SIEGE.attack(kind, t)), A.len, 30, false);
  clips.die = bakeClip(model.bones, ['root'], (t) => eulPose(SIEGE.die(t)), 1, 30, false);
  const meta = { kind: 'siege', moveDist: 2 * Math.PI * wheel, attackHit: A.len * A.hit };
  return { id, height, bones: model.bones.map((b) => ({ name: b.name, parent: b.parent ? names.indexOf(b.parent) : -1, pivot: b.pivot })),
    parts: mergeParts(model, siegeColor), clips, meta };
}

/** The trade cart: the horse in harness (its own gaits) and the cart behind, whose wheels turn with the distance. */
function bakeCart(file, id) {
  const horse = load('horse_light.json');
  const cart = load(file);
  const bones = [...horse.bones];
  for (const b of cart.bones) if (!bones.some((o) => o.name === b.name)) bones.push(b);
  const model = { bones, parts: [...horse.parts, ...cart.parts] };
  const names = bones.map((b) => b.name);
  const horseBones = horse.bones.map((b) => b.name);
  const gait = makeHorseGait(horse.bones);
  const wheelR = cart.meta.wheel;
  const clips = {};
  clips['horse:stand'] = bakeClip(bones, horseBones, (t) => eulPose(gait.stand(t)), 4 * Math.PI, 8, true);
  for (const g of ['walk', 'trot']) {
    const G = GAITS[g];
    // the wheels turn as far as the horse walks in one stride
    const turns = (t) => (G.speed * t) / (2 * Math.PI * wheelR);
    clips['horse:' + g] = bakeClip(bones, [...horseBones, 'wheelF'], (t) => eulPose({ ...gait.pose(G, t), ...SIEGE.roll(turns(t)) }), 1 / G.freq, 30, true);
  }
  // the horse's legs give way and it goes down in the shafts; the cart tips forward
  clips.die = bakeClip(bones, names, (t) => {
    const e = Math.min(1, t / 1.0) ** 2;
    const raw = gait.stand(0);
    raw.body = { py: -0.3 * e };
    for (const k of ['FL', 'FR', 'BL', 'BR']) {
      raw['leg' + k] = { rx: (k[0] === 'F' ? -0.5 : 0.6) * e };
      raw['leg' + k + '2'] = { rx: (k[0] === 'F' ? 1.6 : -1.4) * e };
    }
    raw.neck = { rx: 0.5 * e };
    raw.cart = { rx: 0.18 * e, py: -0.05 * e };
    return eulPose(raw);
  }, 1.2, 30, false);
  const meta = { kind: 'scout', gaits: { walk: { speed: GAITS.walk.speed }, trot: { speed: GAITS.trot.speed } }, bend: BEND, scale: 0.8 };
  return { id, height: 1.4, bones: bones.map((b) => ({ name: b.name, parent: b.parent ? names.indexOf(b.parent) : -1, pivot: b.pivot })),
    parts: mergeParts(model, (p, i) => (horse.parts.includes(p) ? riderColor(COATS.mule)(p, i) : siegeColor(p))), clips, meta };
}

// ------------------------------------------------------------------------------------------------ ships
const SHIP_KIT = {
  hull: 0x6a4a2a, deck: 0xa8845a, wood: 0x7a5230, darkwood: 0x3e2818, sail: 0xe8e0cc, rope: 0xc0a878, iron: 0x6a6e74,
  darkiron: 0x2e2e30, bronze: 0xb88a3a, fire: 0xff8a2a, skin: 0xc89066, cargo: 0x9a7a4a, clay: 0xa8583a,
};
/** Hull colours, as the game's procedural ships had them. */
const SHIP_HULL = {
  fishingShip: 0x8a6a42, transportShip: 0x7a5a38, tradeCog: 0x8a6a42, galley: 0x6a4a2a, warGalley: 0x5a3e24, galleon: 0x5a3e24,
  fireShip: 0x5a3a24, fastFireShip: 0x4a3020, demolitionShip: 0x6a5a4a, heavyDemolitionShip: 0x5a4a3a, cannonGalleon: 0x4a3220,
};

function bakeShip(file, id) {
  const model = load(file);
  const names = model.bones.map((b) => b.name);
  const has = (n) => names.includes(n);
  const pal = { ...SHIP_KIT, hull: SHIP_HULL[id] ?? SHIP_KIT.hull };
  const color = (p) => (p.mat === 'team' ? new THREE.Color(1, 1, 1) : lin(pal[p.mat] ?? pal.wood));
  // riding the swell: a slow bob, pitch and roll (loops in 8 s)
  const swell = (t, k = 1) => ({
    hull: { py: 0.012 * k * Math.sin(2 * Math.PI * t / 4), rx: 0.018 * k * Math.sin(2 * Math.PI * t / 8 + 1), rz: 0.028 * k * Math.sin(2 * Math.PI * t / 8) },
  });
  const sail = (t, full) => (has('sail') ? { sail: { rx: (full ? -0.06 : -0.02) + 0.015 * Math.sin(2 * Math.PI * t / 2) } } : {});
  // one stroke: the blades sweep aft through the water, then lift and swing forward
  const oars = (t) => {
    if (!has('oarsL')) return {};
    const ph = 2 * Math.PI * t / 1.6;
    const sweep = 0.35 * Math.sin(ph), lift = 0.075 * (1 - Math.cos(ph));
    return { oarsL: { ry: sweep, rz: lift }, oarsR: { ry: -sweep, rz: -lift } };
  };
  const clips = {};
  clips.idle = bakeClip(model.bones, names, (t) => eulPose({ ...swell(t), ...sail(t, false), ...(has('oarsL') ? { oarsL: { rz: 0.15 }, oarsR: { rz: -0.15 } } : {}) }), 8, 10, true);
  clips.row = bakeClip(model.bones, names, (t) => eulPose({ ...swell(t, 1.4), ...sail(t, true), ...oars(t) }), 8, 20, true);
  if (has('net')) {
    // the net swung out over the side, lowered, and hauled back in (4 s)
    clips.work = bakeClip(model.bones, ['net'], (t) => {
      const u = t / 4;
      return eulPose({ net: { ry: -0.9 * Math.sin(Math.PI * Math.min(1, u * 1.3)), rz: -0.4 * Math.sin(Math.PI * u) } });
    }, 4, 15, true);
  }
  // loosing (arrows, a broadside, the fire siphon): the hull heels from the shock and rights itself
  clips.attack = bakeClip(model.bones, ['hull'], (t) => {
    const k = t < 0.1 ? t / 0.1 : Math.exp(-(t - 0.1) * 4) * Math.cos((t - 0.1) * 9);
    return eulPose({ hull: { rz: 0.05 * k, py: -0.01 * Math.max(0, k) } });
  }, 1, 30, false);
  clips.die = bakeClip(model.bones, ['root'], (t) => {
    const e = Math.min(1, t / 2.5);
    const ee = e * e * (3 - 2 * e);
    return eulPose({ root: { py: -0.9 * ee, rx: 0.25 * ee, rz: 0.5 * ee } });
  }, 2.5, 20, false);
  const meta = { kind: 'ship', attackHit: 0.1 };
  return { id, height: model.meta.height, bones: model.bones.map((b) => ({ name: b.name, parent: b.parent ? names.indexOf(b.parent) : -1, pivot: b.pivot })),
    parts: mergeParts(model, color), clips, meta };
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
];
for (const f of fs.readdirSync(inDir)) {
  const m = f.match(/^kit_(\w+)\.json$/);
  if (m) jobs.push([m[1], () => bakeSoldier(m[1])]);
  const c = f.match(/^cav_(\w+)\.json$/);
  if (c) jobs.push([c[1], () => bakeRider(f, c[1])]);
  const a = f.match(/^animal_(\w+)\.json$/);
  if (a) jobs.push([a[1], () => bakeAnimal(f, a[1])]);
  const sh = f.match(/^ship_(\w+)\.json$/);
  if (sh) jobs.push([sh[1], () => bakeShip(f, sh[1])]);
  const g = f.match(/^siege_(\w+)\.json$/);
  if (g) jobs.push([g[1], () => (g[1] === 'tradeCart' ? bakeCart(f, g[1]) : bakeSiege(f, g[1]))]);
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
