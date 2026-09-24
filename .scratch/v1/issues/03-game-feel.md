# 03: Game feel

Status: ready-for-agent
Blocked by: 02

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
