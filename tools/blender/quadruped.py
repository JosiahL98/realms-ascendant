"""
Animals: sheep, deer, boar and wolf. Run:
  blender --background --factory-startup --python tools/blender/quadruped.py -- <species> <out.json> [preview.png] [--tris 0.38]

Same skeleton scheme as the horse (horse.py), so the same gait solver (tools/review/horse-gait.cjs) and the game's bend
skinning drive them: bones root, body, neck, tail, and per leg three jointed segments legXY (upper leg, part of the
body mesh by weight), legXY2 (cannon, below the knee or hock) and legXY3 (pastern and hoof, or paw). The neck and
head are part of the body mesh and bend by a 'neck' weight about the neck pivot. The animal faces +z with its feet on
y = 0 and its left side towards +x.

Colour masks (the baker colours them): points (darker lower legs, face or muzzle), belly (lighter underside), wool
(the sheep's fleece), rump (the deer's white rump), saddle (the wolf's darker back), nose, hoof. Separate parts: eyes
('eye'), antlers and tusks ('horn'), the boar's bristles ('bristle').
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import modelkit as mk  # noqa: E402
from mathutils import Vector, noise  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
flags = {}
while len(args) >= 2 and args[-2].startswith('--'):
    flags[args[-2][2:]] = float(args[-1])
    args = args[:-2]
SPECIES, out_path = args[0], args[1]
preview_path = args[2] if len(args) > 2 else None
mk.TRI_SCALE = flags.get('tris', 1.0)
mk.reset_scene()
ss = mk.smoothstep
V = Vector

# ------------------------------------------------------------------------------------------------ proportions
# legY: upper leg pivots (shoulder / hip joint, inside the body); knee: front knee (carpus) and hind hock heights;
# fet: fetlock (or paw) joint; FZ / BZ: fore and hind leg positions along the body; LX: half the track width;
# neck: pivot and the direction up the neck (y, z); tail: pivot.
SP = {
    'sheep': dict(H=0.4, legY=0.25, kneeF=0.135, kneeB=0.15, fet=0.042, FZ=0.15, BZ=-0.17, LX=0.062,
                  neck=(0.3, 0.19), neckAxis=(0.6, 0.8), tail=(0.3, -0.27), foot='hoof'),
    'deer': dict(H=0.58, legY=0.37, kneeF=0.2, kneeB=0.23, fet=0.056, FZ=0.17, BZ=-0.19, LX=0.058,
                 neck=(0.47, 0.21), neckAxis=(0.8, 0.6), tail=(0.5, -0.29), foot='hoof'),
    'boar': dict(H=0.44, legY=0.22, kneeF=0.12, kneeB=0.135, fet=0.038, FZ=0.15, BZ=-0.2, LX=0.07,
                 neck=(0.33, 0.21), neckAxis=(0.25, 0.97), tail=(0.33, -0.33), foot='hoof'),
    'wolf': dict(H=0.44, legY=0.28, kneeF=0.1, kneeB=0.15, fet=0.036, FZ=0.16, BZ=-0.19, LX=0.055,
                 neck=(0.37, 0.2), neckAxis=(0.55, 0.83), tail=(0.36, -0.26), foot='paw'),
    # mounts: a dromedary (ridden over its hump) and a war elephant (a driver on its neck, a howdah on its back)
    'camel': dict(H=0.9, legY=0.6, kneeF=0.33, kneeB=0.36, fet=0.075, FZ=0.25, BZ=-0.27, LX=0.085, legR=1.4,
                  neck=(0.76, 0.3), neckAxis=(0.15, 0.99), neckRamp=(-0.05, 0.14), tail=(0.78, -0.36), foot='pad'),
    'elephant': dict(H=1.2, legY=0.74, kneeF=0.4, kneeB=0.42, fet=0.1, FZ=0.33, BZ=-0.35, LX=0.16, legR=3.1,
                     neck=(1.0, 0.38), neckAxis=(0.3, 0.95), neckRamp=(-0.06, 0.1), tail=(0.98, -0.62), foot='pillar'),
}[SPECIES]
LEG_Y, FET, FZ, BZ, LX = SP['legY'], SP['fet'], SP['FZ'], SP['BZ'], SP['LX']
# the lower joints sit a little forward (fore knee) or back (hock) of the upper pivots, as in the horse
KNEE = {'F': (SP['kneeF'], FZ + 0.012), 'B': (SP['kneeB'], BZ - 0.05 * SP['H'] / 0.44)}
FETZ = {'F': FZ + 0.025, 'B': BZ - 0.02}
BONES = [
    {'name': 'root', 'parent': None, 'pivot': [0, 0, 0]},
    {'name': 'body', 'parent': 'root', 'pivot': [0, round(SP['H'] * 0.78, 4), 0]},
    {'name': 'neck', 'parent': 'body', 'pivot': [0, SP['neck'][0], SP['neck'][1]]},
    {'name': 'tail', 'parent': 'body', 'pivot': [0, SP['tail'][0], SP['tail'][1]]},
]
for side, x in (('L', LX), ('R', -LX)):
    for fb, z in (('F', FZ), ('B', BZ)):
        BONES += [
            {'name': f'leg{fb}{side}', 'parent': 'body', 'pivot': [x, LEG_Y, z]},
            {'name': f'leg{fb}{side}2', 'parent': f'leg{fb}{side}', 'pivot': [x, KNEE[fb][0], KNEE[fb][1]]},
            {'name': f'leg{fb}{side}3', 'parent': f'leg{fb}{side}2', 'pivot': [x, FET, FETZ[fb]]},
        ]
NECK_PIVOT = V((0, SP['neck'][0], SP['neck'][1]))
NECK_AXIS = V(SP['neckAxis']).normalized()   # (y, z) up the neck


NECK_RAMP = SP.get('neckRamp', (-0.03, 0.08))


def neck_weight(p):
    t = (p[1] - NECK_PIVOT.y) * NECK_AXIS[0] + (p[2] - NECK_PIVOT.z) * NECK_AXIS[1]
    return ss(NECK_RAMP[0], NECK_RAMP[1], t)


parts = []
body = mk.Part('body', 'body', 'coat', voxel=0.0022, smooth=9, tris=2600)
horn = mk.Part('horn', 'body', 'horn', voxel=0.0016, smooth=3, tris=260)
eyes = mk.Part('eyes', 'body', 'eye', voxel=0.0016, smooth=1, tris=60)
HAS_HORN = False
HEAD = {}   # named points of the head, for the masks


# ------------------------------------------------------------------------------------------------ species
if SPECIES == 'sheep':
    # a round fleece over a slight body; a narrow dark face and legs; ears held out sideways
    for c, r in (((0, 0.3, -0.01), (0.135, 0.12, 0.23)), ((0, 0.305, 0.09), (0.125, 0.115, 0.13)),
                 ((0, 0.3, -0.13), (0.125, 0.11, 0.12)), ((0, 0.33, 0.0), (0.1, 0.09, 0.2))):
        body.ellipsoid(c, r)
    # fleece locks: small bumps over the surface
    for i in range(70):
        a = 2 * math.pi * ((i * 0.618) % 1.0)
        z = -0.22 + 0.42 * ((i * 0.37) % 1.0)
        y = 0.3 + 0.1 * math.cos(a)
        x = 0.11 * math.sin(a)
        if y < 0.225:
            continue
        body.ball((x, y, z), 0.026)   # just breaking the surface: a soft, even texture
    body.chain([(0, 0.32, 0.19), (0, 0.36, 0.25), (0, 0.39, 0.29)], [0.055, 0.045, 0.04])             # neck
    head_c = V((0, 0.4, 0.305))
    body.ellipsoid(head_c + V((0, 0.01, -0.005)), (0.04, 0.042, 0.045))                              # poll, woolly
    body.limb(head_c + V((0, 0.0, 0.015)), head_c + V((0, -0.035, 0.072)), 0.032, 0.021, flat=0.85)   # face
    body.ball(head_c + V((0, -0.036, 0.074)), 0.019)                                                 # muzzle
    for s in (1, -1):
        body.limb(head_c + V((0.03 * s, 0.015, 0.0)), head_c + V((0.085 * s, 0.0, -0.01)), 0.014, 0.01, flat=0.5)   # ears
        eyes.ellipsoid(head_c + V((0.029 * s, 0.004, 0.03)), (0.006, 0.007, 0.008))
    HEAD = dict(face=head_c)
    body.limb((0, 0.33, -0.24), (0, 0.27, -0.29), 0.035, 0.025)                                     # tail stub

    def wool(p, n):
        # the fleece: the trunk and poll, not the face, ears or legs
        return ss(0.2, 0.235, p[1]) * ss(0.26, 0.22, p[2] - 0.35 * max(0.0, p[1] - 0.38)) * ss(0.052, 0.045, abs(p[0])
                                                                                           if p[2] > 0.26 else 0.0)

elif SPECIES == 'deer':
    # a red deer stag: slender, deep in the chest, long legs and neck, big ears and branching antlers
    for c, r in (((0, 0.455, -0.01), (0.095, 0.11, 0.24)), ((0, 0.45, 0.12), (0.09, 0.115, 0.12)),
                 ((0, 0.47, -0.16), (0.092, 0.1, 0.12)), ((0, 0.52, 0.12), (0.045, 0.06, 0.1)),
                 ((0, 0.42, 0.0), (0.085, 0.08, 0.2))):
        body.ellipsoid(c, r)
    for s in (1, -1):
        body.ellipsoid((0.06 * s, 0.45, 0.14), (0.04, 0.09, 0.06), rot=(-0.4, 0, 0))                  # shoulders
        body.ellipsoid((0.058 * s, 0.45, -0.18), (0.045, 0.1, 0.085))                                 # haunches
    body.chain([(0, 0.47, 0.19), (0, 0.56, 0.25), (0, 0.65, 0.3), (0, 0.72, 0.325)], [0.072, 0.058, 0.048, 0.04], flat=0.78)
    head_c = V((0, 0.76, 0.335))
    body.ellipsoid(head_c, (0.038, 0.04, 0.048))                                                     # cranium
    body.limb(head_c + V((0, -0.005, 0.02)), head_c + V((0, -0.045, 0.125)), 0.032, 0.019, flat=0.85)   # face
    body.ellipsoid(head_c + V((0, -0.05, 0.128)), (0.02, 0.019, 0.022))                              # muzzle
    for s in (1, -1):
        body.cone(head_c + V((0.025 * s, 0.025, -0.01)), head_c + V((0.075 * s, 0.07, -0.035)), 0.02, seg=12, flat=0.45)   # ears
        eyes.ellipsoid(head_c + V((0.033 * s, 0.0, 0.03)), (0.007, 0.008, 0.009))
        # antlers: a beam back and up with brow, bez and top tines
        base = head_c + V((0.018 * s, 0.035, -0.006))
        beam = [base, base + V((0.03 * s, 0.07, -0.03)), base + V((0.06 * s, 0.14, -0.04)), base + V((0.07 * s, 0.22, -0.02))]
        horn.chain(beam, [0.009, 0.008, 0.007, 0.005], seg=8)
        for k, (d, L) in enumerate(((V((0.01 * s, 0.03, 0.06)), 1.0), (V((0.015 * s, 0.035, 0.05)), 0.8), (V((0.0, 0.05, 0.03)), 0.7))):
            root_ = beam[k] + (beam[k + 1] - beam[k]) * 0.3
            horn.cone(root_, root_ + d * L, 0.0065, seg=6)
    HAS_HORN = True
    HEAD = dict(face=head_c)
    body.limb((0, 0.5, -0.28), (0, 0.46, -0.31), 0.022, 0.016, flat=0.7)                           # tail

elif SPECIES == 'boar':
    # heavy forequarters with a bristly ridge, short legs, a long wedge of a head with a snout disc and tusks
    for c, r in (((0, 0.33, 0.07), (0.11, 0.13, 0.17)), ((0, 0.3, -0.07), (0.1, 0.115, 0.2)),
                 ((0, 0.3, -0.22), (0.09, 0.1, 0.11)), ((0, 0.25, -0.02), (0.09, 0.08, 0.22)),
                 ((0, 0.38, 0.05), (0.07, 0.07, 0.15))):
        body.ellipsoid(c, r)
    for s in (1, -1):
        body.ellipsoid((0.065 * s, 0.29, 0.13), (0.05, 0.1, 0.075), rot=(-0.3, 0, 0))                  # shoulders
        body.ellipsoid((0.06 * s, 0.28, -0.22), (0.045, 0.09, 0.07))                                  # hams
    head_c = V((0, 0.31, 0.29))
    body.limb((0, 0.35, 0.18), (0, 0.33, 0.25), 0.1, 0.085, flat=0.85)                             # neck, thick
    body.ellipsoid(head_c, (0.062, 0.078, 0.07))                                                     # back of the head
    body.limb(head_c + V((0, -0.01, 0.01)), head_c + V((0, -0.07, 0.125)), 0.058, 0.028, flat=0.8)   # face, a wedge
    body.limb(head_c + V((0, -0.072, 0.125)), head_c + V((0, -0.075, 0.137)), 0.027, 0.026, flat=0.8)   # snout disc
    for s in (1, -1):
        body.cone(head_c + V((0.035 * s, 0.05, -0.02)), head_c + V((0.05 * s, 0.1, -0.03)), 0.022, seg=10, flat=0.5)   # ears
        eyes.ellipsoid(head_c + V((0.038 * s, 0.012, 0.04)), (0.006, 0.006, 0.007))
        # tusks: out of the corners of the mouth, curving up and back
        root_ = head_c + V((0.021 * s, -0.07, 0.1))
        horn.chain([root_, root_ + V((0.012 * s, 0.018, 0.012)), root_ + V((0.018 * s, 0.04, 0.0))], [0.007, 0.005, 0.002], seg=6)
    HAS_HORN = True
    HEAD = dict(face=head_c, snout=head_c + V((0, -0.075, 0.14)))
    body.limb((0, 0.33, -0.31), (0, 0.22, -0.35), 0.012, 0.008)                                     # tail
    bristle = mk.Part('bristle', 'body', 'bristle', voxel=0.0022, smooth=3, tris=200)
    bristle.chain([(0, 0.425, 0.17), (0, 0.44, 0.07), (0, 0.42, -0.05), (0, 0.385, -0.17)], [0.018, 0.026, 0.02, 0.01], flat=0.45)
    bristle.mask('neck', lambda p, n: neck_weight(p))
    parts.append(bristle.build())

elif SPECIES == 'camel':
    # a dromedary: long legs, one hump, a long neck dipping forward and rising to a small head with a drooping lip
    for c, r in (((0, 0.72, -0.02), (0.13, 0.13, 0.3)), ((0, 0.69, 0.19), (0.11, 0.14, 0.13)),
                 ((0, 0.74, -0.24), (0.11, 0.12, 0.12)), ((0, 0.63, 0.0), (0.11, 0.08, 0.22)),
                 ((0, 0.87, -0.05), (0.105, 0.19, 0.2))):
        body.ellipsoid(c, r)
    body.ellipsoid((0, 0.555, 0.17), (0.055, 0.04, 0.07))                                          # chest pad
    for s in (1, -1):
        body.ellipsoid((0.075 * s, 0.7, 0.2), (0.045, 0.12, 0.07), rot=(-0.3, 0, 0))                  # shoulders
        body.ellipsoid((0.075 * s, 0.72, -0.26), (0.05, 0.12, 0.09))                                 # thighs
    body.chain([(0, 0.8, 0.28), (0, 0.74, 0.43), (0, 0.78, 0.56), (0, 0.9, 0.64), (0, 0.99, 0.67)],
               [0.085, 0.062, 0.052, 0.046, 0.042], flat=0.72)                                        # neck
    head_c = V((0, 1.02, 0.7))
    body.ellipsoid(head_c, (0.045, 0.05, 0.055))                                                     # cranium
    body.limb(head_c + V((0, -0.01, 0.02)), head_c + V((0, -0.04, 0.13)), 0.038, 0.028, flat=0.85)   # face
    body.ellipsoid(head_c + V((0, -0.058, 0.13)), (0.03, 0.022, 0.035))                              # drooping lip
    for s in (1, -1):
        body.cone(head_c + V((0.03 * s, 0.035, -0.02)), head_c + V((0.042 * s, 0.065, -0.035)), 0.014, seg=8)   # ears
        eyes.ellipsoid(head_c + V((0.038 * s, 0.012, 0.03)), (0.007, 0.008, 0.009))
    HEAD = dict(face=head_c, muzzle=head_c + V((0, -0.04, 0.13)), poll=head_c + V((0, 0.03, -0.02)))
    body.limb((0, 0.8, -0.35), (0, 0.6, -0.39), 0.018, 0.012)                                     # tail
    body.ellipsoid((0, 0.57, -0.395), (0.018, 0.04, 0.016))                                        # tuft

elif SPECIES == 'elephant':
    # a war elephant: a massive barrel on pillar legs, a domed head with great ears, tusks, and a trunk on two bones
    for c, r in (((0, 0.9, -0.02), (0.29, 0.3, 0.47)), ((0, 0.97, 0.25), (0.27, 0.28, 0.2)),
                 ((0, 0.93, -0.32), (0.26, 0.26, 0.2)), ((0, 1.07, -0.02), (0.18, 0.12, 0.36)),
                 ((0, 0.78, 0.0), (0.25, 0.14, 0.36))):
        body.ellipsoid(c, r)
    head_c = V((0, 1.06, 0.56))
    body.limb((0, 1.0, 0.36), head_c, 0.22, 0.2, flat=0.9)                                          # neck
    body.ellipsoid(head_c, (0.19, 0.22, 0.19))                                                       # head
    body.ellipsoid(head_c + V((0, 0.1, 0.06)), (0.13, 0.12, 0.12))                                   # dome of the forehead
    body.limb(head_c + V((0, -0.06, 0.12)), head_c + V((0, -0.16, 0.17)), 0.12, 0.09, flat=0.9)     # base of the trunk
    for s in (1, -1):
        eyes.ellipsoid(head_c + V((0.15 * s, 0.0, 0.11)), (0.012, 0.012, 0.014))
    HEAD = dict(face=head_c)
    body.limb((0, 1.0, -0.47), (0, 0.9, -0.54), 0.04, 0.03)                                        # root of the tail
    body.limb((0, 0.9, -0.54), (0, 0.62, -0.58), 0.03, 0.018)                                      # tail
    body.ellipsoid((0, 0.6, -0.582), (0.02, 0.04, 0.02))                                           # tuft
    # tusks, curving forward and up from under the trunk
    for s in (1, -1):
        root_ = head_c + V((0.08 * s, -0.16, 0.12))
        horn.chain([root_, root_ + V((0.02 * s, -0.12, 0.12)), root_ + V((0.03 * s, -0.12, 0.26)), root_ + V((0.03 * s, -0.06, 0.34))],
                   [0.032, 0.026, 0.018, 0.006], seg=8)
    HAS_HORN = True
    # the trunk on its own two bones (children of the neck), hanging to near the ground
    T0, T1, T2 = head_c + V((0, -0.14, 0.17)), V((0, 0.55, 0.8)), V((0, 0.2, 0.77))
    BONES += [{'name': 'trunk', 'parent': 'neck', 'pivot': list(T0)}, {'name': 'trunk2', 'parent': 'trunk', 'pivot': list(T1)}]
    tr1 = mk.Part('trunk', 'trunk', 'coat', voxel=0.003, smooth=4, tris=220)
    tr1.limb(T0, T1, 0.09, 0.062, flat=0.95)
    tr1.ball(T1, 0.062)
    tr2 = mk.Part('trunk2', 'trunk2', 'coat', voxel=0.0025, smooth=4, tris=180)
    tr2.ball(T1, 0.06)
    tr2.limb(T1, T2, 0.06, 0.036, flat=0.95)
    tr2.ellipsoid(T2 + V((0, -0.01, 0.01)), (0.038, 0.02, 0.038))
    parts.extend([tr1.build(), tr2.build()])
    # ears on their own bones, so they can flap
    for s, side in ((1, 'L'), (-1, 'R')):
        ep = head_c + V((0.14 * s, 0.1, -0.06))
        BONES.append({'name': 'ear' + side, 'parent': 'neck', 'pivot': list(ep)})
        ear = mk.Part('ear' + side, 'ear' + side, 'coat', voxel=0.003, smooth=5, tris=200)
        ear.ellipsoid(ep + V((0.05 * s, -0.12, -0.08)), (0.025, 0.2, 0.16), rot=(0.2, 0.35 * s, 0))
        ear.mask('inner', lambda p, n, s=s: ss(0.0, 0.5, n[2]))
        parts.append(ear.build())

else:  # wolf
    # deep chest and a ruff at the neck, a narrow waist, long legs, a long muzzle, erect ears and a bushy tail
    for c, r in (((0, 0.34, 0.1), (0.078, 0.105, 0.14)), ((0, 0.345, -0.06), (0.065, 0.08, 0.14)),
                 ((0, 0.35, -0.18), (0.07, 0.08, 0.09)), ((0, 0.39, 0.17), (0.08, 0.1, 0.085))):
        body.ellipsoid(c, r)
    for s in (1, -1):
        body.ellipsoid((0.05 * s, 0.33, 0.13), (0.035, 0.085, 0.06), rot=(-0.4, 0, 0))               # shoulders
        body.ellipsoid((0.048 * s, 0.33, -0.19), (0.04, 0.085, 0.07))                                 # thighs
    head_c = V((0, 0.46, 0.3))
    body.limb((0, 0.4, 0.2), head_c + V((0, -0.01, -0.01)), 0.07, 0.05, flat=0.9)                   # neck
    body.ellipsoid(head_c, (0.05, 0.045, 0.052))                                                     # cranium
    body.limb(head_c + V((0, -0.008, 0.03)), head_c + V((0, -0.028, 0.12)), 0.032, 0.017, flat=0.85)   # muzzle
    body.ellipsoid(head_c + V((0, -0.035, 0.06)), (0.03, 0.02, 0.05))                               # lower jaw
    for s in (1, -1):
        body.ellipsoid(head_c + V((0.038 * s, -0.015, 0.03)), (0.02, 0.022, 0.03))                    # cheeks
        body.cone(head_c + V((0.026 * s, 0.03, -0.01)), head_c + V((0.034 * s, 0.085, -0.02)), 0.018, seg=10, flat=0.55)   # ears
        eyes.ellipsoid(head_c + V((0.026 * s, 0.013, 0.04)), (0.006, 0.006, 0.007))
    HEAD = dict(face=head_c, nose=head_c + V((0, -0.026, 0.126)))
    body.chain([(0, 0.37, -0.25), (0, 0.3, -0.31), (0, 0.2, -0.34), (0, 0.13, -0.34)], [0.03, 0.036, 0.034, 0.014], flat=0.9)   # tail

# ------------------------------------------------------------------------------------------------ legs
H = SP['H']
k_r = SP.get('legR', H / 0.44)   # leg thickness scale


def upper_leg(fb, s):
    """The forearm or gaskin: part of the body mesh, weighted to the upper leg bone."""
    x, z = LX * s, FZ if fb == 'F' else BZ
    ky, kz = KNEE[fb]
    pillar = SP['foot'] == 'pillar'
    if fb == 'F':
        body.limb((x, LEG_Y + 0.01, z), (x, ky, kz), 0.034 * k_r, (0.031 if pillar else 0.02) * k_r, flat=0.85)
        body.ellipsoid((x, (LEG_Y + ky) / 2 + 0.01, z), (0.028 * k_r, (LEG_Y - ky) * 0.45, 0.032 * k_r))
    else:
        body.limb((x, LEG_Y + 0.03, z + 0.01), (x, ky, kz), 0.042 * k_r, (0.031 if pillar else 0.019) * k_r, flat=0.8)
        body.ellipsoid((x, LEG_Y - 0.01, z - 0.005), (0.032 * k_r, (LEG_Y - ky) * 0.5, 0.04 * k_r), rot=(0.25, 0, 0))


def lower_leg(fb, side, s):
    x = LX * s
    ky, kz = KNEE[fb]
    fz = FETZ[fb]
    pillar = SP['foot'] == 'pillar'   # an elephant's leg is a column all the way down
    r_knee, r_can, r_fet = (0.031, 0.029, 0.029) if pillar else (0.02, 0.017, 0.017)
    vox = 0.003 if pillar else 0.0018
    lo = mk.Part(f'leg{fb}{side}2', f'leg{fb}{side}2', 'coat', voxel=vox, smooth=4, tris=110)
    lo.ball((x, ky, kz), r_knee * k_r)
    lo.limb((x, ky, kz), (x, FET, fz), r_can * k_r, (r_fet - 0.003) * k_r, flat=0.85 if not pillar else 1.0)
    lo.ball((x, FET, fz), r_fet * k_r)
    foot = mk.Part(f'leg{fb}{side}3', f'leg{fb}{side}3', 'coat', voxel=vox, smooth=3, tris=110)
    foot.ball((x, FET, fz), (r_fet - 0.001) * k_r)
    if SP['foot'] == 'hoof':
        # pastern and a cloven hoof
        hz = fz + 0.02 * k_r
        foot.limb((x, FET, fz), (x, 0.016, hz), 0.014 * k_r, 0.015 * k_r)
        for t in (1, -1):
            foot.ellipsoid((x + 0.008 * t * k_r, 0.012, hz + 0.004), (0.009 * k_r, 0.012, 0.018 * k_r))
        foot.mask('hoof', lambda p, n: ss(0.03, 0.022, p[1]))
    elif SP['foot'] == 'pad':
        # the camel's broad, two-toed pad
        pz = fz + 0.02
        foot.limb((x, FET, fz), (x, 0.03, pz), 0.02 * k_r, 0.024 * k_r)
        foot.ellipsoid((x, 0.018, pz + 0.012), (0.042, 0.018, 0.052))
        for t in (1, -1):
            foot.ellipsoid((x + 0.018 * t, 0.012, pz + 0.05), (0.014, 0.01, 0.014))   # toenails
        foot.mask('hoof', lambda p, n, pz=pz: ss(0.03, 0.045, p[2] - pz) * ss(0.02, 0.012, p[1]))
    elif SP['foot'] == 'pillar':
        # a round pillar of a foot with toenails round its front
        foot.limb((x, FET, fz), (x, 0.03, fz + 0.01), 0.028 * k_r, 0.032 * k_r)
        foot.ellipsoid((x, 0.03, fz + 0.01), (0.033 * k_r, 0.03, 0.034 * k_r))
        foot.mask('hoof', lambda p, n, fz=fz: ss(0.4, 0.8, n[2]) * ss(0.06, 0.03, p[1]))
    else:
        # a paw with toes
        pz = fz + 0.018 * k_r
        foot.limb((x, FET, fz), (x, 0.016, pz), 0.015 * k_r, 0.017 * k_r)
        foot.ellipsoid((x, 0.013, pz + 0.008), (0.02 * k_r, 0.013, 0.026 * k_r))
        for t in (-1.5, -0.5, 0.5, 1.5):
            foot.ball((x + 0.008 * t * k_r, 0.009, pz + 0.028 * k_r - 0.004 * abs(t)), 0.008 * k_r)
    return lo, foot


for side, s in (('L', 1), ('R', -1)):
    for fb in ('F', 'B'):
        upper_leg(fb, s)
        for piece in lower_leg(fb, side, s):
            if SPECIES not in ('camel', 'elephant'):
                piece.mask('points', lambda p, n: 1.0 if SPECIES in ('sheep', 'boar') else ss(0.2, 0.08, p[1]))
            if SPECIES == 'deer':
                piece.mask('belly', lambda p, n: ss(0.3, -0.3, n[2]) * 0.3 * ss(0.05, 0.15, p[1]))   # paler behind the legs
            parts.append(piece.build())


def leg_weight(p, fb, s):
    """How much a body vertex follows the upper leg (as in horse.py): below the joint, near the leg's own axis."""
    pz = FZ if fb == 'F' else BZ
    ky, kz = KNEE[fb]
    k = (LEG_Y - p[1]) / (LEG_Y - ky)
    axis_z = pz + (kz - pz) * k
    r = math.hypot(p[0] - s * LX, p[2] - axis_z)
    rr = 0.055 * k_r if fb == 'F' else 0.065 * k_r
    radial = ss(rr, rr * 0.7, r)
    band = ss(LEG_Y + 0.01, LEG_Y - 0.04 * k_r, p[1]) * radial
    below = ss(LEG_Y - 0.03 * k_r, LEG_Y - 0.07 * k_r, p[1]) * ss(0.01, 0.03, s * p[0]) * ss(0.1 * k_r, 0.07 * k_r, abs(p[2] - axis_z))
    return max(band, below)


