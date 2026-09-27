// Cavalry rider poses: the spear is its own bone (child of the torso) moved through key poses; the right arm reaches
// its grip by two-bone IK with an elbow pole. Works in the rider's rest frame (horse faces +z, rider's right is -x).
// Returns bone -> { q: [x, y, z, w] (local rotation), p: [x, y, z] (local position offset) }.

const ATTACK_PERIOD = 1.5;

function makeRiderPose(THREE, bones, tune = {}) {
  const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const piv = Object.fromEntries(bones.map((b) => [b.name, V(b.pivot)]));
  const S = piv.rarmR, E0 = piv.relbowR, W0 = piv.rhandR, GRIP = piv.rspear;
  const L1 = E0.distanceTo(S), L2 = W0.distanceTo(E0);
  const D_REST = new THREE.Vector3(0.03, 1.0, -0.12).normalize();   // spear direction as modelled
  const ident = new THREE.Quaternion();
  const fromTo = (a, b) => new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), b.clone().normalize());
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const ease = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };

  // Key poses of the right hand's grip G and spear direction D, in the torso's rest frame. The target is fixed in
  // the horse's frame, so it is turned into the torso's frame for each key's body twist.
  const T = piv.rtorso;
  const TARGET = V([-0.5, 0.55, 1.15]);    // an enemy's chest ahead and to the right of the horse's head
  const toTorso = (w, twist) => w.clone().sub(T).applyAxisAngle(new THREE.Vector3(0, 1, 0), -twist).add(T);
  const HOLD = { g: GRIP.clone(), d: D_REST.clone(), pole: V([-0.35, -1, -0.45]), twist: 0 };
  const key = (g, pole, twist) => ({ g: V(g), d: toTorso(TARGET, twist).sub(V(g)).normalize(), pole: V(pole), twist });
  // lift the hand and slope the spear back over the shoulder, so the butt rises clear of the knee and arm
  const LIFT = {
    g: V(tune.liftG || [-0.295, 1.178, 0.064]), d: V(tune.liftD || [0.204, 0.735, -0.658]).normalize(), pole: V(tune.liftPole || [-0.907, -0.966, -2.623]), twist: 0,
  };
  // then the point comes forward over the top, the butt passing behind and below the raised elbow
  // (LIFT and OVER were found by tools/review/rider-pose-search.cjs, maximising clearance from arm, body and horse)
  const OVER = {
    g: V(tune.overG || [-0.297, 1.318, 0.052]), d: V(tune.overD || [0.314, -0.037, 0.981]).normalize(), pole: V(tune.overPole || [-0.376, 0.134, 2.352]), twist: 0,
  };
  const READY = key(tune.readyG || [-0.2, 1.27, -0.03], tune.readyPole || [-1, -0.35, -0.35], -0.05);
  const BACK = key([-0.19, 1.3, -0.1], [-1, -0.3, -0.5], -0.28);
  const THRUST = key([-0.235, 1.2, 0.2], [-1, -0.45, -0.1], 0.3);
  // time (fraction of the attack) -> key
  const TRACK = [[0, HOLD], [0.1, LIFT], [0.17, OVER], [0.25, READY], [0.37, BACK], [0.47, THRUST], [0.6, THRUST],
    [0.73, READY], [0.81, OVER], [0.89, LIFT], [1.0, HOLD]];

  function sample(u) {
    let i = 0;
    while (i < TRACK.length - 2 && u > TRACK[i + 1][0]) i++;
    const [t0, a] = TRACK[i], [t1, b] = TRACK[i + 1];
    const k = ease((u - t0) / (t1 - t0));
    return {
      g: a.g.clone().lerp(b.g, k),
      d: a.d.clone().lerp(b.d, k).normalize(),
      pole: a.pole.clone().lerp(b.pole, k).normalize(),
      twist: a.twist + (b.twist - a.twist) * k,
    };
  }

  /** Two-bone IK: rotations of the upper arm (relative to the torso) and forearm (relative to the upper arm). */
  function solveArm(W, pole) {
    const toW = W.clone().sub(S);
    const d = Math.min(toW.length(), L1 + L2 - 1e-4);
    const u = toW.clone().normalize();
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const v = pole.clone().addScaledVector(u, -pole.dot(u)).normalize();
    const E = S.clone().addScaledVector(u, a).addScaledVector(v, h);
    const Wc = S.clone().addScaledVector(u, d);
    const qUpper = fromTo(E0.clone().sub(S), E.clone().sub(S));
    const foreRest = W0.clone().sub(E0).applyQuaternion(qUpper);
    const qForeWorld = fromTo(foreRest, Wc.clone().sub(E)).multiply(qUpper);
    const qFore = qUpper.clone().invert().multiply(qForeWorld);
    return { qUpper, qFore, qForeWorld, E, W: Wc };
  }

  /** Right arm and spear for grip G and direction D; the fist (rigid on the forearm) closes on G. */
  function rightArm(k) {
    let arm = null, qFW = ident.clone();
    for (let i = 0; i < 5; i++) {
      const W = k.g.clone().sub(GRIP.clone().sub(W0).applyQuaternion(qFW));
      arm = solveArm(W, k.pole);
      qFW = arm.qForeWorld;
    }
    return {
      rarmR: { q: arm.qUpper.toArray() },
      relbowR: { q: arm.qFore.toArray() },
      rspear: { q: fromTo(D_REST, k.d).toArray(), p: k.g.clone().sub(GRIP).toArray() },
      _elbow: arm.E, _wrist: arm.W,
    };
  }

  /**
   * act: 'hold' | 'attack'; t: seconds; gait: null or { freq } for a little sway with the horse.
   */
  function pose(act, t, gait) {
    const sway = gait ? Math.sin(2 * Math.PI * t * gait.freq * 2) : 0;
    const k = act === 'attack' ? sample((t % ATTACK_PERIOD) / ATTACK_PERIOD) : HOLD;
    const out = rightArm(k);
    const qT = new THREE.Quaternion().setFromEuler(new THREE.Euler(gait ? 0.02 * sway : 0, k.twist, 0));
    out.rtorso = { q: qT.toArray() };
    // the head keeps facing forward while the shoulders turn; at rest it looks about now and then
    const look = gait || act === 'attack' ? 0 : 0.3 * Math.sin(t * 0.45);
    out.rhead = { q: new THREE.Quaternion().setFromEuler(new THREE.Euler(gait ? -0.015 * sway : 0, -0.85 * k.twist + look, 0)).toArray() };
    out.relbowL = { q: new THREE.Quaternion().setFromEuler(new THREE.Euler(gait ? 0.04 * sway : 0, 0, 0)).toArray() };
    return out;
  }

  return { pose, sample, ATTACK_PERIOD };
}

if (typeof module !== 'undefined') module.exports = { makeRiderPose, ATTACK_PERIOD };
