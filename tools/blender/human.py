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
kind, out_path = args[0], args[1]
preview_path = args[2] if len(args) > 2 else None
FEMALE = kind == 'female'
mk.TRI_SCALE = flags.get('tris', 1.0)
LIGHT = mk.TRI_SCALE < 0.7
V = Vector
ss = mk.smoothstep
mk.reset_scene()

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

parts = []
LAYERS = []          # (outer, [inners], gap) applied after everything is built


def add(part, variant=None):
    obj = part.build()
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
if not FEMALE:
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
torso = mk.Part('torso', 'torso', 'team', voxel=0.0026, smooth=6, tris=420, symmetric=True)
torso.ellipsoid((0, 0.53, -0.004), (0.085, 0.07, 0.066))                                      # waist
torso.ellipsoid((0, 0.62, 0.002), (0.098, 0.08, 0.07))                                        # chest
torso.ellipsoid((0, 0.7, -0.008), (0.112, 0.042, 0.06))                                       # shoulders
torso.ellipsoid((0, 0.733, -0.018), (0.072, 0.035, 0.045))                                    # trapezius
torso.ellipsoid((0, 0.72, 0.018), (0.058, 0.03, 0.043))                                       # collar
if FEMALE:
    for s in (1, -1):
        torso.ellipsoid((0.036 * s, 0.63, 0.04), (0.034, 0.032, 0.03))                        # bust
add(torso)

# skirt: the tunic (to above the knee) or dress (to the ankles), skinned to the thighs
skirt_bottom = 0.15 if FEMALE else 0.3     # the dress falls to mid-calf
skirt = mk.Part('skirt', 'hips', 'team', voxel=0.0026, smooth=6, tris=520 if FEMALE else 360, symmetric=True)
skirt.ellipsoid((0, 0.49, -0.004), (0.09, 0.05, 0.068))                                       # waist
# one smooth flared shape from the hips to the hem (an A-line tunic, or a long dress widening to the ankles)
hem_r = 0.18 if FEMALE else 0.13
skirt.limb((0, 0.49, -0.004), (0, skirt_bottom, -0.004), 0.092, hem_r, seg=24, caps=False, flat=1.0)
skirt.ellipsoid((0, 0.485, -0.004), (0.093, 0.03, 0.074))                                     # smooth the top into the waist
# skirt.ellipsoid((0, 0.425, -0.002), (0.125 if FEMALE else 0.118, 0.065, 0.098))               # over the hips and tops of the thighs
skirt.ellipsoid((0, skirt_bottom - 0.05, -0.004), (0.3, 0.05, 0.3), cut=True)                 # open hem


def skirt_weight(p, s):
    """How much a skirt vertex follows the thigh on side s: nothing at the waist, the near side below the hips."""
    down = ss(0.48, 0.37, p[1])
    lateral = ss(-0.06, 0.06, s * p[0])
    return down * lateral


for s, side in ((1, 'L'), (-1, 'R')):
    skirt.mask('skirt' + side, lambda p, n, s=s: skirt_weight(p, s))
add(skirt)

belt = mk.Part('belt', 'hips', 'leather', voxel=0.0022, smooth=3, tris=110, symmetric=True)
belt.ellipsoid((0, 0.49, -0.004), (0.092, 0.013, 0.07))
add(belt)
LAYERS += [('belt', ['skirt'], 0.002)]

