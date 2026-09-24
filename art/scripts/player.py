"""The Player: rigid parts at a 1:3 head-to-body ratio, plus the paddle -> art/models/player.glb.

Each part is its own node, authored in the frame `src/render/character.ts` places it in:
- pelvis, torso, head: origin at the joint the part hangs from; y up, forward -z.
- limbs (thigh, shin, upperArm, forearm): centered on the bone, which runs along +y from the parent joint
  (-y end) to the child joint (+y end). Lengths match THIGH, SHIN, UPPER_ARM and FOREARM there.
- shoe: origin at the ankle (the IK foot target), forward -z.
- paddle: origin in the hand, handle along +y, face in the xy plane.
Every vertex has a `_region` (a key of `palette.json` "player"), so the game can recolor shirt, skin, etc.
"""
import math
import sys

sys.path.insert(0, __import__("os").path.dirname(__file__))
from lib import PALETTE, Builder, export, preview, reset, rotation, to_blender  # noqa: E402

from mathutils import Matrix  # noqa: E402

COLORS = PALETTE["player"]
THIGH, SHIN, UPPER_ARM, FOREARM = 0.42, 0.42, 0.30, 0.28


def part(name, shapes):
    b = Builder(COLORS, regions=True)
    shapes(b)
    return b.build(name)


def build():
    parts = {}
    parts["pelvis"] = part("pelvis", lambda b: b.box((0.38, 0.24, 0.26), (0, 0, 0), "shorts", 0.04))

    def torso(b):
        b.box((0.46, 0.54, 0.3), (0, 0.29, 0), "shirt", 0.06)
        # Collar and neck.
        b.box((0.2, 0.05, 0.16), (0, 0.575, 0), "shirt", 0.015)
        b.box((0.14, 0.1, 0.13), (0, 0.61, 0), "skin", 0.02)

    parts["torso"] = part("torso", torso)

    def head(b):
        b.box((0.5, 0.48, 0.46), (0, 0.24, 0), "skin", 0.07)
        # Hair: a cap, the back, and a fringe.
        b.box((0.54, 0.14, 0.5), (0, 0.47, 0.01), "hair", 0.05)
        b.box((0.54, 0.32, 0.12), (0, 0.33, 0.2), "hair", 0.04)
        b.box((0.46, 0.08, 0.08), (0.03, 0.41, -0.21), "hair", 0.02)
        for s in (-1, 1):
            b.box((0.065, 0.1, 0.03), (s * 0.11, 0.23, -0.225), "eye", 0.012)
            b.box((0.08, 0.04, 0.02), (s * 0.17, 0.14, -0.228), "cheek", 0.008)
            b.box((0.05, 0.11, 0.09), (s * 0.265, 0.22, 0.0), "skin", 0.015)

    parts["head"] = part("head", head)

    def thigh(b):
        # Hip at -y, knee at +y: shorts over the top half.
        b.box((0.18, 0.24, 0.18), (0, -THIGH / 2 + 0.11, 0), "shorts", 0.03)
        b.box((0.13, 0.26, 0.13), (0, THIGH / 2 - 0.12, 0), "skin", 0.025)

    parts["thigh"] = part("thigh", thigh)

    def shin(b):
        b.box((0.12, SHIN - 0.06, 0.12), (0, -0.03, 0), "skin", 0.025)
        b.box((0.13, 0.08, 0.13), (0, SHIN / 2 - 0.03, 0), "shoe", 0.02)

    parts["shin"] = part("shin", shin)

    def shoe(b):
        b.box((0.15, 0.1, 0.27), (0, -0.005, -0.045), "shoe", 0.035)
        b.box((0.16, 0.03, 0.28), (0, -0.06, -0.045), "sole", 0.01)

    parts["shoe"] = part("shoe", shoe)

    def upper_arm(b):
        # Shoulder at -y, elbow at +y: a short sleeve.
        b.box((0.15, 0.16, 0.15), (0, -UPPER_ARM / 2 + 0.07, 0), "shirt", 0.03)
        b.box((0.1, 0.17, 0.1), (0, UPPER_ARM / 2 - 0.075, 0), "skin", 0.02)

    parts["upperArm"] = part("upperArm", upper_arm)

    def forearm(b):
        b.box((0.095, FOREARM - 0.02, 0.095), (0, -0.01, 0), "skin", 0.02)
        b.box((0.12, 0.1, 0.12), (0, FOREARM / 2 + 0.02, 0), "skin", 0.03)

    parts["forearm"] = part("forearm", forearm)

    def paddle(b):
        b.box((0.045, 0.15, 0.045), (0, 0.065, 0), "grip", 0.01)
        b.box((0.23, 0.27, 0.02), (0, 0.27, 0), "grip", 0.03)
        b.box((0.2, 0.24, 0.032), (0, 0.27, 0), "paddle", 0.02)

    parts["paddle"] = part("paddle", paddle)
    return parts


def place(obj, center, rot=(0, 0, 0)):
    """A render-only copy of a part, posed in character space."""
    copy = obj.copy()
    copy.name = obj.name + ".pose"
    obj.users_collection[0].objects.link(copy)
    copy.matrix_world = Matrix.Translation(to_blender(*center)) @ rotation(*rot)
    return copy


def standing(parts):
    """Poses copies of the parts into a standing Player, as the game's ready stance roughly does."""
    hip, torso_y, head_y, shoulder_y = 0.86, 0.94, 1.56, 1.46
    posed = [
        place(parts["pelvis"], (0, hip, 0)),
        place(parts["torso"], (0, torso_y, 0)),
        place(parts["head"], (0, head_y, 0)),
    ]
    down = (0, 0, math.pi)
    for s in (-1, 1):
        posed.append(place(parts["thigh"], (s * 0.12, hip - THIGH / 2, 0), down))
        posed.append(place(parts["shin"], (s * 0.12, hip - THIGH - SHIN / 2 + 0.04, 0), down))
        posed.append(place(parts["shoe"], (s * 0.12, 0.06, 0)))
        posed.append(place(parts["upperArm"], (s * 0.29, shoulder_y - UPPER_ARM / 2, 0), (0, 0, math.pi + s * 0.15)))
        posed.append(place(parts["forearm"], (s * 0.35, shoulder_y - UPPER_ARM - FOREARM / 2 + 0.02, -0.08), (0.5, 0, math.pi + s * 0.1)))
    posed.append(place(parts["paddle"], (0.37, 0.8, -0.14), (math.pi - 0.3, 0, 0)))
    return posed


reset()
parts = build()
posed = standing(parts)
for o in parts.values():
    o.hide_render = True
preview("player", posed, direction=(0.8, 0.45, -1.0))
preview("player-back", posed, direction=(-0.7, 0.5, 1.0))
for o in posed:
    o.select_set(False)
export("player", list(parts.values()))
