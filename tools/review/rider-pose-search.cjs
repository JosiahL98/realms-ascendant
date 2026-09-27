// Searches the spear's swing-over key poses for the largest clearance from arm, body and horse while raising it.
// Usage: HORSE=<horse.json> RIDER=<rider.json> node tools/review/rider-pose-search.cjs [iterations]
process.removeAllListeners('warning');
const { evaluate } = require('./rider-clearance.cjs');

const iters = Number(process.argv[2] || 200);
let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const jitter = (a, s) => a.map((v) => v + (rnd() * 2 - 1) * s);

// the raise runs from 0 to 0.25 of the attack; lowering mirrors it
const score = (tune) => evaluate(tune, 0.08, 0.26, 16).overall;

let best = {
  overG: [-0.22, 1.26, 0.06], overD: [0.3, 0.45, 0.85], overPole: [-1, -0.4, -0.2],
  liftG: [-0.23, 1.22, 0.12], liftD: [-0.03, 1, -0.05], liftPole: [-0.8, -0.6, -0.4],
};
let bestScore = score(best);
console.log('start', (bestScore * 1000).toFixed(1), 'mm');
for (let i = 0; i < iters; i++) {
  const step = 0.6 * (1 - i / iters) + 0.1;
  const cand = {
    overG: jitter(best.overG, 0.05 * step), overD: jitter(best.overD, 0.6 * step), overPole: jitter(best.overPole, 0.8 * step),
    liftG: jitter(best.liftG, 0.04 * step), liftD: jitter(best.liftD, 0.3 * step), liftPole: jitter(best.liftPole, 0.8 * step),
  };
  // keep the grip within reach and in front of the shoulder
  if (cand.overG[1] < 1.1 || cand.overG[1] > 1.34 || cand.liftG[1] < 1.1) continue;
  const sc = score(cand);
  if (sc > bestScore) {
    best = cand;
    bestScore = sc;
    console.log(`#${i}`, (bestScore * 1000).toFixed(1), 'mm');
  }
  if (bestScore > 0.012) break;
}
const r = (a) => '[' + a.map((v) => v.toFixed(3)).join(', ') + ']';
console.log('best', (bestScore * 1000).toFixed(1), 'mm');
console.log(Object.entries(best).map(([k, v]) => `${k}: ${r(v)}`).join('\n'));
