// Horse gait solver: planted hooves, two-bone leg IK, body height and pitch from leg reach.
// Angles are rotations about x ("θ-space": 0 = pointing straight down, positive = swung backward).

const GAITS = {
  walk: {
    label: 'Walk', speed: 0.6, freq: 1.1, duty: 0.62, touch: { BL: 0.0, FL: 0.25, BR: 0.5, FR: 0.75 },
    liftF: 0.08, liftB: 0.065, flexF: 0.8, flexB: 0.65, cap: 0.0, nod: [0.07, 2, 0.15], tail: [0.05, 0.08],
    caption: 'Four beats: left hind, left fore, right hind, right fore. Two or three hooves are always on the ground.',
    note: 'Slow pace, 0.6 tiles a second',
  },
  trot: {
    label: 'Trot', speed: 1.35, freq: 1.5, duty: 0.42, touch: { BL: 0.0, FR: 0.02, BR: 0.5, FL: 0.52 },
    liftF: 0.19, liftB: 0.14, flexF: 1.4, flexB: 1.0, cap: 0.012, nod: [0.025, 2, 0.1], tail: [0.18, 0.06],
    caption: 'Two beats: diagonal pairs land together, with a moment of suspension between them.',
    note: 'Knight speed, 1.35 tiles a second',
  },
  canter: {
    label: 'Canter', speed: 1.55, freq: 1.5, duty: 0.36, touch: { BL: 0.0, BR: 0.16, FL: 0.2, FR: 0.47 },
    liftF: 0.2, liftB: 0.15, flexF: 1.45, flexB: 1.05, cap: 0.04, nod: [0.13, 1, 0.55], tail: [0.35, 0.07],
    caption: 'Three beats on the right lead: left hind, then right hind with left fore, then the leading right fore, then all four hooves in the air.',
    note: 'Scout speed, 1.55 tiles a second',
  },
};

const frac = (x) => x - Math.floor(x);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** Remaps w so that `peak` lands in the middle; used to skew bumps earlier or later. */
const skew = (w, peak) => (w < peak ? 0.5 * w / peak : 0.5 + 0.5 * (w - peak) / (1 - peak));
/** Smooth minimum that never goes below the true minimum (errs upward by at most eps). */
const smin = (a, b, eps = 0.003) => (a + b) / 2 - Math.sqrt(((a - b) / 2) ** 2 + eps * eps) + eps;
const ang = (from, to) => Math.atan2(-(to.z - from.z), -(to.y - from.y));
/** Most a foreleg's top may slide up into the shoulder. */
const SLING = 0.06;

