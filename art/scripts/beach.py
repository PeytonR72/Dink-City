"""The Beach Venue's surroundings: sand, the sea along one side, palms, striped beach huts, umbrellas and towels,
a lifeguard tower and a rope fence -> art/models/beach.glb (one mesh, so one draw call).

The court sits at the origin (see court.py). The renderer turns the world 180 degrees when Ends switch, so the
far end of each half carries the same kinds of props (the huts, palms and umbrellas come in turned pairs). The
sea runs along -x; from the other End it's on the right, as it would be. The game camera sees the ground from
about z = -17 to z = +8.
"""
import math
import random
import sys

sys.path.insert(0, __import__("os").path.dirname(__file__))
import os  # noqa: E402

import bpy  # noqa: E402
from lib import MODELS, PALETTE, Builder, export, preview_from, reset  # noqa: E402

COLORS = PALETTE["beach"]
rng = random.Random(2028)
FENCE_X = 6.45
FENCE_Z = 10.5
SHORE_X = -11.5


def turned(x, z):
    """(x, z) and its partner under the 180-degree End switch."""
    return ((x, z), (-x, -z))


def shore(z):
    """The waterline's x at z: a gentle curve."""
    return SHORE_X - 1.2 * math.sin(z / 9.0) - 0.6 * math.cos(z / 4.0)


def palm(b, x, z, scale=1.0, lean=0.0):
    """A curved trunk of stacked segments and a crown of drooping fronds."""
    segs = 7
    h = 0.62 * scale
    px, py = x, 0.0
    for i in range(segs):
        bend = lean * (i / segs) ** 1.5
        cx = x + bend
        b.prism(0.2 * scale * (1 - i * 0.06), h, (cx, py + h / 2, z), "trunk", sides=6, top_radius=0.17 * scale * (1 - i * 0.06))
        px, py = cx, py + h * 0.96
    for k in range(7):
        a = k / 7 * math.tau + rng.random() * 0.4
        dx, dz = math.cos(a), math.sin(a)
        for j, (r, drop) in enumerate(((0.55, 0.0), (1.15, -0.25), (1.7, -0.7))):
            b.box((0.5 * scale, 0.07, 0.75 * scale), (px + dx * r * scale, py + drop * scale, z + dz * r * scale),
                  "palm" if (k + j) % 2 else "palmLight", 0, rot=(0.35 + j * 0.3, -a + math.pi / 2, 0))
    b.blob(0.25 * scale, (px, py - 0.1, z), "woodDark", squash=0.9)


def hut(b, x, z, color_stripe):
    """A striped wooden beach hut with a pointed roof, its door toward the court."""
    b.box((2.0, 2.3, 1.8), (x, 1.15, z), "hut", 0.04)
    for y in (0.5, 1.1, 1.7):
        b.box((2.04, 0.22, 1.84), (x, y, z), color_stripe, 0)
    b.prism(1.55, 1.1, (x, 2.85, z), "hutRoof", sides=4, top_radius=0.05, rot=(0, math.pi / 4, 0))
    door_z = z + (0.92 if z < 0 else -0.92)
    b.box((0.8, 1.6, 0.06), (x, 0.8, door_z), "woodDark", 0.02)
    b.box((2.2, 0.15, 0.8), (x, 0.08, door_z + (0.45 if z < 0 else -0.45)), "wood", 0.02)


def umbrella(b, x, z, color):
    b.prism(0.04, 2.1, (x, 1.05, z), "hut", sides=6)
    b.prism(1.15, 0.45, (x, 2.1, z), color, sides=8, top_radius=0.06)
    b.prism(1.16, 0.06, (x, 1.88, z), "hut", sides=8)


def towel(b, x, z, color, angle):
    b.box((0.9, 0.02, 1.8), (x, 0.01, z), color, 0, rot=(0, angle, 0))
    b.box((0.9, 0.025, 0.25), (x, 0.012, z), "hut", 0, rot=(0, angle, 0))


