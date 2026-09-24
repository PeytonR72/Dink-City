# Handoff: starting milestone 02 (Rules and basic Bot)

Written 2026-09-23 at the end of milestone 01. The ticket is `.scratch/v1/issues/02-rules-and-basic-bot.md`. This file is the context the ticket doesn't have.

## Read first, in this order

1. `CONTEXT.md`: the glossary. Use its terms in code, tests and issues (Kitchen, not NVZ; Intent; Commit; Soft/Drive/Lob; Side; End).
2. `docs/adr/0001`–`0003`: pure Sim, shot solver with Commit-early timing, Intent-only Bots. Don't break these without flagging it to the user.
3. `.scratch/v1/spec.md`: the agreed v1 plan. Everything in it was decided with the user in a long planning session. Don't reopen those decisions.
4. `.scratch/v1/issues/01-graybox-sim.md`, `## Comments`: what 01 delivered, plus the first round of playtest feedback.

## Where the code stands

| Path | What |
| --- | --- |
| `src/sim/step.ts` | `createInitialState(seed)`, `step(state, [intent0, intent1], tuning)`. The phase machine is `serve → rally → dead → serve`. |
| `src/sim/physics.ts` | `integrateBall`: drag, a spin dip, bounce, net and net cord. Emits `bounce` and `net` physics events. |
| `src/sim/solver.ts` | `solveShot` (target + apex), `solveTimedShot` (target + speed, for Smashes), `simulateFlight`, `netClearance`. |
| `src/sim/court.ts` | Regulation dimensions, `netHeight(x)`, `facing(side)`, `sideOfZ`, `localToWorld` / `worldToLocal`. |
| `src/sim/types.ts` | All state, Intent, event and tuning types. |
| `src/tuning.ts` | `simTuning` (passed into `step`) and `viewTuning` (render only, including `gameSpeed`). |
| `src/bot/basicBot.ts` | A throwaway Bot for 01. **Replace it in 02.** |
| `src/render/renderer.ts` | Graybox three.js scene with interpolation, blob shadows, and the commit/aim ring. |
| `src/input/input.ts` | Keyboard + gamepad → Intent, in the local frame. |
| `src/main.ts` | Fixed-tick loop, call-outs, and the `window.dink` dev hooks. |
| `src/debug/panel.ts` | Tweakpane panel behind `?debug`, dev builds only. |
| `test/sim.test.ts` | 15 Vitest tests. Includes a boundary test that fails if `src/sim/` imports three.js, imports anything outside `src/sim/`, or uses `Math.random` or `Date.now`. |

### Conventions and gotchas

- **Coordinates:** meters. Net at z = 0, y up. Side 0 plays from +z and faces -z; Side 1 is the mirror image.
- **Intents are in the Player's local frame:** +x is the Player's right, +y is forward toward the net. Convert with `localToWorld` / `worldToLocal`. The Bot must produce local-frame Intents too.
- **`step` is pure:** it `structuredClone`s the input state and then mutates the clone. `state.events` holds only the current step's events.
- **All randomness goes through `random()` in `step`,** which advances `state.rng`. The Bot has its own seeded RNG in its closure. It is deterministic, but it lives outside the Sim state.
- **Contact:** the reach area is an oval in the local frame. A committed hit fires when the ball is closest to the sweet spot, or on the tick before it would leave reach. Quality (0–1) comes from the distance to the sweet spot. A weak shot is loopier and shorter. Drive at a contact height ≥ `smashHeight` becomes a Smash, falling back to a normal Drive if the Smash wouldn't clear the net.
- **Aim mode:** when a Player is committed and the ball is within `reachForward + assistRange`, `player.aiming` is true, move input is ignored, and the assist steers the Player so the ball passes through the sweet spot. **Your new Bot has to account for this.** Its move Intent does nothing in aim mode, so its aim must be deliberate.
- **Placeholders you'll replace:**
  - `serveCount` alternates the server every point.
  - `setUpServe` picks the right or left court by `serveCount` parity.
  - Dead reasons are `out | double-bounce | net | gone`. There are no Faults yet.
  - Main maps dead reasons to call-outs.
- **`window.dink`** (dev):
  - `state`, `simTuning`, `viewTuning`, `eventLog` (the last 100 events, each with a `tick`)
  - `advance(ticks, drive?)` steps the loop synchronously. `drive(state) → Intent` replaces keyboard input for Side 0.
  - **Use `advance` for browser playtests.** Chrome pauses `requestAnimationFrame` in hidden tabs, so the real-time loop stalls whenever the window is covered.

