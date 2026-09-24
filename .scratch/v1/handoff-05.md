# Handoff: starting milestone 05 (Dink City shell)

Written 2026-09-24 at the end of the session that did issue 07 (Bot difficulty) and milestone 04 (art pass). The ticket is `.scratch/v1/issues/05-dink-city-shell.md`. This file is the context the ticket doesn't have.

## Read first, in this order

1. `CONTEXT.md`: the glossary. Use its terms in code, tests and UI (Venue, Personality, Practice mode, Fault banner, Replay, Side, End, Unforced error).
2. `docs/adr/0001`–`0003`. ADR-0001 (pure Sim, presentation never inside it) and ADR-0003 (Bots and the ball machine produce Intents only) govern most of 05.
3. `.scratch/v1/spec.md`. Don't reopen its decisions.
4. `.scratch/v1/handoff-03.md`, "Conventions and gotchas" and "Working with this user". It still applies; this file only adds what changed.
5. The `## Comments` of issues 03, 04 and 07, which say what each delivered.

## State of the repo

- Branch `main`. Local commits not yet pushed: `2436777`, `1af87c7`, `2ab17c6`, `18b9300` (03), `281253c` (07), `934dc77` (04). **Ask before pushing.**
- The user playtested 04 and 07: "testing results are clean". There are no open bugs.
- Tests: 99 Vitest tests (`npm test`, about 12 s; the Bot-vs-Bot Games are the slow part) and 3 Playwright checks (`npm run e2e`).

### What 04 and 07 added

