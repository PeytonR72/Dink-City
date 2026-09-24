"""The net and posts -> art/models/equipment.glb. (The paddle is part of the Player, in player.py.)

Nodes:
- net: the mesh panel, drawn see-through in the game.
- netFrame: the top tape, the bottom cord, the posts with caps and feet.
The top follows the regulation sag of `netHeight` in src/sim/court.ts: 0.914 m at the posts, 0.864 m at the
center. The Sim, not this mesh, decides net contacts.
"""
import math
import sys

sys.path.insert(0, __import__("os").path.dirname(__file__))
from lib import PALETTE, Builder, export, preview, reset  # noqa: E402

COLORS = PALETTE["equipment"]
NET_POST_X = 3.353
NET_HEIGHT_POST = 0.914
NET_HEIGHT_CENTER = 0.864
SEGMENTS = 16
TAPE = 0.05
BOTTOM = 0.06


def net_height(x):
    t = min(abs(x) / NET_POST_X, 1)
    return NET_HEIGHT_CENTER + (NET_HEIGHT_POST - NET_HEIGHT_CENTER) * t


def segments():
    """(center x, width, top height, slope angle) of each piece along the net."""
    width = 2 * NET_POST_X / SEGMENTS
    for i in range(SEGMENTS):
        x0 = -NET_POST_X + i * width
        x1 = x0 + width
        slope = math.atan2(net_height(x1) - net_height(x0), width)
        yield (x0 + x1) / 2, width, net_height((x0 + x1) / 2), slope


def build():
    net = Builder(COLORS)
    for x, w, top, _ in segments():
        h = top - TAPE - BOTTOM
        net.box((w + 0.002, h, 0.012), (x, BOTTOM + h / 2, 0), "net", 0)

    frame = Builder(COLORS)
    for x, w, top, slope in segments():
        frame.box((w + 0.01, TAPE, 0.04), (x, top - TAPE / 2, 0), "tape", 0.004, rot=(0, 0, slope))
        frame.box((w + 0.01, 0.018, 0.02), (x, BOTTOM, 0), "tape", 0.004)
    for s in (-1, 1):
        x = s * (NET_POST_X + 0.04)
        frame.prism(0.045, NET_HEIGHT_POST + 0.02, (x, (NET_HEIGHT_POST + 0.02) / 2, 0), "post", sides=8)
        frame.box((0.12, 0.05, 0.12), (x, NET_HEIGHT_POST + 0.04, 0), "cap", 0.015)
        frame.box((0.34, 0.05, 0.34), (x, 0.025, 0), "post", 0.02)
    return [net.build("net"), frame.build("netFrame")]


reset()
objects = build()
preview("equipment", objects, direction=(0.6, 0.5, 1.0))
export("equipment", objects)
