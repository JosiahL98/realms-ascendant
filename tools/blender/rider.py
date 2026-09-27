"""
Cavalry rider (scout kit) and horse tack, fitted to the Blender horse. Run:
  blender --background --factory-startup --python tools/blender/rider.py -- <horse.json> <out.json> [preview.png] [--tris 0.38]

<horse.json> is the full-detail horse export (from horse.py); the tack is draped over its surface by ray casting and
the rider's legs are pushed clear of its barrel. Coordinates are the horse's own frame (it faces +z, hooves at y = 0).

Rider bones hang off the horse's 'body' bone and keep the game's names (rhips, rtorso, rhead, rarmL/R, rhandL/R) with
elbow bones added (relbowL/R). Joints are ball joints: each segment ends in a sphere centred on its pivot, so turning
never opens a gap. Tack sits on the 'body' bone; the bridle and reins carry the horse's 'neck' skin weight so they
bend with its neck.

Materials (the renderer colours them): skin, hair, eye, team (player colour: tunic, sleeves, saddle cloth), leather,
darkleather, trousers, wood, iron, bronze, trim.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import modelkit as mk  # noqa: E402
from mathutils import Vector  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
flags = {}
while len(args) >= 2 and args[-2].startswith('--'):
    flags[args[-2][2:]] = float(args[-1])
    args = args[:-2]
horse_path, out_path = args[0], args[1]
preview_path = args[2] if len(args) > 2 else None
mk.TRI_SCALE = flags.get('tris', 1.0)
DETAIL = mk.TRI_SCALE ** 0.7  # scales sample counts of the raw (unfused) straps and cloth

mk.reset_scene()
ss = mk.smoothstep
V = Vector

horse_obj, horse = mk.object_from_export(horse_path, part_names=['body'], name='horse')
S = mk.Surface(horse_obj)


def n_samples(k):
    return max(4, int(round(k * DETAIL)))


# ------------------------------------------------------------------------------------------------ skeleton
H = V((0.0, 0.9, -0.04))          # hips (pelvis centre, on the saddle)
T = V((0.0, 0.93, -0.045))        # torso pivot (small of the back)
HEAD = V((0.0, 1.235, -0.045))    # neck base
SH = {1: V((0.108, 1.162, -0.045)), -1: V((-0.108, 1.162, -0.045))}   # shoulders
EL = {1: V((0.132, 1.03, -0.005)), -1: V((-0.15, 1.035, -0.03))}      # elbows
WR = {1: V((0.074, 0.978, 0.098)), -1: V((-0.158, 0.99, 0.07))}       # wrists
FIST = {1: V((0.064, 0.97, 0.122)), -1: V((-0.16, 0.985, 0.094))}

horse_bones = {b['name']: b for b in horse['bones']}
BONES = [
    {'name': 'body', 'parent': 'root', 'pivot': horse_bones['body']['pivot']},
    {'name': 'neck', 'parent': 'body', 'pivot': horse_bones['neck']['pivot']},
    {'name': 'rhips', 'parent': 'body', 'pivot': list(H)},
    {'name': 'rtorso', 'parent': 'rhips', 'pivot': list(T)},
    {'name': 'rhead', 'parent': 'rtorso', 'pivot': list(HEAD)},
]
for s, side in ((1, 'L'), (-1, 'R')):
    BONES += [
        {'name': f'rarm{side}', 'parent': 'rtorso', 'pivot': list(SH[s])},
        {'name': f'relbow{side}', 'parent': f'rarm{side}', 'pivot': list(EL[s])},
        {'name': f'rhand{side}', 'parent': f'relbow{side}', 'pivot': list(WR[s])},
    ]

parts = []
NECK_PIVOT = V(horse_bones['neck']['pivot'])


def neck_weight(p):
    """Same bend weight as the horse's own neck (see horse.py)."""
    t = (p[1] - NECK_PIVOT.y) * 0.868 + (p[2] - NECK_PIVOT.z) * 0.496
    return ss(-0.07, 0.17, t)


# ------------------------------------------------------------------------------------------------ fitting helpers
def half_width(y, z):
    h, _ = S.cast((1.0, y, z), (-1, 0, 0))
    return h.x if h else 0.0


def top_y(x, z):
    h, _ = S.cast((x, 2.0, z), (0, -1, 0))
    return h.y if h else None


