# 05: Dink City shell

Status: ready-for-agent
Blocked by: 04
Handoff: `.scratch/v1/handoff-05.md` (read this before starting)

## Goal

The complete v1 meta-game around matches.

## Acceptance

- A Dink City map menu (DOM/SVG) with 3 Venues (Park, Rooftop, Beach). They unlock in order, and progress is saved in localStorage (reads and writes wrapped in try/catch).
- Each Venue has a Bot Personality (Banger, Dinker, Lobber), a lighting setup with a sunset option, and its own ambience.
- Player color customization is saved in localStorage.
- Practice mode: a ball machine that feeds shots through the Intent interface, with step-by-step prompts that teach the Two-bounce rule and Kitchen faults.
- Fault Replay: a short playback from recorded Intents after each Fault.
- Settings: rally scoring, best-of-3, and the Bot Difficulty.

## Comments

### 2026-09-24: decisions (agreed with the user before building)

- **Slices, one commit each:** 1) Fault Replay + Settings, 2) Personalities, 3) map menu, Venue switching, colors, 4) Rooftop and Beach art and ambience, 5) Practice mode.
- **Fault Replay:** the last 2.5 s before the Fault, at 0.5× speed, under the Fault banner, with a "REPLAY" tag. Any shot button skips it. Same camera.
- **Unlocks:** winning a Match at any Difficulty unlocks the next Venue. The map shows a star per Difficulty beaten at each Venue.
- **Settings:** a panel on the menu, saved in localStorage. URL flags (`?rally`, `?bo3`, `?bot=`, `?sunset`) stay as dev overrides. Esc in a Match opens a pause menu (Resume / Quit to map).
- **Venues:** Park = Dinker; Rooftop (skyline, water tanks, AC units, chain-link fence) = Banger; Beach (sand, palms, sea, huts) = Lobber. Each has day and sunset lighting.
- **Personality strength:** shot weights plus one or two fitting Difficulty tweaks, checked with Bot-vs-Bot stats.
- **Practice mode:** the ball machine is Side 1, an Intent-only Side, with no scoring. Steps: 1) let the Serve bounce and return it, 2) let the third shot bounce before volleying, 3) volley from behind the Kitchen line, 4) dink from the Kitchen after a bounce, 5) free rally. Three good reps pass a step; a Fault shows why, with the Replay.
- **Colors:** a locker panel with a live 3D preview and 8 swatches each for shirt, shorts, paddle, skin and hair. Each Venue's Bot has its own fixed look.

### 2026-09-24: delivered (commits f994a1d, 36df94d, 62f5c8e, 928f4ee, ab0e840, 4694b83)

All six Acceptance items are built. 142 Vitest tests and 11 Playwright checks pass (a budget check per Venue: Park 18k, Rooftop 28k, Beach 20k triangles, at most 40 draw calls). First load is about 1.1 MB, because the other Venues load lazily.

- **Choices made without the user:**
  - A double bounce (a winner) gets no Replay.
  - The Replay starts 0.6 s after the Fault (`replayDelay`).
  - Sunset is a saved Setting.
  - Pause also opens on P and the gamepad's Start.
  - New dev flags: `?play`, `?venue=`, `?personality=`, `?practice`.
  - The Beach's sea is on one side only, so it appears on the other side of the screen after Ends switch.
- **Still open for the user:**
  - Personality strength against a neutral medium Bot is Dinker 57%, Lobber 46%, Banger 43%. So Bot-vs-Bot, the first Venue's Bot is the strongest.
  - Menus can't be driven by a gamepad yet.
- **Review smells left as they are:**
  - `turned()` is duplicated in rooftop.py and beach.py.
  - The rows of radio buttons are built twice (Settings and the locker).
  - Adding a Venue touches `venues.ts`, `assets.ts`, `progress.ts` and the map's `PINS`.

### 2026-09-24: playtest fixes (commits 874f121, ff8538d, af29e79, 35ed510, 17ac95a, 37a81a1, 3d7a45f)

These are the six fixes from `.scratch/v1/handoff-05-fixes.md`. 149 Vitest tests and 11 Playwright checks pass (Park 18k, Rooftop 28k, Beach 22k triangles).

- **Practice, the machine chased balls (874f121):** it now moves only while it still has a feed to hit this rep, and stands still after that. It never moves in step 1. A ball can still fly through it where it stands; there is no collision in the Sim.
- **The Bot stuttered when leaving a ball (ff8538d):**
  - Its settle spot is now fixed when it decides to leave the ball, instead of following the ball's x every Tick.
  - It leaves a ball only when the read is out by more than its own read error, at every Difficulty, including easy.
  - It walks (35% speed) while the ball is dead.
  - The golden result moved from 11-5 @ 20188 to 11-6 @ 30485. The handicap stats now pool seeds 6 and 7.
