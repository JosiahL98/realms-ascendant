// Standing-human poses (villagers): idle, walk and carry. Legs use two-bone IK with planted feet, knees bending
// forward and the heel rolling onto the toe at push-off; arms swing opposite the legs, or hold a load in front.
// Works in the figure's rest frame (faces +z, left is +x). Returns bone -> { q: [x, y, z, w], p: [x, y, z] }.

function makeHumanPose(THREE, bones, opts = {}) {
  const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const piv = Object.fromEntries(bones.map((b) => [b.name, V(b.pivot)]));
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
  const fromTo = (a, b) => new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), b.clone().normalize());
  const qx = (a) => new THREE.Quaternion().setFromAxisAngle(X, a);
  const qy = (a) => new THREE.Quaternion().setFromAxisAngle(Y, a);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const frac = (x) => x - Math.floor(x);

  const HIPS = piv.hips;
  const ANKLE_Y = piv.footL.y;
  const TOE = 0.075;                 // ankle to toe tip, along the foot
  const legs = ['L', 'R'].map((side) => ({
    side, H: piv['leg' + side], K: piv['knee' + side], A: piv['foot' + side],
  }));
  const arms = ['L', 'R'].map((side) => ({
    side, S: piv['arm' + side], E: piv['elbow' + side], W: piv['hand' + side],
  }));

  /** Two-bone IK in the parent's frame: rotations of the upper segment and of the lower one relative to it. */
  function twoBone(S, E0, W0, target, pole) {
    const L1 = E0.distanceTo(S), L2 = W0.distanceTo(E0);
    const toW = target.clone().sub(S);
    const d = clamp(toW.length(), Math.abs(L1 - L2) + 1e-4, L1 + L2 - 1e-4);
    const u = toW.clone().normalize();
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const v = pole.clone().addScaledVector(u, -pole.dot(u)).normalize();
    const E = S.clone().addScaledVector(u, a).addScaledVector(v, h);
    const W = S.clone().addScaledVector(u, d);
    const qUpper = fromTo(E0.clone().sub(S), E.clone().sub(S));
    const lowerRest = W0.clone().sub(E0).applyQuaternion(qUpper);
    const qLowerWorld = fromTo(lowerRest, W.clone().sub(E)).multiply(qUpper);
    return { qUpper, qLower: qUpper.clone().invert().multiply(qLowerWorld), qLowerWorld, W, reached: toW.length() <= L1 + L2 };
  }

  // ---------------------------------------------------------------------------------------------- walking
  const WALK = { speed: opts.speed ?? 0.8, stride: 0.5, duty: 0.6, lift: 0.045, drop: 0.022 };
  WALK.freq = WALK.speed / WALK.stride;

  /** Ankle target (hips-independent, rest frame) and foot pitch for one leg at stride phase ph. */
  function footTarget(leg, ph) {
    const g = WALK;
    const s = (g.stride * g.duty) / 2;
    const u = frac(ph + (leg.side === 'L' ? 0 : 0.5));
    const z0 = leg.A.z;
    if (u < g.duty) {
      // planted: moves back at ground speed; the heel lifts at the end of stance (push-off)
      const k = u / g.duty;
      return { z: z0 + s * (1 - 2 * k) + 0.01, y: ANKLE_Y, pitch: 0, roll: ss(0.72, 1.0, k), stance: true };
    }
    const w = (u - g.duty) / (1 - g.duty);
    return {
      z: z0 - s + 2 * s * ss(0.0, 0.9, w) + 0.01,
      y: ANKLE_Y + g.lift * Math.sin(Math.PI * Math.min(1, w * 1.1)),
      pitch: -0.35 * Math.sin(Math.PI * w) + 0.25 * ss(0.8, 1, w),   // toe down after push-off, then up for heel strike
      roll: 0, stance: false,
    };
  }

  function walkPose(t, carry) {
    const out = {};
    const ph = t * WALK.freq;
    // pelvis: slightly lower than standing so the legs reach the ends of the stride; a gentle bob and turn
    const bob = 0.006 * Math.cos(4 * Math.PI * ph);
    const turn = 0.07 * Math.sin(2 * Math.PI * ph);
    const hipsOff = new THREE.Vector3(0, -WALK.drop + bob, 0);
    out.hips = { q: qy(turn).toArray(), p: hipsOff.toArray() };
    const qHips = qy(turn);
    const toHips = (w) => w.clone().sub(HIPS).sub(hipsOff).applyQuaternion(qHips.clone().invert()).add(HIPS);
    for (const leg of legs) {
      const f = footTarget(leg, ph);
      // heel roll: the foot pivots about the toe, raising the ankle
      const rollAngle = f.roll * 0.5;
      const ankleW = new THREE.Vector3(leg.A.x, f.y + Math.sin(rollAngle) * TOE, f.z - (1 - Math.cos(rollAngle)) * TOE);
      const target = toHips(ankleW);
      const ik = twoBone(leg.H, leg.K, leg.A, target, new THREE.Vector3(0, 0, 1));
      out['leg' + leg.side] = { q: ik.qUpper.toArray() };
      out['knee' + leg.side] = { q: ik.qLower.toArray() };
      // foot orientation in the world: flat in stance (tipping onto the toe at push-off), pitched in swing
      const footWorld = qHips.clone().multiply(qx(f.stance ? rollAngle : f.pitch));
      const shinWorld = qHips.clone().multiply(ik.qLowerWorld);
      out['foot' + leg.side] = { q: shinWorld.invert().multiply(footWorld).toArray() };
    }
    // torso counter-turns against the pelvis; the head keeps looking ahead
    out.torso = { q: qy(-turn * 1.6).multiply(qx(carry ? -0.04 : 0.03)).toArray() };
    out.head = { q: qy(turn * 0.6).toArray() };
    if (carry) Object.assign(out, carryArms());
    else {
      for (const arm of arms) {
        const sgn = arm.side === 'L' ? 1 : -1;
        const swing = 0.38 * Math.cos(2 * Math.PI * ph) * sgn;      // left arm back when the left foot is forward
        out['arm' + arm.side] = { q: qx(swing).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.06 * sgn)).toArray() };
        out['elbow' + arm.side] = { q: qx(-0.22 - 0.25 * Math.max(0, -swing)).toArray() };
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------- carrying
  /** Arms around the load in front of the chest (the carry bone): hands under its ends, elbows down and out. */
  function carryArms() {
    const out = {};
    const C = piv.carry;
    for (const arm of arms) {
      const sgn = arm.side === 'L' ? 1 : -1;
      const hand = C.clone().add(new THREE.Vector3(0.1 * sgn, -0.05, -0.02));
      // the hand bone's pivot is the wrist; the palm sits 4-5 cm beyond it
      const wrist = hand.clone().add(new THREE.Vector3(0.012 * sgn, 0.02, -0.04));
      const ik = twoBone(arm.S, arm.E, arm.W, wrist, new THREE.Vector3(0.9 * sgn, -1, -0.3));
      out['arm' + arm.side] = { q: ik.qUpper.toArray() };
      out['elbow' + arm.side] = { q: ik.qLower.toArray() };
      // palm turned up under the load
      out['hand' + arm.side] = { q: qx(-0.9).toArray() };
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------- idle
  function idlePose(t, carry) {
    const breathe = Math.sin(t * 1.7);
    const out = {
      torso: { q: qx(0.015 * breathe).toArray() },
      head: { q: qy(0.35 * Math.sin(t * 0.37) * Math.max(0, Math.sin(t * 0.21))).multiply(qx(0.03 * Math.sin(t * 0.5))).toArray() },
      hips: { q: qy(0).toArray(), p: [0.004 * Math.sin(t * 0.4), 0, 0] },
    };
    if (carry) Object.assign(out, carryArms());
    else {
      out.armL = { q: qx(-0.02 * breathe).toArray() };
      out.armR = { q: qx(-0.02 * breathe).toArray() };
      out.elbowL = { q: qx(-0.12).toArray() };
      out.elbowR = { q: qx(-0.12).toArray() };
    }
    return out;
  }

  /** The skirt on each side follows its thigh part of the way (cloth hangs; it is only pushed by the leg). */
  const SKIRT_FOLLOW = opts.skirtFollow ?? 0.7;
  function addSkirt(out) {
    for (const side of ['L', 'R']) {
      const leg = out['leg' + side];
      const q = leg && leg.q ? new THREE.Quaternion().fromArray(leg.q) : new THREE.Quaternion();
      out['skirt' + side] = { q: new THREE.Quaternion().slerp(q, SKIRT_FOLLOW).toArray() };
    }
    return out;
  }

  /** anim: 'idle' | 'walk'; carry: a load is held in front of the chest. */
  function pose(anim, t, carry = false) {
    return addSkirt(anim === 'walk' ? walkPose(t, carry) : idlePose(t, carry));
  }

  return { pose, WALK };
}

if (typeof module !== 'undefined') module.exports = { makeHumanPose };
