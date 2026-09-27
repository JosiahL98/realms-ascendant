// Measures, through the attack, how close the spear comes to every other part of rider, tack and horse.
// Usage: node tools/review/rider-clearance.cjs <horse.json> <rider.json> [frames]
process.removeAllListeners('warning');
const THREE = require('three');
const { makeRiderPose, ATTACK_PERIOD } = require('./rider-pose.cjs');

const [horsePath, riderPath, framesArg] = require.main === module ? process.argv.slice(2) : [];
const HORSE = require(require('path').resolve(horsePath || process.env.HORSE));
const RIDER = require(require('path').resolve(riderPath || process.env.RIDER));
const FRAMES = Number(framesArg || 36);
const SPEAR_R = 0.0095;
const SPEAR = new Set(['spearshaft', 'spearhead', 'spearbinding']);
const OPEN = new Set(['cloth', 'clothtrim', 'straps', 'bridle', 'reins', 'bits']);   // thin surfaces: distance only
const SKIP = new Set(['handR']);   // the fist closes on the spear

// ---- skeleton and parts, as the review page builds them
const root = new THREE.Group();
const groups = {};
const pivots = {};
for (const D of [HORSE, RIDER]) for (const b of D.bones) if (!pivots[b.name]) pivots[b.name] = new THREE.Vector3(...b.pivot);
for (const D of [HORSE, RIDER]) {
  for (const b of D.bones) {
    if (groups[b.name]) continue;
    const g = new THREE.Group();
    const parent = b.parent && b.parent !== 'root' ? pivots[b.parent] : new THREE.Vector3();
    g.position.copy(pivots[b.name]).sub(parent);
    g.userData.rest = g.position.clone();
    groups[b.name] = g;
    (b.parent && groups[b.parent] ? groups[b.parent] : root).add(g);
  }
}
const parts = [];
for (const D of [HORSE, RIDER]) {
  for (const p of D.parts) {
    const o = new THREE.Object3D();
    groups[p.bone].add(o);
    parts.push({ name: p.name, bone: p.bone, obj: o, pos: p.pos, idx: p.idx });
  }
}
const shaft = RIDER.parts.find((p) => p.name === 'spearshaft');
const head = RIDER.parts.find((p) => p.name === 'spearhead');
const D_REST = new THREE.Vector3(0.03, 1.0, -0.12).normalize();
let lo = Infinity, hi = -Infinity;
for (const p of [shaft, head]) {
  for (let i = 0; i < p.pos.length; i += 3) {
    const s = p.pos[i] * D_REST.x + p.pos[i + 1] * D_REST.y + p.pos[i + 2] * D_REST.z;
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
}

let poser = makeRiderPose(THREE, RIDER.bones);

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

function worldTris(part) {
  const m = part.obj.matrixWorld, v = [], tris = [];
  for (let i = 0; i < part.pos.length; i += 3) v.push(new THREE.Vector3(part.pos[i], part.pos[i + 1], part.pos[i + 2]).applyMatrix4(m));
  for (let i = 0; i < part.idx.length; i += 3) tris.push(new THREE.Triangle(v[part.idx[i]], v[part.idx[i + 1]], v[part.idx[i + 2]]));
  return tris;
}

const ray = new THREE.Ray(), tmp = new THREE.Vector3(), hit = new THREE.Vector3();
function clearance(point, tris, closed) {
  let best = Infinity, crossings = 0;
  ray.set(point, new THREE.Vector3(0.577, 0.577, 0.577));
  for (const t of tris) {
    t.closestPointToPoint(point, tmp);
    best = Math.min(best, tmp.distanceTo(point));
    if (closed && ray.intersectTriangle(t.a, t.b, t.c, false, hit)) crossings++;
  }
  return closed && crossings % 2 === 1 ? -best : best;
}

/** Minimum clearance (m) of the spear over attack fractions u0..u1 in n frames; per-part worst and per-frame rows. */
function evaluate(tune = {}, u0 = 0, u1 = 1, n = FRAMES, verbose = false) {
  poser = makeRiderPose(THREE, RIDER.bones, tune);
  const worst = {};
  const rows = [];
  let overall = Infinity;
  for (let f = 0; f < n; f++) {
    const u = u0 + (u1 - u0) * (n === 1 ? 0 : f / (n - 1));
    const t = u * ATTACK_PERIOD;
    applyPose(poser.pose('attack', t, null));
    const sm = groups.rspear.matrixWorld;
    const grip = new THREE.Vector3().applyMatrix4(sm);
    const samples = [];
    for (let s = lo; s <= hi; s += 0.01) {
      const q = D_REST.clone().multiplyScalar(s).applyMatrix4(sm);
      if (q.distanceTo(grip) > 0.05) samples.push(q);
    }
    let frameMin = Infinity, frameWho = '';
    for (const part of parts) {
      if (SPEAR.has(part.name) || SKIP.has(part.name)) continue;
      const tris = worldTris(part);
      let m = Infinity;
      for (const q of samples) m = Math.min(m, clearance(q, tris, !OPEN.has(part.name)));
      const c = m - SPEAR_R;
      if (!worst[part.name] || c < worst[part.name].c) worst[part.name] = { c, t: u };
      if (c < frameMin) { frameMin = c; frameWho = part.name; }
    }
    overall = Math.min(overall, frameMin);
    if (verbose) {
      const tipW = new THREE.Vector3().copy(D_REST).multiplyScalar(hi).applyMatrix4(sm);
      rows.push(`${String(Math.round(u * 100)).padStart(3)}%  nearest ${frameWho.padEnd(12)} ${(frameMin * 1000).toFixed(0).padStart(5)} mm   tip (${tipW.x.toFixed(2)}, ${tipW.y.toFixed(2)}, ${tipW.z.toFixed(2)})`);
    }
  }
  return { overall, worst, rows };
}

if (require.main === module) {
  const r = evaluate({}, 0, 1 - 1 / FRAMES, FRAMES, true);
  console.log(r.rows.join('\n'));
  console.log('\nclosest approach per part (mm; negative = inside):');
  console.log(Object.entries(r.worst).sort((a, b) => a[1].c - b[1].c).slice(0, 12)
    .map(([n, w]) => `  ${n.padEnd(14)} ${(w.c * 1000).toFixed(0).padStart(5)}  at ${Math.round(w.t * 100)}%`).join('\n'));
}
module.exports = { evaluate };
