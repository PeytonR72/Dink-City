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
