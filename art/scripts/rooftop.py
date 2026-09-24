"""The Rooftop Venue's surroundings: a roof deck with a parapet, a chain-link fence, water tanks, AC units, a
stair hut and planters, over a city skyline -> art/models/rooftop.glb (one mesh, so one draw call).

The court sits at the origin (see court.py). The renderer turns the world 180 degrees when Ends switch, so
the layout is symmetric under that turn: each prop at (x, z) has a partner at (-x, -z), so the Rooftop looks
alike from either End. The game camera sees the ground from about z = -17 to z = +8, and the skyline beyond.
"""
import math
import random
import sys

sys.path.insert(0, __import__("os").path.dirname(__file__))
import os  # noqa: E402

import bpy  # noqa: E402
from lib import MODELS, PALETTE, Builder, export, preview_from, reset  # noqa: E402

COLORS = PALETTE["rooftop"]
rng = random.Random(2027)
DECK_X = 12.5
DECK_Z = 17.5
FENCE_X = 6.45
FENCE_Z = 10.5
STREET_Y = -40.0
TOWERS = ("tower1", "tower2", "tower3", "tower4", "tower5", "brick")


def turned(x, z):
    """(x, z) and its partner under the 180-degree End switch."""
    return ((x, z), (-x, -z))


def chain_link(b, x0, z0, x1, z1, height=2.6):
    """A chain-link fence from (x0, z0) to (x1, z1): posts, rails and a grid of thin wires."""
    length = math.hypot(x1 - x0, z1 - z0)
    angle = math.atan2(x1 - x0, z1 - z0)
    mx, mz = (x0 + x1) / 2, (z0 + z1) / 2
    posts = max(1, round(length / 2.5))
    for i in range(posts + 1):
        u = i / posts
        b.box((0.09, height, 0.09), (x0 + (x1 - x0) * u, height / 2, z0 + (z1 - z0) * u), "fenceDark", 0.015)
    for y in (0.08, height * 0.5, height - 0.04):
        b.box((0.05, 0.05, length), (mx, y, mz), "fenceDark", 0, rot=(0, angle, 0))
    wires = int(length / 0.6)
    for i in range(1, wires):
        u = i / wires
        b.box((0.018, height - 0.1, 0.018), (x0 + (x1 - x0) * u, height / 2, z0 + (z1 - z0) * u), "fence", 0)
    for k in (1, 2, 4, 5):
        b.box((0.015, 0.015, length), (mx, height * k / 6, mz), "fence", 0, rot=(0, angle, 0))


def water_tank(b, x, z, scale=1.0, base=0.0):
    """The classic wooden tank on steel legs, standing at height `base`."""
    leg_h = 2.2 * scale
    for dx, dz in ((-0.8, -0.8), (0.8, -0.8), (-0.8, 0.8), (0.8, 0.8)):
        b.box((0.12, leg_h, 0.12), (x + dx * scale, base + leg_h / 2, z + dz * scale), "metal", 0.02)
    b.box((1.9 * scale, 0.1, 1.9 * scale), (x, base + leg_h, z), "metal", 0.02)
    b.prism(1.15 * scale, 2.2 * scale, (x, base + leg_h + 1.15 * scale, z), "tank", sides=10)
    for y in (0.5, 1.2, 1.9):
        b.prism(1.18 * scale, 0.08, (x, base + leg_h + y * scale, z), "metal", sides=10)
    b.prism(1.25 * scale, 0.9 * scale, (x, base + leg_h + 2.7 * scale, z), "tankRoof", sides=10, top_radius=0.08)


def ac_unit(b, x, z, rot=0.0):
    b.box((1.6, 1.0, 1.1), (x, 0.5, z), "ac", 0.05, rot=(0, rot, 0))
    b.prism(0.36, 0.06, (x, 1.02, z), "acDark", sides=10)
    b.box((1.62, 0.12, 1.12), (x, 0.06, z), "acDark", 0.02, rot=(0, rot, 0))


def planter(b, x, z, w=1.8):
    b.box((w, 0.55, 0.7), (x, 0.275, z), "pot", 0.05)
    for i in range(3):
        b.blob(0.38, (x + (i - 1) * w / 3.2, 0.72, z), "plant" if i % 2 else "plantLight", squash=0.8, rot=(0, rng.random() * 6, 0))


def stair_hut(b, x, z):
    b.box((3.2, 2.7, 2.4), (x, 1.35, z), "brick", 0.05)
    b.box((3.5, 0.2, 2.7), (x, 2.8, z), "brickDark", 0.04)
    b.box((0.95, 2.0, 0.08), (x, 1.0, z + (1.22 if z < 0 else -1.22)), "metal", 0.02)
    b.prism(0.12, 1.2, (x + 1.0, 3.5, z), "metal", sides=6)


def vent(b, x, z):
    b.prism(0.22, 0.9, (x, 0.45, z), "acDark", sides=8)
    b.prism(0.34, 0.2, (x, 0.95, z), "metal", sides=8)


