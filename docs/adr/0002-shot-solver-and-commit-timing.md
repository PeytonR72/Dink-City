# ADR-0002: Shot solver with Commit-early timing

Status: accepted (2026-09-23)

## Context

We need a hitting model that feels good from a raised camera, maps onto real pickleball shots, uses small discrete inputs (for determinism and future netcode), and is forgiving without being trivial ("Wii Sports feel, slightly less forgiving").

## Decision

- Three Shot types: **Soft**, **Drive**, **Lob**. Context picks the variant: Soft becomes a Dink, a Drop or a Block; Drive becomes a Smash; contact before the bounce is a Volley.
- **Commit early**: the player presses a shot button while the ball is on its way. The Player sets up and swings automatically at Contact. An earlier Commit (up to a cap) raises Shot quality; a late Commit gives a rushed shot.
- Shot quality also depends on how well the Player is set, contact height, movement at Contact, and incoming pace. Poor quality lowers power first and widens Aim error second. Outright errors need poor quality on several of these at once.
- The **Shot solver** turns (Shot type, Aim, quality) into a target point and apex height, then computes the launch velocity analytically, with iteration to correct for drag. Aim error is added after solving and is drawn from the Sim's seeded RNG.
- A small movement assist pulls the Player toward the ball near Contact. Its strength is set in Tuning.

## Consequences

- Precise frame timing isn't required, which suits the camera and hides network latency later.
- Bots use the same vocabulary (a Shot type and Aim), so Bot logic stays simple.
- The swing animation must be driven by the Sim's predicted Contact tick. That is why characters use procedural animation with IK instead of baked clips.

## Alternatives rejected

- Timing-only or free-cursor aiming: harder to read and less like pickleball.
- A full physical swing: very hard to make feel good.
