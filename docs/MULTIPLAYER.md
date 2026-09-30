# Online multiplayer: architecture audit and plan

Status: approved (2026-09-29). Phase 0 (ADR-0004 and glossary) is done. Phase 1 has not started.

Goal: 1v1 online Matches, found through a public list of **Courts** or joined by code or link. The server owns the Sim and runs it at a fixed Tick. Each client predicts its own Player and interpolates the remote Player. The hitter's client reports each hit, and the server validates it. Single-player against a Bot, and Practice mode, keep working at every phase.

Terms follow `CONTEXT.md` (Sim, Tick, Intent, Side, Commit, Contact, Rally, and the "Online play" section: Court, Lobby, Host, Guest, Preset…). The netcode decision is recorded in `docs/adr/0004-online-play.md`.

## Decisions (2026-09-29)

| # | Topic | Decision |
|---|---|---|
| 1 | Rates | Server Sim at 60 Hz (the existing `TICK`), snapshots at 30 Hz. |
| 2 | Domain | The default `*.workers.dev` URL during development. A custom domain is deferred to Phase 6. |
| 3 | Layout | A `party/` subfolder, mirroring PokerElo. Shared client/server code lives in `src/net/`, and `party/` imports `src/sim`, `src/bot`, `src/tuning` and `src/net` by relative path. |
| 4 | Opponent's Commit type | Sent in snapshots, not hidden, in v1. Revisit if ranked play is ever added (ADR-0004). |
| 5 | Disconnect after grace | A server-side **Takeover Bot** plays that Side for the rest of the Match, inside the Court. How this interacts with rewind is in Part 3. |
| 6 | Fault Replays | Disabled online in v1 (the Fault banner still shows). Offline is unchanged. |
| 7 | Court settings | The Host picks one **Preset** (below). It's fixed once the Court is created. |
| — | Discovery | A singleton **Lobby** DO lists open Courts live, and every Court reports its lifecycle to it. Join by code or link remains as a secondary path. |
| — | Identity | No accounts. A guest **Display name** is stored on the client and validated on the server. |
| — | Naming | A match room is a **Court**. The Lobby is a directory of Courts. A future open world could reuse Courts with a different discovery layer; nothing is built for it. |

### Presets (proposal: three)

The existing offline settings are the only rule dials (`rallyScoring`, `bestOf`), so this set covers every useful combination without adding anything new:

| Preset | Rules | Typical length |
|---|---|---|
| **Quick** | 1 Game to 11, Rally scoring | ~5 min |
| **Standard** (default) | 1 Game to 11, Side-out scoring | ~10 min |
| **Long** | Best of 3 Games to 11, Side-out scoring | ~25 min |