| Path | What |
| --- | --- |
| `src/bot/bot.ts` | `Difficulty` gained `moveSpeed`, `aimWidth`, `lateCommit`, `offCenter` and `unforcedError`; `reactionTicks` and `aimNoise` went up. `createBot(side, seed, difficulty, tuning, weights?)`: `weights: ShotWeights` is the unused Personality hook (`NEUTRAL` today). |
| `src/debug/panel.ts` | New "Bot" folder bound to the live Difficulty preset, and `ambience`/`sunset` in View. |
| `art/` | `palette.json` (colors, shared with the game), `scripts/*.py` (Blender 5.2 headless; see `art/README.md`), `models/*.glb`, `audio/park-ambience.ogg`. `npm run art [-- name ...]` rebuilds them. |
| `src/render/models.ts` | `loadModels()` (Park only today), `PART_NAMES`, `recolor(geometry, regions, colors)`, `DEFAULT_PLAYER_COLORS`. |
| `src/render/character.ts` | Built from the `.glb` parts; `new Character(parts, colors, material)`. `BONES` is exported (the model test uses it). |
| `src/render/renderer.ts` | `new Renderer(canvas, view, sim, models)`. Park-only constants: `LIGHTING` (day/sunset), `LOOKS` (each Side's colors). `stats` gives draw calls and triangles. |
| `src/audio/ambience.ts` | `startAmbience`/`updateAmbience`: one looping Web Audio buffer on the ZzFX context. Park only. |
| `src/main.ts` | Top-level `await loadModels()`, then straight into a Match. URL flags: `?rally`, `?bo3`, `?bot=`, `?sunset`, `?debug`. `window.dink` gained `stats`. |
| `e2e/park.e2e.ts`, `playwright.config.ts` | Day and sunset reference screenshots (`e2e/__screenshots__/`), and the budget check during a Bot-driven Rally. The config runs its own dev server on port 5174. |
| `test/models.test.ts` | The `.glb` contract (every part, `_region`, bone lengths) and `recolor`. |

## What 05 builds on

- **Fault Replay:**
  - `main.ts` already records `rally = { start, intents }` for the current Rally.
  - `step` is pure and deterministic, so stepping `start` through `intents` reproduces the Rally exactly. `test/bot.test.ts` proves this for a whole Game.
  - Play the Replay into a separate state for the renderer only; never feed it back into the Match.
  - Hook it onto the `dead` event, as the Fault banner (`src/hud/hud.ts`) does.
  - Hit-stop and Game speed live in the frame loop in `main.ts`; a Replay needs its own clock.
- **Personalities:**
  - `chooseShot` multiplies its scores by `weights` (bot.ts, around line 398).
  - Banger, Dinker and Lobber are `ShotWeights` values plus, if the user wants, Difficulty tweaks.
  - Test them the way issue 07 did: Bot-vs-Bot stats through `createBot`/`observe` (see `handicapped()` in `test/bot.test.ts`).
- **Venues:**
  - The Park is hard-wired in three places: `loadModels`, `LIGHTING` and `LOOKS` (renderer.ts), and `startAmbience`.
  - 05 needs a Venue definition (models, lighting day/sunset, ambience, Personality) and a way to switch Venues without reloading the page.
  - Rooftop and Beach need new `art/scripts/<venue>.py` and ambience. Parameterize `ambience.py` rather than copy it.
  - Follow `art/README.md`:
    - Mirror the layout in z; the world turns 180° when Ends switch.
    - The game camera sees the ground from about z = −12 to +10.
    - One mesh per Venue keeps it to one draw call.
    - Preview from the game camera before export.
- **Player colors:**
  - `recolor` plus `palette.json` "player" regions. The spec's customizable set is shirt, shorts, paddle, skin and hair.
  - Save them in localStorage, with every read and write in try/catch (it can throw, or come back empty).
- **Practice mode:**
  - The ball machine must produce Intents like any Side (ADR-0003); it can't place the ball directly.
  - The Sim has no concept of a machine yet. How it feeds (a Side that only serves or drives, or something else) is open; see the questions below.
- **Settings:** `MatchConfig` (`rallyScoring`, `bestOf`) and `DIFFICULTY` exist; today only URL flags set them.
- **Menus:** the spec says plain DOM/SVG over the canvas (`src/style.css`, `#hud`). `main.ts` will need an app state (map, Venue, Match, Practice) instead of starting a Match at load.

## Open questions for the user (options plus one recommendation; they decide)

- The map menu's look and layout (a DOM/SVG city map), and what unlocks a Venue (beating its Bot? at which Difficulty?).
- Rooftop and Beach: surroundings, palette, lighting, and each one's Personality (the spec pairs Banger, Dinker and Lobber with Venues, but not which with which).
- Personality strength: shot weights only, or also Difficulty tweaks.
- Practice mode: how the ball machine feeds, the sequence of prompts (Two-bounce rule, Kitchen faults), and how a step is passed.
- Fault Replay: its length (the whole Rally or the last few seconds), its speed, whether it can be skipped, and whether the camera changes.
- Settings: where they live (the map menu or a pause menu), and whether URL flags stay as dev overrides.
- Color customization UI: presets or free color pickers, and whether the Bot's look (`LOOKS`) changes per Venue.

## Still open from earlier (don't act without the user)

- Frame rate against the budget (60 fps on 2020 integrated graphics) is unmeasured; only draw calls, triangles and size are.
- Unforced errors are mostly weak balls rather than outright misses, because the Sim clamps aim inside the court. Changing that is an ADR-0002 call.
- No feedback yet on `reachBack`, `assistRange`, `edgeQuality`, `smashSpeed`, nor on the two 02 review questions (a Bot prediction note in ADR-0003; line calls use the ball's center).
- Known shortcuts:
  - Dink and Drop share values.
  - The Serve has no wind-up.
  - `predictContact` duplicates the assist and Contact logic.
  - Court sizes, bone lengths and the camera exist both in TypeScript and in `art/scripts/*.py`. A shared JSON like `palette.json` would fix that.

## Tooling and environment gotchas

- **Blender:**
  - The MCP addon wasn't connected last session.
  - Headless Blender 5.2 at `C:/Program Files/Blender Foundation/Blender 5.2/blender.exe` works; `npm run art` wraps it.
  - `bpy.ops.sound.mixdown` writes nothing in background mode; use `aud.Sound(...).write(...)` (see `ambience.py`).
- **Playwright:**
  - Reference screenshots change whenever the start screen changes. A menu will change what `/` shows, so update the e2e test to enter a Match first.
  - Re-accept the references deliberately (`npm run e2e -- --update-snapshots`) and look at the new PNGs.
- **PowerShell 5.1:** `Get-Content`/`Set-Content` corrupt UTF-8. Use the Edit tool or Node for rewrites.
- **Git:**
  - Commit messages go through Bash with a heredoc.
  - Never chain `git stash` with other commands in one line. Last session a stray `cat` waited on stdin, so `stash pop` never ran and the work had to be popped by hand.
- **Measuring:** throwaway Vitest files (`test/_measure.test.ts`) worked well for Bot stats. Log with `--reporter=verbose --silent=false`, and delete them before committing.
- **Commit trailer:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Build:** after `npm run build`, check that `dist/assets/*` has no `tweakpane`. The chunk-size warning is three.js and expected.

## Working with this user

- They make the design calls. Settle the open questions above before building. The ticket is large, so split it into slices and agree the order: for example Replay and Settings first (small, no art), then Personalities, then Venues and art, then Practice mode.
- They playtest by hand and report feel. Keep replies concise, and end each change with a short list of what to test, each paired with its debug slider or URL flag.
- They chose separate small commits for separate concerns (07 before 04).
