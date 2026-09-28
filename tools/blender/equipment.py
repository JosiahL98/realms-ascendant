"""
Soldiers' kit for the standing human (human.py with kit=<unit>): helmets, armour, shields, weapons, capes, quivers.

Every piece is built in game space around the approved body (skull centre CR, shoulders SH, elbows EL, wrists WR,
hips, knees, ankles) and layered over what it covers with modelkit.separate, so nothing sinks into the body. Weapons
are laid out hanging from the right fist along -y with the head's working face towards +z, then seated in the fist
as tools are (the shaft runs front to back through the fist, the head on the thumb side). Shields and bows are held
in the left hand.

Materials (the baker colours them; 'team' takes the player colour): skin, hair, team, linen, leather, darkleather,
legs (trousers), steel, mail, bronze, gold, wood, lacquer, fur, plume, feather, cord, turban, hood, hat.
"""
from mathutils import Vector

V = Vector

# ------------------------------------------------------------------------------------------------ the units
# body: bare (no tunic: bare chest and trousers), robe (long robe), beard, tunic ('team' or 'linen')
KITS = {
    'militia': dict(weapon='sword', helmet='cap', armor='leather'),
    'manAtArms': dict(weapon='sword', helmet='conical', armor='mail', shield='round', beard=True),
    'longSwordsman': dict(weapon='sword', helmet='full', armor='mail', shield='kite'),
    'twoHanded': dict(weapon='greatsword', helmet='full', armor='plate'),
    'champion': dict(weapon='greatsword', helmet='plumed', armor='plate', cape=True, elite=True),
    'spearman': dict(weapon='spear', helmet='cap', armor='leather', shield='round'),
    'pikeman': dict(weapon='pike', helmet='conical', armor='mail'),
    'halberdier': dict(weapon='halberd', helmet='full', armor='plate'),
    'archer': dict(weapon='bow', helmet='hood', quiver=True),
    'crossbowman': dict(weapon='crossbow', helmet='conical', armor='leather', quiver=True),
    'arbalest': dict(weapon='crossbow', helmet='full', armor='mail', quiver=True, elite=True),
    'skirmisher': dict(weapon='javelin', helmet='none', shield='small'),
    'eliteSkirmisher': dict(weapon='javelin', helmet='conical', shield='round', armor='leather'),
    'handCannoneer': dict(weapon='gun', helmet='wide', armor='leather'),
    'monk': dict(weapon='staff', helmet='hood', robe=True, tunic='linen', sash=True, relic=True),
    'legionary': dict(weapon='sword', helmet='galea', armor='mail', shield='scutum'),
    'eliteLegionary': dict(weapon='sword', helmet='galea', armor='plate', shield='scutum', cape=True, elite=True),
    'phalangite': dict(weapon='pike', helmet='crested', armor='bronze', shield='hoplon'),
    'elitePhalangite': dict(weapon='pike', helmet='crested', armor='bronze', shield='hoplon', cape=True, elite=True),
    'gaesatae': dict(weapon='greatsword', helmet='none', bare=True, beard=True),
    'eliteGaesatae': dict(weapon='greatsword', helmet='none', bare=True, beard=True, cape=True, elite=True),
    'berserker': dict(weapon='axe', helmet='wolf', bare=True, beard=True),
    'eliteBerserker': dict(weapon='axe', helmet='wolf', bare=True, beard=True, shield='round', elite=True),
    'bowman': dict(weapon='longbow', helmet='feather', sash=True, quiver=True, tunic='linen'),
    'eliteBowman': dict(weapon='longbow', helmet='feather', sash=True, quiver=True, armor='leather', tunic='linen', elite=True),
    'fireLancer': dict(weapon='fireLance', helmet='conical', armor='lamellar'),
    'eliteFireLancer': dict(weapon='fireLance', helmet='plumed', armor='lamellar', cape=True, elite=True),
}


