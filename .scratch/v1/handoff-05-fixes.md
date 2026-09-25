# Handoff: playtest fixes for milestone 05 (before issue 06)

Written 2026-09-24, after issue 05 (Dink City shell) was delivered and the user playtested it. The user reported six problems. **Fix all six before starting issue 06.** The user asked for this file so a fresh agent could do the work; nothing below has been fixed yet.

## Read first

1. `CONTEXT.md`: the glossary. Use its terms (Side, End, Replay, Practice mode, rep, Difficulty, Personality, Venue).
2. `docs/adr/0001`–`0003`:
   - The Sim is pure; presentation never goes inside it.
   - Bots and the ball machine produce Intents only.
3. `.scratch/v1/issues/05-dink-city-shell.md`, including its `## Comments`: the agreed decisions and what was delivered.
4. `.scratch/v1/handoff-05.md`: its "Tooling and environment gotchas" and "Working with this user" sections still apply.
5. `.scratch/v1/handoff-03.md`, "Conventions and gotchas": coordinates, End-keyed helpers, and the golden test.

## State of the repo

- **Branch:** `main`. Nothing past `934dc77` is pushed, including all of issue 05 (`f994a1d` … `3199bb1`). **Ask before pushing.**
- **Tests:** 142 Vitest tests (`npm test`) and 11 Playwright checks (`npm run e2e`, which runs its own dev server on port 5174). All green.
- **Where issue 05's code lives:**
  - `src/replay/replay.ts`: the Replay clip. `main.ts` (`playReplay`, `endReplay`) hooks it up.
  - `src/save/`: settings, progress and colors in localStorage.
  - `src/venue/`: Venue data and assets.
  - `src/menu/`: the map, locker and overlays.
  - `src/practice/practice.ts`: the steps, judging and `createMachine`.
  - `src/bot/personality.ts`: the Personalities.
  - `art/scripts/rooftop.py`, `beach.py`, `machine.py`: the new art.
- **Playtesting in a hidden tab:**
  - `window.dink.advance(ticks, drive?)` steps the Sim.
  - `window.dink.frames(n, dt)` runs whole frames, including Replays and menus. It is needed because rAF pauses in hidden tabs.
  - Flags: `?play`, `?venue=park|rooftop|beach`, `?practice`, `?bot=`, `?personality=`, `?sunset`, `?debug`.
- **The user's own dev server (port 5173) served a stale, empty module once**: `assets.ts` was caught mid-write. If an import suddenly "does not provide an export", `touch` the file and reload.
- **The user has their own saved settings and colors in localStorage on port 5173**, for example Easy and Sunset. Don't clear them; clean up only what you write yourself.

## The issues

Each has what the user said, where to look, a cause (labelled **hypothesis** where unverified; confirm before fixing), and how to check the fix. Suggested order: 6, 2, 1, 5, 3, 4. Code and tests first, then art. Commit each concern separately, since the user likes small commits.

### 1. The Replay sometimes stutters at its end

> "sometimes the replay stutters at the end and looks unnatural"

- **Where:** `main.ts` `playReplay` / `endReplay`, `src/replay/replay.ts`, and `Renderer.cut()` / `onEvents`.
- **Hypotheses, check each:**
  1. **The cut back to live jumps.** The live Match paused about 0.6 s after the Fault (`replayDelay`), so when the Replay ends, the view jumps from the Fault tick to the live state 36 Ticks later. Players and the ball teleport, and the Characters' smoothed pose state (walk phase, hand targets) jumps with them.
     - Fix option: end the Replay by holding its last frame briefly and fading.
     - Fix option: hold the live Match exactly at the Fault tick while the Replay is pending, and resume from there.
     - Fix option: resume the live view at the start of the next Serve instead of mid dead pause.
  2. **The last frame is short.** `advance` clamps `clock` to `last`, so on the final frame `alpha` is 0 and the clip shows `prev`, not `curr`. It may skip or double the last Tick.
  3. **Swings replay oddly.** `renderer.onEvents` gets the Replay's hits, and `lastHit` keeps a Replay tick. After the cut, live Ticks are newer, so an old swing can replay briefly.
- **Check:** force a Fault with a Bot driving Side 0 (see the handoff-03 recipe), then step `dink.frames(1)` around the end of the Replay. Log `dink.replay?.curr.tick`, `dink.state.tick` and the players' positions, and screenshot a few frames either side of the cut. `test/replay.test.ts` covers the clip. Add a test there if the fix changes clip behaviour, such as holding the last frame.

### 2. The Bot stops and stutters sideways when it leaves a ball going out

> "if I hit the ball and the ball is going out, the bot will stop and stutter slightly to the right or left. this also happened one time when I hit a lob and it stayed in but it was close"

- **Where:** `src/bot/bot.ts`, `think()`:
  - the `leave` logic, with `OUT_MARGIN`
  - `readySpot()`
  - `moveTo()`
