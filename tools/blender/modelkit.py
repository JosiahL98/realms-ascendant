"""
Helpers for building game models in Blender from Python (run with `blender --background --python <script>`).

Models are authored in game coordinates (x right, y up, z forward) and converted to Blender's z-up frame
internally. Each part is a union of primitives that is voxel-remeshed into one watertight surface, optionally
carved by cutter primitives (nostrils, ear hollows), smoothed so the joins become fillets, then decimated to a
triangle budget. Ambient occlusion is baked per vertex at two scales (overall shape and small creases) by ray
casting against the whole model plus the ground. Parts can carry per-vertex masks (coat markings and the like)
computed from rest-pose position and normal. Parts are exported as JSON relative to the pivot of their bone.
"""
import json
import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree


def g2b(v):
    """Game (x, y, z) -> Blender (x, -z, y)."""
    return Vector((v[0], -v[2], v[1]))


def b2g(v):
    return (v[0], v[2], -v[1])


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def game_rotation(rot):
    """Rotation matrix for game-space Euler angles (x, y, z), expressed in Blender space."""
    rx, ry, rz = rot
    # game x = blender x, game y = blender z, game z = -blender y
    return Matrix.Rotation(rx, 4, 'X') @ Matrix.Rotation(ry, 4, 'Z') @ Matrix.Rotation(-rz, 4, 'Y')