Not in a Preset: the Venue (each client shows its own, since it's presentation only), Players' colors (local), and the Takeover Bot's Difficulty (always `medium`, `NEUTRAL` Personality). Bo3 with Rally scoring is dropped as rarely wanted; it's a one-line addition later.

### Full Courts in the list

**A Court leaves the list when it fills** rather than showing "2/2". The list exists to find a game, and a 2/2 row can't be clicked. A full Court also starts within a few seconds. The Lobby keeps the entry hidden rather than deleting it, so if the Guest leaves before the Match starts, the row comes back as 1/2. `start` deletes it.

---

## Part 1: Audit

Unchanged from the first review, apart from the §2 table, which now also lists the Replay mechanics as offline-only.

### Summary

The codebase is already shaped for this. ADR-0001 made the Sim a pure, fixed-tick, deterministic `step(state, intents, tuning) → state` over plain data. ADR-0003 limits Bots to producing Intents. A test enforces the Sim boundary. **No game logic touches three.js.** The work is to replace the single-player main loop with a networked driver and to add one Sim hook for reported Contact. It is not an untangling job.

The real risks are all outside `src/sim/`:

1. The main loop stops or warps Sim time for presentation (hit-stop, Game speed, Fault Replay, the fast-forward through the dead pause, the 0.25 s frame cap).
2. Bot memory lives in a closure, so a Bot can't be rewound.
3. The rendering and audio code assumes the local Player is Side 0.
4. Tuning is a mutable global, so it has to be pinned per Match.

### 1. Game loop

- **Location:** `src/main.ts`: `frame()` (line 349) is the `requestAnimationFrame` callback, and `update(dt)` (line 357) does one frame's work.
- **Timestep:** a fixed 1/60 s Sim Tick (`TICK` in `src/sim/solver.ts`) behind a classic accumulator. Rendering runs at a variable rate and interpolates between `prev` and `curr` with `alpha = acc / TICK`.
- **dt handling:**
  - `dt = min(now − last, MAX_FRAME = 0.25 s)`. A long stall is dropped rather than caught up.
  - `acc += dt * viewTuning.gameSpeed`. Game speed scales real time into Ticks; the Sim itself never sees it.
  - **Hit-stop** (`hitStop`, lines 127, 292, 374–377): after a Smash or a hit of at least 16 m/s, the Sim is *not stepped* for 40 ms, and that time is lost rather than made up.
  - **Fault Replay** (`playReplay`, line 314): while the Replay plays, the live Match isn't stepped at all. After it, `skipDeadPause()` (line 342) steps the rest of the dead phase synchronously, with idle Intents, to reach the next Serve.
  - `window.dink.advance()` / `frames()` step the Sim synchronously for tests and playtests.
- **Online impact:** the server's Tick clock cannot pause for one client's hit-stop or Replay, and it cannot drop time. Online, Fault Replays and hit-stop are off, Game speed is 1, and stalls resync the clock (Phase 5).

### 2. State

**The Sim state is one plain, serializable object.** `SimState` (`src/sim/types.ts`) holds:

| Field | Contents |
|---|---|
| `tick`, `phase` (`serve`/`rally`/`dead`/`over`), `phaseTick` | clock and Rally state |
| `rng` | mulberry32 state (uint32) |
| `server`, `shots` | serve and Rally state |
| `match` | `config` (points to win, win by, rally scoring, best of), `points`, `games`, `ends`, `gameFirstServer`, `winner` |
| `ball` | `pos`, `vel`, `spin`, `lastHitBy`, `bouncesSinceHit`, `hitTick` |
| `sides[2].players[1]` | `pos`, `vel`, `commit` (type, tick, bestDistance), `aiming`, `swing` (type, variant, tick), `speed` |
| `events` | the events from the most recent step only |

There are no classes, no three.js objects and no functions in it. `step` begins with `structuredClone(prev)`, so states are immutable snapshots. That makes rewind and re-simulation cheap: keep references in a ring buffer. JSON round-trips it exactly, with one caveat: `-0` becomes `0`. That's harmless here, because every `Math.sign` use either guards against zero or treats it the same way.

**Paddles aren't state.** There is no paddle object. Swings are procedural animation driven by `player.swing`, and by `predictContact` for the wind-up (ADR-0002).

**State that lives outside `SimState`** (all of it outside the Sim):

| Where | What | Online relevance |
|---|---|---|
| `src/bot/bot.ts` `createBot` closure | Bot RNG, per-ball memory (error, lateAt, softStreak, serveAt…) | **Can't be cloned or rewound.** See Part 3, "Takeover Bot and rewind". |
| `src/practice/practice.ts` `Practice` class | Practice steps and reps | Single-player only |
| `src/main.ts` | `acc`, `hitStop`, `replay`/`replayIn`, `rally` recording, `mode`, `bot`, `difficulty` | Replaced by the online driver. Replay and hit-stop are offline only. |
| `src/input/input.ts` `Input` | held keys, one queued shot press, gamepad edges | Stays on the client |
| `src/render/renderer.ts` | trail, landing marker, per-Player `lastHit` pose, camera damping | Presentation only |
| `src/tuning.ts` | `simTuning` (a mutable global, live-editable under `?debug`) and `viewTuning` | `simTuning` must match exactly on both ends. See §6. |

### 3. Simulation vs rendering

**They are fully separated.** `test/sim.test.ts` ("sim boundary") fails if anything in `src/sim/` imports three.js, imports from outside `src/sim/`, or uses `Math.random`, `Date.now` or `performance.now`.

**Places where game logic reads or writes three.js objects: none.** The data only flows one way:

- `Renderer.render(prev, curr, alpha, dt)` (`src/render/renderer.ts:171`) reads two `SimState`s and writes three.js objects (it lerps the ball and Players, poses the characters with IK, and mirrors the world when the local Player is at End 1).
- `Renderer.onEvents` reads `hit` events to pin the swing pose.
- The renderer calls two pure Sim queries: `predictContact` (for the swing wind-up) and `predictLanding` (for the landing marker). They're read-only, and `predict.ts` notes that Bots must not use them.
- `src/debug/overlays.ts` reads `SimState` and the Bot's `plan` through a frame hook. It is dev-only.
- A grep for assignments to `curr/prev/state .ball/.sides/.phase/.tick/.match` in `render/`, `hud/`, `debug/` and `practice/` finds nothing.

**Logic that lives in the loop rather than the Sim** (not three.js, but it matters online):

- `tick()` (`main.ts:266`): once the Match is `over`, any shot press starts a new Match with `Date.now()` as the seed.
- In Practice mode, every new Serve is replaced by a fresh `createInitialState` (`newRep`).
- Fault Replays are created from the recorded Rally (`rally.start` plus every Tick's Intents).
- `onMatchWon` updates saved progress.

**The local Player is hard-wired to Side 0 for presentation** (Side 1 won't render correctly without changes):

- `src/render/renderer.ts:33` `const LOCAL_SIDE = 0` controls mirroring, the commit ring, the camera follow and the landing marker.
- `main.ts:25` `const LOCAL = 0` is passed to `Hud` (which already takes `local` as a parameter), `playEvents(…, endOf(curr, LOCAL))` and `renderer.setColors`.

### 4. Input

- `src/input/input.ts` `Input` listens for keydown/keyup. `sample()` is called **once per Sim Tick** and returns an `Intent`: `{ move: Vec2, aim: Vec2, shot: ShotType | null }`.
  - `move` is keyboard axes in {-1, 0, 1}, or the gamepad stick past a 0.2 deadzone.
  - `aim` is a copy of `move`.
  - `shot` is edge-triggered: at most one queued press per Tick, consumed when sampled.
  - Directions are in the Player's local frame, and the Sim maps them to world space by End. The same input therefore works from either End, which is exactly what a network client needs.
- **Is it a small serializable object per Tick? It already is.** It quantizes well: move x/y and aim x/y as int8 each, plus 2 bits for `shot`. That's about 5 bytes, or 3 while `aim === move` for humans.
- **Online caveat:** a shot press appears on exactly one Tick. If that packet is lost, the Commit is lost. Inputs must be sent redundantly (each packet carries the last N unacknowledged Ticks).
- **Online caveat:** `Input.clear()` and pause handling are frame-driven. That's fine on the client, but the server needs a policy for missing Ticks (see Part 3).

### 5. Bots

- A Bot is `think(Observation) → Intent` (`src/bot/bot.ts` `createBot`, ADR-0003). `observe(s, side)` (`src/bot/observe.ts`) builds what a player on court could see. It includes the opponent's position and the *last swing's* type, but **not the opponent's pending Commit**. It excludes the RNG state and the exact trajectory.
- The Bot predicts the ball with its own noisy integration (`integrateBall` plus per-ball error) and handicaps itself only through its Intents.
- **It produces the same Intents a human does and never touches Sim state.** The Practice ball machine (`createMachine`) is a Bot whose Intents are edited, and it goes through the same interface.
- Its randomness comes from a seeded mulberry32 kept in the closure, so it's deterministic given the seed and the sequence of Observations.
- **Online consequences:**
  - A Bot can run inside a Court as the Takeover Bot, unchanged.
  - **A Bot can't be rewound**, because its memory is mutated on every `think`. If the Court re-simulates Ticks, it must **replay the Bot's recorded Intents** from its log, not call `think` again.

### 6. Determinism risks

**Inside `src/sim/`: none found.** The boundary test forbids `Math.random`, `Date.now` and `performance.now`. All randomness uses the state's `rng` (net-cord deflection in `physics.ts`, Aim error and Soft overhit in `step.ts`). Physics uses a fixed `TICK` with fixed substeps. Solver iteration counts are fixed.

**Outside the Sim, or at its edges:**

| Risk | Where | Online treatment |
|---|---|---|
| `Date.now()` as a Match/Practice seed | `main.ts:151, 162, 173, 205, 268` | Fine offline. Online, the Court picks the seed. |
| `performance.now()` for the frame clock | `main.ts:125, 202, 350` | Client only. Online, the client clock is synced to the Court's Tick clock. |
| `performance.now()` for the landing-marker pulse | `renderer.ts:299` | Presentation only. Harmless. |
| **Frame-dependent Sim time**: `MAX_FRAME` cap, `gameSpeed`, hit-stop, Replay pause, `skipDeadPause` | `main.ts` | Off or fixed online (Phase 5). |
| **Mutable `simTuning`** (debug panel, `window.dink.simTuning`) | `src/tuning.ts` | Server and clients must step with identical tuning. Hash it into the handshake and reject mismatches. This also catches **deploy skew** between the Vercel client and the Cloudflare server. |
| **Bot memory outside the state** | `bot.ts` | Record and replay Bot Intents on rewind (Part 3). |
| **Cross-engine float drift** | `Math.hypot`, which the Sim uses a lot, isn't required to be correctly rounded, so Chrome/Workers (both V8) and Firefox/Safari may differ in the last bit | Doesn't matter for correctness, because the server is authoritative and never lockstepped. It only causes tiny prediction corrections, and it sets the tolerance used in hit validation. |
| Net-cord randomness in predictions | `predict.ts`, `solver.ts` use `noRandom = 0.5` | Presentation only. The client's *full* prediction uses the real `rng` from the last snapshot, so even net cords predict correctly. |
| `structuredClone` per Tick | `step.ts:82` | Available in Workers. Cost is small, but measure it on the server (Phase 2). |

### 7. Tests and tooling

- **Build:** Vite 8 (no config file, defaults), `tsc --noEmit && vite build`. The client is deployed to Vercel from `main` (https://dink-city.vercel.app).
- **TypeScript:** `typescript@^7` with `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` and `isolatedModules`. `noUncheckedIndexedAccess` is not enabled.
- **Unit tests:** Vitest 5. There are 18 files and 167 tests, **all passing** on this commit. They cover Sim physics and rules, the Shot solver, Shot quality, predict, Replay determinism, Bot behavior (golden Rallies), Practice and saves. The Sim is tested headlessly with no DOM.
- **E2E:** Playwright (`e2e/*.e2e.ts`) against `vite dev` on port 5174, using SwiftShader WebGL. It checks reference screenshots per Venue, the perf budget and Practice. `window.dink` exposes `advance()`/`frames()` so tests run deterministically.
- **No server, no network code and no WebSocket dependency** exist yet.

---

## Part 2: What transfers from PokerElo's server

I read `party/src/` (`matchRoom.ts`, `lobby.ts`, `liveMatches.ts`, `worker.ts`, `env.ts`, `spectator.ts`, `timers.ts`, `botRunner.ts`), `party/wrangler.jsonc` and `shared/src/protocol.ts`, only to learn the patterns.

PokerElo's shape: a Worker entry `routePartykitRequest(request, env)` routes `/parties/<party>/<room>` to partyserver `Server` subclasses, which are Durable Objects: `MatchRoom` (bound as `MAIN`) and a singleton `Lobby` (named `"global"`). There is one DO per match. State lives in DO memory (`hibernate: false`), and the `new_sqlite_classes` migration is declared but storage isn't used for match state. Rooms report `start`/`end` to the Lobby, best-effort, for its "Live Tables" list. The client (Vercel) connects with `PartySocket({ host, party, room })`.

### Transfers

- **One DO per Match (our `Court`), named by its Court code**, routed by `routePartykitRequest`. It needs the same `party/wrangler.jsonc` shape (DO bindings `COURT` and `LOBBY`, plus a `new_sqlite_classes` migration), and the same split: client on Vercel, server on Cloudflare (`*.workers.dev` until Phase 6).
- **A singleton Lobby DO that rooms report to, best-effort** (`postToLobby`), with **stale entries that heal themselves** (`liveMatches.ts`: each entry carries `expiresAt`, and `listLive` sweeps expired entries on read). Poker could set a fixed expiry because a match's length is known. An open Court has no known length, so we add a **heartbeat** that refreshes `expiresAt` (Part 3).
- **`hibernate: false`, with in-memory state.** A Court must keep its Tick timer running.
- **Idempotent provisioning before anyone connects.** A Court that wasn't provisioned rejects connections, the same way poker's invite gate does, so a guessed code can't spin up a room.
- **Code generation** (`makeRoomCode`: a short code from an unambiguous alphabet). Use `crypto.getRandomValues` rather than `Math.random`.
- **A connection-state map with seat assignment on `hello`**, plus the **disconnect grace timer, reconnect, and seat restore** flow (`onClose`/`onError`, which poker deduplicates because either may fire).
- **Discriminated-union JSON protocol** with a `t` tag and `encode`/`decode` that validate only the tag. **The server re-guards every payload.**
- **Pure logic extracted out of the DO classes for Vitest.** partyserver's `Server` can't load under plain Vitest, so the Court and Lobby classes are thin shells verified with `wrangler dev`.

### Changed on purpose

- **Internal channels use DO RPC, not `onRequest`.** PokerElo's Lobby takes room reports as `POST` requests in `onRequest`. `routePartykitRequest` forwards *any* HTTP request on `/parties/<party>/<name>` to `onRequest`, so that channel can be reached from the public internet. Our Court→Lobby reports and Worker→Court provisioning are DO RPC method calls. The public route passes an `onBeforeRequest` that allows only WebSocket upgrades. (PokerElo has the same exposure; it's out of scope here but worth a look.)

### Doesn't transfer

- **Turn-driven flow** (`toAct`, `yourTurn`, `TurnTimer`, timebanks, `setTimeout` bot "think delays"). We have a continuous **60 Hz Tick loop** instead. Bots think inline every Tick.
- **Event-per-action broadcast plus full snapshot per action.** We send **snapshots at 30 Hz**, with inputs streamed at 60 Hz with redundancy.
- **Supabase JWT auth and rating-bucket matchmaking** (`matchmaker.ts`, `enqueue`). Dink City has no accounts, and the list is a browse-and-click directory, not a queue. A Display name plus a random per-seat **rejoin token** (in `sessionStorage`) covers v1.
- **Hidden-information redaction** (`redactFor`/`viewFor`). The only candidate here is an opponent's pending Commit type, and Decision 4 sends it in v1.

### New for real time (no poker equivalent)

- **Tick scheduling in a DO:** use `setInterval` with an accumulator driven by the timestamp at each callback. Workers' clocks only advance between I/O events, so never time work inside a callback. Stop the interval when the Court empties or the Match ends, because DO duration is billed while it's awake.
- **Clock sync** (ping/pong to estimate RTT and offset), **client-ahead input timing**, **per-player input jitter buffers**, a **state and input ring buffer for rewind**, and **Origin checks** on the WebSocket (only the Vercel origin and localhost).

---

## Part 3: Design

### Netcode model

The Court is authoritative. It runs the existing `step` at 60 Hz with the existing `simTuning`, on a seed it picked. Clients only send Intents. The *remote* Player never affects the local timeline except through a hit. That's why this game suits prediction:

- The incoming ball's whole flight is determined by the last launch (and `rng`, which is in the snapshot, including net cords).
- The local Player's position is determined by the local Player's own Intents.
- So the local client can predict **its own Player and the ball exactly** until the opponent hits. Only the opponent's movement is unknown, and it's only drawn, never stepped against.

### Timelines on each client

- **Predicted timeline (local "now")** runs about RTT/2 plus a jitter margin *ahead* of the Court's Tick. Local Intents for Tick T reach the Court before it steps T. On every snapshot, the client re-simulates from the last authoritative state with its un-acknowledged Intents (standard reconciliation). The remote Player's Intents in this timeline are a guess and are never shown.
- **Interpolated timeline (remote)** is drawn about 100 ms behind the newest snapshot. The remote Player is drawn only from here, so remote swings come from confirmed hits.
- **Ball clock blend (presentation only):**
  - The ball's path since its last launch is a known function of Tick. Draw it at a time that slides from *local now* (ball on or heading to the local half) to *remote interpolated time* (ball on or leaving the remote half).
  - A remote hit then lines up with the remote swing, and the ball arrives in local time for the local Contact. The ball appears slightly faster or slower in flight (about 10–15% at 100–150 ms) instead of teleporting.
  - Cap the blend. Past about 250 ms of latency, accept small snaps.
- **Events:** local `hit`, local-half `bounce` and net events play immediately from prediction. Faults, `dead`, `rally-won`, scores, `game` and `match` come **only from the Court** (a predicted "opponent missed" is often wrong). The Fault banner shows, with no Replay.

### Hitter-reported hits (Reported Contact)

- Add an optional `contact: true` to `Intent` (it stays "one Tick of input"; nothing else enters the Sim).
- Add a per-Side `contactMode: 'auto' | 'reported'` to `MatchConfig` (it's in the state, so recorded Rallies stay exact).
  - In `auto` (the default: offline, Bots, Practice), the Sim behaves exactly as today.
  - In `reported`, the Sim runs the same Contact rule for that Side but only when the Intent carries `contact`. It validates the Contact geometrically (reach oval, plus a small tolerance for cross-engine drift) and still computes the shot itself (solver, Aim error from `rng`, quality, faults).
- Human Sides in an online Match are `reported` from the Match's start, and the config never changes mid-Match.
- The client sets `contact` on the Tick its *predicted* Sim (running in `auto` for itself) produced the hit. Its prediction and the Court's result match, so the launch the client drew is the launch the Court confirms.
- **Court validation:**
  - The Tick must be within the Rewind window (15 Ticks).
  - The Player must have had a Commit (its press is in the same input stream).
  - The ball must be on the hitter's End, not their own last hit, with at most one bounce, and within reach at that Tick.
  - If the report is valid, the Court applies it at its Tick, re-simulating from there if the report arrived late.
  - If it's invalid, the Intent's `contact` is ignored, the ball flies on, and the client corrects on the next snapshot.
- **Cheating surface:** reach and rules are enforced, and the shot is computed by the Court. The only freedom a client gains is choosing *which* in-reach Tick to hit on, instead of the closest point. The quality difference is small, and it can be bounded by capping distance past the best point.

### Late inputs and rewind

- The Court keeps the last 30 states and both Sides' Intents in a ring buffer.
- A missing Intent for Tick T is filled with the last `move`/`aim`, `shot: null`, `contact: false`, decaying `move` to zero after about 6 Ticks. A stalled or hidden tab then stops rather than running forever.
- When the real Intent arrives within the window, the Court rewinds to T and re-simulates. Older inputs are dropped.

### Takeover Bot and rewind

When a disconnected Player's grace timer expires, the Court creates `createBot(side, seed, DIFFICULTY.medium, simTuning, NEUTRAL)` for that Side. The Match continues, and the seat is the Bot's for the rest of the Match (no reclaiming it in v1). If both Players are gone, the Court ends the Match and closes; it never runs Bot against Bot.

- **The Bot's Side stays `reported`.** `MatchConfig` is part of the state and is never edited outside `step`. Instead, a Court-side adapter fills in the Bot's `contact` flag with a pure query: "would the `auto` Contact rule hit this Tick?" This is the same code path as `checkContact`, exposed read-only. The result is exactly what `auto` would do.
- **Rewind replays the Bot; it doesn't re-think.** The Court logs the Bot's `move`/`aim`/`shot` for each Tick, the moment the Bot produces them. When a late human input or hit report triggers a rewind, the re-simulation uses the **logged** Bot Intents. `think` is never called for a Tick twice, because its closure memory can't be rolled back.
- **Contact is recomputed during the re-simulation, not logged.** The adapter's query depends only on the state, so on a rewind it's re-run against the corrected state. If a late human hit changes the ball's path, the Bot still meets the new ball when it reaches reach, rather than swinging at a ball that no longer exists.
- **After a rewind, the Bot's logged movement can be stale for up to the window (250 ms).** On the next live Tick it observes the corrected state and re-plans. Its per-ball memory keys on `shots`, so a new hit it hadn't seen reads as a new ball, the same as a normal reaction delay. This is accepted.
- Human-only rewinds are unaffected: a Court with no Bot has nothing to log.

### Court and Lobby

```
browser (menu) ──WebSocket──▶ Lobby (singleton "global")      list of open Courts, pushed live
      │                            ▲
      │ POST /create               │ DO RPC reports: open / heartbeat / join / leave / start / end / close
      ▼                            │
   Worker ──DO RPC provision()──▶ Court (one per Match, named by Court code) ◀──WebSocket── both Players
```

- **Creating a Court:**
  1. The client sends `POST /create { name, preset }` to the Worker.
  2. The Worker validates both, picks a Court code with `crypto.getRandomValues`, and calls `court.provision({ hostName, preset, seed })` over RPC. If the code is taken, provisioning is refused and the Worker retries with a new code.
  3. The Worker returns `{ code, hostToken }`.
  4. The Court reports `open` to the Lobby, and the Host's client connects to the Court with `hostToken`.
- **Joining:**
  1. The client clicks a row, or opens `?court=CODE`, and connects to the Court with `hello { name, protocolVersion, simHash }`.
  2. The Court seats the Guest, or answers `full` if two clicks raced, and reports `join`.
  3. Both clients load their Venue and send `ready`. After both are ready (with a 10 s cap), the Court starts the Match and reports `start`.
- **Lobby reports**, made by the Court, best-effort, over RPC:

  | Op | When | Lobby effect |
  |---|---|---|
  | `open` | provisioned | add an entry: `{ code, hostName, preset, players: 1, createdAt, expiresAt }` |
  | `heartbeat` | every 30 s while not started | refresh `expiresAt` |
  | `join` | Guest seated | `players: 2`, hidden from the list |
  | `leave` | Guest leaves before start | `players: 1`, shown again |
  | `start` | Match starts | delete |
  | `close` | Host leaves before start (after a 15 s reload grace), or the Court sits open 30 min with no Guest | delete |
  | `end` | Match over, or both Players gone | delete (idempotent) |

- **Stale entries:** every entry expires 90 s after its last report (`expiresAt = lastReport + 90 s`), so a Court that crashes or loses reports falls off within about 1.5 minutes. This is poker's self-healing sweep, but driven by the heartbeat. Poker only sweeps on read. We push updates, so the Lobby also sweeps on a 15 s interval while any menu client is subscribed and broadcasts when something was removed.
- **Menu clients:** the menu's Online panel holds a WebSocket to the Lobby while it's open. On connect it receives `{ t: 'courts', courts }` (open, visible entries only, newest first, at most 50), and again after every change, throttled to 4 per second. The list is tiny, so full lists are simpler than deltas. The socket closes when the panel closes.
- **The Host leaves before a Guest arrives:** the Court closes after the reload grace. A Guest who is seated but hasn't started is returned to the list with "The host left."
- **Display name:** trimmed, internal whitespace collapsed to single spaces, 1–16 characters. Allowed characters are Unicode letters and digits plus space and `- _ . '`. The same validator (`src/net/name.ts`) runs on the client (for instant feedback) and on the Worker/Court (authoritative), and a failure returns `bad_name`. It's stored locally under `dink.name`, with a default suggestion like "Guest 4821". There's no profanity filter in v1.

### Wire format

- **Control messages:** JSON, poker-style `{ t: ... }` unions in `src/net/protocol.ts` (Lobby and Court messages), re-guarded on the server.
- **Client → Court input:** each packet carries `{ t: 'in', from, intents[] }`, the last N un-acknowledged Ticks, quantized. Sent every frame.
- **Court → client snapshot:** `{ t: 'snap', tick, ack, state }` at 30 Hz.
  - `ack` is the last input Tick received from that client.
  - `state` is the full `SimState` (about 600 bytes of JSON, about 18 KB/s), including the opponent's Commit (Decision 4).
  - Deltas or binary come later, and only if measurements say so.
- **Handshake:** `hello { name, token?, protocolVersion, simHash }`, where `simHash` is a hash of the `simTuning` JSON plus a build Sim version constant. A mismatch returns `version`, and the client says "Please reload for the latest version."

---

## Part 4: Phased plan

Every phase ends with `npm test`, `npm run typecheck` and `npm run e2e` green, and offline Matches and Practice unchanged. Golden Bot Rallies in `test/bot.test.ts` and Replay determinism in `test/replay.test.ts` are the regression net for any Sim change.

### Phase 0: Decisions ✅

- `docs/adr/0004-online-play.md` written.
- `CONTEXT.md` has the "Online play" glossary section.
- Decisions recorded above.

### Phase 1: Client groundwork, no networking

- **Local Side as a parameter:** replace `LOCAL_SIDE` in `renderer.ts` and `LOCAL` in `main.ts` with a value passed in (Hud already takes one). Add a test that renders or mirrors with the local Player on Side 1.
- **A match-driver seam in `main.ts`:** move the current loop body (`tick`, hit-stop, Replay, dead-pause skip, rematch on shot press) behind a `LocalMatch` driver. Its frame API gives the renderer `(prev, curr, alpha, events)`. `main.ts` becomes mode, menu and driver selection. Behavior is unchanged, and `window.dink` keeps working.
- **Sim hook:** `Intent.contact?`, `MatchConfig.contactMode` (default `auto`), and the read-only "would `auto` hit this Tick?" query for the Takeover Bot adapter.
  - Tests: every existing test passes unchanged.
  - Tests: a `reported` Side with `contact` on the Tick `auto` would have hit produces a **bit-identical** state.
  - Tests: a false report out of reach is ignored.
  - Tests: the query agrees with `auto` across the golden Rallies.
- **`src/net/`, shared and pure:** Intent quantize/dequantize (a round-trip test that the quantized Intent steps identically), `SimState` snapshot JSON round-trip (including `-0`), `simHash(simTuning)`, `PRESETS`, and the Display name validator. Each gets unit tests.

Exit: no visible change, and the new tests are green.

### Phase 2: Court, Lobby, and naive online play

**Server (`party/`, mirroring PokerElo):**

- `party/package.json` (`partyserver`, `wrangler`, `@cloudflare/workers-types`) and a `party/tsconfig.json` for Workers types.
- `party/wrangler.jsonc`: DO bindings `COURT` → `Court` and `LOBBY` → `Lobby`, a `new_sqlite_classes` migration, deployed to `*.workers.dev`.
- **Worker** (`party/src/worker.ts`):
  - `POST /create` validates `{ name, preset }`, picks a code, provisions the Court over RPC, and returns `{ code, hostToken }`.
  - `routePartykitRequest` handles WebSockets, with an `onBeforeRequest` that allows only upgrades.
  - Origin allowlist: the Vercel origin and localhost.
- **Court DO** (`party/src/court.ts`, a thin shell):
  - `provision()` (idempotent; refuses a code that's already taken).
  - `hello`, seat assignment, the rejoin token and the grace timer.
  - `ready` → start (10 s cap).
  - A 60 Hz Sim loop and 30 Hz snapshots.
  - `simHash`/`protocolVersion` checks.
  - Lobby reports (`open`/`heartbeat`/`join`/`leave`/`start`/`end`/`close`).
  - The reload grace for a Host leaving before start, and the 30-minute idle close.
- **Lobby DO** (`party/src/lobby.ts`, a thin shell): RPC report methods, menu subscriptions, list broadcast (throttled), and the 15 s sweep while subscribed.
- **Pure, Vitest-tested modules** (in `party/src/`, tests under `test/net/`):
  - `courtDirectory.ts`: entries, visibility rules, TTL sweep, capped and sorted listing.
  - `courtSeats.ts`: seating, tokens, grace, the Host-left rules.
  - `tickLoop.ts`: the accumulator from callback timestamps.
  - Coverage includes every report op, expiry without reports, the race between two joins, a Host leaving before start, and hide/re-show on `leave`.
- Measure `step` CPU time on Workers, including a hit Tick where the solver runs.

**Client:**

- The menu gets **Play online**, which opens an Online panel:
  - **Display name** field, validated live and saved to `dink.name`.
  - **Court list**, live from the Lobby: host name, Preset, "1/2". Click to join.
  - **Create Court**: pick a Preset (Quick / Standard / Long), then wait with the code and a copyable `?court=CODE` link shown.
  - **Join by code** field.
  - Errors: `full`, `not_found`, `bad_name`, `version`, "The host left".
- Opening `?court=CODE` goes straight to joining.
- An `OnlineMatch` driver (next to `LocalMatch` from Phase 1) sends raw per-Tick Intents and **draws snapshots interpolated for both Players (no prediction yet)**, with the local Player on its real Side. That's playable at low ping and proves the plumbing.
- Online Matches don't record progress or unlocks.

**Out of Phase 2:** prediction, Reported Contact (human Sides use `auto` until Phase 4), rewind, the Takeover Bot, rematch and the online time rules (Phases 3–5).

Exit criteria:

- On `wrangler dev` plus `vite dev`, one browser creates a Court and it appears in a second browser's list within 1 s. The second browser joins by clicking, the row disappears, and they play a full Match.
- Joining by code and by link both work.
- The Host closing the tab before a join removes the row after the grace period.
- Killing the Court process makes its row expire within 90 s.
- A reload mid-Match rejoins the same seat.
- All the pure-module tests are green, and offline play is unchanged.

### Phase 3: Clock sync, input timing, local prediction

- Ping/pong clock sync. The client runs the predicted timeline ahead of the Court's Tick.
- Redundant input packets, a Court jitter buffer, the missing-input policy, and **rewind within the window**.
- Client reconciliation: on each snapshot, re-simulate from `snap.state` with un-acked Intents. Smooth small visual corrections of the local Player over a few frames.
- Headless **netcode harness** in Vitest: two fake clients plus the pure Court logic, with injected latency, jitter and loss. It asserts convergence and no lost shot presses at 5% loss.

Exit: movement feels local at 150 ms RTT (checked with dev-tools throttling), and the harness is green.

### Phase 4: Hitter-reported hits, remote interpolation, ball clock blend

- Online Matches set `contactMode: 'reported'` for human Sides. The client flags Contact from its prediction, and the Court validates it with rewind.
- Remote Player drawn from the interpolated timeline. The renderer is fed a composed `(prev, curr, alpha)` view: local Player predicted, remote Player interpolated, ball on the blended clock.
- Event policy: local hit/bounce plays immediately, and outcomes come from the Court. A rejected predicted hit is corrected once.
- Harness tests: a late hit report is accepted within the window and rejected past it; a forged out-of-reach report is rejected; both clients converge to the Court's state.

Exit: rallies at 150 ms RTT feel like single-player for the hitter, remote swings line up with the ball, and there are no ghost points.

### Phase 5: Online Match flow

- **No time distortion online:** Fault Replays off (banner only), hit-stop off, `gameSpeed` fixed at 1, and `MAX_FRAME` stalls resync the clock instead of dropping time. Offline is unchanged.
- **Pause** online becomes a "Leave match?" menu, not a Sim pause. **Match over** offers a rematch (both players press), which makes a new seed in the same Court. The Court doesn't return to the list.
- **Takeover Bot:** after the grace period, the Bot plays the disconnected Side, with its Intents logged and contact supplied by the adapter, as in Part 3. The remaining Player sees "<name> disconnected — a Bot has taken over."
  - Harness tests: a takeover mid-Rally; a rewind across Bot Ticks replays the log and never calls `think` twice; the Bot still makes Contact after a late human hit changes the ball's path.
- A tab going hidden relies on the missing-input decay.

Exit: a full Long (best of 3) Match online with Faults and a rematch. A Player closing their tab partway through is replaced by the Takeover Bot, and the Match finishes.

### Phase 6: Ship

- Playwright two-context e2e against `wrangler dev`: create, see the row in the list, join by click, a scripted Rally via `window.dink`, and a scored point.
- Deploy the Worker. Decide and attach a custom domain (deferred from Decision 2), then tighten the Origin allowlist.
- Point the Vercel client at the server with a `VITE_PARTY_HOST` env var. Smoke test the live URLs.
- Add `.scratch/` issues per phase, following the repo's tracker convention.

---

## Remaining notes

- **"Court" now means two things.** It names the online room, and the physical court's terms (the "Court" heading in `CONTEXT.md`, `src/sim/court.ts`, Service court) already use the word. In pickleball both senses mean "the place a Match is played", so the glossary defines the online sense and keeps the geometry file as is. In code, the room is always `Court` (a class or type) or the `court` party, never a bare `court` variable for geometry. Flag it if you'd rather rename `src/sim/court.ts`.
- **PokerElo's Lobby report channel is publicly reachable** (see "Changed on purpose" in Part 2). It's worth fixing there independently.
