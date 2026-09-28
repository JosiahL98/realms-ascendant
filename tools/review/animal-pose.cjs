// Animal poses (quadruped.py models): the horse's gait solver with each species' own gaits, grazing or looking about
// at rest, and a bite (wolf) or tusk thrust (boar). Poses are bone -> { rx, rz, py } like horse-gait.cjs.
const { makeHorseGait } = require('./horse-gait.cjs');

const WALK = { BL: 0.0, FL: 0.25, BR: 0.5, FR: 0.75 };
const TROT = { BL: 0.0, FR: 0.02, BR: 0.5, FL: 0.52 };
const GALLOP = { BL: 0.0, BR: 0.12, FL: 0.45, FR: 0.57 };   // rotary gallop, hinds then fores
/** Species gaits: speed (tiles a second), stride frequency, duty factor, beat timing, hoof lift and fold. */
const SPECIES = {
  sheep: {
    graze: 0.95, look: 0.15,
    gaits: {
      walk: { speed: 0.35, freq: 1.8, duty: 0.62, touch: WALK, lift: 0.05, flex: 0.8, nod: [0.05, 2, 0.15], tail: [0.05, 0.1] },
      trot: { speed: 0.7, freq: 2.7, duty: 0.42, touch: TROT, lift: 0.09, flex: 1.3, nod: [0.03, 2, 0.1], tail: [0.1, 0.1] },
    },
  },
  deer: {
    graze: 0.95, look: 0.35,
    gaits: {
      walk: { speed: 0.4, freq: 1.4, duty: 0.62, touch: WALK, lift: 0.06, flex: 0.9, nod: [0.05, 2, 0.15], tail: [0.1, 0.05] },
      trot: { speed: 0.8, freq: 2.0, duty: 0.42, touch: TROT, lift: 0.12, flex: 1.4, nod: [0.03, 2, 0.1], tail: [0.3, 0.05] },
      canter: { speed: 1.3, freq: 2.3, duty: 0.33, touch: GALLOP, lift: 0.13, flex: 1.5, nod: [0.08, 1, 0.55], tail: [0.6, 0.05] },
    },
  },
  boar: {
    graze: 0.55, look: 0.2,
    gaits: {
      walk: { speed: 0.4, freq: 1.9, duty: 0.62, touch: WALK, lift: 0.045, flex: 0.8, nod: [0.04, 2, 0.15], tail: [0.1, 0.25] },
      trot: { speed: 0.9, freq: 2.9, duty: 0.42, touch: TROT, lift: 0.08, flex: 1.3, nod: [0.03, 2, 0.1], tail: [0.4, 0.2] },
    },
  },
  wolf: {
    graze: 0.2, look: 0.45,
    gaits: {
      walk: { speed: 0.45, freq: 1.6, duty: 0.6, touch: WALK, lift: 0.05, flex: 0.9, nod: [0.03, 2, 0.15], tail: [0.05, 0.08] },
      trot: { speed: 0.8, freq: 2.2, duty: 0.42, touch: TROT, lift: 0.08, flex: 1.3, nod: [0.02, 2, 0.1], tail: [0.15, 0.06] },
      canter: { speed: 1.1, freq: 2.4, duty: 0.34, touch: GALLOP, lift: 0.09, flex: 1.4, nod: [0.06, 1, 0.55], tail: [0.35, 0.05] },
    },
  },
  // mounts (a rider on top: they do not graze far)
  camel: {
    graze: 0.25, look: 0.3,
    gaits: {
      walk: { speed: 0.7, freq: 1.05, duty: 0.62, touch: { BL: 0.0, FL: 0.14, BR: 0.5, FR: 0.64 }, lift: 0.1, flex: 0.9, nod: [0.06, 2, 0.15], tail: [0.05, 0.1] },
      // the pace: both legs on one side move together
      trot: { speed: 1.45, freq: 1.5, duty: 0.42, touch: { BL: 0.0, FL: 0.02, BR: 0.5, FR: 0.52 }, lift: 0.16, flex: 1.2, nod: [0.05, 2, 0.1], tail: [0.2, 0.1] },
    },
  },
  elephant: {
    graze: 0.0, look: 0.2,
    gaits: {
      walk: { speed: 0.6, freq: 0.75, duty: 0.66, touch: { BL: 0.0, FL: 0.25, BR: 0.5, FR: 0.75 }, lift: 0.1, flex: 0.45, nod: [0.04, 2, 0.15], tail: [0.05, 0.15] },
    },
  },
};
const ATTACK = 1.0;

