// Checks the villager's tool, work, attack and death animations for things a viewer would notice:
//   IK targets out of reach, and wrists bent further than a real wrist goes;
//   feet sliding while they should be planted, anything sinking into the ground (a tool may bite a little way into the
//   soil or rock it strikes);
//   tools passing through the body, arms passing through the body, legs or each other, legs through the trunk, and
//   legs showing through the tunic or dress.
// Interpenetration is counted per vertex (inside a closed part, by ray parity), ignoring vertices already inside that
// part in the rest pose (where joints overlap by design).
// Usage: node tools/review/human-work-check.cjs <human.json> [only-anim] [only-tool]
process.removeAllListeners('warning');
const THREE = require('three');
const path = require('path');
const { makeHumanPose } = require('./human-pose.cjs');

const MODEL = require(path.resolve(process.argv[2]));
const ONLY_ANIM = process.argv[3], ONLY_TOOL = process.argv[4];
const FRAMES = Number(process.env.FRAMES || 36);

// ---- skeleton
const root = new THREE.Group();
const groups = {};
const pivots = Object.fromEntries(MODEL.bones.map((b) => [b.name, new THREE.Vector3(...b.pivot)]));
for (const b of MODEL.bones) {
  const g = new THREE.Group();
  g.position.copy(pivots[b.name]).sub(b.parent ? pivots[b.parent] : new THREE.Vector3());
  g.userData.rest = g.position.clone();
  groups[b.name] = g;
  (b.parent ? groups[b.parent] : root).add(g);
}
root.updateMatrixWorld(true);
const restInv = Object.fromEntries(Object.entries(groups).map(([n, g]) => [n, g.matrixWorld.clone().invert()]));
function applyPose(pose) {
  for (const [name, g] of Object.entries(groups)) {
    const p = pose[name];
    g.position.copy(g.userData.rest);
    g.quaternion.identity();
    if (!p) continue;
    if (p.q) g.quaternion.fromArray(p.q);
    if (p.p) g.position.add(new THREE.Vector3(...p.p));
  }
  root.updateMatrixWorld(true);
}
const byName = Object.fromEntries(MODEL.parts.map((p) => [p.name, p]));
function worldVerts(part) {
  const piv = pivots[part.bone];
  const m = part.masks || {};
  const out = [];
  const tmp = new THREE.Vector3();
  const skinBones = Object.keys(m).filter((k) => groups[k]);
  const skin = Object.fromEntries(skinBones.map((b) => [b, groups[b].matrixWorld.clone().multiply(restInv[b])]));
  const own = groups[part.bone].matrixWorld.clone().multiply(restInv[part.bone]);
  for (let i = 0; i < part.pos.length; i += 3) {
    const rest = new THREE.Vector3(part.pos[i] + piv.x, part.pos[i + 1] + piv.y, part.pos[i + 2] + piv.z);
    let wOwn = 1;
    const acc = new THREE.Vector3();
    for (const b of skinBones) {
      const w = m[b][i / 3];
      if (w <= 0) continue;
      acc.addScaledVector(tmp.copy(rest).applyMatrix4(skin[b]), w);
      wOwn -= w;
    }
    out.push(acc.addScaledVector(tmp.copy(rest).applyMatrix4(own), wOwn));
  }
  return out;
}
function solid(part, v) {
  const t = [];
  for (let i = 0; i < part.idx.length; i += 3) t.push([v[part.idx[i]], v[part.idx[i + 1]], v[part.idx[i + 2]]]);
  const box = new THREE.Box3().setFromPoints(v);
  return { t, box };
}
const ray = new THREE.Ray(), hit = new THREE.Vector3();
function hits(origin, dir, tris) {
  ray.set(origin, dir);
  let n = 0;
  for (const [a, b, c] of tris) if (ray.intersectTriangle(a, b, c, false, hit)) n++;
  return n;
}
const DIRS = [new THREE.Vector3(0.577, 0.577, 0.577), new THREE.Vector3(-0.3, 0.2, -0.93).normalize(), new THREE.Vector3(0.8, -0.55, 0.2).normalize()];
function inside(p, s) {
  if (!s.box.containsPoint(p)) return false;
  let odd = 0;
  for (const d of DIRS) if (hits(p, d, s.t) % 2 === 1) odd++;
  return odd >= 2;
}

