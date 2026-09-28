// Siege engine poses (siege.py models): wheels turning with the distance travelled, each engine's attack, and a
// collapse when destroyed. Poses are bone -> { rx, rz, px, py, pz } (rotation about x and z, offsets of the rest
// position), like horse-gait.cjs.

/** Attack length (s) and the moment the blow lands or the shot leaves (fraction), per kind of engine. */
const ATTACKS = {
  ram: { len: 1.4, hit: 0.54 },
  mangonel: { len: 2.4, hit: 0.13 },
  scorpion: { len: 1.2, hit: 0.13 },
  bombard: { len: 1.4, hit: 0.07 },
  trebuchet: { len: 3.2, hit: 0.17 },
};
const HIDE = -20;   // a spent shot waits out of sight below the ground until the engine is reloaded

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Wheels turned by `turns` full revolutions. */
function roll(turns) {
  const a = 2 * Math.PI * turns;
  return { wheelF: { rx: a }, wheelB: { rx: a } };
}

function attack(kind, t) {
  const A = ATTACKS[kind];
  const u = t / A.len;
  const hit = A.hit;
  const out = {};
  const shotGone = u > hit && u < 0.92;
  if (kind === 'ram') {
    // drawn back on its ropes, then driven forward into the wall, and settling
    const back = ss(0, hit - 0.1, u) * (1 - ss(hit - 0.1, hit, u));
    const drive = ss(hit - 0.1, hit, u) * (1 - ss(hit + 0.05, 1, u));
    out.ram = { pz: -0.22 * back + 0.1 * drive, py: 0.03 * back };
  } else if (kind === 'mangonel') {
    // the arm flies up against the crossbar, bounces, and is winched back down
    const up = ss(0, hit, u);
    const bounce = Math.sin(Math.min(1, Math.max(0, (u - hit) / 0.08)) * Math.PI) * 0.12;
    const down = ss(0.35, 0.95, u);
    out.arm = { rx: 2.2 * up * (1 - down) - bounce * (1 - down) };
  } else if (kind === 'scorpion') {
    const rec = u > hit ? Math.max(0, 1 - (u - hit) / 0.2) : 0;
    out.bow = { pz: -0.05 * rec };
  } else if (kind === 'bombard') {
    const rec = u > hit ? Math.max(0, 1 - (u - hit) / 0.5) : 0;
    out.barrel = { pz: -0.14 * rec * rec, rx: -0.06 * rec };
  } else if (kind === 'trebuchet') {
    // the counterweight drops, the beam whips over, the sling lets go, and the crew hauls it back down
    const up = ss(0, hit + 0.05, u);
    const down = ss(0.4, 0.95, u);
    out.arm = { rx: 2.5 * up * (1 - down) };
  }
  if (kind !== 'ram' && kind !== 'bombard') {
    // straight down in the world, whatever the angle of the arm the shot hangs from
    const a = out.arm ? out.arm.rx : 0;
    out.shot = shotGone ? { py: HIDE * Math.cos(a), pz: -HIDE * Math.sin(a) } : { py: 0 };
  }
  return out;
}

/** Destroyed: the frame lurches over onto one side and settles lower. */
function die(t) {
  const e = ss(0, 0.8, t);
  return { root: { rx: 0.12 * e, rz: 0.32 * e, py: -0.08 * e } };
}

if (typeof module !== 'undefined') module.exports = { ATTACKS, roll, attack, die };