def lifeguard_tower(b, x, z):
    for dx, dz in ((-0.7, -0.7), (0.7, -0.7), (-0.7, 0.7), (0.7, 0.7)):
        b.box((0.14, 2.4, 0.14), (x + dx, 1.2, z + dz), "wood", 0.02)
    b.box((1.9, 0.15, 1.9), (x, 2.45, z), "wood", 0.02)
    b.box((1.7, 1.2, 1.6), (x, 3.1, z), "hut", 0.04)
    b.box((1.72, 0.25, 1.62), (x, 3.3, z), "umbrellaB", 0)
    b.prism(1.5, 0.5, (x, 3.95, z), "umbrellaB", sides=4, top_radius=0.1, rot=(0, math.pi / 4, 0))
    b.box((0.7, 0.08, 1.8), (x + 1.2, 1.2, z), "wood", 0.02, rot=(0, 0, -0.9))


def rope_fence(b, x0, z0, x1, z1):
    """Wooden posts with a sagging rope between each pair."""
    length = math.hypot(x1 - x0, z1 - z0)
    posts = max(1, round(length / 2.1))
    angle = math.atan2(x1 - x0, z1 - z0)
    for i in range(posts + 1):
        u = i / posts
        b.prism(0.07, 0.9, (x0 + (x1 - x0) * u, 0.45, z0 + (z1 - z0) * u), "woodDark", sides=6)
    for i in range(posts):
        for half in (0, 1):
            u = (i + 0.25 + half * 0.5) / posts
            b.box((0.035, 0.035, length / posts / 2), (x0 + (x1 - x0) * u, 0.74, z0 + (z1 - z0) * u), "rope", 0,
                  rot=((-1 if half == 0 else 1) * 0.12, angle, 0))


def rock(b, x, z, scale):
    b.blob(0.6 * scale, (x, 0.15 * scale, z), "rock", squash=0.6, rot=(0, rng.random() * 6, 0))
    b.blob(0.4 * scale, (x + 0.4 * scale, 0.1 * scale, z + 0.2 * scale), "rockDark", squash=0.6)


def band(b, inner, outer, y, color):
    """A strip of sea or sand between two offsets from the waterline (functions of z; + is toward the land)."""
    rows = [(shore(z) + outer(z), shore(z) + inner(z), z) for z in SHORE_ZS]
    b.strip(rows, y, color)


def crest(b, z0, length, offset):
    """A low wave crest out on the water: a thin curved band of foam, parallel to the shore, tapered at the ends."""
    n = max(2, round(length / 0.25))
    rows = []
    for i in range(n + 1):
        u = i / n
        z = z0 + length * u
        w = 0.03 + 0.2 * math.sin(math.pi * u)
        x = shore(z) - offset
        rows.append((x - w / 2, x + w / 2, z))
    b.strip(rows, 0.006, "foam")


# The shoreline is drawn out to well past what the camera sees, every half meter.
SHORE_ZS = [-60 + 0.5 * i for i in range(241)]
# Where each band of sea ends, from the waterline out. Each edge wobbles on its own, so no two run parallel.
WET_EDGE = lambda z: 1.2 + 0.35 * math.sin(z / 2.3) + 0.2 * math.sin(z / 5.1 + 1)  # noqa: E731
SHALLOW_EDGE = lambda z: -2.4 - 0.5 * math.sin(z / 3.7 + 0.5)  # noqa: E731
SEA_EDGE = lambda z: -6.5 - 0.9 * math.sin(z / 6.3 + 2)  # noqa: E731
MID_EDGE = lambda z: -12.0 - 1.2 * math.sin(z / 8.1 + 1)  # noqa: E731
WASH_EDGE = lambda z: -0.3 - 0.2 * math.sin(z * 0.9)  # noqa: E731


