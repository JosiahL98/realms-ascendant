// Cavalry rider poses: the spear is its own bone (child of the torso) moved through key poses; the right arm reaches
// its grip by two-bone IK with an elbow pole. Works in the rider's rest frame (horse faces +z, rider's right is -x).
// Returns bone -> { q: [x, y, z, w] (local rotation), p: [x, y, z] (local position offset) }.

const ATTACK_PERIOD = 1.5;
/** Elbow direction of the modelled rest pose (must match elbow_ik's pole for the right arm in rider.py). */
const HOLD_POLE = [-0.6, -1, -0.35];

function makeRiderPose(THREE, bones, tune = {}) {
  const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const piv = Object.fromEntries(bones.map((b) => [b.name, V(b.pivot)]));
  const S = piv.rarmR, E0 = piv.relbowR, W0 = piv.rhandR, GRIP = piv.rspear;
  const L1 = E0.distanceTo(S), L2 = W0.distanceTo(E0);
  const LEFT = { S: piv.rarmL, E0: piv.relbowL, W0: piv.rhandL, pole: V([1, -0.12, -0.25]) };   // must match the left elbow_ik pole in rider.py
  const T = piv.rtorso;
  const D_REST = new THREE.Vector3(0.03, 1.0, -0.12).normalize();   // spear direction as modelled
  const ident = new THREE.Quaternion();
  const fromTo = (a, b) => new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), b.clone().normalize());
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const ease = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };

  // Key poses of the right hand's grip G and spear direction D, in the torso's rest frame, like a real thrust: the spear
  // comes down from upright to level at his side, he draws the hand back with the elbow sliding back past his ribs,
  // then drives it forward, straightening the arm and turning the shoulder into the blow. Elbow poles stay natural:
  // down and a little out, drifting back on the draw and forward on the thrust. Directions are set in the horse's
  // frame (straight ahead, turned very slightly towards the centre) and turned into the torso's frame for each key's
  // body twist.
  const Y = new THREE.Vector3(0, 1, 0);
  const inTorso = (w, twist) => w.clone().applyAxisAngle(Y, -twist);
  const LEVEL_DIR = V([tune.yaw ?? -0.072, tune.pitch ?? -0.008, 1]).normalize();
  const HOLD = { g: GRIP.clone(), d: D_REST.clone(), pole: V(HOLD_POLE), twist: 0 };
  const lvl = (g, pole, twist, flex) => ({ g: V(g), d: inTorso(LEVEL_DIR, twist), pole: V(pole), twist, flex });
  // levelled at the hip (a low guard): the forearm angles down to the fist, so the shaft crosses it there instead of
  // running along it
  // halfway down the point is at 45 degrees, with the elbow well out so the butt swings past inside it
  const LOWER = {
    g: V(tune.lowerG || [-0.29, 0.95, 0.14]), d: inTorso(V([LEVEL_DIR.x, 1, 1]).normalize(), -0.04),
    pole: V(tune.lowerPole || [-1.039, -0.172, 0.077]), twist: -0.04, flex: tune.lowerFlex ?? 0.3,
  };
  const LEVEL = lvl(tune.levelG || [-0.207, 0.878, 0.07], tune.levelPole || [-1, -0.7, -0.3], -0.06, tune.levelFlex ?? 0.5);
  const BACK = lvl(tune.backG || [-0.22, 0.9, -0.02], tune.backPole || [-1, -0.6, -0.5], -0.18, tune.backFlex ?? 0.7);
  const THRUST = lvl(tune.thrustG || [-0.176, 0.958, 0.228], tune.thrustPole || [-0.747, -0.696, 0.41], 0.16, tune.thrustFlex ?? 0.8);
  // time (fraction of the attack) -> key
  const TRACK = [[0, HOLD], [0.11, LOWER], [0.22, LEVEL], [0.4, BACK], [0.5, THRUST], [0.62, THRUST], [0.8, LEVEL],
    [0.9, LOWER], [1.0, HOLD]];

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
      flex: (a.flex || 0) + ((b.flex || 0) - (a.flex || 0)) * k,
    };
  }

  /** Two-bone IK: rotations of the upper arm (relative to the torso) and forearm (relative to the upper arm). */
  function solveArm(W, pole, arm = { S, E0, W0 }) {
    const { S, E0, W0 } = arm;
    const L1 = E0.distanceTo(S), L2 = W0.distanceTo(E0);
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

  /**
   * Right arm and spear for grip G and direction D. The wrist flexes by k.flex (radians, palm-down), which drops the
   * fist below the line of the forearm so a levelled shaft passes underneath it, as a real wrist does.
   */
  function rightArm(k) {
    const qWrist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), k.flex || 0);
    const fistRest = GRIP.clone().sub(W0);
    let arm = null, qFW = ident.clone();
    for (let i = 0; i < 6; i++) {
      const qHandWorld = qFW.clone().multiply(qWrist);
      const W = k.g.clone().sub(fistRest.clone().applyQuaternion(qHandWorld));
      arm = solveArm(W, k.pole);
      qFW = arm.qForeWorld;
    }
    // if the grip was out of reach the arm stops short: the spear goes where the fist actually is
    const fist = arm.W.clone().add(fistRest.applyQuaternion(qFW.clone().multiply(qWrist)));
    return {
      rarmR: { q: arm.qUpper.toArray() },
      relbowR: { q: arm.qFore.toArray() },
      rhandR: { q: qWrist.toArray() },
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
    // the left hand rests on the saddle's front horn and turns with the body (the twist is small, so it only
    // slides a little along the horn)
    const qT = new THREE.Quaternion().setFromEuler(new THREE.Euler(gait ? 0.02 * sway : 0, k.twist, 0));
    out.rtorso = { q: qT.toArray() };
    // the head keeps facing forward while the shoulders turn; at rest it looks about now and then
    const look = gait || act === 'attack' ? 0 : 0.3 * Math.sin(t * 0.45);
    out.rhead = { q: new THREE.Quaternion().setFromEuler(new THREE.Euler(gait ? -0.015 * sway : 0, -0.85 * k.twist + look, 0)).toArray() };

    return out;
  }

  return { pose, sample, ATTACK_PERIOD };
}

if (typeof module !== 'undefined') module.exports = { makeRiderPose, ATTACK_PERIOD };
