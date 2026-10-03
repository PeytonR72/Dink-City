# 14: The Takeover Bot

Status: ready-for-agent
Blocked by: 13

Spec: `docs/MULTIPLAYER.md` Part 3, "Takeover Bot and rewind", Phase 5 and its exit criterion, Decision 5; ADR-0004, "Takeover Bot"; ADR-0003; `CONTEXT.md`, **Takeover Bot**.

## Read first

- `CONTEXT.md` Online play, ADR-0004, ADR-0003, `docs/MULTIPLAYER.md`.
- Issue 01's slice 3 (`autoContact`) and issue 08 (the Rewind window). **Rewind must never call `think` twice for a Tick.**
- `src/bot/bot.ts` (`createBot`, whose memory lives in a closure), `src/bot/personality.ts` (the neutral Personality) and `src/bot/observe.ts`.

## Goal

When a disconnected Player's grace period runs out, a Bot plays their Side for the rest of the Match, inside the Court, and the Match finishes. This is Phase 5's exit criterion.

## Scope

**In `courtMatch`** (pure; the Court DO only wires the grace timer to it):
- When the grace expires, create `createBot(side, seed, DIFFICULTY.medium, simTuning, <the neutral Personality>)`. The seat is the Bot's for the rest of the Match (no reclaiming in v1).
- Each live Tick for that Side:
  - Call `think(observe(state, side))` **once**, and log its `move`/`aim`/`shot` by Tick.
  - Set `contact` with the adapter: `autoContact(state, intents, side, simTuning)`, computed on the state being stepped.
  - The Side stays `reported`; `MatchConfig` never changes.
- **On a rewind** across Bot Ticks:
  - Replay the logged `move`/`aim`/`shot`. **Never** call `think` again.
  - Recompute `contact` from the corrected state, so the Bot still meets a ball whose path a late human hit changed.
  - The log may be up to the window stale. That's accepted.
- If both Players are gone, the Match ends and the Court closes. It never runs Bot against Bot.
- A takeover mid-Rally, mid-Serve and during the dead pause must all work (for the Serve, see issue 01's note on Bots created mid-Serve).

**Client:**
- The remaining Player sees "<name> disconnected — a Bot has taken over."
- The Bot's name shows in the Hud, e.g. "<name> (Bot)".
- Rematch (13) is unavailable after a takeover: back to the map.

**Protocol:** `peer { side, status: 'bot' }`.

**Harness tests:**
- A takeover mid-Rally, and the Match finishes.
- A rewind across Bot Ticks replays the log and never calls `think` twice for a Tick (spy on it).
- After a late human hit changes the ball's path, the Bot still makes Contact.
- Both Players gone ends the Match.

## Acceptance

- The tests are green, and all root checks pass. Offline play is unchanged.
- **Phase 5's exit**, checked by the agent in Playwright:
  - A full Long (best of 3) Match online, with Faults and a rematch.
  - Separately, a Player closes their tab partway through, the Takeover Bot replaces them after the grace, and the Match finishes.
- Mark Phase 5 done in `docs/MULTIPLAYER.md`.

## Out of scope

The e2e suite and deployment (15–16).

## Comments

### 2026-10-03: implemented

One commit, "Online play: the Takeover Bot" (the one that adds this comment).

**What was built:**
- **`courtMatch` (pure):**
  - `gone(side)` creates the Takeover Bot: `createBot(side, seed ^ 0x7a6e ^ side, DIFFICULTY.medium, tuning, NEUTRAL)`, which plays from that Tick on. A repeated `gone` keeps the first one.
  - Each Tick it plays, the Bot thinks once on the state being stepped, and its `move`/`aim`/`shot` are logged by Tick. Its `contact` comes from `autoContact` on that state, skipped when there's no Commit and no press. The Side stays `reported`.
  - A rewind replays the log and works out `contact` again from the corrected state. The log is pruned with the ring buffer.
  - Once both Players are gone, nothing steps: never Bot against Bot.
  - An optional `bot` factory is a test seam.
- **`src/bot/bot.ts`:** a Bot that first sees a Serve after it was due serves at once (`serveAt = max(serveAt, tick)`). Bots that see the Serve from its start are unchanged, and the golden result didn't move.
- **Seats and Court:**
  - `courtSeats.changes` reports a seat gone mid-Match as `bot`.
  - `courtSeats.over` closes the Court when a seat is gone, so there's no rematch after a takeover.
  - The Court no longer ends the Match when a seat goes `gone`. It logs the takeover, and closes once the Bot-played Match is over.
  - A Player who reloads after a takeover gets `peer bot` after `start`.
- **Protocol 8:** `peer { side, status: 'bot' }`.
- **Client:**
  - The Hud shows "<name> disconnected — a Bot has taken over." and names the opponent "<name> (Bot)" in the scoreboard and banners.
  - The Match-over panel shows "No rematch: <name> left, and a Bot finished the Match." with Rematch disabled, and Back to map.
  - The Court's close that follows is silent.
  - The old "left mid-Match, back to the map in 4 s" path is gone, since a mid-Match `gone` no longer comes.

**Tests:** 39 files, 454 tests (before: 446). Typecheck (root and `party/`), build and e2e 19/19 all pass.
- **courtMatch +6 Takeover Bot tests:**
  - A takeover mid-Rally finishes the Match, with `think` called exactly once per Tick and only for its Side.
  - A takeover mid-Serve, 100 Ticks after the Serve began, serves within 60 Ticks.
  - A takeover in the dead pause finishes the Match.
  - Bursts of Side 1 Intents 15 Ticks late rewind across Bot Ticks 40 times: no Tick thought twice, and re-steps use the logged move/aim/shot.
  - After a Side 1 hit reported 15 Ticks late changes the ball's path, the Bot still makes Contact.
  - Both gone: nothing steps.
- The two old "gone stands still" tests now check the Bot.
- netcode harness +1: a takeover mid-Rally over a 60–90 ms link; the Match finishes, and the remaining client hears each Bot hit once.
- courtSeats: +1 (`over` closes after a takeover), and `changes` reports `bot`. protocol: the `bot` guard.

**Playwright, two contexts on `wrangler dev` + Vite (Court EM28D):** each screen's `dink.drive` served when serving and never swung.
- **Long (best of 3):** Hosty won 2–1 (11–0, 0–11, 11–0) in 7,029 Ticks.
  - Faults: both screens showed "POINT — They/You let the ball bounce twice", including the Game-end lines.
  - Rematch: "Waiting for Guesty…" / "Hosty wants a rematch". After the second press, both screens were at Tick 0, 0–0, on a new seed (2441583800, then 157539206).
- **Takeover in the rematch:**
  - At 3–0, the Guest's tab was closed. 3 s later, the Host showed "Guesty disconnected…".
  - At 30.2 s it showed "Guesty disconnected — a Bot has taken over.", with the scoreboard reading "GUESTY (BOT)". This was at a Serve after Game 1.
  - The Bot served, returned the Host's Serves and won 2–1 at Tick 7,893. The banner read "GUESTY (BOT) WINS".
  - The panel read "No rematch: Guesty left, and a Bot finished the Match." with Rematch disabled. No error notice appeared.
  - Court log: "the Takeover Bot plays Side 1", then "tick interval stopped at Tick 7893". A fresh `hello` got `not_found`.

**Notes:**
- The close log line after a Bot-finished Match was added after this run.
- The taken-over Player can't reclaim the seat (`full`), as v1 says.
