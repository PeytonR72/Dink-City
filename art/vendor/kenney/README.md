# Kenney assets

CC0 models by Kenney (www.kenney.nl), used by `art/scripts/map.py` for the Dink City map's buildings, roads and a few plants. Only the files the map uses are kept. Each pack's `License.txt` is its original license.

| Folder | Pack | Version | Source |
| --- | --- | --- | --- |
| `city-kit-commercial/` | City Kit (Commercial) | 2.1 | https://kenney.nl/assets/city-kit-commercial |
| `city-kit-roads/` | City Kit (Roads) | 2.1 | https://kenney.nl/assets/city-kit-roads |
| `nature-kit/` | Nature Kit | 2.1 | https://kenney.nl/assets/nature-kit |

Downloaded 2026-09-24. The City Kit models color their faces from a texture atlas (`Textures/colormap.png`, which the GLBs reference); `map.py` bakes each face corner's atlas color into a vertex color, so they match the game's vertex-colored, flat-shaded style. The Nature Kit models use plain materials, which `map.py` maps to colors from `art/palette.json`.
