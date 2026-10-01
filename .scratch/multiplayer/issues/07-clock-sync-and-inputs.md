# 07: Clock sync, redundant inputs, a jitter buffer, and the netcode harness

Status: ready-for-agent
Blocked by: 06

Spec: `docs/MULTIPLAYER.md` Phase 3, Part 3 "Timelines on each client" and "Late inputs and rewind" (the missing-input policy), Part 1 §4 (a shot press lives on one Tick); ADR-0004, "Simulation".

## Read first

- `CONTEXT.md` Online play, ADR-0004, `docs/MULTIPLAYER.md`.
- Issues 03, 04 and 06 and their comments: `courtMatch`, `OnlineMatch` and the protocol as built.

## Goal

The Court applies each Player's Intent **at the Tick the client meant it for**, with no lost shot presses, over a lossy, jittery connection. The client knows the Court's clock and runs its input Ticks ahead of it. A headless harness proves this under injected latency, jitter and loss, and every later netcode issue reuses the harness.

## Scope

**Clock sync** (pure `src/net/clockSync.ts`):
- Ping/pong samples (`ping { id, clientTime }` → `pong { id, clientTime, courtTick }`).
- Estimates RTT and the Court-Tick offset, preferring low-RTT samples and smoothing.
- Given the client's clock, it answers "what Tick is the Court on now?" and "what Tick should I stamp my input with?". The second is the Court Tick plus RTT/2 plus a jitter margin, capped.
- Unit tests with synthetic samples: steady, jittery, one outlier, and a clock step.

**Redundant inputs:**
- `in { from, intents: QIntent[] }` carries every un-acknowledged Tick, up to a cap of about 15.
- The Court drops the ones it already has.
- Snapshot `ack` becomes the last contiguous input Tick received from that client.

**The Court's per-Side input buffer** (in `courtMatch`):
- Intents keyed by Tick.
- When the Court steps Tick T without an Intent for that Side, the missing-input policy applies:
  - Repeat the last `move`/`aim`, with `shot: null` and no `contact`.
  - Decay `move` to zero over about 6 Ticks, so a stalled or hidden tab stops.
- Intents for Ticks already stepped are dropped for now. Issue 08 rewinds for them instead.
- Intents too far in the future are refused.
- **A shot press must survive:** a press stamped for an already-stepped Tick is applied on the next Tick rather than lost. Issue 08 replaces this with a rewind.

**`OnlineMatch`:**
- Stamps inputs with the synced Tick.
- Keeps its unacked list and resends it every frame.
- Still draws interpolated Snapshots; prediction is issue 09.

**The netcode harness** (`test/net/harness.ts` + tests):
- A deterministic fake network with per-direction latency, jitter and loss, from a seeded rng.
- The pure `courtMatch`.
- Two fake clients running the client-side logic (clock sync plus input stamping, the same modules `OnlineMatch` uses) and driving Bots.
- Everything runs on a virtual clock.
- Tests:
  - With 150 ms RTT, 30 ms jitter and 5% loss, **no shot press is lost** (every press a client made is applied on the Court).
  - Clock estimates converge within a few Ticks.
  - A client that stops sending decays to standing still.

**Protocol:** `ping`/`pong`, the new `in`, and `ack` semantics in `src/net/protocol.ts`.

## Acceptance

- The harness and unit tests are green, and all root checks pass. Offline play is unchanged.
- A two-window online Match still plays end to end (Playwright, as in 06).
- Record in the comment the RTT, offset and input lead seen on localhost, and with Chrome DevTools throttling to about 150 ms.

## Out of scope

Rewind (08), prediction (09) and Reported Contact (10).

## Comments

### 2026-09-30: implemented

One commit, "Online play: clock sync, redundant inputs and the netcode harness" (the one that adds this comment).

**What was built:**
- **`src/net/clockSync.ts`** (pure, the caller passes its clock):
  - Pings at once, 4 more at 100 ms, then every 500 ms.
  - Each sample brackets the Court's clock within half its round trip. The estimate is the mean offset of the samples within one Tick of the fastest round trip, over the last 16.
  - A sample that rules the estimate out (beyond its own half round trip + 0.5 Tick) is a clock step: the window starts over from it.
  - `rtt` is the median and `jitter` the median deviation. `lead = rtt/2 + 2·jitter + 1 Tick`, capped at `MAX_LEAD_TICKS = 15`.
  - `courtTick(now)` and `inputTick(now) = ceil(courtTick + lead)`.
- **`src/net/inputStream.ts`** (pure):
  - `stampTo(target, sample)` samples one Intent per Tick up to the input Tick and returns the `in` with every unacknowledged Tick. A gap of more than 8 Ticks (a hidden tab) is skipped, and what came before it is given up.
  - `inputFrame(sync, stream, now, sample)` is one client frame. `OnlineMatch`, the harness and the smoke all use it.
- **Protocol 4:**
  - `in { from, intents }`
  - `ping { id, clientTime }` and `pong { id, clientTime, courtTick }`, where `courtTick` is fractional: `tickLoop.phase(now)` adds the time since the last step.
  - `ack` is the last Tick up to which the Court has every Intent from that client.
