"""Shared helpers for the Dink City art scripts.

Run a script headless from the repo root (see art/README.md):

    blender -b --factory-startup -P art/scripts/player.py

Everything is authored in three.js space: meters, y up, forward is -z. `to_blender` converts to Blender's
z-up space, and the glTF exporter converts back (`export_yup`), so the numbers here match the game code.
Models are beveled low-poly boxes with flat shading and face colors from `art/palette.json`.
"""
import json
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

ART = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(ART, "palette.json"), encoding="utf-8") as f:
    PALETTE = json.load(f)
MODELS = os.path.join(ART, "models")
PREVIEWS = os.path.join(ART, "previews")


def to_blender(x, y, z):
    return Vector((x, -z, y))


def linear(hex_color):
    """An sRGB hex color as linear RGBA, which is what glTF vertex colors hold."""
    h = hex_color.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i : i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def rotation(rx=0.0, ry=0.0, rz=0.0):
    """A rotation given as three.js Euler angles (XYZ order), as a Blender matrix."""
    # three x = Blender x, three y = Blender z, three z = Blender -y.
    return (
        Matrix.Rotation(rx, 4, "X")
        @ Matrix.Rotation(ry, 4, "Z")
        @ Matrix.Rotation(-rz, 4, "Y")
    )


class Builder:
    """Accumulates shapes into one mesh. Each shape gets one named color from `colors`.

    With `regions=True`, every vertex also gets a `_region` attribute (the color's index in `colors`), which
    the game uses to recolor a model (shirt, skin, paddle, ...).
    """

    def __init__(self, colors, regions=False):
        self.bm = bmesh.new()
        self.names = list(colors)
        self.colors = colors
        self.regions = regions
        self.layer = self.bm.faces.layers.int.new("color")

    def _paint(self, verts, color):
        index = self.names.index(color)
        for f in {f for v in verts for f in v.link_faces}:
            f[self.layer] = index

    def _place(self, verts, center, rot, scale=(1, 1, 1)):
        sx, sy, sz = scale
        m = Matrix.Translation(to_blender(*center)) @ rotation(*rot) @ Matrix.Diagonal((sx, sz, sy, 1))
        bmesh.ops.transform(self.bm, matrix=m, verts=verts)

    def box(self, size, center=(0, 0, 0), color=None, bevel=0.02, rot=(0, 0, 0)):
        """A beveled box. `size` is (width x, height y, depth z)."""
        w, h, d = size
        verts = bmesh.ops.create_cube(self.bm, size=1.0)["verts"]
        bmesh.ops.transform(self.bm, matrix=Matrix.Diagonal((w, d, h, 1)), verts=verts)
        bevel = min(bevel, min(size) * 0.45)
        if bevel > 0:
            edges = list({e for v in verts for e in v.link_edges})
            result = bmesh.ops.bevel(self.bm, geom=verts + edges, offset=bevel, segments=1, affect="EDGES", profile=0.5)
            verts = list({v for f in result["faces"] for v in f.verts} | {v for v in verts if v.is_valid})
        self._place(verts, center, rot)
        self._paint(verts, color)
        return self

    def prism(self, radius, height, center=(0, 0, 0), color=None, sides=8, top_radius=None, rot=(0, 0, 0)):
        """An upright n-sided prism or frustum (posts, trunks, pots), centered on `center`."""
        verts = bmesh.ops.create_cone(
            self.bm,
            cap_ends=True,
            segments=sides,
            radius1=radius,
            radius2=radius if top_radius is None else top_radius,
            depth=height,
        )["verts"]
        self._place(verts, center, rot)
        self._paint(verts, color)
        return self

    def blob(self, radius, center=(0, 0, 0), color=None, squash=1.0, rot=(0, 0, 0)):
        """A faceted low-poly ball (tree canopies, bushes)."""
        verts = bmesh.ops.create_icosphere(self.bm, subdivisions=1, radius=radius)["verts"]
        self._place(verts, center, rot, (1, squash, 1))
        self._paint(verts, color)
        return self

    def strip(self, rows, y, color):
        """A flat ribbon at height `y`, facing up: `rows` are (x0, x1, z) cross-sections, in order along z.

        For shapes that follow a curve (a shoreline, a band of foam), which boxes can only staircase.
        """
        edges = [(self.bm.verts.new(to_blender(x0, y, z)), self.bm.verts.new(to_blender(x1, y, z))) for x0, x1, z in rows]
        faces = []
        for (a0, a1), (b0, b1) in zip(edges, edges[1:]):
            f = self.bm.faces.new((a0, a1, b1, b0))
            f.normal_update()
            if f.normal.z < 0:
                f.normal_flip()
            faces.append(f)
        for f in faces:
            f[self.layer] = self.names.index(color)
        return self

    def build(self, name):
        """Finishes the mesh as a Blender object with flat faces and a face-corner color attribute."""
        mesh = bpy.data.meshes.new(name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        colors = mesh.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
        region = mesh.attributes.new("_region", "FLOAT", "POINT") if self.regions else None
        face_color = mesh.attributes["color"].data
        for poly in mesh.polygons:
            index = face_color[poly.index].value
            rgba = linear(self.colors[self.names[index]])
            for li in poly.loop_indices:
                colors.data[li].color = rgba
            if region:
                for vi in poly.vertices:
                    region.data[vi].value = index
        mesh.attributes.remove(mesh.attributes["color"])
        mesh.color_attributes.active_color = colors
        for poly in mesh.polygons:
            poly.use_smooth = False
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def turned(x, z):
    """(x, z) and its partner under the 180-degree End switch."""
    return ((x, z), (-x, -z))


def check_footprints(footprints, gap=0.3, may_overlap=()):
    """Fails the build if two props' footprints (name, x, z, half width, half depth) come within `gap` of each
    other. `may_overlap` lists pairs of names that are allowed to, such as a high canopy over a low prop."""
    allowed = {frozenset(pair) for pair in may_overlap}
    for i, (name, x, z, hw, hd) in enumerate(footprints):
        for other, ox, oz, ohw, ohd in footprints[i + 1 :]:
            if frozenset((name, other)) in allowed:
                continue
            if abs(x - ox) < hw + ohw + gap and abs(z - oz) < hd + ohd + gap:
                raise RuntimeError(f"{name} at ({x:.2f}, {z:.2f}) overlaps {other} at ({ox:.2f}, {oz:.2f})")


def triangles(objects):
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objects)


