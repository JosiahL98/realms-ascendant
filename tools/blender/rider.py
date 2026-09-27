"""
Cavalry rider (scout kit) and horse tack, fitted to the Blender horse. Run:
  blender --background --factory-startup --python tools/blender/rider.py -- <horse.json> <out.json> [preview.png] [--tris 0.38]

<horse.json> is the full-detail horse export (from horse.py); the tack is draped over its surface by ray casting and
the rider's legs are pushed clear of its barrel. Coordinates are the horse's own frame (it faces +z, hooves at y = 0).

Rider bones hang off the horse's 'body' bone and keep the game's names (rhips, rtorso, rhead, rarmL/R, rhandL/R) with
elbow bones added (relbowL/R). Joints are ball joints: each segment ends in a sphere centred on its pivot, so turning
never opens a gap. Tack sits on the 'body' bone; the bridle carries the horse's 'neck' skin weight so they
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
LIGHT = mk.TRI_SCALE < 0.7    # light version: straps are single flat bands

mk.reset_scene()
ss = mk.smoothstep
V = Vector

horse_obj, horse = mk.object_from_export(horse_path, part_names=['body'], name='horse')
hair_obj = mk.object_from_export(horse_path, part_names=['mane', 'tail'], name='horsehair')[0]
S = mk.Surface(horse_obj)                  # what tack is laid onto
CLEAR = mk.Surface(horse_obj, hair_obj)    # what tack and rider must stay out of


def n_samples(k):
    return max(4, int(round(k * DETAIL)))


# ------------------------------------------------------------------------------------------------ skeleton
H = V((0.0, 0.9, -0.04))          # hips (pelvis centre, on the saddle)
T = V((0.0, 0.93, -0.045))        # torso pivot (small of the back)
HEAD = V((0.0, 1.2, -0.05))       # neck base
SH = {1: V((0.108, 1.162, -0.045)), -1: V((-0.108, 1.162, -0.045))}   # shoulders
L_UPPER, L_FORE = 0.175, 0.15      # human proportions: seated, the hands reach the saddle


def elbow_ik(sh, wr, pole):
    """Elbow for a shoulder and wrist, bending towards `pole`."""
    to_w = wr - sh
    d = min(to_w.length, L_UPPER + L_FORE - 1e-4)
    u = to_w.normalized()
    a = (L_UPPER ** 2 - L_FORE ** 2 + d * d) / (2 * d)
    h = math.sqrt(max(0.0, L_UPPER ** 2 - a * a))
    v = (V(pole) - u * V(pole).dot(u)).normalized()
    return sh + u * a + v * h


SEAT_Y = S.cast((0, 2.0, -0.04), (0, -1, 0))[0].y + 0.03    # top of the saddle seat (see saddle below)
# right hand: holds the spear upright at his side; the fist sits just ahead of the wrist
GRIP = V((-0.235, 0.985, 0.13))                 # where the right fist closes on the spear
WR = {-1: GRIP - V((-0.01, 0.01, 0.035))}
# left hand: rests on the saddle's left front horn, palm down, clear of his lap
PALM = V((0.045, SEAT_Y + 0.062, 0.14))
WR[1] = PALM + V((0.022, 0.016, -0.04))
EL = {-1: elbow_ik(SH[-1], WR[-1], (-0.6, -1, -0.35)), 1: elbow_ik(SH[1], WR[1], (1, -0.12, -0.25))}   # right pole = HOLD_POLE in rider-pose.cjs
FIST = {-1: GRIP, 1: PALM}

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
grid, nrm = draped(cloth_z0, cloth_z1, rows, cloth_hem, 0.007, n_top=n_samples(4), n_side=n_samples(8))
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
saddle = mk.Part('saddle', 'body', 'leather', voxel=0.0028, smooth=4, tris=520, symmetric=True)
srows = 9
sgrid, snrm = draped(-0.15, 0.025, srows, lambda z: 0.755, 0.012, top_half=0.06, n_top=5, n_side=5)   # flaps end behind the thighs
saddle.mesh(*shell(sgrid, snrm, 0.018))
seat_top = top_y(0, -0.04) + 0.03
saddle.ellipsoid((0, seat_top + 0.01, 0.062), (0.045, 0.02, 0.028))         # pommel, narrow enough to sit between the thighs
saddle.ellipsoid((0, seat_top + 0.018, -0.14), (0.075, 0.028, 0.028))       # cantle
for s in (1, -1):
    # front horns curl out over the thighs, rear horns rise behind the rider
    saddle.limb((0.032 * s, seat_top + 0.014, 0.1), (0.05 * s, seat_top + 0.05, 0.165), 0.014, 0.01, seg=12)
    saddle.limb((0.045 * s, seat_top + 0.01, -0.125), (0.065 * s, seat_top + 0.06, -0.155), 0.016, 0.01, seg=12)
parts.append(saddle.build())

bronze = mk.Part('saddlebronze', 'body', 'bronze', voxel=0.0025, smooth=2, tris=120)
for s in (1, -1):
    bronze.ball((0.05 * s, seat_top + 0.05, 0.165), 0.011)
    bronze.ball((0.065 * s, seat_top + 0.06, -0.155), 0.011)
parts.append(bronze.build())

# ------------------------------------------------------------------------------------------------ straps
STRAP_STEP = 0.008   # dense sampling along straps before thinning; short enough that no stretch sinks in


def resample(points, step, closed=False):
    pts = [V(p) for p in points] + ([V(points[0])] if closed else [])
    out = [pts[0]]
    carry = 0.0
    for a, b in zip(pts, pts[1:]):
        seg = (b - a).length
        d = step - carry
        while d <= seg:
            out.append(a.lerp(b, d / seg))
            d += step
        carry = seg - (d - step)
    if not closed and (out[-1] - pts[-1]).length > step * 0.3:
        out.append(pts[-1])
    if closed and (out[-1] - out[0]).length < step * 0.3:
        out.pop()
    return out


def settle(points, gap, closed=False, step=None):
    """
    Lays a path onto the horse: resampled densely, every point pushed out to `gap` above the surface (body, mane
    and tail), with the surface normal smoothed along the path so a strap does not twist over facets.
    """
    pts = resample(points, step or STRAP_STEP, closed)

    def push(ps):
        out_, nrm_ = [], []
        for p in ps:
            d, n = CLEAR.signed_distance(p)
            n = n if n is not None else V((0, 1, 0))
            out_.append(p + n * (gap - d) if d < gap else p)
            nrm_.append(n)
        return out_, nrm_

    out, nrm = push(pts)
    for _ in range(2):   # pushing out facet by facet leaves a jagged path: relax it and push again
        k = len(out)
        relaxed = [out[i] if not closed and i in (0, k - 1) else
                   (out[(i - 1) % k] + out[i] * 2 + out[(i + 1) % k]) / 4 for i in range(k)]
        out, nrm = push(relaxed)
    k = len(nrm)
    smooth = []
    for i in range(k):
        a = nrm[(i - 1) % k] if closed or i > 0 else nrm[i]
        b = nrm[(i + 1) % k] if closed or i < k - 1 else nrm[i]
        smooth.append((a + nrm[i] * 2 + b).normalized())
    return thin(out, smooth, gap, closed)


def thin(pts, nrm, gap, closed, max_len=0.07 if not LIGHT else 0.09, max_turn=0.35 if not LIGHT else 0.6):
    """Drops points on smooth stretches: a span is kept straight only while every dense point it skips stays clear
    of the surface and the strap's facing turns by less than max_turn radians."""
    n = len(pts)
    keep = [0]
    i = 0
    while i < n - 1:
        j = i + 1
        while j + 1 < n:
            a, b = pts[i], pts[j + 1]
            if (b - a).length > max_len or nrm[i].angle(nrm[j + 1]) > max_turn:
                break
            ok = True
            for m in range(i + 1, j + 1):
                t = (m - i) / (j + 1 - i)
                if CLEAR.signed_distance(a.lerp(b, t))[0] < gap * 0.6:
                    ok = False
                    break
            if not ok:
                break
            j += 1
        keep.append(j)
        i = j
    if closed and keep[-1] == n - 1 and n > 3:
        pass
    return [pts[k] for k in keep], [nrm[k] for k in keep]


