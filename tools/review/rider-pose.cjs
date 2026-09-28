// Cavalry rider poses: the weapon (spear or sword) is its own bone (child of the torso) moved through key poses, and
// the right arm reaches its grip by two-bone IK with an elbow pole. A bow is its own bone too, held by the left arm
// (IK), with the string skinned to a 'nock' bone the right hand draws back. Works in the rider's rest frame (horse
// faces +z, rider's right is -x).
// Returns bone -> { q: [x, y, z, w] (local rotation), p: [x, y, z] (local position offset) }.

const ATTACK_PERIOD = 1.5;
/** Elbow direction of the modelled rest pose (must match elbow_ik's pole for the right arm in rider.py). */
const HOLD_POLE = [-0.6, -1, -0.35];

/**
 * kit: the export's kit ({ weapon, poles, fist, bow }); without one, the scout's spear.
 */
function makeRiderPose(THREE, bones, tune = {}, kit = null) {
  const V = (a) => (a.isVector3 ? a.clone() : new THREE.Vector3(a[0], a[1], a[2]));
  const piv = Object.fromEntries(bones.map((b) => [b.name, V(b.pivot)]));
  const weapon = kit ? kit.weapon : 'spear';
  const S = piv.rarmR, E0 = piv.relbowR, W0 = piv.rhandR;
  const WB = piv.rweapon ? 'rweapon' : 'rspear';
  const GRIP = piv[WB] || (kit && kit.fist ? V(kit.fist.R) : W0.clone());
  const L1 = E0.distanceTo(S), L2 = W0.distanceTo(E0);
  const RIGHT = { S, E0, W0 };
  const LEFT = { S: piv.rarmL, E0: piv.relbowL, W0: piv.rhandL };
  const T = piv.rtorso;
  const LEFT_POLE = V(kit && kit.poles ? kit.poles.L : [1, -0.12, -0.25]);   // the left elbow_ik pole in rider.py
  const D_REST = new THREE.Vector3(0.03, 1.0, -0.12).normalize();   // spear (sword) direction as modelled
  const ident = new THREE.Quaternion();
  const fromTo = (a, b) => new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), b.clone().normalize());
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const ease = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };

  const Y = new THREE.Vector3(0, 1, 0);
  const inTorso = (w, twist) => w.clone().applyAxisAngle(Y, -twist);
  const LEVEL_DIR = V([tune.yaw ?? -0.072, tune.pitch ?? -0.008, 1]).normalize();
  const HOLD = { g: GRIP.clone(), d: D_REST.clone(), pole: V(kit && kit.poles ? kit.poles.R : HOLD_POLE), twist: 0 };
  let TRACK;
  if (weapon === 'spear') {
    // Key poses of the right hand's grip G and spear direction D, in the torso's rest frame, like a real thrust: the
    // spear comes down from upright to level at his side, he draws the hand back with the elbow sliding back past his
    // ribs, then drives it forward, straightening the arm and turning the shoulder into the blow. Elbow poles stay
    // natural: down and a little out, drifting back on the draw and forward on the thrust. Directions are set in the
    // horse's frame (straight ahead, turned very slightly towards the centre) and turned into the torso's frame for
    // each key's body twist.
    const lvl = (g, pole, twist, flex) => ({ g: V(g), d: inTorso(LEVEL_DIR, twist), pole: V(pole), twist, flex });
    // halfway down the point is at 45 degrees, with the elbow well out so the butt swings past inside it
    const LOWER = {
      g: V(tune.lowerG || [-0.29, 0.95, 0.14]), d: inTorso(V([LEVEL_DIR.x, 1, 1]).normalize(), -0.04),
      pole: V(tune.lowerPole || [-1.039, -0.172, 0.077]), twist: -0.04, flex: tune.lowerFlex ?? 0.3,
    };
    const LEVEL = lvl(tune.levelG || [-0.207, 0.878, 0.07], tune.levelPole || [-1, -0.7, -0.3], -0.06, tune.levelFlex ?? 0.5);
    const BACK = lvl(tune.backG || [-0.22, 0.9, -0.02], tune.backPole || [-1, -0.6, -0.5], -0.18, tune.backFlex ?? 0.7);
    const THRUST = lvl(tune.thrustG || [-0.176, 0.958, 0.228], tune.thrustPole || [-0.747, -0.696, 0.41], 0.16, tune.thrustFlex ?? 0.8);
    TRACK = [[0, HOLD], [0.11, LOWER], [0.22, LEVEL], [0.4, BACK], [0.5, THRUST], [0.62, THRUST], [0.8, LEVEL],
      [0.9, LOWER], [1.0, HOLD]];
  } else {
    // A cut on the right side: the sword goes up and back over the right shoulder as the shoulders turn away, then
    // comes down and forward past the horse's shoulder, the body turning into the blow, and follows through low
    // and outward before coming back up to the hold.
    const key = (g, d, pole, twist, flex = 0) => ({ g: V(g), d: V(d).normalize(), pole: V(pole), twist, flex });
    const RAISE = key(tune.raiseG || [-0.22, 1.3, -0.04], [-0.25, 0.6, -0.8], [-1, 0.2, -0.6], -0.22);
    const HIGH = key(tune.highG || [-0.3, 1.25, 0.05], [-0.4, 0.9, 0.15], [-1, 0.0, -0.4], -0.05);
    // at the end of the cut the wrist is bent, so the blade stands off the line of the forearm
    const CUT = key(tune.cutG || [-0.25, 1.04, 0.2], tune.cutD || [-0.4, -0.6, 0.7], [-1, -0.5, 0.15], 0.16, tune.cutFlex ?? 0.3);
    const FOLLOW = key(tune.followG || [-0.28, 0.95, 0.1], tune.followD || [-0.6, -0.8, 0.1], [-1, -0.6, -0.1], 0.1, 0.3);
    const RETURN = key([-0.28, 1.0, 0.1], [-0.25, 0.8, 0.3], [-1, -0.5, -0.3], 0.03);
    TRACK = [[0, HOLD], [0.25, RAISE], [0.38, HIGH], [0.5, CUT], [0.6, FOLLOW], [0.8, RETURN], [1.0, HOLD]];
  }

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
  function solveArm(W, pole, arm = RIGHT) {
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
    return { qUpper, qFore, qForeWorld, E, W: Wc, miss: toW.length() - d };
  }

  /**
   * An arm whose hand keeps its rest shape and bends only at the wrist by `flex` (palm-down), placing the point
   * `fist` (rest position) at `target`.
   */
  function reachWith(arm, fist, target, pole, flex = 0) {
    const qWrist = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), flex);
    const fistRest = fist.clone().sub(arm.W0);
    let sol = null, qFW = ident.clone();
    for (let i = 0; i < 6; i++) {
      const qHandWorld = qFW.clone().multiply(qWrist);
      const W = target.clone().sub(fistRest.clone().applyQuaternion(qHandWorld));
      sol = solveArm(W, pole, arm);
      qFW = sol.qForeWorld;
    }
    // if the target was out of reach the arm stops short: what it holds goes where the fist actually is
    sol.fist = sol.W.clone().add(fistRest.applyQuaternion(qFW.clone().multiply(qWrist)));
    sol.qWrist = qWrist;
    return sol;
  }

  /**
   * Right arm and weapon for grip G and direction D. The wrist flexes by k.flex (radians, palm-down), which drops the
   * fist below the line of the forearm so a levelled shaft passes underneath it, as a real wrist does.
   */
  function rightArm(k) {
    const arm = reachWith(RIGHT, GRIP, k.g, k.pole, k.flex || 0);
    return {
      rarmR: { q: arm.qUpper.toArray() },
      relbowR: { q: arm.qFore.toArray() },
      rhandR: { q: arm.qWrist.toArray() },
      [WB]: { q: fromTo(D_REST, k.d).toArray(), p: arm.fist.clone().sub(GRIP).toArray() },
      _elbow: arm.E, _wrist: arm.W, _reach: k.g.distanceTo(S) / (L1 + L2), _miss: arm.miss,
    };
  }

  // ---------------------------------------------------------------------------------------- the bow
  // Keys in the torso's frame: the bow's grip, the stave's direction (upper limb) and the right hand's position;
  // `draw` is how far the string follows the right hand (0: at rest). He raises the bow in front and a little to the
  // left, cants it, draws to under the right jaw with the shoulders turned to the right so the arrow points ahead
  // (over the horse's head, a little to its left), looses, and lowers the bow again.
  let BOW = null;
  if (weapon === 'bow') {
    const U0 = V(kit.bow.U).normalize(), B0 = V(kit.bow.B).normalize();
    const G0 = piv.rbow, N0 = piv.nock, FR = V(kit.fist.R), FL = V(kit.fist.L);
    const frame = (u, b) => {
      const U = u.clone().normalize();
      const B = b.clone().addScaledVector(U, -b.dot(U)).normalize();
      const m = new THREE.Matrix4().makeBasis(U, B, U.clone().cross(B));
      return new THREE.Quaternion().setFromRotationMatrix(m);
    };
    const q0inv = frame(U0, B0).invert();
    const bowQ = (u, b) => frame(u, b).multiply(q0inv);   // rest -> this orientation
    const key = (g, u, a, draw, twist, poleL, poleR) => ({ g: V(g), u: V(u).normalize(), a: V(a), draw, twist, poleL: V(poleL), poleR: V(poleR) });
    const REST = { g: G0.clone(), u: U0.clone(), a: FR.clone(), draw: 0, twist: 0, poleL: V(kit.poles.L), poleR: V(kit.poles.R) };
    const RG = V(tune.raiseG || [0.11, 1.13, 0.28]);
    const RU = V([-0.2, 1, 0.1]).normalize();
    const ANCHOR = V(tune.anchor || [-0.1, 1.2, 0.02]);
    const FG = V(tune.fullG || [0.1, 1.19, 0.27]);
    const FU = V([-0.25, 1, 0.05]).normalize();
    // at the raise the right hand is on the string, where it rests
    const stringAt = (g, u) => {
      const toward = ANCHOR.clone().sub(g);
      const B = toward.addScaledVector(u, -toward.dot(u)).normalize();
      return g.clone().addScaledVector(B, N0.distanceTo(G0)).addScaledVector(u, 0.045);   // nocked just above the grip
    };
    // reaching for the string the right elbow is out to the side, so the forearm passes in front of the chest;
    // drawing, it comes round behind at shoulder height, clear of the head
    const RAISE = key(RG, RU, stringAt(RG, RU), 1, -0.3, [0.4, -1, -0.1], tune.raisePoleR || [-1, -0.2, 0.4]);
    const FULL = key(FG, FU, ANCHOR, 1, -0.45, [0.5, -1, 0.0], tune.fullPoleR || [-0.7, 0.05, -1]);
    const LOOSE = key(FG, FU, ANCHOR.clone().add(V([-0.07, 0.02, -0.04])), 0, -0.45, [0.5, -1, 0.0], [-0.8, 0.05, -1]);
    const DOWN = key([0.12, 1.08, 0.25], [0.3, 1, 0.1], [-0.12, 1.05, 0.14], 0, -0.2, [0.6, -1, -0.2], [-1, -0.3, -0.3]);
    // on the way to the string the right hand passes above the left forearm
    // the bow lifts off the right hand before the hand moves (and settles back on it last)
    const LIFTED = { ...REST, g: G0.clone().add(V([0.0, 0.1, 0.04])) };
    const TRACK_B = [[0, REST], [0.07, LIFTED], [0.16, { ...REST, a: FR.clone().lerp(stringAt(RG, RU), 0.5).add(V(tune.reachOff || [-0.03, 0.07, -0.02])), g: G0.clone().lerp(RG, 0.5), u: U0.clone().lerp(RU, 0.5).normalize(), twist: -0.15, poleL: RAISE.poleL.clone().lerp(REST.poleL, 0.5), poleR: RAISE.poleR.clone().lerp(REST.poleR, 0.5) }],
      [0.26, RAISE], [0.46, FULL], [0.5, FULL], [0.53, LOOSE], [0.72, DOWN], [0.9, LIFTED], [1.0, REST]];
    const sampleB = (u) => {
      let i = 0;
      while (i < TRACK_B.length - 2 && u > TRACK_B[i + 1][0]) i++;
      const [t0, a] = TRACK_B[i], [t1, b] = TRACK_B[i + 1];
      const k = t1 - t0 < 0.05 ? clamp01((u - t0) / (t1 - t0)) : ease((u - t0) / (t1 - t0));   // the string snaps back
      const L = (x, y) => x.clone().lerp(y, k);
      return { g: L(a.g, b.g), u: L(a.u, b.u).normalize(), a: L(a.a, b.a), draw: a.draw + (b.draw - a.draw) * k,
        twist: a.twist + (b.twist - a.twist) * k, poleL: L(a.poleL, b.poleL).normalize(), poleR: L(a.poleR, b.poleR).normalize() };
    };
    const bowPose = (k) => {
      // the string side faces the right hand (or, at rest, the rider)
      const toward = k.draw > 0 || k.a.distanceTo(FR) > 0.02 ? k.a.clone().sub(k.g) : B0.clone();
      const restB = B0.clone(), wantB = toward.addScaledVector(k.u, -toward.dot(k.u)).normalize();
      const blend = clamp01(k.g.distanceTo(G0) / 0.05);
      const B = restB.lerp(wantB, blend).normalize();
      const qBow = bowQ(k.u, B);
      // left hand: turns with the bow, its wrist placed so the fist closes on the grip
      const wristL = k.g.clone().sub(G0.clone().sub(LEFT.W0).applyQuaternion(qBow));
      const left = solveArm(wristL, k.poleL, LEFT);
      const qHandL = left.qForeWorld.clone().invert().multiply(qBow);
      const bowAt = left.W.clone().add(G0.clone().sub(LEFT.W0).applyQuaternion(qBow));   // where the grip really is
      // right hand: its palm to the string (or its rest on the horn)
      const right = reachWith(RIGHT, FR, k.a, k.poleR, 0);
      const nockRest = N0.clone().sub(G0);
      const nockWorld = bowAt.clone().add(nockRest.clone().applyQuaternion(qBow)).lerp(right.fist, k.draw);
      const nockLocal = nockWorld.sub(bowAt).applyQuaternion(qBow.clone().invert()).sub(nockRest);
      return {
        rarmL: { q: left.qUpper.toArray() }, relbowL: { q: left.qFore.toArray() }, rhandL: { q: qHandL.toArray() },
        rarmR: { q: right.qUpper.toArray() }, relbowR: { q: right.qFore.toArray() }, rhandR: { q: ident.toArray() },
        rbow: { q: qBow.toArray(), p: bowAt.clone().sub(G0).toArray() },
        nock: { q: ident.toArray(), p: nockLocal.toArray() },
        _missL: left.miss, _missR: right.miss,
      };
    };
    BOW = { sampleB, bowPose, REST };
  }

  /**
   * act: 'hold' | 'attack'; t: seconds; gait: null or { freq } for a little sway with the horse.
   */
  function pose(act, t, gait) {
    const sway = gait ? Math.sin(2 * Math.PI * t * gait.freq * 2) : 0;
    let out, twist, headK = 0.85;
    if (BOW) {
      const k = act === 'attack' ? BOW.sampleB((t % ATTACK_PERIOD) / ATTACK_PERIOD) : BOW.REST;
      out = BOW.bowPose(k);
      twist = k.twist;
      headK = 0.8;   // he looks along the arrow
    } else {
      const k = act === 'attack' ? sample((t % ATTACK_PERIOD) / ATTACK_PERIOD) : HOLD;
      out = rightArm(k);
      twist = k.twist;
    }
    // the left hand rests on the saddle's front horn and turns with the body (the twist is small, so it only
    // slides a little along the horn)
    const qT = new THREE.Quaternion().setFromEuler(new THREE.Euler(gait ? 0.02 * sway : 0, twist, 0));
    out.rtorso = { q: qT.toArray() };
    if (!BOW && twist !== 0) {
      // the rein hand stays on the horn while the shoulders turn: the arm reaches back to where the wrist rests
      const qTi = qT.clone().invert();
      const wrist = LEFT.W0.clone().sub(T).applyQuaternion(qTi).add(T);
      const left = solveArm(wrist, LEFT_POLE, LEFT);
      out.rarmL = { q: left.qUpper.toArray() };
      out.relbowL = { q: left.qFore.toArray() };
      out.rhandL = { q: left.qForeWorld.clone().invert().multiply(qTi).toArray() };
    }
    // the head keeps facing forward while the shoulders turn; at rest it looks about now and then
    const look = gait || act === 'attack' ? 0 : 0.3 * Math.sin(t * 0.45);
    out.rhead = { q: new THREE.Quaternion().setFromEuler(new THREE.Euler(gait ? -0.015 * sway : 0, -headK * twist + look, 0)).toArray() };

    return out;
  }

  return { pose, sample, ATTACK_PERIOD, weapon };
}

if (typeof module !== 'undefined') module.exports = { makeRiderPose, ATTACK_PERIOD };