def tower(b, x, z, w, d, top, color):
    """A skyline building rising from the street to `top`, with window bands and a roof cap."""
    h = top - STREET_Y
    b.box((w, h, d), (x, STREET_Y + h / 2, z), color, 0)
    band = 1.6
    y = top - 1.2
    for _ in range(5):
        b.box((w + 0.06, 0.55, d + 0.06), (x, y, z), "glassDark" if rng.random() < 0.3 else "glass", 0)
        y -= band
    b.box((w + 0.3, 0.3, d + 0.3), (x, top + 0.15, z), "parapet", 0)
    if rng.random() < 0.45:
        water_tank(b, x + rng.uniform(-w / 4, w / 4), z + rng.uniform(-d / 4, d / 4), 0.8, top + 0.3)


def build():
    b = Builder(COLORS)
    b.box((400, 0.02, 400), (0, STREET_Y, 0), "street", 0)
    # The deck: tiles in a checker, a darker band around the court, and a parapet at the edge.
    b.box((DECK_X * 2, 0.4, DECK_Z * 2), (0, -0.215, 0), "deck", 0)
    b.box((DECK_X * 2 - 0.2, 60, DECK_Z * 2 - 0.2), (0, -30.4, 0), "tower1", 0)
    for ix in range(-6, 6):
        for iz in range(-9, 9):
            if (ix + iz) % 2 == 0:
                b.box((1.98, 0.01, 1.98), (ix * 2 + 1, -0.009, iz * 2 + 1), "tile", 0)
    for s in (-1, 1):
        b.box((0.35, 0.9, DECK_Z * 2 + 0.35), (s * DECK_X, 0.45, 0), "parapet", 0.05)
        b.box((DECK_X * 2 + 0.35, 0.9, 0.35), (0, 0.45, s * DECK_Z), "parapet", 0.05)
    # The fence around the court.
    for s in (-1, 1):
        chain_link(b, s * FENCE_X, -FENCE_Z, s * FENCE_X, FENCE_Z)
        chain_link(b, -FENCE_X, s * FENCE_Z, FENCE_X, s * FENCE_Z, height=2.0)
    # Props, each with its turned partner.
    for x, z in turned(-10.0, -13.0):
        water_tank(b, x, z, 1.1)
    for x, z in turned(9.6, -14.2):
        stair_hut(b, x, z)
    for x, z in turned(-9.5, -4.0):
        ac_unit(b, x, z, 0.1)
    for x, z in turned(-9.5, -1.2):
        ac_unit(b, x, z, -0.05)
    for x, z in turned(9.8, 3.5):
        ac_unit(b, x, z)
    for x, z in turned(-4.0, -12.6):
        planter(b, x, z)
    for x, z in turned(1.5, -12.6):
        planter(b, x, z)
    for x, z in turned(5.8, -15.8):
        planter(b, x, z, 2.4)
    for x, z in turned(-6.5, -15.6):
        vent(b, x, z)
    for x, z in turned(-7.4, -15.9):
        vent(b, x, z)
    for x, z in turned(8.3, 9.0):
        vent(b, x, z)
    for x, z in turned(-11.3, 8.0):
        b.prism(0.06, 5.0, (x, 2.5, z), "metal", sides=6)
        b.box((0.03, 0.9, 1.4), (x, 4.5, z + 0.7), "flag", 0)
    # Lights on poles at the fence corners.
    for x, z in ((FENCE_X, FENCE_Z), (-FENCE_X, FENCE_Z), (FENCE_X, -FENCE_Z), (-FENCE_X, -FENCE_Z)):
        b.prism(0.07, 4.2, (x, 2.1, z), "metal", sides=6)
        b.box((0.5, 0.3, 0.4), (x, 4.3, z), "light", 0.04)

    # The skyline, in turned pairs again: nearby roofs below the deck (you look down on them), taller towers
    # further out.
    for ring, (reach, lo, hi) in enumerate(((22, -14, -4), (34, -6, 10), (50, 4, 28))):
        for k in range(8 + ring * 3):
            a = (k + rng.random() * 0.6) / (8 + ring * 3) * math.pi
            x = math.cos(a) * reach * 0.8 + rng.uniform(-3, 3)
            z = -math.sin(a) * reach - rng.uniform(0, 4)
            if abs(x) < DECK_X + 4 and abs(z) < DECK_Z + 4:
                continue
            w, d = rng.uniform(5, 9), rng.uniform(5, 9)
            top = rng.uniform(lo, hi)
            color = rng.choice(TOWERS)
            for tx, tz in turned(x, z):
                tower(b, tx, tz, w, d, top, color)
    return [b.build("rooftop")]


reset()
objects = build()
# The check: the whole Venue from the game camera (see viewTuning in src/tuning.ts), with the court and net.
for other in ("court", "equipment"):
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, f"{other}.glb"))
venue = [o for o in bpy.context.scene.objects if o.type == "MESH"]
preview_from("rooftop", venue, eye=(0, 15.5, 20), target=(0, 0, 1.25), fov=33, background="#9cc8ec")
preview_from("rooftop-wide", venue, eye=(0, 30, 34), target=(0, 0, -2), fov=40, background="#9cc8ec")
export("rooftop", objects)