straps = mk.Part('straps', 'body', 'darkleather', remesh=False)
# girth: under the belly behind the elbows, from cloth edge to cloth edge
gp, _ = ring((0, 0.63, 0.07), (0, 0, 1), (0, 1, 0), 0.6, 50, 310, 40, 0.0)   # under the cloth, ends hidden by it
straps.ribbon(*settle(gp, 0.003), 0.034, 0.006, top_only=LIGHT)
# breast collar round the front of the chest, from the saddle's front corners
bp = []
for i in range(40):
    a = math.radians(-80 + 160 * i / 39)
    y = 0.655 + 0.04 * (abs(a) / math.radians(80)) ** 2
    d = V((math.sin(a), 0, math.cos(a)))
    h, n = S.cast(V((0, y, 0.18)) + d * 0.6, -d, 1.2)
    if h is not None:
        bp.append(h)
# the breast collar runs back along both sides and ends under the saddle cloth
left, right = (bp[-1], bp[0]) if bp[-1].x > 0 else (bp[0], bp[-1])
tails = {}
for end in (left, right):
    sgn = 1 if end.x > 0 else -1
    path = []
    for j in range(1, 13):
        z = end.z + (0.06 - end.z) * j / 12
        h, _ = S.cast((sgn * 1.0, end.y, z), (-sgn, 0, 0))
        if h is not None:
            path.append(h)
    tails[sgn] = path
