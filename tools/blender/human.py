"""
Standing humans (villagers first). Run:
  blender --background --factory-startup --python tools/blender/human.py -- <male|female> <out.json> [preview.png] [--tris 0.38]

Same body proportions as the cavalryman (rider.py): shoulders 0.73 above the ground, upper arm 0.175, forearm 0.15,
thigh 0.2, shin 0.2, about 0.92 tall. Faces +z, feet on y = 0, the figure's left towards +x.

Bones: root, hips, legL/R (hip joint), kneeL/R, footL/R (ankle), torso, head, armL/R (shoulder), elbowL/R, handL/R,
carry (goods held in front of the chest), skirtL/R. Rigid parts use ball joints (a sphere centred on each pivot). The
tunic skirt and dress are skinned: their vertices carry 'skirtL'/'skirtR' weights (masks) for linear blend skinning
with the hips; the skirt bones sit at the hip joints and follow the thighs part of the way, so cloth sways rather
than swinging stiffly with the legs. Hair and beard are painted on the head as masks.

Variant parts carry a 'variant' key: 'tool:axe' ... 'tool:rod', 'carry:wood' / 'carry:food' / 'carry:gold' /
'carry:stone', as in the game's rigs.

Soldiers: `kit=<unit>` (see equipment.py) builds the same body with that unit's clothing, armour and weapons instead
of the villager's tools and loads, e.g.
  blender --background --factory-startup --python tools/blender/human.py -- male out.json kit=legionary --tris 0.38
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import modelkit as mk  # noqa: E402
import equipment  # noqa: E402
from mathutils import Vector  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
flags = {}
while len(args) >= 2 and args[-2].startswith('--'):
    flags[args[-2][2:]] = float(args[-1])
    args = args[:-2]
KIT_NAME = next((a[4:] for a in args if a.startswith('kit=')), None)
args = [a for a in args if not a.startswith('kit=')]
kind, out_path = args[0], args[1]
preview_path = args[2] if len(args) > 2 else None
FEMALE = kind == 'female'
mk.TRI_SCALE = flags.get('tris', 1.0)
LIGHT = mk.TRI_SCALE < 0.7
V = Vector
ss = mk.smoothstep
mk.reset_scene()
KIT = equipment.kit(KIT_NAME) if KIT_NAME else None
# clothing: the villager's tunic or dress, a soldier's tunic ('team' or 'linen'), a priest's robe, or none (bare chest)
BARE = bool(KIT and KIT['bare'])
ROBE = bool(KIT and KIT['robe'])
TUNIC = KIT['tunic'] if KIT else 'team'
BEARD = (not FEMALE) and (KIT is None or KIT['beard'])
LEGS = 'legs' if KIT else 'skin'          # soldiers wear trousers

# ------------------------------------------------------------------------------------------------ skeleton
HIPS = V((0.0, 0.47, 0.0))
TORSO = V((0.0, 0.5, 0.0))
HEAD = V((0.0, 0.755, -0.01))
CR = HEAD + V((0.0, 0.09, 0.014))           # centre of the skull
HIP = {s: V((0.056 * s, 0.45, 0.0)) for s in (1, -1)}
KNEE = {s: V((0.058 * s, 0.25, 0.012)) for s in (1, -1)}
ANKLE = {s: V((0.06 * s, 0.053, -0.004)) for s in (1, -1)}   # soles just touch y = 0
SH = {s: V((0.1 * s, 0.732, -0.008)) for s in (1, -1)}
EL = {s: V((0.126 * s, 0.56, -0.022)) for s in (1, -1)}
WR = {s: V((0.142 * s, 0.412, 0.0)) for s in (1, -1)}   # hands clear of the hips
CARRY = V((0.0, 0.6, 0.15))

BONES = [
    {'name': 'root', 'parent': None, 'pivot': [0, 0, 0]},
    {'name': 'hips', 'parent': 'root', 'pivot': list(HIPS)},
    {'name': 'torso', 'parent': 'hips', 'pivot': list(TORSO)},
    {'name': 'head', 'parent': 'torso', 'pivot': list(HEAD)},
    {'name': 'carry', 'parent': 'torso', 'pivot': list(CARRY)},
]
for s, side in ((1, 'L'), (-1, 'R')):
    BONES += [
        {'name': f'leg{side}', 'parent': 'hips', 'pivot': list(HIP[s])},
        # the skirt on this side hangs from the hip joint and turns only part of the way with the thigh
        {'name': f'skirt{side}', 'parent': 'hips', 'pivot': list(HIP[s])},
        {'name': f'knee{side}', 'parent': f'leg{side}', 'pivot': list(KNEE[s])},
        {'name': f'foot{side}', 'parent': f'knee{side}', 'pivot': list(ANKLE[s])},
        {'name': f'arm{side}', 'parent': 'torso', 'pivot': list(SH[s])},
        {'name': f'elbow{side}', 'parent': f'arm{side}', 'pivot': list(EL[s])},
        {'name': f'hand{side}', 'parent': f'elbow{side}', 'pivot': list(WR[s])},
    ]
# the fishing line hangs from the rod tip (a bone the poses keep level with the world, so the line hangs straight down)
# to the float (a bone placed in the world: on the water when fishing, a short way below the tip when carried); the line
# is skinned between the two
ROD_TIP = WR[-1] + V((-0.003, -0.045, 0.008)) + V((0, -0.1, 0.72))   # the rod runs forward through the fist
LINE = 0.7
BONES += [
    {'name': 'rodtip', 'parent': 'handR', 'pivot': list(ROD_TIP)},
    {'name': 'bob', 'parent': 'root', 'pivot': list(ROD_TIP + V((0, -LINE, 0)))},
]

parts = []
LAYERS = []          # (outer, [inners], gap) applied after everything is built


def capsule(part, p0, p1, profile, seg, fwd=(0, 0, 1), flat=1.0):
    """
    A limb as one smooth lofted surface: rounded ends centred on the joints (so a bent joint shows no gap) and a
    radius profile [(t, r), ...] along it (t from 0 at p0 to 1 at p1) for muscle shapes.
    """
    p0, p1 = V(p0), V(p1)
    axis = (p1 - p0)
    L = axis.length
    axis.normalize()
    f = V(fwd) - axis * axis.dot(V(fwd))
    f = f.normalized() if f.length > 1e-6 else axis.orthogonal().normalized()
    u = axis.cross(f)
    r0, r1 = profile[0][1], profile[-1][1]
    rings = []
    domes = 2 if LIGHT else 4
    for i in range(1, domes + 1):                           # dome over p0
        a = math.pi / 2 * (1 - i / (domes + 1))
        rings.append((p0 - axis * (r0 * math.sin(a)), r0 * math.cos(a)))
    for t, r in profile:
        rings.append((p0 + axis * (L * t), r))
    for i in range(1, domes + 1):                           # dome over p1
        a = math.pi / 2 * i / (domes + 1)
        rings.append((p1 + axis * (r1 * math.sin(a)), r1 * math.cos(a)))
    part.loft([(c, u, f, r * flat, r, r) for c, r in rings], seg=seg)


def add(part, variant=None, turn=None):
    obj = part.build()
    if turn:
        # re-seat a tool in the fist: its vertices are turned about the grip (game space) by turn(offset)
        pivot, fn = turn
        for v in obj.data.vertices:
            g = V(mk.b2g(v.co)) - pivot
            v.co = mk.g2b(tuple(pivot + V(fn(g))))
        obj.data.update()
    if variant:
        obj['variant'] = variant
    parts.append(obj)
    return obj


# ------------------------------------------------------------------------------------------------ head
head = mk.Part('head', 'head', 'skin', voxel=0.0017, smooth=8, tris=900, symmetric=True)
head.limb(HEAD + V((0, -0.025, -0.006)), CR + V((0, -0.045, -0.004)), 0.034, 0.03, seg=14)   # neck
head.ellipsoid(CR, (0.05, 0.055, 0.057))                                                      # cranium
head.ellipsoid(CR + V((0, -0.03, 0.02)), (0.041, 0.042, 0.042))                               # face
head.ellipsoid(CR + V((0, -0.052, 0.012)), (0.037, 0.024, 0.04))                              # jaw
head.ellipsoid(CR + V((0, -0.066, 0.042)), (0.018, 0.014, 0.015))                             # chin
head.ellipsoid(CR + V((0, -0.022, 0.057)), (0.009, 0.017, 0.012), rot=(0.25, 0, 0))          # nose
for s in (1, -1):
    head.ellipsoid(CR + V((0.051 * s, -0.013, -0.002)), (0.008, 0.017, 0.012))              # ears


def hair_region(p, n):
    back = ss(CR.z + 0.012, CR.z - 0.012, p[2]) * ss(CR.y - 0.054, CR.y - 0.04, p[1])
    top = ss(CR.y + 0.012, CR.y + 0.03, p[1]) * ss(CR.z + 0.05, CR.z + 0.038, p[2])
    side = (ss(0.036, 0.044, abs(p[0])) * ss(CR.y - 0.032, CR.y - 0.022, p[1]) * ss(CR.z + 0.03, CR.z + 0.018, p[2]))
    fringe = ss(CR.y + 0.012, CR.y + 0.024, p[1]) * ss(0.042, 0.03, abs(p[0]))
    return max(back, top, side, fringe)


def beard_region(p, n):
    # jaw and chin below the cheekbones, in front of the ears, sparing the lips
    lower = ss(CR.y - 0.03, CR.y - 0.042, p[1]) * ss(CR.z - 0.01, CR.z + 0.01, p[2])
    lips = ss(0.012, 0.02, abs(p[0])) + ss(CR.y - 0.058, CR.y - 0.066, p[1])
    return lower * min(1.0, lips) * ss(0.0, 0.3, n[2] + 0.3 * abs(n[0]) - n[1] * 0.2)


head.mask('hair', hair_region)
if BEARD:
    head.mask('beard', beard_region)
add(head)

if FEMALE:
    # a headscarf over the hair, tied at the nape
    scarf = mk.Part('scarf', 'head', 'team2', voxel=0.002, smooth=5, tris=260, symmetric=True)
    scarf.ellipsoid(CR + V((0, 0.012, -0.008)), (0.06, 0.056, 0.063))
    scarf.ellipsoid(CR + V((0, -0.035, -0.042)), (0.047, 0.05, 0.03))                          # over the back of the neck
    scarf.ellipsoid(CR + V((0, -0.035, 0.075)), (0.11, 0.063, 0.07), cut=True)               # open for the face, up to the hairline
    scarf.ellipsoid(CR + V((0, -0.09, 0.0)), (0.07, 0.04, 0.07), cut=True)                   # and under the chin
    add(scarf)
    knot = mk.Part('scarfknot', 'head', 'team2', voxel=0.0018, smooth=3, tris=80, symmetric=True)
    knot.ellipsoid(CR + V((0, -0.05, -0.068)), (0.018, 0.014, 0.012))
    knot.limb(CR + V((0, -0.055, -0.07)), CR + V((0, -0.1, -0.075)), 0.01, 0.006, seg=8)
    add(knot)
    LAYERS.append(('scarf', ['head'], 0.006))

# ------------------------------------------------------------------------------------------------ torso
# the trunk is one smooth surface lofted through cross-sections from the waist to the base of the neck (a union of
# blobs, remeshed and decimated, shades lumpy at game triangle counts)
TORSO_RINGS = [   # height, half-width, depth in front, depth behind, centre z
    (0.455, 0.080, 0.062, 0.062, -0.004),
    (0.49, 0.084, 0.064, 0.064, -0.004),
    (0.53, 0.085, 0.066, 0.065, -0.004),     # waist
    (0.58, 0.092, 0.071, 0.067, -0.002),
    (0.62, 0.098, 0.073, 0.068, 0.0),         # chest
    (0.66, 0.104, 0.071, 0.066, -0.002),
    (0.695, 0.11, 0.063, 0.064, -0.006),     # shoulder line
    (0.72, 0.1, 0.055, 0.058, -0.009),
    (0.738, 0.072, 0.047, 0.052, -0.012),
    (0.752, 0.044, 0.036, 0.04, -0.012),     # base of the neck
]
if FEMALE:
    bust = {0.58: 0.008, 0.62: 0.016, 0.66: 0.009}
    TORSO_RINGS = [(y, w, f + bust.get(y, 0.0), b, z) for (y, w, f, b, z) in TORSO_RINGS]
torso = mk.Part('torso', 'torso', 'skin' if BARE else TUNIC, remesh=False)
torso.loft([((0, y, z), (1, 0, 0), (0, 0, 1), w, f, b) for (y, w, f, b, z) in TORSO_RINGS], seg=16 if LIGHT else 24, power=2.25)
add(torso)

# skirt: the tunic (to above the knee) or dress (to the ankles), skinned to the thighs
LONG = FEMALE or ROBE
skirt_bottom = 0.15 if LONG else 0.3     # the dress (or robe) falls to mid-calf
skirt = mk.Part('skirt', 'hips', TUNIC, voxel=0.0026, smooth=6, tris=520 if LONG else 360, symmetric=True)
skirt.ellipsoid((0, 0.49, -0.004), (0.09, 0.05, 0.068))                                       # waist
# one smooth flared shape from the hips to the hem (an A-line tunic, or a long dress widening to the ankles)
hem_r = 0.18 if LONG else 0.13
skirt.limb((0, 0.49, -0.004), (0, skirt_bottom, -0.004), 0.092, hem_r, seg=24, caps=False, flat=1.0)
skirt.ellipsoid((0, 0.485, -0.004), (0.093, 0.03, 0.074))                                     # smooth the top into the waist
# skirt.ellipsoid((0, 0.425, -0.002), (0.125 if FEMALE else 0.118, 0.065, 0.098))               # over the hips and tops of the thighs
skirt.ellipsoid((0, skirt_bottom - 0.05, -0.004), (0.3, 0.05, 0.3), cut=True)                 # open hem


def skirt_weight(p, s):
    """How much a skirt vertex follows the thigh on side s: nothing at the waist, the near side below the hips."""
    down = ss(0.48, 0.37, p[1])
    lateral = ss(-0.06, 0.06, s * p[0])
    return down * lateral


def skirt_masks(part):
    for s, side in ((1, 'L'), (-1, 'R')):
        part.mask('skirt' + side, lambda p, n, s=s: skirt_weight(p, s))


skirt_masks(skirt)
if not BARE:
    add(skirt)

belt = mk.Part('belt', 'hips', 'leather', remesh=False)
belt.loft([((0, y, -0.004), (1, 0, 0), (0, 0, 1), 0.098 + d, 0.078 + d, 0.078 + d) for y, d in ((0.476, 0.0), (0.48, 0.003), (0.5, 0.003), (0.504, 0.0))],
          seg=16 if LIGHT else 32, power=2.0, cap_start=False, cap_end=False)
add(belt)
LAYERS += [('belt', ['skirt'], 0.002)]

# ------------------------------------------------------------------------------------------------ legs
for s, side in ((1, 'L'), (-1, 'R')):
    hip, knee, ankle = HIP[s], KNEE[s], ANKLE[s]
    LSEG = 8 if LIGHT else 14
    thigh = mk.Part(f'thigh{side}', f'leg{side}', LEGS, remesh=False)
    capsule(thigh, hip, knee, [(0, 0.047), (0.2, 0.046), (0.4, 0.044), (0.7, 0.038), (1, 0.033)], LSEG)
    add(thigh)
    shin = mk.Part(f'shin{side}', f'knee{side}', LEGS, remesh=False)
    capsule(shin, knee, ankle, [(0, 0.032), (0.2, 0.031), (0.35, 0.031), (0.7, 0.025), (1, 0.022)], LSEG, fwd=(0, 0, -1))   # calf behind
    add(shin)
    wrap = mk.Part(f'wrap{side}', f'knee{side}', 'wrap', voxel=0.0022, smooth=3, tris=90)
    wrap.limb(knee.lerp(ankle, 0.35), ankle + V((0, 0.012, 0)), 0.029, 0.025, seg=12)         # leg wrappings
    add(wrap)
    LAYERS.append((f'wrap{side}', [f'shin{side}'], 0.003))
    # the sole must stay flat on the ground, so the light version keeps more of the foot (about 75 tris)
    foot = mk.Part(f'foot{side}', f'foot{side}', 'shoe', voxel=0.002, smooth=3, tris=200 if LIGHT else 120)
    foot.ball(ankle, 0.025)
    foot.limb(ankle + V((0, -0.02, -0.02)), ankle + V((0.004 * s, -0.03, 0.075)), 0.024, 0.022, seg=12, flat=1.2)
    foot.ellipsoid(ankle + V((0.004 * s, -0.035, 0.07)), (0.026, 0.014, 0.022))              # toes
    foot.ellipsoid(ankle + V((0, -0.034, -0.02)), (0.024, 0.016, 0.024))                    # heel
    add(foot)

# ------------------------------------------------------------------------------------------------ arms
for s, side in ((1, 'L'), (-1, 'R')):
    sh, el, wr = SH[s], EL[s], WR[s]
    ASEG = 8 if LIGHT else 14
    up = mk.Part(f'uparm{side}', f'arm{side}', 'skin', remesh=False)
    capsule(up, sh, el, [(0, 0.038), (0.25, 0.036), (0.6, 0.034), (0.85, 0.031), (1, 0.031)], ASEG)
    add(up)
    if not BARE:
        # a smooth sleeve lofted down the arm from a dome over the shoulder to an open hem
        axis = (el - sh).normalized()
        fwd = (V((0, 0, 1)) - axis * axis.z).normalized()
        lat = axis.cross(fwd)
        end = (el - sh).length * (0.7 if FEMALE else 0.98 if ROBE else 0.42)
        prof = [(-0.046, 0.012), (-0.04, 0.024), (-0.03, 0.033), (-0.015, 0.04), (0.005, 0.043), (0.03, 0.043),
                (end * 0.6, 0.041), (end, 0.039)]
        sleeve = mk.Part(f'sleeve{side}', f'arm{side}', TUNIC, remesh=False)
        sleeve.loft([(sh + axis * t, lat, fwd, r, r, r) for t, r in prof], seg=10 if LIGHT else 16, cap_end=False)
        add(sleeve)
        LAYERS.append((f'sleeve{side}', [f'uparm{side}'], 0.003))
    fore = mk.Part(f'forearm{side}', f'elbow{side}', 'skin', remesh=False)
    capsule(fore, el, wr, [(0, 0.031), (0.25, 0.031), (0.55, 0.026), (1, 0.021)], ASEG)
    add(fore)
    hand = mk.Part(f'hand{side}', f'hand{side}', 'skin', voxel=0.0018, smooth=3, tris=110)
    fist = wr + V((0.003 * s, -0.045, 0.008))
    hand.ball(wr, 0.022)
    hand.limb(wr, fist, 0.021, 0.02, seg=10, flat=0.75)
    hand.ellipsoid(fist, (0.02, 0.027, 0.026))                                                  # loosely closed hand
    hand.limb(wr + V((-0.012 * s, -0.012, 0.016)), fist + V((-0.014 * s, 0.0, 0.018)), 0.008, 0.007, seg=8)   # thumb
    add(hand)

# ------------------------------------------------------------------------------------------------ tools (in the right hand unless noted)
GRIP_R = WR[-1] + V((-0.003, -0.045, 0.008))       # centre of the right fist
GRIP_L = WR[1] + V((0.003, -0.045, 0.008))


def tool_part(name, mat, bone='handR'):
    return mk.Part(name, bone, mat, voxel=0.0016, smooth=2, tris=120)


def shaft(part, a, b, r0, r1):
    part.limb(a, b, r0, r1, seg=8)


# tools are laid out hanging from the fist along -y with the head's face forward (+z), then seated in the fist as a
# hand really holds them: the shaft runs front to back through the fist, the head on the thumb side (+z), and the head's
# face (edge, point, striking face) along the forearm (-y); the spear's head is on the thumb side too
SEAT = (GRIP_R, lambda o: (-o.x, -o.z, -o.y))
SEAT_SPEAR = (GRIP_R, lambda o: (o.x, -o.z, o.y))
# the hoe's top hand holds the end of the handle like a broom: the handle leaves the fist close to the forearm's line
# (26 degrees off it, towards the thumb), and the blade faces back towards the farmer
SEAT_HOE = (GRIP_R, lambda o: (-o.x, 0.9 * o.y - 0.44 * o.z, -0.44 * o.y - 0.9 * o.z))
down = V((0, -1, 0))
HELD, SHIELD = [], []
if KIT:
    CTX = dict(mk=mk, add=add, LAYERS=LAYERS, CR=CR, SH=SH, EL=EL, WR=WR, HIP=HIP, KNEE=KNEE, ANKLE=ANKLE,
               GRIP_R=GRIP_R, GRIP_L=GRIP_L, SEAT=SEAT, SEAT_SPEAR=SEAT_SPEAR, skirt_masks=skirt_masks,
               held=HELD, shield_parts=SHIELD, TORSO_RINGS=TORSO_RINGS, LIGHT=LIGHT)
    equipment.Kit(CTX, KIT).build()
    if 'nock_rest' in CTX:
        BONES.append({'name': 'nock', 'parent': 'handL', 'pivot': list(CTX['nock_rest'])})
    if KIT['relic']:
        relic = mk.Part('relic', 'carry', 'gold', voxel=0.002, smooth=2, tris=160)
        relic.ellipsoid(CARRY + V((0, -0.02, 0.0)), (0.075, 0.055, 0.055))
        relic.ball(CARRY + V((0, 0.05, 0.0)), 0.025)
        add(relic, 'relic')

if not KIT:
    axe_w, axe_i = tool_part('axehaft', 'wood'), tool_part('axehead', 'iron')
    shaft(axe_w, GRIP_R + V((0, 0.05, 0)), GRIP_R + V((0, -0.34, 0)), 0.011, 0.012)
    axe_i.ellipsoid(GRIP_R + V((0, -0.31, 0.04)), (0.009, 0.045, 0.045))
    axe_i.limb(GRIP_R + V((0, -0.31, 0.0)), GRIP_R + V((0, -0.31, 0.025)), 0.017, 0.013, seg=8)
    add(axe_w, 'tool:axe', SEAT)
    add(axe_i, 'tool:axe', SEAT)

    pick_w, pick_i = tool_part('pickhaft', 'wood'), tool_part('pickhead', 'iron')
    shaft(pick_w, GRIP_R + V((0, 0.05, 0)), GRIP_R + V((0, -0.36, 0)), 0.011, 0.012)
    pick_i.limb(GRIP_R + V((0, -0.34, -0.1)), GRIP_R + V((0, -0.34, 0.13)), 0.006, 0.014, seg=8)
    pick_i.cone(GRIP_R + V((0, -0.34, 0.12)), GRIP_R + V((0, -0.36, 0.17)), 0.012, seg=8)
    pick_i.cone(GRIP_R + V((0, -0.34, -0.09)), GRIP_R + V((0, -0.33, -0.12)), 0.007, seg=8)
    add(pick_w, 'tool:pick', SEAT)
    add(pick_i, 'tool:pick', SEAT)

    ham_w, ham_i = tool_part('hammerhaft', 'wood'), tool_part('hammerhead', 'iron')
    shaft(ham_w, GRIP_R + V((0, 0.035, 0)), GRIP_R + V((0, -0.19, 0)), 0.01, 0.011)
    ham_i.limb(GRIP_R + V((0, -0.19, -0.035)), GRIP_R + V((0, -0.19, 0.045)), 0.022, 0.022, seg=10)
    add(ham_w, 'tool:hammer', SEAT)
    add(ham_i, 'tool:hammer', SEAT)

    hoe_w, hoe_i = tool_part('hoehaft', 'wood'), tool_part('hoeblade', 'iron')
    shaft(hoe_w, GRIP_R + V((0, 0.012, 0)), GRIP_R + V((0, -0.6, 0)), 0.011, 0.012)
    hoe_i.ellipsoid(GRIP_R + V((0, -0.6, 0.045)), (0.04, 0.006, 0.05))
    hoe_i.limb(GRIP_R + V((0, -0.59, 0.0)), GRIP_R + V((0, -0.6, 0.02)), 0.012, 0.01, seg=8)
    add(hoe_w, 'tool:hoe', SEAT_HOE)
    add(hoe_i, 'tool:hoe', SEAT_HOE)

    sp_w, sp_i = tool_part('huntspear', 'wood'), tool_part('huntspearhead', 'iron')
    shaft(sp_w, GRIP_R + V((0, 0.3, 0)), GRIP_R + V((0, -0.55, 0)), 0.009, 0.009)
    sp_i.ellipsoid(GRIP_R + V((0, 0.34, 0)), (0.016, 0.045, 0.005))
    sp_i.cone(GRIP_R + V((0, 0.37, 0)), GRIP_R + V((0, 0.4, 0)), 0.01, seg=6)
    add(sp_w, 'tool:spear', SEAT_SPEAR)
    add(sp_i, 'tool:spear', SEAT_SPEAR)

    rod = tool_part('rod', 'wood')
    shaft(rod, GRIP_R + V((0, 0.08, 0)), GRIP_R + V((0, -0.72, 0.1)), 0.009, 0.004)
    add(rod, 'tool:rod', SEAT)
    line = mk.Part('rodline', 'rodtip', 'cord', remesh=False)
    line.tube([ROD_TIP + V((0, -LINE * i / 10, 0)) for i in range(11)], 0.0022, seg=4)
    line.mask('bob', lambda p, n: (ROD_TIP.y - p[1]) / LINE)
    add(line, 'tool:rod')

    basket = mk.Part('basket', 'handL', 'wicker', voxel=0.002, smooth=3, tris=160)
    bc = GRIP_L + V((0.01, -0.07, 0.02))
    basket.limb(bc + V((0, -0.045, 0)), bc + V((0, 0.045, 0)), 0.055, 0.07, seg=14, caps=False)
    basket.ellipsoid(bc + V((0, -0.045, 0)), (0.055, 0.012, 0.055))
    basket.ellipsoid(bc + V((0, 0.05, 0)), (0.06, 0.03, 0.06), cut=True)
    add(basket, 'tool:basket', (GRIP_L, lambda o: (o.z, o.y, -o.x)))
    handle = mk.Part('baskethandle', 'handL', 'wicker', remesh=False)
    handle.tube([bc + V((-0.06, 0.04, 0)), bc + V((-0.03, 0.1, 0)), GRIP_L + V((0, 0.0, 0)), bc + V((0.03, 0.1, 0)), bc + V((0.06, 0.04, 0))], 0.005, seg=5)
    add(handle, 'tool:basket', (GRIP_L, lambda o: (o.z, o.y, -o.x)))

    # ------------------------------------------------------------------------------------------------ carried goods (held in front of the chest)
    wood = mk.Part('carrywood', 'carry', 'wood', voxel=0.0022, smooth=3, tris=220)
    for i, (dx, dy) in enumerate(((0, 0), (0.03, 0.035), (-0.03, 0.035), (0.0, 0.07))):
        wood.limb(CARRY + V((-0.13, dy - 0.02, dx)), CARRY + V((0.13, dy - 0.02, dx + 0.01)), 0.024, 0.024, seg=10, caps=False)
    add(wood, 'carry:wood')
    logends = mk.Part('carrywoodends', 'carry', 'woodend', voxel=0.0018, smooth=1, tris=80)
    for dx, dy in ((0, 0), (0.03, 0.035), (-0.03, 0.035), (0.0, 0.07)):
        for sx in (-1, 1):
            logends.ellipsoid(CARRY + V((0.132 * sx, dy - 0.02, dx + (0.01 if sx > 0 else 0))), (0.004, 0.023, 0.023))
    add(logends, 'carry:wood')

    food = mk.Part('carryfood', 'carry', 'wicker', voxel=0.002, smooth=3, tris=160)
    food.limb(CARRY + V((0, -0.03, 0)), CARRY + V((0, 0.04, 0)), 0.07, 0.085, seg=14, caps=False)
    food.ellipsoid(CARRY + V((0, -0.03, 0)), (0.07, 0.012, 0.07))
    food.ellipsoid(CARRY + V((0, 0.045, 0)), (0.075, 0.025, 0.075), cut=True)
    add(food, 'carry:food')
    meat = mk.Part('carrymeat', 'carry', 'meat', voxel=0.002, smooth=3, tris=120)
    meat.ellipsoid(CARRY + V((0, 0.04, 0)), (0.07, 0.035, 0.065))
    add(meat, 'carry:food')

    gold = mk.Part('carrygold', 'carry', 'sack', voxel=0.002, smooth=4, tris=160)
    gold.ellipsoid(CARRY + V((0, 0.0, 0)), (0.08, 0.065, 0.06))
    gold.limb(CARRY + V((0, 0.05, 0)), CARRY + V((0, 0.085, 0)), 0.03, 0.02, seg=10)
    add(gold, 'carry:gold')
    nug = mk.Part('carrygoldnuggets', 'carry', 'gold', voxel=0.0018, smooth=2, tris=80)
    nug.ellipsoid(CARRY + V((0.02, 0.1, 0.005)), (0.02, 0.016, 0.018))
    nug.ellipsoid(CARRY + V((-0.015, 0.098, -0.008)), (0.015, 0.013, 0.015))
    add(nug, 'carry:gold')

    stone = mk.Part('carrystone', 'carry', 'stone', voxel=0.0022, smooth=3, tris=120)
    stone.ellipsoid(CARRY + V((0, 0.005, 0)), (0.09, 0.055, 0.065))
    add(stone, 'carry:stone')

# ------------------------------------------------------------------------------------------------ layers and export
by_name = {o.name: o for o in parts}
GAP = 1.6 if LIGHT else 1.0
for outer, inners, gap in LAYERS:
    inners = [n for n in inners if n in by_name]
    if outer not in by_name or not inners:
        continue
    o, i = mk.separate(by_name[outer], [by_name[n] for n in inners], gap * GAP)
    print(f'LAYER {outer:<10} over {"+".join(inners):<10} moved {o:4d} out, {i:4d} underneath in')
# the tunic or dress hangs over the thighs: keep it clear of them at rest
for side in ('L', 'R'):
    if 'skirt' not in by_name:
        break
    o, i = mk.separate(by_name['skirt'], [by_name['thigh' + side]], 0.006 * GAP)
    print(f'LAYER skirt      over thigh{side}     moved {o:4d} out, {i:4d} underneath in')

# shading is baked for the body alone, then for each tool or load against the body (they are never all shown at once)
base = [o for o in parts if not o.get('variant')]
ao = mk.bake_ao(base, dist=0.2, near=0.03)
for v in sorted({o['variant'] for o in parts if o.get('variant')}):
    group = [o for o in parts if o.get('variant') == v]
    ao.update(mk.bake_ao(group, dist=0.2, near=0.03, occluders=base))
tris = mk.export_model(parts, ao, BONES, out_path, variants={o.name: o.get('variant') for o in parts})
if KIT:
    # which parts are held (weapons in the hands, the shield), for the clearance checks and the poses
    import json
    with open(out_path) as f:
        data = json.load(f)
    data['kit'] = dict(KIT, name=KIT_NAME, held=HELD, shield=[n for n in SHIELD if n in by_name])
    with open(out_path, 'w') as f:
        json.dump(data, f)
print(f'EXPORTED {out_path}: {len(parts)} parts, {tris} triangles '
      f'(base body {sum(len(p.data.polygons) for p in parts if not p.get("variant"))} faces)')

if preview_path:
    PAL = {'skin': (0.62, 0.36, 0.2), 'team': (0.04, 0.1, 0.62), 'team2': (0.55, 0.52, 0.45), 'leather': (0.25, 0.12, 0.05),
           'wrap': (0.35, 0.28, 0.18), 'shoe': (0.12, 0.07, 0.035), 'wood': (0.22, 0.12, 0.05), 'iron': (0.45, 0.47, 0.5),
           'cord': (0.6, 0.55, 0.45), 'wicker': (0.5, 0.35, 0.15), 'woodend': (0.6, 0.45, 0.25), 'meat': (0.5, 0.08, 0.06),
           'sack': (0.4, 0.3, 0.18), 'gold': (0.85, 0.6, 0.1), 'stone': (0.45, 0.44, 0.42),
           'linen': (0.7, 0.66, 0.56), 'legs': (0.28, 0.2, 0.12), 'steel': (0.55, 0.57, 0.6), 'mail': (0.35, 0.36, 0.38),
           'bronze': (0.62, 0.42, 0.14), 'darkleather': (0.12, 0.07, 0.04), 'lacquer': (0.35, 0.06, 0.04), 'fur': (0.3, 0.3, 0.28),
           'feather': (0.8, 0.8, 0.72), 'turban': (0.75, 0.7, 0.6), 'hood': (0.22, 0.28, 0.12), 'hat': (0.15, 0.1, 0.06),
           'darksteel': (0.2, 0.2, 0.22)}
    HAIR, BEARD = (0.08, 0.04, 0.02), (0.07, 0.035, 0.02)
    colors = {}
    shown = []
    for o in parts:
        v = o.get('variant')
        if v and v not in ('tool:axe', 'carry:wood'):
            o.hide_render = True
            continue
        m = mk.vertex_masks(o)
        cols = []
        for i_, a in enumerate(ao[o.name]):
            c = PAL[o['mat']]
            for key, col in (('hair', HAIR), ('beard', BEARD)):
                if key in m:
                    w = m[key][i_]
                    c = tuple(c[j] * (1 - w) + col[j] * w for j in range(3))
            cols.append(tuple(x * (0.25 + 0.75 * a ** 1.2) for x in c))
        colors[o.name] = cols
        shown.append(o)
    paths = mk.preview(shown, colors, preview_path, center=(0, 0.46, 0), size=1.05,
                       views=(('iso', 45.0, 30.0), ('front', 0.0, 5.0), ('side', 90.0, 5.0), ('back', 180.0, 10.0),
                              ('face', 0.0, 5.0, (0, 0.83, 0.0), 0.2), ('profile', 90.0, 5.0, (0, 0.83, 0.0), 0.2)))
    print('PREVIEW', paths)