- **Hypotheses:**
  1. **The ready spot moves with the ball.** Once `leave` is set, the Bot heads to `readySpot`, whose `x` shades toward `o.ball.pos.x * 0.45`. A ball flying wide drags that spot sideways every Tick, so the Bot jitters left and right. `moveTo` brakes near the spot and re-accelerates as it moves.
  2. **A near-line read flips.** `leave` is only rolled while `bouncesSinceHit === 0 && !leave`, and uses the noisy prediction (`error` × `errorShare`). A close lob that stays in can be misread as out, and the Bot gives up on it. That is legitimate at easy, but at harder Difficulties it looks like a bug. Consider keeping the Bot committed to near-line balls, or leaving only when the read is out by a clear margin.
  3. **The dead phase freezes it.** After the ball is dead, `think` returns `idle` (move 0) whenever the phase isn't `rally`, so the Bot decelerates and stops dead mid-stride. Consider walking back to a ready spot in `dead`.
- **Behaviour wanted:** when the Bot lets a ball go, it should calmly settle into position and not twitch sideways. It shouldn't give up on a close ball that lands in.
- **Check:** use a throwaway Vitest file (`test/_measure.test.ts`; delete it before committing). Feed balls that go out, then log the Bot's `move` Intents per Tick after `leave`, and count sign flips of `move.x`. Re-run `test/bot.test.ts`. The golden test pins a score, so update the pin deliberately and tell the user.

### 3. Rooftop: some props overlap

> "on rooftop, some of the vents overlap each other"

- **Where:** `art/scripts/rooftop.py`, `build()`. Props are placed in turned pairs: `turned(x, z)` gives (x, z) and (−x, −z).
- **Found while writing this (verify in the preview):** the AC units overlap.
  - `turned(-9.5, -4.0)` puts a unit at (9.5, 4.0).
  - `turned(9.8, 3.5)` puts one at (9.8, 3.5), about 0.6 m away from it.
  - Each unit is 1.6 × 1.1 m, so they intersect.
  - The same happens mirrored at (−9.5, −4.0) and (−9.8, −3.5).
  - These are the stacked-looking AC boxes on the right in `e2e/__screenshots__/rooftop.png`.
- **Also check:**
  - the two vent pairs at `turned(-6.5, -15.6)` and `turned(-7.4, -15.9)`, which are only 0.95 m apart
  - that no other pair lands on a partner of another prop
- **Fix:** move or drop the clashing props. Better, add a small overlap check in the script: assert that no two footprints intersect.
- **Check:** `npm run art -- rooftop`, then look at `art/previews/rooftop.png` and `rooftop-wide.png`. Re-accept the e2e references deliberately (`npm run e2e -- --update-snapshots`) and look at the new PNGs.

### 4. Beach: the water doesn't look good

> "on beach, the water does not look good"

- **Where:** `art/scripts/beach.py`, `build()`, the section starting at `step = 2.0`.
- **Why it looks bad** (visible in `e2e/__screenshots__/beach.png` and `art/previews/beach-wide.png`):
  - The shoreline is a staircase of 2 m boxes (wet sand, foam and shallows per step). It reads as jagged steps, not a curve.
  - The foam strips are blocky.
  - The deep water is one flat slab with a hard edge against the shallows.