bp = list(reversed(tails[1] if bp[0].x > 0 else tails[-1])) + bp + (tails[-1] if bp[0].x > 0 else tails[1])
bp, bn = settle(bp, 0.003)
straps.ribbon(bp, bn, 0.026, 0.006, top_only=LIGHT)
# crupper along the spine to the root of the tail
cp = []
for i in range(20):
    z = -0.19 - 0.27 * i / 19
    h, _ = S.cast((0, 2.0, z), (0, -1, 0))
    cp.append(h)
straps.ribbon(*settle(cp, 0.003), 0.018, 0.005, top_only=LIGHT)
parts.append(straps.build())

pendant = mk.Part('pendant', 'body', 'bronze', voxel=0.0022, smooth=2, tris=80)
fi = min(range(len(bp)), key=lambda i: abs(bp[i].x))
front, fn = bp[fi], bn[fi]
pendant.ellipsoid(front + fn * 0.012 + V((0, -0.03, 0)), (0.02, 0.024, 0.006))              # lunula on the breast collar
pendant.limb(front + fn * 0.008 + V((0, -0.002, 0)), front + fn * 0.012 + V((0, -0.02, 0)), 0.004, 0.004, seg=8)
parts.append(pendant.build())

# ------------------------------------------------------------------------------------------------ bridle and reins
HEAD_AXIS = V((0, -0.614, 0.789))       # poll towards muzzle
bridle = mk.Part('bridle', 'body', 'darkleather', remesh=False)
crown_p, _ = ring((0, 0.985, 0.585), HEAD_AXIS, (0, 0.789, 0.614), 0.4, -118, 118, 36, 0.0)
crown_p, crown_n = settle(crown_p, 0.0025)
bridle.ribbon(crown_p, crown_n, 0.014, 0.004, top_only=LIGHT)
nose_p, _ = ring((0, 0.905, 0.745), HEAD_AXIS, (0, 0.789, 0.614), 0.4, 0, 360, 48, 0.0)
bridle.ribbon(*settle(nose_p[:-1], 0.0025, closed=True), 0.014, 0.004, closed=True, top_only=LIGHT)
brow_p = []
for i in range(15):
    x = -0.052 + 0.104 * i / 14
    h, _ = S.cast((x, 1.035, 1.0), (0, 0, -1), 1.0)
    if h is not None:
        brow_p.append(h)
bridle.ribbon(*settle(brow_p, 0.0025), 0.011, 0.004, top_only=LIGHT)
BIT = {s: V((0.047 * s, 0.868, 0.786)) for s in (1, -1)}
for s in (1, -1):
    start = crown_p[0] if (crown_p[0].x > 0) == (s > 0) else crown_p[-1]
    pts = [start.lerp(BIT[s] + V((0, 0.014, -0.012)), i / 12) for i in range(13)]
    bridle.ribbon(*settle(pts, 0.0025), 0.012, 0.004, top_only=LIGHT)
bridle.mask('neck', lambda p, n: neck_weight(p))
parts.append(bridle.build())

