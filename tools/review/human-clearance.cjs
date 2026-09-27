// Checks a standing human's animation for things a viewer would notice:
//   feet sliding while planted, or sinking into the ground;
//   legs showing through the tunic or dress (a ray cast outward from a covered leg point escapes without hitting cloth);
//   hands or forearms inside the skirt, the body or the legs.
// The skirt is skinned exactly as on the review page (hips blended with the thighs by the 'legL'/'legR' masks).
// Usage: node tools/review/human-clearance.cjs <human.json> [frames]
process.removeAllListeners('warning');
const THREE = require('three');
const path = require('path');
const { makeHumanPose } = require('./human-pose.cjs');

const MODEL = require(path.resolve(process.argv[2]));
const FRAMES = Number(process.argv[3] || 40);

// ---- skeleton and parts
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
const base = MODEL.parts.filter((p) => !p.variant);
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

/** World positions of a part's vertices under the current pose (linear blend skinning where it has leg weights). */
function worldVerts(part) {
  const piv = pivots[part.bone];
  const m = part.masks || {};
  const out = [];
  const tmp = new THREE.Vector3(), acc = new THREE.Vector3();
  const skinBones = Object.keys(m).filter((k) => groups[k]);
  const skin = Object.fromEntries(skinBones.map((b) => [b, groups[b].matrixWorld.clone().multiply(restInv[b])]));
  const own = groups[part.bone].matrixWorld.clone().multiply(restInv[part.bone]);
  for (let i = 0; i < part.pos.length; i += 3) {
    const rest = new THREE.Vector3(part.pos[i] + piv.x, part.pos[i + 1] + piv.y, part.pos[i + 2] + piv.z);
    let wOwn = 1;
    acc.set(0, 0, 0);
    for (const b of skinBones) {
      const w = m[b][i / 3];
      if (w <= 0) continue;
      acc.addScaledVector(tmp.copy(rest).applyMatrix4(skin[b]), w);
      wOwn -= w;
    }
    acc.addScaledVector(tmp.copy(rest).applyMatrix4(own), wOwn);
    out.push(acc.clone());
  }
  return out;
}
const tris = (part, v) => {
  const t = [];
  for (let i = 0; i < part.idx.length; i += 3) t.push(new THREE.Triangle(v[part.idx[i]], v[part.idx[i + 1]], v[part.idx[i + 2]]));
  return t;
};
const ray = new THREE.Ray(), hit = new THREE.Vector3();
function hits(origin, dir, triangles) {
  ray.set(origin, dir);
  let n = 0;
  for (const t of triangles) if (ray.intersectTriangle(t.a, t.b, t.c, false, hit)) n++;
  return n;
}
const inside = (p, triangles) => hits(p, new THREE.Vector3(0.577, 0.577, 0.577), triangles) % 2 === 1;

const byName = Object.fromEntries(base.map((p) => [p.name, p]));
const skirt = byName.skirt;
const LEGS = Object.keys(byName).filter((n) => /^(thigh|shin|wrap)/.test(n));
const HANDS = Object.keys(byName).filter((n) => /^(hand|forearm)/.test(n));
const BODY = ['torso', 'thighL', 'thighR'];
const FEET = ['footL', 'footR'];

function evaluate(anim, carry, frames = FRAMES) {
  const poser = makeHumanPose(THREE, MODEL.bones, { skirtFollow: process.env.SKIRT_FOLLOW ? Number(process.env.SKIRT_FOLLOW) : undefined });
  const T = anim === 'walk' ? 1 / poser.WALK.freq : 6;
  const r = { groundMin: Infinity, slide: 0, legShow: 0, legShowWorst: '', handInSkirt: 0, handInBody: 0, where: {} };
  const planted = {};
  for (let f = 0; f < frames; f++) {
    const t = (f / frames) * T * (anim === 'walk' ? 2 : 1);
    applyPose(poser.pose(anim, t, carry));
    const sv = worldVerts(skirt);
    const st = tris(skirt, sv);
    const hemY = Math.min(...sv.map((v) => v.y));
    // feet: never below the ground; a planted foot moves back at walking speed
    for (const fn of FEET) {
      const fv = worldVerts(byName[fn]);
      r.groundMin = Math.min(r.groundMin, Math.min(...fv.map((v) => v.y)));
      const lowest = fv.reduce((a, v) => (v.y < a.y ? v : a));
      const onGround = lowest.y < 0.004;
      if (anim === 'walk' && onGround) {
        const heel = fv.reduce((a, v) => (v.z < a.z ? v : a));
        if (!planted[fn]) planted[fn] = { t, z: heel.z };
        else if (heel.y < 0.01) r.slide = Math.max(r.slide, Math.abs(heel.z - (planted[fn].z - poser.WALK.speed * (t - planted[fn].t))));
      } else planted[fn] = null;
    }
    // legs under the cloth: a ray cast outward (away from the body's centre line) must hit the skirt
    const centre = new THREE.Vector3().setFromMatrixPosition(groups.hips.matrixWorld);
    // hem height around the body (it rises in front of a leg that swings forward)
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
    for (const ln of LEGS) {
      for (const v of worldVerts(byName[ln])) {
        if (v.y < localHem(v) + 0.02 || v.y > 0.44) continue;
        const out = new THREE.Vector3(v.x - centre.x, 0, v.z - centre.z).normalize();
        if (hits(v, out, st) === 0) {
          if (process.env.SHOW_DEBUG && r.legShow < 400) (r.points = r.points || []).push(`${ln} y${v.y.toFixed(2)} hem${localHem(v).toFixed(2)} az${(az(v) * 57.3).toFixed(0)} t${t.toFixed(2)}`);
          r.legShow++;
          r.where[ln] = (r.where[ln] || 0) + 1;
        }
      }
    }
    // hands and forearms: not inside the skirt, the body or the thighs
    const bodyTris = BODY.map((n) => tris(byName[n], worldVerts(byName[n])));
    for (const hn of HANDS) {
      for (const v of worldVerts(byName[hn])) {
        if (v.y > hemY + 0.02 && v.y < 0.47) {
          const out = new THREE.Vector3(v.x - centre.x, 0, v.z - centre.z).normalize();
          if (hits(v, out, st) % 2 === 1) { r.handInSkirt++; r.where[hn + ' in skirt'] = (r.where[hn + ' in skirt'] || 0) + 1; }
        }
        for (let k = 0; k < BODY.length; k++) {
          if (inside(v, bodyTris[k])) { r.handInBody++; r.where[hn + ' in ' + BODY[k]] = (r.where[hn + ' in ' + BODY[k]] || 0) + 1; }
        }
      }
    }
  }
  return r;
}

if (require.main === module) {
  for (const [anim, carry] of [['idle', false], ['walk', false], ['walk', true], ['idle', true]]) {
    const r = evaluate(anim, carry);
    console.log(`${(anim + (carry ? '+carry' : '')).padEnd(11)} lowest foot point ${(r.groundMin * 1000).toFixed(1).padStart(5)} mm  `
      + `planted slide ${(r.slide * 1000).toFixed(1).padStart(4)} mm  leg showing ${String(r.legShow).padStart(4)}  `
      + `hand in skirt ${String(r.handInSkirt).padStart(3)}  hand in body ${String(r.handInBody).padStart(3)}  ${JSON.stringify(r.where)}`);
    if (r.points && anim === 'walk' && !carry) console.log(r.points.join(String.fromCharCode(10)));
  }
}
module.exports = { evaluate };
