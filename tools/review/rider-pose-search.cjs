// Searches the spear's swing-over key poses for the largest clearance from arm, body and horse while raising it.
// Usage: HORSE=<horse.json> RIDER=<rider.json> node tools/review/rider-pose-search.cjs [iterations]
process.removeAllListeners('warning');
const { evaluate } = require('./rider-clearance.cjs');

const iters = Number(process.argv[2] || 200);
let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const jitter = (a, s) => a.map((v) => v + (rnd() * 2 - 1) * s);

// the whole attack, sampled every ~4%
const score = (tune) => evaluate(tune, 0, 0.96, 25).overall;

const KEYS = {
  lowerG: [[-0.23, 0.95, 0.12], 0.04], lowerPole: [[-1, -0.4, -0.1], 0.5],
  levelG: [[-0.22, 0.9, 0.1], 0.04], levelPole: [[-1, -0.7, -0.3], 0.5],
  backG: [[-0.22, 0.9, -0.02], 0.04], backPole: [[-1, -0.6, -0.5], 0.5],
  thrustG: [[-0.2, 0.96, 0.24], 0.04], thrustPole: [[-1, -0.8, 0.1], 0.5],
};
// grips within the arm's reach (upper arm + forearm + the fist beyond the wrist), from the right shoulder
const S = [-0.108, 1.162, -0.045], REACH = 0.355;
const reach = (g) => Math.hypot(g[0] - S[0], g[1] - S[1], g[2] - S[2]);
// a natural elbow points outward and down (never inward or up)
const natural = (p) => { const l = Math.hypot(...p); return p[0] / l < -0.55 && p[1] / l < -0.15; };
let best = Object.fromEntries(Object.entries(KEYS).map(([k, [v]]) => [k, v]));
best.yaw = -0.05;
best.pitch = 0;
best.lowerFlex = 0.3; best.levelFlex = 0.5; best.backFlex = 0.5; best.thrustFlex = 0.5;
const FLEX = ['lowerFlex', 'levelFlex', 'backFlex', 'thrustFlex'];
const ok = (t) => ['lowerG', 'levelG', 'backG', 'thrustG'].every((k) => reach(t[k]) < REACH)
  && ['lowerPole', 'levelPole', 'backPole', 'thrustPole'].every((k) => natural(t[k]))
  && t.thrustG[2] > t.levelG[2] + 0.08 && t.backG[2] < t.levelG[2] - 0.06 && t.levelG[1] > 0.86 && t.levelG[1] < 1.05
  && t.thrustG[0] > -0.3 && FLEX.every((k) => t[k] >= 0 && t[k] <= 0.9) && t.yaw > -0.25 && t.yaw < 0.12 && t.pitch > -0.15 && t.pitch < 0.05;
let bestScore = score(best);
console.log('start', (bestScore * 1000).toFixed(1), 'mm');
for (let i = 0; i < iters; i++) {
  const step = 0.7 * (1 - i / iters) + 0.1;
  const cand = { yaw: best.yaw + (rnd() * 2 - 1) * 0.08 * step, pitch: best.pitch + (rnd() * 2 - 1) * 0.06 * step };
  for (const [k, [, sc]] of Object.entries(KEYS)) cand[k] = rnd() < 0.5 ? jitter(best[k], sc * step) : best[k];
  for (const k of FLEX) cand[k] = rnd() < 0.5 ? best[k] + (rnd() * 2 - 1) * 0.3 * step : best[k];
  if (!ok(cand)) continue;
  const sc = score(cand);
  if (sc > bestScore) {
    best = cand;
    bestScore = sc;
    console.log(`#${i}`, (bestScore * 1000).toFixed(1), 'mm');
  }
  if (bestScore > 0.006) break;
}
const r = (a) => (Array.isArray(a) ? "[" + a.map((v) => v.toFixed(3)).join(", ") + "]" : a.toFixed(3));
console.log('best', (bestScore * 1000).toFixed(1), 'mm');
console.log(Object.entries(best).map(([k, v]) => `${k}: ${r(v)}`).join('\n'));