# ------------------------------------------------------------------------------------------------ legs
for s, side in ((1, 'L'), (-1, 'R')):
    hip, knee, ankle = HIP[s], KNEE[s], ANKLE[s]
    thigh = mk.Part(f'thigh{side}', f'leg{side}', 'skin', voxel=0.0024, smooth=4, tris=150)
    thigh.ball(hip, 0.047)
    thigh.limb(hip, knee, 0.05, 0.034, seg=12)
    thigh.ellipsoid(hip.lerp(knee, 0.35) + V((0, 0, 0.008)), (0.045, 0.07, 0.048))
    add(thigh)
    shin = mk.Part(f'shin{side}', f'knee{side}', 'skin', voxel=0.0022, smooth=4, tris=130)
    shin.ball(knee, 0.034)
    shin.limb(knee, ankle, 0.032, 0.022, seg=12)
    shin.ellipsoid(knee.lerp(ankle, 0.3) + V((0, 0, -0.012)), (0.03, 0.055, 0.03))            # calf
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
    up = mk.Part(f'uparm{side}', f'arm{side}', 'skin', voxel=0.0022, smooth=4, tris=170)
    up.ball(sh, 0.038)
    up.limb(sh, el, 0.036, 0.03, seg=12)
    up.ellipsoid(sh.lerp(el, 0.62) + V((0, 0, 0.006)), (0.032, 0.04, 0.033))
    add(up)
    sleeve = mk.Part(f'sleeve{side}', f'arm{side}', 'team', voxel=0.0022, smooth=4, tris=110)
    sleeve.ball(sh, 0.041)
    sleeve.limb(sh, sh.lerp(el, 0.42 if not FEMALE else 0.7), 0.04, 0.037, seg=12)
    add(sleeve)
    LAYERS.append((f'sleeve{side}', [f'uparm{side}'], 0.003))
    fore = mk.Part(f'forearm{side}', f'elbow{side}', 'skin', voxel=0.0022, smooth=4, tris=150)
    fore.ball(el, 0.031)
    fore.limb(el, wr, 0.03, 0.021, seg=12)
    fore.ellipsoid(el.lerp(wr, 0.28), (0.03, 0.033, 0.03))
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


# tools hang down from the fist along -y, head forward (+z); the work poses swing them
down = V((0, -1, 0))
axe_w, axe_i = tool_part('axehaft', 'wood'), tool_part('axehead', 'iron')
shaft(axe_w, GRIP_R + V((0, 0.05, 0)), GRIP_R + V((0, -0.34, 0)), 0.011, 0.012)
axe_i.ellipsoid(GRIP_R + V((0, -0.31, 0.04)), (0.009, 0.045, 0.045))
axe_i.limb(GRIP_R + V((0, -0.31, 0.0)), GRIP_R + V((0, -0.31, 0.025)), 0.017, 0.013, seg=8)
add(axe_w, 'tool:axe')
add(axe_i, 'tool:axe')

pick_w, pick_i = tool_part('pickhaft', 'wood'), tool_part('pickhead', 'iron')
shaft(pick_w, GRIP_R + V((0, 0.05, 0)), GRIP_R + V((0, -0.36, 0)), 0.011, 0.012)
pick_i.limb(GRIP_R + V((0, -0.34, -0.1)), GRIP_R + V((0, -0.34, 0.13)), 0.006, 0.014, seg=8)
pick_i.cone(GRIP_R + V((0, -0.34, 0.12)), GRIP_R + V((0, -0.36, 0.17)), 0.012, seg=8)
pick_i.cone(GRIP_R + V((0, -0.34, -0.09)), GRIP_R + V((0, -0.33, -0.12)), 0.007, seg=8)
add(pick_w, 'tool:pick')
add(pick_i, 'tool:pick')

ham_w, ham_i = tool_part('hammerhaft', 'wood'), tool_part('hammerhead', 'iron')
shaft(ham_w, GRIP_R + V((0, 0.035, 0)), GRIP_R + V((0, -0.19, 0)), 0.01, 0.011)
ham_i.limb(GRIP_R + V((0, -0.19, -0.035)), GRIP_R + V((0, -0.19, 0.045)), 0.022, 0.022, seg=10)
add(ham_w, 'tool:hammer')
add(ham_i, 'tool:hammer')

hoe_w, hoe_i = tool_part('hoehaft', 'wood'), tool_part('hoeblade', 'iron')
shaft(hoe_w, GRIP_R + V((0, 0.08, 0)), GRIP_R + V((0, -0.6, 0)), 0.011, 0.012)
hoe_i.ellipsoid(GRIP_R + V((0, -0.6, 0.045)), (0.04, 0.006, 0.05))
hoe_i.limb(GRIP_R + V((0, -0.59, 0.0)), GRIP_R + V((0, -0.6, 0.02)), 0.012, 0.01, seg=8)
add(hoe_w, 'tool:hoe')
add(hoe_i, 'tool:hoe')

