# 12: Online time rules, leaving a Match, and stalls

Status: ready-for-agent
Blocked by: 11

Spec: `docs/MULTIPLAYER.md` Phase 5 (the first two bullets and "A tab going hidden"), Part 1 §1 "Online impact" and §6 (frame-dependent Sim time); ADR-0004, "Online presentation (v1)".

## Read first

- `CONTEXT.md` Online play, ADR-0004, `docs/MULTIPLAYER.md`.
- Issues 04, 07, 09 and 11 and their comments.
- `src/main.ts` (modes, pause overlay, `MAX_FRAME`), `src/match/online.ts`.

## Goal

Online, nothing bends the Court's clock, and leaving or stalling behaves sensibly. Offline is unchanged.

## Scope

**No time distortion online.** Audit `OnlineMatch` and `main.ts` for each, and test them:
- No Fault Replay: the banner shows, `view.replay` is never called.
- No hit-stop.
- `gameSpeed` is fixed at 1. If a `?debug` Game-speed edit exists, it's ignored online.

**Stalls:**
- A long frame (`MAX_FRAME` cap), a background tab, or a debugger pause must not drop Sim time online.
- On resume, the client resyncs to the Court's clock (issue 07). It jumps the prediction to the next Snapshot rather than fast-forwarding thousands of Ticks. The Court meanwhile ran the missing-input decay (07), so the Player stood still.
- Test the resync path in the harness: a client stalls for 3 s and comes back.

**Pause online:**
- Esc opens a "Leave match?" overlay. It never pauses the Sim, and the Match keeps running behind it.
- Leaving:
  - Closes the socket and says so to the Court (`leave`), so the grace timer starts at once rather than on socket timeout.
  - Returns to the map.
  - Clears the seat token, so the Player won't rejoin by accident.
- Closing the tab or reloading still uses the grace and rejoin path from issue 02.

**Opponent status in the Hud:**
- "<name> disconnected…" while their grace runs.
- Cleared when they rejoin.
- If they leave for good before issue 14 exists, the Match ends: "<name> left." then back to the map. Issue 14 replaces this with the Takeover Bot.
- Protocol: `peer { side, status }` from the Court.

## Acceptance

- The tests are green, and all root checks pass. Offline Replays, hit-stop and Game speed are unchanged (e2e green, no screenshots re-accepted).
- The agent checks in Playwright, in a two-window Match:
  - A Fault shows the banner with no Replay.
  - Esc opens "Leave match?" while the opponent keeps playing.
  - Hiding one tab for 10 s makes its Player stand still, and the view resyncs cleanly on return.
  - The disconnect notice appears and clears on rejoin.

## Out of scope

Rematch (13) and the Takeover Bot (14).

## Comments

### 2026-10-02: implemented

One commit, "Online play: no time distortion, leaving a Match, stalls and the opponent's status" (the one that adds this comment).

**What was built:**
- **No time distortion (audit):** `OnlineMatch` never calls `view.replay`, has no hit-stop, and never reads `viewTuning`, so `?debug`'s Game speed does nothing online. Tested: a Fault and a smash are told with no Replay, and with `gameSpeed = 0.5` the drawn clocks still run one Tick per Tick of real time.
- **Stalls:**
  - `OnlineMatch.frame` runs its timelines on its own clock (`now()`), not the `dt` that `main.ts` caps at `MAX_FRAME`. So a long frame, a hidden tab or a debugger pause drops no time.
  - The Interpolated timeline resyncs whenever it's more than 30 Ticks off, in `push` as well as `advance`. It jumps to 100 ms behind the newest Snapshot, drops the waiting events it passed over (outcomes were already told), and prunes Snapshots it won't draw. That bounds a hidden tab's memory, which used to keep every Snapshot (64 after 3 s in the harness).
  - The prediction already waited past `MAX_PREDICT_TICKS` and picked up from the next Snapshot. The input stream skips gaps over 8 Ticks. Both are now covered by tests for a stall with and without Snapshots arriving.
