"""The Dink City map: a tabletop diorama of the city with the three Venues in miniature -> art/models/map.glb.

Kenney's City Kit buildings fill the city (see art/vendor/kenney/), along roads built here in the colors of Kenney's
road tiles, which end in turning circles at the Park and the Beach. The Venues are built with their own scripts'
helpers: the Park's trees, the Rooftop's chain-link fence and AC units, the Beach's palms and umbrellas.
Everything is authored in meters, like the Venues, and shrunk 1:10 on export, so the board is 14 x 8 units.

Three meshes, so the game can animate two of them cheaply (see src/menu/mapView.ts): `map` (everything still),
`sway` (the trees and palms, which sway from the ground up) and `water` (the sea, which ripples). The empties
`pin_park`, `pin_rooftop` and `pin_beach` mark where each Venue's pin points.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import bpy  # noqa: E402
from mathutils import Matrix  # noqa: E402

import beach  # noqa: E402
import court  # noqa: E402
import park  # noqa: E402
import rooftop  # noqa: E402
from lib import ART, PALETTE, Builder, export, linear, preview_from, reset, to_blender  # noqa: E402

KENNEY = os.path.join(ART, "vendor", "kenney")
SCALE = 0.1
BOARD_X = 70.0
# The board runs from z = BACK (behind the city) to z = FRONT (the lawn's front edge).
BACK = -40.0
FRONT = 30.0
MID_Z = (BACK + FRONT) / 2
DEPTH_Z = FRONT - BACK
BOARD_DEPTH = 5.0
# Where each Venue's court sits (the center of the court, in meters), and the Rooftop's roof.
PARK = (-51.0, 14.0)
ROOFTOP = (3.0, -21.0)
ROOF_TOP = 18.0
BEACH = (47.0, 12.0)
# The zones: the Park on the left, the Beach and the sea on the right, the city between, a lawn in front of it.
CITY_X = (-32.0, 38.0)
AVENUE_Z = 8.0
STREETS_X = (-17.0, 23.0)
# A road's half widths: its sidewalk's outer edge, its gutter's, its asphalt's. Each end of the avenue is a turning
# circle whose sidewalk meets the city's edge.
ROAD = (4.0, 3.0, 2.4)
TURN = (5.0, 4.0, 3.4)
AVENUE_ENDS = (CITY_X[0] + TURN[0], CITY_X[1] - TURN[0])
LAWN_Z = AVENUE_Z + ROAD[0]
# The boardwalk between the city and the sand.
BOARDWALK_X = (CITY_X[1], CITY_X[1] + 2.0)
GROUND = 0.07
# The sea's surface: high enough that its swell (up to 0.08 either way, see src/menu/mapView.ts) never shows the
# board under it.
SEA_Y = 0.12


def shore(z):
    """The waterline's x at z."""
    return 56.0 + 1.8 * math.sin(z / 10.0) + 0.9 * math.cos(z / 5.0)


def place(obj, x=0.0, y=0.0, z=0.0, turns=0):
    """Moves an object's mesh by (x, y, z), turned `turns` quarter turns about y first."""
    obj.data.transform(Matrix.Translation(to_blender(x, y, z)) @ Matrix.Rotation(turns * math.pi / 2, 4, "Z"))
    return obj


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


_atlases = {}


def atlas(image):
    """An image's pixels, read once."""
    if image.name not in _atlases:
        _atlases[image.name] = (image.size[0], image.size[1], image.pixels[:])
    return _atlases[image.name]


