# 04: `OnlineMatch`: play a naive online Match in the browser

Status: ready-for-agent
Blocked by: 03

Spec: `docs/MULTIPLAYER.md` Phase 2 ("Client"), Part 3 "Timelines on each client" (only the interpolation part for now); ADR-0004, "Online presentation (v1)".

## Read first

- `CONTEXT.md` Online play, ADR-0004, `docs/MULTIPLAYER.md`.
- Issue 01's comments, **especially the `MatchView` seam** (`src/match/driver.ts`, `src/match/local.ts`) and the list of `LocalMatch`-only members `main.ts` still uses.
- Issues 02–03 and their comments, for the protocol and the Court.

## Goal

Two browsers play a full Match through the Court. Each client sends its Intents and draws the Court's Snapshots, interpolated about 100 ms behind, for both Players and the ball. There's no prediction yet, so it's only good at low ping. It proves the whole pipe end to end, with the local Player on either Side.

## Scope

**Party host:** `import.meta.env.VITE_PARTY_HOST`, defaulting to `localhost:8787` in dev. The production value comes in issue 16.

**A thin connection module** (e.g. `src/online/connection.ts`):
- It wraps the WebSocket (`partysocket` is fine) and the protocol.
- It keeps the seat token in `sessionStorage` under the Court code, so a reload rejoins the same seat.
- **It's the only online file that touches the DOM or sockets.** Keep it out of `src/net/`, whose boundary test forbids that.

**`OnlineMatch` (`src/match/online.ts`)** implements `MatchDriver`:
- `local` is the seat from `welcome`, so it can be 1.
- Every Tick of its own 60 Hz accumulator, it samples `Input` and sends `in` with `quantizeIntent`.
- It buffers Snapshots and draws them about 100 ms behind the newest, interpolating between the two around the render time. `prev`, `curr` and `alpha` go to `view.draw`.
- It delivers Snapshot `events` through `view.tick(state, events)` **once each**, as their Ticks are drawn, so sounds, swings and banners fire once.
- No Replay (`view.replay` is never called), no hit-stop, and Game speed is 1.

**`main.ts`:**
- Picks the driver. This is the place to settle how `window.dink` (`rally`, `replay`, `practice`, `advance`) behaves online. Keep the offline API unchanged and document the online behavior.
- Online:
  - The renderer, Hud and colors use the local Side. The opponent gets the Venue Bot's colors for now, and the Hud's other name is the opponent's Display name, not "BOT".
  - No progress or unlocks (`onMatchWon` is skipped).
  - Practice is unavailable.
- Hud needs a way to show the opponent's name. Add it, and test it if it has logic.

**Dev entry**, until the menu panel lands in 06:
- `?court=CODE&name=Ana` joins.
- `?host=standard&name=Ana` creates a Court and shows the code.
- Both are dev-only (`import.meta.env.DEV`), so production can't reach online play before issue 16.

**Tests:**
- Unit-test `OnlineMatch`'s buffering, interpolation choice and once-only event delivery with a fake connection and a fake `MatchView`.
- Test that the local Side 1 draws mirrored, which reuses `localView`.

## Acceptance

- On `npm run party` plus `npm run dev`, two browser windows (one `?host=…`, one `?court=CODE`) play a Match to the end.
  - Each sees itself at the bottom.
  - The score, Fault banners, sounds and call-outs are right for each side.
  - The agent verifies this with two Playwright pages, driving both Players with Bots through `window.dink`. Create each Bot at the start of a Serve; see issue 01's "Found" note about a Bot created mid-Serve.
- A reload mid-Match rejoins the same seat.
- Offline Match and Practice are unchanged (e2e green, no screenshots re-accepted). The golden result holds.
- The production build has no reachable online entry point.

## Out of scope

The menu panel and Lobby (05–06), clock sync and prediction (07–09), and the online time rules (12). A local hit feeling late at high ping is expected for now.

## Comments

### 2026-09-30: implemented

One commit, "Online play: two browsers play a Match through the Court" (the one that adds this comment).

**What was built:**
- **`src/match/online.ts`, `OnlineMatch`** (a `MatchDriver`):
  - Sends `in` with `quantizeIntent` every Tick of its own 60 Hz accumulator. The Tick label starts at the newest Snapshot and only rises; issue 07 replaces it with a synced clock.
  - Buffers Snapshots and draws them `INTERP_DELAY_TICKS = 6` (100 ms) behind the newest. The render clock runs in real time, eases toward that target, jumps when it's more than 30 Ticks off (a rejoin or a stall), and never passes the newest Snapshot. `prev`/`curr`/`alpha` are the two Snapshots around the drawn Tick.
  - Tells each Snapshot event to `view.tick` once, when its Tick is drawn, with the Snapshot it came in. There's no Replay, no hit-stop, and Game speed is 1.