def cross_section(z, hem_y, offset, top_half=0.075, n_top=5, n_side=9):
    """
    Profile of a cloth draped over the horse at depth z, from the spine down one side to hem_y (left side, x > 0):
    over the top it follows the back; down the side it follows the barrel but hangs straight below its widest point.
    Returns (points, normals).
    """
    pts, nrms = [], []
    for i in range(n_top):
        x = top_half * i / (n_top - 1)
        h, n = S.cast((x, 2.0, z), (0, -1, 0))
        n = n if n.y > 0 else V((0, 1, 0))
        pts.append(h + n * offset)
        nrms.append(n)
    y0 = pts[-1].y - 0.01
    widest = 0.0
    for i in range(1, n_side + 1):
        y = y0 + (hem_y - y0) * i / n_side
        h, n = S.cast((1.0, y, z), (-1, 0, 0))
        x = h.x if h else widest
        if x >= widest:
            widest = x
            nn = n if n else V((1, 0, 0))
        else:
            nn = V((1, 0, 0))   # below the widest point the cloth hangs straight down
        pts.append(V((max(x, widest) + offset, y, z)))
        nrms.append(nn)
    return pts, nrms


def shell(grid, normals, thickness):
    """Closed slab from a grid of surface points (rows x cols) thickened along the normals."""
    rows, cols = len(grid), len(grid[0])
    verts = []
    for layer in (0, 1):
        for r in range(rows):
            for c in range(cols):
                verts.append(tuple(grid[r][c] + normals[r][c] * thickness * layer))
    idx = lambda layer, r, c: layer * rows * cols + r * cols + c
    faces = []
    for r in range(rows - 1):
        for c in range(cols - 1):
            faces.append((idx(0, r, c), idx(0, r, c + 1), idx(0, r + 1, c + 1), idx(0, r + 1, c)))
            faces.append((idx(1, r, c), idx(1, r + 1, c), idx(1, r + 1, c + 1), idx(1, r, c + 1)))
    for r in range(rows - 1):
        for c in (0, cols - 1):
            faces.append((idx(0, r, c), idx(0, r + 1, c), idx(1, r + 1, c), idx(1, r, c)))
    for c in range(cols - 1):
        for r in (0, rows - 1):
            faces.append((idx(0, r, c), idx(1, r, c), idx(1, r, c + 1), idx(0, r, c + 1)))
    return verts, faces


def surface_grid(grid, normals, lift):
    """Single outward-facing surface over a grid (the side against the horse is never seen)."""
    rows, cols = len(grid), len(grid[0])
    verts = [tuple(grid[r][c] + normals[r][c] * lift) for r in range(rows) for c in range(cols)]
    faces = [(r * cols + c, r * cols + c + 1, (r + 1) * cols + c + 1, (r + 1) * cols + c)
             for r in range(rows - 1) for c in range(cols - 1)]
    return verts, faces


def draped(z0, z1, rows, hem, offset, top_half=0.075, n_top=5, n_side=9):
    """Grid over the back from z0 to z1 and down both sides to hem(z); returns grid points, normals, hem rows."""
    grid, nrm = [], []
    for r in range(rows):
        z = z0 + (z1 - z0) * r / (rows - 1)
        p, n = cross_section(z, hem(z), offset, top_half, n_top, n_side)
        # mirror to the right side, right hem first
        row = [V((-q.x, q.y, q.z)) for q in reversed(p[1:])] + p
        nrow = [V((-q.x, q.y, q.z)) for q in reversed(n[1:])] + n
        grid.append(row)
        nrm.append(nrow)
    return grid, nrm


def on_surface(p, offset):
    """Push a point out of (or onto) the horse so it sits `offset` above the surface."""
    loc, nrm, dist = S.nearest(p)
    inside = (V(p) - loc).dot(nrm) < 0
    if inside or dist < offset:
        return loc + nrm * offset, nrm
    return V(p), nrm


def surface_path(points, offset):
    out, nrms = [], []
    for p in points:
        q, n = on_surface(p, offset)
        out.append(q)
        nrms.append(n)
    return out, nrms


def ring(center, axis, up, radius, a0, a1, n, offset):
    """Points on the surface found by casting inwards towards `center` from directions around `axis`."""
    axis = V(axis).normalized()
    u = V(up).normalized()
    w = axis.cross(u).normalized()
    pts, nrms = [], []
    for i in range(n):
        a = math.radians(a0 + (a1 - a0) * i / (n - 1))
        d = u * math.cos(a) + w * math.sin(a)
        h, nn = S.cast(V(center) + d * radius, -d, radius * 2)
        if h is None:
            continue
        pts.append(h + nn * offset)
        nrms.append(nn)
    return pts, nrms