sp_w, sp_i = tool_part('huntspear', 'wood'), tool_part('huntspearhead', 'iron')
shaft(sp_w, GRIP_R + V((0, 0.3, 0)), GRIP_R + V((0, -0.55, 0)), 0.009, 0.009)
sp_i.ellipsoid(GRIP_R + V((0, 0.34, 0)), (0.016, 0.045, 0.005))
sp_i.cone(GRIP_R + V((0, 0.37, 0)), GRIP_R + V((0, 0.4, 0)), 0.01, seg=6)
add(sp_w, 'tool:spear')
add(sp_i, 'tool:spear')

rod = tool_part('rod', 'wood')
shaft(rod, GRIP_R + V((0, 0.08, 0)), GRIP_R + V((0, -0.72, 0.1)), 0.009, 0.004)
add(rod, 'tool:rod')
line = mk.Part('rodline', 'handR', 'cord', remesh=False)
line.tube([GRIP_R + V((0, -0.72, 0.1)), GRIP_R + V((0, -0.9, 0.16)), GRIP_R + V((0, -1.1, 0.2))], 0.0022, seg=4)
add(line, 'tool:rod')

basket = mk.Part('basket', 'handL', 'wicker', voxel=0.002, smooth=3, tris=160)
bc = GRIP_L + V((0.01, -0.07, 0.02))
basket.limb(bc + V((0, -0.045, 0)), bc + V((0, 0.045, 0)), 0.055, 0.07, seg=14, caps=False)
basket.ellipsoid(bc + V((0, -0.045, 0)), (0.055, 0.012, 0.055))
basket.ellipsoid(bc + V((0, 0.05, 0)), (0.06, 0.03, 0.06), cut=True)
add(basket, 'tool:basket')
handle = mk.Part('baskethandle', 'handL', 'wicker', remesh=False)
handle.tube([bc + V((-0.06, 0.04, 0)), bc + V((-0.03, 0.1, 0)), GRIP_L + V((0, 0.0, 0)), bc + V((0.03, 0.1, 0)), bc + V((0.06, 0.04, 0))], 0.005, seg=5)
add(handle, 'tool:basket')

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
    o, i = mk.separate(by_name[outer], [by_name[n] for n in inners], gap * GAP)
    print(f'LAYER {outer:<10} over {"+".join(inners):<10} moved {o:4d} out, {i:4d} underneath in')
# the tunic or dress hangs over the thighs: keep it clear of them at rest
for side in ('L', 'R'):
    o, i = mk.separate(by_name['skirt'], [by_name['thigh' + side]], 0.006 * GAP)
    print(f'LAYER skirt      over thigh{side}     moved {o:4d} out, {i:4d} underneath in')

# shading is baked for the body alone, then for each tool or load against the body (they are never all shown at once)
base = [o for o in parts if not o.get('variant')]
ao = mk.bake_ao(base, dist=0.2, near=0.03)
for v in sorted({o['variant'] for o in parts if o.get('variant')}):
    group = [o for o in parts if o.get('variant') == v]
    ao.update(mk.bake_ao(group, dist=0.2, near=0.03, occluders=base))
tris = mk.export_model(parts, ao, BONES, out_path, variants={o.name: o.get('variant') for o in parts})
print(f'EXPORTED {out_path}: {len(parts)} parts, {tris} triangles '
      f'(base body {sum(len(p.data.polygons) for p in parts if not p.get("variant"))} faces)')

if preview_path:
    PAL = {'skin': (0.62, 0.36, 0.2), 'team': (0.04, 0.1, 0.62), 'team2': (0.55, 0.52, 0.45), 'leather': (0.25, 0.12, 0.05),
           'wrap': (0.35, 0.28, 0.18), 'shoe': (0.12, 0.07, 0.035), 'wood': (0.22, 0.12, 0.05), 'iron': (0.45, 0.47, 0.5),
           'cord': (0.6, 0.55, 0.45), 'wicker': (0.5, 0.35, 0.15), 'woodend': (0.6, 0.45, 0.25), 'meat': (0.5, 0.08, 0.06),
           'sack': (0.4, 0.3, 0.18), 'gold': (0.85, 0.6, 0.1), 'stone': (0.45, 0.44, 0.42)}
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