## Commands

- `npm run dev`: http://localhost:5173 (add `?debug` for the tuning panel)
- `npm test`, `npm run typecheck`, `npm run build`
- After building, check that `dist/assets/*` contains no `tweakpane` (the debug panel must stay out of production builds).

## Tooling

- **Blender MCP:** connected. Not needed until milestone 04.
- **Playwright MCP:** configured in `.mcp.json`. It only loads in a session started after it was added, so check whether its tools exist in your session. If not, Claude-in-Chrome works (screenshots plus `javascript_tool` to call `dink.advance`).
- **Git:** remote `origin` is https://github.com/PeytonR72/Dink-City. Work goes on `main`. The user has had each milestone committed and pushed.
- **Commit trailer:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Scope of 02, with details the ticket leaves open

The rules are the core set from ADR-0001. Serve technique and momentum faults are not modeled. Decisions already made:

- **Scoring:**
  - Side-out scoring to 11, win by 2. Singles has **no second server**: losing a rally while serving is an immediate Side-out.
  - Rally scoring and best-of-3 are flags (put them in the match config, not in `SimTuning`).
- **Serve court:** the server serves from the **right** court when their own score is even, and the **left** when odd. This replaces the `serveCount` parity.
- **Serve must land in the diagonal service court.**
  - A serve that lands in the Kitchen, **including on the Kitchen line**, is a Fault.
  - The sideline, centerline and baseline count as in.
  - A serve that clips the net and still lands in is in play: no let, per current USA Pickleball rules.
- **Two-bounce rule:**
  - The receiver must let the Serve bounce.
  - The server must let the return of serve bounce.
  - After that, volleys are allowed.
  - Don't lock the receiver's movement; show a Fault instead.
- **Kitchen fault:** a Volley while the Player is standing in the Kitchen.
  - The Player is a point on the ground, so treat "in the Kitchen" as `|z| < KITCHEN_DEPTH + footRadius`. The kitchen line counts as Kitchen, so touching it is a fault.
  - Put `footRadius` (around 0.12) in tuning.
  - A Volley made after the Player has left the Kitchen is fine.
- **Fault banner:** every Fault and point-ending reason needs a short, plain explanation, for example "KITCHEN FAULT: you volleyed while standing in the kitchen." Fault Replays belong to milestone 05, but keep recorded Intents easy to capture.
- **Ends switch between Games.**
  - The Sim tracks the real Ends.
  - The **renderer mirrors** the court so the local Player always appears at the bottom of the screen. The camera never moves to the other end.
  - Input stays in the local frame, so it needs no change.
- **Model for doubles:** `sides[].players[]` must stay a list. Singles uses `players[0]`, but don't hard-code things that would block a second player later.
- **Bot (ADR-0003):**
  - Intents only.
  - Predicts the ball with its own noisy estimate.
  - Difficulty parameters: reaction delay, prediction error, aim noise, shot-choice accuracy, kitchen discipline.
  - It must respect the Two-bounce rule and stay out of the Kitchen when volleying, at a rate set by its difficulty.
  - It should play real pickleball positioning: stay back after serving (two-bounce), move up to the Kitchen line after the return, and use Soft when at the net against a low ball.
  - Personalities (Banger/Dinker/Lobber) are milestone 05, but build shot choice as a weighting so personalities slot in later.
- **Golden test:** a seeded Bot-vs-Bot Game must replay exactly from recorded Intents.
- **HUD:** plain DOM showing both scores, which Side is serving, and the Fault banner text.

## Working with this user

- **They make the design calls.** When something isn't settled in the spec or this handoff, present options with one recommendation and let them choose. Don't pick silently.
- **They playtest by hand** and describe how things feel ("drive should be faster on a lob", "aim is hard"). Turn that into concrete mechanics or tuning changes. Explain the cause briefly, then fix it.
- **Keep replies concise** and give them a short list of what to test after each change. They liked having specific things to check, each paired with the debug-panel slider that controls it.
- **They were happy with milestone 01 as a sandbox.** Movement is confirmed as feeling right; don't change `playerSpeed` or `playerAccel` unless they ask.

## Still waiting on user feedback

From round 2 of tuning. If they report on these, adjust in `src/tuning.ts`:
- whether the 0.35 m reach behind is too strict (`reachBack`)
- whether aim mode starts too early or too late (`assistRange`)
- whether stretched hits are clearly weaker than clean ones (`edgeQuality`, and the drive's `weakApex` / `weakDepth`)
- whether the Smash feels strong enough (`smashSpeed`)