- **`courtMatch`**, one Feed per Side:
  - Intents are keyed by Tick.
  - Ticks at or before `ack` are duplicates.
  - A run starting past `ack + 1` means the client gave the Ticks between up, so `ack` jumps.
  - Intents more than `MAX_AHEAD_TICKS = 30` ahead are refused.
  - A late Intent is dropped, but its shot press goes on the next Tick (or the Tick after, if that one has its own press).
  - A missing Tick repeats the last move and aim, with no shot and no `contact`. The move scales by `1 - (missing-1)/6`, so it reaches 0 on the 7th missing Tick.
  - `onStep(tick, intents)` observes each step, for the harness.
- **`OnlineMatch`:**
  - Takes `now` (default `performance.now`), plus `pong()` and `receive(snap)` with `ack`.
  - Sends through `inputFrame` every frame, and stops once a Snapshot says `over`.
  - `net` gives `{ rtt, jitter, lead, courtTick, unacked }`, exposed as `dink.online.net`.
- **The harness, `test/net/harness.ts`:**
  - A seeded per-direction latency, jitter and loss network, on a virtual clock.
  - The Court's interval fires on whole ms, like a Worker's.
  - Messages are encoded and re-guarded.
  - Two clients with skewed clocks drive easy Bots (or a given `drive`).
  - It records every stamped Intent, every press made, and every Intent and press the Court stepped.
- **Smoke `--match`:** its Bot clients send through `inputFrame` and print the RTT and lead at the end.

**Results:**
- **Tests:** 36 files and 336 tests pass (before: 33 and 300).
  - New: clockSync 10, inputStream 8, netcode 7, plus tickLoop, protocol, courtMatch and onlineMatch additions.
  - The golden result is unchanged.
- **Checks:** typecheck (root and `party/`) and build pass.
- **e2e: 19/19.** One earlier full run failed a rooftop screenshot. It fails the same way on clean `main` under 9-way parallel load and passes on one worker, so it's a load flake, not this change.
- **Smoke:** the handshake passes 13/13. `--match`: Side 1 won 8–11 at Tick 9445, 4100 Snapshots, 158 s, round trip 2.1 ms, input lead 1.11 Ticks.
- **Harness:**
  - At a 150 ms mean RTT (60–90 ms each way) with 5% loss each way, over three seeds of 30 s, every press is applied once, in order. 100% of stamped Intents landed on their own Tick.
  - Also no press lost at 20% loss and a 300 ms RTT.
  - The clock estimate stays within 0.25–1 Tick after 1 s.
  - A client that stops sending fades to standing still within 6 Ticks of its last Tick.

**Two Playwright contexts on `wrangler dev` + Vite** (panel create, join by `?court=`, an easy Bot on each through `dink.drive`):
- **Localhost:** a full Quick Match, 11–7 at Tick 9576 in about 160 s, with the right banners on both screens.
  - RTT **2–3.5 ms**, jitter under 1 ms, lead **1.1–1.2 Ticks**.
  - The estimated Court Tick is 5–8 ahead of the Tick drawn: the 6-Tick interpolation delay plus the Snapshot interval.
  - unacked 1–3.
  - An earlier run on the pre-review code also finished (9–11, Tick 9773).
- **At ~150 ms:**
  - RTT **162–167 ms**, jitter 2–7 ms, lead **6.1–6.7 Ticks** (100–110 ms).
  - The estimated Court Tick is 11–13 ahead of the Tick drawn.
  - unacked 11–13.
- **Offset:** the Court-Tick offset itself is an arbitrary number (the Court's Tick minus the page clock). The meaningful figures are the estimate's error, which the harness measures, and how far it runs ahead of the drawn Tick, above.
- **Measurement notes:**
  - **DevTools throttling doesn't delay WebSocket frames.** With `Network.emulateNetworkConditions` at 150 ms latency, the RTT still read 3 ms. So the 150 ms run used an in-page shim that delays each WebSocket send and message by 75 ms.
  - **Headless Chromium uses SwiftShader by default.** That gives 24 fps, and slow frames inflated the measured RTT to about 170 ms on localhost. The runs above use the real GPU (`--use-angle=d3d11`, 55 fps).

**Decisions where the issue left room:**
- **The redundancy cap.** Each `in` carries the last 15 unacknowledged Ticks, but an unacknowledged Tick with a shot press is kept until it's acknowledged, up to `MAX_IN_INTENTS = 30` on the wire.
  - A first try moved a dropped press onto a later Tick instead. At a 300 ms RTT, where the window always overflows, the harness showed it re-carrying presses the Court already had onto fresh Ticks, which multiplied them.
- **Resend:** every frame while anything is unacknowledged, including frames that stamp nothing (such as after the clock estimate steps back).
- **Disconnect** now drops the Intents queued for later Ticks and resets `ack`. The Side fades to standing still, instead of 03's "keeps its last move until the grace ends". A reconnected client's Intents are taken from wherever its new stream starts.
- **The input Tick convention:** an Intent labeled T is stepped from `state.tick === T`, which matches 03's tests.

**Left for later:**
- A late press is held for the next Tick even across a phase change. In theory, a press on the last Tick of a Rally could land on the next Serve. 08's rewind replaces this path.
- The harness's loss is per packet with independent jitter, so packets reorder. A real WebSocket stalls in head-of-line bursts instead. Burst stalls aren't modeled yet; 08 could add them.
- `court.ts` and the harness both compute `tick + loop.phase(now)` for a `pong`.
