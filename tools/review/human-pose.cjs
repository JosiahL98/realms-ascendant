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
    return { qUpper, qLower: qUpper.clone().invert().multiply(qLowerWorld), qLowerWorld, E, W, reached: toW.length() <= L1 + L2 };
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

  // ============================================================================================== tools, work, attack, death
  // Hands and tools as modelled in human.py: each fist grips at a point just below the wrist; a tool's shaft runs
  // front to back through the fist (local +z towards its head, on the thumb side) and the head's working face (edge,
  // point, striking face, blade) points along the forearm (local -y). The basket's handle runs through the left fist.
  const V3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const GRIP = { R: new THREE.Vector3(-0.003, -0.045, 0.008), L: new THREE.Vector3(0.003, -0.045, 0.008) };
  /** Working point of each tool: distance along the shaft from the grip, and out along the face. */
  const TOOLS = {
    axe: { tip: [0.31, 0.085] }, pick: { tip: [0.36, 0.17] }, hammer: { tip: [0.19, 0.05] },
    hoe: { tip: [0.6, 0.095], h: [0, -0.9, 0.44], f: [0, -0.44, -0.9] },
    spear: { tip: [0.4, 0], butt: 0.55 }, rod: { tip: [0.72, 0.1] }, basket: {},
  };
  // how a tool sits in the right fist (hand frame): the shaft axis towards the head, and the head's face
  const SEAT = { h: new THREE.Vector3(0, 0, 1), f: new THREE.Vector3(0, -1, 0) };
  const seatOf = (tool) => (TOOLS[tool] && TOOLS[tool].h ? { h: V3(TOOLS[tool].h), f: V3(TOOLS[tool].f) } : SEAT);
  const Z = new THREE.Vector3(0, 0, 1);
  const qz = (a) => new THREE.Quaternion().setFromAxisAngle(Z, a);
  const Qof = (o) => (o && o.q ? new THREE.Quaternion().fromArray(o.q) : new THREE.Quaternion());
  const perp = (v, to) => v.clone().addScaledVector(to, -v.dot(to));

  /** World rotation and pivot position of every bone under a pose. */
  function fk(out) {
    const q = {}, p = {};
    for (const b of bones) {
      const lq = Qof(out[b.name]);
      const off = out[b.name] && out[b.name].p ? V(out[b.name].p) : new THREE.Vector3();
      if (!b.parent) {
        q[b.name] = lq;
        p[b.name] = piv[b.name].clone().add(off);
        continue;
      }
      q[b.name] = q[b.parent].clone().multiply(lq);
      p[b.name] = piv[b.name].clone().sub(piv[b.parent]).add(off).applyQuaternion(q[b.parent]).add(p[b.parent]);
    }
    return { q, p };
  }
  /** A world point in bone `name`'s rest (model) frame, and back. */
  const toRest = (W, name, x) => x.clone().sub(W.p[name]).applyQuaternion(W.q[name].clone().invert()).add(piv[name]);
  const fromRest = (W, name, x) => x.clone().sub(piv[name]).applyQuaternion(W.q[name]).add(W.p[name]);

  /** Hand rotation holding a shaft along D (towards the head), with the head's face towards F, for a given seat. */
  function handFrame(D, F, seat = SEAT) {
    const d = D.clone().normalize();
    let f = perp(F, d);
    if (f.lengthSq() < 1e-8) f = perp(new THREE.Vector3(0, -1, 0), d);
    f.normalize();
    const B = new THREE.Matrix4().makeBasis(d, f, new THREE.Vector3().crossVectors(d, f));
    const A = new THREE.Matrix4().makeBasis(seat.h, seat.f, new THREE.Vector3().crossVectors(seat.h, seat.f));
    return new THREE.Quaternion().setFromRotationMatrix(B.multiply(A.transpose()));
  }
  /** Hand rotation for an empty (or basket-holding) hand: knuckles towards `dir`, thumb side towards `fwd`. */
  function handPoint(dir, fwd) {
    const y = dir.clone().normalize().negate();
    let z = perp(fwd, y);
    if (z.lengthSq() < 1e-8) z = perp(Z, y);
    z.normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z));
  }

  /** Pelvis and trunk: hips dropped, shifted and turned; the trunk leaning, twisting and bending sideways. */
  function setBody(out, b) {
    out.hips = { q: qy(b.yaw || 0).multiply(qx(b.tilt || 0)).toArray(), p: [b.sway || 0, -(b.drop || 0), b.fwd || 0] };
    out.torso = { q: qy(b.twist || 0).multiply(qx(b.lean || 0)).multiply(qz(b.bend || 0)).toArray() };
  }

  // the underside of the shoe, from the ankle: heel back and bottom, sole, toe bottom and tip
  const SOLE = [[0, -0.036, -0.046], [0, -0.052, -0.02], [0, -0.052, 0.03], [0, -0.052, 0.07], [0, -0.038, 0.094]]
    .map((a) => new THREE.Vector3(...a));
  const ankleHeight = (pitch) => ANKLE_Y - 0.052 - Math.min(...SOLE.map((v) => v.clone().applyQuaternion(qx(pitch)).y)) + (pitch > 0.5 ? 0.002 : 0);
  const KNEE_R = opts.kneeR ?? 0.036;   // knee joint to the front of the kneecap

  /** Legs by IK to feet planted at (x, z) (turned by yaw, toes down by pitch), or kneeling with the knee on the ground. */
  function plantFeet(out, feet, diag) {
    const W = fk(out);
    const qH = W.q.hips, qHi = qH.clone().invert();
    for (const leg of legs) {
      const f = feet[leg.side];
      const yaw = f.yaw || 0, pitch = f.pitch || 0;
      let ankle;
      if (f.kneel) {
        // the thigh drops from the hip to the knee on the ground; the shin runs back to the foot, resting on its toes
        const Hw = W.p['leg' + leg.side];
        const L1 = leg.K.distanceTo(leg.H), L2 = leg.A.distanceTo(leg.K);
        const kz = Hw.z + Math.sqrt(Math.max(0, L1 * L1 - (Hw.y - KNEE_R) ** 2));
        const ay = ankleHeight(pitch);
        ankle = new THREE.Vector3(f.x, ay, kz - Math.sqrt(Math.max(0, L2 * L2 - (ay - KNEE_R) ** 2)));
      } else ankle = new THREE.Vector3(f.x, ankleHeight(pitch), f.z);
      const pole = (f.pole ? V3(f.pole) : new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))).applyQuaternion(qHi);
      const ik = twoBone(leg.H, leg.K, leg.A, toRest(W, 'hips', ankle), pole);
      out['leg' + leg.side] = { q: ik.qUpper.toArray() };
      out['knee' + leg.side] = { q: ik.qLower.toArray() };
      const shinWorld = qH.clone().multiply(ik.qLowerWorld);
      out['foot' + leg.side] = { q: shinWorld.invert().multiply(qy(yaw).multiply(qx(pitch))).toArray() };
      if (diag) diag.push({ what: 'leg' + leg.side, reached: ik.reached });
    }
  }

  // the trunk as an ellipsoid (rest frame) that elbows and forearms keep out of
  const TRUNK = { c: new THREE.Vector3(0, 0.6, 0.0), r: new THREE.Vector3(0.108, 0.17, 0.09) };
  const inTrunk = (p, pad = 0) => {
    const d = p.clone().sub(TRUNK.c).divide(TRUNK.r.clone().addScalar(pad));
    return Math.max(0, 1 - d.lengthSq());
  };
  // the neck and jaw, which an arm crossing the body passes in front of (allowing for the arm's thickness)
  const NECK = { c: new THREE.Vector3(0, 0.795, 0.015), r: 0.11 };
  const inNeck = (p) => Math.max(0, 1 - p.distanceToSquared(NECK.c) / (NECK.r * NECK.r));

  /**
   * Arm by IK so the fist grips at `grip` with the hand turned to handQ (world). The elbow may swing up to 75 degrees
   * either way about the shoulder-to-wrist line from the preferred `pole`: it takes the way that keeps the wrist
   * straightest and the elbow and forearm clear of the trunk, as a real arm would.
   */
  function reach(out, side, grip, handQ, pole, diag) {
    const arm = arms.find((a) => a.side === side);
    const W = fk(out);
    const qT = W.q.torso, qTi = qT.clone().invert();
    const wrist = grip.clone().sub(GRIP[side].clone().applyQuaternion(handQ));
    const target = toRest(W, 'torso', wrist);
    const axis = target.clone().sub(arm.S).normalize();
    const pole0 = pole.clone().normalize().applyQuaternion(qTi);
    const handAxis = GRIP[side].clone().normalize().applyQuaternion(handQ);
    let best = null;
    for (let deg = -75; deg <= 75; deg += 15) {
      const a = (deg * Math.PI) / 180;
      const ik = twoBone(arm.S, arm.E, arm.W, target, pole0.clone().applyAxisAngle(axis, a));
      const foreWorld = qT.clone().multiply(ik.qLowerWorld);
      const fore = arm.W.clone().sub(arm.E).normalize().applyQuaternion(foreWorld);
      const bend = handAxis.angleTo(fore);
      // the forearm is about 3 cm thick
      const clash = inTrunk(ik.E, 0.03) + inTrunk(ik.E.clone().lerp(ik.W, 0.5), 0.028) + inTrunk(ik.W, 0.022)
        + inNeck(arm.S.clone().lerp(ik.E, 0.4)) + inNeck(arm.S.clone().lerp(ik.E, 0.75)) + inNeck(ik.E) + inNeck(ik.E.clone().lerp(ik.W, 0.5));
      // elbows hang: one raised above the shoulder-to-hand line is a strain unless the hands are overhead too
      const winged = Math.max(0, ik.E.y - (arm.S.y + target.y) / 2 - 0.02);
      const cost = bend + 0.35 * Math.abs(a) + 4 * clash + 12 * winged;
      if (!best || cost < best.cost) best = { cost, ik, foreWorld, fore, bend };
    }
    const { ik, foreWorld, fore, bend, cost } = best;
    out['arm' + side] = { q: ik.qUpper.toArray() };
    out['elbow' + side] = { q: ik.qLower.toArray() };
    out['hand' + side] = { q: foreWorld.clone().invert().multiply(handQ).toArray() };
    if (diag) diag.push({ what: 'arm' + side, reached: ik.reached, miss: ik.W.distanceTo(target), bend, cost });
    return fore;
  }

  /**
   * Grip a shaft at `grip` along D. With a face direction F the head's face is set (a blade must lead); without one,
   * the hand rolls about the shaft so the wrist stays as straight as it can.
   */
  function gripShaft(out, side, grip, D, F, pole, diag, seat = SEAT) {
    if (F) return reach(out, side, grip, handFrame(D, F, seat), pole, diag);
    // free roll about the shaft: take the roll that leaves the wrist straightest
    const d = D.clone().normalize();
    const f0 = perp(new THREE.Vector3(0, -1, 0), d).normalize();
    let best = null;
    for (let i = 0; i < 12; i++) {
      const f = f0.clone().applyAxisAngle(d, (i / 12) * Math.PI * 2);
      const tmp = [];
      reach(out, side, grip, handFrame(d, f, seat), pole, tmp);
      if (!best || tmp[0].cost < best.cost) best = { f, cost: tmp[0].cost };
    }
    return reach(out, side, grip, handFrame(d, best.f, seat), pole, diag);
  }

  /** Head turned and tipped to look at a point (within what a neck allows). */
  function look(out, point, amount = 1) {
    const W = fk(out);
    const eye = fromRest(W, 'head', piv.head.clone().add(new THREE.Vector3(0, 0.09, 0.06)));
    const d = point.clone().sub(eye).applyQuaternion(W.q.torso.clone().invert());
    const yaw = clamp(Math.atan2(d.x, d.z), -0.9, 0.9) * amount;
    const pitch = clamp(Math.atan2(-d.y, Math.hypot(d.x, d.z)), -0.35, 0.6) * amount;
    out.head = { q: qy(yaw).multiply(qx(pitch)).toArray() };
  }

  /**
   * Keyframe track: keys are [u, { field: number | [x, y, z], ... }] for u in 0..1; values are joined by a Hermite
   * spline with Catmull-Rom tangents (smooth through the keys), except that a key with `stop` is reached at rest (a
   * blow landing). Cyclic tracks wrap around from the last key to the first.
   */
  function track(keys, cyclic) {
    const K = cyclic ? [...keys, [1, keys[0][1]]] : keys;
    const n = K.length;
    return (u) => {
      u = cyclic ? frac(u) : clamp(u, 0, 1);
      let i = 0;
      while (i < n - 2 && u > K[i + 1][0]) i++;
      const [u0, a] = K[i], [u1, b] = K[i + 1];
      const h = u1 - u0, s = h > 0 ? clamp((u - u0) / h, 0, 1) : 1;
      const prev = i > 0 ? K[i - 1] : cyclic ? [K[n - 2][0] - 1, K[n - 2][1]] : K[i];
      const next = i + 2 < n ? K[i + 2] : cyclic ? [K[1][0] + 1, K[1][1]] : K[i + 1];
      const s2 = s * s, s3 = s2 * s;
      const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
      const one = (va, vb, vp, vn) => {
        const ma = a.stop || prev === K[i] ? 0 : ((vb - vp) / (u1 - prev[0])) * h;
        const mb = b.stop || next === K[i + 1] ? 0 : ((vn - va) / (next[0] - u0)) * h;
        return h00 * va + h10 * ma + h01 * vb + h11 * mb;
      };
      const res = {};
      for (const k of Object.keys(a)) {
        if (k === 'stop') continue;
        const va = a[k], vb = b[k] ?? va, vp = prev[1][k] ?? va, vn = next[1][k] ?? vb;
        res[k] = Array.isArray(va) ? va.map((x, j) => one(x, vb[j], vp[j], vn[j])) : one(va, vb, vp, vn);
      }
      return res;
    };
  }

  const POLE_R = [-0.7, -1, -0.15], POLE_L = [0.7, -1, -0.15];

  /**
   * Work cycles, in the figure's frame (faces +z; the work is straight ahead). Per key: e = where the tool's working
   * point is (or g = the right grip), d = shaft direction (grip towards head), body (drop, lean, twist, yaw, tilt),
   * elbow poles pr / pl, and for the other hand either the cycle's `left` (a second grip that far along the shaft) or
   * lg / ld (its own grip point and knuckle direction). A swing axis sets the head's face to lead (face = axis x d).
   */
  const WORK = {
    // a diagonal chop from over the right shoulder, down into the front of the trunk
    axe: {
      period: 1.25, axis: [0.87, 0.5, 0], left: 0.11, look: [0.02, 0.32, 0.5],
      feet: { L: { x: 0.075, z: 0.07, yaw: 0.15 }, R: { x: -0.085, z: -0.06, yaw: -0.35 } },
      prop: { kind: 'tree', at: [0.03, 0, 0.54], r: 0.075 },
      keys: [
        [0.0, { e: [-0.02, 0.3, 0.465], d: [0.05, -0.1, 1], drop: 0.035, lean: 0.25, twist: 0.08, yaw: 0, la: 1, pr: POLE_R, pl: POLE_L, stop: 1 }],
        [0.12, { e: [-0.03, 0.36, 0.475], d: [0, 0.05, 1], drop: 0.03, lean: 0.22, twist: 0.05, yaw: 0, la: 1, pr: POLE_R, pl: POLE_L }],
        [0.45, { g: [-0.15, 0.58, 0.14], d: [-0.45, 0.6, 0.66], drop: 0.02, lean: 0.08, twist: -0.25, yaw: -0.1, la: 0.5, pr: [-1, -0.7, -0.2], pl: [0.5, -1, 0.2] }],
        [0.72, { g: [-0.2, 0.66, 0.17], d: [-0.35, 0.6, -0.72], drop: 0.015, lean: -0.05, twist: -0.4, yaw: -0.15, la: 0.35, pr: [-1, -0.2, -0.3], pl: [0.4, -1, 0.4] }],
        [0.88, { g: [-0.13, 0.55, 0.25], d: [-0.1, 0.17, 0.98], drop: 0.025, lean: 0.12, twist: -0.12, yaw: -0.05, la: 0.55, pr: [-1, -0.8, -0.1], pl: [0.5, -1, 0.2] }],
      ],
    },
    // an overhead swing bringing the point down onto the rock in front
    pick: {
      period: 1.35, axis: [1, 0, 0], left: 0.1, look: [0, 0.25, 0.55],
      feet: { L: { x: 0.09, z: 0.04, yaw: 0.2 }, R: { x: -0.09, z: -0.03, yaw: -0.2 } },
      prop: { kind: 'rock', at: [0, 0, 0.64], r: 0.15 },
      keys: [
        [0.0, { e: [-0.04, 0.31, 0.55], d: [0, 0.05, 1], drop: 0.04, lean: 0.4, la: 1, pr: POLE_R, pl: POLE_L, stop: 1 }],
        [0.1, { e: [-0.04, 0.35, 0.54], d: [0, 0.2, 1], drop: 0.035, lean: 0.35, la: 1, pr: POLE_R, pl: POLE_L }],
        [0.42, { g: [-0.15, 0.6, 0.2], d: [-0.3, 0.8, 0.5], drop: 0.025, lean: 0.12, twist: -0.2, la: 0.4, pr: [-1, -0.5, 0], pl: [1, -0.5, 0] }],
        [0.68, { g: [-0.2, 0.67, 0.18], d: [-0.2, 0.75, -0.62], drop: 0.015, lean: 0.02, twist: -0.38, la: 0.3, pr: [-1, 0, 0.2], pl: [1, 0, 0.3] }],
        [0.87, { g: [-0.12, 0.55, 0.32], d: [-0.05, 0.55, 0.83], drop: 0.03, lean: 0.22, twist: -0.12, la: 0.5, pr: [-1, -0.6, 0], pl: [1, -0.6, 0] }],
      ],
    },
    // kneeling on the right knee, driving a peg held in the left hand
    hammer: {
      period: 0.75, axis: [1, 0, 0], look: [-0.09, 0.14, 0.37],
      feet: { L: { x: 0.13, z: 0.15, yaw: 0.3 }, R: { x: -0.07, kneel: true, pitch: 1.2 } },
      prop: { kind: 'beam', at: [-0.09, 0, 0.4] },
      keys: [
        [0.0, { e: [-0.09, 0.18, 0.37], d: [0.1, 0, 1], drop: 0.24, lean: 0.45, tilt: 0.15, lg: [-0.045, 0.15, 0.36], ld: [0, -0.6, 0.8], pr: [-1, -0.35, -0.1], pl: POLE_L, stop: 1 }],
        [0.15, { e: [-0.095, 0.22, 0.41], d: [0.1, 0.3, 0.95], drop: 0.24, lean: 0.44, tilt: 0.15, lg: [-0.045, 0.15, 0.36], ld: [0, -0.6, 0.8], pr: [-1, -0.35, -0.1], pl: POLE_L }],
        [0.6, { g: [-0.17, 0.35, 0.23], d: [-0.2, 0.8, 0.55], drop: 0.24, lean: 0.4, tilt: 0.15, lg: [-0.045, 0.15, 0.36], ld: [0, -0.6, 0.8], pr: [-1, -0.6, -0.2], pl: POLE_L }],
        [0.85, { g: [-0.16, 0.29, 0.27], d: [-0.05, 0.4, 0.9], drop: 0.24, lean: 0.43, tilt: 0.15, lg: [-0.045, 0.15, 0.36], ld: [0, -0.6, 0.8], pr: [-1, -0.35, -0.1], pl: POLE_L }],
      ],
    },
    // the hoe raised in front and brought down into the soil, then drawn back
    hoe: {
      period: 1.5, axis: [1, 0, 0], left: 0.15, look: [-0.06, 0, 0.64],
      feet: { L: { x: 0.08, z: 0.03, yaw: 0.1 }, R: { x: -0.075, z: -0.06, yaw: -0.2 } },
      prop: { kind: 'soil', at: [0, 0, 0.6] },
      keys: [
        [0.0, { e: [-0.07, -0.005, 0.66], d: [0, -0.5, 0.87], drop: 0.03, lean: 0.42, twist: -0.05, pr: POLE_R, pl: POLE_L, stop: 1 }],
        [0.22, { e: [-0.07, 0.0, 0.62], d: [0, -0.56, 0.83], drop: 0.03, lean: 0.36, twist: -0.05, pr: POLE_R, pl: POLE_L, stop: 1 }],
        [0.52, { g: [-0.09, 0.56, 0.2], d: [0, 0.12, 0.99], drop: 0.022, lean: 0.14, twist: -0.05, pr: POLE_R, pl: POLE_L }],
        [0.72, { g: [-0.09, 0.66, 0.2], d: [0, 0.4, 0.92], drop: 0.02, lean: 0.08, twist: -0.05, pr: [-1, -0.7, 0], pl: [1, -0.7, 0] }],
        [0.88, { g: [-0.09, 0.52, 0.22], d: [0, -0.1, 1], drop: 0.025, lean: 0.24, twist: -0.05, pr: POLE_R, pl: POLE_L }],
      ],
    },
    // basket held out in the left hand; the right hand picks from the bush and drops into the basket
    basket: {
      period: 1.8, look: null,
      feet: { L: { x: 0.08, z: 0.03, yaw: 0.15 }, R: { x: -0.08, z: 0.0, yaw: -0.15 } },
      prop: { kind: 'bush', at: [-0.03, 0, 0.5], r: 0.13 },
      keys: [
        [0.0, { rg: [0.1, 0.5, 0.25], rd: [0.4, -0.9, 0.1], drop: 0.03, lean: 0.28, twist: 0.05, lg: [0.18, 0.5, 0.17], ld: [0, -1, 0.05], pr: POLE_R, pl: [1, -1, -0.3], lk: [0.15, 0.42, 0.2] }],
        [0.3, { rg: [-0.03, 0.42, 0.37], rd: [0, -0.4, 0.9], drop: 0.035, lean: 0.33, twist: -0.1, lg: [0.18, 0.5, 0.17], ld: [0, -1, 0.05], pr: POLE_R, pl: [1, -1, -0.3], lk: [-0.03, 0.38, 0.47] }],
        [0.4, { rg: [-0.02, 0.4, 0.39], rd: [0.1, -0.5, 0.85], drop: 0.035, lean: 0.34, twist: -0.1, lg: [0.18, 0.5, 0.17], ld: [0, -1, 0.05], pr: POLE_R, pl: [1, -1, -0.3], lk: [-0.03, 0.38, 0.47] }],
        [0.5, { rg: [-0.045, 0.43, 0.36], rd: [-0.1, -0.3, 0.95], drop: 0.035, lean: 0.33, twist: -0.1, lg: [0.18, 0.5, 0.17], ld: [0, -1, 0.05], pr: POLE_R, pl: [1, -1, -0.3], lk: [-0.03, 0.38, 0.47] }],
        [0.6, { rg: [-0.02, 0.41, 0.38], rd: [0, -0.45, 0.9], drop: 0.035, lean: 0.34, twist: -0.1, lg: [0.18, 0.5, 0.17], ld: [0, -1, 0.05], pr: POLE_R, pl: [1, -1, -0.3], lk: [-0.03, 0.38, 0.47] }],
        [0.88, { rg: [0.1, 0.5, 0.25], rd: [0.4, -0.9, 0.1], drop: 0.03, lean: 0.28, twist: 0.05, lg: [0.18, 0.5, 0.17], ld: [0, -1, 0.05], pr: POLE_R, pl: [1, -1, -0.3], lk: [0.15, 0.42, 0.2] }],
      ],
    },
    // butchering: kneeling by the carcass, the spear planted in the right hand, the left hand at work
    spear: {
      period: 2.0, look: [0.04, 0.08, 0.32],
      feet: { L: { x: 0.07, kneel: true, pitch: 1.2 }, R: { x: -0.12, z: 0.15, yaw: -0.3 } },
      prop: { kind: 'carcass', at: [0.0, 0, 0.36] },
      keys: [
        [0.0, { g: [-0.2, 0.47, 0.1], d: [0, 0.85, -0.53], drop: 0.24, lean: 0.55, tilt: 0.2, lg: [0.04, 0.1, 0.33], ld: [0, -0.8, 0.6], pr: POLE_R, pl: POLE_L }],
        [0.3, { g: [-0.2, 0.47, 0.1], d: [0, 0.85, -0.53], drop: 0.24, lean: 0.53, tilt: 0.2, lg: [0.07, 0.16, 0.29], ld: [0, -0.6, 0.8], pr: POLE_R, pl: POLE_L }],
        [0.5, { g: [-0.2, 0.47, 0.1], d: [0, 0.85, -0.53], drop: 0.24, lean: 0.56, tilt: 0.2, lg: [0.02, 0.1, 0.35], ld: [0, -0.8, 0.6], pr: POLE_R, pl: POLE_L }],
        [0.75, { g: [-0.2, 0.47, 0.1], d: [0, 0.85, -0.53], drop: 0.24, lean: 0.54, tilt: 0.2, lg: [0.07, 0.15, 0.3], ld: [0, -0.6, 0.8], pr: POLE_R, pl: POLE_L }],
      ],
    },
    // standing at the water's edge with the rod out; now and then a tug
    rod: {
      period: 5, left: 0.12, look: [0, 0, 0.9],
      feet: { L: { x: 0.08, z: 0.03, yaw: 0.1 }, R: { x: -0.08, z: -0.02, yaw: -0.1 } },
      prop: { kind: 'water', at: [0, 0, 0.35] },
      keys: [
        [0.0, { g: [-0.05, 0.5, 0.17], d: [0.05, 0.5, 0.86], drop: 0.01, lean: 0.06, bob: [0.03, 0.005, 1.25], pr: POLE_R, pl: POLE_L }],
        [0.3, { g: [-0.05, 0.49, 0.17], d: [0.05, 0.46, 0.88], drop: 0.01, lean: 0.07, bob: [0.03, 0.005, 1.25], pr: POLE_R, pl: POLE_L }],
        [0.6, { g: [-0.05, 0.5, 0.17], d: [0.05, 0.5, 0.86], drop: 0.01, lean: 0.06, bob: [0.03, 0.005, 1.25], pr: POLE_R, pl: POLE_L }],
        [0.68, { g: [-0.05, 0.56, 0.15], d: [0.05, 0.85, 0.52], drop: 0.01, lean: 0.0, bob: [0.03, 0.01, 1.12], pr: POLE_R, pl: POLE_L }],
        [0.8, { g: [-0.05, 0.52, 0.16], d: [0.05, 0.55, 0.83], drop: 0.01, lean: 0.05, bob: [0.03, 0.005, 1.22], pr: POLE_R, pl: POLE_L }],
      ],
    },
  };
  WORK.none = WORK.hammer;
  for (const [name, w] of Object.entries(WORK)) {
    for (const [, k] of w.keys) {
      if (!k.e) continue;
      const D = V3(k.d).normalize();
      const F = w.axis ? new THREE.Vector3().crossVectors(V3(w.axis), D).normalize() : perp(new THREE.Vector3(0, -1, 0), D).normalize();
      const tip = TOOLS[name].tip;
      k.g = V3(k.e).addScaledVector(D, -tip[0]).addScaledVector(F, -tip[1]).toArray();
      delete k.e;
    }
    w.sample = w.sample || track(w.keys, true);
  }

  /** Tools carried when standing or walking, in the trunk's frame: short tools head forward and down at the side,
   *  the spear sloped up like a staff, the hoe held upright at the shoulder, the rod pointing ahead with its line hanging. */
  const HOLD = {
    axe: { g: [-0.15, 0.4, 0.07], d: [0, -0.55, 0.83] },
    pick: { g: [-0.15, 0.4, 0.07], d: [0, -0.5, 0.86] },
    hammer: { g: [-0.165, 0.4, 0.08], d: [0, -0.55, 0.83] },
    hoe: { g: [-0.17, 0.64, 0.12], d: [-0.05, 0.95, 0.3] },
    spear: { g: [-0.15, 0.5, 0.1], d: [0, 0.8, 0.6] },
    rod: { g: [-0.15, 0.45, 0.1], d: [0, 0.55, 0.83] },
    basket: { g: [0.2, 0.42, 0.04], d: [0, -1, 0.05], side: 'L' },
  };

  /** Place the hands from a sampled key: the right on the tool (or empty), the left on the same shaft or on its own. */
  function placeHands(out, k, tool, diag) {
    const T = TOOLS[tool] || TOOLS.hammer;
    if (k.rg) reach(out, 'R', V3(k.rg), handPoint(V3(k.rd), Z), V3(k.pr || POLE_R), diag);
    else {
      const D = V3(k.d).normalize();
      const F = k.axis ? new THREE.Vector3().crossVectors(V3(k.axis), D).normalize() : null;
      let G = k.g ? V3(k.g) : null;
      if (!G) {
        // the grip, back from the working point along the shaft and the face
        const f = F || perp(new THREE.Vector3(0, -1, 0), D).normalize();
        G = V3(k.e).addScaledVector(D, -T.tip[0]).addScaledVector(f, -T.tip[1]);
      }
      gripShaft(out, 'R', G, D, F, V3(k.pr || POLE_R), diag, seatOf(tool));
      // the other hand only wraps the shaft (the right sets the head's face), so it rolls to keep its wrist straight
      if (k.left != null) gripShaft(out, 'L', G.clone().addScaledVector(D, k.left), D, null, V3(k.pl || POLE_L), diag);
    }
    if (k.left == null && k.lg) reach(out, 'L', V3(k.lg), handPoint(V3(k.ld), Z), V3(k.pl || POLE_L), diag);
  }

  /** The rod's line hangs straight down from the tip to the float. */
  function hangLine(out, bob) {
    if (!piv.rodtip) return;
    const W = fk(out);
    out.rodtip = { q: W.q.handR.clone().invert().toArray() };
    const tip = fromRest(W, 'handR', piv.rodtip);
    const B = bob || tip.clone().add(new THREE.Vector3(0, -0.28, 0));
    out.bob = { p: toRest(W, 'root', B).sub(piv.bob).toArray() };
  }

  /**
   * Body and hands for a key. If a hand cannot reach its grip, the trunk turns and bends a little further (the least
   * that works), as a person leans into the work rather than letting go.
   */
  function solveBody(k, feet, place) {
    const attempt = (dt, dl, dd = 0) => {
      const out = {}, diag = [];
      setBody(out, { ...k, twist: (k.twist || 0) + dt, lean: (k.lean || 0) + dl, drop: (k.drop || 0) + dd });
      plantFeet(out, feet, diag);
      place(out, diag);
      const miss = diag.reduce((a, d) => a + (d.miss || 0), 0);
      return { out, diag, miss, cost: miss * 60 + Math.abs(dt) * 0.8 + Math.abs(dl) * 1.2 + dd * 4 };
    };
    let best = attempt(0, 0);
    if (best.miss < 0.001) return best;
    // a knee on the ground must not slide, so a kneeling pose keeps its hip height
    const kneeling = Object.values(feet).some((f) => f.kneel);
    for (const dd of kneeling ? [0] : [0, 0.03, 0.06]) {
      for (let dt = -0.35; dt <= 0.351; dt += 0.07) {
        for (let dl = -0.1; dl <= 0.251; dl += 0.05) {
          const r = attempt(dt, dl, dd);
          if (r.cost < best.cost) best = r;
        }
      }
      if (best.miss < 0.001) break;
    }
    return best;
  }

  function workPose(t, tool) {
    const w = WORK[tool] || WORK.none;
    const k = w.sample(t / w.period);
    const { out, diag } = solveBody(k, w.feet, (o, d) => placeHands(o, { ...k, axis: w.axis, left: w.left }, tool, d));
    const lk = k.lk || w.look;
    if (lk) look(out, V3(lk), k.la ?? 1);
    if (tool === 'rod') hangLine(out, V3(k.bob));
    out.__diag = diag;
    return out;
  }

  // ---------------------------------------------------------------------------------------------- attack
  const ATTACK = 0.9;   // the blow lands half-way through (the game's attack delay for villagers is 0.45 s)
  const FIGHT_FEET = { L: { x: 0.075, z: 0.08, yaw: 0.15 }, R: { x: -0.08, z: -0.06, yaw: -0.3 } };
  const GUARD = [0.14, 0.55, 0.17];
  const attackStrike = track([
    [0.0, { g: [-0.17, 0.5, 0.16], d: [0, 0.95, 0.3], drop: 0.02, lean: 0.05, twist: 0, lg: GUARD, ld: [0, -0.3, 1] }],
    [0.4, { g: [-0.18, 0.85, 0.0], d: [0, 0.2, -1], drop: 0.01, lean: -0.05, twist: -0.3, lg: GUARD, ld: [0, -0.3, 1] }],
    [0.5, { g: [-0.09, 0.45, 0.3], d: [0.1, 0.7, 0.7], drop: 0.035, lean: 0.2, twist: 0.15, lg: [0.12, 0.5, 0.12], ld: [0, -0.5, 0.9], stop: 1 }],
    [0.7, { g: [-0.14, 0.48, 0.22], d: [0, 0.85, 0.5], drop: 0.03, lean: 0.12, twist: 0.05, lg: GUARD, ld: [0, -0.3, 1] }],
    [1.0, { g: [-0.17, 0.5, 0.16], d: [0, 0.95, 0.3], drop: 0.02, lean: 0.05, twist: 0, lg: GUARD, ld: [0, -0.3, 1] }],
  ], false);
  const attackThrust = track([
    [0.0, { g: [-0.17, 0.52, 0.08], d: [0.1, 0.1, 1], drop: 0.02, lean: 0.05, twist: -0.1, lg: GUARD, ld: [0, -0.3, 1] }],
    [0.4, { g: [-0.18, 0.56, -0.04], d: [0.1, 0.08, 1], drop: 0.03, lean: -0.02, twist: -0.25, lg: GUARD, ld: [0, -0.3, 1] }],
    [0.5, { g: [-0.11, 0.53, 0.27], d: [0.1, 0.03, 1], drop: 0.04, lean: 0.2, twist: 0.1, lg: [0.14, 0.52, 0.12], ld: [0, -0.5, 0.9], stop: 1 }],
    [0.7, { g: [-0.14, 0.52, 0.16], d: [0.1, 0.08, 1], drop: 0.03, lean: 0.1, twist: 0, lg: GUARD, ld: [0, -0.3, 1] }],
    [1.0, { g: [-0.17, 0.52, 0.08], d: [0.1, 0.1, 1], drop: 0.02, lean: 0.05, twist: -0.1, lg: GUARD, ld: [0, -0.3, 1] }],
  ], false);

  function attackPose(t, tool) {
    const u = (t % ATTACK) / ATTACK;
    const out = {}, diag = [];
    const spear = tool === 'spear';
    const k = (spear ? attackThrust : attackStrike)(u);
    const solved = solveBody(k, FIGHT_FEET, (o, d) => {
      if (spear) placeHands(o, k, 'spear', d);
      else {
        placeHands(o, { ...k, axis: [1, 0, 0], lg: tool === 'basket' ? null : k.lg }, tool || 'hammer', d);
        if (tool === 'basket') reach(o, 'L', V3([0.18, 0.47, 0.1]), handPoint(V3([0, -1, 0.05]), Z), V3([1, -1, -0.3]), d);
      }
    });
    Object.assign(out, solved.out);
    diag.push(...solved.diag);
    look(out, V3([0, 0.5, 0.6]));
    if (tool === 'rod') hangLine(out);
    out.__diag = diag;
    return out;
  }

  // ---------------------------------------------------------------------------------------------- death
  // The knees give and the trunk slumps; then the body goes over backwards, falling faster and faster, pivoting about a
  // line behind the heels, and lands on its back. The legs are solved to the ground all the way: the feet stay put as the
  // knees give, then drag and straighten as the hips go back, and end resting on their heels with the knees a little up.
  const DIE = { len: 1.3, lift: opts.dieLift ?? 0.043, pivotZ: -0.06, fold: opts.dieFold ?? 0.35 };
  // arms as directions from the shoulder in the trunk's frame (left arm; the right is mirrored)
  const dieTrack = track([
    [0.0, { drop: 0, lean: 0, arm: [0.15, -0.99, -0.08], elbow: 0, head: [0, 0], pitch: 0 }],
    [0.25, { drop: 0.07, lean: 0.3, arm: [0.4, -0.9, 0.2], elbow: 0.3, head: [0.4, 0], pitch: 0 }],
    [0.6, { drop: 0.05, lean: 0.05, arm: [0.6, -0.45, 0.45], elbow: 0.4, head: [-0.3, 0.2], pitch: -0.3 }],
    [0.85, { drop: 0.02, lean: -0.05, arm: [0.85, -0.25, -0.255], elbow: 0.25, head: [0.2, 0.45], pitch: -1.0, stop: 1 }],
    [1.0, { drop: 0.02, lean: -0.05, arm: [0.85, -0.25, -0.26], elbow: 0.25, head: [0.25, 0.5], pitch: -1.0, stop: 1 }],
  ], false);
  /** How far over the body has gone (0 standing, 1 lying): nothing while the knees give, then accelerating. */
  const dieFall = (u) => Math.min(1, Math.max(0, (u - 0.2) / 0.62)) ** 2;

  function diePose(t, tool) {
    const u = clamp(t / DIE.len, 0, 1);
    const k = dieTrack(u), fall = dieFall(u);
    const out = {};
    const R = qx(-fall * Math.PI / 2);
    const P = new THREE.Vector3(0, 0, DIE.pivotZ);
    const pos = P.clone().sub(P.clone().applyQuaternion(R)).add(new THREE.Vector3(0, DIE.lift * fall, 0));
    out.root = { q: R.toArray(), p: pos.toArray() };
    out.hips = { q: qx(0).toArray(), p: [0, -k.drop, 0] };
    out.torso = { q: qx(k.lean).toArray() };
    out.head = { q: qx(k.head[0]).multiply(qy(k.head[1])).toArray() };
    // feet on the ground where they stood, or as far forward as the legs (a little bent) still reach
    const W = fk(out);
    const feet = {};
    for (const leg of legs) {
      const s = leg.side === 'L' ? 1 : -1;
      const Hw = W.p['leg' + leg.side];
      const L = leg.K.distanceTo(leg.H) + leg.A.distanceTo(leg.K);
      const pitch = k.pitch;
      const x = leg.A.x + 0.03 * s * fall;
      const dy = Hw.y - ankleHeight(pitch);
      const reachXZ = Math.sqrt(Math.max(0, (L * (0.995 - 0.08 * fall)) ** 2 - dy * dy - (x - Hw.x) ** 2));
      const z = Math.max(leg.A.z, Math.min(Hw.z + reachXZ, leg.A.z + 0.6));
      feet[leg.side] = { x, z, pitch, yaw: 0.25 * s * fall, pole: [0, fall, 1 - fall * 0.7] };
    }
    plantFeet(out, feet);
    for (const arm of arms) {
      // a shield arm falls wider, so the shield lies clear of the body
      const a = arm.side === 'L' && WEAPON && SHIELD ? [0.97, -0.1, -0.22].map((x, i) => k.arm[i] + (x - k.arm[i]) * fall) : k.arm;
      const dir = V3(a).multiply(new THREE.Vector3(arm.side === 'L' ? 1 : -1, 1, 1));
      out['arm' + arm.side] = { q: fromTo(arm.E.clone().sub(arm.S), dir).toArray() };
      out['elbow' + arm.side] = { q: qx(-k.elbow).toArray() };
    }
    // the hand goes limp and the tool drops flat on the ground beside it, its head face up; a soldier's weapon falls
    // along his side (a long pike laid across him would pass through him)
    if (tool && tool !== 'basket') {
      const W = fk(out);
      const lying = handFrame(V3(tool === 'weapon' ? [-0.2, 0, 1] : [-1, 0, 0.35]), V3([0, 1, 0]), seatOf(tool));
      const local = W.q.elbowR.clone().invert().multiply(lying);
      out.handR = { q: new THREE.Quaternion().slerp(local, ss(0.55, 0.95, fall)).toArray() };
    }
    // a shield-bearer falls from his shield hold: the shield arm blends from the hold into the fall
    if (WEAPON && SHIELD) {
      const held = { ...out };
      // as the knees give, the shield comes up and out, clear of the rising thigh
      holdShield(held, [], true, 0.07 * ss(0.0, 0.2, u));
      const w = ss(0.25, 0.7, u);
      for (const k of ['armL', 'elbowL', 'handL']) {
        const q0 = new THREE.Quaternion().fromArray(held[k].q), q1 = new THREE.Quaternion().fromArray(out[k] ? out[k].q : [0, 0, 0, 1]);
        out[k] = { q: q0.slerp(q1, w).toArray() };
      }
    }
    // a shield falls flat, face up; a bow lies along the ground
    if (WEAPON && (SHIELD || BOW)) {
      const W = fk(out);
      const lying = SHIELD ? handPoint(V3([1, 0, -0.3]), V3([0.3, 0, 1])) : handPoint(V3([1, 0, 0]), V3([0, 0, 1]));
      const local = W.q.elbowL.clone().invert().multiply(lying);
      out.handL = { q: new THREE.Quaternion().slerp(local, ss(0.55, 0.95, fall)).toArray() };
    }
    if (tool === 'rod') hangLine(out);
    // on the ground the cloth no longer swings with the thighs: it lies where the body falls
    // the flared hem would reach below the back, so it folds forward over the thighs
    out.__skirtFollow = SKIRT_FOLLOW * (1 - 0.75 * fall);
    out.__skirtLift = -DIE.fold * fall;
    out.__diag = [];
    return out;
  }

  /** Standing or walking with a tool: the arm holding it takes the carrying pose (with a little swing when walking). */
  function holdTool(out, tool, t, walking) {
    const h = HOLD[tool];
    if (!h) return;
    const W = fk(out);
    const side = h.side || 'R';
    const swing = walking ? 0.03 * Math.cos(2 * Math.PI * t * WALK.freq) * (side === 'R' ? -1 : 1) : 0;
    const g = fromRest(W, 'torso', V3(h.g).add(new THREE.Vector3(0, 0, swing)));
    const D = V3(h.d).applyQuaternion(W.q.torso);
    const diag = out.__diag || (out.__diag = []);
    if (side === 'L') reach(out, 'L', g, handPoint(D, Z.clone().applyQuaternion(W.q.torso)), V3([0.6, -1, -0.3]), diag);
    else gripShaft(out, 'R', g, D, null, V3([-0.4, -1, -0.4]), diag, seatOf(tool));
    if (tool === 'rod') hangLine(out);
  }

  // ============================================================================================== soldiers
  // Soldiers (opts.weapon, opts.shield): the weapon is in the right fist, seated like a tool (the bow is in the left);
  // a shield is held forward on the left arm. Every key gives the right grip g and weapon direction d in the figure's
  // frame, the body, and the left hand: a second grip `left` along the shaft, its own grip lg / ld, or the shield.
  const WEAPON = opts.weapon || null;
  const SHIELD = !!opts.shield;
  /** Working point of each weapon: along the shaft from the grip (tip of blade or point). */
  const WEAPON_TIP = {
    sword: 0.34, greatsword: 0.57, axe: 0.4, spear: 0.85, pike: 1.25, halberd: 1.03, fireLance: 0.85, javelin: 0.55,
    staff: 0.8, crossbow: 0.3, gun: 0.4,
  };
  // the shield on the left forearm, knuckles forward and in, thumb up: the face looks out to the left front
  const SHIELD_HOLD = { lg: [0.16, 0.5, 0.2], ld: [-0.4, 0, 0.9], lu: [0, 1, 0] };

  /** Weapons carried standing or walking, in the trunk's frame. */
  const WEAPON_HOLD = {
    sword: { g: [-0.15, 0.4, 0.07], d: [0, -0.55, 0.83] },
    axe: { g: [-0.15, 0.4, 0.07], d: [0, -0.5, 0.86] },
    greatsword: { g: [-0.17, 0.62, 0.12], d: [-0.05, 0.9, -0.43] },
    spear: { g: [-0.15, 0.5, 0.1], d: [0, 0.8, 0.6] },
    pike: { g: [-0.15, 0.5, 0.1], d: [0, 0.88, 0.47] },
    halberd: { g: [-0.15, 0.5, 0.1], d: [0, 0.88, 0.47] },
    fireLance: { g: [-0.15, 0.5, 0.1], d: [0, 0.8, 0.6] },
    javelin: { g: [-0.15, 0.5, 0.1], d: [0, 0.8, 0.6] },
    staff: { g: [-0.2, 0.5, 0.16], d: [0.12, 0.92, 0.37] },
    crossbow: { g: [-0.15, 0.42, 0.08], d: [0, -0.4, 0.92] },
    gun: { g: [-0.15, 0.5, 0.1], d: [0, 0.85, 0.52] },
    bow: { lg: [0.17, 0.42, 0.06], ld: [0, 0.94, 0.33] },
    longbow: { lg: [0.17, 0.44, 0.06], ld: [0, 0.94, 0.33] },
  };

  const BOW = WEAPON === 'bow' || WEAPON === 'longbow';

  /** The left hand holding the shield (in the trunk's frame when `torso`). */
  function holdShield(out, diag, torso, raise = 0) {
    const W = fk(out);
    const tr = (a) => (torso ? fromRest(W, 'torso', V3(a)) : V3(a));
    const dir = (a) => (torso ? V3(a).applyQuaternion(W.q.torso) : V3(a));
    const lg = [SHIELD_HOLD.lg[0] + raise * 0.5, SHIELD_HOLD.lg[1] + raise, SHIELD_HOLD.lg[2]];
    reach(out, 'L', tr(lg), handPoint(dir(SHIELD_HOLD.ld), dir(SHIELD_HOLD.lu)), V3([0.8, -1, -0.3]), diag);
  }

  /** Standing or walking with the weapon (and shield). */
  function holdWeapon(out, t, walking) {
    const h = WEAPON_HOLD[WEAPON];
    const diag = out.__diag || (out.__diag = []);
    if (!h) return;
    const W = fk(out);
    const swing = walking ? 0.025 * Math.cos(2 * Math.PI * t * WALK.freq) : 0;
    if (h.g) {
      const g = fromRest(W, 'torso', V3(h.g).add(new THREE.Vector3(0, 0, -swing)));
      gripShaft(out, 'R', g, V3(h.d).applyQuaternion(W.q.torso), null, V3([-0.4, -1, -0.4]), diag);
    }
    if (h.lg) {
      const g = fromRest(fk(out), 'torso', V3(h.lg).add(new THREE.Vector3(0, 0, swing)));
      gripShaft(out, 'L', g, V3(h.ld).applyQuaternion(W.q.torso), null, V3([0.6, -1, -0.3]), diag);
    }
    if (SHIELD) holdShield(out, diag, true);
  }

  // attacks: the blow (or shot) lands half-way through, when the game resolves it
  const GUARD_L = [0.14, 0.55, 0.17];
  const ATTACKS = {
    // one hand: an overhead blow
    strike: track([
      [0.0, { g: [-0.17, 0.5, 0.16], d: [0, 0.95, 0.3], drop: 0.02, lean: 0.05, twist: 0 }],
      [0.4, { g: [-0.18, 0.85, 0.0], d: [0, 0.2, -1], drop: 0.01, lean: -0.05, twist: -0.3 }],
      [0.5, { g: [-0.09, 0.47, 0.3], d: [0.1, 0.2, 1], drop: 0.035, lean: 0.2, twist: 0.15, stop: 1 }],
      [0.7, { g: [-0.14, 0.48, 0.22], d: [0, 0.85, 0.5], drop: 0.03, lean: 0.12, twist: 0.05 }],
      [1.0, { g: [-0.17, 0.5, 0.16], d: [0, 0.95, 0.3], drop: 0.02, lean: 0.05, twist: 0 }],
    ], false),
    // one hand: a thrust from the hip
    thrust: track([
      [0.0, { g: [-0.17, 0.52, 0.08], d: [0.1, 0.1, 1], drop: 0.02, lean: 0.05, twist: -0.1 }],
      [0.4, { g: [-0.18, 0.56, -0.04], d: [0.1, 0.08, 1], drop: 0.03, lean: -0.02, twist: -0.25 }],
      [0.5, { g: [-0.11, 0.53, 0.27], d: [0.1, 0.03, 1], drop: 0.04, lean: 0.2, twist: 0.1, stop: 1 }],
      [0.7, { g: [-0.14, 0.52, 0.16], d: [0.1, 0.08, 1], drop: 0.03, lean: 0.1, twist: 0 }],
      [1.0, { g: [-0.17, 0.52, 0.08], d: [0.1, 0.1, 1], drop: 0.02, lean: 0.05, twist: -0.1 }],
    ], false),
    // two hands: a long thrust (pike, fire lance)
    lunge: track([
      [0.0, { g: [-0.14, 0.5, 0.0], d: [0.08, 0.06, 1], drop: 0.03, lean: 0.08, twist: -0.2 }],
      [0.4, { g: [-0.15, 0.52, -0.1], d: [0.08, 0.06, 1], drop: 0.035, lean: 0.0, twist: -0.3 }],
      [0.5, { g: [-0.11, 0.52, 0.16], d: [0.08, 0.02, 1], drop: 0.035, lean: 0.2, twist: -0.05, stop: 1 }],
      [0.7, { g: [-0.13, 0.51, 0.06], d: [0.08, 0.05, 1], drop: 0.04, lean: 0.12, twist: -0.15 }],
      [1.0, { g: [-0.14, 0.5, 0.0], d: [0.08, 0.06, 1], drop: 0.03, lean: 0.08, twist: -0.2 }],
    ], false),
    // two hands: a chop from over the right shoulder (halberd, great sword)
    chop: track([
      [0.0, { g: [-0.12, 0.5, 0.2], d: [0, 0.88, 0.47], drop: 0.02, lean: 0.05, twist: 0 }],
      [0.4, { g: [-0.2, 0.67, 0.14], d: [-0.3, 0.7, -0.64], drop: 0.015, lean: -0.02, twist: -0.38 }],
      [0.5, { g: [-0.06, 0.47, 0.3], d: [0.3, -0.05, 0.95], drop: 0.04, lean: 0.25, twist: 0.1, stop: 1 }],
      [0.7, { g: [-0.08, 0.47, 0.26], d: [0.4, 0.3, 0.86], drop: 0.035, lean: 0.18, twist: 0.05 }],
      [1.0, { g: [-0.12, 0.5, 0.2], d: [0, 0.88, 0.47], drop: 0.02, lean: 0.05, twist: 0 }],
    ], false),
    // two hands wide on a pole: a chop from over the right shoulder (halberd)
    polechop: track([
      [0.0, { g: [-0.13, 0.48, 0.12], d: [0.05, 0.9, 0.43], drop: 0.02, lean: 0.05, twist: 0 }],
      [0.4, { g: [-0.16, 0.62, 0.16], d: [-0.1, 0.85, -0.5], drop: 0.015, lean: -0.02, twist: -0.3 }],
      [0.5, { g: [-0.1, 0.5, 0.16], d: [0.15, 0.2, 0.97], drop: 0.04, lean: 0.25, twist: 0.1, stop: 1 }],
      [0.7, { g: [-0.11, 0.49, 0.15], d: [0.1, 0.5, 0.86], drop: 0.035, lean: 0.18, twist: 0.05 }],
      [1.0, { g: [-0.13, 0.48, 0.12], d: [0.05, 0.9, 0.43], drop: 0.02, lean: 0.05, twist: 0 }],
    ], false),
    // a throw (javelin)
    throw: track([
      [0.0, { g: [-0.19, 0.55, 0.12], d: [0.1, 0.5, 0.86], drop: 0.02, lean: 0.03, twist: 0, lg: [0.14, 0.55, 0.2], ld: [0, -0.2, 1] }],
      [0.4, { g: [-0.24, 0.82, -0.08], d: [0.15, 0.25, 0.96], drop: 0.02, lean: -0.08, twist: -0.4, lg: [0.16, 0.72, 0.28], ld: [0, 0, 1] }],
      [0.5, { g: [-0.12, 0.76, 0.26], d: [0.05, 0.2, 0.98], drop: 0.04, lean: 0.15, twist: 0.2, lg: [0.16, 0.55, 0.1], ld: [0, -0.5, 0.8], stop: 1 }],
      [0.7, { g: [-0.12, 0.6, 0.26], d: [0.1, 0.5, 0.86], drop: 0.035, lean: 0.2, twist: 0.15, lg: [0.15, 0.52, 0.12], ld: [0, -0.5, 0.8] }],
      [1.0, { g: [-0.19, 0.55, 0.12], d: [0.1, 0.5, 0.86], drop: 0.02, lean: 0.03, twist: 0, lg: [0.14, 0.55, 0.2], ld: [0, -0.2, 1] }],
    ], false),
    // aim and shoot (crossbow, hand cannon): the butt at the front of the shoulder, the left hand under the stock
    aim: track([
      [0.0, { g: [-0.15, 0.45, 0.12], d: [0, -0.3, 0.95], drop: 0.02, lean: 0.03, twist: 0 }],
      [0.3, { g: [-0.11, 0.64, 0.24], d: [0.08, 0.02, 1], drop: 0.03, lean: 0.06, twist: -0.12 }],
      [0.5, { g: [-0.11, 0.65, 0.24], d: [0.08, 0.02, 1], drop: 0.03, lean: 0.06, twist: -0.12, stop: 1 }],
      [0.58, { g: [-0.11, 0.66, 0.21], d: [0.08, 0.14, 0.99], drop: 0.03, lean: 0.02, twist: -0.12 }],
      [0.85, { g: [-0.13, 0.52, 0.16], d: [0, -0.2, 0.98], drop: 0.02, lean: 0.03, twist: 0 }],
      [1.0, { g: [-0.15, 0.45, 0.12], d: [0, -0.3, 0.95], drop: 0.02, lean: 0.03, twist: 0 }],
    ], false),
    // draw and loose (bow): the left arm holds the bow out, the right hand draws the string to the cheek
    draw: track([
      [0.0, { lg: [0.16, 0.45, 0.12], ld: [0, 0.94, 0.33], rg: [-0.14, 0.45, 0.1], rd: [0, -1, 0.2], nock: 0, drop: 0.02, lean: 0.02, twist: 0 }],
      [0.25, { lg: [0.07, 0.72, 0.36], ld: [0, 1, 0.08], rg: [0.03, 0.73, 0.3], rd: [0.2, -0.2, 1], nock: 1, drop: 0.03, lean: 0.03, twist: -0.55 }],
      [0.47, { lg: [0.07, 0.73, 0.37], ld: [0, 1, 0.06], rg: [-0.08, 0.77, 0.06], rd: [0.5, -0.1, 0.85], nock: 1, drop: 0.03, lean: 0.02, twist: -0.6 }],
      [0.5, { lg: [0.07, 0.73, 0.37], ld: [0, 1, 0.06], rg: [-0.1, 0.78, 0.02], rd: [0.5, -0.1, 0.85], nock: 0, drop: 0.03, lean: 0.02, twist: -0.6, stop: 1 }],
      [0.8, { lg: [0.12, 0.55, 0.22], ld: [0, 0.96, 0.25], rg: [-0.12, 0.5, 0.14], rd: [0, -1, 0.3], nock: 0, drop: 0.02, lean: 0.02, twist: -0.2 }],
      [1.0, { lg: [0.16, 0.45, 0.12], ld: [0, 0.94, 0.33], rg: [-0.14, 0.45, 0.1], rd: [0, -1, 0.2], nock: 0, drop: 0.02, lean: 0.02, twist: 0 }],
    ], false),
  };
  const ATTACK_KIND = {
    sword: 'strike', axe: 'strike', spear: 'thrust', javelin: 'throw', pike: 'lunge', fireLance: 'lunge',
    halberd: 'polechop', greatsword: 'chop', crossbow: 'aim', gun: 'aim', bow: 'draw', longbow: 'draw', staff: 'strike',
  };
  // second grip along the shaft for two-handed weapons
  const LEFT_ON_SHAFT = { lunge: 0.26, chop: 0.09, polechop: 0.2, aim: 0.12 };

  /** The bowstring's middle follows the drawing hand (nock = 1) or rests (0). */
  function setNock(out, k) {
    if (!piv.nock) return;
    const W = fk(out);
    const rest = piv.nock;
    let p = new THREE.Vector3();
    if (k.nock > 0) {
      const grip = fromRest(W, 'handR', piv.handR.clone().add(GRIP.R));
      p = toRest(W, 'handL', grip).sub(rest).multiplyScalar(Math.min(1, k.nock));
    }
    out.nock = { p: p.toArray() };
  }

  function weaponAttack(t) {
    // a shield-bearer keeps the shield up and thrusts one-handed, even with a pike
    let kind = ATTACK_KIND[WEAPON] || 'strike';
    if (SHIELD && kind === 'lunge') kind = 'thrust';
    const u = (t % ATTACK) / ATTACK;
    const k = ATTACKS[kind](u);
    const solved = solveBody(k, FIGHT_FEET, (o, d) => {
      if (kind === 'draw') {
        gripShaft(o, 'L', V3(k.lg), V3(k.ld), null, V3([0.6, -1, -0.2]), d);
        reach(o, 'R', V3(k.rg), handPoint(V3(k.rd), V3([0, 1, 0])), V3([-1, -0.3, -0.5]), d);
        return;
      }
      const D = V3(k.d).normalize();
      gripShaft(o, 'R', V3(k.g), D, kind === 'strike' || kind === 'chop' || kind === 'polechop' ? new THREE.Vector3(1, 0, 0).cross(D) : null, V3(POLE_R), d);
      if (LEFT_ON_SHAFT[kind]) gripShaft(o, 'L', V3(k.g).addScaledVector(D, LEFT_ON_SHAFT[kind]), D, null, V3([0.7, -1, 0.1]), d);
      else if (SHIELD) holdShield(o, d, false);
      else if (k.lg) reach(o, 'L', V3(k.lg), handPoint(V3(k.ld), Z), V3(POLE_L), d);
      else reach(o, 'L', V3(GUARD_L), handPoint(V3([0, -0.3, 1]), Z), V3(POLE_L), d);
    });
    const out = solved.out;
    if (kind === 'draw') setNock(out, k);
    look(out, V3([0, 0.55, 0.8]));
    out.__diag = solved.diag;
    return out;
  }

  /** The priest at work (healing, converting): the staff raised, the other hand held out. */
  const PRAY = track([
    [0.0, { g: [-0.2, 0.6, 0.22], d: [0.12, 0.94, 0.3], lg: [0.14, 0.72, 0.3], ld: [0, 0.4, 1], drop: 0.0, lean: -0.03 }],
    [0.5, { g: [-0.2, 0.64, 0.24], d: [0.12, 0.96, 0.22], lg: [0.13, 0.76, 0.32], ld: [0, 0.5, 1], drop: 0.0, lean: -0.06 }],
  ], true);
  function prayPose(t) {
    const k = PRAY((t % 2.4) / 2.4);
    const solved = solveBody(k, { L: { x: 0.07, z: 0.02, yaw: 0.1 }, R: { x: -0.07, z: -0.02, yaw: -0.1 } }, (o, d) => {
      gripShaft(o, 'R', V3(k.g), V3(k.d), null, V3([-0.7, -1, -0.2]), d);
      reach(o, 'L', V3(k.lg), handPoint(V3(k.ld), V3([0, 1, 0])), V3([0.8, -1, -0.2]), d);
    });
    look(solved.out, V3([0, 0.7, 1]));
    solved.out.__diag = solved.diag;
    return solved.out;
  }

  /** The skirt on each side follows its thigh part of the way (cloth hangs; it is only pushed by the leg). */
  const SKIRT_FOLLOW = opts.skirtFollow ?? 0.7;
  // the hem (height and radius at rest, from the model) is kept off the ground: a long dress bunches up when kneeling
  const HEM = opts.hem;
  function addSkirt(out) {
    for (const side of ['L', 'R']) {
      const leg = out['leg' + side];
      const q = leg && leg.q ? new THREE.Quaternion().fromArray(leg.q) : new THREE.Quaternion();
      // a thigh raised far forward (kneeling, a deep lean) carries the cloth with it more; a walking stride does not
      const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
      const base = out.__skirtFollow ?? SKIRT_FOLLOW;
      const follow = new THREE.Quaternion().slerp(q, base + (1 - base) * ss(0.55, 1.1, angle) * (out.__skirtFollow == null ? 1 : 0));
      out['skirt' + side] = { q: (out.__skirtLift ? qx(out.__skirtLift).multiply(follow) : follow).toArray() };
    }
    if (HEM) {
      const W = fk(out);
      for (const side of ['L', 'R']) {
        const s = side === 'L' ? 1 : -1;
        let low = Infinity;
        for (let i = 0; i <= 8; i++) {
          const a = (i / 8) * Math.PI;
          const p = new THREE.Vector3(s * Math.sin(a) * HEM.r, HEM.y, Math.cos(a) * HEM.r);
          low = Math.min(low, fromRest(W, 'skirt' + side, p).y);
        }
        if (low < 0.006) {
          const up = new THREE.Vector3(0, 0.006 - low, 0).applyQuaternion(W.q.hips.clone().invert());
          out['skirt' + side].p = up.toArray();
        }
      }
    }
    return out;
  }

  /**
   * anim: 'idle' | 'walk' | 'work' | 'attack' | 'die'; carry: a load is held in front of the chest (the tool is put
   * away); tool: 'axe' | 'pick' | 'hammer' | 'hoe' | 'spear' | 'rod' | 'basket' | null (the job, for 'work').
   */
  const memo = new Map();
  function pose(anim, t, carry = false, tool = null) {
    const cyc = anim === 'work' ? (WEAPON ? 2.4 : (WORK[tool] || WORK.none).period) : anim === 'attack' ? ATTACK : 0;
    const key = cyc ? `${anim}|${tool}|${Math.round(((t % cyc) + cyc) % cyc * 240)}` : null;
    if (key && memo.has(key)) return memo.get(key);
    const res = poseNow(anim, t, carry, tool);
    if (key) memo.set(key, res);
    return res;
  }
  function poseNow(anim, t, carry, tool) {
    let out;
    if (WEAPON) {
      // soldiers (and the priest)
      if (anim === 'work') out = prayPose(t);
      else if (anim === 'attack') out = weaponAttack(t);
      else if (anim === 'die') out = diePose(t, BOW ? null : 'weapon');
      else {
        out = anim === 'walk' ? walkPose(t, carry) : idlePose(t, carry);
        if (!carry) holdWeapon(out, t, anim === 'walk');
      }
      return addSkirt(out);
    }
    if (anim === 'work') out = workPose(t, tool);
    else if (anim === 'attack') out = attackPose(t, tool);
    else if (anim === 'die') out = diePose(t, carry ? null : tool);
    else {
      out = anim === 'walk' ? walkPose(t, carry) : idlePose(t, carry);
      if (tool && !carry) holdTool(out, tool, t, anim === 'walk');
    }
    return addSkirt(out);
  }

  return { pose, WALK, WORK, TOOLS, ATTACK, DIE, fk };
}

if (typeof module !== 'undefined') module.exports = { makeHumanPose };