- **Ideas:**
  - Build the shallows, foam and wet sand as continuous strips that follow `shore(z)` with many segments: a bmesh face strip, not boxes. `lib.Builder` only has box, prism and blob, so add a helper there if needed.
  - Give the shallows a gradient: two or three bands of sea color.
  - Draw the foam as thin curved bands.
  - Scatter a few low wave crests on the water.
  - Keep one mesh, and keep the Beach under about 25k triangles (it's about 16.7k now).
  - A subtle animated wave in the renderer is possible, but it would be a new renderer feature. Ask the user first.
- **Ask the user** what they dislike most (the jagged shore, the colors, or that the water is static), and show them the preview before re-accepting the e2e references.
- **Check:** `npm run art -- beach`, the previews, then the e2e references.

### 5. Recalibrate Difficulty: the old medium becomes hard, and a new medium goes between

> "I was not able to score any points against the hard bot after multiple attempts. The medium bot is providing me with a very tight game... Easy seems calibrated right. I want to make the current medium bot actually be the hard bot, and we need to recalibrate the medium bot to be somewhere between the new hard bot and easy bot"

- **Where:** `DIFFICULTY` in `src/bot/bot.ts`.
- **Change:**
  - The new `hard` is today's `medium` values exactly.
  - The new `medium` sits between `easy` and the new `hard`: roughly the midpoint of each field. Round sensibly; `reactionTicks` is an integer.
  - `easy` stays as it is.
- **What else depends on it:**
  - **`test/bot.test.ts`** uses `DIFFICULTY.medium` for the golden test (pinned score and tick) and for the `handicapped()` baselines. Switch these to `DIFFICULTY.hard` so they keep testing the same numbers, and the pin shouldn't move. Confirm the golden test still passes unchanged.
  - **`test/personality.test.ts`, `test/replay.test.ts` and `e2e/venues.e2e.ts`** use medium Bots. Either switch them to `hard` (the same behaviour as before) or re-measure.
  - **The rally-win rates in the comment in `src/bot/personality.ts`** were measured against medium. Re-measure against the new medium, or note which Difficulty they're against.
  - **`src/practice/practice.ts`** builds `MACHINE` from `DIFFICULTY.hard`. The new hard is sloppier (old medium), and the overrides only zero `lateCommit`, `offCenter`, `unforcedError` and `aimNoise`. Check the machine still feeds reliably: its reaction, move speed and prediction error get worse. It is probably best to give the machine its own explicit values rather than inheriting from a preset.
  - **`test/practice.test.ts`** stands in for the Player with a `hard` Bot. Re-run it.
  - **Saved progress:** stars already earned are stored by name (`easy`, `medium`, `hard`) in localStorage. They keep their names; a star earned at the old medium now reads as the new hard, which is the same Bot, so that's fine. Mention it to the user.
- **Measure:**
  - Bot-vs-Bot baselines per level (hits per Rally, server win rate), as in `handicapped()` and the 07 notes in `.scratch/v1/issues/07-bot-difficulty.md`.
  - The new medium against the new hard should be clearly weaker but not hopeless.
- **The user has to confirm by playing.** End with what to test, and name the debug panel's Bot folder, which binds the preset picked at page load.

### 6. Practice: the machine chases balls it won't hit, and they pass through it

> "in practice, after you complete the task, the robot chases the ball and it phases through him... the robot should stop moving after it gives you its last task (for example, if your task is to serve to the robot and then return after, the robot should hit it back once then stop moving. on the first turn, it should not move at all. basically, it should never chase the ball when it does not need to hit it back.)"

- **Where:** `createMachine` in `src/practice/practice.ts`. Today it wraps a full Bot and only edits `shot`. Its movement is always the Bot's, so after its last feed it keeps running at the ball. There is no ball-to-machine collision, so the ball visibly passes through the robot.
- **Behaviour wanted:**
  - The machine moves only when it still has a feed to hit this rep: some hit number greater than `o.shots` in `step.feeds`.
  - After its last feed it stands still: move `{0, 0}`, no shot.
  - In step 1 (it serves once, then nothing) it never moves.
  - In step 2 (the Player serves, the machine returns once) it moves to return, then stops.
  - In steps 3 and 4 (it serves, and later feeds hit 3) it moves only to reach hit 3.
  - Free play (`feeds: null`) keeps the full Bot.
- **Keep it Intent-only (ADR-0003):** decide from the Observation (`o.shots`, `o.phase`) and return an Intent with `move: {x: 0, y: 0}` when idle. Still call `bot.think(o)` every Tick, so the Bot's internal per-ball state stays consistent if it plays again, then override its move.
- **Serve phase:** the Bot's serve logic doesn't move the server, but check that the receiver-side ready movement in the step's own serve phase doesn't make the machine wander.
- **Ball through the machine:** once it stands still, a ball can still fly through it if it's in the path. That is probably acceptable (it's where the ball was fed from). Mention it to the user rather than adding collision to the Sim; collision would be an ADR-0001-level change.
- **Test** in `test/practice.test.ts`, "The ball machine" block, which already runs reps with a stand-in Bot:
  - After the machine's last feed, its position doesn't change for the rest of the rep. Compare `s.sides[1].players[0].pos` per Tick.
  - In step 1, it never moves at all.

## Conventions and gotchas that bit last time

- **Line endings:** files are a mix of LF and CRLF. When scripting edits with Python or Node, preserve the file's line endings. The Edit tool handles this.
- **Heredocs:** Bash heredocs that contain Python triple quotes or backticks failed twice. Put scripts in the scratchpad and run them from there.
- **`npm run art -- <name>`** rebuilds one asset. Ogg files differ by a random stream serial on every build, so don't commit a rebuilt `park-ambience.ogg` if its samples didn't change. `git checkout` it back.
- **e2e references:** they change with any art or Difficulty change visible at the start of a Match. Re-accept them deliberately and look at every new PNG.
- **Commit trailers:** use the ones in the conversation's system reminder. Separate small commits per concern.

## When done

- Append a `## Comments` entry to `.scratch/v1/issues/05-dink-city-shell.md` listing the fixes and commits.
- Give the user a short list of what to playtest, each item with its URL flag or debug slider:
  - `?play&bot=medium`
  - `?play&venue=rooftop`
  - `?practice`
  - forcing a Fault for the Replay
- Then move on to issue 06, `.scratch/v1/issues/06-*.md`.