for k, fb, s in (('legFL', 'F', 1), ('legFR', 'F', -1), ('legBL', 'B', 1), ('legBR', 'B', -1)):
    body.mask(k, lambda p, n, fb=fb, s=s: leg_weight(p, fb, s))
body.mask('neck', lambda p, n: neck_weight(p))
face = HEAD['face']
if SPECIES == 'sheep':
    body.mask('wool', wool)
    body.mask('points', lambda p, n: max(ss(LEG_Y - 0.01, LEG_Y - 0.05, p[1]), 1 - wool(p, n)) * (1.0 - ss(0.05, 0.3, p[1]) * 0.0))
elif SPECIES == 'deer':
    body.mask('belly', lambda p, n: ss(-0.2, -0.75, n[1]) * ss(0.3, 0.5, p[1]))
    body.mask('rump', lambda p, n: ss(-0.2, -0.24, p[2]) * ss(-0.3, -0.8, n[2]) * ss(0.36, 0.44, p[1]) * ss(0.055, 0.035, abs(p[0])))
    body.mask('points', lambda p, n: ss(0.035, 0.018, (V(p) - (face + V((0, -0.05, 0.13)))).length))
    body.mask('nose', lambda p, n: ss(0.028, 0.012, (V(p) - (face + V((0, -0.048, 0.147)))).length))