// ---- which parts are checked against which
const has = (n) => !!byName[n];
const CORE = ['head', 'torso', 'belt', 'scarf'].filter(has);
const LEGS = ['thighL', 'thighR', 'shinL', 'shinR', 'wrapL', 'wrapR', 'footL', 'footR'].filter(has);
const ARM = { L: ['uparmL', 'sleeveL', 'forearmL', 'handL'], R: ['uparmR', 'sleeveR', 'forearmR', 'handR'] };
const LOWER_ARM = { L: ['forearmL', 'handL'], R: ['forearmR', 'handR'] };
const toolParts = (tool) => MODEL.parts.filter((p) => p.variant === 'tool:' + tool && p.name !== 'rodline').map((p) => p.name);
const BASE = MODEL.parts.filter((p) => !p.variant).map((p) => p.name);

/** Pairs (moving part -> parts it must stay out of) for a given tool. */
function pairs(tool, twoHanded) {
  const P = [];
  for (const s of ['L', 'R']) {
    const other = s === 'L' ? 'R' : 'L';
    for (const a of LOWER_ARM[s]) P.push([a, [...CORE, ...LEGS, ...ARM[other]]]);
    P.push(['uparm' + s, [...LEGS, 'head']]);
  }
  for (const l of ['thighL', 'thighR', 'shinL', 'shinR']) P.push([l, ['head']]);   // inside the trunk they are hidden under the tunic
  if (tool) {
    const holding = tool === 'basket' ? ['handL'] : twoHanded ? ['handL', 'handR'] : ['handR'];
    const body = [...CORE, ...LEGS, ...ARM.L, ...ARM.R].filter((n) => !holding.includes(n));
    for (const t of toolParts(tool)) P.push([t, body]);
  }
  return P;
}

// vertices inside a part at rest are exempt (joints overlap by design)
applyPose({});
const REST_INSIDE = {};
{
  const V = Object.fromEntries(MODEL.parts.map((p) => [p.name, worldVerts(p)]));
  const S = Object.fromEntries(MODEL.parts.map((p) => [p.name, solid(p, V[p.name])]));
  const all = new Set();
  for (const tool of [null, 'axe', 'pick', 'hammer', 'hoe', 'spear', 'rod', 'basket']) for (const [a, bs] of pairs(tool, true)) for (const b of bs) all.add(a + '|' + b);
  for (const key of all) {
    const [a, b] = key.split('|');
    REST_INSIDE[key] = new Set(V[a].map((v, i) => (inside(v, S[b]) ? i : -1)).filter((i) => i >= 0));
  }
}

/** Height and radius of the hem at rest (lowest ring of the skirt). */
function hemOf(model) {
  const sk = model.parts.find((p) => p.name === 'skirt');
  const piv = model.bones.find((b) => b.name === sk.bone).pivot;
  let y = Infinity, r = 0;
  for (let i = 0; i < sk.pos.length; i += 3) y = Math.min(y, sk.pos[i + 1] + piv[1]);
  for (let i = 0; i < sk.pos.length; i += 3) if (sk.pos[i + 1] + piv[1] < y + 0.01) r = Math.max(r, Math.hypot(sk.pos[i] + piv[0], sk.pos[i + 2] + piv[2]));
  return { y, r };
}
const HEM = hemOf(MODEL);

