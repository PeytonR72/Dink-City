# 13: Rematch in the same Court

Status: ready-for-agent
Blocked by: 12

Spec: `docs/MULTIPLAYER.md` Phase 5 ("Match over offers a rematch…"); ADR-0004.

## Read first

- `CONTEXT.md` Online play, ADR-0004, `docs/MULTIPLAYER.md`.
- Issues 03, 05 and 12 and their comments (the Court's end-of-Match path, Lobby reports, the online Hud).

## Goal

When an online Match ends, both Players can play again in the same Court without going back to the list.

## Scope

**Court:**
- After `over`, the Court stays up (its Tick interval stopped) and accepts `rematch` from each seat.
- When both have asked, it picks a new seed with `crypto.getRandomValues`, starts a new Match with the same Preset and seats, and sends `start`.
- The Court **doesn't** return to the Lobby list.
- Ending, and closing:
  - If a Player leaves while the other is waiting, the waiting Player is told and the Court closes.
  - With no rematch after a timeout (2 minutes by default, a named constant), the Court closes.
  - Either way, report `end` or `close` as issue 05 does.
- Pure logic goes in `courtMatch`/`courtSeats`, with tests: both ask, one asks and the other leaves, and the timeout.

**Client:**
- The Match-over screen offers **Rematch** and **Back to map**, and shows "Waiting for <name>…" or "<name> wants a rematch". This replaces the offline rule of rematching on a shot press.
- A new Match resets the Hud and view state, as offline `newMatch` does.
- Offline rematch stays as it is.

**Protocol:** `rematch` (client → Court) and `rematch { side }` (Court → client).

## Acceptance

- The tests are green, and all root checks pass. Offline play is unchanged.
- In Playwright with two windows:
  - A Quick Match ends, both press Rematch, and a fresh Match starts with a new seed.
  - One presses Rematch and the other leaves: the first is told, and the Court closes.
  - The Court never reappears in the list.

## Out of scope

The Takeover Bot (14).

## Comments
