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

### 2026-09-29: implemented

One commit, "Online play: the Court runs the Match and sends Snapshots" (the one that adds this comment).

**What was built:**
- **`src/net/protocol.ts`:**
  - Client messages `ready` and `in { tick, intent: QIntent }`, with the guards `isReady` and `isIn`.
  - Court messages `start { seed, preset }`, `snap { tick, ack, state, events }` and `over { winner }`.
  - `SnapEvent = SimEvent & { tick }`: the Tick whose step emitted the event.
  - `ack` is -1 before the client's first `in`.
  - `src/net/intentCodec.ts` gained `isQIntent`, which `isIn` uses so the QIntent layout lives in one place.
- **`party/src/tickLoop.ts`** (pure):
  - An accumulator counted in ms × hz, so whole-millisecond timestamps add up exactly.
  - The first call only sets the clock.
  - `maxCatchUp` (8 on the Court) caps a stall and drops the rest.
  - A clock that goes backwards counts as no time.
- **`party/src/courtMatch.ts`** (pure), the Match engine, with this interface:
  - `receive(side, in)`
  - `disconnect(side)`: drops the latched shot and keeps move and aim.
  - `gone(side)`: a zero Intent from then on, and later input is ignored.
  - `advance(ticks) → Outgoing[]`: at most one `snap` per Side per call, once 2 or more Ticks have run since the last one, plus a final `snap` and `over` when the Match ends. Nothing runs after that.
  - `current(side)`: the current `snap`, plus `over` if the Match has ended, for a Player who reloads.
  - Events are collected across steps, and both Sides get the same list.
- **`party/src/courtStart.ts`** (pure, new), the start rules:
  - The Match starts when both Players are ready, or at `START_CAP_MS = 10_000` after the Guest's token was first seated.
  - Either way, **only while both are connected**.
  - `ready` is forgotten on disconnect, so a reloaded client loads its Venue again first.
  - A Guest who reconnects after the cap ran out starts the Match at once.
  - A new Guest, after the first one was freed, gets a new cap.
- **`party/src/courtSeats.ts`:** after the start, the Court closes once both seats are `gone`.
- **`party/src/court.ts`:**
  - `ready` and `in` are ignored unless they come from an open connection in `holders`.
  - The start timer is cleared on start, when the Guest leaves before the start, and on close.
  - A `setInterval(1000/60)` takes `Date.now()` first, then runs `tickLoop`, then `courtMatch`, then sends to each holder.
  - The interval stops, with a log line, on `over` or when both Players are gone.
  - A Player who reclaims their seat mid-Match gets `welcome`, `start`, then `current` (the Snapshot, plus `over` if the Match has ended).
  - `grace` expiry calls `match.gone(side)`.
- **`party/scripts/smoke.ts`:** a `--match` mode. The handshake checks are unchanged and remain the default.
  - Two easy Bots play a Quick Match over real sockets, each thinking on its latest Snapshot.
  - It prints progress every 15 s, then the result.
  - It checks: the same winner on both clients, identical final states, a final `phase === 'over'`, and no Snapshot after `over`.
  - The Bot must think exactly once per Tick, because it serves on an exact Tick. So on each Snapshot it thinks once for every Tick since the previous one, on that Snapshot's state, and sends any shot with the last move and aim.
- **`party/README.md`:** documents all of the above.

**Results:**
- Tests: 29 files and 259 tests pass.
  - Before: 229.
  - New tests: tickLoop 6, courtMatch 11, courtStart 9, protocol 3, and 1 in courtSeats (both Players gone).
  - The golden result `{ points: [11, 13], tick: 39353 }` is unchanged.
- Checks: typecheck (root and `party/`), build and e2e (16) all pass.
- The handshake smoke still gives 13/13 `ok`.
- Match smoke (`npm run party`, then `npm --prefix party run smoke -- --match`):
  ```
  Court NUNCA: two easy Bots play a Quick Match in real time. This takes a few minutes.
       Tick 897, 2-0, 15 s
       …
       Tick 13506, 13-12, 225 s
  ok   both Players get over with the same winner
  ok   both final Snapshots show the same state
  ok   the final Snapshot is over
  ok   no Snapshot comes after over
  Side 0 won 14-12 at Tick 13756, 5869 Snapshots, 229 s wall time
  ```
  wrangler's log:
  ```
  [court NUNCA] Match started (quick, seed 3787330027)
  [court NUNCA] tick interval stopped at Tick 13756: the Match is over, 14-12
  ```
  It ran at a steady 60 Ticks/s (about 900 Ticks per 15 s progress line). Two earlier runs gave 4-11 at Tick 9228 in 154 s, and 9-11 at Tick 9978 in 167 s.

**CPU for `step`, and how it was measured:**
- **Local workerd doesn't freeze the clock.** A temporary probe timed a busy loop inside the interval callback, and `Date.now()` and `performance.now()` both moved (5–8 ms, at 1 ms resolution). Deployed Workers do freeze the clock, so this only holds under `wrangler dev`.
- **In the DO (workerd, `wrangler dev`, this machine).** A temporary probe (removed before the commit) re-ran `step` 200 times from the pre-step state on sampled callbacks that ran exactly one Tick: every hit Tick, and one plain Tick in 60. Over a whole Quick Match between easy Bots:
  - **Plain Tick:** 64 samples, mean **0.024 ms**, worst 0.050 ms.
  - **Hit Tick** (the solver runs): 15 samples, mean **0.26 ms**, worst **1.0 ms**.
- **In Node (the same V8), for more hit Ticks.** Four whole Standard Matches between hard Bots, timing every `step`:
  - **Plain:** 125,484 Ticks, mean 0.028 ms, p50 0.022, p99 0.111, max 8.7 ms.
  - **Hit:** 1,862 Ticks, mean 0.153 ms, p50 0.119, p99 0.727, **max 2.56 ms**.
- **Reading:** a hit Tick typically costs about 0.1–0.3 ms, well under the 2 ms line. The single worst hit Tick in Node went just over 2 ms. The worst *plain* Tick was 8.7 ms, so those maxima look like GC or JIT pauses rather than the solver. The spike was flagged to the user before committing. Recheck on deployed Workers in 16; the rewind in 08 re-simulates up to 15 Ticks, so its cost multiplies these numbers.

**Decisions where the issue left room:**
- **A disconnected Player's Side.** During the grace it keeps its last move and aim, with no shot. After the grace (`gone`) it gets a zero Intent until the Takeover Bot arrives in 14.
- **Both Players gone:** the interval stops and the sockets close with `4000 'closed'`. No `over` is sent, because no one is left to receive it.
- **"The Court empties" means both seats are `gone`.** While both Players are only disconnected, the Match keeps running through the grace (up to 30 s of billed time), so either Player can still reload back in.
- **Catch-up:** a callback that runs several Ticks sends one Snapshot, not one per 2 Ticks.
- **`ack`** is the maximum `tick` received from that client, never reset. Issue 07 should bound it; a bogus huge `tick` only affects that client's own `ack`.

**Left for later:**
- After `over`, the Court stays open until both Players leave and their grace ends. Rematch is 13.
- 04 needs a typed guard for Court→client messages (still open from 02).
