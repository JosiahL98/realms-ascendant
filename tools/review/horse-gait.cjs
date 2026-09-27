// Horse gait solver: planted hooves and two-bone leg IK under a level body that travels at a constant height.
// Angles are rotations about x ("θ-space": 0 = pointing straight down, positive = swung backward).

const GAITS = {
  walk: {
    label: 'Walk', speed: 0.6, freq: 1.15, duty: 0.62, touch: { BL: 0.0, FL: 0.25, BR: 0.5, FR: 0.75 },
    liftF: 0.08, liftB: 0.065, flexF: 0.8, flexB: 0.65, nod: [0.05, 2, 0.15], tail: [0.05, 0.08],
    caption: 'Four beats: left hind, left fore, right hind, right fore. Two or three hooves are always on the ground.',
    note: 'Slow pace, 0.6 tiles a second',
  },
  trot: {
    label: 'Trot', speed: 1.35, freq: 1.65, duty: 0.42, touch: { BL: 0.0, FR: 0.02, BR: 0.5, FL: 0.52 },
    liftF: 0.19, liftB: 0.14, flexF: 1.4, flexB: 1.0, nod: [0.02, 2, 0.1], tail: [0.18, 0.06],
    caption: 'Two beats: diagonal pairs land together, with a moment of suspension between them.',
    note: 'Knight speed, 1.35 tiles a second',
  },
  canter: {
    label: 'Canter', speed: 1.55, freq: 1.65, duty: 0.36, touch: { BL: 0.0, BR: 0.16, FL: 0.2, FR: 0.47 },
    liftF: 0.2, liftB: 0.15, flexF: 1.45, flexB: 1.05, nod: [0.08, 1, 0.55], tail: [0.35, 0.07],
    caption: 'Three beats on the right lead: left hind, then right hind with left fore, then the leading right fore, then all four hooves in the air.',
    note: 'Scout speed, 1.55 tiles a second',
  },
};

const frac = (x) => x - Math.floor(x);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** Remaps w so that `peak` lands in the middle; used to skew bumps earlier or later. */
const skew = (w, peak) => (w < peak ? 0.5 * w / peak : 0.5 + 0.5 * (w - peak) / (1 - peak));
const ang = (from, to) => Math.atan2(-(to.z - from.z), -(to.y - from.y));
/** How far a foreleg's top may ride up into the shoulder, or drop out of it (thoracic sling). */
const SLING_UP = 0.07, SLING_DOWN = 0.025;
/** Smoothly limits x to [-down, up]. */
const softLimit = (x, up, down) => (x >= 0 ? x / Math.pow(1 + Math.pow(x / up, 8), 1 / 8) : -(-x) / Math.pow(1 + Math.pow(-x / down, 8), 1 / 8));

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

  const halfStride = (g) => ((g.speed / g.freq) * g.duty) / 2;

  /**
   * How much lower than standing the body travels in gait g: just enough that every leg reaches its hoof at the
   * front and back of its stance. Forelegs may also drop a little out of the shoulder, hind legs may straighten.
   */
  const drops = new Map();
  function bodyDrop(g) {
    if (drops.has(g)) return drops.get(g);
    const s = halfStride(g);
    let drop = 0;
    for (const L of legs) {
      const reach = L.front ? L.Lr : L.L1 + L.L2 - 0.002;
      const top = L.C.y + Math.sqrt(Math.max(0, reach * reach - s * s)) + (L.front ? SLING_DOWN * 0.8 : 0);
      drop = Math.max(drop, L.A.y - top);
    }
    drops.set(g, drop);
    return drop;
  }

  /** Fetlock target in the horse's own frame, plus how much the hoof curls (0 = flat on the ground). */
  function target(g, L, ph, s) {
    // each hoof's time on the ground is centred under its shoulder or hip
    const mid = L.A.z;
    const u = frac(ph - g.touch[L.k]);
    if (u < g.duty) return { z: mid + s * (1 - (2 * u) / g.duty), y: L.C.y, flex: 0, stance: true, u };
    const w = (u - g.duty) / (1 - g.duty);
    const zLift = mid - s, zLand = mid + s;
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
    const s = halfStride(g);
    const drop = bodyDrop(g);
    out.body = { rx: 0, py: -drop };
    for (const L of legs) {
      const A = { y: L.A.y - drop, z: L.A.z };
      const T = target(g, L, ph, s);
      // thoracic sling: a weight-bearing foreleg's top rides up into the shoulder or drops slightly out of it so
      // the leg stays straight under the level body instead of buckling at the knee
      let sling = 0;
      if (L.front) {
        // how far the pivot must move up (or down, if negative) for a straight leg to reach the target
        const need = Math.sqrt(Math.max(0, L.Lr * L.Lr - (T.z - A.z) ** 2)) - (A.y - T.y);
        const sw = T.stance ? 1 : 1 - ss(0, 0.18, T.w) + ss(0.82, 1, T.w);
        sling = softLimit(need, SLING_UP, SLING_DOWN) * sw;
        A.y += sling;
      }
      const [th1, th2, miss] = solve(L, A, T);
      const r1 = th1 - L.th1r;
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
    out.neck = { rx: nodAmp * Math.sin(2 * Math.PI * (nodPer * ph + nodPh)) };
    const [tailLift, tailSway] = g.tail;
    out.tail = { rx: tailLift + 0.05 * Math.sin(2 * Math.PI * (ph + 0.3)), rz: tailSway * Math.sin(2 * Math.PI * ph) };
    return out;
  }

  function stand(t) {
    const graze = Math.max(0, Math.sin(t * 0.5));
    return { neck: { rx: graze * 0.6 }, tail: { rx: 0, rz: Math.sin(t * 1.5) * 0.12 } };
  }

  return { pose, stand, legs, bodyDrop };
}

if (typeof module !== 'undefined') module.exports = { GAITS, makeHorseGait };
