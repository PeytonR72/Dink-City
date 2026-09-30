# ADR-0004: Online play on server-authoritative Courts, with predicted clients and Reported Contact

Status: accepted (2026-09-29)

## Context

Dink City will add 1v1 online Matches. ADR-0001 made the Sim a pure, fixed-tick, deterministic `step(state, intents) → state` over plain data, so that an authoritative server could run it later. ADR-0003 limits Bots to producing Intents, so they can fill seats. Players find each other through a public list, or through a code or link. There are no accounts. The sibling project PokerElo runs turn-based poker on Cloudflare Durable Objects with partyserver. Its room, lobby and reconnect patterns carry over; its turn flow doesn't.

The hard part is pickleball's timing. The hitter must see the ball and their own Player at the same moment. A purely server-driven client would see the ball about one round trip late.

## Decision

**Rooms and discovery**

- A **Court** is one Durable Object per Match, named by its **Court code**. The Court runs the Match. The **Lobby** is a singleton Durable Object that holds a directory of open Courts and pushes it live to menu clients.
- Courts report their lifecycle to the Lobby best-effort (`open`, `heartbeat`, `join`, `leave`, `start`, `end`, `close`), over DO RPC rather than a public HTTP route. Entries expire 90 s after their last report, so a Court that dies falls off the list without help. A Court leaves the list when it fills.
- The **Host** creates a Court and picks a **Preset** (Quick, Standard or Long), which is fixed from then on. The **Guest** joins from the list, or by code or `?court=` link.
- There are no accounts. Each Player has a guest **Display name** stored on the client, which the server validates (length and charset). A per-seat rejoin token covers reloads.
- Server code lives in `party/`, like PokerElo. Code shared by client and server lives in `src/net/`. The server imports `src/sim`, `src/bot` and `src/tuning` directly. Development uses the `*.workers.dev` URL.
- The name "Court" is for the room alone. A future open world could reuse Courts behind a different discovery layer.

**Simulation**

- The Court is authoritative. It runs the existing `step` at the 60 Hz Tick, with the build's `simTuning`, on a seed it picks. It sends full `SimState` snapshots at 30 Hz.
- Clients send only Intents, quantized, with the last few unacknowledged Ticks in every packet. The handshake carries a protocol version and a hash of `simTuning`, and a mismatch is refused.
- Each client runs a **Predicted timeline** ahead of the Court for its own Player and the ball, and reconciles on every snapshot. The remote Player is drawn from an **Interpolated timeline** about 100 ms behind. The ball is drawn on a clock that blends between the two, which is presentation only.
- **Reported Contact:** `Intent` gains an optional `contact` flag, and `MatchConfig` gains a per-Side `contactMode: 'auto' | 'reported'`.
  - In `auto` (offline, Practice, Bots), the Sim finds Contact exactly as before.
  - In `reported`, which applies to human Sides online, the Sim applies the same Contact rule only on a Tick whose Intent carries `contact`. It checks reach and the rules itself, and it still computes the shot (solver, quality, Aim error from `rng`).
  - The hitter's client sets `contact` from its own prediction, so the hit it shows is the hit the Court confirms.
- **Rewind window:** the Court keeps 30 Ticks of states and Intents. A late Intent or hit report within 15 Ticks rewinds and re-simulates. A missing Intent repeats the last movement, with no shot and no Contact, and decays to standing still.

**Takeover Bot**

- When a disconnected Player's grace period runs out, a Bot (`medium`, neutral Personality) plays that Side inside the Court for the rest of the Match. If both Players are gone, the Match ends.
- The Bot's Side stays `reported`, because `MatchConfig` never changes mid-Match. A Court-side adapter sets its `contact` flag from a read-only query of the `auto` Contact rule.
- A Bot's memory lives in a closure and can't be rolled back. So the Court logs each Tick's Bot `move`/`aim`/`shot`, and a rewind replays that log without calling `think` again. The adapter's `contact` is recomputed during the re-simulation, so the Bot still meets a ball whose path a late human hit changed. Its logged movement may be up to 250 ms stale after a rewind, which is accepted.

**Online presentation (v1)**

- Online, there are no Fault Replays (the Fault banner still shows), no hit-stop, and Game speed is 1. None of them may pause or bend the Court's clock. Offline is unchanged.
- The opponent's pending Commit type is sent in snapshots and not hidden. Bots don't observe it (ADR-0003), but a modified client could read it. **Revisit this if ranked play is ever added.**

## Consequences

- The Sim gains one concept (Reported Contact) and stays pure. Offline play is bit-identical, and Fault Replays and golden Bot tests keep working, because `contact` is recorded with the Intents like any other input.
- The hitter never waits a round trip to hit, and remote swings line up with the ball. The cost is a slightly faster or slower ball in flight at higher latency.
- Validation limits a cheating client to choosing which in-reach Tick to hit on. Reach, the rules and the shot itself stay with the Court.
- Courts stay awake while a Match is live, and DO duration is billed for it. The Tick timer stops when a Court empties or its Match ends.
- Every Court and Lobby rule lives in a pure module tested in Vitest. The DO classes are thin shells checked under `wrangler dev`.
- Online Matches earn no progress or unlocks in v1.

## Alternatives rejected

- **Lockstep or peer-to-peer rollback:** `Math.hypot` and friends aren't bit-identical across browser engines, so lockstep would desync. There's also no authority to stop cheating, and NAT traversal adds work.
- **The server detects Contact alone, and clients only show snapshots:** the hitter sees the ball a full round trip late, which ruins Commit timing (ADR-0002).
- **The client reports the launch velocity:** it's trivial to cheat, and it bypasses Shot quality and Aim error.
- **Switching a Bot's Side to `auto` on takeover:** it would mean editing `MatchConfig` outside `step`, and it breaks re-simulation across the switch.
- **Re-running `think` during a rewind:** Bot memory can't be rolled back, so the rewound Match would diverge from what the Bot actually did.
- **Showing full Courts as "2/2":** a row nobody can click. Full Courts start within seconds anyway.
- **Join by code only:** it needs an outside channel to share the code. The list is the main path; codes and links stay as a secondary one.
