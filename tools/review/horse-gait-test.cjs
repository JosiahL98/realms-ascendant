const { GAITS, makeHorseGait } = require('./horse-gait.cjs');
const horse = require(process.argv[2] || './horse.json');
const G = makeHorseGait(horse.bones);
const piv = {}; for (const b of horse.bones) piv[b.name] = { y: b.pivot[1], z: b.pivot[2] };
const rotv = (v, a) => ({ y: v.y * Math.cos(a) - v.z * Math.sin(a), z: v.y * Math.sin(a) + v.z * Math.cos(a) });
const add = (a, b) => ({ y: a.y + b.y, z: a.z + b.z }), sub = (a, b) => ({ y: a.y - b.y, z: a.z - b.z });
const HOOF = { F: { y: 0, z: 0.376 }, B: { y: 0, z: -0.342 } };
function fk(pose, k) {
  const P = piv.body, body = pose.body;
  const Pw = { y: P.y + body.py, z: P.z };
  const A = piv['leg' + k], B = piv['leg' + k + '2'], C = piv['leg' + k + '3'];
  const sl = pose['leg' + k].py || 0;
  const Aw = add(add(Pw, rotv(sub(A, P), body.rx)), rotv({ y: sl, z: 0 }, body.rx));
  let a = body.rx + pose['leg' + k].rx;
  const Bw = add(Aw, rotv(sub(B, A), a));
  a += pose['leg' + k + '2'].rx;
  const Cw = add(Bw, rotv(sub(C, B), a));
  a += pose['leg' + k + '3'].rx;
  const h = HOOF[k[0]];
  const pts = [{ y: 0, z: h.z }, { y: 0.004, z: h.z + 0.034 }, { y: 0.01, z: h.z - 0.03 }].map((p) => add(Cw, rotv(sub(p, C), a)));
  return { H: pts[0], minY: Math.min(...pts.map((p) => p.y)), hoofAngle: a, knee: pose['leg' + k + '2'].rx };
}
for (const [name, g] of Object.entries(GAITS)) {
  const T = 2 / g.freq, dt = 1 / 480;
  const st = {}; let maxSlide = 0, maxLift = 0, minY = 1, maxMiss = 0, pitch = [1, -1], bodyY = [1, -1], kneeFwd = 0;
  for (let t = 0; t < T; t += dt) {
    const info = {};
    const pose = G.pose(g, t, info);
    pitch = [Math.min(pitch[0], pose.body.rx), Math.max(pitch[1], pose.body.rx)];
    bodyY = [Math.min(bodyY[0], pose.body.py), Math.max(bodyY[1], pose.body.py)];
    for (const k of ['FL', 'FR', 'BL', 'BR']) {
      const f = fk(pose, k);
      minY = Math.min(minY, f.minY);
      maxMiss = Math.max(maxMiss, info[k].miss);
      if (info[k].stance) {
        if (!st[k]) st[k] = { t0: t, H0: f.H };
        const expectZ = st[k].H0.z - g.speed * (t - st[k].t0);
        maxSlide = Math.max(maxSlide, Math.abs(f.H.z - expectZ));
        maxLift = Math.max(maxLift, Math.abs(f.H.y));
        if (k[0] === 'F') kneeFwd = Math.max(kneeFwd, pose['leg' + k + '2'].rx);
      } else st[k] = null;
    }
  }
  const f3 = (x) => x.toFixed(4);
  console.log(`${name.padEnd(7)} slide ${f3(maxSlide)}  hoofY ${f3(maxLift)}  lowestHoofPt ${f3(minY)}  miss ${f3(maxMiss)}  pitch ${f3(pitch[0])}..${f3(pitch[1])}  bodyY ${f3(bodyY[0])}..${f3(bodyY[1])}  frontKneeBendInStance(rad) ${f3(kneeFwd)}`);
}
