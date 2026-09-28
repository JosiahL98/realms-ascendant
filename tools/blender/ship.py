"""
Ships. Run:
  blender --background --factory-startup --python tools/blender/ship.py -- <unit> <out.json> [preview.png]

The ship faces +z with its waterline at y = 0. Bones: root, hull (bobs and rolls), sail (the sails swell and slacken),
oarsL / oarsR (each bank of oars sweeps together, pivoting in the rowlocks), net (the fishing net, cast and hauled).
The hull is one smooth loft through cross-sections from stern to bow, rising at both ends; the deck is laid inside it
in planks; timber fittings are boxes with their own vertices per face so they shade flat.

Materials (the baker colours them): hull, deck, wood, darkwood, sail, team, rope, iron, darkiron, bronze, fire, skin,
hair, cargo, clay.
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
UNIT, out_path = args[0], args[1]
preview_path = args[2] if len(args) > 2 else None
mk.TRI_SCALE = flags.get('tris', 1.0)
mk.reset_scene()
V = Vector
ss = mk.smoothstep

SHIPS = {
    'fishingShip': dict(len=1.0, wid=0.26, mast=0.8, sail='lateen', net=True, crew=1),
    'transportShip': dict(len=1.45, wid=0.4, mast=1.0, sail='square', cargo=True, crew=1),
    'tradeCog': dict(len=1.3, wid=0.44, mast=1.1, sail='square', castle=True, cargo=True, crew=1, round=True),
    'galley': dict(len=1.8, wid=0.3, mast=1.0, sail='square', oars=6, ram=True, crew=3),
    'warGalley': dict(len=1.95, wid=0.32, mast=1.1, sail='square', oars=7, ram=True, shields=True, crew=3),
    'galleon': dict(len=2.1, wid=0.42, mast=1.3, sail='square', masts=2, castle=True, shields=True, crew=3, round=True),
    'fireShip': dict(len=1.6, wid=0.3, mast=0.9, sail='square', oars=5, fire=True, crew=2),
    'fastFireShip': dict(len=1.7, wid=0.3, mast=1.0, sail='square', oars=6, fire=True, ram=True, crew=2),
    'demolitionShip': dict(len=1.1, wid=0.28, sail='none', oars=3, kegs=True, crew=1),
    'heavyDemolitionShip': dict(len=1.25, wid=0.3, sail='none', oars=4, kegs=True, crew=1),
    'cannonGalleon': dict(len=2.2, wid=0.45, mast=1.3, sail='square', masts=2, castle=True, cannons=True, crew=2, round=True),
}
O = SHIPS[UNIT]
L, W = O['len'], O['wid']
TOP = 0.2 if not O.get('round') else 0.24      # deck height at midships
KEEL = -0.13
BONES = [{'name': 'root', 'parent': None, 'pivot': [0, 0, 0]}, {'name': 'hull', 'parent': 'root', 'pivot': [0, 0, 0]}]
parts = []
PARTS = {}


def bone(name, parent, pivot):
    BONES.append({'name': name, 'parent': parent, 'pivot': list(pivot)})


def part(name, bone_, mat):
    key = (name, bone_, mat)
    if key not in PARTS:
        PARTS[key] = mk.Part(name, bone_, mat, remesh=False)
        PARTS[key].keep_winding = True
    return PARTS[key]


def beam(p, a, b, w, h=None, up=(0, 1, 0)):
    """A beam from a to b, w wide and h deep, every face with its own vertices (wound outward)."""
    h = w if h is None else h
    a, b = V(a), V(b)
    ax = (b - a).normalized()
    u = V(up) - ax * ax.dot(V(up))
    if u.length < 1e-6:
        u = ax.orthogonal()
    u.normalize()
    s = ax.cross(u).normalized()
    cs = [e + s * (x * w / 2) + u * (y * h / 2) for e in (a, b) for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    verts, faces = [], []
    for q in [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]:
        n = len(verts)
        verts += [tuple(cs[i]) for i in q]
        faces.append((n, n + 1, n + 2, n + 3))
    p.mesh(verts, faces)


def cyl(p, a, b, r, seg=10, r1=None):
    a, b = V(a), V(b)
    r1 = r if r1 is None else r1
    ax = (b - a).normalized()
    u = ax.orthogonal().normalized()
    w = ax.cross(u)
    ra = [tuple(a + (u * math.cos(2 * math.pi * k / seg) + w * math.sin(2 * math.pi * k / seg)) * r) for k in range(seg)]
    rb = [tuple(b + (u * math.cos(2 * math.pi * k / seg) + w * math.sin(2 * math.pi * k / seg)) * r1) for k in range(seg)]
    verts = ra + rb + ra + rb
    faces = [(k, (k + 1) % seg, seg + (k + 1) % seg, seg + k) for k in range(seg)]
    faces.append(tuple(2 * seg + k for k in reversed(range(seg))))
    faces.append(tuple(3 * seg + k for k in range(seg)))
    p.mesh(verts, faces)


# ------------------------------------------------------------------------------------------------ hull
def half_width(t):
    """Half-width at t (-1 stern .. +1 bow): full amidships, fining to the ends (rounder for cogs and galleons)."""
    k = 1.6 if O.get('round') else 2.4
    return W * max(0.0, 1 - abs(t) ** k) ** (0.55 if t > 0 else 0.45) + 0.004


def sheer(t):
    """Deck-edge height: rising towards bow and stern."""
    return TOP + 0.1 * abs(t) ** 2.5 + (0.04 if t < 0 and O.get('round') else 0.0) * abs(t) ** 2


N = 20
rings = []
for i in range(N + 1):
    t = -1 + 2 * i / N
    z = t * L / 2
    w = half_width(t)
    top = sheer(t)
    keel = KEEL * (1 - 0.55 * abs(t) ** 3)
    yc = top - 0.004                       # widest at the gunwale: the ring is the hull below it and a thin cap
    rings.append(((0, yc, z), (1, 0, 0), (0, 1, 0), w, 0.004, yc - keel))
hullp = mk.Part('hull', 'hull', 'hull', remesh=False)
hullp.loft(rings, seg=24, power=2.3)
parts.append(hullp.build())

# the deck, planked, a little below the gunwale; a rail round it
deck = part('deck', 'hull', 'deck')
for i in range(N):
    t0, t1 = -1 + 2 * i / N, -1 + 2 * (i + 1) / N
    z0, z1 = t0 * L / 2, t1 * L / 2
    w0, w1 = half_width(t0) * 0.93, half_width(t1) * 0.93
    y0, y1 = sheer(t0) + 0.006, sheer(t1) + 0.006
    if w0 < 0.01 and w1 < 0.01:
        continue
    verts = [(-w0, y0, z0), (w0, y0, z0), (w1, y1, z1), (-w1, y1, z1)]
    deck.mesh(verts, [(0, 3, 2, 1)])
rail = part('rail', 'hull', 'darkwood')
for s in (1, -1):
    for i in range(N):
        t0, t1 = -1 + 2 * i / N, -1 + 2 * (i + 1) / N
        a = V((s * half_width(t0), sheer(t0) + 0.012, t0 * L / 2))
        b = V((s * half_width(t1), sheer(t1) + 0.012, t1 * L / 2))
        beam(rail, a, b, 0.022, 0.026)
# stem and sternpost
beam(rail, (0, KEEL * 0.45, L / 2 + 0.01), (0, sheer(1) + 0.08, L / 2 + 0.03), 0.03, 0.04, up=(0, 0, 1))
beam(rail, (0, KEEL * 0.45, -L / 2 - 0.01), (0, sheer(-1) + 0.09, -L / 2 - 0.03), 0.03, 0.04, up=(0, 0, -1))
# a steering oar at the stern quarter
beam(rail, (-half_width(-0.85) - 0.01, sheer(-0.85) + 0.04, -L * 0.42), (-half_width(-0.85) - 0.03, -0.08, -L * 0.52), 0.02, 0.05, up=(1, 0, 0))

if O.get('ram'):
    ram = part('ram', 'hull', 'bronze')
    cyl(ram, (0, 0.0, L / 2 - 0.02), (0, 0.0, L / 2 + 0.2), 0.06, seg=8, r1=0.012)

# ------------------------------------------------------------------------------------------------ castles
if O.get('castle'):
    wood = part('castle', 'hull', 'wood')
    team = part('castlebanner', 'hull', 'team')
    for zc, zl, h in ((-L * 0.36, L * 0.13, 0.2), (L * 0.36, L * 0.09, 0.14)):
        t = 2 * zc / L
        w = half_width(t) * 0.95
        y0 = sheer(t)
        beam(wood, (0, y0 + h / 2, zc - zl), (0, y0 + h / 2, zc + zl), w * 2, h)
        beam(part('castlerail', 'hull', 'darkwood'), (0, y0 + h + 0.015, zc - zl - 0.01), (0, y0 + h + 0.015, zc + zl + 0.01), w * 2 + 0.03, 0.03)
        for s in (1, -1):
            beam(team, (s * (w + 0.004), y0 + h * 0.55, zc - zl * 0.8), (s * (w + 0.004), y0 + h * 0.55, zc + zl * 0.8), 0.01, h * 0.5, up=(0, 1, 0))

# ------------------------------------------------------------------------------------------------ masts and sails
masts = O.get('masts', 0 if O['sail'] == 'none' else 1)
MH = O.get('mast', 1.0)
if masts:
    bone('sail', 'hull', (0, TOP + MH * 0.55, 0))
for m in range(masts):
    mz = 0.05 if masts == 1 else (L * 0.18 if m == 0 else -L * 0.16)
    h = MH * (1 if m == 0 else 0.85)
    mp = part('mast', 'hull', 'darkwood')
    cyl(mp, (0, TOP - 0.05, mz), (0, TOP + h, mz), 0.028, seg=8, r1=0.018)
    fl = part('pennant', 'hull', 'team')
    beam(fl, (0, TOP + h + 0.03, mz), (0, TOP + h + 0.03, mz - 0.16), 0.006, 0.06, up=(0, 1, 0))
    sail = part('sail', 'sail', 'sail')
    band = part('sailband', 'sail', 'team')
    if O['sail'] == 'lateen':
        # a triangle on a slanting yard, swelling to one side
        a, b, c = V((0, TOP + h * 0.98, mz + 0.35)), V((0, TOP + 0.12, mz - 0.38)), V((0, TOP + 0.12, mz + 0.3))
        beam(part('yard', 'sail', 'darkwood'), a + (a - b) * 0.05, b - (a - b) * 0.05, 0.016, 0.016)
        pts = []
        for i in range(5):
            for j in range(5 - i):
                u, v = i / 4, j / 4
                p = a + (b - a) * u + (c - a) * v
                pts.append((i, j, p + V((0.05 * math.sin(math.pi * u) * math.sin(math.pi * min(1, v * 1.5)), 0, 0))))
        idx = {(i, j): k for k, (i, j, _) in enumerate(pts)}
        verts = [tuple(p) for _, _, p in pts]
        faces = []
        for (i, j), k in idx.items():
            if (i + 1, j) in idx and (i, j + 1) in idx:
                faces.append((k, idx[(i + 1, j)], idx[(i, j + 1)]))
            if (i + 1, j) in idx and (i + 1, j + 1) in idx and (i, j + 1) in idx:
                faces.append((idx[(i + 1, j)], idx[(i + 1, j + 1)], idx[(i, j + 1)]))
        sail.mesh(verts, faces)
        sail.mesh([tuple(V(q) - V((0.004, 0, 0))) for q in verts], [tuple(reversed(f)) for f in faces])   # the back
        sail.keep_winding = True
    else:
        # a square sail hanging from its yard, bellying forward, with a band in the player's colour
        sw, sh = W * 2.1 * (1 if m == 0 else 0.9), h * 0.6
        yt = TOP + h * 0.9
        beam(part('yard', 'sail', 'darkwood'), (-sw / 2 - 0.04, yt, mz + 0.03), (sw / 2 + 0.04, yt, mz + 0.03), 0.022, 0.022)
        cols, rows_ = 7, 6
        grid = []
        for r in range(rows_ + 1):
            v = r / rows_
            row = []
            for c in range(cols + 1):
                u = c / cols * 2 - 1
                belly = 0.1 * (1 - u * u) * math.sin(math.pi * min(1.0, v * 1.1))
                row.append(V((u * sw / 2 * (1 - 0.06 * v), yt - v * sh, mz + 0.045 + belly)))
            grid.append(row)
        for tgt, r0, r1 in ((sail, 0, 2), (band, 2, 4), (sail, 4, rows_)):
            verts, faces = [], []
            for r in range(r0, r1 + 1):
                verts += [tuple(p) for p in grid[r]]
            n = cols + 1
            for r in range(r1 - r0):
                for c in range(cols):
                    a_ = r * n + c
                    faces.append((a_, a_ + n, a_ + n + 1, a_ + 1))
            tgt.mesh(verts, faces)
            tgt.mesh([tuple(V(q) - V((0, 0, 0.004))) for q in verts], [tuple(reversed(f)) for f in faces])   # the back
    rp = mk.Part('rigging', 'hull', 'rope', remesh=False)
    rp.tube([V((0, TOP + h * 0.95, mz)), V((0, sheer(1) + 0.06, L / 2))], 0.004, seg=4)
    rp.tube([V((0, TOP + h * 0.95, mz)), V((0, sheer(-1) + 0.06, -L / 2))], 0.004, seg=4)
    for s in (1, -1):
        rp.tube([V((0, TOP + h * 0.8, mz)), V((s * half_width(2 * mz / L) * 0.95, sheer(0) + 0.02, mz - 0.12))], 0.004, seg=4)
    parts.append(rp.build())

# ------------------------------------------------------------------------------------------------ oars
if O.get('oars'):
    n = O['oars']
    for s, side in ((1, 'L'), (-1, 'R')):
        piv = V((s * W * 0.95, TOP + 0.015, 0))
        bone('oars' + side, 'hull', piv)
        oars = part('oars' + side, 'oars' + side, 'wood')
        for i in range(n):
            z = -L * 0.28 + i / max(1, n - 1) * L * 0.56
            t = 2 * z / L
            lock = V((s * half_width(t) * 0.98, sheer(t) + 0.015, z))
            blade_end = lock + V((s * 0.36, -0.2 - sheer(t) * 0.3, 0.0))
            beam(oars, lock - (blade_end - lock).normalized() * 0.12, blade_end, 0.014, 0.014)
            beam(oars, blade_end - (blade_end - lock).normalized() * 0.1, blade_end, 0.008, 0.05, up=(0, 0, 1))

# ------------------------------------------------------------------------------------------------ fittings
if O.get('shields'):
    sh = part('shields', 'hull', 'team')
    boss = part('shieldboss', 'hull', 'iron')
    k = int(L * 3.5)
    for i in range(k):
        z = -L * 0.34 + i / (k - 1) * L * 0.68
        t = 2 * z / L
        for s in (1, -1):
            c = V((s * (half_width(t) + 0.012), sheer(t) + 0.0, z))
            cyl(sh, c, c + V((s * 0.012, 0, 0)), 0.06, seg=10)
            cyl(boss, c + V((s * 0.012, 0, 0)), c + V((s * 0.022, 0, 0)), 0.018, seg=6)
if O.get('cannons'):
    g = part('cannons', 'hull', 'darkiron')
    for i in range(3):
        z = -0.3 + i * 0.3
        t = 2 * z / L
        for s in (1, -1):
            c = V((s * (half_width(t) - 0.04), sheer(t) - 0.03, z))
            cyl(g, c, c + V((s * 0.13, 0, 0)), 0.03, seg=8, r1=0.026)
if O.get('cargo'):
    cg = part('crates', 'hull', 'cargo')
    beam(cg, (0.08, TOP + 0.08, -0.28), (0.08, TOP + 0.08, -0.1), 0.16, 0.14)
    beam(cg, (-0.1, TOP + 0.07, 0.1), (-0.1, TOP + 0.07, 0.28), 0.16, 0.12)
    jars = mk.Part('jars', 'hull', 'clay', voxel=0.003, smooth=3, tris=120)
    for x, z in ((-0.1, -0.22), (-0.1, -0.1), (0.1, 0.18)):
        jars.ellipsoid((x, TOP + 0.07, z), (0.045, 0.08, 0.045))
    parts.append(jars.build())
if O.get('fire'):
    # a brazier and a siphon at the bow
    br = part('brazier', 'hull', 'iron')
    zf = L * 0.36
    cyl(br, (0, sheer(0.72), zf), (0, sheer(0.72) + 0.1, zf), 0.05, seg=10, r1=0.07)
    fire = mk.Part('fire', 'hull', 'fire', voxel=0.004, smooth=3, tris=80)
    fire.cone((0, sheer(0.72) + 0.08, zf), (0, sheer(0.72) + 0.26, zf), 0.065, seg=8)
    parts.append(fire.build())
    beam(part('siphon', 'hull', 'bronze'), (0, sheer(0.72) + 0.06, zf + 0.05), (0, sheer(0.9) + 0.02, L / 2 + 0.06), 0.03, 0.03)
if O.get('kegs'):
    kg = part('kegs', 'hull', 'wood')
    bands = part('kegbands', 'hull', 'iron')
    for i in range(4):
        x, z = -0.07 + (i % 2) * 0.14, -0.12 + (i // 2) * 0.2
        cyl(kg, (x, TOP, z), (x, TOP + 0.15, z), 0.062, seg=10)
        for y in (0.03, 0.12):
            cyl(bands, (x, TOP + y, z), (x, TOP + y + 0.012, z), 0.065, seg=10)
    fuse = mk.Part('fuse', 'hull', 'fire', voxel=0.003, smooth=2, tris=40)
    fuse.ball((0, TOP + 0.2, 0), 0.025)
    parts.append(fuse.build())
if O.get('net'):
    bone('net', 'hull', (0, TOP + 0.05, -L * 0.36))
    boom = part('netboom', 'net', 'darkwood')
    beam(boom, (0, TOP + 0.05, -L * 0.36), (0.32, TOP + 0.28, -L * 0.42), 0.016, 0.016)
    netp = mk.Part('netmesh', 'net', 'rope', voxel=0.004, smooth=3, tris=100)
    netp.ellipsoid((0.33, TOP + 0.12, -L * 0.42), (0.03, 0.14, 0.06))
    parts.append(netp.build())

# ------------------------------------------------------------------------------------------------ crew
crew = O.get('crew', 1)
for i in range(crew):
    z = (i - (crew - 1) / 2) * (L * 0.5 / max(1, crew)) - (0.1 if O.get('cargo') else 0.0)
    x = (0.07 if i % 2 else -0.07) if crew > 1 else 0.0
    y0 = sheer(2 * z / L) + 0.006
    body = mk.Part(f'crew{i}', 'hull', 'team', remesh=False)
    body.loft([((x, y0 + h_, z), (1, 0, 0), (0, 0, 1), r_ * 1.1, r_, r_) for h_, r_ in
               ((0.0, 0.045), (0.08, 0.05), (0.15, 0.045), (0.2, 0.04), (0.215, 0.025))], seg=12)
    parts.append(body.build())
    head = mk.Part(f'crewhead{i}', 'hull', 'skin', voxel=0.003, smooth=3, tris=60)
    head.ball((x, y0 + 0.255, z), 0.036)
    parts.append(head.build())

# ------------------------------------------------------------------------------------------------ build and export
for p in PARTS.values():
    parts.append(p.build())
ao = mk.bake_ao(parts, dist=0.3, near=0.04, ground=False)
tris = mk.export_model(parts, ao, BONES, out_path)
import json  # noqa: E402
with open(out_path) as f_:
    data_ = json.load(f_)
data_['meta'] = dict(unit=UNIT, height=round(TOP + (MH if masts else 0.3) + 0.1, 3))
with open(out_path, 'w') as f_:
    json.dump(data_, f_, separators=(',', ':'))
print(f'EXPORTED {out_path}: {len(parts)} parts, {tris} triangles')

if preview_path:
    PAL = {'hull': (0.22, 0.12, 0.05), 'deck': (0.42, 0.28, 0.13), 'wood': (0.3, 0.17, 0.07), 'darkwood': (0.12, 0.07, 0.03),
           'sail': (0.8, 0.76, 0.66), 'team': (0.04, 0.1, 0.62), 'rope': (0.55, 0.45, 0.28), 'iron': (0.3, 0.31, 0.33),
           'darkiron': (0.06, 0.06, 0.07), 'bronze': (0.55, 0.32, 0.08), 'fire': (1.0, 0.35, 0.05), 'skin': (0.5, 0.3, 0.18),
           'cargo': (0.38, 0.25, 0.12), 'clay': (0.5, 0.22, 0.1)}
    colors = {o.name: [tuple(c * (0.3 + 0.7 * a) for c in PAL[o['mat']]) for a in ao[o.name]] for o in parts}
    paths = mk.preview(parts, colors, preview_path, center=(0, 0.35, 0), size=max(1.5, L * 1.1),
                       views=(('iso', 45.0, 30.0), ('side', 90.0, 8.0), ('front', 15.0, 12.0)))
    print('PREVIEW', paths)
