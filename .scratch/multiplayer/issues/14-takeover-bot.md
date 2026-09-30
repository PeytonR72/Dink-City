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