def kenney(path, x, z, turns=0, scale=10.0, colors=None):
    """Imports a Kenney model at (x, z), scaled to meters, with its colors baked into face-corner vertex colors:
    from the texture atlas at each corner's UV, or for plain materials, from `colors` (material name -> hex)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(KENNEY, path))
    new = [o for o in bpy.data.objects if o not in before]
    at = Matrix.Translation(to_blender(x, 0, z)) @ Matrix.Rotation(turns * math.pi / 2, 4, "Z") @ Matrix.Scale(scale, 4)
    meshes = []
    for o in new:
        if o.type != "MESH":
            continue
        mesh = o.data
        mesh.transform(at @ o.matrix_world)
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
        bake(mesh, colors or {})
        meshes.append(o)
    for o in new:
        if o.type != "MESH":
            bpy.data.objects.remove(o)
    return meshes


def bake(mesh, colors):
    out = mesh.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    uv = mesh.uv_layers.active.data if mesh.uv_layers else None
    for poly in mesh.polygons:
        material = mesh.materials[poly.material_index]
        image = next((n.image for n in material.node_tree.nodes if n.type == "TEX_IMAGE" and n.image), None)
        if image is None:
            # A model imported again gets its materials renamed "grass.001" and so on.
            rgba = linear(colors[material.name.split(".")[0]])
        for li in poly.loop_indices:
            if image is not None:
                w, h, pixels = atlas(image)
                u, v = uv[li].uv
                i = (min(h - 1, int(v % 1.0 * h)) * w + min(w - 1, int(u % 1.0 * w))) * 4
                rgba = (*(srgb_to_linear(c) for c in pixels[i : i + 3]), 1.0)
            out.data[li].color = rgba
    mesh.color_attributes.active_color = out
    mesh.materials.clear()
    while mesh.uv_layers:
        mesh.uv_layers.remove(mesh.uv_layers[0])


def join(objects, name):
    """Joins meshes into one object called `name`."""
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = objects[0]
    obj.name = obj.data.name = name
    for poly in obj.data.polygons:
        poly.use_smooth = False
    return obj


def mini_court(x, z, y=GROUND):
    """The Venues' court and a net across it."""
    obj = place(court.build()[0], x, y, z)
    b = Builder(PALETTE["equipment"])
    b.box((court.COURT_WIDTH + 0.6, 0.9, 0.06), (x, y + 0.45, z), "net", 0)
    for s in (-1, 1):
        b.prism(0.06, 0.95, (x + s * (court.HALF_WIDTH + 0.3), y + 0.47, z), "post", sides=6)
    return [obj, b.build("net")]


def board():
    """The tabletop: a wooden slab, paved on top, with the Park's grass running on into the lawn in front of the
    city, and a hedge between the Park and the city's blocks."""
    b = Builder(PALETTE["map"])
    b.box((BOARD_X * 2, BOARD_DEPTH, DEPTH_Z), (0, -BOARD_DEPTH / 2 - 0.02, MID_Z), "board", 0.3)
    b.box((BOARD_X * 2 + 0.4, 0.5, DEPTH_Z + 0.4), (0, -BOARD_DEPTH - 0.1, MID_Z), "boardDark", 0.15)
    b.box((BOARD_X * 2 - 0.2, 0.04, DEPTH_Z - 0.2), (0, -0.01, MID_Z), "pavement", 0)
    park_w = CITY_X[0] + BOARD_X
    b.box((park_w, 0.06, DEPTH_Z - 0.2), (-BOARD_X + park_w / 2, 0.01, MID_Z), "grass", 0)
    lawn_w = BOARDWALK_X[0] - CITY_X[0]
    b.box((lawn_w, 0.06, FRONT - LAWN_Z - 0.1), (CITY_X[0] + lawn_w / 2, 0.01, (LAWN_Z + FRONT) / 2), "grass", 0)
    # The hedge, in clipped lengths, from the back of the board to the avenue's turning circle.
    z = BACK + 0.6
    while z < AVENUE_Z - TURN[0] - 1.5:
        length = min(4.2, AVENUE_Z - TURN[0] - 0.9 - z)
        b.box((1.1, 0.9, length), (CITY_X[0] - 1.1, 0.45, z + length / 2), "hedge", 0.25)
        z += length + 0.5
    # The slab's sides under the sea show the water, as if cut through.
    for edge, s in ((BACK, -1), (FRONT, 1)):
        x0 = shore(edge)
        b.box((BOARD_X - x0, BOARD_DEPTH - 0.6, 0.2), ((BOARD_X + x0) / 2, -BOARD_DEPTH / 2 + 0.2, edge + s * 0.02), "sea", 0)
    b.box((0.2, BOARD_DEPTH - 0.6, DEPTH_Z), (BOARD_X + 0.02, -BOARD_DEPTH / 2 + 0.2, MID_Z), "sea", 0)
    return [b.build("board")]


