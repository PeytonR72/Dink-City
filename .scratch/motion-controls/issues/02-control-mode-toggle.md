# 02: Control mode toggle, input sources and Auto-move (no phone yet)

Status: ready-for-agent
Blocked by: 01

Spec: `.scratch/motion-controls/spec.md`, "Switching modes with no restart", "Auto-move" and "UI".

## Goal

Add Keyboard mode and Motion mode, with switching at any time, and make Motion mode playable with a **debug Swing key** instead of a phone. Keyboard mode must play exactly as today.

## Scope

- **Input-source seam.** Split `src/input/input.ts` into:
  - a keyboard/gamepad source (today's code, unchanged behavior)
  - a Motion source that takes Swings from any producer (the debug key now, the Controller in issue 05)
  - an `Input` facade that picks a source by the current Control mode

  `sample()` keeps its signature, so `main.ts`, `LocalMatch` and `OnlineMatch` don't change how they ask for Intents. The facade needs the previous `SimState` to fill in `contact` (Keyboard mode via `autoContact`, Motion mode via the Swing window) and to run Auto-move. Pass it in the cleanest way the code allows.
- **Offline local Side is `reported`.** `LocalMatch` (Match and Practice) starts the local Side as `reported`. Bot Sides stay `auto`.
- **Keyboard mode**: `contact = autoContact(prev, intents, local)`. Add a test that plays a seeded Match with a Bot driving the local Side through the keyboard-mode path and checks that every Tick equals the all-`auto` run.
- **Motion mode**:
  - **Auto-Commit** Soft when the opponent's shot is on its way, at the point a Bot would normally Commit.
  - A Swing sets `shot` and keeps `contact` on for `motionTuning.swingWindowTicks`.
  - **Auto-move** comes from a `createBot` instance for the local Side (`hard`, Neutral). Only its `move` is used. Keyboard or stick movement overrides it while held.
  - `aim` comes from the latest Swing.
  - During the serve phase, a Swing is a plain shot press.
- **`motionTuning`**: a new object (in `src/tuning.ts` or `src/input/motionTuning.ts`), **not** part of `simTuning`, and editable under `?debug`.
- **Settings**: `controls: 'keyboard' | 'motion'`, defaulting to `keyboard`. It's validated in `loadSettings` like the other fields, set by the `?motion` flag, and shown as a settings row and in the pause menu.
- **Hotkey `M`** toggles the mode during play. Switching clears queued presses and shows a "KEYBOARD"/"MOTION" callout.
- **HUD**: a small Control mode badge.
- **Debug Swing key**: Space in Motion mode under `?debug`, and through `window.dink` for e2e (e.g. `dink.swing(type, aim?)`), injects a Swing.
- **`CONTEXT.md`**: add the glossary entries from the spec.

## Acceptance

- `npm run typecheck`, `npm test`, `npm run e2e` and `npm run build` pass. The e2e screenshots weren't re-accepted.
- The golden Bot result doesn't move.
- **New e2e test**: start a Match in Keyboard mode, toggle to Motion mode mid-Rally with `M`, and win a point with `dink.swing('drive')` timed off the ball. Then toggle back and keep playing on the keyboard.
- **Playtest notes** in the comments: how Motion mode feels with the debug key, and which Swing window looked right.

## Out of scope

- The phone, the relay and real Swing recognition (issues 03–05).

## Comments
