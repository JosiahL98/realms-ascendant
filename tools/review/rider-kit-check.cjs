// Checks a horseman (rider.py kit export on the light horse) for things a viewer would notice, through the hold at
// every gait and the attack standing and at the canter:
//   IK targets out of reach;
//   the weapon, bow, shield or arms passing into the rider's body, head, legs, the saddle or the horse.
// Interpenetration is counted per vertex (inside a closed part, by ray parity), ignoring vertices already inside that
// part in the rest pose (where joints overlap by design).
// Usage: node tools/review/rider-kit-check.cjs <horse_light.json> <cav_unit.json> [only-clip]
process.removeAllListeners('warning');
const THREE = require('three');
const path = require('path');
const { makeRiderPose, ATTACK_PERIOD } = require('./rider-pose.cjs');
const { GAITS, makeHorseGait } = require('./horse-gait.cjs');

const HORSE = require(path.resolve(process.argv[2]));
const RIDER = require(path.resolve(process.argv[3]));
const ONLY = process.argv[4];
const FRAMES = Number(process.env.FRAMES || 30);
const KIT = RIDER.kit;

const bones = [...HORSE.bones];
for (const b of RIDER.bones) if (!bones.some((o) => o.name === b.name)) bones.push(b);
const parts = [...HORSE.parts, ...RIDER.parts];
const byName = {};
for (const p of parts) if (!byName[p.name]) byName[p.name] = p;

// ---- skeleton
const root = new THREE.Group();
const groups = {};
const pivots = Object.fromEntries(bones.map((b) => [b.name, new THREE.Vector3(...b.pivot)]));
for (const b of bones) {
  const g = new THREE.Group();
  const parent = b.parent && b.parent !== 'root' && pivots[b.parent] ? pivots[b.parent] : new THREE.Vector3();
  g.position.copy(pivots[b.name]).sub(parent);
  g.userData.rest = g.position.clone();
  groups[b.name] = g;
  (b.parent && groups[b.parent] ? groups[b.parent] : root).add(g);
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
  return { t, box: new THREE.Box3().setFromPoints(v) };
}
const ray = new THREE.Ray(), hit = new THREE.Vector3();
const DIRS = [new THREE.Vector3(0.577, 0.577, 0.577), new THREE.Vector3(-0.3, 0.2, -0.93).normalize(), new THREE.Vector3(0.8, -0.55, 0.2).normalize()];
function inside(p, s) {
  if (!s.box.containsPoint(p)) return false;
  let odd = 0;
  for (const d of DIRS) {
    ray.set(p, d);
    let n = 0;
    for (const [a, b, c] of s.t) if (ray.intersectTriangle(a, b, c, false, hit)) n++;
    if (n % 2 === 1) odd++;
  }
  return odd >= 2;
}

// ---- pairs: moving part -> closed parts it must stay out of
const has = (n) => !!byName[n];
const BODY = ['torso', 'head', 'helmet', 'legs', 'skirt', 'saddle', 'body', 'shield', 'quiver'].filter(has);
const armOf = (s) => ['uparm', 'forearm', 'hand'].map((n) => n + s).filter(has);
const PAIRS = [];
const weaponParts = (KIT.held || []).filter(has);
const holding = KIT.weapon === 'bow' ? 'handL' : 'handR';
for (const w of weaponParts) PAIRS.push([w, [...BODY, ...armOf('L'), ...armOf('R')].filter((n) => n !== holding)]);
for (const s of ['L', 'R']) {
  const other = s === 'L' ? 'R' : 'L';
  for (const a of ['forearm' + s, 'hand' + s].filter(has)) PAIRS.push([a, [...BODY, ...armOf(other)]]);
  if (has('uparm' + s)) PAIRS.push(['uparm' + s, ['legs', 'saddle', 'body', 'shield'].filter(has)]);
}
for (const n of (KIT.shield || []).filter(has)) PAIRS.push([n, ['legs', 'body', 'saddle', ...armOf('L')].filter(has)]);