def roads():
    """The avenue in front of the city, with a turning circle at each end, and two streets running back from it,
    in the colors of Kenney's road tiles. Each layer sits a little above the one under it (sidewalk, gutter,
    asphalt, center line), so where roads cross, the asphalt covers the other road's sidewalk and gutter."""
    b = Builder(PALETTE["map"])
    layers = (("sidewalk", 0.14), ("gutter", 0.17), ("asphalt", 0.2))
    x0, x1 = AVENUE_ENDS
    for (color, top), half, turn in zip(layers, ROAD, TURN):
        b.box((x1 - x0, 0.1, half * 2), ((x0 + x1) / 2, top - 0.05, AVENUE_Z), color, 0)
        for x in AVENUE_ENDS:
            b.prism(turn, 0.1, (x, top - 0.05, AVENUE_Z), color, sides=24)
        for sx in STREETS_X:
            b.box((half * 2, 0.1, AVENUE_Z - BACK - 0.1), (sx, top - 0.05, (AVENUE_Z + BACK + 0.1) / 2), color, 0)
    # The center lines, which stop at the crossings.
    stops = [x0, *(x + s * ROAD[1] for x in STREETS_X for s in (-1, 1)), x1]
    for a, c in zip(stops[::2], stops[1::2]):
        b.box((c - a, 0.1, 0.2), ((a + c) / 2, 0.18, AVENUE_Z), "roadLine", 0)
    for sx in STREETS_X:
        z0 = AVENUE_Z - ROAD[1]
        b.box((0.2, 0.1, z0 - BACK - 0.1), (sx, 0.18, (z0 + BACK + 0.1) / 2), "roadLine", 0)
    return [b.build("roads")]


def boardwalk():
    """A wooden boardwalk between the city and the Beach, from the back of the board to the front."""
    b = Builder(PALETTE["beach"])
    x0, x1 = BOARDWALK_X
    b.box((x1 - x0, 0.16, DEPTH_Z - 0.2), ((x0 + x1) / 2, 0.08, MID_Z), "woodDark", 0)
    z = BACK + 0.1
    while z < FRONT - 0.2:
        b.box((x1 - x0 - 0.1, 0.06, 0.88), ((x0 + x1) / 2, 0.17, z + 0.45), "wood", 0.01)
        z += 1.0
    return [b.build("boardwalk")]


def buildings():
    """Kenney's buildings in the blocks around the Rooftop, low in front of it, so the court on its roof shows."""
    spots = [
        # Left of the first street.
        ("building-g", -27, -3, 0), ("low-detail-building-b", -27, -16, 0), ("building-a", -27, -28, 1),
        ("low-detail-building-wide-a", -27, -37, 0),
        # Around the Rooftop.
        ("building-c", -6.5, -3.5, 0), ("building-e", 9.5, -3.5, 0), ("low-detail-building-e", -9, -17, 0),
        ("low-detail-building-e", -9, -30, 1), ("low-detail-building-e", 15, -20, 2), ("low-detail-building-b", 15, -33, 0),
        # Right of the second street, up to the Beach.
        ("low-detail-building-e", 31, -4, 0), ("building-g", 33, -16, 3), ("low-detail-building-wide-a", 33, -27, 1),
        ("low-detail-building-b", 33, -36, 0),
    ]
    out = []
    for name, x, z, turns in spots:
        out += kenney(f"city-kit-commercial/{name}.glb", x, z, turns)
    return out