- **The Replay stuttered at its end (af29e79):**
  - The clip drew a Tick behind its clock and never showed the Fault frame. Now it does.
  - It holds on the Fault frame for `replayHold` (0.5 s).
  - The rest of the dead pause plays out unseen, so the cut lands on the next Serve.
  - Hypothesis 3 (stale swings) was ruled out: the Replay's hit ticks equal the live ones.
- **Difficulty recalibration (35ed510):**
  - hard is exactly the old medium.
  - medium is the midpoint of easy and hard in every field.
  - The machine has its own explicit values.
  - Stars already earned keep their names, so an old medium star now reads as hard, which is the same Bot.
  - Bot-vs-Bot, five Games each:

    | Matchup | Hits per Rally | Server wins | Rallies won |
    |---|---|---|---|
    | easy vs easy | 6.6 | 35% | |
    | medium vs medium | 7.7 | 37% | |
    | hard vs hard | 10.2 | 41% | |
    | medium vs hard | | | medium 33% |
    | easy vs medium | | | easy 32% |
    | easy vs hard | | | easy 27% |

  - `.scratch/v1/handoff-03.md`'s "baseline with medium Bots" now describes hard.
- **Rooftop overlaps (17ac95a):** two AC pairs intersected. One pair moved, and the vents were spread out. The build now fails if any prop footprints overlap.
- **Beach water (37a81a1):** the user chose to fix the jagged shoreline and the colors and hard edges, not the static water. The sea is now strips that follow the shoreline:
  - wet sand
  - a foam wash at the waterline
  - shallows darkening through two blues to deep water
  - thin curved wave crests

  This uses a new `Builder.strip` in lib.py.
- **Review smells left as they are:**
  - The zero-move Intent literal appears in three places.
  - `{x, z}` spots have no named type in bot.ts.
  - beach.py uses module-level lambdas for the band edges.

### 2026-09-24: the post-playtest polish (handoff-05-polish.md)

All five requests are done; issue 06 is not started.

- **Stray WINNER** (`c7e275a`): `Hud.reset()` clears `#shout`. The map hid the HUD, and showing it again restarted the leftover call-out's animation. An e2e test covers it.
- **NET CITY** (`97da2ad`): every net Fault, whoever hit it, Practice included. "NET" pops, then "CITY", then "The ball actually needs to go OVER the net." types out. The reveal is timed by frames in the HUD (`src/hud/reveal.ts`), so it plays on through the Replay. A "Side out." waits until the typing ends. Reduced motion shows the final text at once.
- **Lob error** (`c40dd6a`), as the user chose: Lobs only.
  - Off the opponent's Smash: 1.15× depth and 1.1× aim spread.
  - Off a rushed Commit: 1.05× aim spread.
  - The two don't stack; off a Smash wins.
  - The factors are `lobOffSmashDepth`, `lobOffSmashError` and `lobRushedError` in Tuning and the debug panel.
  - The golden Game moved from 11–6 at tick 30485 to 11–13 at tick 39353. The Personality rates were re-measured.
- **Beach props** (`07eff4f`): the sides were laid out again, and the build fails on an overlap or on a prop in the sea. `turned()` and `check_footprints` moved to lib.py.
- **Budget test** (`1a40589`): the local Bot never served, so the budget was measured on a still court. It now plays a real Rally.
- **The map** (`edf071e`, `6337c8f`, `9028843`), live three.js as the user chose; it ignores sunset.
  - `art/scripts/map.py` builds a tabletop diorama. The Venues use their own scripts' helpers, among Kenney CC0 buildings, roads and plants (`art/vendor/kenney/`, atlas colors baked to vertex colors).
  - `src/menu/mapView.ts` draws it only while the menu shows, and the court behind is not redrawn meanwhile.
  - Trees sway and the sea ripples in the vertex shader.
  - Hovering or focusing a pin moves the camera toward that Venue along the line of sight.
  - Measured: 3 draw calls and 31k triangles. `map.glb` is 787 KB, 225 KB gzipped. It is fetched in the background at startup, so issue 06's host should serve `.glb` compressed.
- **Review** (`bae3d10`), smells left as they are:
  - The map view makes a second WebGL context, which lives for the whole session.
  - The lights and the flat Lambert material are repeated across the renderer, the preview and the map view.
  - `FaultText` now also types non-Fault banners.
  - Footprints are bare tuples keyed by name strings.