# ------------------------------------------------------------------------------------------------ saddle cloth
cloth_z0, cloth_z1 = -0.2, 0.11


def cloth_hem(z):
    # straight hem along the flank, rising to rounded corners front and back
    t = (z - cloth_z0) / (cloth_z1 - cloth_z0)
    corner = max(ss(0.18, 0.0, t), ss(0.82, 1.0, t))
    return 0.6 + 0.09 * corner * corner


rows = n_samples(11)
grid, nrm = draped(cloth_z0, cloth_z1, rows, cloth_hem, 0.004, n_top=n_samples(4), n_side=n_samples(8))
cloth = mk.Part('cloth', 'body', 'team', remesh=False)
cloth.mesh(*surface_grid(grid, nrm, 0.006))
parts.append(cloth.build())

# trim border along the hem and the front and back edges
trim = mk.Part('clothtrim', 'body', 'trim', remesh=False)
for c in (0, len(grid[0]) - 1):
    pts = [grid[r][c] + V((0, 0.012, 0)) for r in range(rows)]
    nn = [nrm[r][c] for r in range(rows)]
    trim.ribbon(pts, nn, 0.018, 0.009)
for r in (0, rows - 1):
    trim.ribbon([grid[r][c] for c in range(len(grid[0]))], nrm[r], 0.016, 0.009)
parts.append(trim.build())

# ------------------------------------------------------------------------------------------------ saddle (four horns)
saddle = mk.Part('saddle', 'body', 'leather', voxel=0.0028, smooth=4, tris=520)
srows = 9
sgrid, snrm = draped(-0.15, 0.07, srows, lambda z: 0.73, 0.012, top_half=0.06, n_top=5, n_side=5)
saddle.mesh(*shell(sgrid, snrm, 0.018))
seat_top = top_y(0, -0.04) + 0.03
saddle.ellipsoid((0, seat_top + 0.012, 0.06), (0.07, 0.022, 0.03))          # pommel
saddle.ellipsoid((0, seat_top + 0.018, -0.14), (0.075, 0.028, 0.028))       # cantle
for s in (1, -1):
    # front horns curl out over the thighs, rear horns rise behind the rider
    saddle.limb((0.05 * s, seat_top + 0.01, 0.055), (0.1 * s, seat_top + 0.035, 0.1), 0.017, 0.011, seg=12)
    saddle.limb((0.045 * s, seat_top + 0.01, -0.125), (0.065 * s, seat_top + 0.06, -0.155), 0.016, 0.01, seg=12)
parts.append(saddle.build())

bronze = mk.Part('saddlebronze', 'body', 'bronze', voxel=0.0025, smooth=2, tris=120)
for s in (1, -1):
    bronze.ball((0.1 * s, seat_top + 0.035, 0.1), 0.012)
    bronze.ball((0.065 * s, seat_top + 0.06, -0.155), 0.011)
parts.append(bronze.build())

# ------------------------------------------------------------------------------------------------ straps
straps = mk.Part('straps', 'body', 'darkleather', remesh=False)
# girth: under the belly behind the elbows, from cloth edge to cloth edge
gp, gn = ring((0, 0.63, 0.13), (0, 0, 1), (0, 1, 0), 0.6, 70, 290, n_samples(15), 0.006)
straps.ribbon(gp, gn, 0.034, 0.006)
# breast collar round the front of the chest, from the saddle's front corners
bp, bn = [], []
for i in range(n_samples(13)):
    a = math.radians(-78 + 156 * i / (n_samples(13) - 1))
    y = 0.655 + 0.1 * (abs(a) / math.radians(78)) ** 2
    d = V((math.sin(a), 0, math.cos(a)))
    h, n = S.cast(V((0, y, 0.18)) + d * 0.6, -d, 1.2)
    if h is not None:
        bp.append(h + n * 0.006)
        bn.append(n)
straps.ribbon(bp, bn, 0.026, 0.006)
# crupper along the spine to the root of the tail
cp, cn = [], []
for i in range(n_samples(9)):
    z = -0.19 - 0.27 * i / (n_samples(9) - 1)
    h, n = S.cast((0, 2.0, z), (0, -1, 0))
    cp.append(h + n * 0.005)
    cn.append(n)
