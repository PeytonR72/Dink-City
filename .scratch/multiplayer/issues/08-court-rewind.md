# 08: The Rewind window on the Court

Status: ready-for-agent
Blocked by: 07

Spec: `docs/MULTIPLAYER.md` Part 3, "Late inputs and rewind", and Phase 3; ADR-0004 ("Rewind window"); `CONTEXT.md`, **Rewind window**.

## Read first

- `CONTEXT.md` Online play, ADR-0004, `docs/MULTIPLAYER.md`.
- Issue 07 and its comments (the input buffer, the missing-input policy and the harness).

## Goal

A late Intent within 15 Ticks rewinds the Court and re-simulates, so the Match comes out as if the Intent had arrived on time. Later issues build on this: Reported Contact (10) and the Takeover Bot (14).

## Scope

**In `courtMatch`:**
- A ring buffer of the last 30 states, plus the Intents each Tick was stepped with, marking which were real and which were filled in by the missing-input policy.
- When a real Intent arrives for an already-stepped Tick T within the Rewind window (15 Ticks):
  - Replace the filled-in Intent.
  - Rewind to the state before T and re-step to now.
  - Later filled-in Ticks are recomputed from the new real Intent (the repeat-and-decay policy runs again from it).
  - Older Intents are dropped. Remove issue 07's "apply a late shot on the next Tick" stopgap.
- **Events after a rewind:** Snapshots must not re-send events that were already sent, and must send the new ones. Decide the policy and test it:
  - An event that disappears in the re-simulation was already sent; say how clients treat it.
  - The simplest rule may be that outcome events (`dead`, `rally-won`, `game`, `match`) are only sent once they're older than the window. Issue 11 then relies on that.
  - Record the decision in the issue comment.
- Rewind cost: re-stepping 15 Ticks must fit the Tick budget measured in issue 03. Measure it.
- The re-simulation is a pure function of the buffered states and Intents, and it never calls anything with memory. The Takeover Bot's log in issue 14 depends on this.

**Tests (unit + harness):**
- A late Intent inside the window gives the same final state as the same Intent on time.
- One outside the window is dropped.
- A late shot press within the window lands on its intended Tick.
- A rewind across a Serve, a hit, a Rally's end and a Game switch.
- Events aren't duplicated.

## Acceptance

- The tests are green, and all root checks pass. Offline play is unchanged.
- A two-window online Match still plays (Playwright).
- The rewind cost is recorded.

## Out of scope

Client prediction (09) and Reported Contact (10).

## Comments

### 2026-09-30: implemented

One commit, "Online play: the Rewind window on the Court" (the one that adds this comment).

**What was built, all in `party/src/courtMatch.ts`:**
- **The ring buffer:** `HISTORY_TICKS = 30` entries, by Tick modulo 30. Each entry holds:
  - the state stepped from;
  - each Side's Fill before the Tick (the missing-input policy's memory: the last real Intent and how many Ticks since);
  - the Intents stepped;
  - which Intents were real and which were filled in.
- **Each Feed keeps its client's Intents by Tick** (`received`), from 30 Ticks back to 30 ahead, instead of a queue that empties as it steps.
- **A late Intent within `REWIND_TICKS = 15`** is stored and marks a rewind.
  - The next `advance` goes back to the state before the oldest marked Tick, restores the Fills, and re-steps to where it was. Later fills are recomputed from the new real Intent, and only then are new Ticks stepped.
  - Several late Intents in one batch cost one rewind.
  - Older Intents are still acknowledged, but dropped.
  - Issue 07's "late shot on the next Tick" stopgap is gone.
- **The re-simulation is pure:**
  - `intentFor(feed, fillBefore, tick)` returns the Intent and the Fill after it, with no hidden state.
  - It reads only the buffer, the received Intents and the `goneAt` Tick.
  - `step` clones, so buffered states are never mutated.
- **`gone(side)`** records the first Tick the Side stands still from (`goneAt ??=`; `court.ts` calls it again on every later expiry). So a rewind re-steps those Ticks the same.
- **`disconnect`** drops only the Intents for Ticks not yet stepped. Real Intents already stepped stay, for a rewind.
- **`onStep`** now fires on re-steps too. The harness keeps the last Intents per Tick, so its press list reflects the final timeline.