# Horsemen (rider.py kit=<unit>): the rider's clothing and weapon, plus the horse's barding and coat.
# weapon: spear (thrust), sword (cut), bow (shoots over the horse's head); barding: none (saddle cloth only), cloth
# (a caparison in the player's colour), mail, plate (mail with a steel chamfron and peytral), gold (the paladin's)
RIDER_KITS = {
    'scout': dict(weapon='spear', helmet='cap', armor='leather', barding='none', coat='bay'),
    'lightCav': dict(weapon='sword', helmet='conical', armor='leather', barding='cloth', coat='darkBay'),
    'hussar': dict(weapon='sword', helmet='plumed', armor='mail', barding='cloth', coat='grey'),
    'knight': dict(weapon='sword', helmet='full', armor='plate', shield='kite', barding='mail', coat='black'),
    'cavalier': dict(weapon='sword', helmet='plumed', armor='plate', shield='kite', barding='plate', coat='darkBay'),
    'paladin': dict(weapon='sword', helmet='plumed', armor='plate', shield='kite', cape=True, elite=True, barding='gold', coat='grey'),
    'cavArcher': dict(weapon='bow', helmet='hood', quiver=True, barding='cloth', coat='bay'),
    'heavyCavArcher': dict(weapon='bow', helmet='conical', armor='mail', quiver=True, barding='mail', coat='darkBay'),
    'horseArcher': dict(weapon='bow', helmet='phrygian', quiver=True, barding='cloth', coat='chestnut'),
    'eliteHorseArcher': dict(weapon='bow', helmet='phrygian', armor='mail', quiver=True, elite=True, barding='mail', coat='grey'),
}


def rider_kit(name):
    k = dict(RIDER_KITS[name])
    for f, d in (('helmet', 'none'), ('armor', 'none'), ('shield', 'none'), ('barding', 'none'), ('coat', 'bay')):
        k.setdefault(f, d)
    for f in ('cape', 'quiver', 'sash', 'bare', 'robe', 'beard', 'elite', 'relic'):
        k.setdefault(f, False)
    k.setdefault('tunic', 'team')
    return k


def kit(name):
    k = dict(KITS[name])
    k.setdefault('helmet', 'none')
    k.setdefault('armor', 'none')
    k.setdefault('shield', 'none')
    for f in ('cape', 'quiver', 'sash', 'bare', 'robe', 'beard', 'elite', 'relic'):
        k.setdefault(f, False)
    k.setdefault('tunic', 'team')
    return k