bits = mk.Part('bits', 'body', 'bronze', remesh=False)
for s in (1, -1):
    c = BIT[s]
    ring_pts = [c + V((0, 0.013 * math.cos(2 * math.pi * i / 8), 0.013 * math.sin(2 * math.pi * i / 8))) for i in range(9)]
    bits.tube(ring_pts, 0.0035, seg=4)
bits.mask('neck', lambda p, n: neck_weight(p))
parts.append(bits.build())



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


legs = mk.Part('legs', 'rhips', 'trousers', voxel=0.0026, smooth=5, tris=620, symmetric=True)
boots = mk.Part('boots', 'rhips', 'darkleather', voxel=0.0024, smooth=4, tris=220, symmetric=True)
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

skirt = mk.Part('skirt', 'rhips', 'team', voxel=0.0026, smooth=5, tris=300, symmetric=True)
skirt.ellipsoid((0, 0.935, -0.045), (0.094, 0.05, 0.078))                                       # waist
skirt.ellipsoid((0, 0.9, -0.095), (0.096, 0.036, 0.048))                                        # back hem over the saddle
for s in (1, -1):
    hip, knee, _, _, _ = leg_path(s)
    skirt.limb(hip + V((0, 0.012, -0.004)), hip.lerp(knee, 0.34) + V((0, 0.018, -0.006)), 0.058, 0.049, seg=14)  # over the thigh
parts.append(skirt.build())

belt = mk.Part('belt', 'rhips', 'leather', voxel=0.0024, smooth=3, tris=100, symmetric=True)
belt.ellipsoid((0, 0.958, -0.045), (0.09, 0.015, 0.074))
parts.append(belt.build())
buckle = mk.Part('buckle', 'rhips', 'bronze', voxel=0.002, smooth=2, tris=40)
buckle.ellipsoid((0, 0.958, 0.03), (0.016, 0.013, 0.006))
parts.append(buckle.build())

# ------------------------------------------------------------------------------------------------ rider: torso
torso = mk.Part('torso', 'rtorso', 'team', voxel=0.0026, smooth=6, tris=360, symmetric=True)
torso.ellipsoid((0, 0.99, -0.045), (0.082, 0.06, 0.063))                                         # abdomen
torso.ellipsoid((0, 1.085, -0.042), (0.102, 0.082, 0.07))                                       # chest
torso.ellipsoid((0, 1.15, -0.047), (0.114, 0.042, 0.06))                                        # shoulders
torso.ellipsoid((0, 1.182, -0.058), (0.078, 0.04, 0.047))                                       # trapezius
torso.ellipsoid((0, 1.17, -0.025), (0.06, 0.03, 0.045))                                         # collar and upper chest
parts.append(torso.build())

cuirass = mk.Part('cuirass', 'rtorso', 'leather', voxel=0.0026, smooth=5, tris=340, symmetric=True)
cuirass.ellipsoid((0, 0.995, -0.045), (0.094, 0.07, 0.076))
cuirass.ellipsoid((0, 1.08, -0.042), (0.113, 0.088, 0.081))
cuirass.ellipsoid((0, 1.148, -0.047), (0.094, 0.047, 0.068))                                   # upper chest, up to the collar
cuirass.ellipsoid((0, 1.19, -0.045), (0.07, 0.05, 0.08), cut=True)                              # neckline
for s in (1, -1):
    cuirass.ellipsoid((0.112 * s, 1.1, -0.045), (0.03, 0.06, 0.05), cut=True)                   # arm holes
parts.append(cuirass.build())

# ------------------------------------------------------------------------------------------------ rider: head
CR = V((0.0, 1.29, -0.036))       # centre of the skull; the face is built around it
head = mk.Part('head', 'rhead', 'skin', voxel=0.0017, smooth=8, tris=900, symmetric=True)   # the face needs its triangles
head.limb(HEAD + V((0, -0.025, -0.01)), CR + V((0, -0.045, -0.004)), 0.036, 0.032, seg=14)      # neck, leaning forward
head.ellipsoid(CR, (0.05, 0.055, 0.057))                                                        # cranium
head.ellipsoid(CR + V((0, -0.03, 0.02)), (0.041, 0.042, 0.042))                                 # face
head.ellipsoid(CR + V((0, -0.052, 0.012)), (0.037, 0.024, 0.04))                                # jaw
head.ellipsoid(CR + V((0, -0.066, 0.042)), (0.018, 0.014, 0.015))                               # chin
head.ellipsoid(CR + V((0, -0.022, 0.057)), (0.009, 0.017, 0.012), rot=(0.25, 0, 0))            # nose
for s_ in (1, -1):
    head.ellipsoid(CR + V((0.051 * s_, -0.013, -0.002)), (0.008, 0.017, 0.012))                # ears


