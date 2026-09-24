# 03: Game feel

Status: ready-for-agent
Blocked by: 02
Handoff: `.scratch/v1/handoff-03.md` (read this before starting)

## Goal

Hitting feels crisp and readable while still using graybox art.

## Acceptance

- Commit-early timing and the Shot quality model (ADR-0002), with Aim error.
- Context variants: Dink, Drop, Block, Smash, and automatic Volley.
- Procedural swing, walk and ready-stance animation on a rigid-part placeholder character, with 2-bone IK driven by the predicted Contact tick.
- Hit-stop on hard hits, landing marker, ball trail, and the dampened left/right camera follow.
- ZzFX sounds: paddle pop, bounce, net, and a Fault sting.
- Text call-outs.
- Debug overlays: predicted landing, contact zone, Shot quality, and Bot intent.
- Game speed tuned in playtesting, with the result recorded in `tuning.ts`.

## Comments

**2026-09-24 (Claude):** Implemented; waiting on the user's playtest (Game speed is still 1.0).
- User decisions:
  - Commit timing is a fraction of the incoming flight: full quality by 50%, rushed from 85% on, floor 0.5.
  - Quality widens Aim error by 0.8 m × (1−q)².
  - Block at an incoming speed of 12 m/s or more.
  - Call-outs are SMASH! (yours) and WINNER only.
  - The landing marker shows on the opponent's shots and their Serve.
- Sim (`src/sim/step.ts`):
  - Shot quality = set × timing × height × pace (`QualityFactors` on the hit event).
  - Soft picks Dink, Drop or Block from context. `shots` tuning is keyed by variant (dink, drop, block, drive, lob).
  - Hit events carry `variant` and `volley`, and `Ball.hitTick` was added.
  - Re-pressing the same button keeps the earlier Commit; a different button is a new, later Commit.
- `src/sim/predict.ts`: `predictLanding` and `predictContact` (mirrors the assist and the Contact rule), for presentation only. Bots don't use it.
- Bots commit groundstrokes early when the ball stays clear of reach until it bounces. During the Two-bounce phase, the margin adds their own prediction error. Medium-vs-medium: 9–11 hits per Rally, the server wins about 31%, average quality 0.75. The golden result was re-pinned on purpose.
- Presentation:
  - Rigid-part character with 2-bone IK (`src/render/ik.ts`, `character.ts`): walk, ready crouch, and a wind-up from the predicted Contact.
  - Forward swing through the real Contact point, with a backhand mirror.
  - Trail, landing marker, hit-stop (`hitStopMs`, `hitStopSpeed`), ZzFX sounds (`src/audio/sfx.ts`), call-outs (`src/hud/callout.ts`).
- Debug overlays (`src/debug/overlays.ts`): predicted landing, reach oval and sweet area, Shot quality breakdown, and the Bot plan.
- Left as is:
  - Dink and Drop share values but have separate knobs.
  - `predictContact` copies the assist and Contact logic rather than sharing it with `step`.
  - The Serve has no predicted wind-up.

**2026-09-24 (Claude):** The user confirmed Game speed 1.0 after playtesting; recorded in `src/tuning.ts`. Their other feedback (every Bot too good) became issue 07.