straps.ribbon(cp, cn, 0.018, 0.005)
parts.append(straps.build())

pendant = mk.Part('pendant', 'body', 'bronze', voxel=0.0022, smooth=2, tris=80)
front = bp[len(bp) // 2]
pendant.ellipsoid((front.x, front.y - 0.03, front.z + 0.012), (0.02, 0.024, 0.006))   # lunula on the breast collar
pendant.limb((front.x, front.y - 0.002, front.z + 0.008), (front.x, front.y - 0.02, front.z + 0.012), 0.004, 0.004, seg=8)
parts.append(pendant.build())

# ------------------------------------------------------------------------------------------------ bridle and reins
HEAD_AXIS = V((0, -0.614, 0.789))       # poll towards muzzle
bridle = mk.Part('bridle', 'body', 'darkleather', remesh=False)
crown_p, crown_n = ring((0, 0.985, 0.585), HEAD_AXIS, (0, 0.789, 0.614), 0.4, -118, 118, n_samples(12), 0.004)
bridle.ribbon(crown_p, crown_n, 0.014, 0.004)
nose_p, nose_n = ring((0, 0.905, 0.745), HEAD_AXIS, (0, 0.789, 0.614), 0.4, 0, 360, n_samples(15), 0.004)
bridle.ribbon(nose_p[:-1], nose_n[:-1], 0.014, 0.004, closed=True)
brow_p, brow_n = [], []
for i in range(n_samples(7)):
    x = -0.052 + 0.104 * i / (n_samples(7) - 1)
    h, n = S.cast((x, 1.035, 1.0), (0, 0, -1), 1.0)
    if h is not None:
        brow_p.append(h + n * 0.004)
        brow_n.append(n)
bridle.ribbon(brow_p, brow_n, 0.011, 0.004)
BIT = {s: V((0.047 * s, 0.868, 0.786)) for s in (1, -1)}
for s in (1, -1):
    start = crown_p[0] if (crown_p[0].x > 0) == (s > 0) else crown_p[-1]
    pts = [start.lerp(BIT[s] + V((0, 0.014, -0.012)), i / 6) for i in range(7)]
    pp, pn = surface_path(pts, 0.004)
    bridle.ribbon(pp, pn, 0.012, 0.004)
bridle.mask('neck', lambda p, n: neck_weight(p))
parts.append(bridle.build())

bits = mk.Part('bits', 'body', 'bronze', remesh=False)
for s in (1, -1):
    c = BIT[s]
    ring_pts = [c + V((0, 0.013 * math.cos(2 * math.pi * i / 8), 0.013 * math.sin(2 * math.pi * i / 8))) for i in range(9)]
    bits.tube(ring_pts, 0.0035, seg=4)
bits.mask('neck', lambda p, n: neck_weight(p))
parts.append(bits.build())

reins = mk.Part('reins', 'body', 'darkleather', remesh=False)
for s in (1, -1):
    a, b, c = BIT[s] + V((0, 0.0, -0.01)), V((0.075 * s, 1.0, 0.45)), FIST[1] + V((0.0, 0.005 * s, 0.0))
    pts = []
    for i in range(n_samples(11)):
        t = i / (n_samples(11) - 1)
        q = a * (1 - t) ** 2 + b * 2 * t * (1 - t) + c * t * t
        q.y -= 0.02 * math.sin(math.pi * t)   # a little slack
        pts.append(q)
    pp, _ = surface_path(pts, 0.006)
    reins.tube(pp, 0.0035, seg=4)
reins.mask('neck', lambda p, n: neck_weight(p))
parts.append(reins.build())


# ------------------------------------------------------------------------------------------------ rider: legs
def leg_path(s):
    """Hip -> knee -> ankle -> toe on side s, pushed clear of the horse (cloth and saddle included)."""
    hip = V((0.062 * s, 0.878, -0.02))
    knee_y, knee_z = 0.72, 0.075
    knee = V(((half_width(knee_y, knee_z) + 0.05) * s, knee_y, knee_z))
    ankle_y, ankle_z = 0.53, 0.035
    widest = max(half_width(y, (knee_z + ankle_z) / 2) for y in (0.58, 0.6, 0.62, 0.64, 0.66))
    shin_mid = V(((widest + 0.046) * s, 0.625, (knee_z + ankle_z) / 2))
    ankle = V(((half_width(ankle_y, ankle_z) + 0.04) * s, ankle_y, ankle_z))
    ankle.x = s * max(abs(ankle.x), abs(shin_mid.x) - 0.004)
    toe = ankle + V((0.012 * s, -0.035, 0.1))
    return hip, knee, shin_mid, ankle, toe


legs = mk.Part('legs', 'rhips', 'trousers', voxel=0.0026, smooth=5, tris=620)
boots = mk.Part('boots', 'rhips', 'darkleather', voxel=0.0024, smooth=4, tris=220)
for s in (1, -1):
    hip, knee, shin_mid, ankle, toe = leg_path(s)
    legs.ball(hip, 0.053)
    legs.limb(hip, knee, 0.051, 0.037, seg=14)
    legs.ellipsoid(hip.lerp(knee, 0.4) + V((0, 0.01, 0)), (0.05, 0.045, 0.06))                  # thigh muscle
    legs.ball(knee, 0.037)
    legs.limb(knee, shin_mid, 0.036, 0.032, seg=12)
    legs.limb(shin_mid, ankle, 0.032, 0.025, seg=12)
    legs.ellipsoid(knee.lerp(shin_mid, 0.6) + V((0, 0, -0.012)), (0.03, 0.05, 0.032))           # calf
    boots.limb(shin_mid.lerp(ankle, 0.35), ankle, 0.032, 0.026, seg=12)                          # boot shaft
    boots.limb(ankle, toe, 0.027, 0.022, seg=12, flat=0.8)                                       # foot
    boots.ellipsoid(ankle + V((0, -0.012, -0.015)), (0.025, 0.02, 0.028))                        # heel
legs.ellipsoid((0, 0.905, -0.055), (0.086, 0.062, 0.07))                                        # pelvis
for s in (1, -1):
    legs.ellipsoid((0.045 * s, 0.88, -0.075), (0.05, 0.045, 0.05))                              # seat
parts.append(legs.build())
parts.append(boots.build())

skirt = mk.Part('skirt', 'rhips', 'team', voxel=0.0026, smooth=5, tris=300)
skirt.ellipsoid((0, 0.935, -0.045), (0.094, 0.05, 0.078))                                       # waist
skirt.ellipsoid((0, 0.885, -0.1), (0.096, 0.04, 0.05))                                          # back hem over the saddle
for s in (1, -1):
    hip, knee, _, _, _ = leg_path(s)
    skirt.limb(hip + V((0, 0.012, 0.0)), hip.lerp(knee, 0.45) + V((0, 0.018, 0)), 0.058, 0.05, seg=14)   # over the thigh
parts.append(skirt.build())

belt = mk.Part('belt', 'rhips', 'leather', voxel=0.0024, smooth=3, tris=100)
belt.ellipsoid((0, 0.958, -0.045), (0.09, 0.015, 0.074))
parts.append(belt.build())
buckle = mk.Part('buckle', 'rhips', 'bronze', voxel=0.002, smooth=2, tris=40)
buckle.ellipsoid((0, 0.958, 0.03), (0.016, 0.013, 0.006))
parts.append(buckle.build())

# ------------------------------------------------------------------------------------------------ rider: torso
torso = mk.Part('torso', 'rtorso', 'team', voxel=0.0026, smooth=6, tris=360)
torso.ellipsoid((0, 0.99, -0.045), (0.082, 0.06, 0.063))                                         # abdomen
torso.ellipsoid((0, 1.085, -0.042), (0.102, 0.082, 0.07))                                       # chest
torso.ellipsoid((0, 1.15, -0.047), (0.114, 0.042, 0.06))                                        # shoulders
torso.ellipsoid((0, 1.175, -0.055), (0.07, 0.035, 0.045))                                       # trapezius
parts.append(torso.build())

cuirass = mk.Part('cuirass', 'rtorso', 'leather', voxel=0.0026, smooth=5, tris=340)
cuirass.ellipsoid((0, 0.995, -0.045), (0.094, 0.07, 0.076))
cuirass.ellipsoid((0, 1.08, -0.042), (0.113, 0.088, 0.081))
cuirass.ellipsoid((0, 1.148, -0.047), (0.094, 0.047, 0.068))                                   # upper chest, up to the collar
cuirass.ellipsoid((0, 1.19, -0.045), (0.07, 0.05, 0.08), cut=True)                              # neckline
for s in (1, -1):
    cuirass.ellipsoid((0.112 * s, 1.1, -0.045), (0.03, 0.06, 0.05), cut=True)                   # arm holes
parts.append(cuirass.build())

# ------------------------------------------------------------------------------------------------ rider: head
head = mk.Part('head', 'rhead', 'skin', voxel=0.0018, smooth=4, tris=620)
head.limb(HEAD + V((0, -0.03, 0)), (0, 1.285, -0.04), 0.037, 0.034, seg=14)                    # neck
head.ellipsoid((0, 1.315, -0.042), (0.05, 0.056, 0.057))                                        # cranium
head.ellipsoid((0, 1.28, -0.012), (0.041, 0.03, 0.04))                                          # jaw
head.ellipsoid((0, 1.259, 0.012), (0.02, 0.016, 0.016))                                         # chin
head.ellipsoid((0, 1.326, 0.014), (0.04, 0.01, 0.012))                                          # brow ridge
for s in (1, -1):
    head.ellipsoid((0.028 * s, 1.302, 0.012), (0.016, 0.012, 0.014))                            # cheekbones
    head.ellipsoid((0.051 * s, 1.306, -0.042), (0.008, 0.018, 0.013))                           # ears
    head.ellipsoid((0.018 * s, 1.313, 0.022), (0.011, 0.007, 0.008), cut=True)                  # eye sockets
head.cone((0, 1.318, 0.02), (0, 1.29, 0.046), 0.012, seg=10)                                   # nose
head.ellipsoid((0, 1.29, 0.042), (0.012, 0.007, 0.007))                                         # nose tip
head.ellipsoid((0, 1.272, 0.03), (0.013, 0.002, 0.008), cut=True)                              # mouth
parts.append(head.build())

eyes = mk.Part('reyes', 'rhead', 'eye', voxel=0.0016, smooth=1, tris=50)
for s in (1, -1):
    eyes.ellipsoid((0.018 * s, 1.313, 0.018), (0.006, 0.005, 0.005))
parts.append(eyes.build())

hair = mk.Part('hair', 'rhead', 'hair', voxel=0.002, smooth=3, tris=150)
hair.ellipsoid((0, 1.305, -0.06), (0.053, 0.042, 0.04))                                         # back of the head
for s in (1, -1):
    hair.ellipsoid((0.047 * s, 1.315, -0.022), (0.009, 0.02, 0.014))                           # sideburns
hair.ellipsoid((0, 1.28, -0.04), (0.04, 0.04, 0.04), cut=True)                                  # keep the nape clear
parts.append(hair.build())

cap = mk.Part('cap', 'rhead', 'leather', voxel=0.002, smooth=4, tris=180)
cap.ellipsoid((0, 1.338, -0.045), (0.057, 0.044, 0.062))
cap.ellipsoid((0, 1.32, -0.045), (0.06, 0.008, 0.065))                                          # rim
cap.ellipsoid((0, 1.25, -0.045), (0.09, 0.07, 0.09), cut=True)                                  # open underneath
parts.append(cap.build())


# ------------------------------------------------------------------------------------------------ rider: arms
def arm(s, side):
    sh, el, wr, fist = SH[s], EL[s], WR[s], FIST[s]
    up = mk.Part(f'uparm{side}', f'rarm{side}', 'skin', voxel=0.0022, smooth=4, tris=170)
    up.ball(sh, 0.038)
    up.limb(sh, el, 0.037, 0.031, seg=12)
    up.ellipsoid(sh.lerp(el, 0.62) + V((0, 0, 0.006)), (0.033, 0.04, 0.034))                   # biceps, below the sleeve
    sleeve = mk.Part(f'sleeve{side}', f'rarm{side}', 'team', voxel=0.0022, smooth=4, tris=110)
    sleeve.ball(sh, 0.047)
    sleeve.limb(sh, sh.lerp(el, 0.45), 0.046, 0.042, seg=12)
    fore = mk.Part(f'forearm{side}', f'relbow{side}', 'skin', voxel=0.0022, smooth=4, tris=150)
    fore.ball(el, 0.032)
    fore.limb(el, wr, 0.031, 0.022, seg=12)
    fore.ellipsoid(el.lerp(wr, 0.28), (0.031, 0.034, 0.031))                                     # forearm muscle
    bracer = mk.Part(f'bracer{side}', f'relbow{side}', 'leather', voxel=0.002, smooth=3, tris=70)
    bracer.limb(el.lerp(wr, 0.52), wr.lerp(el, 0.06), 0.03, 0.026, seg=12)
    hand = mk.Part(f'hand{side}', f'rhand{side}', 'skin', voxel=0.0018, smooth=3, tris=120)
    hand.ball(wr, 0.023)
    hand.ellipsoid(fist, (0.024, 0.028, 0.032))                                                   # fist
    hand.limb(fist + V((0.012 * s, 0.012, -0.008)), fist + V((0.004 * s, 0.018, 0.02)), 0.009, 0.007, seg=8)   # thumb
    return up, sleeve, fore, bracer, hand


for s, side in ((1, 'L'), (-1, 'R')):
    for piece in arm(s, side):
        parts.append(piece.build())

# ------------------------------------------------------------------------------------------------ spear (right hand)
SPEAR_DIR = V((0.0, 1.0, 0.1)).normalized()
butt = FIST[-1] - SPEAR_DIR * 0.24
tip = FIST[-1] + SPEAR_DIR * 0.93
shaft = mk.Part('spearshaft', 'rhandR', 'wood', voxel=0.002, smooth=2, tris=90)
shaft.limb(butt, tip - SPEAR_DIR * 0.1, 0.0095, 0.0085, seg=8)
parts.append(shaft.build())
iron = mk.Part('spearhead', 'rhandR', 'iron', voxel=0.0016, smooth=2, tris=110)
head_base = tip - SPEAR_DIR * 0.12
iron.limb(head_base - SPEAR_DIR * 0.02, head_base + SPEAR_DIR * 0.01, 0.011, 0.011, seg=8)     # socket
iron.ellipsoid(head_base + SPEAR_DIR * 0.055, (0.022, 0.058, 0.005), rot=(-math.atan2(SPEAR_DIR.z, SPEAR_DIR.y), 0, 0))  # leaf blade
iron.cone(head_base + SPEAR_DIR * 0.09, tip, 0.012, seg=6)
iron.cone(butt + SPEAR_DIR * 0.03, butt - SPEAR_DIR * 0.03, 0.01, seg=6)                      # butt spike
parts.append(iron.build())
binding = mk.Part('spearbinding', 'rhandR', 'leather', voxel=0.0016, smooth=2, tris=40)
binding.limb(head_base - SPEAR_DIR * 0.045, head_base - SPEAR_DIR * 0.02, 0.012, 0.012, seg=8)
parts.append(binding.build())

# ------------------------------------------------------------------------------------------------ bake and export
horse_occluder = mk.object_from_export(horse_path, part_names=['body'], name='horse_occluder')[0]
ao = mk.bake_ao(parts, dist=0.22, near=0.035, occluders=[horse_occluder])
tris = mk.export_model(parts, ao, BONES, out_path)
print(f'EXPORTED {out_path}: {len(parts)} parts, {tris} triangles')

if preview_path:
    PAL = {
        'skin': (0.62, 0.36, 0.2), 'hair': (0.06, 0.03, 0.015), 'eye': (0.01, 0.008, 0.007), 'team': (0.04, 0.1, 0.62),
        'leather': (0.25, 0.12, 0.05), 'darkleather': (0.07, 0.04, 0.02), 'trousers': (0.18, 0.11, 0.05),
        'wood': (0.2, 0.1, 0.04), 'iron': (0.45, 0.47, 0.5), 'bronze': (0.55, 0.32, 0.08), 'trim': (0.7, 0.6, 0.35),
    }
    colors = {o.name: [tuple(c * (0.25 + 0.75 * a ** 1.2) for c in PAL[o['mat']]) for a in ao[o.name]] for o in parts}
    horse_occluder.hide_render = True
    horse_obj.hide_render = False
    # show the horse in the preview in plain bay, without its own AO
    colors_all = dict(colors)
    parts_all = list(parts)
    hme = horse_obj
    hme['mat'] = 'coat'
    colors_all[hme.name] = [(0.2, 0.085, 0.03)] * len(hme.data.vertices)
    parts_all.append(hme)
    paths = mk.preview(parts_all, colors_all, preview_path, center=(0, 0.75, 0.05), size=1.6,
                       views=(('iso', 45.0, 30.0), ('side', 90.0, 8.0), ('front', 10.0, 12.0, (0, 0.9, 0.2), 1.2),
                              ('rider', 55.0, 20.0, (0, 1.12, 0.0), 0.62), ('head', 50.0, 10.0, (0, 0.95, 0.65), 0.45)))
    print('PREVIEW', paths)
