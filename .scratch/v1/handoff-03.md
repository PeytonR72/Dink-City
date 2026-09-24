# Handoff: starting milestone 03 (Game feel)

Written 2026-09-24 at the end of milestone 02. The ticket is `.scratch/v1/issues/03-game-feel.md`. This file is the context the ticket doesn't have.

## Read first, in this order

1. `CONTEXT.md`: the glossary. Use its terms in code, tests and issues (Kitchen, not NVZ; Intent; Commit; Soft/Drive/Lob; Side; End; Shot quality; Aim error).
2. `docs/adr/0001`–`0003`: pure Sim, shot solver with Commit-early timing, Intent-only Bots. ADR-0002 is the core of this milestone. Don't break these without flagging it to the user.
3. `.scratch/v1/spec.md`: the agreed v1 plan. Don't reopen its decisions. The **Feel**, **Camera and readability** and **Audio** sections apply here.
4. `.scratch/v1/issues/02-rules-and-basic-bot.md`, `## Comments`: what 02 delivered.

## Where the code stands

| Path | What |
| --- | --- |
| `src/sim/step.ts` | `createInitialState(seed, matchConfig?)`, `step(state, [intent0, intent1], tuning)`, `endOf(state, side)`, `other(side)`. Phases: `serve → rally → dead → serve`, and `over` at the end of the Match. It holds all the rules (scoring, Service court, Two-bounce, Kitchen), contact and the hit. |
| `src/sim/physics.ts` | `integrateBall`: drag, a spin dip, bounce, net and net cord. |
| `src/sim/solver.ts` | `solveShot` (target + apex), `solveTimedShot` (target + speed, for Smashes), `simulateFlight`, `netClearance`. |
| `src/sim/court.ts` | Dimensions, `netHeight(x)`, and End-keyed helpers: `facing(end)`, `endOfZ(z)`, `localToWorld(end, …)`, `worldToLocal(end, …)`. |
| `src/sim/types.ts` | All state, Intent, event, `MatchConfig` and `SimTuning` types. |
| `src/tuning.ts` | `simTuning` (passed into `step`) and `viewTuning` (render only, including `gameSpeed`). |
| `src/bot/bot.ts` | `createBot(side, seed, difficulty, tuning, weights?)`. `DIFFICULTY.easy/medium/hard`, and `ShotWeights` for Personalities in 05. |
| `src/bot/observe.ts` | `observe(state, side) → Observation`. A Bot only ever sees this, never the SimState. |
| `src/hud/` | `faultText(reason, localLost)` (pure, tested) and the DOM `Hud`: scoreboard, server marker, and the Fault banner (`#callout` title + `#detail`). |
| `src/render/renderer.ts` | Graybox three.js. Everything sits in a `world` group that rotates 180° when the local Side is at End 1. It already has interpolation, blob shadows, the ball shadow, the commit/aim ring, a crude swing on the arm, and a dampened left/right camera follow. |
| `src/input/input.ts` | Keyboard + gamepad → Intent, in the local frame. The same stick moves and aims. |
| `src/main.ts` | Fixed-tick loop, the HUD, rally recording, URL flags, and `window.dink`. |
| `src/debug/panel.ts` | Tweakpane behind `?debug`, dev builds only. Every new `SimTuning` field gets a slider here. |
| `test/` | 63 Vitest tests: `sim` (boundary, physics, solver, contact), `rules`, `aim`, `bot` (the golden test), `faultText`. |

### Conventions and gotchas

- **Coordinates:** meters, net at z = 0, y up. **End 0 is the +z half.** Sides switch Ends between Games, so never assume Side 0 is at +z. Use `endOf(s, side)` with the End-keyed court helpers.
- **Intents are in the local frame:** +x is the Player's right, +y is forward toward the net. The renderer mirrors the court so the local Player (Side 0) is always at the bottom. Input needs no change.
- **`step` is pure:** it `structuredClone`s the state and then mutates the clone. `state.events` holds only this step's events. Randomness goes through `random()` inside `step` (the seeded `state.rng`). `hit()` already receives `random`.
- **Contact** (`checkContact` → `hit` in step.ts):
  - Reach is an oval in the local frame.
  - A committed hit fires when the ball is closest to the sweet spot, or on the tick before it would leave reach.
  - `hit` receives `distance` (0 = dead center, 1 = edge of reach).
  - `qualityAt(distance)` gives quality, which lowers power (`weakApex`, `weakDepth`).
  - **Commit timing does not affect quality yet.** `commit.tick` is stored but unused. That is the main job of 03.
- **Aim error already exists (added after 02, which the user liked):**
  - `moveAimError`: a random miss scaled by `player.speed` at Contact (ground speed, assist included). It's applied after the in-court clamp, so a shot on the run can go out.
  - `softOverhit` / `softPerfectRadius`: a Soft from behind the Kitchen goes long unless it's met dead-center and set.
  - Tests are in `test/aim.test.ts`. Extend this model rather than replacing it; ADR-0002 asks for quality to widen Aim error too.
