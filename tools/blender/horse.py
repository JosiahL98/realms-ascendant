"""
Horse for mounted units. Run:
  blender --background --factory-startup --python tools/blender/horse.py -- <out.json> [preview.png]

Bones and pivots match mount() in src/render/models/units.ts (horse faces +z, hooves on y = 0).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import modelkit as mk  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out_path = args[0] if args else 'horse.json'
preview_path = args[1] if len(args) > 1 else None

mk.reset_scene()

BODY = (0.0, 0.62, 0.0)
PIVOTS = {
    'body': BODY,
    'neck': (0.0, 0.74, 0.42),
    'legFL': (0.11, 0.52, 0.33),
    'legFR': (-0.11, 0.52, 0.33),
    'legBL': (0.11, 0.52, -0.33),
    'legBR': (-0.11, 0.52, -0.33),
    'tail': (0.0, 0.70, -0.5),
}

parts = []

# ---------------------------------------------------------------- body: barrel, chest, rump, withers, shoulders, thighs
body = mk.Part('body', 'body', 'coat', voxel=0.007, smooth=8, tris=560)
body.ellipsoid((0, 0.63, 0.0), (0.165, 0.185, 0.33))
body.ellipsoid((0, 0.645, 0.25), (0.152, 0.19, 0.18))
body.ellipsoid((0, 0.665, -0.28), (0.172, 0.18, 0.19))
body.ellipsoid((0, 0.75, 0.2), (0.075, 0.075, 0.15))          # withers
body.ellipsoid((0, 0.575, 0.02), (0.145, 0.12, 0.25))         # belly
body.ellipsoid((0, 0.69, -0.4), (0.12, 0.1, 0.08))            # croup / tail head
body.ellipsoid((0, 0.6, 0.33), (0.13, 0.13, 0.09))            # breast between the forelegs
body.ellipsoid((0, 0.7, 0.37), (0.1, 0.12, 0.11), rot=(0.6, 0, 0))    # neck root, overlaps the neck part
for s in (1, -1):
    body.ellipsoid((0.085 * s, 0.59, 0.3), (0.07, 0.13, 0.085), rot=(-0.25, 0, 0))   # shoulder
    body.ellipsoid((0.1 * s, 0.6, -0.3), (0.08, 0.15, 0.13), rot=(0.2, 0, 0))        # hindquarter
parts.append(body.build())

# ---------------------------------------------------------------- neck and head
neck = mk.Part('neck', 'neck', 'coat', voxel=0.005, smooth=6, tris=460)
neck.chain([(0, 0.68, 0.38), (0, 0.82, 0.45), (0, 0.94, 0.53), (0, 1.03, 0.58)], [0.115, 0.1, 0.07, 0.056], flat=0.6)
neck.ellipsoid((0, 0.77, 0.42), (0.085, 0.13, 0.115), rot=(0.75, 0, 0))          # thick neck base
neck.ellipsoid((0, 1.0, 0.63), (0.056, 0.068, 0.095), rot=(0.95, 0, 0))          # skull / cheek
neck.ellipsoid((0, 0.955, 0.62), (0.052, 0.058, 0.07))                           # jowl
neck.limb((0, 0.995, 0.65), (0, 0.885, 0.8), 0.05, 0.04, flat=0.88)             # face
neck.ellipsoid((0, 0.872, 0.81), (0.045, 0.048, 0.055))                          # muzzle
for s in (1, -1):
    neck.cone((0.03 * s, 1.06, 0.59), (0.037 * s, 1.135, 0.57), 0.02, seg=8)      # ears
parts.append(neck.build())

mane = mk.Part('mane', 'neck', 'hair', voxel=0.004, smooth=4, tris=180)
crest = [(0.0, 1.085, 0.575), (0.004, 1.05, 0.525), (0.008, 0.995, 0.47), (0.012, 0.93, 0.41), (0.014, 0.865, 0.35), (0.012, 0.815, 0.29), (0.008, 0.79, 0.25)]
mane.chain(crest, [0.022, 0.03, 0.034, 0.036, 0.034, 0.03, 0.02], flat=0.5)
mane.ellipsoid((0.0, 1.055, 0.645), (0.018, 0.024, 0.036), rot=(0.7, 0, 0))                     # forelock
parts.append(mane.build())

eyes = mk.Part('eyes', 'neck', 'eye', voxel=0.003, smooth=1, tris=40)
for s in (1, -1):
    eyes.ball((0.051 * s, 1.005, 0.665), 0.012, seg=10)
parts.append(eyes.build())

# ---------------------------------------------------------------- legs (front legs straight, hind legs with a hock angle)
def front_leg(name, x):
    p = mk.Part(name, name, 'coat', voxel=0.0045, smooth=4, tris=150)
    z = 0.33
    p.limb((x, 0.56, z - 0.01), (x, 0.31, z + 0.005), 0.058, 0.036, flat=0.85)     # forearm
    p.ellipsoid((x, 0.295, z + 0.012), (0.03, 0.036, 0.034))                        # knee
    p.limb((x, 0.29, z + 0.012), (x, 0.095, z + 0.02), 0.028, 0.025, flat=0.85)    # cannon
    p.ellipsoid((x, 0.078, z + 0.028), (0.028, 0.03, 0.032))                        # fetlock
    p.limb((x, 0.07, z + 0.03), (x, 0.042, z + 0.045), 0.022, 0.023)                 # pastern
    return p


def hind_leg(name, x):
    p = mk.Part(name, name, 'coat', voxel=0.0045, smooth=4, tris=160)
    z = -0.33
    p.limb((x, 0.58, z + 0.02), (x, 0.33, z - 0.06), 0.062, 0.036, flat=0.8)       # gaskin
    p.ellipsoid((x, 0.315, z - 0.065), (0.028, 0.042, 0.042))                        # hock
    p.limb((x, 0.3, z - 0.058), (x, 0.095, z - 0.035), 0.028, 0.025, flat=0.85)    # cannon
    p.ellipsoid((x, 0.078, z - 0.028), (0.028, 0.03, 0.032))                        # fetlock
    p.limb((x, 0.07, z - 0.025), (x, 0.042, z - 0.01), 0.022, 0.023)                 # pastern
    return p


def hoof(name, x, z):
    p = mk.Part(name + '_hoof', name, 'hoof', voxel=0.004, smooth=2, tris=50)
    p.limb((x, 0.012, z + 0.006), (x, 0.045, z), 0.032, 0.025, caps=False)
    p.ellipsoid((x, 0.012, z + 0.006), (0.032, 0.012, 0.034))
    return p


for name, x in (('legFL', 0.11), ('legFR', -0.11)):
    parts.append(front_leg(name, x).build())
    parts.append(hoof(name, x, 0.375).build())
for name, x in (('legBL', 0.11), ('legBR', -0.11)):
    parts.append(hind_leg(name, x).build())
    parts.append(hoof(name, x, -0.34).build())

# ---------------------------------------------------------------- tail
tail = mk.Part('tail', 'tail', 'hair', voxel=0.0045, smooth=4, tris=140)
tail.chain([(0, 0.71, -0.46), (0, 0.68, -0.54), (0, 0.6, -0.58), (0.01, 0.48, -0.6), (0.015, 0.36, -0.6), (0.01, 0.29, -0.58)],
           [0.034, 0.042, 0.048, 0.05, 0.044, 0.022], flat=0.7)
parts.append(tail.build())

ao = mk.bake_ao(parts, dist=0.28)
tris = mk.export_parts(parts, ao, {k: list(v) for k, v in PIVOTS.items()}, out_path)
print(f'EXPORTED {out_path}: {len(parts)} parts, {tris} triangles')

if preview_path:
    tints = {'coat': (0.42, 0.24, 0.12), 'hair': (0.1, 0.07, 0.05), 'hoof': (0.12, 0.1, 0.09), 'eye': (0.03, 0.02, 0.02)}
    paths = mk.preview(parts, ao, tints, preview_path, center=(0, 0.55, 0.05), size=1.5,
                       views=(('iso', 45.0, 30.0), ('side', 90.0, 8.0), ('front', 20.0, 20.0),
                              ('head', 60.0, 15.0, (0, 0.88, 0.5), 0.6)))
    print('PREVIEW', paths)
