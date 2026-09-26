"""
Helpers for building game models in Blender from Python (run with `blender --background --python <script>`).

Models are authored in game coordinates (x right, y up, z forward) and converted to Blender's z-up frame
internally. Each part is a union of primitives that is voxel-remeshed into one watertight surface, smoothed so
the joins become fillets, then decimated to a triangle budget. Ambient occlusion is baked into a per-vertex
value by ray casting against the whole model plus the ground, and parts are exported as JSON relative to the
pivot of the bone they belong to.
"""
import json
import math
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


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


class Part:
    """A named piece of a model: bone it follows, material key, and the primitives it is made of."""

    def __init__(self, name, bone, mat, voxel=0.006, smooth=6, tris=400):
        self.name = name
        self.bone = bone
        self.mat = mat
        self.voxel = voxel
        self.smooth = smooth
        self.tris = tris
        self.bm = bmesh.new()

    def _add(self, fn, **kw):
        fn(self.bm, **kw)

    def ellipsoid(self, c, r, rot=(0.0, 0.0, 0.0), seg=20):
        """Ellipsoid centred at game point c with game-axis radii r, rotated by game Euler angles (x, y, z)."""
        m = Matrix.Translation(g2b(c)) @ game_rotation(rot) @ Matrix.Diagonal((r[0], r[2], r[1], 1.0))
        bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=max(8, seg * 2 // 3), radius=1.0, matrix=m)
        return self

    def ball(self, c, r, seg=16):
        return self.ellipsoid(c, (r, r, r), seg=seg)

    def limb(self, p0, p1, r0, r1, seg=16, caps=True, flat=1.0):
        """Tapered cylinder between two game points with rounded ends. `flat` < 1 squashes it sideways (x)."""
        a, b = g2b(p0), g2b(p1)
        d = b - a
        length = d.length
        rot = d.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
        m = Matrix.Translation((a + b) / 2) @ rot @ Matrix.Diagonal((flat, 1.0, 1.0, 1.0))
        bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r0, radius2=r1, depth=length, matrix=m)
        if caps:
            self.ellipsoid(p0, (r0 * flat, r0, r0), seg=seg)
            self.ellipsoid(p1, (r1 * flat, r1, r1), seg=seg)
        return self

    def chain(self, points, radii, seg=16, flat=1.0):
        """Limbs through consecutive points with per-point radii."""
        for i in range(len(points) - 1):
            self.limb(points[i], points[i + 1], radii[i], radii[i + 1], seg=seg, caps=True, flat=flat)
        return self

    def cone(self, base, tip, r, seg=10):
        a, b = g2b(base), g2b(tip)
        d = b - a
        rot = d.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4()
        m = Matrix.Translation((a + b) / 2) @ rot
        bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=True, segments=seg, radius1=r, radius2=0.0, depth=d.length, matrix=m)
        return self

    def build(self):
        """Union + smooth + decimate; returns a Blender object in absolute model space."""
        me = bpy.data.meshes.new(self.name + '_src')
        self.bm.to_mesh(me)
        self.bm.free()
        obj = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(obj)
        rm = obj.modifiers.new('remesh', 'REMESH')
        rm.mode = 'VOXEL'
        rm.voxel_size = self.voxel
        rm.adaptivity = 0.0
        if self.smooth:
            sm = obj.modifiers.new('smooth', 'SMOOTH')
            sm.factor = 0.5
            sm.iterations = self.smooth
        dense = evaluated_mesh(obj)
        obj.modifiers.clear()
        old = obj.data
        obj.data = dense
        bpy.data.meshes.remove(old)
        tri_count = sum(len(p.vertices) - 2 for p in dense.polygons)
        if tri_count > self.tris:
            dm = obj.modifiers.new('decimate', 'DECIMATE')
            dm.decimate_type = 'COLLAPSE'
            dm.ratio = self.tris / tri_count
            dm.use_collapse_triangulate = True
            low = evaluated_mesh(obj)
            obj.modifiers.clear()
            old = obj.data
            obj.data = low
            bpy.data.meshes.remove(old)
        obj.data.shade_smooth()
        obj['bone'] = self.bone
        obj['mat'] = self.mat
        return obj


