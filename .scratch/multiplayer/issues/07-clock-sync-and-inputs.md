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