def hair_region(p, n):
    back = mk.smoothstep(CR.z + 0.012, CR.z - 0.012, p[2]) * mk.smoothstep(CR.y - 0.054, CR.y - 0.04, p[1])
    side = (mk.smoothstep(0.036, 0.044, abs(p[0])) * mk.smoothstep(CR.y - 0.032, CR.y - 0.022, p[1])
            * mk.smoothstep(CR.z + 0.03, CR.z + 0.018, p[2]))
    return max(back, side)


head.mask('hair', hair_region)
parts.append(head.build())

cap = mk.Part('cap', 'rhead', 'leather', voxel=0.002, smooth=4, tris=180, symmetric=True)
cap.ellipsoid(CR + V((0, 0.03, -0.004)), (0.057, 0.042, 0.062))
cap.ellipsoid(CR + V((0, 0.014, -0.006)), (0.06, 0.008, 0.064))                                # rim, above the brow
cap.ellipsoid(CR + V((0, -0.056, -0.004)), (0.09, 0.07, 0.09), cut=True)                       # open underneath
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
    if s < 0:
        hand.limb(wr, fist, 0.02, 0.022, seg=10)                                                  # palm
        hand.ellipsoid(fist, (0.024, 0.028, 0.032))                                               # fist round the spear
        hand.limb(fist + V((0.012 * s, 0.012, -0.008)), fist + V((0.004 * s, 0.018, 0.02)), 0.009, 0.007, seg=8)   # thumb
    else:
        # a relaxed hand lying on the pommel, fingers curling over its front
        yaw = math.atan2(fist.x - wr.x, fist.z - wr.z)
        hand.limb(wr, fist, 0.02, 0.018, seg=10, flat=1.3)
        hand.ellipsoid(fist, (0.026, 0.013, 0.03), rot=(0.25, yaw, 0))
        hand.ellipsoid(fist + V((-0.004, -0.014, 0.024)), (0.022, 0.014, 0.012), rot=(0.3, yaw, 0))
        hand.limb(wr + V((-0.015, -0.004, 0.012)), fist + V((-0.022, -0.004, 0.0)), 0.009, 0.007, seg=8)       # thumb
    return up, sleeve, fore, bracer, hand


for s, side in ((1, 'L'), (-1, 'R')):
    for piece in arm(s, side):
        parts.append(piece.build())

# ------------------------------------------------------------------------------------------------ spear (right hand)
SPEAR_DIR = V((0.03, 1.0, -0.12)).normalized()   # upright, butt a little forward of the grip, clear of the knee
SPEAR_REAR, SPEAR_FRONT = 0.38, 0.95
BONES.append({'name': 'rspear', 'parent': 'rtorso', 'pivot': list(GRIP)})
butt = GRIP - SPEAR_DIR * SPEAR_REAR
tip = GRIP + SPEAR_DIR * SPEAR_FRONT
shaft = mk.Part('spearshaft', 'rspear', 'wood', voxel=0.002, smooth=2, tris=90)
shaft.limb(butt, tip - SPEAR_DIR * 0.1, 0.0095, 0.0085, seg=8)
parts.append(shaft.build())
iron = mk.Part('spearhead', 'rspear', 'iron', voxel=0.0016, smooth=2, tris=110)
head_base = tip - SPEAR_DIR * 0.12
iron.limb(head_base - SPEAR_DIR * 0.02, head_base + SPEAR_DIR * 0.01, 0.011, 0.011, seg=8)     # socket
iron.ellipsoid(head_base + SPEAR_DIR * 0.055, (0.022, 0.058, 0.005), rot=(-math.atan2(SPEAR_DIR.z, SPEAR_DIR.y), 0, 0))  # leaf blade
iron.cone(head_base + SPEAR_DIR * 0.09, tip, 0.012, seg=6)
iron.cone(butt + SPEAR_DIR * 0.03, butt - SPEAR_DIR * 0.03, 0.01, seg=6)                      # butt spike
parts.append(iron.build())
binding = mk.Part('spearbinding', 'rspear', 'leather', voxel=0.0016, smooth=2, tris=40)
binding.limb(head_base - SPEAR_DIR * 0.045, head_base - SPEAR_DIR * 0.02, 0.012, 0.012, seg=8)
parts.append(binding.build())