def _setup_render(size, background):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "VERTEX"
    shading.show_shadows = False
    shading.show_cavity = False
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("World")
    world.color = linear(background)[:3]
    scene.world = world
    scene.render.image_settings.file_format = "PNG"
    return scene


def _render(name, scene, eye, target, fov, triangle_count):
    """Renders from `eye` toward `target` (Blender space); `fov` is vertical, in degrees, like three.js."""
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.sensor_fit = "VERTICAL"
    cam_data.angle = math.radians(fov)
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = eye
    cam.rotation_euler = (target - eye).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    os.makedirs(PREVIEWS, exist_ok=True)
    scene.render.filepath = os.path.join(PREVIEWS, f"{name}.png")
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam)
    print(f"[art] preview {name}: {triangle_count} triangles -> {scene.render.filepath}")


def preview(name, objects, direction=(1.0, 0.8, 1.2), fov=35, size=(900, 700), background="#8fd3ff"):
    """Renders a workbench view (vertex colors, studio light) of `objects` to art/previews/<name>.png.

    This is the check before export: the image is what the viewport shows, from the given three.js direction,
    framed on the objects.
    """
    scene = _setup_render(size, background)
    points = [o.matrix_world @ Vector(c) for o in objects for c in o.bound_box]
    lo = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    hi = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    center = (lo + hi) / 2
    radius = (hi - lo).length / 2
    d = to_blender(*direction).normalized()
    eye = center + d * (radius / math.sin(math.radians(fov) / 2)) * 1.2
    _render(name, scene, eye, center, fov, triangles(objects))


def preview_from(name, objects, eye, target, fov, size=(1280, 720), background="#8fd3ff"):
    """Like `preview`, from a fixed three.js camera (`eye` looking at `target`), e.g. the game camera."""
    scene = _setup_render(size, background)
    _render(name, scene, to_blender(*eye), to_blender(*target), fov, triangles(objects))


def export(name, objects):
    """Exports `objects` to art/models/<name>.glb with vertex colors and `_region` attributes."""
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    os.makedirs(MODELS, exist_ok=True)
    path = os.path.join(MODELS, f"{name}.glb")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_normals=False,
        export_attributes=True,
        export_vertex_color="ACTIVE",
        export_active_vertex_color_when_no_material=True,
        export_materials="NONE",
        export_extras=False,
    )
    print(f"[art] export {name}: {os.path.getsize(path)} bytes -> {path}")