def rooftop_block():
    """The Rooftop Venue: a tall block with the court, its chain-link fence, AC units and a water tank on the roof."""
    x, z = ROOFTOP
    w, d = 18.0, 26.0
    b = Builder(PALETTE["rooftop"])
    b.box((w, ROOF_TOP, d), (x, ROOF_TOP / 2, z), "tower1", 0.2)
    y = ROOF_TOP - 2.6
    while y > 2:
        b.box((w + 0.1, 1.3, d + 0.1), (x, y, z), "glass", 0)
        y -= 3.2
    b.box((w, 0.3, d), (x, ROOF_TOP + 0.15, z), "deck", 0)
    for s in (-1, 1):
        b.box((0.4, 1.0, d + 0.4), (x + s * w / 2, ROOF_TOP + 0.5, z), "parapet", 0.05)
        b.box((w + 0.4, 1.0, 0.4), (x, ROOF_TOP + 0.5, z + s * d / 2), "parapet", 0.05)
    deck = Builder(PALETTE["rooftop"])
    for s in (-1, 1):
        rooftop.chain_link(deck, x + s * rooftop.FENCE_X, z - rooftop.FENCE_Z, x + s * rooftop.FENCE_X, z + rooftop.FENCE_Z)
        rooftop.chain_link(deck, x - rooftop.FENCE_X, z + s * rooftop.FENCE_Z, x + rooftop.FENCE_X, z + s * rooftop.FENCE_Z, height=2.0)
    rooftop.ac_unit(deck, x - 7.8, z - 4.0)
    rooftop.ac_unit(deck, x - 7.8, z + 1.0)
    rooftop.ac_unit(deck, x + 7.8, z + 6.0)
    rooftop.water_tank(deck, x + 7.4, z - 9.5, 0.8)
    rooftop.planter(deck, x - 7.4, z + 11.5, 1.6)
    top = ROOF_TOP + 0.3
    # The court sits a little above the deck, as the Park's sits above its grass, so its apron never z-fights the deck.
    return [b.build("rooftop"), place(deck.build("deck"), 0, top, 0), *mini_court(x, z, top + 0.03)]


def park_zone(sway):
    """The Park: its court with a low fence, paths, a fountain, benches and lamps, and trees (into `sway`)."""
    x, z = PARK
    b = Builder(PALETTE["park"])
    # Paths: in from the avenue, around the court, and back to the fountain.
    b.box((CITY_X[0] - x - 9.5 + 1.5, 0.05, 3.0), ((CITY_X[0] + x + 9.5) / 2, 0.06, AVENUE_Z), "path", 0)
    for s in (-1, 1):
        b.box((3.0, 0.05, 31.0), (x + s * 9.5, 0.06, z), "path", 0)
        b.box((22.0, 0.05, 3.0), (x, 0.06, z + s * 14.0), "path", 0)
    b.box((3.0, 0.05, 20.0), (x - 9.5, 0.06, z - 24.0), "path", 0)
    # Lamps either side of the gate, where the path leaves the avenue's turning circle.
    for s in (-1, 1):
        park.lamp(b, CITY_X[0] - 1.2, AVENUE_Z + s * 2.3)
    park.fountain(b, x - 9.5, z - 36.0)
    park.flower_bed(b, x - 16.0, z - 36.0, 3.5, 2.5)
    park.flower_bed(b, x - 3.0, z - 36.0, 3.5, 2.5)
    for s in (-1, 1):
        park.fence(b, x + s * 7.3, z - 11.5, z + 11.5)
        park.bench(b, x + s * 11.8, z - 4.0, -s)
        park.lamp(b, x + s * 11.8, z + 6.0)
    trees = [(-66, -35, 2.4), (-54, -36, 2.0), (-40, -34, 2.3), (-67, -20, 2.0), (-47, -22, 2.2), (-36, -12, 1.9),
             (-67, -4, 2.3), (-66, 14, 2.1), (-66, 27, 2.2), (-37, 26, 1.9), (-67, 21, 1.8), (-37, -2, 2.0),
             (-58, -26, 2.0), (-42, -27, 1.8), (-36, 17, 1.7)]
    for i, (tx, tz, sc) in enumerate(trees):
        if i % 4 == 3:
            park.pine(sway, tx, tz, sc)
        else:
            park.round_tree(sway, tx, tz, sc, ("leaf", "leafLight", "leafWarm")[i % 3])
    # The lawn in front of the city, with trees along the avenue.
    for i, tx in enumerate(range(-26, 38, 10)):
        park.round_tree(sway, tx, LAWN_Z + 3.5, 1.7, "leaf" if i % 2 else "leafLight")
    for tx, tz, sc in ((-14, 25, 2.2), (7, 27, 2.3), (27, 25, 2.0)):
        park.round_tree(sway, tx, tz, sc, "leaf")
    kits = []
    bush = {"grass": PALETTE["park"]["bush"]}
    for i, (bx, bz) in enumerate(((-39, 2), (-63, 2), (-39, 25), (-63, 25), (-28, 24), (33, 22), (-4, 27), (17, 27))):
        kits += kenney("nature-kit/plant_bushLarge.glb" if i % 2 else "nature-kit/plant_bush.glb", bx, bz, i, 9.0, bush)
    flowers = {"colorRed": PALETTE["park"]["flowerPink"], "colorYellow": PALETTE["park"]["flowerYellow"], "grass": PALETTE["park"]["leafLight"]}
    for i, (fx, fz) in enumerate(((-38.5, 21), (-38.5, 7), (-63.5, 21), (-63.5, 7))):
        kits += kenney("nature-kit/flower_redA.glb" if i % 2 else "nature-kit/flower_yellowA.glb", fx, fz, i, 10.0, flowers)
    return [b.build("park"), *mini_court(x, z), *kits]


