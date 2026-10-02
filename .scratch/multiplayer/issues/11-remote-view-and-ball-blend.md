# 11: The remote Player on the Interpolated timeline, the ball clock blend, and the online event policy

Status: ready-for-agent
Blocked by: 10

Spec: `docs/MULTIPLAYER.md` Part 3, "Timelines on each client" (Interpolated timeline, Ball clock blend, Events), and Phase 4 with its exit criterion; `CONTEXT.md`, **Interpolated timeline**.

## Read first

- `CONTEXT.md` Online play, ADR-0004, `docs/MULTIPLAYER.md`.
- Issues 04, 09 and 10 and their comments.
- `src/render/renderer.ts` (`render(prev, curr, alpha, dt)`, `onEvents`, `pose`, `lerpVec`) and `src/match/driver.ts`.

## Goal

The remote Player's swings line up with the ball, and the ball arrives on local time for the local hit. Outcomes (Faults, points) are never shown and then taken back. This is Phase 4's exit criterion.

## Scope

**A composed view** for the renderer, built by pure, tested code (`src/net/composeView.ts` or similar). Each frame gives the renderer one `(prev, curr, alpha)` whose:
- **local Player** comes from the Predicted timeline;
- **remote Player** comes from the Interpolated timeline, about 100 ms behind the newest Snapshot. Their `swing`/`commit` come from there too, so remote swings follow confirmed hits;
- **ball** is drawn on a clock that slides between the two.
  - On, or heading to, the local half, it follows local "now". On, or leaving, the remote half, it follows remote interpolated time.
  - The ball's path since its last launch is a known function of the Tick, so draw it by re-stepping or integrating from the launch state to the blended Tick. That must be pure, and cheap enough per frame; measure it.
  - Cap the blend. Past about 250 ms of latency, accept small snaps.

The renderer's other inputs (`predictContact` for the wind-up, `predictLanding`, the trail) must still make sense on a composed state. Check each, and write down anything that reads a whole state.

**The event policy**, finalizing issue 09's rule. Write it into `docs/MULTIPLAYER.md` Part 3 if it differs:
- Local `hit`, local-half `bounce` and net events play immediately, from the prediction.
- Remote hits play when the remote swing is drawn, on the interpolated clock.
- `dead`, `rally-won`, scores, `game` and `match` come only from the Court, and the Fault banner shows with no Replay.
- A predicted local hit the Court rejected is corrected once, visibly but without a second sound.

**Tests:**
- `composeView` unit tests at 0, 100, 150 and 300 ms, with the ball crossing the net both ways: continuous positions, the blend capped, and each Player coming from the right timeline.
- Harness: no event plays twice, and no outcome event is ever shown and then retracted.

## Acceptance

- The tests are green, and all root checks pass. Offline play is unchanged (e2e green, no screenshots re-accepted).
- **Phase 4's exit**, checked by the agent in Playwright at 150 ms throttling and confirmed by the user by hand:
  - Rallies feel like single-player for the hitter.
  - Remote swings line up with the ball.
  - There are no ghost points.
- Mark Phase 4 done in `docs/MULTIPLAYER.md`.

## Out of scope

The online time rules, pause, rematch and the Takeover Bot (12–14).

## Comments

### 2026-10-02: implemented

One commit, "Online play: the remote Player interpolated, the ball clock blend and the event policy" (the one that adds this comment).

**What was built:**
- **`src/net/composeView.ts`** (pure). `composeView(input, lastBallClock)` gives the renderer one frame: `prev`/`curr` a Tick apart, drawn at alpha 1, plus `Clocks`, the Tick each Player and the ball are drawn at.
  - The local Player comes from the Predicted timeline, at local now.
  - The remote Player, their `commit` and `swing` included, comes from the Snapshots, at the Interpolated timeline's Tick.
  - The ball is sampled from a **track** of every Tick known: the Snapshots, and the prediction from the newest one on (`extendTrack`). So it needs no re-stepping, and a frame costs about 5 µs.
  - The blend: the ball's lag behind local now is linear in time over each flight. It's the whole gap when the remote swing is drawn and none when the local Player meets the ball. When the ball is met is read from the track once local now has passed it, or reckoned from the ball's speed.
  - The gap is capped at 24 Ticks (about 250 ms of round trip).
  - The ball runs at ¼× to 4×. A ball returned faster than 4× can catch up (a flight under about 4/3 of the gap: a smash, a quick volley exchange) jumps to the local racket as the local Player hits it. The hitter's view wins.
  - `phase` is `over` exactly when the Court's newest Snapshot says so.
- **`src/net/interpolation.ts`** (pure): the Interpolated timeline. It buffers Snapshots, and its clock runs with real time, eased toward 6 Ticks behind the newest. It also decides when the Court's events are told (below).
- **The predictor:**
  - `reconcile` now returns the Court's unpredictable events separately (`court`).
  - It exposes its states since the base (`states`) for the track.
  - It matches events told by kind and hitter within `SAME_EVENT_TICKS = 4`, which closes issue 09's "an event whose Tick moves plays again" gap.