function makeAnimalPose(bones, species) {
  const S = SPECIES[species];
  const gait = makeHorseGait(bones);
  // the solver's gait objects: fore and hind lift and fold from the species' values
  const gaits = {};
  for (const [name, g] of Object.entries(S.gaits)) {
    gaits[name] = { ...g, liftF: g.lift, liftB: g.lift * 0.8, flexF: g.flex, flexB: g.flex * 0.75 };
  }

  /** At rest: now and then the head goes down to graze (or root, or sniff), otherwise it is raised, listening. */
  function stand(t) {
    // (the neck only bends up and down: the game's bend skinning turns joints about x)
    const graze = Math.max(0, Math.sin(t * 0.45)) ** 1.5 * S.graze;
    const alert = -S.look * 0.3 * Math.max(0, Math.sin(t * 0.3 + 2)) * (1 - graze);   // head up, listening
    const out = { neck: { rx: graze + alert }, tail: { rx: 0, rz: Math.sin(t * 2.1) * 0.15 } };
    if (species === 'elephant') {
      // the trunk swings and curls, the ears fan
      out.trunk = { rx: -0.12 + 0.12 * Math.sin(t * 0.9) };
      out.trunk2 = { rx: -0.2 - 0.2 * Math.max(0, Math.sin(t * 0.6 + 1)) };
      const fan = 0.25 * Math.max(0, Math.sin(t * 1.3)) ** 2;
      out.earL = { ry: fan };
      out.earR = { ry: -fan };
    }
    return out;
  }

  /** Wolf: the head pulls back, then snaps forward and down in a bite; boar: head low, then a hooking upward thrust. */
  function attack(t) {
    const u = Math.min(1, t / ATTACK);
    const bump = (a, b, x) => (x <= a || x >= b ? 0 : Math.sin(Math.PI * (x - a) / (b - a)));
    let neck, pz, pitch;
    if (species === 'elephant') {
      // head up and trunk raised, then down to drive the tusks in, a forefoot lifted to stamp
      neck = -0.2 * bump(0.0, 0.45, u) + 0.3 * bump(0.4, 0.75, u);
      const legs = bump(0.2, 0.8, u);
      return { neck: { rx: neck }, trunk: { rx: -0.9 * bump(0.0, 0.6, u) }, trunk2: { rx: -0.9 * bump(0.05, 0.6, u) },
        legFL: { rx: -0.35 * legs }, legFL2: { rx: 0.7 * legs }, body: { rx: 0.03 * legs, pz: 0.03 * bump(0.4, 0.8, u) } };
    }
    if (species === 'boar') {
      neck = 0.35 * bump(0.0, 0.5, u) - 0.45 * bump(0.4, 0.75, u);
      pz = 0.07 * bump(0.25, 0.8, u);
      pitch = 0.06 * bump(0.0, 0.5, u) - 0.04 * bump(0.45, 0.8, u);
    } else {
      neck = -0.3 * bump(0.0, 0.45, u) + 0.35 * bump(0.4, 0.7, u);
      pz = 0.09 * bump(0.3, 0.75, u);
      pitch = -0.05 * bump(0.0, 0.45, u) + 0.04 * bump(0.4, 0.7, u);
    }
    return { neck: { rx: neck }, body: { rx: pitch, pz } };
  }

  return { gaits, gait, stand, attack, ATTACK, pose: (name, t) => gait.pose(gaits[name], t) };
}

if (typeof module !== 'undefined') module.exports = { makeAnimalPose, SPECIES, ATTACK };