function makeHorseGait(bones) {
  const piv = {};
  for (const b of bones) piv[b.name] = { y: b.pivot[1], z: b.pivot[2] };
  const P = piv.body;
  const legs = ['FL', 'FR', 'BL', 'BR'].map((k) => {
    const A = piv['leg' + k], B = piv['leg' + k + '2'], C = piv['leg' + k + '3'];
    return {
      k, front: k[0] === 'F', A, B, C,
      L1: Math.hypot(B.y - A.y, B.z - A.z), L2: Math.hypot(C.y - B.y, C.z - B.z), Lr: Math.hypot(C.y - A.y, C.z - A.z),
      th1r: ang(A, B), th2r: ang(B, C),
    };
  });
  const byK = Object.fromEntries(legs.map((l) => [l.k, l]));

  /** Fetlock target in the horse's own frame, plus how much the hoof curls (0 = flat on the ground). */
  function target(g, L, ph, s) {
    const u = frac(ph - g.touch[L.k]);
    if (u < g.duty) return { z: L.C.z + s * (1 - (2 * u) / g.duty), y: L.C.y, flex: 0, stance: true, u };
    const w = (u - g.duty) / (1 - g.duty);
    const zLift = L.C.z - s, zLand = L.C.z + s;
    if (L.front) {
      // fold up behind first, then reach forward past the landing spot and draw back onto it
      const over = 0.04;
      const z = zLift + (zLand - zLift + over) * ss(0.14, 0.8, w) - over * ss(0.8, 1.0, w);
      const bump = Math.sin(Math.PI * skew(w, 0.34));
      return { z, y: L.C.y + g.liftF * bump, flex: g.flexF * Math.sin(Math.PI * skew(w, 0.32)), stance: false, u, w };
    }
    const z = zLift + (zLand - zLift) * ss(0.05, 0.9, w);
    const bump = Math.sin(Math.PI * skew(w, 0.42));
    return { z, y: L.C.y + g.liftB * bump, flex: g.flexB * Math.sin(Math.PI * skew(w, 0.38)), stance: false, u, w };
  }

  function solve(L, A, C) {
    const vz = C.z - A.z, vy = C.y - A.y;
    const d = Math.hypot(vz, vy);
    const dc = clamp(d, Math.abs(L.L1 - L.L2) + 1e-4, L.L1 + L.L2 - 1e-6);
    const thv = Math.atan2(-vz, -vy);
    const alpha = Math.acos(clamp((L.L1 * L.L1 + dc * dc - L.L2 * L.L2) / (2 * L.L1 * dc), -1, 1));
    // front knee bends forward, hind hock backward
    const th1 = L.front ? thv - alpha : thv + alpha;
    const Bz = A.z - L.L1 * Math.sin(th1), By = A.y - L.L1 * Math.cos(th1);
    const Cz = A.z + (vz * dc) / d, Cy = A.y + (vy * dc) / d;
    return [th1, Math.atan2(-(Cz - Bz), -(Cy - By)), d - dc];
  }

  /**
   * Pose for gait `g` at time t (seconds). Returns bone -> {rx, rz, py}: rotation about x (and z for the tail)
   * and a y offset of the bone's rest position. `info` receives per-leg diagnostics when given.
   */
  function pose(g, t, info) {
    const out = {};
    const ph = t * g.freq;
    const s = ((g.speed / g.freq) * g.duty) / 2;
    const tg = {};
    for (const L of legs) tg[L.k] = target(g, L, ph, s);
    const Af = byK.FL.A, Ab = byK.BL.A;
    const pivotOf = (L, Y, theta) => {
      const dy = L.A.y - P.y, dz = L.A.z - P.z;
      return { y: Y + dy * Math.cos(theta) + dz * Math.sin(theta), z: P.z - dy * Math.sin(theta) + dz * Math.cos(theta) };
    };
    // highest each leg's pivot may sit while still reaching its fetlock target; the second pass uses the
    // pivot positions shifted by the first pass's pitch
    let theta = 0, Y = P.y;
    for (let pass = 0; pass < 2; pass++) {
      const h = {};
      for (const L of legs) {
        const A = pass === 0 ? L.A : pivotOf(L, Y, theta);
        const T = tg[L.k];
        if (T.stance) {
          const dz = T.z - A.z;
          h[L.k] = T.y + Math.sqrt(Math.max(0, L.Lr * L.Lr - dz * dz));
        } else {
          // a swinging leg only has to reach its landing spot, and only near the end of the swing
          const dz = L.C.z + s - A.z;
          h[L.k] = L.C.y + Math.sqrt(Math.max(0, L.Lr * L.Lr - dz * dz)) + 0.3 * (1 - ss(0.72, 1.0, T.w));
        }
      }
      const Hf = smin(smin(h.FL, h.FR, 0.0015), Af.y + g.cap), Hb = smin(smin(h.BL, h.BR, 0.0015), Ab.y + g.cap);
      theta = Math.asin(clamp((Hf - Hb) / (Af.z - Ab.z), -0.6, 0.6));  // nose up
      Y = (Hf + Hb) / 2 - (Af.y - P.y) * Math.cos(theta);
    }
    const rot = -theta;
    out.body = { rx: rot, py: Y - P.y };
    const up = { y: Math.cos(theta), z: -Math.sin(theta) };
    for (const L of legs) {
      const A = pivotOf(L, Y, theta);
      const T = tg[L.k];
      // thoracic sling: a weight-bearing foreleg's top may ride up into the shoulder (along the body's up axis)
      // instead of buckling the knee when the body is lower than the straight leg wants
      let sling = 0;
      if (L.front) {
        const w = { y: T.y - A.y, z: T.z - A.z };
        const wu = w.y * up.y + w.z * up.z, ww = w.y * w.y + w.z * w.z;
        if (ww < L.Lr * L.Lr) sling = wu + Math.sqrt(Math.max(0, wu * wu - ww + L.Lr * L.Lr));
        const sw = T.stance ? 1 : 1 - ss(0, 0.18, T.w) + ss(0.82, 1, T.w);
        sling = (sling / Math.pow(1 + Math.pow(sling / SLING, 4), 0.25)) * sw;
        A.y += sling * up.y;
        A.z += sling * up.z;
      }
      const [th1, th2, miss] = solve(L, A, T);
      const r1 = th1 - L.th1r - rot;
      const r2 = th2 - L.th2r - th1 + L.th1r;
      const flat = -(th2 - L.th2r);
      const b = T.stance ? 0 : T.flex / (L.front ? g.flexF : g.flexB);
      const r3 = flat * (1 - b) + T.flex * b;
      out['leg' + L.k] = { rx: r1, py: sling };
      out['leg' + L.k + '2'] = { rx: r2 };
      out['leg' + L.k + '3'] = { rx: r3 };
      if (info) info[L.k] = { stance: T.stance, miss, target: T };
    }
    const [nodAmp, nodPer, nodPh] = g.nod;
    out.neck = { rx: nodAmp * Math.sin(2 * Math.PI * (nodPer * ph + nodPh)) + 0.5 * theta };
    const [tailLift, tailSway] = g.tail;
    out.tail = { rx: tailLift + 0.05 * Math.sin(2 * Math.PI * (ph + 0.3)), rz: tailSway * Math.sin(2 * Math.PI * ph) };
    return out;
  }

  function stand(t) {
    const graze = Math.max(0, Math.sin(t * 0.5));
    return { neck: { rx: graze * 0.6 }, tail: { rx: 0, rz: Math.sin(t * 1.5) * 0.12 } };
  }

  return { pose, stand, legs };
}

if (typeof module !== 'undefined') module.exports = { GAITS, makeHorseGait };