elif SPECIES == 'boar':
    body.mask('points', lambda p, n: max(ss(LEG_Y - 0.02, LEG_Y - 0.06, p[1]) * 0.8, ss(0.06, 0.03, (V(p) - face).length) * 0.3))
    body.mask('nose', lambda p, n: ss(0.02, 0.01, (V(p) - HEAD['snout']).length))
    body.mask('belly', lambda p, n: ss(-0.3, -0.8, n[1]) * 0.5)
elif SPECIES == 'camel':
    body.mask('belly', lambda p, n: ss(-0.3, -0.8, n[1]) * 0.6)
    body.mask('points', lambda p, n: ss(0.8, 0.95, p[1]) * ss(0.2, 0.7, n[1]) * ss(0.25, 0.15, p[2]))   # darker hump
elif SPECIES == 'elephant':
    body.mask('points', lambda p, n: ss(0.3, 0.1, p[1]) * 0.5)
else:
    body.mask('belly', lambda p, n: max(ss(-0.2, -0.7, n[1]), ss(0.03, 0.0, (p[1] - (face.y - 0.03))) * ss(0.25, 0.3, p[2]) * ss(-0.1, -0.6, n[1])))
    body.mask('saddle', lambda p, n: ss(0.2, 0.65, n[1]) * ss(0.26, 0.12, p[2]) * ss(-0.32, -0.2, p[2]))
    body.mask('nose', lambda p, n: ss(0.028, 0.012, (V(p) - HEAD['nose']).length))
    body.mask('points', lambda p, n: ss(LEG_Y - 0.1, LEG_Y - 0.2, p[1]) * 0.4)
