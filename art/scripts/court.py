"""The court: apron, playing surface, Kitchens and lines -> art/models/court.glb.

Dimensions match src/sim/court.ts. The surfaces are thin slabs stacked a few millimeters apart (apron,
court, Kitchen, lines), so they never z-fight; the Sim treats the ground as y = 0.
"""
import sys

sys.path.insert(0, __import__("os").path.dirname(__file__))
from lib import PALETTE, Builder, export, preview, reset  # noqa: E402

COLORS = PALETTE["court"]
COURT_WIDTH = 6.096
COURT_LENGTH = 13.411
HALF_WIDTH = COURT_WIDTH / 2
HALF_LENGTH = COURT_LENGTH / 2
KITCHEN_DEPTH = 2.134
LINE = 0.05
APRON_X = 3.0
APRON_Z = 4.0
SLAB = 0.004


def slab(b, w, d, top, color, x=0.0, z=0.0):
    b.box((w, SLAB, d), (x, top - SLAB / 2, z), color, 0)


def build():
    b = Builder(COLORS)
    apron_w = COURT_WIDTH + 2 * APRON_X
    apron_d = COURT_LENGTH + 2 * APRON_Z
    slab(b, apron_w, apron_d, 0.0, "apron")
    # A low curb around the apron.
    for s in (-1, 1):
        b.box((apron_w + 0.3, 0.08, 0.15), (0, 0.02, s * (apron_d / 2 + 0.075)), "line", 0.02)
        b.box((0.15, 0.08, apron_d), (s * (apron_w / 2 + 0.075), 0.02, 0), "line", 0.02)
    slab(b, COURT_WIDTH, COURT_LENGTH, 0.004, "court")
    slab(b, COURT_WIDTH, KITCHEN_DEPTH * 2, 0.006, "kitchen")
    for s in (-1, 1):
        slab(b, LINE, COURT_LENGTH, 0.008, "line", s * (HALF_WIDTH - LINE / 2))  # sidelines
        slab(b, COURT_WIDTH, LINE, 0.008, "line", 0, s * (HALF_LENGTH - LINE / 2))  # baselines
        slab(b, COURT_WIDTH, LINE, 0.008, "line", 0, s * KITCHEN_DEPTH)  # Kitchen lines
        slab(b, LINE, HALF_LENGTH - KITCHEN_DEPTH, 0.008, "line", 0, s * (KITCHEN_DEPTH + HALF_LENGTH) / 2)  # centerlines
    return [b.build("court")]


if __name__ == "__main__":
    reset()
    objects = build()
    preview("court", objects, direction=(0.5, 1.2, 1.0))
    export("court", objects)
