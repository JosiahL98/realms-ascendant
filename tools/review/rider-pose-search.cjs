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
  holdPole: [[-2.275, -0.762, -1.463], 0.8],
  outG: [[-0.28, 1.1, 0.06], 0.04], outPole: [[0.238, -0.643, -0.617], 0.8],
  levelG: [[-0.28, 1.06, 0.06], 0.04], levelPole: [[-0.763, 0.452, -0.071], 0.8],
  backG: [[-0.275, 1.041, -0.004], 0.04], backPole: [[-0.373, 0.172, -1.251], 0.8],
  thrustG: [[-0.22, 1.06, 0.19], 0.04], thrustPole: [[-0.522, -2.52, 0.203], 0.8],
};
// every grip must be within the arm's reach (the fist stays on the spear) and the thrust goes forward, not sideways
const S = [-0.108, 1.162, -0.045], REACH = 0.285;   // arm (0.26) plus the fist beyond the wrist
const reach = (g) => Math.hypot(g[0] - S[0], g[1] - S[1], g[2] - S[2]);
let best = Object.fromEntries(Object.entries(KEYS).map(([k, [v]]) => [k, v]));
best.yaw = 0.076;
best.pitch = 0.0;
const ok = (t) => ['outG', 'levelG', 'backG', 'thrustG'].every((k) => reach(t[k]) < REACH) && t.thrustG[0] > -0.3 && t.thrustG[2] > 0.14
  && t.levelG[1] > 0.95 && t.levelG[1] < 1.18 && t.backG[2] < t.levelG[2] - 0.06
  && t.yaw > -0.05 && t.yaw < 0.16 && t.pitch > -0.2 && t.pitch < 0.05;
let bestScore = score(best);
console.log('start', (bestScore * 1000).toFixed(1), 'mm');
for (let i = 0; i < iters; i++) {
  const step = 0.7 * (1 - i / iters) + 0.1;
  const cand = { yaw: best.yaw + (rnd() * 2 - 1) * 0.08 * step, pitch: best.pitch + (rnd() * 2 - 1) * 0.06 * step };
  for (const [k, [, sc]] of Object.entries(KEYS)) cand[k] = rnd() < 0.5 ? jitter(best[k], sc * step) : best[k];
  if (!ok(cand)) continue;
  const sc = score(cand);
  if (sc > bestScore) {
    best = cand;
    bestScore = sc;
    console.log(`#${i}`, (bestScore * 1000).toFixed(1), 'mm');
  }
  if (bestScore > 0.008) break;
}
const r = (a) => (Array.isArray(a) ? "[" + a.map((v) => v.toFixed(3)).join(", ") + "]" : a.toFixed(3));
console.log('best', (bestScore * 1000).toFixed(1), 'mm');
console.log(Object.entries(best).map(([k, v]) => `${k}: ${r(v)}`).join('\n'));