- **`OnlineMatch`** composes each frame. Its `prev`/`curr` are now the drawn view. `predicted`, `remoteTick` and `clock` are exposed, and `window.dink.online.clock` is there for playtests.
- **The renderer and the `MatchView.draw` seam** take optional `Clocks`. A Player's swing is timed on their own clock, and the wind-up is counted from the ball's clock to the Player's. Offline nothing is passed and nothing changes.
- **`onEvents`** uses the event's own Tick when it carries one, since a Snapshot can be a Tick after its hit.

**What reads a whole state** (written in `composeView.ts` and Part 3):
- `predictContact` (the wind-up) reads a Player and the ball. The two clocks agree at Contact.
- `predictLanding` and the trail read only the ball.
- Phase, score and ends come with the ball.

**The event policy** (now in `docs/MULTIPLAYER.md` Part 3):
- The local `hit`, a local-half `bounce` and `net` are told from the prediction.
- Remote hits and remote-half bounces are told when the Interpolated timeline passes them.
- Outcomes are told as their Snapshot arrives. They're final, because the Court holds them for the Rewind window, and by then the drawn ball is past them. Any event still waiting from before an outcome is told first.
- A rejected local hit is corrected by the next Snapshot, with no second sound.

**Tests** (39 files, 427 tests; before: 37 and 370). Typecheck, build and e2e pass (19/19; a venue screenshot flaked once and passed on rerun). The golden Bot result is unchanged.
- **composeView.test.ts** (43): a hard-Bot Rally replayed at 0, 100, 150 and 300 ms, for each Side, with the ball crossing the net both ways. It checks that:
  - each Player comes from the right timeline;
  - the ball is drawn where its clock says, and the lag is capped;
  - the ball runs at ¼× to 4×, jumping only onto a local racket for a shot too fast;
  - the local hit is met on the very frame;
  - the remote launch comes within a frame of the remote swing, or by at most the gap past the cap at 300 ms.
  - Plus `extendTrack`: the newest prediction replaces the old one, and an old prediction that was wrong about the last hit is dropped.
- **interpolation.test.ts** (7): the clock's start, easing, cap and jump; pruning; outcomes told at once and the rest on the clock; ordering around an outcome.
- **Harness** (+3, at 150 ms, 30 ms jitter and 5% loss, three seeds of 60 s):
  - every event heard is a distinct Court event, so nothing plays twice and nothing is a ghost;
  - every outcome heard is the Court's, Tick and all;
  - remote hits are heard on the frame the Interpolated clock passes them;
  - the ball meets every local hit on the frame, and the remote swing within a frame for at least 75% of hits, never late.
  - The 300 ms stall test also checks that nothing repeats within 4 Ticks and that no outcome is a ghost.
- onlineMatch (+4), prediction (+1).

**Phase 4's exit, in Playwright.** Two contexts on `wrangler dev` + Vite, with the real GPU and the 75 ms each-way WebSocket shim (RTT 165–168 ms, lead about 6.2 Ticks). Medium Bots drove both screens. Each page recorded its drawn clocks every frame, and every event heard.
- **Two full Quick Matches** (13–11 in 183 s, and 5–11 in 152 s, the second on the final code), with no page errors.
- **Outcomes** (48 heard on the final code): identical, Tick for Tick, on both screens. None was repeated or taken back, so there were no ghost points.
- **Local hits:** heard with the drawn ball 0–1 Tick before the hit Tick. Each was told the frame it was stamped, so the ball meets the swing.
  - 1 of 27 on the Host and 1 of 29 on the Guest was a return too fast to catch up with, so the ball jumped to the racket.
- **Remote hits:** heard 0–1 Tick after the Interpolated clock passed them, with the ball within 1 Tick of the remote clock for 24 of 29 and 23 of 27. The rest were fast exchanges, up to 3.5 Ticks off, plus one 19.5 that was a too-fast return.
- **The ball's clock** never ran backwards. The only jump over 4× in a Rally was the too-fast return (12.5 Ticks); the others were about 1 Tick.
- **Nothing was heard twice.**
- **Phase 4 is marked done in `docs/MULTIPLAYER.md`, pending the user's own check by hand at 150 ms.**

**Notes:**
- **The gap is bigger than the doc guessed.** With the 100 ms of interpolation, the timelines are about 18–20 Ticks apart at 150 ms. So a 1 s flight runs about 40% fast coming in and 25% slow going out, not the 10–15% the doc guessed. Fast drives and smashes at the net are too fast to bridge, so the ball jumps to the hitter's racket rather than leaving the remote racket early. Lowering `INTERP_DELAY_TICKS` would shrink the gap; I left it at 100 ms.
- **Offline swing timing is a Tick early.** The offline renderer times swings from `curr.tick + alpha`, a Tick ahead of where the ball is drawn. Online now uses the true clock, so online swings sit about 16 ms later relative to the ball than offline. I left offline unchanged.
- **One case `extendTrack` can't catch:** a remote hit the prediction guessed earlier than the true one, between two Snapshots. Telling it from the hit before needs the Snapshot before. It's off for about a Tick.
- **The harness mirrors `OnlineMatch.frame`** (the alpha and the composing) instead of sharing it, as it already did for input.
