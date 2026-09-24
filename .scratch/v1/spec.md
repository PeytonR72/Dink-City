# Dink City v1 spec

Agreed in a planning session on 2026-09-23. Terms follow `CONTEXT.md`. Architecture decisions are in `docs/adr/0001`–`0003`.

## Scope

Singles pickleball in the browser against Bots. There are 3 Venues on a Dink City map menu, unlocked in order, with progress saved in localStorage. Multiplayer, doubles, a walkable hub, and mobile are out of v1 scope. The data model allows for all four.

## Feel

- Crossy Road look, Wii Sports feel, but with free movement.
- Forgiving, a bit less so than Wii Sports: bad timing weakens a shot before it causes an error.
- A crisp pickleball-paddle *pop* on contact, with a short hit-stop on hard hits (about 40 ms, tunable).
- Big but slightly toned-down animations.
- Chunky text call-outs: "OUT", "NICE DINK", "KITCHEN FAULT". No voice lines.

## Controls

- Keyboard and gamepad, both mapped to Intents.
  - Keyboard: WASD to move, J / K / L for Soft / Drive / Lob.
  - Gamepad: left stick and face buttons.
- Free movement, with a contact assist whose strength is set in Tuning.
- Aim at Contact: left/right sets the angle, forward/back sets depth within the Shot type's range.
- Commit-early timing (ADR-0002).

## Rules

- Core set (ADR-0001).
- Side-out scoring to 11, win by 2. Rally scoring and best-of-3 are options.
- Serving:
  - Players are placed automatically after each point.
  - The server can adjust position along the baseline before serving.
  - The serve timer runs only in multiplayer.
  - The receiver isn't locked in place; a volley that breaks the Two-bounce rule is a Fault.
- Every Fault shows a Fault banner with a short Replay.

## Camera and readability

- Raised, behind the local Player, perspective with a 30–35° field of view.
- The local Player always appears at the bottom of the screen (the renderer mirrors the court when Ends switch).
- Dampened left/right follow only.
- Height cues:
  - a drop shadow under the ball, always shown, that shrinks and fades with height
  - a landing marker on the opponent's shots
  - a short ball trail

## Art

- Beveled low-poly boxes, flat shading, a bright warm palette with a sunset option per Venue, one sun plus hemisphere light, and blob shadows under players.
- Characters:
  - 1:3 head-to-body proportions, built from rigid parts
  - procedural animation with 2-bone IK
  - anticipation and follow-through
  - vertex colors that can be customized (shirt, shorts, paddle, skin, hair)
- Source of truth is the Blender Python scripts in `art/scripts/`. The exported `.glb` files are committed next to them. Kenney and Poly Haven (both CC0) are fallbacks.

## Audio

- ZzFX for sound effects.
- CC0 ambience for each Venue.
- No music in v1.

## Tech

- Vite, three.js and TypeScript. Vitest for the Sim.
- Tweakpane and debug overlays behind `?debug`, removed from production builds.
- UI is plain DOM/CSS over the canvas.
- Deployed to Vercel.

## Performance budget

60 fps on an integrated-graphics laptop from about 2020:
- under about 50k triangles
- under about 150 draw calls
- one shadow-casting light at most (blob shadows preferred)
- under about 5 MB of assets on first load

## Milestones

See `issues/01`–`06`. Every milestone ends playable.
