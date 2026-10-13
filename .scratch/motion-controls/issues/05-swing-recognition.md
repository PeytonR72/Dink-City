# 05: Swing recognition, latency handling and haptics

Status: needs-triage
Blocked by: 04 (needs the recorded traces)

Spec: `.scratch/motion-controls/spec.md`, "Swing recognition" and "Pairing and transport" (latency).

## Goal

Real Soft, Drive and Lob recognition from phone motion, accurate enough to play a Match, and a measured, tunable answer to relay latency.

## Scope

- **`src/controller/gesture.ts`**: a pure `detectSwing(samples, calibration, motionTuning) → Swing | null`, with no DOM.
  - Start from simple, explainable features: peak rotation speed, pitch change across the swing, and roll at the peak.
  - Thresholds live in `motionTuning`.
- **Fixture tests** over `test/fixtures/motion/`:
  - Report a confusion matrix in the test output.
  - Pass if it gets **at least 85%** of the recorded swings right (a starting bar; the user can change it) and produces **no Swing** from any non-swing trace.
- **Aim**:
  - x from roll or yaw at the peak, relative to calibration
  - y fixed at 0 unless the playtests in issue 06 ask for depth
- **Latency**:
  - Swings carry the phone's timestamp `at`. The screen keeps a clock offset from `ping`/`pong` (reuse what fits from `src/net/clockSync.ts`).
  - Apply `motionTuning.swingLeadMs` and the Swing window.
  - Show the round-trip time on the HUD and in `?debug`.
  - Write the measured round-trip times (home Wi-Fi, mobile data) in the comments.
- **Haptics**: the screen sends `hit` on the local Player's `hit` event, and the phone vibrates (Android).

## Acceptance

- The fixture tests pass at the agreed bar.
- A human plays a full Match at `medium` in Motion mode on a real phone and can choose all three Shot types on purpose.

## Comments
