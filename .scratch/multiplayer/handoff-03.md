# Handoff: issue 03 (the Court runs the Match at 60 Hz and sends Snapshots)

Written 2026-09-29, right after issue 02 landed as `59b974a` on `main`. Nothing from 03 has been started.

## Read first

1. `.scratch/multiplayer/issues/03-court-runs-the-match.md`: the ticket.
2. `.scratch/multiplayer/issues/02-court-handshake.md`, its `## Comments`: what 02 built, the decisions the user accepted, the gotchas, and "Left for later".
3. `.scratch/multiplayer/handoff-01.md`, the sections "Conventions and gotchas specific to 01" and "Working with this user". They still apply: comment style, glossary capitalization, the commit trailer, and never pushing without asking.
4. `docs/MULTIPLAYER.md`:
   - Part 2, "New for real time"
   - Part 3, "Netcode model", "Late inputs and rewind" (just to see what 07 and 08 will build on your engine) and "Wire format"
   - Phase 2
5. `party/README.md`, then `party/src/court.ts` and `party/src/courtSeats.ts`.

## State of the repo

- **Branch:** `main` at `59b974a`, clean except for `.playwright-mcp/`, which was untracked before this work. Don't commit it.
- **Pushing:** Vercel deploys `main` on every push. **Never push without asking.** Don't run `wrangler login` or `wrangler deploy` (that's issue 16).
- **Tests:** 26 files, 229 tests, all green, in about 20 s. The golden Bot result `{ points: [11, 13], tick: 39353 }` (`test/bot.test.ts:110`) must not move.
- **Checks:**
  - `npm run typecheck` checks the root and `party/`.
  - `npm run build`.
  - `npm run e2e` runs 16 tests with its own Vite on 5174.
- **Running the server:**
  - `npm run party` starts `wrangler dev` on :8787.
  - `npm --prefix party run smoke [baseUrl]` runs the 13 handshake checks, on `tsx`.
  - `party/node_modules` is already installed.

## What 02 left you to build on

**The Court:** `party/src/court.ts` is a thin shell with `hibernate: false`.
- `provision()` stores `this.match = { preset, seed }` and a `Seats`.
- `hello` seats Players.
- `holders[side]` is the connection id on each Side.
- `left()` starts the grace period, and `schedule()`/`expire()` run one `graceTimer` from `seats.nextExpiry`.
- `send()` checks `readyState`.
- `refuse()` sends an `error` and then closes with 4000.

**Seat rules:** in `party/src/courtSeats.ts`.
- **`start(seats)` already exists.** Call it when the Match starts. After that, an expired grace makes the seat `gone` instead of freeing it or closing the Court.
- `GRACE_MS = 30_000`.
- `players(seats)` gives the `[CourtPlayer | null, CourtPlayer | null]` list the welcome sends.

**The wire protocol:** in `src/net/protocol.ts`.
- `ClientMsg = HelloMsg`, and `CourtMsg` is `welcome | error`. Add `ready`, `in`, `start`, `snap` and `over`, with a guard for each client message (`isReady`, `isIn`).
- `Court.onMessage` currently dispatches only `isHello`. Extend it, and **ignore `ready`/`in` from a connection that isn't in `holders`**.
- `decode` only checks the tag. The client in 04 will need a guard for Court messages, but the smoke script casts, which is fine for now.

**Pieces from `src/` you'll use:**
- `createInitialState(seed, config)` and `step(prev, [i0, i1], simTuning)` from `src/sim`.
  - `step` is pure: it does a `structuredClone` and then mutates the clone.
  - `state.events` holds **only the last step's events**.
  - `state.phase === 'over'` and `state.match.winner` tell you the Match is over.
- `PRESETS[preset].config` from `src/net/presets.ts`. It has no `contactMode`, so both Sides are `auto`, which is what 03 wants.
- `QIntent`, `quantizeIntent` and `dequantizeIntent` from `src/net/intentCodec.ts`. The Court steps with `dequantizeIntent(q)`, and so will the client later.
- `encodeState` and `decodeState` from `src/net/snapshot.ts`. `SimState` is JSON-safe, and `-0` was proven harmless.
- `simTuning` from `src/tuning.ts`. `court.ts` already imports it; `src/net/` must never import it.
- `createBot(side, seed, DIFFICULTY.x, simTuning)` and `observe(state, side)` from `src/bot/`, for the smoke clients and the headless test.
  - `test/bot.test.ts` lines 13–24 show the Bot-vs-Bot loop to copy.
  - A Bot's memory lives in a closure, so call `think` exactly once per Tick.

## Watch out for

- **A whole Match takes minutes in real time.**
  - The golden Standard Match is 39,353 Ticks, about 11 minutes at 60 Hz.
  - Quick (Rally scoring) is shorter but still several minutes. Easier Bots probably shorten it further, because rallies end sooner.
  - The smoke Match will be slow. Keep the fast handshake checks as they are, and consider a separate `smoke` mode or flag for the Match, with a generous timeout and progress output.
  - Don't add a server-side speed-up without asking the user; Game speed is fixed at 1 online.
  - The headless `courtMatch` test has no such problem, because it just calls `advance` with synthetic `now` values.
