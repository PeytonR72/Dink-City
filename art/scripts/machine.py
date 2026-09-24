"""The Practice mode ball machine: a little robot on wheels with a hopper of balls and a launch tube
-> art/models/machine.glb (one mesh).

Authored in character space like the Player: feet (wheels) at y = 0, forward is -z. The renderer draws it in
place of Side 1's Player in Practice mode.
"""
import math
import sys

sys.path.insert(0, __import__("os").path.dirname(__file__))
from lib import PALETTE, Builder, export, preview, reset  # noqa: E402

COLORS = PALETTE["machine"]


def build():
    b = Builder(COLORS)
    # Wheels, axles and the chassis.
    for x in (-0.42, 0.42):
        for z in (-0.3, 0.3):
            b.prism(0.16, 0.12, (x, 0.16, z), "wheel", sides=10, rot=(0, 0, math.pi / 2))
            b.prism(0.06, 0.13, (x, 0.16, z), "trim", sides=6, rot=(0, 0, math.pi / 2))
    b.box((0.9, 0.1, 0.8), (0, 0.24, 0), "dark", 0.02)
    # The body, with a white band and a face: two lamp eyes and a grille.
    b.box((0.8, 0.62, 0.78), (0, 0.6, 0), "body", 0.07)
    b.box((0.82, 0.1, 0.8), (0, 0.46, 0), "trim", 0.02)
    for x in (-0.18, 0.18):
        b.box((0.14, 0.12, 0.04), (x, 0.74, -0.39), "light", 0.02)
    for i in range(3):
        b.box((0.3, 0.025, 0.03), (0, 0.6 - i * 0.045, -0.395), "dark", 0)
    # The launch tube, angled up a little, out of the front.
    b.prism(0.1, 0.5, (0.22, 0.62, -0.55), "tube", sides=8, rot=(math.pi / 2 + 0.25, 0, 0))
    b.prism(0.12, 0.06, (0.22, 0.68, -0.79), "trim", sides=8, rot=(math.pi / 2 + 0.25, 0, 0))
    # The hopper on top, full of balls.
    for sx, sz, w, d in ((0, -0.3, 0.7, 0.05), (0, 0.3, 0.7, 0.05), (-0.33, 0, 0.05, 0.6), (0.33, 0, 0.05, 0.6)):
        b.box((w, 0.34, d), (sx, 1.08, sz), "trim", 0.015)
    for i in range(9):
        b.blob(0.075, (-0.2 + (i % 3) * 0.2, 1.13 + 0.03 * (i % 2), -0.18 + (i // 3) * 0.18), "ball")
    # An antenna.
    b.prism(0.015, 0.35, (-0.28, 1.4, 0.25), "dark", sides=5)
    b.blob(0.05, (-0.28, 1.6, 0.25), "light")
    return [b.build("machine")]


reset()
objects = build()
preview("machine", objects, direction=(-1.0, 0.7, -1.4))
export("machine", objects)
