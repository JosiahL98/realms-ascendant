"""
Siege engines. Run:
  blender --background --factory-startup --python tools/blender/siege.py -- <unit> <out.json> [preview.png]

Units: ram, cappedRam, siegeRam, mangonel, onager, siegeOnager, scorpion, heavyScorpion, bombard, trebuchet.
The engine faces +z with its wheels on y = 0. Bones: root, body, wheelF and wheelB (each a pair of wheels on one
axle, turning about x), and the working part: 'ram' (the swinging log), 'arm' (a throwing arm, turning about x),
'bow' (the scorpion's bow and bolt) or 'barrel' (the bombard's gun). The trebuchet has 'packed' parts (a cart with
the beam folded down) and 'unpacked' parts (the standing frame); its wheels belong to the packed cart.

Timber is built from boxes with their own vertices on every face, so it shades flat like sawn wood; wheels, rope and
the stones are smooth. Materials (the baker colours them): wood, darkwood, plank, hide, iron, rope, stone, bronze,
team (the player's colour).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import modelkit as mk  # noqa: E402
from mathutils import Vector, Matrix  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
flags = {}
while len(args) >= 2 and args[-2].startswith('--'):
    flags[args[-2][2:]] = float(args[-1])
    args = args[:-2]
HORSE_PATH = next((a[6:] for a in args if a.startswith('horse=')), None)
args = [a for a in args if not a.startswith('horse=')]
UNIT, out_path = args[0], args[1]
preview_path = args[2] if len(args) > 2 else None
mk.TRI_SCALE = flags.get('tris', 1.0)
mk.reset_scene()
V = Vector
parts = []
BONES = [{'name': 'root', 'parent': None, 'pivot': [0, 0, 0]}, {'name': 'body', 'parent': 'root', 'pivot': [0, 0, 0]}]
PARTS = {}


def part(name, bone, mat, variant=None):
    """A flat-shaded part (boxes, cylinders) collected by name; built at the end."""
    key = (name, bone, mat, variant)
    if key not in PARTS:
        PARTS[key] = mk.Part(name, bone, mat, remesh=False)
        PARTS[key].keep_winding = True   # boxes and cylinders below are wound outward
    return PARTS[key]


def bone(name, parent, pivot):
    BONES.append({'name': name, 'parent': parent, 'pivot': list(pivot)})


# ------------------------------------------------------------------------------------------------ shapes
def box_frame(p, a, b, w, h, up=(0, 1, 0)):
    """A beam from a to b with cross-section w (sideways) by h (along `up`), every face with its own vertices."""
    a, b = V(a), V(b)
    ax = (b - a).normalized()
    u = V(up) - ax * ax.dot(V(up))
    if u.length < 1e-6:
        u = ax.orthogonal()
    u.normalize()
    s = ax.cross(u).normalized()
    corners = []
    for e in (a, b):
        for cs, cu in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            corners.append(e + s * (cs * w / 2) + u * (cu * h / 2))
    quads = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    verts, faces = [], []
    for q in quads:
        base = len(verts)
        verts += [tuple(corners[i]) for i in q]
        faces.append((base, base + 1, base + 2, base + 3))
    p.mesh(verts, faces)


def beam(p, a, b, w, h=None, up=(0, 1, 0)):
    box_frame(p, a, b, w, h if h is not None else w, up)


def block(p, c, half):
    """An axis-aligned box round c."""
    c = V(c)
    beam(p, c - V((0, 0, half[2])), c + V((0, 0, half[2])), half[0] * 2, half[1] * 2)


def cyl(p, a, b, r, seg=12, caps=True):
    """A cylinder: smooth sides, flat caps (their own vertices)."""
    a, b = V(a), V(b)
    ax = (b - a).normalized()
    u = ax.orthogonal().normalized()
    w = ax.cross(u)
    ring = lambda c: [tuple(c + (u * math.cos(2 * math.pi * k / seg) + w * math.sin(2 * math.pi * k / seg)) * r) for k in range(seg)]
    ra, rb = ring(a), ring(b)
    verts = ra + rb
    faces = [(k, (k + 1) % seg, seg + (k + 1) % seg, seg + k) for k in range(seg)]
    if caps:
        base = len(verts)
        verts += ra + rb
        faces.append(tuple(base + k for k in reversed(range(seg))))
        faces.append(tuple(base + seg + k for k in range(seg)))
    p.mesh(verts, faces)


def wheel(bname, x, y, z, r, width=0.05, spokes=8, mat='darkwood', variant=None):
    """A spoked wheel in the yz-plane at (x, y, z) on bone bname: rim, iron tyre, hub and spokes."""
    c = V((x, y, z))
    s = 1 if x > 0 else -1
    rim = part('wheel', bname, mat, variant)
    tyre = part('tyre', bname, 'iron', variant)
    n = 14
    for k in range(n):
        a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        p0 = c + V((0, math.cos(a0), math.sin(a0))) * (r - 0.018)
        p1 = c + V((0, math.cos(a1), math.sin(a1))) * (r - 0.018)
        beam(rim, p0, p1, width, 0.03, up=(0, math.cos((a0 + a1) / 2), math.sin((a0 + a1) / 2)))
        q0 = c + V((0, math.cos(a0), math.sin(a0))) * (r - 0.002)
        q1 = c + V((0, math.cos(a1), math.sin(a1))) * (r - 0.002)
        beam(tyre, q0, q1, width + 0.006, 0.008, up=(0, math.cos((a0 + a1) / 2), math.sin((a0 + a1) / 2)))
    cyl(rim, c - V((width * 0.9, 0, 0)), c + V((width * 0.9, 0, 0)), r * 0.2, seg=10)
    for k in range(spokes):
        a = 2 * math.pi * (k + 0.5) / spokes
        beam(rim, c + V((0, math.cos(a), math.sin(a))) * r * 0.18, c + V((0, math.cos(a), math.sin(a))) * (r - 0.03),
             0.022, 0.022, up=(1, 0, 0))


def axle(bname, y, z, half, r, variant=None, x_in=None):
    """Two wheels on an axle along x, on a bone turning about the axle."""
    bone(bname, 'body', (0, y, z))
    p = part('axle', bname, 'darkwood', variant)
    cyl(p, (-half - 0.03, y, z), (half + 0.03, y, z), 0.022, seg=8)
    for s in (1, -1):
        wheel(bname, s * half, y, z, r, variant=variant)


def rope(p, pts, r=0.008):
    p.keep_winding = False   # modelkit's tube: let Blender orient it
    p.tube([V(q) for q in pts], r, seg=5)


# ------------------------------------------------------------------------------------------------ rams
if UNIT in ('ram', 'cappedRam', 'siegeRam'):
    tier = ('ram', 'cappedRam', 'siegeRam').index(UNIT)
    L = 1.0 + tier * 0.1
    W = 0.3                      # half width
    WR = 0.16                    # wheel radius
    axle('wheelF', WR, L * 0.32, W + 0.04, WR)
    axle('wheelB', WR, -L * 0.32, W + 0.04, WR)
    wood = part('frame', 'body', 'wood')
    for s in (1, -1):
        beam(wood, (s * W, 0.22, -L / 2), (s * W, 0.22, L / 2), 0.07, 0.08)                       # sills
        for z in (-0.42, 0, 0.42):
            beam(wood, (s * W, 0.2, z * L), (s * (W - 0.02), 0.66, z * L), 0.055, 0.055)          # posts
        beam(wood, (s * (W - 0.02), 0.64, -L / 2), (s * (W - 0.02), 0.64, L / 2), 0.06, 0.06)      # plates
    for z in (-0.45, 0.45):
        beam(wood, (-W, 0.22, z * L), (W, 0.22, z * L), 0.06, 0.07)                                # cross sills
    ridge_y = 0.95
    beam(wood, (0, ridge_y, -L / 2 - 0.02), (0, ridge_y, L / 2 + 0.02), 0.06, 0.06)                # ridge beam
    # the roof: a gable of hides (planks for the capped ram, iron plates on the siege ram) over rafters
    roof_mat = ('hide', 'plank', 'iron')[tier]
    roof = part('roof', 'body', roof_mat)
    n = 7
    for s in (1, -1):
        eave, ridge = V((s * (W + 0.07), 0.6, 0)), V((0, ridge_y + 0.04, 0))
        ax = (ridge - eave).normalized()
        up = V((-ax.y, ax.x, 0)) if s > 0 else V((ax.y, -ax.x, 0))   # the slope's outward normal
        if up.y < 0:
            up = -up
        for k in range(n):
            # boards (hides, plates) closed on every side, so they show from above and below alike
            zc = -L / 2 - 0.03 + (L + 0.06) * (k + 0.5) / n
            wz = (L + 0.06) / n - (0.006 if tier else 0.0)
            beam(roof, eave + V((0, 0, zc)), ridge + V((0, 0, zc)), wz, 0.014, up=tuple(up))
    if tier >= 1:
        cap = part('ridgecap', 'body', 'iron')
        beam(cap, (0, ridge_y + 0.05, -L / 2 - 0.04), (0, ridge_y + 0.05, L / 2 + 0.04), 0.09, 0.04)
    # team-coloured hides hung down the sides
    team = part('hangings', 'body', 'team')
    for s in (1, -1):
        for z in (-0.25, 0.25):
            beam(team, (s * (W + 0.045), 0.62, z * L), (s * (W + 0.045), 0.36, z * L), 0.2 * L, 0.012, up=(s, 0, 0))
    # the ram: a log slung from the ridge by ropes, with an iron head
    RAM_Y = 0.5
    bone('ram', 'body', (0, RAM_Y, 0))
    log = part('ramlog', 'ram', 'darkwood')
    cyl(log, (0, RAM_Y, -L * 0.5), (0, RAM_Y, L * 0.58), 0.07, seg=10)
    head = part('ramhead', 'ram', 'iron' if tier < 2 else 'bronze')
    cyl(head, (0, RAM_Y, L * 0.58), (0, RAM_Y, L * 0.66), 0.085, seg=10)
    cyl(head, (0, RAM_Y, L * 0.66), (0, RAM_Y, L * 0.7), 0.06, seg=10)
    for z in (-0.28, 0.28):
        band = part('rambands', 'ram', 'iron')
        cyl(band, (0, RAM_Y, z * L - 0.02), (0, RAM_Y, z * L + 0.02), 0.076, seg=10)
    ropes = part('ramropes', 'body', 'rope')
    for z in (-0.28, 0.28):
        rope(ropes, [(0, ridge_y - 0.03, z * L), (0, RAM_Y + 0.07, z * L)])
    HEIGHT = 1.1
    KIND = 'ram'

# ------------------------------------------------------------------------------------------------ mangonels
elif UNIT in ('mangonel', 'onager', 'siegeOnager'):
    tier = ('mangonel', 'onager', 'siegeOnager').index(UNIT)
    WR = 0.14
    W = 0.24
    axle('wheelF', WR, 0.3, W + 0.07, WR)
    axle('wheelB', WR, -0.3, W + 0.07, WR)
    wood = part('frame', 'body', 'wood')
    for s in (1, -1):
        beam(wood, (s * W, 0.16, -0.46), (s * W, 0.16, 0.46), 0.08, 0.1)                          # side rails
    for z in (-0.38, 0.38):
        beam(wood, (-W, 0.16, z), (W, 0.16, z), 0.07, 0.08)
    # the uprights and the crossbar the arm strikes
    for s in (1, -1):
        beam(wood, (s * (W - 0.02), 0.2, 0.06), (s * (W - 0.02), 0.55, 0.16), 0.06, 0.06)
        beam(wood, (s * (W - 0.02), 0.2, 0.3), (s * (W - 0.02), 0.52, 0.18), 0.05, 0.05)
    beam(wood, (-W, 0.54, 0.17), (W, 0.54, 0.17), 0.07, 0.07)
    pad = part('pad', 'body', 'hide')
    beam(pad, (-0.12, 0.54, 0.13), (0.12, 0.54, 0.13), 0.08, 0.1)
    # the torsion skein: a bundle of rope across the frame, through which the arm passes
    AXLE_Y, AXLE_Z = 0.22, -0.12
    skein = part('skein', 'body', 'rope')
    cyl(skein, (-W + 0.03, AXLE_Y, AXLE_Z), (W - 0.03, AXLE_Y, AXLE_Z), 0.055, seg=12)
    iron = part('fittings', 'body', 'iron')
    for s in (1, -1):
        cyl(iron, (s * (W + 0.02), AXLE_Y, AXLE_Z), (s * (W + 0.06), AXLE_Y, AXLE_Z), 0.07, seg=12)   # winding washers
        if tier >= 1:
            beam(iron, (s * W, 0.215, -0.46), (s * W, 0.215, 0.46), 0.085, 0.012)
    # the arm: lies back along the frame at rest (cocked), swings up and forward to the crossbar
    bone('arm', 'body', (0, AXLE_Y, AXLE_Z))
    arm = part('arm', 'arm', 'darkwood')
    ARM = 0.6 + 0.06 * tier
    tip = V((0, AXLE_Y + 0.08, AXLE_Z - ARM))
    beam(arm, (0, AXLE_Y, AXLE_Z + 0.04), tip, 0.06, 0.06)
    cup = part('cup', 'arm', 'darkwood')
    cyl(cup, tip + V((0, 0.03, 0)), tip + V((0, 0.07, 0)), 0.075 + 0.01 * tier, seg=12)
    SHOT = tip + V((0, 0.1 + 0.01 * tier, 0))
    bone('shot', 'arm', SHOT)   # the stone: dropped out of sight when it is thrown, back when reloaded
    stone = mk.Part('stone', 'shot', 'stone', voxel=0.004, smooth=3, tris=80)
    stone.ball(SHOT, 0.055 + 0.012 * tier)
    parts.append(stone.build())
    team = part('hangings', 'body', 'team')
    for s in (1, -1):
        beam(team, (s * (W + 0.05), 0.16, -0.2), (s * (W + 0.05), 0.16, 0.2), 0.012, 0.1, up=(0, 1, 0))
    HEIGHT = 0.9
    KIND = 'mangonel'

# ------------------------------------------------------------------------------------------------ scorpions
elif UNIT in ('scorpion', 'heavyScorpion'):
    heavy = UNIT == 'heavyScorpion'
    WR = 0.12
    axle('wheelF', WR, 0.2, 0.25, WR)
    axle('wheelB', WR, -0.25, 0.25, WR)
    wood = part('frame', 'body', 'wood')
    for s in (1, -1):
        beam(wood, (s * 0.17, 0.13, -0.36), (s * 0.17, 0.13, 0.32), 0.06, 0.07)
    for z in (-0.3, 0.26):
        beam(wood, (-0.17, 0.13, z), (0.17, 0.13, z), 0.06, 0.06)
    beam(wood, (0, 0.16, -0.02), (0, 0.4, 0.0), 0.08, 0.08)                                        # the post
    for s in (1, -1):
        beam(wood, (s * 0.15, 0.14, 0.12), (0, 0.36, 0.01), 0.04, 0.04)                             # braces
    # the stock and the bow on a bone that recoils when it looses
    BY, BZ = 0.44, 0.1
    bone('bow', 'body', (0, BY, BZ))
    stock = part('stock', 'bow', 'darkwood')
    beam(stock, (0, BY, BZ - 0.46), (0, BY, BZ + 0.08), 0.07, 0.06)
    frame = part('bowframe', 'bow', 'iron' if heavy else 'darkwood')
    block(frame, (0, BY, BZ), (0.07, 0.07, 0.04))
    arms = part('bowarms', 'bow', 'iron' if heavy else 'wood')
    for s in (1, -1):
        beam(arms, (s * 0.07, BY, BZ), (s * 0.3, BY, BZ - 0.1), 0.035, 0.04)
    cord = part('bowstring', 'bow', 'rope')
    rope(cord, [(0.3, BY, BZ - 0.1), (0, BY + 0.01, BZ - 0.28), (-0.3, BY, BZ - 0.1)], r=0.005)
    bone('shot', 'bow', (0, BY + 0.04, BZ))
    bolt = part('bolt', 'shot', 'darkwood')
    beam(bolt, (0, BY + 0.04, BZ - 0.28), (0, BY + 0.04, BZ + 0.24), 0.016, 0.016)
    point = part('boltpoint', 'shot', 'iron')
    beam(point, (0, BY + 0.04, BZ + 0.24), (0, BY + 0.04, BZ + 0.3), 0.024, 0.024)
    team = part('hangings', 'body', 'team')
    beam(team, (-0.14, 0.2, 0.33), (0.14, 0.2, 0.33), 0.012, 0.12, up=(0, 1, 0))
    HEIGHT = 0.8
    KIND = 'scorpion'

# ------------------------------------------------------------------------------------------------ bombard
elif UNIT == 'bombard':
    WR = 0.24
    axle('wheelF', WR, 0.02, 0.27, WR)
    bone('wheelB', 'body', (0, WR, 0.02))     # one axle: the second wheel bone has no parts
    wood = part('frame', 'body', 'wood')
    for s in (1, -1):
        beam(wood, (s * 0.12, WR + 0.02, 0.12), (s * 0.08, 0.04, -0.7), 0.06, 0.12)                 # cheeks of the trail
    beam(wood, (-0.12, WR, 0.02), (0.12, WR, 0.02), 0.08, 0.08)
    beam(wood, (-0.09, 0.08, -0.62), (0.09, 0.08, -0.62), 0.06, 0.06)
    BY, BZ = WR + 0.1, 0.02
    bone('barrel', 'body', (0, BY, BZ))
    gun = part('barrel', 'barrel', 'darkiron')
    tilt = V((0, 0.08, 1)).normalized()
    cyl(gun, V((0, BY, BZ)) - tilt * 0.34, V((0, BY, BZ)) + tilt * 0.56, 0.1, seg=16)
    bands = part('barrelbands', 'barrel', 'iron')
    for t in (-0.3, -0.05, 0.2, 0.45, 0.54):
        cyl(bands, V((0, BY, BZ)) + tilt * t, V((0, BY, BZ)) + tilt * (t + 0.035), 0.11, seg=16)
    team = part('hangings', 'body', 'team')
    beam(team, (-0.07, 0.2, -0.35), (0.07, 0.2, -0.35), 0.14, 0.012, up=(0, 1, 0.3))
    HEIGHT = 0.8
    KIND = 'bombard'

# ------------------------------------------------------------------------------------------------ trebuchet
elif UNIT == 'trebuchet':
    # standing: a tall A-frame on a base, the long beam with a counterweight box and a sling
    wood = part('frame', 'body', 'wood', 'unpacked')
    for s in (1, -1):
        beam(wood, (s * 0.35, 0.05, -0.72), (s * 0.35, 0.05, 0.72), 0.1, 0.1)
        beam(wood, (s * 0.32, 0.1, 0.5), (s * 0.3, 1.55, 0.0), 0.08, 0.08)
        beam(wood, (s * 0.32, 0.1, -0.5), (s * 0.3, 1.55, 0.0), 0.08, 0.08)
        beam(wood, (s * 0.33, 0.6, 0.34), (s * 0.33, 0.6, -0.34), 0.06, 0.06)
    for z in (-0.62, 0.62):
        beam(wood, (-0.4, 0.05, z), (0.4, 0.05, z), 0.1, 0.1)
    beam(wood, (-0.38, 1.55, 0.0), (0.38, 1.55, 0.0), 0.09, 0.09)                                  # the axle
    team = part('hangings', 'body', 'team', 'unpacked')
    for s in (1, -1):
        beam(team, (s * 0.37, 0.58, 0.0), (s * 0.37, 0.28, 0.0), 0.4, 0.012, up=(s, 0, 0))   # hung from the brace
    # the beam: short end (counterweight) forward-down at rest, the long end back and down on the ground
    bone('arm', 'body', (0, 1.55, 0.0))
    arm = part('arm', 'arm', 'darkwood', 'unpacked')
    back = V((0, 1.55, 0)) + V((0, -0.62, -1.0)).normalized() * 1.6
    front = V((0, 1.55, 0)) + V((0, -0.3, 1.0)).normalized() * 0.55
    beam(arm, front, back, 0.09, 0.09)
    box_w = part('counterweight', 'arm', 'plank', 'unpacked')
    block(box_w, front + V((0, -0.2, 0.0)), (0.2, 0.17, 0.17))
    ironw = part('armiron', 'arm', 'iron', 'unpacked')
    beam(ironw, front + V((-0.21, -0.03, 0)), front + V((0.21, -0.03, 0)), 0.03, 0.03)
    sling = part('sling', 'arm', 'rope', 'unpacked')
    rope(sling, [back, back + V((0, -0.05, 0.25)), back + V((0, -0.02, 0.4))])
    bone('shot', 'arm', back + V((0, 0.02, 0.4)))
    rock = mk.Part('stone', 'shot', 'stone', voxel=0.005, smooth=3, tris=90)
    rock.ball(back + V((0, 0.02, 0.4)), 0.09)
    rock_obj = rock.build()
    rock_obj['variant'] = 'unpacked'
    parts.append(rock_obj)
    # packed: a long cart with the beam laid along it and the frame timbers stacked
    WR = 0.16
    axle('wheelF', WR, 0.5, 0.33, WR, variant='packed')
    axle('wheelB', WR, -0.5, 0.33, WR, variant='packed')
    cart = part('cart', 'body', 'wood', 'packed')
    for s in (1, -1):
        beam(cart, (s * 0.25, 0.2, -0.78), (s * 0.25, 0.2, 0.78), 0.08, 0.1)
    for z in (-0.7, 0, 0.7):
        beam(cart, (-0.27, 0.2, z), (0.27, 0.2, z), 0.06, 0.08)
    beam(cart, (0, 0.33, -0.95), (0, 0.33, 0.95), 0.1, 0.1)
    for s in (1, -1):
        beam(cart, (s * 0.12, 0.3, -0.7), (s * 0.12, 0.3, 0.7), 0.08, 0.08)
    wt = part('packedweight', 'body', 'plank', 'packed')
    block(wt, (0, 0.4, -0.55), (0.18, 0.13, 0.16))
    cover = part('cover', 'body', 'team', 'packed')
    beam(cover, (0, 0.44, 0.1), (0, 0.44, 0.7), 0.44, 0.03)
    HEIGHT = 2.2
    KIND = 'trebuchet'
elif UNIT == 'tradeCart':
    # a two-wheeled cart drawn by a horse in a collar and shafts (horse=<horse.json>, the full-detail horse, to fit
    # the collar to); the cart hangs from the root so it stays level when the horse's body dips in its gait
    horse_obj, horse = mk.object_from_export(HORSE_PATH, part_names=['body'], name='horse')
    HS = mk.Surface(horse_obj)
    hb = {b['name']: b for b in horse['bones']}
    BONES[1] = {'name': 'body', 'parent': 'root', 'pivot': hb['body']['pivot']}
    NP = V(hb['neck']['pivot'])

    def neck_weight(p):
        t = (p[1] - NP.y) * 0.868 + (p[2] - NP.z) * 0.496
        return mk.smoothstep(-0.07, 0.17, t)

    # the collar round the base of the neck
    NA = V((0, 0.868, 0.496))
    c0 = V((0, 0.8, 0.4))
    u = V((0, 0.496, -0.868))   # up and back, across the neck
    w = V((1, 0, 0))
    ring_pts = []
    for k in range(25):
        a = math.radians(-130 + 260 * k / 24)
        d = u * math.cos(a) + w * math.sin(a)
        hit, nrm = HS.cast(c0 + d * 0.4, -d, 0.8)
        if hit is not None:
            ring_pts.append(hit + nrm * 0.03)
    collar = mk.Part('collar', 'body', 'darkleather', remesh=False)
    collar.tube(ring_pts, 0.028, seg=8)
    collar.mask('neck', lambda p, n: neck_weight(p))
    parts.append(collar.build())
    hames = mk.Part('hames', 'body', 'bronze', remesh=False)
    hames.tube([q + V((0, 0.01, 0)) for q in ring_pts[3:-3]], 0.01, seg=6)
    hames.mask('neck', lambda p, n: neck_weight(p))
    parts.append(hames.build())
    # the cart behind the horse
    CZ = -0.95                 # axle
    WR = 0.27
    bone('cart', 'root', (0, WR, CZ))
    bone('wheelF', 'cart', (0, WR, CZ))
    bone('wheelB', 'cart', (0, WR, CZ))   # one axle
    for s in (1, -1):
        wheel('wheelF', s * 0.34, WR, CZ, WR, width=0.05, spokes=10)
    ax = part('axle', 'wheelF', 'darkwood')
    cyl(ax, (-0.38, WR, CZ), (0.38, WR, CZ), 0.025, seg=8)
    bed = part('cartbed', 'cart', 'plank')
    FL = 0.36                  # half length of the bed
    beam(bed, (0, 0.4, CZ - FL), (0, 0.4, CZ + FL), 0.5, 0.04)
    for s in (1, -1):
        beam(bed, (s * 0.25, 0.49, CZ - FL), (s * 0.25, 0.49, CZ + FL), 0.03, 0.14)                # sides
    for z in (-FL, FL):
        beam(bed, (-0.25, 0.49, CZ + z), (0.25, 0.49, CZ + z), 0.03, 0.14)
    frame = part('cartframe', 'cart', 'wood')
    for s in (1, -1):
        beam(frame, (s * 0.2, 0.36, CZ - FL), (s * 0.2, 0.36, CZ + FL + 0.02), 0.05, 0.05)
    # the shafts run from the cart along the horse's flanks to the collar; they move with the horse
    shafts = part('shafts', 'body', 'wood')
    for s in (1, -1):
        front = [q for q in ring_pts if q.x * s > 0]
        f = min(front, key=lambda q: abs(q.y - 0.72)) if front else V((s * 0.2, 0.72, 0.38))
        beam(shafts, (s * 0.22, 0.4, CZ + FL), f + V((s * 0.02, 0, -0.01)), 0.035, 0.035)
    goods = mk.Part('goods', 'cart', 'sack', voxel=0.004, smooth=4, tris=220)
    for c, r in (((0.1, 0.52, CZ + 0.18), (0.1, 0.09, 0.12)), ((-0.12, 0.52, CZ + 0.05), (0.1, 0.09, 0.13)),
                 ((0.08, 0.53, CZ - 0.18), (0.11, 0.1, 0.12))):
        goods.ellipsoid(c, r)
    parts.append(goods.build())
    jars = mk.Part('amphorae', 'cart', 'clay', voxel=0.003, smooth=3, tris=160)
    for x, z in ((-0.13, CZ - 0.2), (-0.14, CZ - 0.05)):
        jars.ellipsoid((x, 0.56, z), (0.05, 0.1, 0.05))
        jars.limb((x, 0.64, z), (x, 0.7, z), 0.02, 0.018)
    parts.append(jars.build())
    cover = part('cover', 'cart', 'team')
    beam(cover, (0, 0.62, CZ - 0.3), (0, 0.62, CZ + 0.3), 0.46, 0.02)
    HEIGHT = 1.2
    KIND = 'cart'
else:
    raise SystemExit(f'unknown unit {UNIT}')

# ------------------------------------------------------------------------------------------------ build and export
variants = {}
for (name, bname, mat, variant), p in PARTS.items():
    o = p.build()
    if variant:
        o['variant'] = variant
    parts.append(o)
ao = mk.bake_ao(parts, dist=0.3, near=0.04)
tris = mk.export_model(parts, ao, BONES, out_path, variants={o.name: o['variant'] for o in parts if 'variant' in o})
import json  # noqa: E402
with open(out_path) as f_:
    data_ = json.load(f_)
data_['meta'] = dict(unit=UNIT, kind=KIND, height=HEIGHT, wheel=WR if 'WR' in dir() else 0.15)
with open(out_path, 'w') as f_:
    json.dump(data_, f_, separators=(',', ':'))
print(f'EXPORTED {out_path}: {len(parts)} parts, {tris} triangles')

if preview_path:
    PAL = {'darkleather': (0.07, 0.04, 0.02), 'sack': (0.4, 0.3, 0.18), 'clay': (0.5, 0.22, 0.1),
           'wood': (0.3, 0.17, 0.07), 'darkwood': (0.16, 0.09, 0.04), 'plank': (0.38, 0.25, 0.12), 'hide': (0.4, 0.28, 0.16),
           'iron': (0.3, 0.31, 0.33), 'darkiron': (0.08, 0.08, 0.09), 'rope': (0.55, 0.45, 0.28), 'stone': (0.45, 0.43, 0.4),
           'bronze': (0.55, 0.32, 0.08), 'team': (0.04, 0.1, 0.62)}
    show = [o for o in parts if o.get('variant', 'unpacked') != 'packed']
    colors = {o.name: [tuple(c * (0.25 + 0.75 * a ** 1.2) for c in PAL[o['mat']]) for a in ao[o.name]] for o in parts}
    for o in parts:
        o.hide_render = o not in show
    paths = mk.preview(parts, colors, preview_path, center=(0, HEIGHT * 0.4, 0), size=max(1.4, HEIGHT * 1.2),
                       views=(('iso', 45.0, 30.0), ('side', 90.0, 8.0), ('front', 15.0, 12.0)))
    if UNIT == 'trebuchet':
        for o in parts:
            o.hide_render = o.get('variant') == 'unpacked'
        paths += mk.preview(parts, colors, preview_path.replace('.png', '_packed.png'), center=(0, 0.3, 0), size=2.0,
                            views=(('iso', 45.0, 30.0),))
    print('PREVIEW', paths)