def game_rotation(rot):
    """Rotation matrix for game-space Euler angles (x, y, z), expressed in Blender space."""
    rx, ry, rz = rot
    # game x = blender x, game y = blender z, game z = -blender y
    return (Matrix.Rotation(rx, 4, 'X') @ Matrix.Rotation(ry, 4, 'Z') @ Matrix.Rotation(-rz, 4, 'Y'))


def evaluated_mesh(obj):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    return bpy.data.meshes.new_from_object(ev, depsgraph=dg)


def hemisphere_dirs(n=48, seed=7):
    rnd = random.Random(seed)
    dirs = []
    for _ in range(n):
        u, v = rnd.random(), rnd.random()
        r = math.sqrt(u)
        th = 2 * math.pi * v
        dirs.append(Vector((r * math.cos(th), r * math.sin(th), math.sqrt(max(0.0, 1 - u)))))
    return dirs


def bake_ao(objs, dist=0.3, samples=48, ground=True):
    """Per-vertex ambient occlusion (1 = open sky) against all objects and the ground plane (blender z=0)."""
    verts, polys = [], []
    for o in objs:
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
            origin = v.co + n * 0.003
            open_count = 0
            for d in dirs:
                w = t * d.x + b * d.y + n * d.z
                hit, _, _, _ = tree.ray_cast(origin, w, dist)
                blocked = hit is not None
                if not blocked and ground and w.z < -1e-4:
                    tg = -origin.z / w.z
                    blocked = 0 < tg < dist
                if not blocked:
                    open_count += 1
            ao.append(open_count / len(dirs))
        result[o.name] = ao
    return result


def export_parts(objs, ao, pivots, path, extra=None):
    """Write parts as JSON: positions relative to the part's bone pivot (game space), normals, AO, indices."""
    out = {'pivots': pivots, 'parts': []}
    for o in objs:
        me = o.data
        me.calc_loop_triangles()
        pv = pivots[o['bone']]
        pos, nrm = [], []
        for v in me.vertices:
            g = b2g(v.co)
            pos.extend(round(g[k] - pv[k], 4) for k in range(3))
            n = b2g(v.normal)
            nrm.extend(round(c, 3) for c in n)
        idx = []
        for t in me.loop_triangles:
            idx.extend(t.vertices)
        out['parts'].append({
            'name': o.name, 'bone': o['bone'], 'mat': o['mat'],
            'pos': pos, 'nrm': nrm, 'ao': [round(a, 2) for a in ao[o.name]], 'idx': idx,
        })
    if extra:
        out.update(extra)
    with open(path, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    return sum(len(p['idx']) // 3 for p in out['parts'])


def preview(objs, ao, tints, path, center, size=1.6, views=(('iso', 45.0, 30.0),), res=(640, 640)):
    """Render the model with AO-shaded vertex colours from the game's camera angle (and any extra views)."""
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.film_transparent = False
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.42, 0.44, 0.4, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.6
    scene.world = world
    for o in objs:
        me = o.data
        attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        tint = tints[o['mat']]
        for i, a in enumerate(ao[o.name]):
            k = 0.22 + 0.78 * a ** 1.3
            attr.data[i].color = (tint[0] * k, tint[1] * k, tint[2] * k, 1)
        mat = bpy.data.materials.new(o.name + '_m')
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        bsdf = nodes['Principled BSDF']
        bsdf.inputs['Roughness'].default_value = 0.8
        col = nodes.new('ShaderNodeAttribute')
        col.attribute_name = 'Col'
        mat.node_tree.links.new(col.outputs['Color'], bsdf.inputs['Base Color'])
        me.materials.append(mat)
    # ground
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
    cam_data.ortho_scale = size
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
