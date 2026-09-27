// The lowest point of a model under a pose (rigid parts on their bones; skinned parts blended as the game does).
// Used to rest a fallen body on the ground: a cape, a shield or a thick cuirass changes how high it lies.
const THREE = require('three');

function lowestPoint(model, pose, skip = () => false) {
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
  const rest = {};
  const restRoot = new THREE.Group(), R = {};
  for (const b of model.bones) {
    const g = new THREE.Group();
    g.position.copy(piv[b.name]).sub(b.parent ? piv[b.parent] : new THREE.Vector3());
    R[b.name] = g;
    (b.parent ? R[b.parent] : restRoot).add(g);
  }
  restRoot.updateMatrixWorld(true);
  for (const n of Object.keys(R)) rest[n] = G[n].matrixWorld.clone().multiply(R[n].matrixWorld.clone().invert());
  let low = Infinity;
  const v = new THREE.Vector3(), t = new THREE.Vector3(), acc = new THREE.Vector3();
  for (const p of model.parts) {
    if (p.variant || skip(p)) continue;
    const m = p.masks || {};
    const skin = Object.keys(m).filter((k) => G[k]);
    const pv = piv[p.bone];
    for (let i = 0; i < p.pos.length; i += 3) {
      v.set(p.pos[i] + pv.x, p.pos[i + 1] + pv.y, p.pos[i + 2] + pv.z);
      let w0 = 1;
      acc.set(0, 0, 0);
      for (const k of skin) {
        const w = m[k][i / 3];
        if (w <= 0) continue;
        acc.addScaledVector(t.copy(v).applyMatrix4(rest[k]), w);
        w0 -= w;
      }
      acc.addScaledVector(t.copy(v).applyMatrix4(rest[p.bone]), w0);
      low = Math.min(low, acc.y);
    }
  }
  return low;
}

/**
 * Pose options for a standing human model so its death ends resting on the ground: the default resting height,
 * raised if anything (cape, shield, cuirass) would sink below it.
 */
function dieOptions(model, makeHumanPose, base) {
  const P = makeHumanPose(THREE, model.bones, base);
  // the body lands at the end of the fall; take the lowest point over the last part of it
  let low = Infinity;
  for (const t of [0.9, 1.0, 1.1, 1.2, 1.3, 1.8].map((f) => f * P.DIE.len / 1.3)) {
    low = Math.min(low, lowestPoint(model, P.pose('die', t, false, null), (p) => p.name === 'rodline' || p.name === 'bowstring'));
  }
  return low < 0.003 ? { ...base, dieLift: P.DIE.lift - low + 0.004 } : base;
}

module.exports = { lowestPoint, dieOptions };
