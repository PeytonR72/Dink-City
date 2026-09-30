# 03: The Court runs the Match at 60 Hz and sends Snapshots

Status: ready-for-agent
Blocked by: 02

Spec: `docs/MULTIPLAYER.md` Part 3, "Netcode model" and "Wire format", Part 2 "New for real time", and Phase 2; ADR-0004, "Simulation".

## Read first

- `CONTEXT.md` Online play, ADR-0004, `docs/MULTIPLAYER.md`.
- Issue 02 and its comments. `party/` exists now, so follow what it set up.
- `src/net/` (the codec, Snapshots, Presets) from issue 01.

## Goal

Once both Players are ready, the Court runs the authoritative Sim, takes Intents and broadcasts Snapshots. Two scripted clients, each driven by a Bot over real sockets, play a whole Match on `wrangler dev`.

## Scope

**`party/src/tickLoop.ts` (pure):**
- An accumulator driven by the timestamp passed to each callback.
- A capped catch-up of at most N Ticks per callback.
- Tests: a steady 60 Hz, a late callback catching up, and a huge stall being capped rather than spiraling.
- Workers' clocks only move between I/O. Never time work inside a callback (Part 2).

**`party/src/courtMatch.ts`, the pure Match engine:**
- Everything the Court does per Tick, with no DO. Later issues extend it (jitter buffer, rewind, Reported Contact, Takeover Bot), so give it a small, deep interface: for example, `receive(side, message)` and `advance(now) → outgoing messages`.
- Starts from `createInitialState(seed, PRESETS[preset].config)`. Human Sides stay `auto` until issue 10.
- **Naive input** (issue 07 replaces this):
  - Keep each Side's latest `move`/`aim`.
  - Latch a `shot` press until the next step consumes it, so a press is never lost between Ticks.
  - A Side with no input yet stands still.
- **Snapshots at 30 Hz:** `snap { tick, ack, state, events }`.
  - `state` is the full `SimState`.
  - **`events` holds every event since the previous Snapshot, each tagged with its `tick`.** `state.events` only holds the last step's events, and the Court steps twice per Snapshot.
- When the Match ends (`phase === 'over'`), send `over { winner }`, then stop.

**The Court DO:**
- `ready` messages. Start when both are ready, or 10 s after the Guest is seated. Send `start { seed, preset }`.
- A `setInterval` driving `tickLoop` + `courtMatch`. **Stop the interval** when the Match ends or the Court empties (DO duration is billed while it's awake).
- Inputs arrive as `in { tick, intent: QIntent }`; issue 07 makes these redundant.
- A disconnected Player's Side keeps its last move until the grace ends, with no shot. If both Players are gone, end the Match and close. There's no Takeover Bot yet (issue 14).

**Protocol:** add `ready`, `start`, `in`, `snap` and `over` to `src/net/protocol.ts`, with guards.

**Measure `step` CPU on Workers:** log the time of a plain Tick and of a hit Tick (the solver runs), over a whole Match. Record the numbers in the issue comment.

**Smoke:** extend `party/scripts/smoke.ts`. Two clients each run `createBot(side, …)` on the `observe(state, side)` of their latest Snapshot, send Intents, and play a Match to `over`. Print the score and Tick.

## Acceptance

- The `tickLoop` and `courtMatch` tests pass, including:
  - the event aggregation across Snapshots
  - shot latching
  - the start cap
  - a Match played to the end headlessly by feeding the engine Bot Intents, with the result a pure function of seed and inputs
- The smoke Match completes on `wrangler dev`, and the interval stops afterwards (log it).
- The CPU numbers are recorded. If a hit Tick costs more than about 2 ms, flag it to the user before moving on.
- All root checks pass. Offline play is unchanged.

## Out of scope

The browser client (04), the Lobby (05), prediction and rewind (07–09) and Reported Contact (10).

## Comments