applyPose({});
const REST_INSIDE = {};
{
  const Vs = {}, Ss = {};
  const verts = (n) => Vs[n] || (Vs[n] = worldVerts(byName[n]));
  const sol = (n) => Ss[n] || (Ss[n] = solid(byName[n], verts(n)));
  for (const [a, bs] of PAIRS) for (const b of bs) REST_INSIDE[a + '|' + b] = new Set(verts(a).map((v, i) => (inside(v, sol(b)) ? i : -1)).filter((i) => i >= 0));
}

// what already overlaps at rest (exempt from the checks below, so it must be looked at here)
for (const [a, bs] of PAIRS) for (const b of bs) {
  const n = REST_INSIDE[a + '|' + b].size;
  if (n && (weaponParts.includes(a) || (KIT.shield || []).includes(a)) && !/^hand/.test(b)) console.log(`   at rest ${a} inside ${b}: ${n}`);
  if (n && weaponParts.includes(a) && /^hand/.test(b) && b !== holding) console.log(`   at rest ${a} inside ${b}: ${n}`);
}
const MOUNT = KIT.mount || 'horse';
const AP = MOUNT === 'horse' ? null : require('./animal-pose.cjs').makeAnimalPose(HORSE.bones, MOUNT);
const gait = AP ? { ...AP.gait, stand: AP.stand } : makeHorseGait(HORSE.bones);
const MOUNT_GAITS = AP ? AP.gaits : GAITS;
const euler = (e) => ({ q: new THREE.Quaternion().setFromEuler(new THREE.Euler(e.rx || 0, e.ry || 0, e.rz || 0)).toArray(), p: [0, e.py || 0, e.pz || 0] });
const horsePose = (raw) => Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, euler(v)]));
const rp = makeRiderPose(THREE, RIDER.bones, {}, KIT);

function evaluate(clip) {
  const [act, g] = clip.split(':');
  const G = g && g !== 'stand' ? MOUNT_GAITS[g] : null;
  if (g && g !== 'stand' && !G) return null;
  const T = act === 'attack' ? ATTACK_PERIOD : G ? 1 / G.freq : 8;
  const r = { miss: 0, pen: {}, worst: {} };
  for (let f = 0; f < FRAMES; f++) {
    const t = (f / FRAMES) * T;
    const pose = { ...horsePose(G ? gait.pose(G, t) : gait.stand(t)), ...rp.pose(act, t, act === 'attack' ? null : G) };
    for (const k of ['_miss', '_missL', '_missR']) if (pose[k] > 0.002) r.miss = Math.max(r.miss, pose[k]);
    applyPose(pose);
    const Vs = {}, Ss = {};
    const verts = (n) => Vs[n] || (Vs[n] = worldVerts(byName[n]));
    const sol = (n) => Ss[n] || (Ss[n] = solid(byName[n], verts(n)));
    const here = [];
    for (const [a, bs] of PAIRS) {
      for (const b of bs) {
        const ex = REST_INSIDE[a + '|' + b];
        let n = 0;
        verts(a).forEach((v, i) => { if (!ex.has(i) && inside(v, sol(b))) n++; });
        if (n) {
          const key = `${a}>${b}`;
          if (n > (r.pen[key] || 0)) { r.pen[key] = n; r.worst[key] = f / FRAMES; }
          here.push(`${key}:${n}`);
        }
      }
    }
    if (process.env.PERFRAME && here.length) console.log(`   ${(f / FRAMES).toFixed(2)} ${here.join(' ')}`);
  }
  return r;
}

const CLIPS = ['hold:stand', 'hold:walk', 'hold:trot', 'hold:canter', 'attack:stand', 'attack:canter'];
let bad = 0;
for (const c of CLIPS) {
  if (ONLY && c !== ONLY) continue;
  const r = evaluate(c);
  if (!r) continue;
  const pen = Object.entries(r.pen).map(([k, n]) => `${k}:${n}@${Math.round(r.worst[k] * 100)}%`).join(' ');
  const ok = !r.miss && !pen;
  if (!ok) bad++;
  console.log(`${ok ? 'ok' : '!!'} ${KIT.name.padEnd(17)} ${c.padEnd(14)} miss ${(r.miss * 1000).toFixed(0)}mm  ${pen}`);
}
process.exitCode = bad ? 1 : 0;
