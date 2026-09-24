# Art

The scripts in `scripts/` are the source of truth for every model and sound. The exported files in `models/` and `audio/` are committed, so the game builds without Blender.

## Rebuild

```sh
npm run art                 # everything
npm run art -- player park  # just these
```

This runs each script with headless Blender 5.2 (`blender -b --factory-startup -P art/scripts/<name>.py`). If Blender isn't at its default Windows path, set `BLENDER` to the executable.

Each model script renders a workbench preview (vertex colors, studio light) to `previews/` **before** it exports, and prints its triangle count. Check the preview before committing a changed model. The previews aren't committed; they are rebuilt on every run.

## Files

| Script | Output | What |
| --- | --- | --- |
| `lib.py` | | Shared helpers. Everything is authored in three.js space (y up, forward −z). |
| `player.py` | `models/player.glb` | The Player's rigid parts (1:3 head to body) and the paddle. Limbs match the bone lengths in `src/render/character.ts`. |
| `equipment.py` | `models/equipment.glb` | The net (`net`, drawn see-through) and its tape, cord and posts (`netFrame`). |
| `court.py` | `models/court.glb` | Apron, court, Kitchens and lines, sized from `src/sim/court.ts`. |
| `park.py` | `models/park.glb` | The Park Venue's surroundings, as one mesh. Its preview is the whole Venue from the game camera. |
| `ambience.py` | `audio/park-ambience.ogg` | A 24 s seamless loop of breeze, leaves and birds, synthesized in Python. It's CC0 because it's made here from nothing. |

## Conventions

- Colors come from `palette.json`, which the game imports too.
- Models are beveled low-poly boxes with flat shading and face-corner vertex colors. The game draws them all with one flat-shaded Lambert material.
- Player parts carry a `_region` vertex attribute: the index of a key of `palette.json` "player". `recolor` in `src/render/models.ts` uses it to give each Player their own shirt, skin, hair and paddle.
- Normals aren't exported (flat shading doesn't need them), which keeps the files about 4× smaller.
- The Park is mirror-symmetric in z, because the renderer turns the world 180° when Ends switch.
