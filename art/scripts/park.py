"""The Park Venue's surroundings: grass, paths, fences, benches, lamps, trees, bushes, flowers and a fountain
-> art/models/park.glb (one mesh, so one draw call).

The court sits at the origin (see court.py). The renderer turns the world 180 degrees when Ends switch, so
the layout mirrors z: each prop at z has a partner of the same kind near -z, so the Park looks alike from either End. The game camera sees
the ground from about z = -17 to z = +8, so the far end carries the most detail.
"""
import math
import random
import sys

sys.path.insert(0, __import__("os").path.dirname(__file__))
import os  # noqa: E402

import bpy  # noqa: E402
from lib import MODELS, PALETTE, Builder, export, preview_from, reset  # noqa: E402

COLORS = PALETTE["park"]
rng = random.Random(2026)
FENCE_X = 6.45
PATH_X = 8.4


def mirrored(z):
    return (z, -z) if abs(z) > 1e-6 else (z,)


def round_tree(b, x, z, scale, leaf):
    h = 1.3 * scale
    b.prism(0.16 * scale, h, (x, h / 2, z), "trunk", sides=6, top_radius=0.12 * scale)
    b.blob(0.95 * scale, (x, h + 0.7 * scale, z), leaf, squash=0.85, rot=(0, rng.random() * 6, 0))
    b.blob(0.65 * scale, (x + 0.45 * scale, h + 0.35 * scale, z + 0.2 * scale), leaf, squash=0.85)
    b.blob(0.55 * scale, (x - 0.35 * scale, h + 1.25 * scale, z - 0.15 * scale), "leafLight", squash=0.9)


def pine(b, x, z, scale):
    b.prism(0.13 * scale, 0.8 * scale, (x, 0.4 * scale, z), "trunk", sides=6)
    for i, (r, y) in enumerate(((1.0, 1.2), (0.78, 1.95), (0.52, 2.6))):
        b.prism(r * scale, 0.9 * scale, (x, y * scale, z), "leaf" if i % 2 == 0 else "bush", sides=7, top_radius=0.12 * scale, rot=(0, rng.random(), 0))


def bush(b, x, z, scale):
    b.blob(0.45 * scale, (x, 0.3 * scale, z), "bush", squash=0.75, rot=(0, rng.random() * 6, 0))
    b.blob(0.32 * scale, (x + 0.35 * scale, 0.22 * scale, z + 0.1), "leaf", squash=0.75)


def bench(b, x, z, facing):
    """A park bench whose seat faces `facing` (+1 or -1 along x)."""
    b.box((0.5, 0.07, 1.6), (x, 0.45, z), "bench", 0.02)
    b.box((0.08, 0.4, 1.6), (x - facing * 0.24, 0.72, z), "bench", 0.02)
    for dz in (-0.65, 0.65):
        b.box((0.45, 0.42, 0.07), (x, 0.21, z + dz), "metal", 0.015)


def lamp(b, x, z):
    b.box((0.3, 0.12, 0.3), (x, 0.06, z), "metal", 0.02)
    b.prism(0.05, 3.2, (x, 1.7, z), "metal", sides=6)
    b.box((0.32, 0.36, 0.32), (x, 3.4, z), "lamp", 0.04)
    b.box((0.42, 0.08, 0.42), (x, 3.62, z), "metal", 0.02)


def fence(b, x, z0, z1):
    """A low fence along z at `x`: posts and two rails."""
    n = max(1, round((z1 - z0) / 1.6))
    for i in range(n + 1):
        b.box((0.08, 1.1, 0.08), (x, 0.55, z0 + (z1 - z0) * i / n), "fence", 0.015)
    for y in (0.45, 0.95):
        b.box((0.05, 0.06, z1 - z0), (x, y, (z0 + z1) / 2), "fence", 0.01)


