# 15: Two-browser e2e against `wrangler dev`

Status: ready-for-agent
Blocked by: 14

Spec: `docs/MULTIPLAYER.md` Phase 6 (first bullet); Part 1 §7 (tests and tooling).

## Read first

- `docs/MULTIPLAYER.md`, and the comments of issues 06–14 (how each was checked in Playwright; reuse those scripts).
- `playwright.config.ts` and `e2e/*.e2e.ts`: SwiftShader, port 5174, reference screenshots and the perf budget.

## Goal

Online play has a permanent regression test that runs with `npm run e2e`, as offline play does.

## Scope

**Playwright:**
- A second `webServer` for `wrangler dev` on a fixed port.
- Point the client at it through `VITE_PARTY_HOST`.
- Keep `reuseExistingServer`.
- Keep the offline tests as they are, and make sure they still pass whether or not the party server is up.

**`e2e/online.e2e.ts`**, with two browser contexts:
- Create a Court with a name and a Preset, see the row in the other context's list, and join by click.
- Play a scripted Rally through `window.dink`, driving both Players (Bots through the online driver, or scripted Intents), and assert that a point is scored the same on both screens.
- Join by `?court=` link.
- A reload rejoins the seat.
- A Fault shows the banner with no Replay.
- Rematch after a Quick Match. Shorten it if the scripting allows, or leave it to the harness and say so.

**Stability:**
- Run it 5 times in a row, and fix any flakiness at its cause: wait on messages or state, never on sleeps.
- It must finish in under about 60 s.

## Acceptance

- `npm run e2e` runs the offline and online tests green, 5 times in a row.
- No reference screenshots are re-accepted.
- Document in `party/README.md` how to run just the online e2e.

## Out of scope

Deploying (16).

## Comments

### 2026-10-03: implemented

One commit, "Online play: two-browser e2e against wrangler dev" (the one that adds this comment).

**What was built:**
- **`playwright.config.ts`:**
  - A second `webServer`: `wrangler dev` on port 8797, apart from `npm run party`'s 8787.
  - Vite on 5174 gets `VITE_PARTY_HOST=localhost:8797`.
  - `reuseExistingServer` is kept on both.
  - **`workers: 1`.** SwiftShader draws on the CPU. In parallel workers, the venue screenshots timed out and the Quick Match took about 66 s instead of 37. Serial was no slower overall.
- **`e2e/online.e2e.ts`:** the three panel tests are unchanged. Two new tests each open two small (480×270) browser contexts, which are closed after each test. Every wait is on state or DOM, never a sleep; waits on the server allow 20 s.
  - **Create, list, join, play, rematch (about 37 s):**
    - The Host creates a Quick Court.
    - The Guest sees its row (host name, "Quick", "1/2") and joins by click.
    - Each screen names the other Player.
    - **A Fault:** through `dink.drive`, the Host serves a Drive. The receiver steps in to 4 m from the net and volleys it: a Two-bounce Fault.
    - Each screen records its banner with a MutationObserver, because the banner is only up for a few seconds. Both show "TWO-BOUNCE FAULT | … volleyed too early.", REPLAY never shows, and `dink.replay` is null.
    - Both screens agree on the score: the Sim state, and the scoreboard with the local Player first.
    - The rest of the Match: each Player serves and never swings, so it ends 11–0. Both scores agree.
    - Rematch: the Host sees "Waiting for …" and the Guest "… wants a rematch". After both press, the panel hides and both screens show 0–0 with no winner.
  - **Link and reload (about 3.5 s):**
    - The Guest, with a saved name, opens `?court=CODE` and is seated on Side 1.
    - A reload keeps `?court=` and comes back on Side 1, with the Tick moving on.
    - The Host's peer notice clears.
- **Docs:**
  - `party/README.md`: how to run just the online tests (`npx playwright test online`), the ports, the reuse caveat, and why the suite runs on one worker.
  - `docs/MULTIPLAYER.md`: the Phase 6 e2e bullet is marked done.

**Results:**
- `npm run e2e`, five times in a row from cold servers: 21/21 each time.
  - The first five runs took 106–109 s each. The Fault version, five more runs: 117–123 s each.
  - The online file takes about 45 s, the Quick Match test about 37–39 s.
- No reference screenshots were re-accepted.
- The offline tests (and the panel tests) pass with no party server behind them. I checked this with a dummy listener holding 8797.
- Unit tests: 39 files, 454 tests. Typecheck (root and `party/`) and build pass.

**Notes:**
- **Why the waits are 20 s:** under load, the first `/create` of a run took 7 s to answer. The old default of 5 s made Create look stuck on "Connecting…".
- **The Fault:** a double bounce isn't a Fault; it's a winner, and gets no Replay offline either. So the test scripts a real Fault. In a headless Sim with the auto Contact rule, this volley gives a Two-bounce Fault for every distance from 2.5 to 5.5 m and every seed tried.
- **Rematch isn't shortened:** the Quick Match is played in full (11 points at about 3.5 s each). Shortening it would need a server-side change, which wasn't asked for.
- **Run time:** with the servers' start, `npm run e2e` now takes about 2 minutes, up from about 1. The online tests alone take about 45 s.
- **The party server is required:** Playwright starts both servers before any test, so a run where `wrangler dev` can't start (no `party/node_modules`) fails as a whole, offline tests included.
- **Review:** the review's naming nits were applied: `SERVER_WAIT`, the `BannerSeen` type and the `openOnline` helper.
