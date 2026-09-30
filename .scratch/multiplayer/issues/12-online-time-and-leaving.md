# 12: Online time rules, leaving a Match, and stalls

Status: ready-for-agent
Blocked by: 11

Spec: `docs/MULTIPLAYER.md` Phase 5 (the first two bullets and "A tab going hidden"), Part 1 §1 "Online impact" and §6 (frame-dependent Sim time); ADR-0004, "Online presentation (v1)".

## Read first

- `CONTEXT.md` Online play, ADR-0004, `docs/MULTIPLAYER.md`.
- Issues 04, 07, 09 and 11 and their comments.
- `src/main.ts` (modes, pause overlay, `MAX_FRAME`), `src/match/online.ts`.

## Goal

Online, nothing bends the Court's clock, and leaving or stalling behaves sensibly. Offline is unchanged.

## Scope

**No time distortion online.** Audit `OnlineMatch` and `main.ts` for each, and test them:
- No Fault Replay: the banner shows, `view.replay` is never called.
- No hit-stop.
- `gameSpeed` is fixed at 1. If a `?debug` Game-speed edit exists, it's ignored online.

**Stalls:**
- A long frame (`MAX_FRAME` cap), a background tab, or a debugger pause must not drop Sim time online.
- On resume, the client resyncs to the Court's clock (issue 07). It jumps the prediction to the next Snapshot rather than fast-forwarding thousands of Ticks. The Court meanwhile ran the missing-input decay (07), so the Player stood still.
- Test the resync path in the harness: a client stalls for 3 s and comes back.

**Pause online:**
- Esc opens a "Leave match?" overlay. It never pauses the Sim, and the Match keeps running behind it.
- Leaving:
  - Closes the socket and says so to the Court (`leave`), so the grace timer starts at once rather than on socket timeout.
  - Returns to the map.
  - Clears the seat token, so the Player won't rejoin by accident.
- Closing the tab or reloading still uses the grace and rejoin path from issue 02.

**Opponent status in the Hud:**
- "<name> disconnected…" while their grace runs.
- Cleared when they rejoin.
- If they leave for good before issue 14 exists, the Match ends: "<name> left." then back to the map. Issue 14 replaces this with the Takeover Bot.
- Protocol: `peer { side, status }` from the Court.

## Acceptance

- The tests are green, and all root checks pass. Offline Replays, hit-stop and Game speed are unchanged (e2e green, no screenshots re-accepted).
- The agent checks in Playwright, in a two-window Match:
  - A Fault shows the banner with no Replay.
  - Esc opens "Leave match?" while the opponent keeps playing.
  - Hiding one tab for 10 s makes its Player stand still, and the view resyncs cleanly on return.
  - The disconnect notice appears and clears on rejoin.

## Out of scope

Rematch (13) and the Takeover Bot (14).

## Comments
