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