# ------------------------------------------------------------------------------------------------ layers
# Each garment is pushed out from what it covers, and what it covers is pulled back in, so nothing shows through.
by_name = {o.name: o for o in parts}
LAYER_GAP = 1.6 if LIGHT else 1.0   # the light version's larger faces need more room
LAYERS = [
    ('cuirass', ['torso'], 0.004), ('sleeveL', ['uparmL'], 0.003), ('sleeveR', ['uparmR'], 0.003),
    ('bracerL', ['forearmL'], 0.003), ('bracerR', ['forearmR'], 0.003), ('boots', ['legs'], 0.003),
    ('skirt', ['legs'], 0.005), ('belt', ['skirt'], 0.002), ('buckle', ['belt'], 0.0015),
    ('cap', ['head'], 0.008),
]
for outer, inners, gap in LAYERS:
    out_n, in_n = mk.separate(by_name[outer], [by_name[i] for i in inners], gap * LAYER_GAP)
    print(f'LAYER {outer:<9} over {"+".join(inners):<10} moved {out_n:4d} out, {in_n:4d} underneath in')

# ------------------------------------------------------------------------------------------------ clearance
# Straps laid across hollows dip in at their edges, and the fitted shapes can graze the horse where the surface
# curves: push anything inside (or closer than a small gap) back out along the surface normal.
TACK_GAP = {'cloth': 0.005, 'clothtrim': 0.006, 'saddle': 0.006, 'saddlebronze': 0.004, 'straps': 0.003,
            'pendant': 0.002, 'bridle': 0.0025, 'bits': 0.002}
for name, gap in TACK_GAP.items():
    inside, deep = CLEAR.push_out(by_name[name], gap)
    after = CLEAR.report(by_name[name])
    print(f'CLEARANCE {name:<13} inside before {inside:4d} (deepest {deep * 1000:.1f} mm)  after {after[0]}')
# The rider sits on the saddle and hangs his legs against the horse. Only closed shapes (horse, saddle) can say
# which side of them a point is on, so the cloth's thickness is allowed for with a larger gap where it lies.
SEAT = mk.Surface(horse_obj, hair_obj, by_name['saddle'])


def under_cloth(p):
    return cloth_z0 - 0.01 < p[2] < cloth_z1 + 0.01 and p[1] > cloth_hem(p[2]) - 0.01


for name in ('legs', 'boots', 'skirt'):
    obj = by_name[name]
    if name == 'skirt':
        # the tunic hangs over the trousers and must clear the saddle horns
        SEAT = mk.Surface(horse_obj, hair_obj, by_name['saddle'], by_name['legs'])
        near = 0.008
    near = 0.003 if name != 'skirt' else 0.008
    for _ in range(2):   # a second pass catches points pushed from one surface into another
        a_ = SEAT.push_out(obj, 0.014, only=under_cloth)
        b_ = SEAT.push_out(obj, near, only=lambda p: not under_cloth(p))
    print(f'CLEARANCE {name:<13} inside before {a_[0] + b_[0]:4d} (deepest {max(a_[1], b_[1]) * 1000:.1f} mm)  after {SEAT.report(obj)[0]}')
    if os.environ.get('CLEAR_DEBUG'):
        for v in obj.data.vertices:
            q = mk.b2g(v.co)
            d, n = SEAT.signed_distance(q)
            if n is not None and d < 0:
                dh = CLEAR.signed_distance(q)[0]
                print(f'   still inside {name}: ({q[0]:+.3f},{q[1]:.3f},{q[2]:+.3f}) depth {-d*1000:.1f}mm normal ({n.x:+.2f},{n.y:+.2f},{n.z:+.2f}) horse-dist {dh*1000:.1f}mm')

# legs were moved off the horse after layering: lay the boots and tunic over them again
for outer, inners, gap in LAYERS:
    if outer in ('boots', 'skirt'):
        mk.separate(by_name[outer], [by_name[i] for i in inners], gap * LAYER_GAP)