def dune_grass(b, x, z, seed):
    """A clump of thin blades leaning out from (x, z)."""
    for k in range(7):
        a = (k / 7 + seed * 0.13) * math.tau
        lean = 0.25 + 0.1 * (k % 3)
        h = 0.9 + 0.25 * ((k + seed) % 3)
        b.prism(0.09, h, (x + 0.35 * math.cos(a), h / 2, z + 0.35 * math.sin(a)), "grass", sides=4, top_radius=0.01,
                rot=(lean * math.sin(a), 0, -lean * math.cos(a)))


def beach_zone(sway, water):
    """The Beach: sand, its court with a rope fence, huts, umbrellas, a lifeguard tower and palms (into `sway`);
    the sea in bands that deepen away from the shore (into `water`)."""
    x, z = BEACH
    b = Builder(PALETTE["beach"])
    zs = [BACK + 0.1 + i * (DEPTH_Z - 0.2) / 70 for i in range(71)]
    b.strip([(CITY_X[1], shore(zz) + 1.5, zz) for zz in zs], GROUND - 0.01, "sand")
    b.strip([(shore(zz) - 0.2, shore(zz) + 1.5, zz) for zz in zs], GROUND - 0.008, "sandWet")
    for s in (-1, 1):
        beach.rope_fence(b, x + s * beach.FENCE_X, z - beach.FENCE_Z, x + s * beach.FENCE_X, z + beach.FENCE_Z)
        beach.rope_fence(b, x - beach.FENCE_X, z + s * beach.FENCE_Z, x + beach.FENCE_X, z + s * beach.FENCE_Z)
    for i, hx in enumerate((42.0, 46.0, 50.0)):
        beach.hut(b, hx, -34.0, ("hutStripe", "umbrellaA", "umbrellaB")[i])
    for ux, uz, c, t in ((41.5, -9, "umbrellaA", "towelA"), (50.0, -15, "umbrellaB", "towelB"), (41.5, 25, "umbrellaC", "towelA"),
                         (50.5, 26, "umbrellaA", "towelB"), (50.5, -3, "umbrellaC", "towelA")):
        beach.umbrella(b, ux, uz, c, t)
    beach.lifeguard_tower(b, shore(-24) - 2.2, -24)
    for px, pz, sc, lean in ((41.5, -24, 1.8, 0.8), (52, -29, 1.6, -0.6), (41.5, -1, 1.7, 0.7), (55, 24, 1.8, -0.8),
                             (41.5, 28.5, 1.6, 0.6), (47.5, -38, 1.7, -0.5)):
        beach.palm(sway, px, pz, sc, lean)
    # Dune grass along the boardwalk, so the sand doesn't start in a bare line.
    for i, tz in enumerate((-37.5, -29.0, -19.0, -12.5, -5.0, 29.5)):
        dune_grass(b, BOARDWALK_X[1] + 0.9, tz, i)
    rocks = []
    rock = {"dirt": PALETTE["beach"]["rock"], "grass": PALETTE["beach"]["rockDark"]}
    for i, rz in enumerate((-36, 4, 27)):
        rocks += kenney("nature-kit/rock_smallA.glb", shore(rz) + 0.8, rz, i, 7.0, rock)
    # The sea: columns out from the shore, so the game can ripple it, and a wash of foam along the waterline.
    step = 2.5
    bands = ((3.0, "seaShallow"), (7.0, "sea"), (11.0, "seaMid"), (math.inf, "seaDeep"))
    for k in range(int((BOARD_X - shore(0)) / step) + 4):
        o0, o1 = k * step, (k + 1) * step
        rows = [(min(shore(zz) + o0, BOARD_X), min(shore(zz) + o1, BOARD_X), zz) for zz in zs]
        if all(x0 >= BOARD_X for x0, _, _ in rows):
            break
        water.strip(rows, SEA_Y, next(c for edge, c in bands if o0 < edge))
    water.strip([(shore(zz) - 0.6, shore(zz) + 0.4 + 0.3 * math.sin(zz * 0.7), zz) for zz in zs], SEA_Y + 0.01, "foam")
    return [b.build("beach"), *mini_court(x, z), *rocks]