function evaluate(anim, tool, opts = {}) {
  const poser = makeHumanPose(THREE, MODEL.bones, { hem: HEM });
  const w = poser.WORK[tool] || poser.WORK.none;
  const T = anim === 'work' ? w.period : anim === 'attack' ? poser.ATTACK : anim === 'die' ? poser.DIE.len + 0.3
    : anim === 'walk' ? 2 / poser.WALK.freq : 6;
  const twoHanded = anim === 'work' ? w.left != null : anim === 'attack' && tool === 'spear';
  const PAIRS = pairs(tool, twoHanded);
  const shown = [...BASE, ...(tool ? MODEL.parts.filter((p) => p.variant === 'tool:' + tool).map((p) => p.name) : [])];
  const r = { unreached: 0, miss: 0, bend: 0, ground: Infinity, groundPart: '', toolDepth: 0, slide: 0, pen: {}, legShow: 0, frames: FRAMES };
  const feet0 = {};
  for (let f = 0; f < FRAMES; f++) {
    const t = (f / FRAMES) * T;
    const pose = poser.pose(anim, t, false, tool);
    for (const d of pose.__diag || []) {
      if (d.miss !== undefined && d.miss > 0.002) { r.unreached++; r.miss = Math.max(r.miss, d.miss); }
      else if (d.reached === false && d.what.startsWith('leg') && anim !== 'die') r.unreached++;
      if (d.bend !== undefined) r.bend = Math.max(r.bend, d.bend);
    }
    applyPose(pose);
    const V = {}, S = {};
    const verts = (n) => V[n] || (V[n] = worldVerts(byName[n]));
    const sol = (n) => S[n] || (S[n] = solid(byName[n], verts(n)));
    // ground
    for (const n of shown) {
      if (n === 'rodline') continue;
      const lo = Math.min(...verts(n).map((v) => v.y));
      const isTool = byName[n].variant;
      if (isTool) r.toolDepth = Math.max(r.toolDepth, -lo);
      else if (lo < r.ground) { r.ground = lo; r.groundPart = n; }
    }
    if (process.env.PERFRAME && anim === 'die') {
      const lo = Math.min(...verts('skirt').map((v) => v.y));
      console.log(`   ${(t).toFixed(2)}s skirt lowest ${(lo * 1000).toFixed(0)}mm`);
    }
    // planted feet stay put (work and attack stand still)
    if (anim === 'work' || anim === 'attack') {
      for (const n of ['footL', 'footR']) {
        const c = verts(n).reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / verts(n).length);
        if (!feet0[n]) feet0[n] = c;
        else r.slide = Math.max(r.slide, Math.hypot(c.x - feet0[n].x, c.z - feet0[n].z));
      }
    }
    // interpenetration
    const here = [];
    for (const [a, bs] of PAIRS) {
      for (const b of bs) {
        if (!byName[a] || !byName[b]) continue;
        const exempt = REST_INSIDE[a + '|' + b] || new Set();
        const sb = sol(b);
        let n = 0;
        // against the head only the skull and face count: a raised arm meets the neck and the top of the shoulder
        const skullOnly = b === 'head' && /^uparm/.test(a);
        const headInv = skullOnly ? groups.head.matrixWorld.clone().multiply(restInv.head).invert() : null;
        verts(a).forEach((v, i) => {
          if (exempt.has(i) || !inside(v, sb)) return;
          if (skullOnly && v.clone().applyMatrix4(headInv).y < pivots.head.y + 0.035) return;
          if (process.env.WHERE && b === 'torso') { const h = v.clone().applyMatrix4(groups.torso.matrixWorld.clone().multiply(restInv.torso).invert()); console.log(`      ${a} in torso at rest-frame (${h.x.toFixed(3)}, ${h.y.toFixed(3)}, ${h.z.toFixed(3)})`); }
          if (process.env.WHERE && b === 'head') { const h = v.clone().applyMatrix4(groups.head.matrixWorld.clone().multiply(restInv.head).invert()); console.log(`      ${a} in head at rest-frame (${h.x.toFixed(3)}, ${h.y.toFixed(3)}, ${h.z.toFixed(3)})`); }
          n++;
        });
        if (n) {
          const key = `${a}>${b}`;
          r.pen[key] = Math.max(r.pen[key] || 0, n);
          here.push(`${key}:${n}`);
        }
      }
    }
    if (process.env.PERFRAME && here.length) console.log(`   ${(f / FRAMES).toFixed(2)} ${here.join(' ')}`);
    // legs under the cloth: a ray cast outward must hit the skirt (only where the leg is above the hem)
    const sv = verts('skirt'), st = solid(byName.skirt, sv).t;
    const centre = new THREE.Vector3().setFromMatrixPosition(groups.hips.matrixWorld);
    const az = (v) => Math.atan2(v.x - centre.x, v.z - centre.z);
    const BINS = 24, hemAt = new Array(BINS).fill(Infinity);
    for (const v of sv) {
      const b = Math.floor(((az(v) + Math.PI) / (2 * Math.PI)) * BINS) % BINS;
      hemAt[b] = Math.min(hemAt[b], v.y);
    }
    const localHem = (v) => {
      const b = Math.floor(((az(v) + Math.PI) / (2 * Math.PI)) * BINS) % BINS;
      return Math.max(hemAt[b], hemAt[(b + 1) % BINS], hemAt[(b + BINS - 1) % BINS]);
    };
    // anything else of the body poking out through the cloth below the waist (the belt sits on top of it)
    if (anim !== 'die' && process.env.UNDER) {
      for (const pn of BASE.filter((n) => !['skirt', 'belt', 'head', 'scarf', 'scarfknot'].includes(n) && !/^(thigh|shin|wrap|foot)/.test(n))) {
        let n = 0;
        for (const v of verts(pn)) {
          if (v.y < localHem(v) + 0.02 || v.y > centre.y - 0.01) continue;
          const out = new THREE.Vector3(v.x - centre.x, 0, v.z - centre.z).normalize();
          if (hits(v, out, st) === 0 && Math.hypot(v.x - centre.x, v.z - centre.z) < 0.16) n++;
        }
        if (n) console.log(`   ${(f / FRAMES).toFixed(2)} ${pn} out through cloth: ${n}`);
      }
    }
    // tools passing into the tunic or dress (a point above the hem whose outward ray crosses the cloth is under it)
    if (tool && anim !== 'die') {
      for (const tn of toolParts(tool)) {
        let n = 0;
        for (const v of verts(tn)) {
          if (v.y < localHem(v) + 0.005 || v.y > centre.y + 0.05) continue;
          const out = new THREE.Vector3(v.x - centre.x, 0, v.z - centre.z);
          if (out.lengthSq() < 1e-8) continue;
          if (hits(v, out.normalize(), st) % 2 === 1) n++;
        }
        if (n) {
          const key = `${tn}>skirt`;
          r.pen[key] = Math.max(r.pen[key] || 0, n);
          if (process.env.PERFRAME) console.log(`   ${(f / FRAMES).toFixed(2)} ${key}:${n}`);
        }
      }
    }
    if (anim !== 'die') {
      const hipY = centre.y;
      for (const ln of ['thighL', 'thighR', 'shinL', 'shinR']) {
        for (const v of verts(ln)) {
          if (v.y < localHem(v) + 0.02 || v.y > hipY - 0.02) continue;
          const out = new THREE.Vector3(v.x - centre.x, 0, v.z - centre.z).normalize();
          if (hits(v, out, st) === 0) {
            r.legShow++;
            if (process.env.PERFRAME) console.log(`   ${(f / FRAMES).toFixed(2)} ${ln} shows at y ${v.y.toFixed(3)} (hem ${localHem(v).toFixed(3)})`);
          }
        }
      }
    }
  }
  return r;
}