- **`src/online/connection.ts`**, the only online file with sockets or storage:
  - A plain `WebSocket`, not partysocket: no new dependency, and no auto-reconnect (a dropped socket says "Reload to rejoin").
  - `createCourt` (`POST /create`) and `joinCourt` (hello, then every guarded Court message).
  - The seat token is stored in `sessionStorage` under `dink.court.<CODE>`.
  - The host is `VITE_PARTY_HOST`, defaulting to `localhost:8787`: plain http/ws for localhost, TLS anywhere else.
- **Protocol:**
  - `start` now carries `players`, because the Host's `welcome` comes before the Guest is seated, so it can't carry the opponent's name. `PROTOCOL_VERSION` is 2.
  - `isCourtMsg` guards Court→client messages (left open from 02).
  - `COURT_CLOSE = 4000` names the close code.
  - The Court builds `start` in one `startMsg()`.
- **Renderer:** walking velocity, swing time and Contact time now allow for `prev` and `curr` being more than one Tick apart (Snapshots are 2 apart). With 1 Tick they reduce to the old formulas, and no screenshot moved.
- **Hud:** `setOnline(local, opponent)` sets the local Side and the opponent's Display name (in the scoreboard, "Ana wins the game", "ANA WINS"), and drops the rematch hint. There's no Hud test, because the logic is string formatting on DOM nodes; the Playwright run checked it.
- **`main.ts`:**
  - `offline` (the `LocalMatch`) is separate from `match` (the driver in play), and both drivers share one `MatchView`.
  - Dev only: `?host=quick|standard|long&name=Ana` creates a Court and rewrites the URL to `?court=CODE`, so a reload rejoins as the Host. `?court=CODE&name=Bea` joins.
  - A status overlay covers connecting, waiting, errors and disconnects.
  - Online, the local Side uses the Locker colors and the other Side the Venue Bot's colors. There are no progress or unlocks, and Practice is unavailable.
  - Pause keeps the Match running (the Court doesn't wait) and sends idle input. Quit, or Esc after the Match, reloads the page offline.
- **`window.dink` online:**
  - `state` is the state drawn.
  - `rally`, `replay` and `practice` are null.
  - `advance` and `startPractice` throw.
  - `online` gives `{ side }`, and `drive = fn` drives the local Player with `fn(newest Snapshot state)` once per Tick.
  - The offline API is unchanged.

**Results:**
- Tests: 30 files and 272 tests pass. There are 11 new `OnlineMatch` tests (buffering, the delay, interpolation, the stall jump, dropping old Snapshots, once-only events including across a jump, rising input labels, and Side 1 mirrored through `localView`) and 1 new protocol test.
- The golden result is unchanged.
- Typecheck (root and `party/`), build and e2e (16/16, no screenshots re-accepted) all pass. The handshake smoke passes 13/13.
- **Production build:** `dist` has no connection or `OnlineMatch` code (no `parties/court`). The `DEV` branch and its dynamic imports are dropped.
- **Two Playwright pages** on `wrangler dev` and Vite:
  - Setup: the Host is at `?host=quick&name=Ana&venue=park`, the Guest at `?court=CODE&name=Bea&venue=beach`, each driven by an easy Bot through `dink.drive`. Each Bot is created early in a Serve and thinks once per Court Tick.
  - Each saw itself at the bottom.
  - The Match ended 11–6 at Tick 9592 on both, in 169 s. The Host showed "YOU 11 / BEA 6" and "YOU WIN"; the Guest showed "YOU 6 / ANA 11" and "ANA WINS".
  - The Host's view was told 17 `rally-won` and 17 `dead` events for 17 points, and one `match`, with no event told twice.
  - The Guest reloaded at 60 s and rejoined Side 1; its new Bot picked up at the next Serve.
  - The Court logged `tick interval stopped at Tick 9592: the Match is over, 11-6`.

**Left for later:**
- A hit's swing is stamped with the Snapshot's Tick and position, up to 1 Tick after Contact. Issue 11 (remote view) can pass each event's own Tick.
- On a jump (a rejoin, a tab back from hidden), every skipped event is told at once, so old sounds and call-outs burst. They still fire once each.
- A reload after `over` shows the final state but no "YOU WIN" banner: `current()` sends no events, and the client ignores `over`.
- A hidden tab stops sending, and the Court keeps its last move (issue 07's decay).
