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