- **Leaving:**
  - Protocol 6 adds `leave`, and `peer { side, status: 'connected' | 'grace' | 'gone' }`.
  - Online, Esc opens "Leave match?" (Keep playing / Leave) and the Match plays on behind it.
  - Leave calls `CourtLink.leave()`: it sends `leave`, forgets the seat token, and closes. Then the page reloads to the map.
  - The Court treats `leave` as a disconnect at once (the grace starts) and closes the socket.
  - Closing or reloading a tab sends nothing, so it still rejoins.
- **The opponent's status:**
  - `courtSeats.changes(before, after)` (pure) lists the seat statuses that changed after the start. The Court sends each change to the other Player.
  - The Hud shows "<name> disconnected…" (or "<name> left.") under the score.
  - On `start`, a rejoining Player sees "disconnected…" if their opponent isn't connected.
  - Until issue 14, a seat going `gone` before the Match is over ends it: the Court sends `peer gone`, stops ticking, reports `end` and closes. The other screen shows "<name> left." and returns to the map after 4 s. After the Match is over, `gone` only updates the notice.

**Tests:** 39 files, 437 tests (before: 427). Typecheck (root and `party/`), build, and e2e 19/19 all pass, with no screenshots re-accepted. The golden Bot result is unchanged.
- interpolation +3: resync on a far Snapshot; a long frame jumps without telling what it skipped; an outcome survives a resync.
- onlineMatch +3: time rules; a hidden-tab resync; a debugger-style stall with no Snapshots, which waits for the next one and steps only the Ticks stamped since.
- harness +1, "a stalled client". The harness frame now mirrors the wall-clock advance. A client hidden for 3 s:
  - The Court stood it still (every fill after the fade was zero).
  - Nothing but outcomes was heard meanwhile.
  - On its first frame back, the remote Player is drawn 6–18 Ticks behind the Court, and local now is under 15 Ticks ahead.
  - Nothing is heard twice, and the prediction is exact again within a second.
- courtSeats +2 (`changes`), protocol +1 and guards.

**Playwright, two contexts on `wrangler dev` + Vite, medium Bots on both screens:**
- **A Fault:** both screens showed the "POINT" double-bounce banner. `#replay-tag` never showed, and `dink.replay` was null.
- **Esc on the Host:** "Leave match?" showed, not the pause menu. Over 2 s, both screens' clocks moved about 122 Ticks; Keep playing went back to `match`.
- **Hidden 10 s:** Playwright keeps pages `visible`, even minimized. Off-screen, it throttled them to 1 fps, which the client handled, resyncing each second. So the hide was done by withholding `requestAnimationFrame` for 10 s while the socket kept delivering, as a hidden tab does.
  - The Guest saw the Host's Player at only 5 positions (Serve resets) over the last 9 s.
  - The Host's first frame back drew local at Court + 2.2 Ticks and remote 8.6 behind, then ran smoothly; it didn't fast-forward.
- **Disconnect:** the Host navigated away, and the Guest showed "Hosty disconnected…". The Host returned by the link, rejoined Side 0, and the notice cleared.
- **Leave:** the Host was back on the map with no `dink.court.*` token. The Guest showed "disconnected…", then after the 30 s grace "Hosty left.", and was back on the map 4 s later.

**Notes:**
- `leave` starts the 30 s grace rather than ending the seat at once, as the issue says, so the opponent waits 30 s to learn the Player left. Issue 14's Takeover Bot comes at the end of the same grace.
- A hidden tab still tells events as Snapshots arrive: outcomes, plus local-half bounces and nets from reconciling. Their sounds play in the background, as before this issue.
- A Player reloading after the Match is over, whose opponent is `gone`, sees "disconnected…" rather than "left.": `CourtPlayer.connected` can't tell grace from gone.
- If the remaining Player is themselves in grace when their opponent goes `gone`, they miss `peer gone`. The Court closes, so their rejoin gets the generic close message. This is acceptable until 14.
- From the review: the client also treats a `gone` after the Court's `over` as the Match over, even before a Snapshot shows it.