# ------------------------------------------------------------------------------------------------ builders
class Kit:
    """Builds one unit's equipment. ctx carries the body's joints and human.py's add / LAYERS / mk."""

    def __init__(self, ctx, k):
        self.c = ctx
        self.k = k
        self.mk = ctx['mk']
        self.add = ctx['add']
        self.layers = ctx['LAYERS']
        self.CR = ctx['CR']

    def part(self, name, bone, mat, tris=160, voxel=0.0018, smooth=3, symmetric=False, remesh=True):
        # a rider's bones carry an 'r' prefix (rhead, rtorso, rarmL ...): ctx['BONE'] maps the standing names to them
        bone = self.c.get('BONE', {}).get(bone, bone)
        return self.mk.Part(name, bone, mat, voxel=voxel, smooth=smooth, tris=tris, symmetric=symmetric, remesh=remesh)

    def xf(self, p):
        """A point on the standing body's trunk, moved onto this body's trunk (the rider sits higher and further back)."""
        f = self.c.get('XF')
        return V(f(p)) if f else V(p)

    def build(self):
        k = self.k
        self.helmet(k['helmet'])
        self.armor(k['armor'])
        if k['sash']:
            self.sash()
        if k['cape']:
            self.cape()
        if k['quiver']:
            self.quiver()
        if k['shield'] != 'none':
            self.shield(k['shield'])
        self.weapon(k['weapon'])

    # ---------------------------------------------------------------------------------------- helmets
    def hollow(self, p, closed=False, neck=False):
        """Makes a helmet a shell: the skull's shape (a little larger) is carved out, so nothing sits over the face."""
        CR, V_ = self.CR, V
        p.ellipsoid(CR, (0.052, 0.057, 0.059), cut=True)
        if closed:
            p.ellipsoid(CR + V_((0, -0.03, 0.02)), (0.046, 0.047, 0.047), cut=True)
            p.ellipsoid(CR + V_((0, -0.052, 0.012)), (0.042, 0.029, 0.045), cut=True)
        if neck or closed:
            p.limb(CR + V_((0, -0.04, -0.004)), CR + V_((0, -0.14, -0.01)), 0.038, 0.04, seg=16, cut=True)

    def helmet(self, h):
        CR, V_ = self.CR, V
        steel = 'gold' if self.k['elite'] and h in ('plumed',) else 'steel'
        if h == 'none':
            return
        if h == 'cap':
            p = self.part('helmet', 'head', 'leather', tris=360, symmetric=True)
            p.ellipsoid(CR + V_((0, 0.008, -0.004)), (0.064, 0.063, 0.069))
            p.ellipsoid(CR + V_((0, -0.075, 0.0)), (0.2, 0.07, 0.2), cut=True)             # open below the brow
            self.hollow(p)
            self.add(p)
            self.layers.append(('helmet', ['head'], 0.004))
        elif h in ('conical',):
            p = self.part('helmet', 'head', steel, tris=400, symmetric=True)
            p.ellipsoid(CR + V_((0, 0.008, -0.004)), (0.065, 0.062, 0.070))
            p.cone(CR + V_((0, 0.03, -0.004)), CR + V_((0, 0.105, -0.01)), 0.05, seg=16)
            p.ellipsoid(CR + V_((0, -0.072, 0.0)), (0.2, 0.066, 0.2), cut=True)
            self.hollow(p)
            p.limb(CR + V_((0, 0.004, 0.064)), CR + V_((0, -0.03, 0.07)), 0.006, 0.005, seg=8)   # nasal bar
            self.add(p)
            self.layers.append(('helmet', ['head'], 0.004))
        elif h in ('full', 'plumed'):
            p = self.part('helmet', 'head', steel, tris=460, symmetric=True)
            p.ellipsoid(CR + V_((0, -0.006, 0.0)), (0.067, 0.076, 0.072))
            p.limb(CR + V_((0, -0.03, 0.0)), CR + V_((0, -0.085, 0.004)), 0.068, 0.064, seg=18, caps=False)
            p.ellipsoid(CR + V_((0, -0.13, 0.0)), (0.2, 0.04, 0.2), cut=True)              # open at the neck
            p.ellipsoid(CR + V_((0, -0.01, 0.07)), (0.045, 0.006, 0.03), cut=True)         # eye slit
            self.hollow(p)
            self.add(p)
            self.layers.append(('helmet', ['head'], 0.004))
            if h == 'plumed':
                pl = self.part('plume', 'head', 'team', tris=200, symmetric=True, smooth=5)
                pl.limb(CR + V_((0, 0.06, 0.02)), CR + V_((0, 0.11, -0.04)), 0.012, 0.03, seg=12)
                pl.ellipsoid(CR + V_((0, 0.12, -0.07)), (0.022, 0.035, 0.05))
                self.add(pl)
        elif h == 'crested':
            p = self.part('helmet', 'head', 'bronze', tris=460, symmetric=True)
            p.ellipsoid(CR + V_((0, 0.0, 0.0)), (0.066, 0.068, 0.071))
            for s in (1, -1):
                p.ellipsoid(CR + V_((0.048 * s, -0.045, 0.02)), (0.014, 0.035, 0.03))       # cheek guards
            p.ellipsoid(CR + V_((0, -0.06, -0.035)), (0.05, 0.03, 0.03))                    # neck guard
            p.ellipsoid(CR + V_((0, -0.11, 0.0)), (0.2, 0.04, 0.2), cut=True)
            p.ellipsoid(CR + V_((0, -0.035, 0.075)), (0.034, 0.05, 0.06), cut=True)         # face opening
            self.hollow(p, neck=True)
            self.add(p)
            self.layers.append(('helmet', ['head'], 0.004))
            cr = self.part('crest', 'head', 'team', tris=240, symmetric=True, smooth=5)
            cr.limb(CR + V_((0, 0.075, 0.05)), CR + V_((0, 0.085, -0.07)), 0.012, 0.012, seg=10, flat=0.4)
            cr.ellipsoid(CR + V_((0, 0.1, -0.01)), (0.012, 0.035, 0.07))
            self.add(cr)
        elif h == 'galea':
            p = self.part('helmet', 'head', 'steel', tris=440, symmetric=True)
            p.ellipsoid(CR + V_((0, 0.004, -0.004)), (0.066, 0.064, 0.070))
            p.ellipsoid(CR + V_((0, -0.045, -0.055)), (0.06, 0.02, 0.03))                  # neck guard
            for s in (1, -1):
                p.ellipsoid(CR + V_((0.05 * s, -0.04, 0.018)), (0.012, 0.035, 0.028))       # cheek guards
            p.ellipsoid(CR + V_((0, -0.1, 0.0)), (0.2, 0.04, 0.2), cut=True)
            p.ellipsoid(CR + V_((0, -0.03, 0.075)), (0.034, 0.05, 0.06), cut=True)
            self.hollow(p, neck=True)
            self.add(p)
            self.layers.append(('helmet', ['head'], 0.004))
            cr = self.part('crest', 'head', 'team', tris=200, symmetric=True, smooth=5)
            cr.ellipsoid(CR + V_((0, 0.075, -0.005)), (0.012, 0.03, 0.06))
            self.add(cr)
        elif h == 'hood':
            p = self.part('helmet', 'head', 'hood', tris=440, symmetric=True, smooth=6)
            p.ellipsoid(CR + V_((0, 0.004, -0.012)), (0.070, 0.070, 0.076))
            p.limb(CR + V_((0, -0.04, -0.02)), CR + V_((0, -0.1, -0.02)), 0.06, 0.08, seg=18, caps=False)
            p.cone(CR + V_((0, 0.02, -0.06)), CR + V_((0, 0.04, -0.12)), 0.03, seg=10)       # the hood's point
            p.ellipsoid(CR + V_((0, -0.03, 0.07)), (0.044, 0.062, 0.07), cut=True)            # open face
            p.ellipsoid(CR + V_((0, -0.14, 0.0)), (0.2, 0.03, 0.2), cut=True)
            self.hollow(p, closed=True)
            self.add(p)
            self.layers.append(('helmet', ['head'], 0.005))
        elif h == 'wide':
            p = self.part('helmet', 'head', 'hat', tris=400, symmetric=True)
            p.ellipsoid(CR + V_((0, 0.012, -0.004)), (0.064, 0.062, 0.068))
            p.limb(CR + V_((0, 0.02, -0.004)), CR + V_((0, 0.03, -0.004)), 0.13, 0.12, seg=24, flat=1.0)   # brim
            p.ellipsoid(CR + V_((0, -0.07, 0.0)), (0.2, 0.07, 0.2), cut=True)
            self.hollow(p)
            self.add(p)
            self.layers.append(('helmet', ['head'], 0.004))
        elif h == 'turban':
            p = self.part('helmet', 'head', 'turban', tris=260, symmetric=True, smooth=6)
            p.ellipsoid(CR + V_((0, 0.022, -0.004)), (0.072, 0.064, 0.074))
            p.ellipsoid(CR + V_((0, -0.055, 0.0)), (0.2, 0.06, 0.2), cut=True)
            self.hollow(p)
            self.add(p)
            self.layers.append(('helmet', ['head'], 0.004))
        elif h == 'feather':
            b = self.part('helmet', 'head', 'team', tris=160, symmetric=True)
            b.limb(CR + V_((0, 0.008, -0.004)), CR + V_((0, 0.03, -0.004)), 0.058, 0.057, seg=18, caps=False, flat=1.1)
            self.add(b)
            self.layers.append(('helmet', ['head'], 0.003))
            f = self.part('feather', 'head', 'feather', tris=80)
            f.limb(CR + V_((0.01, 0.02, -0.06)), CR + V_((0.02, 0.13, -0.09)), 0.008, 0.003, seg=6, flat=0.35)
            self.add(f)
        elif h == 'phrygian':
            # a soft felt cap whose crown flops forward over the brow
            p = self.part('helmet', 'head', 'phrygian', tris=380, symmetric=True, smooth=6)
            p.ellipsoid(CR + V_((0, 0.012, -0.004)), (0.064, 0.064, 0.069))
            p.limb(CR + V_((0, 0.04, -0.012)), CR + V_((0, 0.09, 0.012)), 0.048, 0.03, seg=16)
            p.limb(CR + V_((0, 0.09, 0.012)), CR + V_((0, 0.085, 0.05)), 0.03, 0.017, seg=14)
            p.ball(CR + V_((0, 0.085, 0.05)), 0.017)
            for s in (1, -1):
                p.ellipsoid(CR + V_((0.05 * s, -0.035, -0.012)), (0.014, 0.045, 0.03))           # lappets over the ears
            p.ellipsoid(CR + V_((0, -0.075, 0.03)), (0.2, 0.05, 0.2), cut=True)
            p.ellipsoid(CR + V_((0, -0.035, 0.075)), (0.04, 0.05, 0.06), cut=True)              # open face
            self.hollow(p)
            self.add(p)
            self.layers.append(('helmet', ['head'], 0.004))
        elif h == 'wolf':
            p = self.part('helmet', 'head', 'fur', tris=320, symmetric=True, smooth=6)
            p.ellipsoid(CR + V_((0, 0.014, -0.01)), (0.072, 0.066, 0.076))
            p.ellipsoid(CR + V_((0, 0.02, 0.06)), (0.03, 0.022, 0.035))                      # the wolf's muzzle over the brow
            for s in (1, -1):
                p.cone(CR + V_((0.035 * s, 0.05, -0.005)), CR + V_((0.04 * s, 0.09, -0.01)), 0.016, seg=6)   # ears
            p.ellipsoid(CR + V_((0, -0.075, 0.02)), (0.2, 0.06, 0.2), cut=True)
            self.hollow(p)
            self.add(p)
            self.layers.append(('helmet', ['head'], 0.004))
            pelt = self.part('pelt', 'torso', 'fur', tris=260, symmetric=True, smooth=6)
            pelt.ellipsoid(V_((0, 0.66, -0.07)), (0.1, 0.1, 0.03))
            pelt.ellipsoid(V_((0, 0.74, -0.05)), (0.09, 0.03, 0.04))
            self.add(pelt)
            self.layers.append(('pelt', ['torso'], 0.004))

    # ---------------------------------------------------------------------------------------- armour
    def armor(self, a):
        V_ = V
        if a == 'none':
            return
        mat = {'leather': 'leather', 'mail': 'mail', 'plate': 'steel', 'lamellar': 'lacquer', 'bronze': 'bronze'}[a]
        light = self.c['LIGHT']
        # the cuirass follows the trunk's own cross-sections, a little larger, open at the neck and the waist
        off = 0.006
        lo, hi = self.c.get('CUIRASS_Y', (0.47, 0.74))
        rings = [(y, w, f, b, z) for (y, w, f, b, z) in self.c['TORSO_RINGS'] if lo <= y <= hi]
        cu = self.part('cuirass', 'torso', mat, remesh=False)
        cu.loft([((0, y, z), (1, 0, 0), (0, 0, 1), w + off, f + off, b + off) for (y, w, f, b, z) in rings],
                seg=16 if light else 24, power=2.25, cap_start=False, cap_end=False)
        self.add(cu)
        self.layers.append(('cuirass', ['torso'], 0.004))
        if a == 'lamellar':
            bands = self.part('bands', 'torso', 'gold', remesh=False)
            for y0 in [self.xf((0, y, 0)).y for y in (0.58, 0.64)]:
                near = min(self.c['TORSO_RINGS'], key=lambda r: abs(r[0] - y0))
                _, w, f, b, z = near
                bands.loft([((0, y, z), (1, 0, 0), (0, 0, 1), w + 0.011, f + 0.011, b + 0.011) for y in (y0, y0 + 0.01)],
                           seg=16 if light else 24, power=2.25, cap_start=False, cap_end=False)
            self.add(bands)
            self.layers.append(('bands', ['cuirass'], 0.002))
        seated = self.c.get('SEATED', False)   # a rider's legs are dressed by rider.py
        if a in ('mail', 'lamellar') and not seated:
            # a short skirt of mail (or lacquered plates) over the tunic, skinned like it
            ms = self.part('mailskirt', 'hips', mat, remesh=False)
            ms.loft([((0, y, -0.004), (1, 0, 0), (0, 0, 1), r, r * 0.8, r * 0.8) for y, r in ((0.5, 0.097), (0.46, 0.104), (0.41, 0.112), (0.36, 0.121))],
                    seg=16 if light else 24, cap_start=False, cap_end=False)
            self.c['skirt_masks'](ms)
            self.add(ms)
            self.layers.append(('mailskirt', ['skirt'], 0.004))
        if a in ('mail',):
            for s, side in ((1, 'L'), (-1, 'R')):
                sh, el = self.c['SH'][s], self.c['EL'][s]
                ms = self.part('mailsleeve' + side, 'arm' + side, 'mail', tris=120)
                ms.ball(sh, 0.044)
                ms.limb(sh, sh.lerp(el, 0.5), 0.043, 0.04, seg=12)
                self.add(ms)
                self.layers.append(('mailsleeve' + side, ['sleeve' + side], 0.003))
        if a == 'plate':
            for s, side in ((1, 'L'), (-1, 'R')):
                sh, el, wr = self.c['SH'][s], self.c['EL'][s], self.c['WR'][s]
                pa = self.part('pauldron' + side, 'arm' + side, 'steel', tris=140)
                pa.ellipsoid(sh + V_((0.012 * s, 0.01, 0)), (0.052, 0.04, 0.05))
                pa.ellipsoid(sh + V_((-0.03 * s, -0.02, 0)), (0.04, 0.06, 0.06), cut=True)
                self.add(pa)
                self.layers.append(('pauldron' + side, ['sleeve' + side], 0.003))
                vb = self.part('vambrace' + side, 'elbow' + side, 'steel', remesh=False)
                self.tube(vb, el, wr, [(0.35, 0.034), (0.62, 0.031), (0.9, 0.027)])
                self.add(vb)
                self.layers.append(('vambrace' + side, ['forearm' + side], 0.003))
        if a in ('plate', 'bronze') and not seated:
            for s, side in ((1, 'L'), (-1, 'R')):
                knee, ankle = self.c['KNEE'][s], self.c['ANKLE'][s]
                gr = self.part('greave' + side, 'knee' + side, 'steel' if a == 'plate' else 'bronze', remesh=False)
                self.tube(gr, knee, ankle, [(0.06, 0.037), (0.3, 0.038), (0.55, 0.034), (0.8, 0.029)])
                self.add(gr)
                self.layers.append(('greave' + side, ['shin' + side, 'wrap' + side], 0.003))

    def tube(self, part, a, b, profile):
        """An open sleeve of armour lofted along a limb (profile: [(t, radius)] from a to b)."""
        axis = (b - a)
        L = axis.length
        axis.normalize()
        f = V((0, 0, 1)) - axis * axis.z
        f.normalize()
        u = axis.cross(f)
        part.loft([(a + axis * (L * t), u, f, r, r, r) for t, r in profile], seg=10 if self.c['LIGHT'] else 16,
                  cap_start=False, cap_end=False)

    def sash(self):
        s = self.part('sash', 'torso', 'team', tris=160, smooth=4)
        s.limb((0.09, 0.71, 0.0), (-0.1, 0.52, 0.0), 0.075, 0.075, seg=20, caps=False, flat=0.35)
        self.add(s)
        self.layers.append(('sash', ['torso'] + (['cuirass'] if self.k['armor'] != 'none' else []), 0.004))

    def cape(self):
        """A cloak from the shoulders to mid-thigh behind the back; its lower part follows the legs like the tunic."""
        V_ = V
        c = self.part('cape', 'torso', 'team', tris=300, smooth=4, remesh=False)
        rows, cols = 9, 11
        pts, nrm = [], []
        verts, faces = [], []
        for i in range(rows):
            t = i / (rows - 1)
            y = 0.735 - t * 0.39
            half = 0.1 + 0.05 * t
            back = -0.075 - 0.02 * t
            for j in range(cols):
                u = j / (cols - 1) * 2 - 1
                x = u * half
                z = back - 0.03 * (1 - u * u) - (0.01 if i == 0 else 0)
                verts.append((x, y, z))
        for i in range(rows - 1):
            for j in range(cols - 1):
                a = i * cols + j
                faces.append((a, a + 1, a + cols + 1, a + cols))
        c.mesh(verts, faces)
        self.c['skirt_masks'](c)
        self.add(c)
        self.layers.append(('cape', ['torso', 'skirt'] + (['cuirass'] if self.k['armor'] != 'none' else []), 0.006))

    def quiver(self):
        V_ = V
        q = self.part('quiver', 'torso', 'leather', tris=160)
        q.limb(self.xf((0.06, 0.53, -0.1)), self.xf((-0.04, 0.74, -0.1)), 0.028, 0.032, seg=12)
        self.add(q)
        self.layers.append(('quiver', ['torso'] + (['cuirass'] if self.k['armor'] != 'none' else []), 0.006))
        f = self.part('fletching', 'torso', 'feather', tris=100)
        for dx in (-0.012, 0.0, 0.012):
            f.cone(self.xf((-0.04 + dx, 0.74, -0.1)), self.xf((-0.05 + dx, 0.79, -0.1)), 0.009, seg=5)
        self.add(f)

    # ---------------------------------------------------------------------------------------- shields
    def shield(self, kind):
        """Shields are strapped to the left forearm and gripped in the fist; the face points out to the left front."""
        V_ = V
        g = self.c['GRIP_L']
        # built facing +x (outward) from the fist, then the fist's hold turns it; offsets keep the arm clear
        out = 0.03
        sb = self.c.get('SHIELD_BONE', 'handL')    # a rider's shield hangs from the saddle
        turn = self.c.get('SHIELD_TURN')           # and is turned to lie beside the horse's shoulder
        if kind in ('round', 'small', 'hoplon'):
            import math
            r = {'round': 0.13, 'small': 0.09, 'hoplon': 0.16}[kind]
            c = g + V_((out, 0.03, 0))
            face = self.part('shield', sb, 'team', tris=260, smooth=3)
            face.limb(c, c + V_((0.016, 0, 0)), r, r, seg=28, flat=1.0)
            face.ellipsoid(c + V_((0.016, 0, 0)), (0.009 if kind != 'hoplon' else 0.013, r * 0.92, r * 0.92))   # domed front
            self.add(face, None, turn)
            ring = [c + V_((0.012, r * math.cos(a), r * math.sin(a))) for a in [2 * math.pi * i / 36 for i in range(37)]]
            rim = self.part('shieldrim', sb, 'bronze' if kind == 'hoplon' else 'wood', remesh=False)
            rim.tube(ring, 0.011 if kind == 'hoplon' else 0.008, seg=6)
            self.add(rim, None, turn)
            boss = self.part('shieldboss', sb, 'bronze' if kind == 'hoplon' else 'steel', tris=100)
            boss.ellipsoid(c + V_((0.03 if kind != 'hoplon' else 0.036, 0, 0)), (0.018, 0.03, 0.03))
            self.add(boss, None, turn)
        elif kind == 'kite':
            face = self.part('shield', sb, 'team', tris=300, smooth=4)
            face.limb(g + V_((out, 0.07, 0)), g + V_((out, -0.22, 0)), 0.1, 0.02, seg=24, flat=0.18, caps=True)
            face.ellipsoid(g + V_((out, 0.07, 0)), (0.02, 0.05, 0.1))
            self.add(face, None, turn)
            boss = self.part('shieldboss', sb, 'steel', tris=80)
            boss.ellipsoid(g + V_((out + 0.022, 0.0, 0)), (0.014, 0.025, 0.025))
            self.add(boss, None, turn)
        elif kind == 'scutum':
            face = self.part('shield', sb, 'team', tris=320, smooth=3)
            face.limb(g + V_((out + 0.02, 0.2, 0)), g + V_((out + 0.02, -0.22, 0)), 0.11, 0.11, seg=24, flat=0.2, caps=False)
            self.add(face, None, turn)
            boss = self.part('shieldboss', sb, 'gold', tris=80)
            boss.ellipsoid(g + V_((out + 0.045, 0.0, 0)), (0.016, 0.03, 0.03))
            self.add(boss, None, turn)
        self.c['shield_parts'].extend(['shield', 'shieldrim', 'shieldboss'])

    # ---------------------------------------------------------------------------------------- weapons
    def weapon(self, w):
        V_ = V
        g = self.c['GRIP_R']
        steel = 'steel'
        seat, seat_spear = self.c['SEAT'], self.c['SEAT_SPEAR']
        P = lambda name, mat, tris=140: self.part(name, 'handR', mat, tris=tris, voxel=0.0015, smooth=2)
        if w in ('sword', 'greatsword'):
            L = 0.3 if w == 'sword' else 0.5
            grip = 0.1 if w == 'greatsword' else 0.07
            hilt = P('hilt', 'darkleather')
            hilt.limb(g + V_((0, 0.05 + (grip - 0.07), 0)), g + V_((0, -0.03, 0)), 0.013, 0.013, seg=8)
            hilt.ball(g + V_((0, 0.065 + (grip - 0.07), 0)), 0.018)                                     # pommel
            self.add(hilt, None, seat)
            guard = P('guard', 'gold' if self.k['elite'] else 'steel')
            guard.limb(g + V_((0, -0.04, -0.05)), g + V_((0, -0.04, 0.05)), 0.009, 0.009, seg=8)
            self.add(guard, None, seat)
            blade = P('blade', steel, 180)
            blade.limb(g + V_((0, -0.045, 0)), g + V_((0, -0.045 - L, 0)), 0.02, 0.008, seg=10, flat=0.28)
            self.add(blade, None, (g, lambda o: (-o.x, -o.z, -o.y)) if False else seat)
            self.c['held'] += ['hilt', 'guard', 'blade']
        elif w == 'axe':
            haft = P('axehaft', 'wood')
            haft.limb(g + V_((0, 0.05, 0)), g + V_((0, -0.42, 0)), 0.012, 0.013, seg=8)
            self.add(haft, None, seat)
            head = P('axehead', steel)
            head.ellipsoid(g + V_((0, -0.38, 0.05)), (0.01, 0.06, 0.055))
            head.limb(g + V_((0, -0.38, 0.0)), g + V_((0, -0.38, 0.03)), 0.02, 0.015, seg=8)
            self.add(head, None, seat)
            self.c['held'] += ['axehaft', 'axehead']
        elif w in ('spear', 'pike', 'halberd', 'fireLance', 'javelin', 'staff'):
            back, front = {'spear': (0.35, 0.72), 'pike': (0.42, 1.12), 'halberd': (0.35, 0.9), 'fireLance': (0.35, 0.72),
                           'javelin': (0.25, 0.42), 'staff': (0.32, 0.66)}[w]
            shaft = P('shaft', 'wood', 160)
            shaft.limb(g + V_((0, front, 0)), g + V_((0, -back, 0)), 0.011 if w != 'javelin' else 0.009, 0.011 if w != 'javelin' else 0.009, seg=8)
            self.add(shaft, None, seat_spear)
            names = ['shaft']
            if w == 'staff':
                knob = P('staffknob', 'gold', 100)
                knob.ball(g + V_((0, front + 0.02, 0)), 0.03)
                knob.cone(g + V_((0, front + 0.04, 0)), g + V_((0, front + 0.12, 0)), 0.012, seg=8)
                self.add(knob, None, seat_spear)
                names.append('staffknob')
            else:
                head = P('spearhead', steel)
                head.ellipsoid(g + V_((0, front + 0.05, 0)), (0.018, 0.06, 0.006))
                head.cone(g + V_((0, front + 0.09, 0)), g + V_((0, front + 0.13, 0)), 0.012, seg=6)
                if w == 'halberd':
                    head.ellipsoid(g + V_((0, front - 0.02, 0.05)), (0.008, 0.06, 0.05))           # axe blade
                    head.cone(g + V_((0, front - 0.02, -0.01)), g + V_((0, front - 0.02, -0.06)), 0.01, seg=6)   # back spike
                self.add(head, None, seat_spear)
                names.append('spearhead')
            if w == 'fireLance':
                tube = P('firetube', 'bronze')
                tube.limb(g + V_((0, front - 0.18, 0.025)), g + V_((0, front - 0.02, 0.025)), 0.022, 0.022, seg=10)
                self.add(tube, None, seat_spear)
                names.append('firetube')
            self.c['held'] += names
        elif w in ('bow', 'longbow'):
            self.bow(0.28 if w == 'bow' else 0.4)
        elif w == 'crossbow':
            # the stock through the right fist, pointing forward; the prod across its front
            stock = P('stock', 'wood', 160)
            stock.limb(g + V_((0, 0.3, 0)), g + V_((0, -0.12, 0)), 0.018, 0.02, seg=8, flat=0.7)
            self.add(stock, None, seat_spear)
            prod = P('prod', 'steel', 140)
            prod.limb(g + V_((-0.2, 0.28, 0.02)), g + V_((0.2, 0.28, 0.02)), 0.008, 0.008, seg=8)
            self.add(prod, None, seat_spear)
            self.c['held'] += ['stock', 'prod']
        elif w == 'gun':
            stock = P('stock', 'wood', 140)
            stock.limb(g + V_((0, 0.05, 0)), g + V_((0, -0.1, 0)), 0.02, 0.022, seg=8)
            self.add(stock, None, seat_spear)
            barrel = P('barrel', 'darksteel', 140)
            barrel.limb(g + V_((0, 0.03, 0)), g + V_((0, 0.4, 0)), 0.02, 0.016, seg=10)
            self.add(barrel, None, seat_spear)
            self.c['held'] += ['stock', 'barrel']

    def bow(self, L):
        """The bow in the left fist: the stave passes through the fist (its hole runs thumb to little finger), the
        tips curve back towards the archer, and the string is skinned to a 'nock' bone the draw pulls back."""
        V_ = V
        g = self.c['GRIP_L']
        # in the left hand's own frame: stave along z, the archer (and the string) towards +y (the wrist)
        pts = []
        n = 12
        for i in range(n + 1):
            u = i / n * 2 - 1
            pts.append(g + V_((0, 0.075 * u * u, L * u)))
        stave = self.part('bow', 'handL', 'wood', tris=160, voxel=0.0015, smooth=2)
        for i in range(n):
            stave.limb(pts[i], pts[i + 1], 0.011 - 0.004 * abs(i / n * 2 - 1), 0.011 - 0.004 * abs((i + 1) / n * 2 - 1), seg=8)
        self.add(stave)
        tipA, tipB = pts[0], pts[-1]
        mid = g + V_((0, 0.075, 0))
        self.c['nock_rest'] = mid
        s = self.mk.Part('bowstring', 'handL', 'cord', remesh=False)
        s.tube([tipA.lerp(mid, t / 5) for t in range(6)] + [mid.lerp(tipB, t / 5) for t in range(1, 6)], 0.0018, seg=4)
        s.mask('nock', lambda p, nn: max(0.0, 1 - abs(p[2] - g.z) / L))
        self.add(s)
        self.c['held'] += ['bow']
