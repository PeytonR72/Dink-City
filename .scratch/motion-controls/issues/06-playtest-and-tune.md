# 06: Side-by-side playtest, tuning and online check

Status: ready-for-human
Blocked by: 05

Spec: `.scratch/motion-controls/spec.md`.

## Goal

Decide whether Motion mode is fun and fair next to Keyboard mode, and tune it. This decides the next step: keep it as an option, change the hitting model, or make it more prominent.

## Scope

- **Playtest matrix**: the same Venue, difficulty and seed, played in Keyboard mode and Motion mode, plus at least one Match with mid-Match switches using `M`.
- **Record** for each Match:
  - points won
  - Shot quality averages (the debug panel already shows quality)
  - misses from early and from late Swings
  - misclassified Swings
  - how it felt
- **Tune**: `swingWindowTicks`, `swingLeadMs`, the gesture thresholds, Auto-move speed, and the Auto-Commit point. Tune these before touching any `simTuning` value.
- **Online**: play one online Match with one Player in Motion mode and one in Keyboard mode. Confirm no desyncs or rejected hits that the Swing didn't explain. The Court should accept the reported `contact` flags as it does today.
- **Answer the spec's open questions**: how strict the timing should be, whether depth aiming is needed, and whether switching mid-Rally should be allowed.

## Acceptance

- Results and decisions are written in the comments, with the final `motionTuning` values committed.
- Any follow-ups are filed as new issues (for example, a WebRTC transport if the relay latency hurts).

## Comments