const deg = (a) => (a * 180 / Math.PI).toFixed(0);
function report(anim, tool) {
  const r = evaluate(anim, tool);
  const pen = Object.entries(r.pen).map(([k, n]) => `${k}:${n}`).join(' ');
  const bad = r.unreached || r.ground < -0.003 || r.slide > 0.003 || pen || r.legShow;
  console.log(`${bad ? '!!' : 'ok'} ${(anim + ' ' + (tool || '-')).padEnd(14)} unreached ${String(r.unreached).padStart(2)} (miss ${(r.miss * 1000).toFixed(0)}mm)  wrist ${deg(r.bend).padStart(3)}°  `
    + `lowest ${(r.ground * 1000).toFixed(1).padStart(6)}mm ${r.groundPart.padEnd(8)} tool below ground ${(r.toolDepth * 1000).toFixed(0).padStart(3)}mm  `
    + `slide ${(r.slide * 1000).toFixed(1)}mm  leg showing ${r.legShow}  ${pen}`);
  return r;
}

if (require.main === module) {
  const TOOLS = ['axe', 'pick', 'hammer', 'hoe', 'basket', 'spear', 'rod'];
  const runs = [];
  for (const t of TOOLS) runs.push(['work', t]);
  for (const t of [null, 'axe', 'spear', 'basket']) runs.push(['attack', t]);
  for (const t of [null, ...TOOLS]) runs.push(['die', t]);
  for (const t of TOOLS) runs.push(['idle', t], ['walk', t]);
  for (const [a, t] of runs) {
    if (ONLY_ANIM && a !== ONLY_ANIM) continue;
    if (ONLY_TOOL && String(t) !== ONLY_TOOL) continue;
    report(a, t);
  }
}
module.exports = { evaluate };