- **Aim mode:** when a Player is committed and the ball is close, `player.aiming` is true, move input only aims, and the assist steers footwork. The assist never carries a Player into the Kitchen while a volley is pending.
- **Smash:** a Drive at contact height ≥ `smashHeight` uses `solveTimedShot`. It falls back to a Drive if the Smash wouldn't clear the net. The hit event has `smash: true`. The Dink, Drop and Block variants **don't exist yet**: every Soft uses the same tuning (plus the overhit from deep).
- **Events:** `hit` (side, type, smash, quality, pos, speed), `bounce`, `net` (cord), `dead` (reason, loser), `rally-won`, `game`, `match`. Hook sounds, call-outs and hit-stop onto these in `main.ts`/render. Never hook them inside the Sim.
- **Hit-stop and Game speed are presentation only.** Pause or slow the render/tick accumulator in `main.ts`. The Sim never sees wall time (ADR-0001).
- **Bots:**
  - They commit groundstrokes only **after the bounce** (so they don't volley by accident). Once Commit-early timing rewards early Commits, that would make every Bot shot rushed. Commit earlier and hold position instead, or the Bots will fall apart. Re-check with the golden test and the stats (see below).
  - `kitchenDiscipline` covers both the Kitchen and the Two-bounce rules.
  - The Bot predicts the ball with the Sim's `integrateBall`, plus a noise offset and a spin read from the hitter's swing.
- **Golden test** (`test/bot.test.ts`): a seeded Bot-vs-Bot Game must replay exactly from its Intents, and it pins the final score and tick (currently 17–15, tick 62963). Any intended change to play will change the pin. Update it deliberately and tell the user, don't just paste the new numbers.
- **`window.dink`** (dev):
  - `state`, `rally` (the start state plus Intents for the current Rally), `simTuning`, `viewTuning`, `eventLog`, `newMatch(seed)`.
  - `advance(ticks, drive?)` steps synchronously. Use it for browser playtests, because Chrome pauses rAF in hidden tabs.
  - To drive Side 0 with a Bot in the page: `const {createBot, DIFFICULTY} = await import('/src/bot/bot.ts'); const {observe} = await import('/src/bot/observe.ts');`, then `dink.advance(600, s => bot.think(observe(s, 0)))`.
- **URL flags:** `?debug`, `?rally` (Rally scoring), `?bo3`, `?bot=easy|medium|hard`.
- **Measuring Bot play:** a throwaway Vitest file that runs Bot-vs-Bot Games and counts `dead` reasons, hits per Rally and the server's win rate worked well in 02. Log with `--reporter=verbose`, and delete the file afterwards. Current baseline with medium Bots:
  - about 8–9 hits per Rally
  - the server wins 30–45% of Rallies
  - Games run 60–100+ Rallies (long, because Side-outs are common)

## Commands

- `npm run dev`: http://localhost:5173 (the user often already has it running; reuse it)
- `npm test`, `npm run typecheck`, `npm run build`
- After building, check that `dist/assets/*` contains no `tweakpane`. The chunk-size warning is three.js and expected.

## Tooling

- **Blender MCP:** connected. Not needed until 04.
- **Browser:** Claude-in-Chrome works (screenshots plus `javascript_tool` calling `dink.advance`). Playwright MCP is in `.mcp.json` but may not be loaded.
- **Git:** remote `origin` is https://github.com/PeytonR72/Dink-City. Work goes on `main`. 02 and the aim-error follow-up are committed but **not pushed**; ask before pushing.
- **Commit trailer:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Scope of 03: what's settled and what's open

Settled by the spec or ADRs:
- **Shot quality inputs (ADR-0002):**
  - Commit timing: earlier is better, up to a cap, and a late Commit is rushed
  - how well set the Player is (distance to the sweet spot, which exists)
  - contact height
  - movement at Contact (which exists, as Aim error)
  - incoming pace
- **How quality acts:** poor quality lowers power first and widens Aim error second. Outright errors need poor quality on several inputs at once. The existing moving-shot and overhit misses can already put a ball out; keep that, since the user asked for it.
- **Context variants:**
  - Soft → Dink (from the Kitchen line), Drop (from deep), Block (against a very fast incoming ball)
  - Drive → Smash (exists)
  - automatic Volley (exists)
- **Presentation:**
  - hit-stop ~40 ms on hard hits (tunable)
  - landing marker on the opponent's shots
  - short ball trail
  - chunky call-outs ("NICE DINK", "OUT", "KITCHEN FAULT"; no voice)
  - ZzFX: paddle pop, bounce, net, Fault sting
  - a procedural swing, walk and ready stance on a rigid-part placeholder with 2-bone IK, driven by the predicted Contact tick
  - debug overlays: predicted landing, contact zone, Shot quality, Bot intent
  - Game speed tuned in playtesting and recorded in `tuning.ts`

Open, so ask the user (options plus one recommendation; don't pick silently):
- the Commit-timing curve (the cap, and what counts as "late")
- whether and how much quality should widen Aim error beyond the movement error that exists
- the Block threshold
- which call-outs fire, and how often ("NICE DINK" on every Dink gets old)
- whether the landing marker shows on the opponent's shots only (as the spec says) or on the Serve too

Two questions from the 02 review are still unanswered. Raise them if they become relevant:
- The Bot predicts with the Sim's integrator plus noise. I recommended keeping it and adding a note to ADR-0003.
- Line calls use the ball's center rather than its edge.

## Working with this user

- **They make the design calls.** When something isn't settled, present options with one recommendation and let them choose.
- **They playtest by hand** and describe feel ("feels better", "aim is hard", "dinks from far should be harder"). Turn that into concrete mechanics or tuning changes: explain the cause briefly, then fix it with a test. They liked how the aim-error change was handled: they got a Sim mechanic with Tuning knobs, tests, and a list of what to try.
- **Keep replies concise.** End each change with a short list of things to test, each paired with its debug-panel slider.
- **Movement is confirmed as feeling right:** don't change `playerSpeed` or `playerAccel` unless they ask.
- **Still waiting on feedback** from 01 about `reachBack`, `assistRange`, `edgeQuality` and `smashSpeed`. They haven't reported on these yet.