# finally the tunic rests on the saddle: keep it out of the saddle (and the horse), then report what still overlaps
SADDLE_ONLY = mk.Surface(horse_obj, by_name['saddle'])
for _ in range(2):
    SADDLE_ONLY.push_out(by_name['skirt'], 0.004)
print('SKIRT inside saddle/horse:', SADDLE_ONLY.report(by_name['skirt'])[0],
      '| legs poking through skirt:', mk.Surface(by_name['skirt']).report(by_name['legs'])[0] if False else 'n/a')

# the saddle seat gives under the rider: press it down out of his seat and thighs (never more than 3 cm)
for _ in range(3):
    for garment in ('legs', 'skirt'):
        mk.Surface(by_name[garment]).push_out(by_name['saddle'], 0.002, max_depth=0.03)
        mk.Surface(by_name['saddle']).push_out(by_name[garment], 0.001, max_depth=0.03)

# ------------------------------------------------------------------------------------------------ audit
# Thin parts (saddle horns, cantle) can pierce a garment between its vertices, so test both directions.
AUDIT = [('saddle', 'legs'), ('saddle', 'skirt'), ('legs', 'saddle'), ('skirt', 'saddle'), ('saddlebronze', 'legs'),
         ('saddlebronze', 'skirt')]
for a_, b_ in AUDIT:
    surf = mk.Surface(by_name[b_])
    n_in = surf.report(by_name[a_])[0]
    print(f'AUDIT {a_:<12} vertices inside {b_:<8}: {n_in}')
    if n_in and os.environ.get('CLEAR_DEBUG'):
        for v in by_name[a_].data.vertices:
            q = mk.b2g(v.co)
            d, _ = surf.signed_distance(q)
            if d < 0:
                print(f'    ({q[0]:+.3f}, {q[1]:.3f}, {q[2]:+.3f}) depth {-d * 1000:.1f} mm')

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
    colors = {}
    for o in parts:
        hm = mk.vertex_masks(o).get('hair')
        cols = []
        for i, a in enumerate(ao[o.name]):
            c = PAL[o['mat']]
            if hm:
                w = hm[i]
                c = tuple(c[j] * (1 - w) + PAL['hair'][j] * w for j in range(3))
            cols.append(tuple(v * (0.25 + 0.75 * a ** 1.2) for v in c))
        colors[o.name] = cols
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
                              ('rider', 55.0, 20.0, (0, 1.12, 0.0), 0.62), ('head', 50.0, 10.0, (0, 0.95, 0.65), 0.45),
                              ('face', 0.0, 5.0, (0, 1.27, -0.03), 0.2), ('profile', 90.0, 5.0, (0, 1.27, -0.03), 0.2),
                              ('face34', 40.0, 12.0, (0, 1.27, -0.03), 0.2),
                              ('seat', 70.0, 22.0, (0.05, 0.84, -0.03), 0.36), ('seatback', 150.0, 25.0, (0.02, 0.84, -0.06), 0.36),
                              ('chest', 25.0, 8.0, (0.05, 0.68, 0.42), 0.36), ('belly', 80.0, 3.0, (0.05, 0.55, 0.1), 0.45),
                              ('bridle2', 75.0, 12.0, (0, 0.96, 0.66), 0.3), ('crupper', 120.0, 30.0, (0, 0.78, -0.36), 0.36),
                              ('back', 200.0, 25.0, (0, 1.1, -0.05), 0.34), ('thighL', 60.0, 30.0, (0.1, 0.88, 0.05), 0.26),
                              ('chestF', 15.0, 15.0, (0, 1.1, -0.02), 0.3), ('thighR', -60.0, 30.0, (-0.1, 0.88, 0.05), 0.26),
                              ('headback', 160.0, 20.0, (0, 1.27, -0.04), 0.2), ('headgame', 45.0, 30.0, (0, 1.27, -0.03), 0.2),
                              ('lefthand', 50.0, 35.0, (0.07, 0.95, 0.08), 0.3),
                              ('breast', 50.0, 20.0, (0.05, 0.7, 0.35), 0.45), ('neckstrap', 90.0, 15.0, (0, 0.78, 0.2), 0.45)))
    print('PREVIEW', paths)