def evaluated_mesh(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    return bpy.data.meshes.new_from_object(ev, depsgraph=dg)


def _apply(obj, mod_type, **props):
    """Add one modifier, bake its result into the object's mesh and drop the modifier."""
    mod = obj.modifiers.new(mod_type.lower(), mod_type)
    for k, v in props.items():
        setattr(mod, k, v)
    me = evaluated_mesh(obj)
    obj.modifiers.clear()
    old = obj.data
    obj.data = me
    bpy.data.meshes.remove(old)


class Part:
    """A named piece of a model: the bone it follows, its material key, and the primitives it is made of."""

    def __init__(self, name, bone, mat, voxel=0.006, smooth=6, tris=400, smooth_factor=0.5, remesh=True, symmetric=False):
        #: symmetric=True keeps the +x half and mirrors it, so the part is exactly symmetric (faces, bodies)
        self.symmetric = symmetric
        #: remesh=False keeps the geometry as given (thin straps, cloth shells) instead of fusing it into a volume
        self.remesh = remesh
        self.name = name
        self.bone = bone
        self.mat = mat
        self.voxel = voxel
        self.smooth = smooth
        self.smooth_factor = smooth_factor
        self.tris = tris
        self.bm = bmesh.new()
        self.cut_bm = None
        self.masks = {}

    def _bm(self, cut):
        if not cut:
            return self.bm
        if self.cut_bm is None:
            self.cut_bm = bmesh.new()
        return self.cut_bm

    def ellipsoid(self, c, r, rot=(0.0, 0.0, 0.0), seg=20, cut=False):
        """Ellipsoid centred at game point c with game-axis radii r, rotated by game Euler angles (x, y, z)."""
        m = Matrix.Translation(g2b(c)) @ game_rotation(rot) @ Matrix.Diagonal((r[0], r[2], r[1], 1.0))
        bmesh.ops.create_uvsphere(self._bm(cut), u_segments=seg, v_segments=max(8, seg * 2 // 3), radius=1.0, matrix=m)
        return self

    def ball(self, c, r, seg=16, cut=False):
        return self.ellipsoid(c, (r, r, r), seg=seg, cut=cut)

    def limb(self, p0, p1, r0, r1, seg=16, caps=True, flat=1.0, cut=False):
        """Tapered cylinder between two game points with rounded ends. `flat` < 1 squashes it sideways (x)."""
        a, b = g2b(p0), g2b(p1)
        d = b - a
        rot = d.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
        m = Matrix.Translation((a + b) / 2) @ rot @ Matrix.Diagonal((flat, 1.0, 1.0, 1.0))
        bmesh.ops.create_cone(self._bm(cut), cap_ends=True, cap_tris=False, segments=seg, radius1=r0, radius2=r1, depth=d.length, matrix=m)
        if caps:
            self.ellipsoid(p0, (r0 * flat, r0, r0), seg=seg, cut=cut)
            self.ellipsoid(p1, (r1 * flat, r1, r1), seg=seg, cut=cut)
        return self

    def chain(self, points, radii, seg=16, flat=1.0):
        """Limbs through consecutive points with per-point radii."""
        for i in range(len(points) - 1):
            self.limb(points[i], points[i + 1], radii[i], radii[i + 1], seg=seg, caps=True, flat=flat)
        return self

    def cone(self, base, tip, r, seg=10, r_tip=0.0, flat=1.0, cut=False):
        a, b = g2b(base), g2b(tip)
        d = b - a
        rot = d.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
        m = Matrix.Translation((a + b) / 2) @ rot @ Matrix.Diagonal((flat, 1.0, 1.0, 1.0))
        bmesh.ops.create_cone(self._bm(cut), cap_ends=True, cap_tris=True, segments=seg, radius1=r, radius2=r_tip, depth=d.length, matrix=m)
        return self

    def loft(self, rings, seg=20, power=2.0, cap_start=True, cap_end=True):
        """
        A smooth surface through a stack of cross-sections, for bodies and sleeves (use with remesh=False): regular
        quads shade evenly at low triangle counts, where a remeshed and decimated union of blobs looks lumpy.
        Each ring is (centre, u_axis, v_axis, ru, rv_pos, rv_neg): a superellipse (exponent `power`, 2 = ellipse)
        with half-width ru along u and half-depth rv_pos / rv_neg along +v / -v. Ends are closed with a fan unless
        told otherwise (an open end is a hem).
        """
        verts, faces = [], []
        n = seg
        for (c, u, v, ru, rvp, rvn) in rings:
            c, u, v = Vector(c), Vector(u).normalized(), Vector(v).normalized()
            for k in range(n):
                a = 2 * math.pi * k / n
                ca, sa = math.cos(a), math.sin(a)
                # superellipse: |x|^p + |y|^p = 1
                x = math.copysign(abs(ca) ** (2.0 / power), ca)
                y = math.copysign(abs(sa) ** (2.0 / power), sa)
                verts.append(tuple(c + u * (x * ru) + v * (y * (rvp if y >= 0 else rvn))))
        m = len(rings)
        for i in range(m - 1):
            for k in range(n):
                k2 = (k + 1) % n
                faces.append((i * n + k, i * n + k2, (i + 1) * n + k2, (i + 1) * n + k))
        if cap_start:
            c0 = Vector(rings[0][0])
            verts.append(tuple(c0))
            ci = len(verts) - 1
            for k in range(n):
                faces.append((ci, (k + 1) % n, k))
        if cap_end:
            c1 = Vector(rings[-1][0])
            verts.append(tuple(c1))
            ci = len(verts) - 1
            base = (m - 1) * n
            for k in range(n):
                faces.append((ci, base + k, base + (k + 1) % n))
        return self.mesh(verts, faces)

    def mesh(self, verts, faces):
        """Adds raw geometry given in game coordinates."""
        vs = [self.bm.verts.new(g2b(v)) for v in verts]
        for f in faces:
            try:
                self.bm.faces.new([vs[i] for i in f])
            except ValueError:
                pass
        return self

    def ribbon(self, points, normals, width, thickness, closed=False, bottom=False, top_only=False):
        """
        A flat strap along a polyline lying on a surface: `normals` point away from the surface; the strap's width
        runs across the path within the surface, and it is `thickness` thick (a closed box section).
        """
        n = len(points)
        P = [Vector(p) for p in points]
        N = [Vector(q).normalized() for q in normals]
        verts, faces = [], []
        for i in range(n):
            a_ = P[(i - 1) % n] if closed or i > 0 else P[i]
            b_ = P[(i + 1) % n] if closed or i < n - 1 else P[i]
            t = (b_ - a_).normalized()
            side = t.cross(N[i]).normalized() * (width / 2)
            lift = N[i] * thickness
            for q in (P[i] - side, P[i] + side, P[i] + side + lift, P[i] - side + lift):
                verts.append(tuple(q))
        rows = n if closed else n - 1
        for i in range(rows):
            j = (i + 1) % n
            for k in range(4):
                if k == 0 and not bottom:
                    continue   # the underside lies on the surface and is never seen
                if top_only and k != 2:
                    continue   # a single band: its thin edges vanish at small sizes anyway
                k2 = (k + 1) % 4
                faces.append((i * 4 + k, j * 4 + k, j * 4 + k2, i * 4 + k2))
        if not closed and not top_only:
            faces.append((0, 3, 2, 1))
            last = (n - 1) * 4
            faces.append((last, last + 1, last + 2, last + 3))
        return self.mesh(verts, faces)

    def tube(self, points, radius, seg=6):
        """A round tube along a polyline (reins, cords)."""
        P = [Vector(p) for p in points]
        verts, faces = [], []
        for i, p in enumerate(P):
            t = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
            u = t.orthogonal().normalized()
            w = t.cross(u)
            for k in range(seg):
                a_ = 2 * math.pi * k / seg
                verts.append(tuple(p + (u * math.cos(a_) + w * math.sin(a_)) * radius))
        for i in range(len(P) - 1):
            for k in range(seg):
                k2 = (k + 1) % seg
                faces.append((i * seg + k, (i + 1) * seg + k, (i + 1) * seg + k2, i * seg + k2))
        faces.append(tuple(range(seg - 1, -1, -1)))
        last = (len(P) - 1) * seg
        faces.append(tuple(last + k for k in range(seg)))
        return self.mesh(verts, faces)

    def mask(self, name, fn):
        """Per-vertex value in 0..1 from the rest-pose game position and normal: fn((x, y, z), (nx, ny, nz))."""
        self.masks[name] = fn
        return self

    def build(self):
        """Union, carve, smooth and decimate; returns a Blender object in absolute model space."""
        if not self.remesh:
            bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        me = bpy.data.meshes.new(self.name + '_src')
        self.bm.to_mesh(me)
        self.bm.free()
        obj = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(obj)
        if not self.remesh:
            obj.data.shade_smooth()
            obj['bone'] = self.bone
            obj['mat'] = self.mat
            _MASKS[obj.name] = self.masks
            if self.cut_bm is not None:
                self.cut_bm.free()
            return obj
        _apply(obj, 'REMESH', mode='VOXEL', voxel_size=self.voxel, adaptivity=0.0)
        if self.cut_bm is not None:
            cme = bpy.data.meshes.new(self.name + '_cut')
            self.cut_bm.to_mesh(cme)
            self.cut_bm.free()
            cutter = bpy.data.objects.new(self.name + '_cutter', cme)
            bpy.context.scene.collection.objects.link(cutter)
            _apply(cutter, 'REMESH', mode='VOXEL', voxel_size=self.voxel, adaptivity=0.0)
            _apply(obj, 'BOOLEAN', operation='DIFFERENCE', object=cutter, solver='EXACT')
            bpy.data.objects.remove(cutter)
        if self.smooth:
            _apply(obj, 'SMOOTH', factor=self.smooth_factor, iterations=self.smooth)
        if self.symmetric:
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-6,
                                   plane_co=(0, 0, 0), plane_no=(1, 0, 0), clear_inner=True)
            bm.to_mesh(obj.data)
            bm.free()
            _apply(obj, 'MIRROR', use_mirror_merge=True, merge_threshold=0.0004, use_clip=True)
        tri_count = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        budget = max(24, int(self.tris * TRI_SCALE))
        if tri_count > budget:
            _apply(obj, 'DECIMATE', decimate_type='COLLAPSE', ratio=budget / tri_count, use_collapse_triangulate=True,
                   use_symmetry=self.symmetric, symmetry_axis='X')
        obj.data.shade_smooth()
        obj['bone'] = self.bone
        obj['mat'] = self.mat
        _MASKS[obj.name] = self.masks
        return obj


_MASKS = {}
#: Multiplies every part's triangle budget (for lighter versions of a model).
TRI_SCALE = 1.0


def hemisphere_dirs(n=64, seed=7):
    rnd = random.Random(seed)
    dirs = []
    for _ in range(n):
        u, v = rnd.random(), rnd.random()
        r = math.sqrt(u)
        th = 2 * math.pi * v
        dirs.append(Vector((r * math.cos(th), r * math.sin(th), math.sqrt(max(0.0, 1 - u)))))
    return dirs


def bake_ao(objs, dist=0.3, near=0.05, samples=64, ground=True, occluders=()):
    """
    Per-vertex ambient occlusion (1 = open sky) against all objects and the ground plane (blender z=0),
    combining the overall shape (rays up to `dist`) with small creases (hits closer than `near`).
    """
    verts, polys = [], []
    for o in list(objs) + list(occluders):
        base = len(verts)
        verts.extend(v.co.copy() for v in o.data.vertices)
        polys.extend([base + i for i in p.vertices] for p in o.data.polygons)
    tree = BVHTree.FromPolygons(verts, polys)
    dirs = hemisphere_dirs(samples)
    result = {}
    for o in objs:
        ao = []
        for v in o.data.vertices:
            n = v.normal.normalized()
            t = n.orthogonal().normalized()
            b = n.cross(t)
            origin = v.co + n * 0.002
            far = close = 0
            for d in dirs:
                w = t * d.x + b * d.y + n * d.z
                hit, _, _, hd = tree.ray_cast(origin, w, dist)
                if hit is None and ground and w.z < -1e-4:
                    tg = -origin.z / w.z
                    if 0 < tg < dist:
                        hit, hd = True, tg
                if hit is not None:
                    far += 1
                    if hd < near:
                        close += 1
            a_far = 1 - far / len(dirs)
            a_near = 1 - close / len(dirs)
            ao.append(a_far * (0.55 + 0.45 * a_near))
        result[o.name] = ao
    return result


def vertex_masks(o):
    """Evaluate a part's mask functions on its final vertices (game-space rest position and normal)."""
    fns = _MASKS.get(o.name, {})
    out = {}
    for name, fn in fns.items():
        vals = [max(0.0, min(1.0, fn(b2g(v.co), b2g(v.normal)))) for v in o.data.vertices]
        if max(vals, default=0) > 0.01:
            out[name] = vals
    return out


def export_model(objs, ao, bones, path, variants=None, masks=None):
    """
    Write bones (absolute rest pivots) and parts: positions relative to the part's bone pivot (game space),
    normals, AO, masks and triangle indices.
    """
    pivots = {b['name']: b['pivot'] for b in bones}
    out = {'bones': bones, 'parts': []}
    for o in objs:
        me = o.data
        me.calc_loop_triangles()
        pv = pivots[o['bone']]
        pos, nrm = [], []
        for v in me.vertices:
            g = b2g(v.co)
            pos.extend(round(g[k] - pv[k], 4) for k in range(3))
            nrm.extend(round(c, 3) for c in b2g(v.normal))
        idx = []
        for t in me.loop_triangles:
            idx.extend(t.vertices)
        part = {'name': o.name, 'bone': o['bone'], 'mat': o['mat'], 'pos': pos, 'nrm': nrm,
                'ao': [round(a, 2) for a in ao[o.name]], 'idx': idx}
        if variants and variants.get(o.name):
            part['variant'] = variants[o.name]
        m = masks[o.name] if masks is not None else vertex_masks(o)
        if m:
            part['masks'] = {k: [round(x, 2) for x in v] for k, v in m.items()}
        out['parts'].append(part)
    with open(path, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    return sum(len(p['idx']) // 3 for p in out['parts'])


def preview(objs, colors, path, center, size=1.6, views=(('iso', 45.0, 30.0),), res=(640, 640)):
    """
    Render with per-vertex colours from the game's camera angle (and any extra views).
    colors: {object name: [(r, g, b) linear per vertex]}. A view is (name, azimuth, elevation[, centre, size]).
    """
    scene = bpy.context.scene
    scene.render.engine = os.environ.get('PREVIEW_ENGINE', 'BLENDER_EEVEE_NEXT')
    scene.render.resolution_x, scene.render.resolution_y = res
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.42, 0.44, 0.4, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.6
    scene.world = world
    for o in objs:
        me = o.data
        attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        for i, c in enumerate(colors[o.name]):
            attr.data[i].color = (c[0], c[1], c[2], 1)
        mat = bpy.data.materials.new(o.name + '_m')
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        bsdf = nodes['Principled BSDF']
        bsdf.inputs['Roughness'].default_value = 0.75
        col = nodes.new('ShaderNodeAttribute')
        col.attribute_name = 'Col'
        mat.node_tree.links.new(col.outputs['Color'], bsdf.inputs['Base Color'])
        me.materials.append(mat)
    gme = bpy.data.meshes.new('ground')
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=4)
    bm.to_mesh(gme)
    bm.free()
    gobj = bpy.data.objects.new('ground', gme)
    scene.collection.objects.link(gobj)
    gmat = bpy.data.materials.new('groundm')
    gmat.use_nodes = True
    gmat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.35, 0.33, 0.22, 1)
    gme.materials.append(gmat)
    sun = bpy.data.lights.new('sun', 'SUN')
    sun.energy = 4.0
    sun.angle = 0.2
    sobj = bpy.data.objects.new('sun', sun)
    scene.collection.objects.link(sobj)
    sdir = g2b((-0.55, 0.78, 0.3)).normalized()
    sobj.rotation_euler = (-sdir).to_track_quat('-Z', 'Y').to_euler()
    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    paths = []
    for view in views:
        name, azim, elev = view[:3]
        c = g2b(view[3] if len(view) > 3 else center)
        cam_data.ortho_scale = view[4] if len(view) > 4 else size
        az, el = math.radians(azim), math.radians(elev)
        d = g2b((math.cos(el) * math.sin(az), math.sin(el), math.cos(el) * math.cos(az)))
        cam.location = c + d * 10
        cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        p = path.replace('.png', f'_{name}.png')
        scene.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append(p)
    return paths


def object_from_export(path, part_names=None, name='import'):
    """Builds a Blender object (absolute game positions) from parts of an exported model, e.g. to fit against."""
    with open(path) as f:
        data = json.load(f)
    pivots = {b['name']: b['pivot'] for b in data['bones']}
    verts, faces = [], []
    for p in data['parts']:
        if part_names and p['name'] not in part_names:
            continue
        pv = pivots[p['bone']]
        base = len(verts)
        pos = p['pos']
        for i in range(0, len(pos), 3):
            verts.append(g2b((pos[i] + pv[0], pos[i + 1] + pv[1], pos[i + 2] + pv[2])))
        idx = p['idx']
        faces.extend((base + idx[i], base + idx[i + 1], base + idx[i + 2]) for i in range(0, len(idx), 3))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj, data


class Surface:
    """Ray-casting helper against one or more mesh objects, in game coordinates."""

    def __init__(self, *objs):
        verts, polys = [], []
        for o in objs:
            base = len(verts)
            mw = o.matrix_world
            verts.extend(mw @ v.co for v in o.data.vertices)
            polys.extend([base + i for i in p.vertices] for p in o.data.polygons)
        self.tree = BVHTree.FromPolygons(verts, polys)

    def inside(self, p):
        """Ray-parity test: odd number of crossings along a fixed skew direction means inside."""
        d = Vector((0.5773, 0.5774, 0.5775))
        o = g2b(p)
        hits = 0
        for _ in range(64):
            loc, _, _, _ = self.tree.ray_cast(o, d, 10.0)
            if loc is None:
                break
            hits += 1
            o = loc + d * 1e-5
        return hits % 2 == 1

    def signed_distance(self, p, near=0.004):
        """Distance to the surface, negative inside. Near the surface (within `near`) the nearest face's normal
        decides; further away (where a thin part's nearest face can point either way) ray parity decides. Parity is
        wrong for open surfaces (a cuirass open at the neck and waist), so layering garments passes a larger `near`."""
        loc, nrm, _, dist = self.tree.find_nearest(g2b(p))
        if loc is None:
            return 1.0, None
        by_normal = (g2b(p) - loc).dot(nrm) < 0
        is_in = by_normal if dist < near else self.inside(p)
        n = Vector(b2g(nrm))
        if is_in != by_normal:
            n = -n if dist < near else (Vector(p) - Vector(b2g(loc))).normalized() * (-1 if is_in else 1)
        return (-dist if is_in else dist), n

    def push_out(self, obj, gap, only=None, max_depth=1.0):
        """Moves vertices of obj that are inside the surface, or nearer than `gap`, out along the normal.
        `only(p)` can restrict it to some vertices. Returns (vertices inside before, deepest penetration)."""
        inside, deepest = 0, 0.0
        for v in obj.data.vertices:
            p = b2g(v.co)
            if only and not only(p):
                continue
            d, n = self.signed_distance(p)
            if n is None or d >= gap or d < -max_depth:
                continue
            if d < 0:
                inside += 1
                deepest = max(deepest, -d)
            v.co = v.co + g2b(n) * (gap - d)
        obj.data.update()
        return inside, deepest

    def report(self, obj, gap=0.0):
        """(vertices closer than gap / inside, deepest penetration) without changing anything."""
        inside, deepest = 0, 0.0
        for v in obj.data.vertices:
            d, n = self.signed_distance(b2g(v.co))
            if n is not None and d < gap:
                inside += 1
                deepest = max(deepest, -d)
        return inside, deepest

    def cast(self, origin, direction, dist=5.0):
        hit, nrm, _, _ = self.tree.ray_cast(g2b(origin), g2b(direction).normalized(), dist)
        if hit is None:
            return None, None
        return Vector(b2g(hit)), Vector(b2g(nrm))

    def toward(self, target, direction, reach=0.8):
        """First surface point hit by a ray coming from `target - direction * reach` towards target."""
        d = Vector(direction).normalized()
        return self.cast(Vector(target) - d * reach, d, reach * 2)

    def nearest(self, p):
        loc, nrm, _, dist = self.tree.find_nearest(g2b(p))
        return Vector(b2g(loc)), Vector(b2g(nrm)), dist


def separate(outer, inners, gap, poke=0.01, near=0.004):
    """
    Layers clothing over what it covers: vertices of `outer` closer than `gap` to (or inside) the union of `inners`
    move out along the surface normal; then vertices of each inner that poke through `outer`, or sit less than
    `gap` under it, move back in. Returns (outer vertices moved, inner vertices moved).
    """
    under = Surface(*inners)
    moved_out = 0
    for v in outer.data.vertices:
        d, n = under.signed_distance(b2g(v.co), near)
        if n is not None and d < gap:
            v.co = v.co + g2b(n) * (gap - d)
            moved_out += 1
    outer.data.update()
    over = Surface(outer)
    moved_in = 0
    for inner in inners:
        for v in inner.data.vertices:
            d, n = over.signed_distance(b2g(v.co), near)
            if n is not None and -gap < d < poke:
                v.co = v.co - g2b(n) * (d + gap)
                moved_in += 1
        inner.data.update()
    return moved_out, moved_in
