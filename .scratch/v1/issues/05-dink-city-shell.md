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
