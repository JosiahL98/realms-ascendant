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

  // Key poses of the right hand's grip G and spear direction D, in the torso's rest frame. The spear stays tip-up
  // while the hand moves out, then the point comes down to level and he draws back and thrusts. Directions are set in
  // the horse's frame (straight ahead, turned slightly towards the centre so the butt clears his arm) and turned
  // into the torso's frame for each key's body twist.
  const T = piv.rtorso;
  const Y = new THREE.Vector3(0, 1, 0);
  const inTorso = (w, twist) => w.clone().applyAxisAngle(Y, -twist);
  const yaw = tune.yaw ?? 0.159, pitch = tune.pitch ?? 0.027;
  const LEVEL_DIR = V([yaw, pitch, 1]).normalize();
  const HOLD = { g: GRIP.clone(), d: D_REST.clone(), pole: V(tune.holdPole || [-2.623, -0.474, -1.23]), twist: 0 };
  const lvl = (g, pole, twist) => ({ g: V(g), d: inTorso(LEVEL_DIR, twist), pole: V(pole), twist });
  // the hand moves out and up with the spear still upright, so the butt clears the knee before the point comes down
  const OUT = { g: V(tune.outG || [-0.263, 1.124, 0.043]), d: V([0.02, 1, -0.06]).normalize(), pole: V(tune.outPole || [1.003, -0.968, -1.762]), twist: 0 };
  const LEVEL = lvl(tune.levelG || [-0.348, 1.082, 0.082], tune.levelPole || [-1.91, -1.262, -0.854], -0.05);
  const BACK = lvl(tune.backG || [-0.278, 0.943, -0.03], tune.backPole || [-1.654, 1.303, 0.505], -0.25);
  const THRUST = lvl(tune.thrustG || [-0.3, 1.077, 0.141], tune.thrustPole || [-0.421, -1.896, 0.035], 0.25);
  // (hand positions and elbow directions were found by tools/review/rider-pose-search.cjs, maximising clearance of
  // spear and arm from everything else while keeping every grip within the arm's reach)
  // time (fraction of the attack) -> key
  const TRACK = [[0, HOLD], [0.12, OUT], [0.3, LEVEL], [0.4, BACK], [0.5, THRUST], [0.62, THRUST], [0.74, LEVEL],
    [0.88, OUT], [1.0, HOLD]];

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
    // if the grip was out of reach the arm stops short: the spear goes where the fist actually is
    const fist = arm.W.clone().add(GRIP.clone().sub(W0).applyQuaternion(qFW));
    return {
      rarmR: { q: arm.qUpper.toArray() },
      relbowR: { q: arm.qFore.toArray() },
      rspear: { q: fromTo(D_REST, k.d).toArray(), p: fist.sub(GRIP).toArray() },
      _elbow: arm.E, _wrist: arm.W, _reach: k.g.distanceTo(S) / (L1 + L2),
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