def flower_bed(b, x, z, w, d):
    b.box((w, 0.18, d), (x, 0.09, z), "stone", 0.03)
    b.box((w - 0.16, 0.06, d - 0.16), (x, 0.18, z), "trunk", 0)
    for _ in range(int(w * d * 5)):
        fx = x + (rng.random() - 0.5) * (w - 0.3)
        fz = z + (rng.random() - 0.5) * (d - 0.3)
        b.box((0.12, 0.12, 0.12), (fx, 0.27, fz), rng.choice(("flowerPink", "flowerYellow", "leafLight")), 0.03)


def fountain(b, x, z):
    b.prism(1.4, 0.4, (x, 0.2, z), "stone", sides=10)
    b.prism(1.2, 0.05, (x, 0.38, z), "water", sides=10)
    b.prism(0.25, 1.0, (x, 0.7, z), "stone", sides=8)
    b.prism(0.55, 0.14, (x, 1.2, z), "stone", sides=8)
    b.blob(0.22, (x, 1.35, z), "water", squash=1.4)


def build():
    b = Builder(COLORS)
    b.box((120, 0.02, 120), (0, -0.013, 0), "grass", 0)
    for _ in range(40):
        x = rng.uniform(-25, 25)
        z = rng.uniform(11.5, 22)
        for zz in mirrored(z):
            b.box((rng.uniform(1.5, 4), 0.01, rng.uniform(1.5, 4)), (x, -0.002, zz), "grassDark", 0, rot=(0, rng.random(), 0))
    for s in (-1, 1):
        b.box((1.6, 0.01, 60), (s * PATH_X, -0.001, 0), "path", 0)
        fence(b, s * FENCE_X, -10.5, 10.5)
        for z in mirrored(5.0):
            bench(b, s * 7.4, z, -s)
        for z in mirrored(10.2):
            lamp(b, s * 7.2, z)
        for z in (-8.5, -3.2, 3.2, 8.5):
            bush(b, s * 6.95, z, rng.uniform(0.7, 1.0))
    # A path across the far (and near) end, with flower beds and bushes behind the court.
    for z in mirrored(12.6):
        b.box((18, 0.01, 1.4), (0, -0.0015, z), "path", 0)
    for z in mirrored(14.2):
        flower_bed(b, -4.2, z, 2.6, 1.2)
        flower_bed(b, 4.2, z, 2.6, 1.2)
    for z in mirrored(11.4):
        for x in (-5.2, -2.2, 2.4, 5.4):
            bush(b, x, z, rng.uniform(0.6, 0.85))

    # Trees: rows along both sides, and a band beyond each end.
    for s in (-1, 1):
        for z in range(-20, 21, 3):
            x = s * rng.uniform(10.0, 11.5)
            kind = rng.random()
            zz = z + rng.uniform(-0.8, 0.8)
            if kind < 0.55:
                round_tree(b, x, zz, rng.uniform(0.9, 1.25), "leafWarm" if rng.random() < 0.2 else "leaf")
            else:
                pine(b, x, zz, rng.uniform(0.9, 1.3))
        for z in range(-19, 20, 4):
            x = s * rng.uniform(13.5, 16.5)
            round_tree(b, x, z + rng.uniform(-1, 1), rng.uniform(1.0, 1.4), "leaf")
    for x in range(-8, 9, 3):
        for z in mirrored(rng.uniform(16.2, 17.5)):
            if rng.random() < 0.5:
                pine(b, x + rng.uniform(-0.6, 0.6), z, rng.uniform(1.0, 1.4))
            else:
                round_tree(b, x + rng.uniform(-0.6, 0.6), z, rng.uniform(1.0, 1.3), "leaf")
    fountain(b, -13.0, 0.0)
    for z in mirrored(2.4):
        bench(b, -11.0, z, 1)
    return [b.build("park")]


reset()
objects = build()
# The check: the whole Venue from the game camera (see viewTuning in src/tuning.ts), with the court and net.
for other in ("court", "equipment"):
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, f"{other}.glb"))
venue = [o for o in bpy.context.scene.objects if o.type == "MESH"]
preview_from("park", venue, eye=(0, 15.5, 20), target=(0, 0, 1.25), fov=33)
preview_from("park-wide", venue, eye=(0, 30, 34), target=(0, 0, -2), fov=40)
export("park", objects)