def pin(name, x, y, z):
    empty = bpy.data.objects.new(f"pin_{name}", None)
    empty.location = to_blender(x * SCALE, y * SCALE, z * SCALE)
    bpy.context.scene.collection.objects.link(empty)
    return empty


def build():
    sway_park = Builder(PALETTE["park"])
    sway_beach = Builder(PALETTE["beach"])
    water = Builder(PALETTE["beach"])
    still = [*board(), *roads(), *boardwalk(), *buildings(), *rooftop_block(), *park_zone(sway_park), *beach_zone(sway_beach, water)]
    meshes = [join(still, "map"), join([sway_park.build("sway"), sway_beach.build("swayBeach")], "sway"), water.build("water")]
    for obj in meshes:
        obj.data.transform(Matrix.Scale(SCALE, 4))
    pins = [pin("park", PARK[0], 5, PARK[1]), pin("rooftop", ROOFTOP[0], ROOF_TOP + 5, ROOFTOP[1]), pin("beach", BEACH[0], 5, BEACH[1])]
    return meshes, pins


if __name__ == "__main__":
    reset()
    meshes, pins = build()
    # The check: the map from where the menu's camera rests (REST in src/menu/mapCamera.ts), and close to each Venue.
    preview_from("map", meshes, eye=(0, 14.5, 10.5), target=(0, 0, -1.9), fov=30, background="#bfe6f7")
    preview_from("map-park", meshes, eye=(-4.3, 7, 7.2), target=(-4.5, 0, 1.2), fov=30, background="#bfe6f7")
    preview_from("map-rooftop", meshes, eye=(0.3, 8.8, 4.5), target=(0.3, 1.5, -1.6), fov=30, background="#bfe6f7")
    preview_from("map-beach", meshes, eye=(4.2, 7, 6.2), target=(4.4, 0, 1.0), fov=30, background="#bfe6f7")
    export("map", meshes + pins)
