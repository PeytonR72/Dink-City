# 04: Art pass and first Venue

Status: ready-for-agent
Blocked by: 03

## Goal

Replace the graybox art with final-style models for one Venue (Park).

## Acceptance

- `art/scripts/*.py` generate:
  - the Player (1:3 proportions, rigid parts, beveled, vertex colors)
  - the paddle, net and posts
  - the court
  - Park props
- The exported `.glb` files are committed.
- Each model is checked with a Blender viewport screenshot before export.
- The in-game result matches the spec's art style. Screenshots are compared with Playwright.
- Performance budget met, measured on the Park Venue.
- Park ambience (CC0) in place.

## Comments

**2026-09-24 (Claude):** Implemented; waiting on the user's playtest.
- `art/scripts/` (see `art/README.md`) builds everything with headless Blender 5.2: `npm run art`.
  - The Blender MCP addon wasn't connected, so the viewport check is a workbench render (vertex colors, studio light) written to `art/previews/` before each export. The Park preview shows the whole Venue from the game camera.
  - Models: `player.glb` (rigid parts plus paddle; the paddle lives with the Player, not with the net), `equipment.glb` (net and posts), `court.glb`, `park.glb`.
  - Colors come from `art/palette.json`. Player vertices carry a `_region` attribute, so each Player is recolored (the Bot has a purple shirt, blond hair, darker skin and a blue paddle).
- Game:
  - `src/render/models.ts` loads the models and has `recolor`.
  - `Character` keeps its IK and pose logic and uses the Blender parts, with a separate shoe on each foot.
  - The renderer draws the Venue with one flat-shaded material and has day and sunset lighting (`?sunset`, or the debug `sunset` toggle).
- Ambience: `art/scripts/ambience.py` synthesizes a 24 s seamless loop (breeze, leaves, birds; CC0, made here). It's encoded to Ogg with Blender's audaspace and played gaplessly through Web Audio (`src/audio/ambience.ts`, slider `ambience`).
- Checks:
  - Playwright (`npm run e2e`) compares day and sunset reference screenshots (`e2e/__screenshots__/`) and measures a Bot-driven Rally.
  - `test/models.test.ts` checks the `.glb` contract (every part, regions, bone lengths) and `recolor`.
- Budget, measured on the Park:
  - 36–41 draw calls and about 18.5k triangles mid-Rally (the peak depends on the moment).
  - 1.1 MB first load: 655 KB JS (170 KB gzipped), 292 KB of models, 136 KB of ambience.
  - Frame rate was not measured on 2020 integrated graphics. Headless Chromium renders on the CPU, so it can't tell.
- Camera (the handoff's open item): FOV 33, height 15.5, distance 20, lookAtZ 1.25 (was 32 / 12.5 / 18 / 0.6). A Player 2.5 m behind either baseline now stays in frame. The court is about 12% smaller on screen.