parts.append(body.build())
eyes.mask('neck', lambda p, n: 1.0)
parts.append(eyes.build())
if HAS_HORN:
    horn.mask('neck', lambda p, n: 1.0)
    parts.append(horn.build())

# ------------------------------------------------------------------------------------------------ bake and export
ao = mk.bake_ao(parts, dist=0.16, near=0.03)
tris = mk.export_model(parts, ao, BONES, out_path)
# what a rider (rider.py mount=...) needs to fit its tack: the neck's bend and points of the head
import json  # noqa: E402
with open(out_path) as f_:
    data_ = json.load(f_)
data_['meta'] = dict(species=SPECIES, neckPivot=list(NECK_PIVOT), neckAxis=list(NECK_AXIS), neckRamp=list(NECK_RAMP),
                     head={k: list(v) for k, v in HEAD.items()})
with open(out_path, 'w') as f_:
    json.dump(data_, f_, separators=(',', ':'))
print(f'EXPORTED {out_path}: {len(parts)} parts, {tris} triangles')

if preview_path:
    PAL = {
        'sheep': dict(coat=(0.06, 0.05, 0.045), wool=(0.8, 0.76, 0.66), points=(0.04, 0.035, 0.03)),
        'deer': dict(coat=(0.36, 0.17, 0.06), belly=(0.7, 0.6, 0.45), rump=(0.85, 0.8, 0.7), points=(0.06, 0.04, 0.03), nose=(0.02, 0.02, 0.02)),
        'boar': dict(coat=(0.1, 0.075, 0.06), points=(0.05, 0.04, 0.035), belly=(0.2, 0.16, 0.12), nose=(0.35, 0.22, 0.2)),
        'wolf': dict(coat=(0.32, 0.3, 0.27), belly=(0.7, 0.66, 0.6), saddle=(0.12, 0.11, 0.1), points=(0.4, 0.34, 0.26), nose=(0.02, 0.02, 0.02)),
        'camel': dict(coat=(0.5, 0.33, 0.15), belly=(0.62, 0.48, 0.3), points=(0.35, 0.2, 0.08)),
        'elephant': dict(coat=(0.2, 0.19, 0.18), points=(0.12, 0.11, 0.1)),
    }[SPECIES]
    OTHER = {'eye': (0.01, 0.008, 0.007), 'horn': (0.55, 0.45, 0.3) if SPECIES == 'deer' else (0.85, 0.8, 0.7), 'bristle': (0.05, 0.04, 0.035)}
    colors = {}
    for o in parts:
        m = mk.vertex_masks(o)
        cols = []
        for i, a in enumerate(ao[o.name]):
            c = list(OTHER.get(o['mat'], PAL['coat']))
            if o['mat'] == 'coat':
                for key in ('belly', 'rump', 'saddle', 'points', 'wool', 'nose'):
                    if key in m and key in PAL:
                        w = m[key][i]
                        c = [c[j] * (1 - w) + PAL[key][j] * w for j in range(3)]
                if 'hoof' in m:
                    w = m['hoof'][i]
                    c = [c[j] * (1 - w) + 0.03 * w for j in range(3)]
            k = 0.25 + 0.75 * a ** 1.2
            cols.append(tuple(v * k for v in c))
        colors[o.name] = cols
    H = SP['H']
    paths = mk.preview(parts, colors, preview_path, center=(0, H * 0.55, 0.0), size=H * 2.2,
                       views=(('iso', 45.0, 30.0), ('side', 90.0, 8.0), ('front', 15.0, 10.0),
                              ('head', 60.0, 15.0, (0, HEAD['face'].y, HEAD['face'].z + 0.04), H * 0.7)))
    print('PREVIEW', paths)
