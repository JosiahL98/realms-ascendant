"""
Horse for mounted units. Run:
  blender --background --factory-startup --python tools/blender/horse.py -- <out.json> [preview.png]

The horse faces +z with hooves on y = 0 and its left side towards +x. Body, neck and tail bones match mount() in
src/render/models/units.ts; each leg is three jointed segments (upper leg, cannon, pastern and hoof) so the gait
code can bend the knees, hocks and fetlocks. Coat markings are exported as per-vertex masks:
  points  - black lower legs and muzzle (bay, dark bay, dun)
  sock    - white lower leg        blaze  - white stripe down the face
  hoof    - hoof horn              horn   - ergots and chestnuts
  nostril - nostril and inner-ear shadow
  dapple  - dapple spots (greys)   stripe - dorsal stripe (duns)
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import modelkit as mk  # noqa: E402
from mathutils import Vector, noise  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out_path = args[0] if args else 'horse.json'
preview_path = args[1] if len(args) > 1 else None

mk.reset_scene()
ss = mk.smoothstep

# ------------------------------------------------------------------------------------------------ skeleton
FRONT_Z, HIND_Z, LEG_X = 0.33, -0.33, 0.11
BONES = [
    {'name': 'root', 'parent': None, 'pivot': [0, 0, 0]},
    {'name': 'body', 'parent': 'root', 'pivot': [0, 0.62, 0]},
    {'name': 'neck', 'parent': 'body', 'pivot': [0, 0.74, 0.42]},
    {'name': 'tail', 'parent': 'body', 'pivot': [0, 0.70, -0.5]},
]
for side, x in (('L', LEG_X), ('R', -LEG_X)):
    BONES += [
        {'name': f'legF{side}', 'parent': 'body', 'pivot': [x, 0.52, FRONT_Z]},
        {'name': f'legF{side}2', 'parent': f'legF{side}', 'pivot': [x, 0.30, 0.345]},     # knee (carpus)
        {'name': f'legF{side}3', 'parent': f'legF{side}2', 'pivot': [x, 0.078, 0.36]},    # fetlock
        {'name': f'legB{side}', 'parent': 'body', 'pivot': [x, 0.52, HIND_Z]},
        {'name': f'legB{side}2', 'parent': f'legB{side}', 'pivot': [x, 0.315, -0.395]},   # hock
        {'name': f'legB{side}3', 'parent': f'legB{side}2', 'pivot': [x, 0.078, -0.36]},   # fetlock
    ]

parts = []

# ------------------------------------------------------------------------------------------------ body
body = mk.Part('body', 'body', 'coat', voxel=0.004, smooth=14, tris=1500)
body.ellipsoid((0, 0.63, -0.01), (0.165, 0.185, 0.355))                 # barrel
body.ellipsoid((0, 0.625, 0.06), (0.172, 0.172, 0.22))                  # ribcage
body.ellipsoid((0, 0.6, 0.28), (0.14, 0.155, 0.14))                     # brisket
body.ellipsoid((0, 0.765, 0.19), (0.06, 0.07, 0.16))                    # withers
body.ellipsoid((0, 0.725, -0.12), (0.12, 0.08, 0.22))                   # back and loin
body.ellipsoid((0, 0.715, -0.34), (0.15, 0.1, 0.16))                    # croup
body.ellipsoid((0, 0.66, -0.46), (0.115, 0.12, 0.07))                   # buttocks
body.ellipsoid((0, 0.565, 0.02), (0.15, 0.115, 0.25))                   # belly
body.ellipsoid((0, 0.7, 0.37), (0.1, 0.12, 0.11), rot=(0.6, 0, 0))      # neck root, overlaps the neck part
body.ellipsoid((0, 0.71, -0.45), (0.06, 0.05, 0.05))                    # tail head
for s in (1, -1):
    body.ellipsoid((0.08 * s, 0.635, 0.265), (0.06, 0.13, 0.085), rot=(-0.5, 0, 0))   # shoulder blade
    body.ball((0.083 * s, 0.6, 0.35), 0.042)                                          # point of shoulder
    body.ellipsoid((0.052 * s, 0.6, 0.365), (0.056, 0.09, 0.052))                    # pectoral
    body.ball((0.098 * s, 0.535, 0.29), 0.038)                                        # elbow
    body.ball((0.113 * s, 0.712, -0.25), 0.035)                                       # point of hip
    body.ellipsoid((0.082 * s, 0.62, -0.34), (0.074, 0.15, 0.13), rot=(0.15, 0, 0))  # hindquarter
    body.ball((0.108 * s, 0.54, -0.21), 0.035)                                        # stifle
    body.ellipsoid((0.085 * s, 0.6, -0.2), (0.07, 0.11, 0.12))                       # flank, bridges barrel and quarters
body.mask('dapple', lambda p, n: ss(0.18, 0.42, noise.noise(Vector(p) * 13.0)))
body.mask('stripe', lambda p, n: ss(0.03, 0.012, abs(p[0])) * ss(0.55, 0.9, n[1]))
parts.append(body.build())

# ------------------------------------------------------------------------------------------------ neck and head
MUZZLE = (0.0, 0.87, 0.835)
NOSTRILS = [(0.022 * s, 0.885, 0.842) for s in (1, -1)]


def head_masks(part):
    part.mask('points', lambda p, n: max(ss(0.085, 0.04, math.dist(p, MUZZLE)), ss(1.105, 1.135, p[1]) * ss(0.015, 0.025, abs(p[0]))))
    # only on the upper face: above the line from brow (y 1.0, z 0.655) to muzzle (y 0.9, z 0.795), not the jaw
    part.mask('blaze', lambda p, n: ss(0.022, 0.011, abs(p[0])) * ss(0.1, 0.45, n[2] + n[1] * 0.3) * ss(0.885, 0.91, p[1])
              * ss(1.07, 1.03, p[1]) * ss(0.6, 0.64, p[2]) * ss(-0.006, 0.01, p[1] - (1.0 - (p[2] - 0.655) * 0.714)))
    part.mask('nostril', lambda p, n: max(max(ss(0.022, 0.008, math.dist(p, q)) for q in NOSTRILS),
                                          ss(1.075, 1.1, p[1]) * ss(0.2, 0.6, n[2]) * ss(0.012, 0.022, abs(p[0]))))


neck = mk.Part('neck', 'neck', 'coat', voxel=0.003, smooth=6, tris=1400)
neck.chain([(0, 0.68, 0.38), (0, 0.82, 0.45), (0, 0.94, 0.53), (0, 1.03, 0.58)], [0.115, 0.1, 0.07, 0.056], flat=0.6)
neck.ellipsoid((0, 0.77, 0.42), (0.085, 0.13, 0.115), rot=(0.75, 0, 0))          # neck base
neck.chain([(0, 0.83, 0.31), (0, 0.95, 0.43), (0, 1.04, 0.54)], [0.05, 0.042, 0.03], flat=0.55)   # crest
neck.ellipsoid((0, 1.02, 0.615), (0.052, 0.056, 0.07), rot=(0.95, 0, 0))         # cranium
neck.limb((0, 1.0, 0.655), (0, 0.9, 0.795), 0.045, 0.036, flat=0.95)            # face
neck.ellipsoid((0, 0.876, 0.805), (0.042, 0.046, 0.05))                          # muzzle
neck.ball((0, 0.848, 0.775), 0.024)                                              # chin
neck.limb((0, 0.93, 0.6), (0, 0.866, 0.745), 0.04, 0.028, flat=0.9)             # lower jaw
for s in (1, -1):
    neck.ellipsoid((0.036 * s, 0.948, 0.628), (0.026, 0.054, 0.058), rot=(0.4, 0, 0))    # cheek
    neck.ellipsoid((0.043 * s, 1.017, 0.66), (0.018, 0.012, 0.024))                       # brow ridge
    neck.cone((0.03 * s, 1.06, 0.585), (0.042 * s, 1.15, 0.56), 0.022, seg=12)            # ear
    neck.cone((0.03 * s, 1.075, 0.6), (0.041 * s, 1.14, 0.577), 0.012, seg=10, cut=True)  # ear hollow
    neck.ellipsoid(NOSTRILS[0 if s > 0 else 1], (0.008, 0.012, 0.016), rot=(0.3, 0, 0), cut=True)   # nostril
head_masks(neck)
parts.append(neck.build())

mane = mk.Part('mane', 'neck', 'hair', voxel=0.0028, smooth=3, tris=550)
crest = [(0.0, 1.09, 0.57), (0.004, 1.055, 0.52), (0.008, 1.0, 0.465), (0.012, 0.935, 0.405), (0.014, 0.87, 0.345), (0.012, 0.815, 0.285), (0.008, 0.785, 0.245)]
mane.chain(crest, [0.02, 0.026, 0.03, 0.032, 0.03, 0.026, 0.018], flat=0.5)
for i in range(14):
    t = i / 13
    k = min(len(crest) - 2, int(t * (len(crest) - 1)))
    f = t * (len(crest) - 1) - k
    x, y, z = (crest[k][j] * (1 - f) + crest[k + 1][j] * f for j in range(3))
    length = 0.05 + 0.045 * math.sin(math.pi * min(1.0, t * 1.1)) + (0.015 if i % 3 == 0 else 0)
    tip = (x + 0.035 + 0.01 * (i % 2), y - length, z - 0.015 - 0.01 * (i % 3))
    mane.limb((x + 0.012, y, z), tip, 0.016, 0.006, seg=10, flat=0.45)               # locks falling to the left
for i in range(3):
    mane.limb((0.004 * (i - 1), 1.09, 0.595), (0.012 * (i - 1), 1.035, 0.665 + 0.004 * i), 0.012, 0.005, seg=10, flat=0.5)  # forelock
parts.append(mane.build())

eyes = mk.Part('eyes', 'neck', 'eye', voxel=0.0025, smooth=1, tris=80)
for s in (1, -1):
    eyes.ellipsoid((0.049 * s, 1.003, 0.668), (0.009, 0.012, 0.014))
parts.append(eyes.build())

# ------------------------------------------------------------------------------------------------ tail
tail = mk.Part('tail', 'tail', 'hair', voxel=0.003, smooth=3, tris=500)
tail.limb((0, 0.715, -0.465), (0, 0.665, -0.545), 0.036, 0.032)                 # dock
tail.ellipsoid((0, 0.47, -0.588), (0.028, 0.17, 0.03))                          # body of hair between the strands
for i in range(11):
    a = (i - 5) / 5.0
    top = (0.02 * a, 0.67, -0.545 - 0.008 * abs(a))
    mid = (0.036 * a, 0.49, -0.592 - 0.012 * (1 - abs(a)) + 0.008 * (i % 2))
    end = (0.05 * a + (0.012 if i % 2 else -0.012), 0.25 + 0.05 * abs(a) + (0.025 if i % 3 == 0 else 0), -0.582 - 0.012 * (1 - abs(a)))
    tail.chain([top, mid, end], [0.022, 0.02, 0.008], seg=10, flat=0.75)
parts.append(tail.build())


# ------------------------------------------------------------------------------------------------ legs
def leg_masks(part, front):
    knee_y = 0.3 if front else 0.325
    part.mask('points', lambda p, n: ss(knee_y + 0.03, knee_y - 0.04, p[1]))
    part.mask('sock', lambda p, n: ss(0.155, 0.115, p[1]))
    part.mask('hoof', lambda p, n: ss(0.047, 0.041, p[1]))


def hoof(bone, x, zf, zh):
    """Pastern, coronet band and hoof below the fetlock pivot (x, 0.078, zf); hoof centred at zh."""
    p = mk.Part(bone, bone, 'coat', voxel=0.0025, smooth=3, tris=200)
    p.ball((x, 0.078, zf), 0.024)                                                     # joint inside the fetlock
    p.limb((x, 0.075, zf), (x, 0.047, zh - 0.004), 0.021, 0.022)                     # pastern
    p.ellipsoid((x, 0.045, zh - 0.003), (0.028, 0.009, 0.03))                         # coronet band
    p.limb((x, 0.006, zh + 0.002), (x, 0.042, zh - 0.002), 0.034, 0.027, caps=False)  # hoof wall
    p.ellipsoid((x, 0.008, zh + 0.002), (0.034, 0.008, 0.036))                        # sole
    for s in (1, -1):
        p.ball((x + 0.012 * s, 0.022, zh - 0.024), 0.012)                             # heel bulbs
    leg_masks(p, zf > 0)
    return p


def front_leg(side, x):
    s = 1 if x > 0 else -1
    z = FRONT_Z
    up = mk.Part(f'legF{side}', f'legF{side}', 'coat', voxel=0.003, smooth=5, tris=260)
    up.ellipsoid((x, 0.505, z - 0.005), (0.045, 0.06, 0.05))                          # elbow / forearm top
    up.limb((x, 0.52, z), (x, 0.315, z + 0.013), 0.048, 0.03, flat=0.85)             # forearm
    up.ellipsoid((x, 0.44, z + 0.008), (0.04, 0.08, 0.046))                           # forearm muscle
    up.ellipsoid((x, 0.3, z + 0.017), (0.031, 0.035, 0.029))                          # knee
    up.ellipsoid((x - 0.03 * s, 0.37, z + 0.004), (0.007, 0.016, 0.01))                # chestnut
    up.mask('horn', lambda p, n, cx=x - 0.035 * s: ss(0.014, 0.004, math.dist((p[0], p[1] * 0.6), (cx, 0.37 * 0.6))))
    leg_masks(up, True)
    lo = mk.Part(f'legF{side}2', f'legF{side}2', 'coat', voxel=0.0028, smooth=4, tris=180)
    lo.ball((x, 0.3, z + 0.015), 0.027)                                               # joint inside the knee
    lo.limb((x, 0.29, z + 0.015), (x, 0.1, z + 0.025), 0.024, 0.022, flat=0.8)       # cannon bone
    lo.limb((x, 0.27, z - 0.003), (x, 0.11, z + 0.008), 0.011, 0.013, flat=0.9)      # flexor tendon
    lo.ellipsoid((x, 0.078, z + 0.028), (0.027, 0.03, 0.031))                         # fetlock
    lo.ellipsoid((x, 0.07, z + 0.001), (0.01, 0.01, 0.012))                           # ergot
    lo.mask('horn', lambda p, n, zz=z: ss(0.018, 0.008, math.dist((p[1], p[2]), (0.07, zz + 0.001))))
    leg_masks(lo, True)
    return up, lo, hoof(f'legF{side}3', x, 0.36, 0.376)


def hind_leg(side, x):
    z = HIND_Z
    up = mk.Part(f'legB{side}', f'legB{side}', 'coat', voxel=0.003, smooth=5, tris=280)
    up.ellipsoid((x, 0.475, z - 0.02), (0.048, 0.09, 0.06), rot=(0.3, 0, 0))          # gaskin
    up.limb((x, 0.56, z + 0.01), (x, 0.33, z - 0.058), 0.05, 0.028, flat=0.8)        # tibia
    up.limb((x, 0.45, z - 0.06), (x, 0.345, z - 0.095), 0.012, 0.013)               # achilles tendon
    up.ellipsoid((x, 0.318, z - 0.065), (0.027, 0.034, 0.032))                        # hock
    leg_masks(up, False)
    lo = mk.Part(f'legB{side}2', f'legB{side}2', 'coat', voxel=0.0028, smooth=4, tris=190)
    lo.ball((x, 0.315, z - 0.065), 0.028)                                             # joint inside the hock
    lo.ellipsoid((x, 0.33, z - 0.09), (0.013, 0.02, 0.016))                           # point of hock
    lo.limb((x, 0.3, z - 0.06), (x, 0.1, z - 0.032), 0.025, 0.022, flat=0.8)         # cannon bone
    lo.limb((x, 0.28, z - 0.078), (x, 0.11, z - 0.048), 0.011, 0.013, flat=0.9)      # flexor tendon
    lo.ellipsoid((x, 0.078, z - 0.03), (0.027, 0.03, 0.031))                          # fetlock
    lo.ellipsoid((x, 0.07, z - 0.056), (0.01, 0.01, 0.012))                           # ergot
    lo.mask('horn', lambda p, n, zz=z: ss(0.018, 0.008, math.dist((p[1], p[2]), (0.07, zz - 0.056))))
    leg_masks(lo, False)
    return up, lo, hoof(f'legB{side}3', x, -0.36, -0.342)


for side, x in (('L', LEG_X), ('R', -LEG_X)):
    for piece in front_leg(side, x) + hind_leg(side, x):
        parts.append(piece.build())

# ------------------------------------------------------------------------------------------------ bake and export
ao = mk.bake_ao(parts, dist=0.28, near=0.045)
tris = mk.export_model(parts, ao, BONES, out_path)
print(f'EXPORTED {out_path}: {len(parts)} parts, {tris} triangles')

if preview_path:
    # bay: brown coat with black points, mane and tail; a white sock on the near foreleg and a blaze for the preview
    coat, black, hoofc, white = (0.2, 0.085, 0.03), (0.018, 0.013, 0.01), (0.03, 0.025, 0.022), (0.8, 0.78, 0.74)
    colors = {}
    for o in parts:
        m = mk.vertex_masks(o)
        base = {'coat': coat, 'hair': black, 'eye': (0.01, 0.008, 0.007)}[o['mat']]
        n = len(ao[o.name])
        cols = []
        for i, a in enumerate(ao[o.name]):
            c = list(base)
            for key, target, k in (('points', black, 1.0), ('horn', black, 0.9), ('nostril', black, 0.8)):
                if key in m:
                    w = m[key][i] * k
                    c = [c[j] * (1 - w) + target[j] * w for j in range(3)]
            if o.name.startswith('legFL') and 'sock' in m:
                w = m['sock'][i]
                c = [c[j] * (1 - w) + white[j] * w for j in range(3)]
            if 'hoof' in m:
                w = m['hoof'][i]
                c = [c[j] * (1 - w) + hoofc[j] * w for j in range(3)]
            if 'blaze' in m:
                w = m['blaze'][i]
                c = [c[j] * (1 - w) + white[j] * w for j in range(3)]
            k = 0.25 + 0.75 * a ** 1.2
            cols.append(tuple(v * k for v in c))
        assert len(cols) == n
        colors[o.name] = cols
    paths = mk.preview(parts, colors, preview_path, center=(0, 0.55, 0.05), size=1.5,
                       views=(('iso', 45.0, 30.0), ('side', 90.0, 8.0), ('head', 60.0, 15.0, (0, 0.95, 0.62), 0.45),
                              ('legs', 70.0, 10.0, (0.05, 0.22, 0.0), 0.95)))
    print('PREVIEW', paths)