- **Workers' clocks are frozen during execution** (the Spectre mitigation): `Date.now()` and `performance.now()` only advance between I/O events.
  - That's why `tickLoop` takes the timestamp at the start of each `setInterval` callback, and why the ticket says "never time work inside a callback".
  - It also means **you can't time a single `step` inside the DO.** Check first whether local workerd under `wrangler dev` freezes the clock too.
  - If it does, you need another way to get the CPU numbers the ticket asks for, and those numbers are a hard acceptance item ("flag it if a hit Tick is over about 2 ms"). For example:
    - time batches across I/O boundaries;
    - use wrangler's per-request CPU reporting, if it has one;
    - benchmark `step` in Node, which runs the same V8, and state the caveat.
  - Tell the user which method you used.
- **Snapshots carry `ack` per client.**
  - Either build one `snap` per connection, or send the shared parts once and patch `ack`. One per connection is fine at this size, about 600 bytes of state.
  - `events` is every event since that client's previous Snapshot, each tagged with its `tick`.
  - Collect events inside `courtMatch` as it steps, because each step overwrites `state.events`. The shape (`{ tick, event }` or `SimEvent & { tick }`) is your call; keep it small and document it.
- **Latching the shot.**
  - An `in` with a shot sets a pending shot for that Side. The next `step` uses it and clears it.
  - `move` and `aim` persist.
  - A Side with no input yet steps with a zero Intent: `{ move: {x:0,y:0}, aim: {x:0,y:0}, shot: null }`.
- **Disconnects during a Match** (the ticket says "keeps its last move until the grace ends, with no shot"):
  - Clear the pending shot on disconnect.
  - After the grace, `courtSeats.expire` marks the seat `gone`. With no Takeover Bot until 14, the simplest honest behavior is a zero Intent. Say what you chose.
  - **Both gone** means `over`, or just close. Stop the interval, then close.
  - A reconnect during the grace goes through the existing token path. Decide whether a reclaimed Player gets `start` again, so a reloaded client can rebuild. **That seems right:** send `start` (plus the next `snap`) after the `welcome` when the Match is running. 04 needs this for "a reload mid-Match rejoins the same seat".
- **Stop every timer.** Clear the tick `setInterval` on `over`, when both Players are gone, and on close, and log it; the acceptance asks for the log line. Clear the 10 s start timer when both are ready early. `graceTimer` already exists; don't tangle the three together.
- **The 10 s start cap** runs from the moment the Guest is seated. If the Guest leaves before the start, clear the timer; they're freed only when their grace ends, so decide whether the cap still fires while they're in grace. Probably not: start only while both seats are `connected`.
- **Old Court messages still in flight:** issue 02 made a closing socket's `hello` a no-op. Do the same for `ready` and `in`.
- **Don't run the Sim inside `wrangler dev` while editing.** Every edit hot-reloads and wipes the Courts, so a smoke Match that overlaps an edit dies with `not_found` or a dropped socket.
- **Stale `wrangler dev` processes:**
  - Stopping `workerd` alone doesn't free :8787, because its `node … wrangler … dev` parent restarts it. Stop the parent.
  - If :8787 is busy, wrangler quietly takes :8788. Check the "Ready on" line, and pass that URL to the smoke script.
- **The permission checker** sometimes answered "no verdict" in the last session. Retrying the same call once usually worked; read-only tools keep working in the meantime.

## Suggested shape (not decided; adjust freely)

- **`party/src/tickLoop.ts`:**
  - `createTickLoop({ hz: 60, maxCatchUp })` returning `advance(now) → ticksToRun`.
  - It keeps `acc` and `last`.
  - `maxCatchUp` is around 4–8 Ticks per callback. It drops the leftover time instead of spiraling.
  - It's pure; test it with made-up timestamps.
- **`party/src/courtMatch.ts`:**
  - `createCourtMatch({ seed, preset, tuning })`, with:
    - `receive(side, msg)` for `in` messages;
    - `disconnect(side)`;
    - `advance(ticks)` returning `{ snaps?: …, over?: winner }`, or an `outgoing` list.
  - Keep the timing (`tickLoop`) outside, so later issues can add a jitter buffer, rewind and a Bot adapter behind the same interface.
  - A Snapshot every 2 Ticks.
- **The Court DO** wires them together: `ready` / start timer → `start`; `setInterval(…, 1000/60)` → `loop.advance(Date.now())` → `match.advance(n)` → send; on `over` or when both Players are gone, clear the interval.
- **Tests in `test/net/`:**
  - `tickLoop.test.ts`: a steady rate, catching up, and a capped stall.
  - `courtMatch.test.ts`:
    - event aggregation across Snapshots
    - shot latching, with a press between Ticks
    - a zero Intent before any input
    - a disconnect clearing the shot
    - a whole Match with Bot Intents fed through `quantizeIntent`
    - the result is a function of seed and inputs: two runs match

## When done

- Run typecheck, `npm test` (the golden result unchanged), build, e2e, the handshake smoke, and the Match smoke. Log that the interval stopped.
- Append a `## Comments` entry to issue 03:
  - the commit(s) and what was built
  - test counts
  - the smoke output: the score, the final Tick and the wall time
  - **the CPU numbers and how they were measured**
  - deviations and notes
- **If a hit Tick costs more than about 2 ms, stop and tell the user before committing.**
- Run `/code-review` (the mattpocock-skills one) and fix what matters.
- Commit to `main` as one commit, with a subject like "Online play: the Court runs the Match and sends Snapshots", ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Don't push.**
- Report concisely, then stop. Issue 04 is the user's call.