**The event policy (the decision the issue asked for):**
- **Outcome events** (`dead`, `rally-won`, `game`, `match`) are held until they're older than the window (`tick <= now − 15`), or until the Match is over. No rewind can reach them then, so clients only ever hear the true outcome, `REWIND_TICKS` (250 ms) late. Issue 11 can rely on this.
- **The Snapshot's state runs ahead of a held outcome by up to 15 Ticks.** `hud.onEvents` reads the score from that state. That's fine: the dead phase lasts 75 Ticks, so the score and phase it shows are already the outcome's.
- **Moment events** (`hit`, `bounce`, `net`) go out in the next Snapshot, as before.
  - A rewind matches the events already told from the Ticks it re-steps against the re-simulation's events, in order, by kind and Side. Only the unmatched new ones are sent.
  - **An event that disappears in the re-simulation was already sent, and is never taken back.** Clients played its sound early. It stays "owed" while it's inside the window, and absorbs the next like event, which is usually the same hit a few Ticks later.
  - The cost: an owed `bounce` can swallow a different bounce's sound, and a phantom hit stays heard. In the always-late Bot Match test, fewer than 1 in 50 told hits were phantoms (4 of about 360 in one run), and every true hit was told exactly once.
- **A Snapshot's events are sorted by Tick.** `OnlineMatch.tellEvents` slices by count, so this matters now that held outcomes join newer moment events.
- **Once the Match is `over`, late Intents are ignored.** The last 75 Ticks are the dead phase, where input changes nothing.

**Rewind cost** (Node 22, the same V8 as Workers, as in issue 03; deployed Workers freeze the clock):
- **The worst case:** every Tick, Side 0's Intent arrives a full window late, so every `advance` re-steps 15 Ticks plus one new step, over a whole Quick Match of 13,156 Ticks between hard Bots.
- **Per advance:** mean **0.73 ms**, p50 0.59, p99 **2.2**, p99.9 3.9, max **7.2 ms**, against a 16.7 ms Tick. The end state was identical to the on-time run.
- **In the normal case** no rewind happens at all: the harness at 150 ms RTT and 5% loss re-stepped 0 Ticks in 30 s. The stall test re-stepped 110.
- **Recheck on deployed Workers in issue 16.**

**Tests:**
- **courtMatch** (+7, with two of 07's late-press tests replaced):
  - a late Intent inside the window equals the same Intent on time, with the fade refilled after it;
  - an Intent outside the window is dropped but still acknowledged;
  - a late Serve press lands on its own Tick;
  - one rewind from the oldest late Tick, re-stepping exactly that span;
  - a hit is told once across a rewind that keeps it;
  - outcomes go out 15–16 Ticks after their Tick, once each, in Tick order;
  - a `long` Bot Match where Side 0's Intents always arrive in batches up to 12 Ticks late, through Serves, hits, Rallies won and a Game switch: the same final state, the same outcome events, every true hit told once, no duplicate events;
  - `gone` twice across a rewind.
- **The harness:**
  - The links can now **stall**: they freeze for `ms` out of every `every` ms and then release together, as a WebSocket does behind a lost segment (07's "left for later").
  - The press tests now require each press **on its own Tick**, not "on that Tick or later".
  - New: a 200 ms uplink stall every 2.5 s rewinds, and every press and every Intent still lands on its Tick.
- **Totals:** 36 files, 343 tests (before: 336). Typecheck and build pass. The golden Bot result is unchanged.
- **e2e:** 17/19. The two rooftop screenshot tests fail, and they fail the same way on clean `main` (`ff7a042`) on one worker, so they predate this change.
- **Two Playwright contexts on `wrangler dev` + Vite** (panel create, join by `?court=`, an easy Bot on each through `dink.drive`, real GPU):
  - A full Quick Match, the Host winning **11–9 at Tick 31907** in about 540 s. Both screens ended `over` on the same Tick, with the right banners ("HOSTY WINS, 9–11" on the Guest's screen).
  - No page errors. The Court logged "tick interval stopped at Tick 31907: the Match is over, 11-9".
  - RTT 1.6–4 ms, lead 1.1–1.25 Ticks.
- **A gotcha with the playtest driver, not with this change:** the Bot serves only when the observed Tick equals its chosen Tick. `drive` sees the newest Snapshot's Tick, which moves in twos, so a naive driver can skip the serve forever. My first run stalled at 1–1 in `serve` that way. The driver now counts every Tick it's called for.

**Left for later:**
- Matching told events by kind and Side is coarse for `bounce`/`net`, which have no Side. Issue 11 can refine it (for example, by distance in Ticks) if a swallowed bounce sound is ever noticed.
- `Past.intents` and `Past.real` are recorded, but only issue 10 (Reported Contact) and issue 14 (the Takeover Bot's log) will read them.
