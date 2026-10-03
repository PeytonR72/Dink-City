# 13: Rematch in the same Court

Status: ready-for-agent
Blocked by: 12

Spec: `docs/MULTIPLAYER.md` Phase 5 ("Match over offers a rematch…"); ADR-0004.

## Read first

- `CONTEXT.md` Online play, ADR-0004, `docs/MULTIPLAYER.md`.
- Issues 03, 05 and 12 and their comments (the Court's end-of-Match path, Lobby reports, the online Hud).

## Goal

When an online Match ends, both Players can play again in the same Court without going back to the list.

## Scope

**Court:**
- After `over`, the Court stays up (its Tick interval stopped) and accepts `rematch` from each seat.
- When both have asked, it picks a new seed with `crypto.getRandomValues`, starts a new Match with the same Preset and seats, and sends `start`.
- The Court **doesn't** return to the Lobby list.
- Ending, and closing:
  - If a Player leaves while the other is waiting, the waiting Player is told and the Court closes.
  - With no rematch after a timeout (2 minutes by default, a named constant), the Court closes.
  - Either way, report `end` or `close` as issue 05 does.
- Pure logic goes in `courtMatch`/`courtSeats`, with tests: both ask, one asks and the other leaves, and the timeout.

**Client:**
- The Match-over screen offers **Rematch** and **Back to map**, and shows "Waiting for <name>…" or "<name> wants a rematch". This replaces the offline rule of rematching on a shot press.
- A new Match resets the Hud and view state, as offline `newMatch` does.
- Offline rematch stays as it is.

**Protocol:** `rematch` (client → Court) and `rematch { side }` (Court → client).

## Acceptance

- The tests are green, and all root checks pass. Offline play is unchanged.
- In Playwright with two windows:
  - A Quick Match ends, both press Rematch, and a fresh Match starts with a new seed.
  - One presses Rematch and the other leaves: the first is told, and the Court closes.
  - The Court never reappears in the list.

## Out of scope

The Takeover Bot (14).

## Comments

### 2026-10-02: implemented

One commit, "Online play: rematch in the same Court" (the one that adds this comment).

**What was built:**
- **Seat rules (`courtSeats`, pure):**
  - `Seats.rematch` is `{ since, asked }` once a Match is over, and null otherwise.
  - `over(s, now)` starts the wait.
  - `askRematch(s, side)` counts a connected Player's ask and returns `start` once both have asked. An ask that changes nothing returns `s` itself.
  - `leave(s, side, now)`: during the Match it's a disconnect (the grace starts, as in 12). Once the Match is over, the Player is `gone` at once and the Court closes.
  - `expire` closes the Court once the Match is over if either seat is `gone` (a closed tab's grace ran out), or after `REMATCH_MS` (2 minutes, via `rematchTimedOut`). `nextExpiry` schedules it.
- **The Court:**
  - On `over` it stops ticking, starts the wait and reports `end`, then stays up.
  - Each `rematch` is told to both Players (`rematch { side }`).
  - When both have asked, `play(seed)` starts a new Match on a `crypto.getRandomValues` seed, with the same Preset and seats. It sends `start` and doesn't report to the Lobby.
  - The Court now reports `end` only once (`reportEnd`), however many Matches it hosts.
  - A Player who reloads during the wait gets `start`, the Snapshot, `over` and a `rematch` for each Player who has asked.
- **Protocol 7:** `rematch` (client → Court) and `rematch { side }` (Court → client), with guards.
- **Client:**
  - The Match-over panel has **Rematch** (focused) and **Back to map**, plus a line that reads "Waiting for <name>…", "<name> wants a rematch" or "<name> left.". It shows only what the Court has said: the button just sends the ask.
  - A new `start` resets the panel, the over/left flags, the Hud and the renderer, as before.
  - Online, the result banner no longer says "Press Esc…", since the panel has the buttons.
  - If the opponent leaves, the panel says so and disables Rematch, and the Court's close that follows is silent.
  - The 2-minute timeout shows "No rematch: the Court has closed."
  - Offline rematch on a shot press is unchanged.
- **Docs:** `CONTEXT.md` (a Court hosts one Match and then any rematches) and `party/README.md`.

**Tests:** 39 files, 446 tests (before: 437).
- courtSeats +8: both ask (and the next Match can end again); no ask during the Match; no ask from a seat that's away; one asks and the other leaves; a closed tab that never comes back; a reload during the wait; the timeout; `leave` during the Match is a disconnect.
- protocol +1, plus the `rematch` cases in the Court-message guard.

Typecheck (root and `party/`), build and e2e 19/19 all pass, with no screenshots re-accepted. (One run flaked once on the Park screenshot and passed on the rerun and in the final run.)

**Playwright, two contexts on `wrangler dev` + Vite:** a Quick Match, Court EQV8Z. Each screen's `dink.drive` serves at once and never swings, so each Match ended 11–0 in about 40 s. Easy Bots took over 4 minutes to reach 1–1. A third page subscribed to the Lobby throughout.
- **Both press Rematch:**
  - At 11–0, both screens showed the panel with Rematch focused.
  - After the Host pressed, the Host saw "Waiting for Guesty…" with the button disabled, and the Guest saw "Hosty wants a rematch".
  - After the Guest pressed, both were at Tick 0, 0–0, with the banner and panel gone.
  - Seeds (the state's `rng` during the first serve equals the seed): 1784596011, then 4036406745, then 712067603 after a second rematch.
- **One asks, the other leaves:** after Match 3, the Host pressed Rematch and the Guest pressed Back to map.
  - The Guest was on the map with no `dink.court.*` token.
  - The Host's panel showed "Guesty left." with Rematch disabled, and nothing else interrupted.
  - A fresh `hello` to the Court got `not_found`: it had closed.
- **The list:** the Lobby subscriber received only its initial list, which was empty, over all three Matches: the Court never reappeared.

**Notes:**
- Leaving during the wait closes the Court at once only by Back to map (or Esc), which sends `leave`. Closing the tab still goes through the 30 s grace, so a reload keeps the seat. The waiting Player learns of a tab closed for good when its grace runs out.
- A disconnected Player's earlier ask still counts, so the rematch can start while they're in grace. They rejoin into the new Match.
- The 2-minute timeout wasn't run in the browser; the `courtSeats` tests cover it.