def build():
    b = Builder(COLORS)
    # Sand, with the sea along -x.
    b.box((160, 0.02, 160), (0, -0.013, 0), "sand", 0)
    for _ in range(36):
        x = rng.uniform(-8, 25)
        z = rng.uniform(13.5, 24)
        for tx, tz in turned(x, z):
            if tx > shore(tz) + 1.5:
                b.box((rng.uniform(1.2, 3.5), 0.01, rng.uniform(1.2, 3.5)), (tx, -0.002, tz), "sandDark", 0, rot=(0, rng.random(), 0))
    # The sea in bands that follow the shoreline: wet sand, a wash of foam at the waterline, then the shallows
    # darkening through two blues to deep water out to the horizon.
    band(b, WET_EDGE, lambda z: 0.0, 0.001, "sandWet")
    band(b, lambda z: 0.0, SHALLOW_EDGE, 0.003, "seaShallow")
    band(b, SHALLOW_EDGE, SEA_EDGE, 0.003, "sea")
    band(b, SEA_EDGE, MID_EDGE, 0.003, "seaMid")
    band(b, MID_EDGE, lambda z: -140.0 - shore(z), 0.003, "seaDeep")
    band(b, lambda z: 0.12, WASH_EDGE, 0.005, "foam")
    for _ in range(18):
        fz = rng.uniform(-30, 30)
        length = rng.uniform(1.5, 3.5) * 1.6
        crest(b, fz - length / 2, length, rng.uniform(3, 14))

    # The rope fence around the court, and a strip of beach grass on the land side.
    for s in (-1, 1):
        rope_fence(b, s * FENCE_X, -FENCE_Z, s * FENCE_X, FENCE_Z)
        rope_fence(b, -FENCE_X, s * FENCE_Z, FENCE_X, s * FENCE_Z)
    for tx, tz in turned(9.0, -2.0):
        for k in range(10):
            b.box((0.08, 0.5, 0.08), (tx + rng.uniform(-1.4, 1.4), 0.25, tz + rng.uniform(-5, 5)), "grass", 0, rot=(rng.uniform(-0.3, 0.3), 0, rng.uniform(-0.3, 0.3)))

    # A boardwalk along +x, huts behind each end, palms, umbrellas and towels, rocks and a lifeguard tower.
    b.box((2.2, 0.12, 80), (13.0, 0.06, 0), "wood", 0.02)
    for i in range(-20, 21):
        b.box((2.2, 0.02, 0.05), (13.0, 0.125, i * 2.0), "woodDark", 0)
    for i, x in enumerate((-4.5, -1.5, 1.5, 4.5, 7.5)):
        for tx, tz in turned(x, -14.2):
            hut(b, tx, tz, ("hutStripe", "umbrellaA", "umbrellaB", "hutStripe", "towelB")[i])
    for x, z, sc, lean in ((9.2, -12.0, 1.1, 0.8), (10.8, -7.5, 1.0, -0.6), (9.0, 1.5, 1.2, 0.9), (-8.8, -12.5, 1.0, -0.9),
                           (11.2, -16.5, 1.2, 0.5), (-9.3, 5.5, 0.9, -0.7), (15.5, -10.0, 1.3, 0.6), (16.0, 4.0, 1.1, -0.5)):
        for tx, tz in turned(x, z):
            palm(b, tx, tz, sc, lean if tx > 0 else -lean)
    for (x, z, c, t) in ((-9.0, -8.0, "umbrellaA", "towelA"), (-8.2, -3.0, "umbrellaC", "towelB"), (-9.6, 1.0, "umbrellaB", "towelA"),
                         (8.8, -4.5, "umbrellaC", "towelB")):
        for tx, tz in turned(x, z):
            umbrella(b, tx, tz, c)
            towel(b, tx + (0.9 if tx > 0 else -0.9), tz + 0.6, t, rng.uniform(-0.3, 0.3))
    # By the sea at both ends (not turned: the sea is only on one side).
    for z in (-16.5, 12.0):
        lifeguard_tower(b, shore(z) + 1.8, z)
    for x, z, sc in ((-12.5, -6.0, 1.0), (-13.4, 8.0, 1.3), (-14.0, -20.0, 1.5), (-12.0, 18.0, 1.1)):
        rock(b, shore(z) + 0.5 + (x - SHORE_X) * 0.1, z, sc)
    return [b.build("beach")]


reset()
objects = build()
# The check: the whole Venue from the game camera (see viewTuning in src/tuning.ts), with the court and net.
for other in ("court", "equipment"):
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, f"{other}.glb"))
venue = [o for o in bpy.context.scene.objects if o.type == "MESH"]
preview_from("beach", venue, eye=(0, 15.5, 20), target=(0, 0, 1.25), fov=33, background="#7fd6f5")
preview_from("beach-wide", venue, eye=(0, 30, 34), target=(0, 0, -2), fov=40, background="#7fd6f5")
export("beach", objects)
