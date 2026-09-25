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
| `machine.py` | `models/machine.glb` | Practice mode's ball machine: a little robot on wheels with a hopper and a launch tube. |
| `equipment.py` | `models/equipment.glb` | The net (`net`, drawn see-through) and its tape, cord and posts (`netFrame`). |
| `court.py` | `models/court.glb` | Apron, court, Kitchens and lines, sized from `src/sim/court.ts`. |
| `park.py` | `models/park.glb` | The Park Venue's surroundings, as one mesh. Its preview is the whole Venue from the game camera. |
| `rooftop.py` | `models/rooftop.glb` | The Rooftop: a roof deck, a chain-link fence, water tanks and AC units over a city skyline. |
| `beach.py` | `models/beach.glb` | The Beach: sand, the sea along one side, palms, beach huts, umbrellas and a rope fence. |
| `map.py` | `models/map.glb` | The Dink City map: a tabletop diorama with the three Venues in miniature, built with the Venues' own helpers, among Kenney's CC0 buildings and roads (`vendor/kenney/`). Three meshes: `map`, `sway` (trees and palms) and `water`, plus `pin_<venue>` empties where the pins point. |
| `ambience.py` | `audio/<venue>-ambience.ogg` | A 24 s seamless loop per Venue, synthesized in Python: breeze, leaves and birds (Park); city rumble, AC hum, horns and pigeons (Rooftop); waves and gulls (Beach). They're CC0 because they're made here from nothing. |

## Conventions

- Colors come from `palette.json`, which the game imports too.
- Models are beveled low-poly boxes with flat shading and face-corner vertex colors. The game draws them all with one flat-shaded Lambert material.
- Player parts carry a `_region` vertex attribute: the index of a key of `palette.json` "player". `recolor` in `src/render/models.ts` uses it to give each Player their own shirt, skin, hair and paddle.
- Normals aren't exported (flat shading doesn't need them), which keeps the files about 4× smaller.
- The renderer turns the world 180° when Ends switch, so a Venue should look alike from either End: props come in pairs at (x, z) and (−x, −z). The Park is also mirror-symmetric in x. The Beach's sea is on one side only, which is what you'd see after switching ends.
- The Venue scripts only build when run directly (`if __name__ == "__main__"`), so `map.py` can import their helpers.
- Third-party models live in `vendor/`, with their licenses. Only CC0 models, and only the files that are used.
- Keep each Venue's surroundings to one mesh (one draw call) and about 25k triangles, so a Venue plus the court, net and Players stays inside the budget.
